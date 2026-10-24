(() => {
  'use strict';

  const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 3];
  const MIN_WIDTH = 150;

  let speed = 1;
  let active = null;      // video đang được điều khiển
  let dragging = false;   // đang kéo thanh tiến trình
  let lastPick = 0;
  let lastPaused = null;

  try {
    chrome.storage.local.get('igrcSpeed', (r) => {
      if (r && r.igrcSpeed) { speed = r.igrcSpeed; renderMenu(); }
    });
  } catch (e) { /* bỏ qua */ }

  /* ---------- Helpers ---------- */
  const NS = 'http://www.w3.org/2000/svg';
  const ICONS = {
    pause: ['M6 5h4v14H6zM14 5h4v14h-4z'],
    play: ['M8 5v14l11-7z'],
    gear: ['M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z']
  };

  function makeIcon(name) {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '22');
    svg.setAttribute('height', '22');
    ICONS[name].forEach((d) => {
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', d);
      p.setAttribute('fill', 'currentColor');
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
  const root = el('div');
  root.id = 'igrc-root';

  const btnPlay = el('button', 'igrc-btn igrc-tl', root);
  btnPlay.title = 'Pause / Resume';
  const btnGear = el('button', 'igrc-btn igrc-tr', root);
  btnGear.title = 'Tốc độ phát';
  btnGear.appendChild(makeIcon('gear'));

  const menu = el('div', 'igrc-menu', root);
  const bar = el('div', 'igrc-bar', root);
  const track = el('div', 'igrc-track', bar);
  const fill = el('div', 'igrc-fill', track);
  const thumb = el('div', 'igrc-thumb', track);
  const tip = el('div', 'igrc-tip', bar);

  function setPlayIcon(paused) {
    btnPlay.textContent = '';
    btnPlay.appendChild(makeIcon(paused ? 'play' : 'pause'));
  }
  setPlayIcon(false);

  function renderMenu() {
    menu.textContent = '';
    el('div', 'igrc-menu-title', menu).textContent = 'Tốc độ phát';
    SPEEDS.forEach((s) => {
      const b = el('button', 'igrc-item' + (s === speed ? ' sel' : ''), menu);
      b.textContent = s === 1 ? 'Bình thường' : s + 'x';
      b.addEventListener('click', () => setSpeed(s));
    });
  }
  renderMenu();

  document.documentElement.appendChild(root);

  // Không để Instagram bắt các sự kiện từ khung điều khiển
  ['click', 'dblclick', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'contextmenu']
    .forEach((ev) => root.addEventListener(ev, (e) => e.stopPropagation()));

  /* ---------- Actions ---------- */
  function setSpeed(s) {
    speed = s;
    if (active) active.playbackRate = s;
    try { chrome.storage.local.set({ igrcSpeed: s }); } catch (e) {}
    renderMenu();
    closeMenu();
  }

  function closeMenu() {
    menu.classList.remove('open');
    btnGear.classList.remove('open');
  }

  /* ---------- Hiện overlay khi rê chuột vào video ---------- */
  let px = -1;
  let py = -1;
  let showUntil = 0; // dành cho cảm ứng: chạm là hiện một lúc

  document.addEventListener('pointermove', (e) => { px = e.clientX; py = e.clientY; }, true);
  document.addEventListener('pointerdown', (e) => {
    px = e.clientX; py = e.clientY;
    showUntil = performance.now() + 3000;
  }, true);

  btnPlay.addEventListener('click', () => {
    if (!active) return;
    if (active.paused) active.play().catch(() => {});
    else active.pause();
  });

  btnGear.addEventListener('click', () => {
    const open = menu.classList.toggle('open');
    btnGear.classList.toggle('open', open);
  });

  document.addEventListener('pointerdown', (e) => {
    if (!root.contains(e.target)) closeMenu();
  }, true);

  /* Seek */
  function ratioFromEvent(e) {
    const r = bar.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  }

  function seekTo(e) {
    if (!active || !isFinite(active.duration)) return;
    const ratio = ratioFromEvent(e);
    active.currentTime = ratio * active.duration;
    showProgress(ratio);
  }

  function showProgress(ratio) {
    const pct = (ratio * 100).toFixed(2) + '%';
    fill.style.width = pct;
    thumb.style.left = pct;
  }

  bar.addEventListener('pointerdown', (e) => {
    dragging = true;
    bar.classList.add('drag');
    bar.setPointerCapture(e.pointerId);
    seekTo(e);
  });

  bar.addEventListener('pointermove', (e) => {
    if (active && isFinite(active.duration)) {
      const r = bar.getBoundingClientRect();
      const ratio = ratioFromEvent(e);
      tip.style.left = (ratio * r.width) + 'px';
      tip.textContent = fmt(ratio * active.duration);
    }
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

  /* ---------- Vòng lặp cập nhật ---------- */
  function frame(now) {
    if (now - lastPick > 200) { pickActive(); lastPick = now; }

    if (!active || !active.isConnected || document.hidden) {
      root.style.display = 'none';
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

      const hover = px >= left && px <= right && py >= top && py <= bottom;
      root.classList.toggle(
        'show',
        hover || dragging || menu.classList.contains('open') || now < showUntil
      );

      if (active.paused !== lastPaused) {
        lastPaused = active.paused;
        setPlayIcon(active.paused);
      }

      if (Math.abs(active.playbackRate - speed) > 0.001) {
        active.playbackRate = speed;
      }

      const hasDuration = isFinite(active.duration) && active.duration > 0;
      bar.style.display = hasDuration ? 'block' : 'none';
      if (hasDuration && !dragging) showProgress(active.currentTime / active.duration);
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
