# Reel Video Control for Instagram

Chrome extension (Manifest V3) thêm nút Pause/Resume, menu tốc độ phát và thanh tua cho video Instagram Reels.

## Tính năng

- Pause / Resume video đang xem
- Đổi tốc độ phát: 0.25× – 3× (lưu lại cho lần sau)
- Thanh tiến trình để tua video
- Chỉ chạy trên `instagram.com`, không gửi dữ liệu đi đâu

## Cài đặt

1. Clone repo:
   ```bash
   git clone https://github.com/txqt/ig-reel-control.git
   ```
2. Mở `chrome://extensions` → bật **Developer mode**
3. **Load unpacked** → chọn thư mục vừa clone
4. Mở một Reel trên Instagram, các nút điều khiển hiện ở góc video

## Cấu trúc

| File | Mô tả |
| --- | --- |
| `manifest.json` | Khai báo extension |
| `icons/` | Icon extension (16/32/48/128 px) |
| `content.js` | Logic điều khiển video |
| `content.css` | Style cho các nút điều khiển |

## License

[MIT](LICENSE)
