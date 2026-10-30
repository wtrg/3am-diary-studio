# Phương án cào bài Threads cho frontend

Cập nhật: 2026-10-30. Tài liệu này giải thích phương án đang được cài trong tool, bằng chứng thử nghiệm, giới hạn và cách nối vào Module 1.

## 1. Vấn đề

Dữ liệu bài + bình luận Threads không có trong HTML server-side; phải chạy JavaScript:

- Trang bài viết công khai trả HTML nhưng phần nội dung/bình luận được tải sau bằng JavaScript/GraphQL; HTML server-side chỉ có app shell (đã kiểm tra ngày 2026-10-30).
- Các đường dẫn `.../embed` và `.../embed/captioned` đã thử ngày 2026-10-30: chỉ trả app shell/404, không có text bài/bình luận.
- Live scrape qua chính form Module 1 ngày 2026-10-31 lấy được một phần bình luận khi chưa login, có cảnh báo partial (xem mục 4); vẫn có thể bị login wall tùy khu vực/bài.
- oEmbed chỉ phục vụ nhúng, không có danh sách bình luận.
- API chính thức của Threads cần app/token/quyền, không phù hợp tool local bán kèm tài khoản.
- Dịch vụ scraping bên thứ ba tốn phí, phụ thuộc bên ngoài, khó kiểm soát dữ liệu và điều khoản.

Vì vậy phương án **trình duyệt thật + phiên đăng nhập Threads của người dùng** là thực tế nhất cho tool local.

## 2. Phương án được chọn

Dùng Electron Chromium (đã có sẵn trong tool), một **BrowserWindow ẩn** với partition `persist:threads`:

1. **Chuẩn hoá URL** chỉ chấp nhận `threads.com` / `threads.net`, đường dẫn `/@user/post/CODE`.
2. Mở URL trong cửa sổ ẩn, UA Chrome, `backgroundThrottling: false`, tắt ảnh để nhẹ.
3. Gắn `webContents.debugger` và **bắt response GraphQL/API**, đọc body JSON. Đồng thời đọc `<script type="application/json">` nhúng trong trang.
4. Tự **cuộn** và bấm các nút “Xem thêm bình luận / View more replies…” bằng tiếng Việt/Anh.
5. Phát hiện **login wall** → dừng, trả `LOGIN_REQUIRED`, mở cửa sổ đăng nhập Threads nếu người dùng bấm.
6. **Parser thuần** `app/main/threads/parse.js`:
   - Thu mọi object giống post (`code`/`pk`, user, caption/text, metrics).
   - Chọn bài gốc theo `code` trong URL; fallback object không phải reply có điểm cao nhất (có cảnh báo).
   - Chỉ lấy bình luận có tín hiệu reply (`text_post_app_info.is_reply`, `parent_post`, path chứa `reply/replies/comment`). Nếu API không trả tín hiệu, dùng candidate và gắn cảnh báo để người dùng kiểm tra.
   - Dedupe theo `code`; giữ text **nguyên văn**, giữ timestamp gốc, like/comment/share.
   - Không lấy bài gợi ý ra khỏi sidebar/payload không có tín hiệu reply.
7. Trả `post` + `comments` về server; server lưu vào workspace, UI hiện danh sách để chọn/bỏ/sắp xếp. Không viết lại nội dung.
8. **Timeout cứng**: 45s trong scraper, 60s ở API, 75s ở client; mỗi `executeJavaScript` có timeout riêng. Mọi lỗi trả JSON lỗi rõ; **không tạo dữ liệu giả**.

### Cửa sổ đăng nhập Threads

- Nút **Đăng nhập Threads** mở BrowserWindow thật, partition `persist:threads`, URL `threads.com/login`.
- Người dùng đăng nhập trực tiếp; tool không lưu mật khẩu.
- Cookie Threads do Electron quản lý. Scraper dùng cùng partition nên dùng lại phiên.
- Đây là phiên **Threads**, tách khỏi phiên **Muse** (`persist:muse`).

## 3. Nối thẳng vào frontend

```
Người dùng dán link
      │
      ▼
POST /api/threads/scrape { url }
      │
      ├─ offline → 503 OFFLINE (không bịa)
      ├─ login wall → 401 LOGIN_REQUIRED + mở login
      ├─ timeout → 422/504 TIMEOUT
      └─ ok → workspace.setPostAndComments(post, comments nguyên văn)
                 │
                 ▼
      Module 1: bài gốc + metrics + danh sách bình luận
      chọn/bỏ, ↑↓ thứ tự, readonly text
                 │
                 ▼
      Input JSON gửi Muse (Module 3) hoặc plan mẫu test
```

Dữ liệu demo chó/mèo trong `demo/` được gắn nhãn **DEMO · KHÔNG PHẢI THREADS THẬT**, không trộn với kết quả live.

## 4. Test & bằng chứng

### Unit test parser (`npm test`)

- `tests/unit/threads-parse.test.js`:
  - URL hợp lệ/không hợp lệ.
  - Bài gốc đúng theo code.
  - Chỉ lấy 3 reply, loại bài gợi ý `SUG1`.
  - Text giữ xuống dòng nguyên văn.
  - Dedupe payload trùng.
  - Đọc JSON nhúng từ script tag.
  - Không có dữ liệu → lỗi `NO_POST_DATA`, không tự tạo.
  - Cảnh báo khi Threads báo 5 bình luận nhưng chỉ tải 3.

### Live test — 2026-10-31

Chạy `scripts/live-threads-smoke.js` với một bài công khai khi **chưa đăng nhập Threads**:

```bash
node_modules/electron/dist/electron.exe scripts/live-threads-smoke.js "https://www.threads.com/@faenight/post/Deit-l6FpQy/..."
```

Kết quả thực tế:

```json
{
  "elapsed_ms": 10338,
  "ok": true,
  "post_author": "faenight",
  "post_chars": 76,
  "comments": 7,
  "warnings": ["Threads báo 13 bình luận nhưng chỉ tải được 7. Có thể cần đăng nhập hoặc mở thêm bình luận."]
}
```

Kết luận:

- Pipeline Chromium ẩn + GraphQL/JSON + parser chạy live, giữ text gốc và metrics; không bịa bình luận.
- Dữ liệu chưa đầy đủ (7/13) và UI hiển thị cảnh báo rõ. Người dùng có thể đăng nhập Threads rồi cào lại để lấy thêm.
- Trước khi bán, vẫn nên chạy lại với tài khoản/Region của người mua; Threads có thể chặn hoặc trả khác nhau.
- Nếu Threads đổi cấu trúc: parser generic + cảnh báo; cần cập nhật selector/endpoint. Có thể bật `SCRAPER_DUMP_DIR=.devdata/raw` để lưu payload debug (chỉ dev, chứa nội dung người dùng, không bật mặc định).

### Điểm cần audit trước khi thương mại hóa

- Tài khoản Threads có thể bị thách thức/captcha khi tự động cuộn. Tool hiện dừng và báo lỗi, không vượt.
- Tần suất cào: chưa có rate limiter; nên thêm giới hạn/người dùng và cache bài.
- Threads có thể chỉ trả một phần bình luận; UI đã cảnh báo “Threads báo X nhưng tải được Y”.
- Không tự đăng, không tương tác (like/comment) lên Threads.
- Chỉ cào nội dung người dùng có quyền sử dụng; tuân thủ điều khoản nền tảng.

## 5. Vì sao không chọn các cách khác

| Cách | Vấn đề |
|---|---|
| SSR/HTML công khai | Không có dữ liệu bài/bình luận; chỉ login wall (đã kiểm tra) |
| `/embed` | Không có bình luận; 404 với `/embed/captioned` |
| GraphQL endpoint tự gọi | Cần doc_id/token thay đổi liên tục, dễ vỡ, có thể vi phạm rate limit |
| API chính thức | Cần app review/token; không phù hợp bán kèm account Muse |
| Scraping API bên thứ ba | Chi phí, phụ thuộc, khó kiểm soát privacy/ToS |
| Copy/paste thủ công | Không đáp ứng “nhập link hoặc cào”; dùng làm cứu hộ không cần |

## 6. Phase sau

- Thêm rate limiter và cache bài theo code/URL.
- Cấu hình selector/endpoint trong file riêng để cập nhật nhanh khi Threads đổi.
- Test live với tài khoản Threads thật, ghi lại fixture từ payload thật (đã ẩn thông tin) để hồi quy.
- Nếu Threads mở API chính thức phù hợp, thay adapter sau interface `scrapeThreads(url)` mà không đổi UI.
