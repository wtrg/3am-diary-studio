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

## 7. Discovery theo chủ đề (bổ sung 2026-10-31)

### Cách hoạt động

- Người dùng nhập chủ đề, số bài (1–20), khoảng thời gian 24/48/72/168 giờ, ưu tiên Xu hướng/Mới nhất, chế độ Ẩn danh/Tài khoản.
- Server mở `https://www.threads.com/search?q=<topic>&serp_type=default|recent` trong Chromium ẩn, cuộn tối đa 7 lượt, thu payload GraphQL/JSON nhúng.
- Parser `discovery.js` lọc:
  - chỉ node thuộc `searchResults`, bỏ `quoted_attachment_post`, `share_info`, suggested/related;
  - bỏ reply, bài thiếu author/code/text, bài thiếu `taken_at`, bài cũ hơn cửa sổ đã chọn, bài không khớp từ khóa;
  - dedupe theo code, giữ metrics cao nhất.
- Điểm xếp hạng (không phải trend chính thức của Threads):
  `log10(1 + likes + comments*2 + shares*3)*2.1 + freshness*4 + relevance*2`.
  Người dùng có thể đổi sang sort theo thời gian đăng.
- Trả tối đa 20 ứng viên; **không tải bình luận** cho đến khi người dùng chọn 1 bài. Khi chọn, endpoint scrape chạy lại với đúng mode (guest/account).
- Một discovery tại một thời điểm; timeout 40s trong scraper, 55s ở API.

### Chế độ ẩn danh và tài khoản

- **Ẩn danh**: `session.fromPartition('threads_guest')` (in-memory), không login. Chỉ đọc nội dung public. Không phải IP anonymity/antidetect; không vượt login wall/rate limit.
- **Tài khoản**: `persist:threads` sau khi người dùng đăng nhập qua cửa sổ Threads. Nếu chưa login, API trả 401 `THREADS_LOGIN_REQUIRED`; UI hiện nút đăng nhập.
- Threads logged-out search thường chỉ trả một phần rồi hiện “Log in for more”. Tool hiển thị cảnh báo này và số bài thực tế, không thay thế bằng dữ liệu bịa.

### Kết quả live (2026-10-31)

- Chủ đề `mèo`, 72h, ẩn danh: lần đầu **3/5** bài mới (13 bài cũ bị loại, 1 sai chủ đề, 1 trích dẫn), lần sau **5/5** bài mới.
- Chọn bài đầu tiên (2,2K like, 231 comment): tải được **12/231 bình luận** ẩn danh; UI hiện cảnh báo partial. Ảnh: `artifacts/e2e/12-discovery.png`, `13-discovery-selected.png`.
- Chế độ Tài khoản chưa login bị chặn đúng ở API/UI; chưa test live với tài khoản Threads thật (không có credential trong phiên này).

### Giới hạn / tuân thủ

- Anonymous search phụ thuộc chính sách Threads; có thể trả ít hoặc login wall. Account mode cần test với tài khoản/Region người mua.
- Không scrape nội dung private, không tự đăng, không tương tác, không vượt CAPTCHA/rate limit; chỉ dùng nội dung public và có quyền sử dụng.
- Nên thêm cache/rate limit theo người dùng trước khi bán; hiện có giới hạn 20 bài/lần và một discovery đồng thời.

## 8. Chụp ảnh post/comment thật cho renderer production (2026-10-31)

- `app/main/threads/screenshot.js` mở bài bằng Chromium ẩn, ẩn modal đăng nhập **và backdrop tối `rgba(0,0,0,0.7)` có `z-index:auto`**. Trước khi sửa, mọi ảnh chụp bị tối 70%; sau khi sửa, thẻ trắng/theme sáng của Threads được giữ đúng.
- Tìm element nhỏ nhất (div/article/section) chứa đồng thời **author + text nguyên văn**, chọn theo diện tích/điểm card, cuộn vào khung, đo rect và `capturePage` với padding 2px, bo góc bằng ffmpeg.
- Không tìm thấy post/comment → `SCREENSHOT_MATCH_FAILED`; modal đăng nhập còn che → `SCREENSHOT_BLOCKED_BY_LOGIN`; job dừng, **không vẽ thẻ giả**, plan được giữ.
- Renderer production dùng ảnh PNG thật; scale rộng 528px, intro post 2.6s, mỗi segment dùng đúng ảnh comment; hỗ trợ meme ảnh/GIF/clip, SFX, nhạc 0.20, watermark.
- Live 2026-10-31 qua **job queue** (không phải script renderer trực tiếp): bài `faenight`, 7 bình luận tải được, chọn 3 → 4 ảnh chụp thật (post + 3 comment), MP4 60s 576×1024@30fps ~3.2 MB. Ảnh/MP4 bằng chứng ở `.sample/live-prod-screens/`, `.sample/live-production-e2e.mp4` (không commit).
- Chạy lại:
  ```bash
  npm run test:live-production
  ```
  Script dùng Threads thật (hoặc `LIVE_THREADS_URL`), tạo job qua API, kiểm tra renderer production, số screenshot, ffprobe 576×1024/30fps/60s.
- Giới hạn: chưa có test tự động riêng cho nhánh thiếu ảnh; DOM Threads thay đổi có thể làm match fail (job báo lỗi, không tự bịa). Theme sáng phụ thuộc trang guest; có thể bật `THREADS_SCREENSHOT_LIGHT=1` nếu Threads trả dark.
