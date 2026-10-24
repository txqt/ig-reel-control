(() => {
  'use strict';

  const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 3];
  const MIN_WIDTH = 150;
  const THUMB_H = 160;          // chiều cao ảnh preview
  const MUTE_RE = /audio|mute|sound|volume|âm thanh|âm lượng|tiếng/i;
  const REEL_PATH_RE = /\/reels?(\/|$)/;

  let speed = 1;
  let loop = true;              // Instagram mặc định loop
  let menuView = 'main';        // 'main' | 'speed'
  let active = null;            // video đang được điều khiển
  let dragging = false;         // đang kéo thanh tiến trình
  let lastPick = 0;
  let lastPaused = null;
  let cache = null;             // cache ảnh preview của video đang xem
  let toastTimer = 0;
  let anchors = { mode: 'over' };

  try {
    chrome.storage.local.get(['igrcSpeed', 'igrcLoop'], (r) => {
      if (!r) return;
      if (r.igrcSpeed) speed = r.igrcSpeed;
      if (typeof r.igrcLoop === 'boolean') loop = r.igrcLoop;
      renderMenu();
    });
  } catch (e) { /* bỏ qua */ }

  /* ---------- Helpers ---------- */
  const NS = 'http://www.w3.org/2000/svg';
  // Icon kiểu outline (stroke) cho hợp với icon của Instagram
  const ICONS = {
    pause: ['M6 4h4v16H6z', 'M14 4h4v16h-4z'],
    play: ['M5 3l14 9-14 9z'],
    gear: ['M9 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0z', 'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z'],
    loop: ['M17 1l4 4-4 4', 'M3 11V9a4 4 0 0 1 4-4h14', 'M7 23l-4-4 4-4', 'M21 13v2a4 4 0 0 1-4 4H3'],
    speed: ['M12 14l4-4', 'M3.34 19a10 10 0 1 1 17.32 0'],
    camera: ['M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z', 'M8 13a4 4 0 1 0 8 0a4 4 0 1 0-8 0z'],
    right: ['M9 18l6-6-6-6'],
    left: ['M15 18l-6-6 6-6'],
    check: ['M20 6L9 17l-5-5']
  };

  // size = null  -> kích thước do CSS quyết định (nút trong cụm Pause/Gear)
  function makeIcon(name, size) {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    if (size) {
      svg.setAttribute('width', size);
      svg.setAttribute('height', size);
    }
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    ICONS[name].forEach((d) => {
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', d);
      svg.appendChild(p);
    });
    return svg;
  }

  function el(tag, cls, parent) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (parent) parent.appendChild(e);
    return e;
  }

  function fmt(t) {
    if (!isFinite(t)) return '0:00';
    t = Math.max(0, Math.floor(t));
    return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
  }

  /* ---------- Build UI ---------- */
  // 1) Lớp phủ khớp khung video: thanh tua, preview, toast
  const root = el('div');
  root.id = 'igrc-root';
  const toast = el('div', 'igrc-toast', root);
  const bar = el('div', 'igrc-bar', root);
  const track = el('div', 'igrc-track', bar);
  const fill = el('div', 'igrc-fill', track);
  const thumb = el('div', 'igrc-thumb', track);
  const preview = el('div', 'igrc-preview', bar);
  const pcv = el('canvas', null, preview);
  const pctx = pcv.getContext('2d');
  const ptime = el('div', 'igrc-ptime', preview);

  // 2) Cụm nút Pause + Gear (vị trí tuỳ mode)
  const stack = el('div', 'igrc-over');
  stack.id = 'igrc-stack';
  const btnPlay = el('button', 'igrc-btn', stack);
  btnPlay.title = 'Pause / Resume';
  const gearWrap = el('div', 'igrc-gearwrap', stack);
  const btnGear = el('button', 'igrc-btn igrc-gear', gearWrap);
  btnGear.title = 'Settings';
  btnGear.appendChild(makeIcon('gear'));
  const menu = el('div', 'igrc-menu', gearWrap);

  function setPlayIcon(paused) {
    btnPlay.textContent = '';
    btnPlay.appendChild(makeIcon(paused ? 'play' : 'pause'));
  }
  setPlayIcon(false);

  document.documentElement.appendChild(root);
  document.documentElement.appendChild(stack);

  // Không để Instagram bắt các sự kiện từ khung điều khiển
  [root, stack].forEach((node) => {
    ['click', 'dblclick', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'contextmenu']
      .forEach((ev) => node.addEventListener(ev, (e) => e.stopPropagation()));
  });

  /* ---------- Menu bánh răng ---------- */
  function renderMenu() {
    menu.textContent = '';

    if (menuView === 'speed') {
      const head = el('button', 'igrc-row igrc-head', menu);
      el('span', 'igrc-ico', head).appendChild(makeIcon('left', 20));
      el('span', 'igrc-label', head).textContent = 'Playback speed';
      head.addEventListener('click', () => { menuView = 'main'; renderMenu(); });

      SPEEDS.forEach((s) => {
        const b = el('button', 'igrc-row' + (s === speed ? ' sel' : ''), menu);
        const chk = el('span', 'igrc-chk', b);
        if (s === speed) chk.appendChild(makeIcon('check', 18));
        el('span', 'igrc-label', b).textContent = s === 1 ? 'Normal' : s + 'x';
        b.addEventListener('click', () => setSpeed(s));
      });
      return;
    }

    // Loop
    const rLoop = el('button', 'igrc-row', menu);
    el('span', 'igrc-ico', rLoop).appendChild(makeIcon('loop', 20));
    el('span', 'igrc-label', rLoop).textContent = 'Loop';
    const sw = el('span', 'igrc-switch' + (loop ? ' on' : ''), rLoop);
    el('span', 'igrc-knob', sw);
    rLoop.addEventListener('click', () => setLoop(!loop));

    // Playback speed
    const rSpeed = el('button', 'igrc-row', menu);
    el('span', 'igrc-ico', rSpeed).appendChild(makeIcon('speed', 20));
    el('span', 'igrc-label', rSpeed).textContent = 'Playback speed';
    const val = el('span', 'igrc-val', rSpeed);
    val.appendChild(document.createTextNode(speed === 1 ? 'Normal' : speed + 'x'));
    val.appendChild(makeIcon('right', 18));
    rSpeed.addEventListener('click', () => { menuView = 'speed'; renderMenu(); });

    // Screenshot
    const rShot = el('button', 'igrc-row', menu);
    el('span', 'igrc-ico', rShot).appendChild(makeIcon('camera', 20));
    el('span', 'igrc-label', rShot).textContent = 'Screenshot';
    rShot.addEventListener('click', () => { closeMenu(); screenshot(); });
  }
  renderMenu();

  function closeMenu() {
    menu.classList.remove('open');
    btnGear.classList.remove('open');
    if (menuView !== 'main') { menuView = 'main'; renderMenu(); }
  }

  /* ---------- Actions ---------- */
  function setSpeed(s) {
    speed = s;
    if (active) active.playbackRate = s;
    try { chrome.storage.local.set({ igrcSpeed: s }); } catch (e) {}
    closeMenu();
    renderMenu();
  }

  function setLoop(v) {
    loop = v;
    if (active) active.loop = v;
    try { chrome.storage.local.set({ igrcLoop: v }); } catch (e) {}
    renderMenu();
    showToast(v ? 'Loop: On' : 'Loop: Off');
  }

  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('on'), 1600);
  }

  function screenshot() {
    const v = active;
    if (!v || !v.videoWidth) { showToast('No video to capture'); return; }
    try {
      const c = document.createElement('canvas');
      c.width = v.videoWidth;
      c.height = v.videoHeight;
      c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
      const t = Math.floor(v.currentTime);
      c.toBlob((blob) => {
        if (!blob) { showToast('Screenshot failed'); return; }
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'instagram-reel_' + Math.floor(t / 60) + 'm' + (t % 60) + 's_' + Date.now() + '.png';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        showToast('Screenshot saved');
      }, 'image/png');
    } catch (e) {
      showToast('Cannot capture this video');
    }
  }

  // Khi tắt Loop: chặn sự kiện "ended" để Instagram không tự phát lại
  window.addEventListener('ended', (e) => {
    if (!loop && e.target === active) e.stopImmediatePropagation();
  }, true);

  /* ---------- Theo dõi con trỏ ---------- */
  let px = -1;
  let py = -1;
  let showUntil = 0; // dành cho cảm ứng: chạm là hiện một lúc

  document.addEventListener('pointermove', (e) => { px = e.clientX; py = e.clientY; }, true);
  document.addEventListener('pointerdown', (e) => {
    px = e.clientX; py = e.clientY;
    showUntil = performance.now() + 3000;
    if (!root.contains(e.target) && !stack.contains(e.target)) closeMenu();
  }, true);

  btnPlay.addEventListener('click', () => {
    if (!active) return;
    if (active.paused) active.play().catch(() => {});
    else active.pause();
  });

  btnGear.addEventListener('click', () => {
    const open = menu.classList.toggle('open');
    btnGear.classList.toggle('open', open);
    if (!open && menuView !== 'main') { menuView = 'main'; renderMenu(); }
  });

  /* ---------- Cache ảnh preview (lấy mẫu khi video phát) ---------- */
  function ensureCache(v) {
    if (!v.videoWidth || !isFinite(v.duration) || v.duration <= 0) return null;
    const src = v.currentSrc;
    if (cache && cache.video === v && cache.src === src && Math.abs(cache.dur - v.duration) < 0.01) {
      return cache;
    }
    const h = THUMB_H;
    const w = Math.max(60, Math.min(280, Math.round(h * v.videoWidth / v.videoHeight)));
    cache = {
      video: v, src, dur: v.duration,
      step: Math.max(0.25, v.duration / 240),
      w, h, frames: new Map()
    };
    return cache;
  }

  function sample(v) {
    if (v.readyState < 2 || v.seeking) return;
    const c = ensureCache(v);
    if (!c) return;
    const idx = Math.round(v.currentTime / c.step);
    if (c.frames.has(idx)) return;
    try {
      const cv = document.createElement('canvas');
      cv.width = c.w;
      cv.height = c.h;
      cv.getContext('2d').drawImage(v, 0, 0, c.w, c.h);
      c.frames.set(idx, cv);
    } catch (e) { /* bỏ qua */ }
  }

  function nearestFrame(c, t) {
    const idx = Math.round(t / c.step);
    const max = Math.ceil(c.dur / c.step);
    for (let d = 0; d <= max; d++) {
      const a = c.frames.get(idx - d);
      if (a) return a;
      const b = c.frames.get(idx + d);
      if (b) return b;
    }
    return null;
  }

  /* ---------- Seek + preview ---------- */
  function ratioFromEvent(e) {
    const r = bar.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  }

  function showProgress(ratio) {
    const pct = (ratio * 100).toFixed(2) + '%';
    fill.style.width = pct;
    thumb.style.left = pct;
  }

  function seekTo(e) {
    if (!active || !isFinite(active.duration)) return;
    const ratio = ratioFromEvent(e);
    active.currentTime = ratio * active.duration;
    showProgress(ratio);
  }

  function updatePreview(e) {
    if (!active || !isFinite(active.duration)) return;
    const ratio = ratioFromEvent(e);
    const t = ratio * active.duration;
    const c = ensureCache(active);

    if (c) {
      if (pcv.width !== c.w || pcv.height !== c.h) { pcv.width = c.w; pcv.height = c.h; }
      pctx.fillStyle = '#111';
      pctx.fillRect(0, 0, c.w, c.h);
      const f = nearestFrame(c, t);
      if (f) pctx.drawImage(f, 0, 0);
      pcv.style.display = '';
    } else {
      pcv.style.display = 'none';
    }

    ptime.textContent = fmt(t);
    const barW = bar.clientWidth;
    const w = preview.offsetWidth;
    const x = Math.min(Math.max(ratio * barW - w / 2, 4), Math.max(4, barW - w - 4));
    preview.style.left = x + 'px';
  }

  bar.addEventListener('pointerdown', (e) => {
    dragging = true;
    bar.classList.add('drag');
    bar.setPointerCapture(e.pointerId);
    seekTo(e);
    updatePreview(e);
  });

  bar.addEventListener('pointermove', (e) => {
    updatePreview(e);
    if (dragging) seekTo(e);
  });

  const endDrag = (e) => {
    if (!dragging) return;
    dragging = false;
    bar.classList.remove('drag');
    try { bar.releasePointerCapture(e.pointerId); } catch (_) {}
  };
  bar.addEventListener('pointerup', endDrag);
  bar.addEventListener('pointercancel', endDrag);

  /* ---------- Chọn video đang xem ---------- */
  function visibleArea(r) {
    const w = Math.min(r.right, innerWidth) - Math.max(r.left, 0);
    const h = Math.min(r.bottom, innerHeight) - Math.max(r.top, 0);
    return w > 0 && h > 0 ? w * h : 0;
  }

  function pickActive() {
    let best = null;
    let bestArea = 0;
    document.querySelectorAll('video').forEach((v) => {
      const r = v.getBoundingClientRect();
      if (r.width < MIN_WIDTH) return;
      const area = visibleArea(r);
      if (area < r.width * r.height * 0.3) return;
      if (area > bestArea) { best = v; bestArea = area; }
    });
    if (best !== active) {
      active = best;
      lastPaused = null;
      closeMenu();
    }
  }

  /* ---------- Xác định mode + tìm vị trí neo ---------- */
  function isTransparent(c) {
    return !c || c === 'transparent' || /,\s*0\)$/.test(c);
  }

  // Tìm "nút" (hình tròn) bao quanh icon audio
  function muteButtonOf(svg) {
    let square = null;
    let n = svg.parentElement;
    for (let i = 0; i < 5 && n; i++, n = n.parentElement) {
      const b = n.getBoundingClientRect();
      if (b.width > 56) break;
      if (b.width >= 24 && Math.abs(b.width - b.height) <= 2) {
        if (!isTransparent(getComputedStyle(n).backgroundColor)) return n;
        square = square || n;
      }
    }
    return square || svg;
  }

  function findAnchors(r) {
    const midY = r.top + (r.bottom - r.top) / 2;
    let muteSvg = null;
    const col = [];

    document.querySelectorAll('svg[aria-label]').forEach((s) => {
      const b = s.getBoundingClientRect();
      if (!b.width || b.width > 48) return;
      const cx = b.left + b.width / 2;
      const cy = b.top + b.height / 2;
      if (!muteSvg && MUTE_RE.test(s.getAttribute('aria-label') || '') &&
          cx > r.left && cx < r.right && cy > midY && cy < r.bottom + 2) {
        muteSvg = s;
        return;
      }
      // cột icon bên phải video (tim, bình luận, chia sẻ...)
      if (cx > r.right && cx < r.right + 200 && cy > r.top - 40 && cy < r.bottom + 40) {
        col.push({ s, cx, cy });
      }
    });

    const out = { mode: 'over', muteBtn: null, icon: 16, bg: 'rgba(0, 0, 0, 0.55)' };

    if (muteSvg) {
      out.muteBtn = muteButtonOf(muteSvg);
      const sw = muteSvg.getBoundingClientRect().width;
      out.icon = Math.round(Math.min(24, Math.max(14, sw)));
      const bg = getComputedStyle(out.muteBtn).backgroundColor;
      if (!isTransparent(bg)) out.bg = bg;
    }

    // Mode focus: có cột icon xếp dọc bên phải video (trang reels)
    if (REEL_PATH_RE.test(location.pathname) && col.length >= 3) {
      let group = [];
      col.forEach((a) => {
        const g = col.filter((b) => Math.abs(b.cx - a.cx) < 10);
        if (g.length > group.length) group = g;
      });
      if (group.length >= 3) {
        group.sort((a, b) => a.cy - b.cy);
        const pitch = group[1].cy - group[0].cy;
        const fg = getComputedStyle(group[0].s).color;
        out.mode = 'side';
        out.heart = group[0].s;
        out.pitch = Math.min(90, Math.max(48, pitch));
        out.fg = isTransparent(fg) ? '#fff' : fg;
      }
    }
    return out;
  }

  /* ---------- Đặt vị trí cụm nút ---------- */
  const cssVars = {};
  function setVar(k, v) {
    if (cssVars[k] !== v) { cssVars[k] = v; stack.style.setProperty(k, v); }
  }
  let stackMode = 'over';
  function setMode(m) {
    if (stackMode === m) return;
    stackMode = m;
    stack.classList.remove('igrc-side', 'igrc-over');
    stack.classList.add('igrc-' + m);
  }

  function layoutStack(r, hover, now) {
    const a = anchors;
    let x, y, visible;

    if (a.mode === 'side' && a.heart && a.heart.isConnected) {
      // Focus: 2 nút nằm ngay trên icon trái tim, luôn hiện
      const hb = a.heart.getBoundingClientRect();
      const size = 40;
      const p = a.pitch;
      setMode('side');
      setVar('--igrc-size', size + 'px');
      setVar('--igrc-icon', Math.round(Math.min(32, Math.max(20, hb.width))) + 'px');
      setVar('--igrc-gap', (p - size) + 'px');
      setVar('--igrc-fg', a.fg);
      x = hb.left + hb.width / 2 - size / 2;
      y = Math.max(4, hb.top + hb.height / 2 - 2 * p - size / 2);
      visible = true;
    } else {
      // Feed: 2 nút nằm ngang bên trái nút audio, chỉ hiện khi hover
      const m = (a.muteBtn && a.muteBtn.isConnected)
        ? a.muteBtn.getBoundingClientRect()
        : { left: r.right - 44, top: r.bottom - 44, width: 32, height: 32 };
      const size = Math.round(Math.min(56, Math.max(28, m.width)));
      const gap = 8;
      setMode('over');
      setVar('--igrc-size', size + 'px');
      setVar('--igrc-icon', (a.icon || 16) + 'px');
      setVar('--igrc-gap', gap + 'px');
      setVar('--igrc-fg', '#fff');
      setVar('--igrc-bg', a.bg || 'rgba(0, 0, 0, 0.55)');
      x = m.left - 2 * (size + gap);
      y = m.top + (m.height - size) / 2;
      visible = hover || menu.classList.contains('open') || now < showUntil;
    }

    stack.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(y) + 'px)';
    stack.classList.toggle('on', visible && y < innerHeight - 20 && y > -60);
  }

  /* ---------- Vòng lặp cập nhật ---------- */
  function frame(now) {
    let picked = false;
    if (now - lastPick > 200) { pickActive(); lastPick = now; picked = true; }

    if (!active || !active.isConnected || document.hidden) {
      root.style.display = 'none';
      stack.style.display = 'none';
    } else {
      const r = active.getBoundingClientRect();
      const left = Math.max(r.left, 0);
      const top = Math.max(r.top, 0);
      const right = Math.min(r.right, innerWidth);
      const bottom = Math.min(r.bottom, innerHeight);

      root.style.display = 'block';
      root.style.left = left + 'px';
      root.style.top = top + 'px';
      root.style.width = (right - left) + 'px';
      root.style.height = (bottom - top) + 'px';

      if (picked) anchors = findAnchors(r);

      const hover = px >= left && px <= right && py >= top && py <= bottom;
      root.classList.toggle(
        'show',
        hover || dragging || menu.classList.contains('open') || now < showUntil
      );

      stack.style.display = '';
      layoutStack(r, hover, now);

      if (active.paused !== lastPaused) {
        lastPaused = active.paused;
        setPlayIcon(active.paused);
      }

      if (Math.abs(active.playbackRate - speed) > 0.001) active.playbackRate = speed;
      if (active.loop !== loop) active.loop = loop;

      const hasDuration = isFinite(active.duration) && active.duration > 0;
      bar.style.display = hasDuration ? 'block' : 'none';
      if (hasDuration) {
        sample(active);
        if (!dragging) showProgress(active.currentTime / active.duration);
      }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
