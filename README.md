# 3AM Diary Studio — Frontend local

Tool dựng video dọc kiểu **3AM Diary**: gameplay chạy nền, thẻ bình luận Threads đổi theo từng đoạn, hook mở đầu, meme/Clip ngắn ở điểm ngắt, watermark kênh và nhạc nền nhỏ.

Đây là **phase frontend**: đã có 4 module, contract Muse, login gate, kho file, hàng đợi và **renderer demo** xuất MP4 thật. **Chưa viết rule Muse**, **chưa làm renderer cuối**, **không tự đăng video**.

## 1. Trạng thái phase này

| Hạng mục | Trạng thái |
|---|---|
| 4 module frontend tiếng Việt | Đã xong |
| Login gate Muse (khóa toàn bộ nút gọi Muse) | Đã xong, kiểm tra server-side |
| Contract input/output + validate | Đã xong, chặn ID lạ / text sai |
| Kho file (id bất biến, tag, preview, CRUD) | Đã xong |
| Trình duyệt Muse tích hợp (`<webview>`) | Đã xong; cần điền `config/muse_rule.json` thật |
| Threads scraper + login Threads | Đã xong, có live smoke |
| Tìm bài theo chủ đề (discovery) | Đã xong: ẩn danh/tài khoản, lọc bài mới, điểm xu hướng |
| Hàng đợi + xem/tải MP4 + lịch sử + retry | Đã xong |
| Renderer cuối (voice/TTS, clip meme, style cuối) | **Chưa** — đang là renderer demo |
| Rule chi tiết cho Muse | **Chưa** — chỉ có slot config |
| Tự đăng TikTok/Facebook | **Không làm** |

## 2. Chạy local

### Yêu cầu

- Windows 10/11 x64 (đã test) hoặc macOS/Linux có Electron tương thích.
- Node.js 20+ (đã test Node 24).
- **Wifi** khi dùng Muse/Threads.
- **Muse account + URL/selector thật** để mở khóa Muse (xem mục 4).
- **ffmpeg + ffprobe** trên PATH cho renderer demo và đo thời lượng file. Nếu thiếu, job báo lỗi rõ và giữ nguyên kế hoạch.
- Tài khoản Threads cần cho chế độ **Tài khoản Threads** (bình luận đầy đủ hơn) hoặc khi Threads yêu cầu login. Chế độ **Ẩn danh** không cần tài khoản; dữ liệu demo cũng không cần.

### Mở nhanh (đã cài trên máy test)

```powershell
3am-diary-studio
```

Hoặc icon **3AM Diary Studio** trên Desktop / Start Menu. Cài lại shortcut bằng:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-launch.ps1
```

App tự mở cửa sổ; nút **Tắt ứng dụng** ở sidebar đóng app và server local. Ba đường mở (lệnh, Desktop, Start Menu) đã được test mở cửa sổ thật.

### Cài và chạy

```bash
npm install
npm run doctor      # kiểm tra Node, Electron, ffmpeg/ffprobe, config, demo assets
npm start           # mở app Electron local
```

`npm run doctor` không cần mạng. Nếu báo thiếu ffmpeg, cài bản full build và thêm `bin` vào PATH, hoặc đặt biến `FFMPEG_PATH` (và `FFPROBE_PATH`).

### Dữ liệu lưu ở đâu

Mặc định: `%APPDATA%\3AM Diary Studio\data\` (Electron `userData`).

- `library.json`, `library/media/` — kho file.
- `workspace.json` — bài, lựa chọn bình luận, thiết lập, kế hoạch nháp/đã duyệt.
- `jobs.json`, `outputs/` — hàng đợi và MP4 thành phẩm.
- Không lưu mật khẩu Muse trong code hay file dữ liệu. Phiên đăng nhập Muse/Threads nằm trong cookie của Electron (partition `persist:muse` / `persist:threads`).

Nút **Mở thư mục dữ liệu** trong sidebar mở đúng thư mục này.

## 3. Luồng demo chó/mèo (đi đủ 4 module)

1. Mở app → **Nạp dữ liệu demo** (sidebar hoặc Bước 1).
2. **Bước 1**: xem bài demo `@meo.va.cho`, 5 bình luận, like/comment/share. Chọn/bỏ, đổi thứ tự ↑↓. Text bình luận chỉ đọc, giữ nguyên văn.
3. **Bước 2**: kho có 4 meme ảnh + 1 clip, nhạc lofi 30s, 2 SFX, video nền gameplay 576×1024@30fps. Tìm theo tag, xem trước, sửa tên/tag, thử upload.
4. **Bước 3**:
   - Mặc định chưa cấu hình Muse: banner đỏ/ambrer hiện đúng câu bắt buộc và các nút gọi Muse bị khóa.
   - Không có rule Muse? Dùng **Nạp plan mẫu hợp lệ** (khối TEST) để test tiếp. Nút này ghi rõ đây là dữ liệu test, không phải kết quả Muse.
   - Sửa tiêu đề hook, đổi meme/SFX/nhạc, đổi thứ tự, rồi **Duyệt & lưu kế hoạch**.
5. **Bước 4**: **Đưa vào hàng đợi & dựng** ví dụ; job chờ → đang dựng → xong. Xem video, tải MP4, xem snapshot plan. Nếu lỗi, plan được giữ nguyên và có nút **Chạy lại**.

Video demo mẫu do renderer demo tạo: 576×1024, 30fps, 60 giây, ~3.4 MB. Renderer demo chưa có giọng đọc/TTS và chưa hỗ trợ meme clip (chọn meme ảnh), đây không phải renderer bán hàng cuối.

## 4. Cấu hình Muse (slot `muse_rule`)

Mở **`config/muse_rule.json`** và điền thông tin thật do bên bán/người dùng Muse cung cấp:

```json
{
  "muse": {
    "name": "Muse",
    "url": "https://...",
    "login": {
      "logged_in_url_contains": [],
      "logged_out_url_contains": [],
      "logged_in_selectors": ["#selector-khi-da-dang-nhap"],
      "logged_out_selectors": ["#selector-khi-chua-dang-nhap"],
      "cookie_names": ["ten_cookie_phien"]
    },
    "bridge": {
      "mode": "manual",
      "input_selector": "",
      "send_selector": "",
      "response_selector": "",
      "wait_timeout_ms": 180000
    }
  },
  "rule": {
    "prompt": "",
    "version": 0
  },
  "test_options": {
    "enable_sample_plan": true
  }
}
```

- **`muse.url`** + ít nhất một tín hiệu đăng nhập (`cookie_names` hoặc selector) mới bật được khung Muse và gate. Không cấu hình thì tool khóa Muse — đây là chủ ý, **không có chế độ “coi như đã đăng nhập”**.
- Nút **Tải lại cấu hình** trong Bước 3 đọc lại file mà không cần tắt app.
- Nếu điền `input_selector`, `send_selector`, `response_selector`, nút **Gửi input & nhận kế hoạch từ Muse** dùng bridge tự động. Không thì dùng copy JSON → Muse → dán JSON về.
- **`rule.prompt` đang để trống có chủ ý** — phase này chưa viết rule. Có thể gắn rule chi tiết vào đây ở phase sau. Frontend không chèn rule tự chế.
- **Plan mẫu test tự tắt khi `rule.prompt` có nội dung.** Đây là chốt an toàn: khi rule Muse thật đã gắn, không còn đường tạo kế hoạch test không qua Muse. Có thể tắt sớm hơn bằng `test_options.enable_sample_plan: false`.
- Trang login Muse có thể mở popup (OAuth). Main process mở popup cùng partition; không lưu mật khẩu.

Câu bắt buộc hiển thị khi chưa đăng nhập (không thay đổi):

> Cần đăng nhập tài khoản Muse kèm theo tool để tiếp tục. Không có tài khoản, tool không chạy.

Server cũng chặn nhập plan nguồn `muse` nếu chưa xác thực đăng nhập; không chỉ ẩn nút ở UI.

## 5. Contract Muse

### Input tool → Muse

Xem đầy đủ trong UI Bước 3. Dạng:

```json
{
  "post": { "post_id": "...", "url": "...", "author": "...", "time": "...", "text": "...", "likes": 0, "comments_count": 0, "shares_count": 0 },
  "comments": [{ "comment_id": "...", "author": "...", "time": "...", "text": "...", "likes": 0 }],
  "library": [
    { "meme_id": "meme_...", "tags": ["..."], "duration": 0 },
    { "music_id": "music_...", "mood": "..." },
    { "sfx_id": "sfx_...", "use": "..." },
    { "background_video_id": "bg_...", "tags": ["..."], "duration": 10 }
  ],
  "settings": { "voice": "...", "background_video_id": "bg_...", "watermark": "@...", "target_duration": 60 }
}
```

Background video được đưa vào `library` để validator kiểm tra `settings.background_video_id` tồn tại trong kho.

### Output Muse → tool

```json
{
  "title": "Hook...",
  "segments": [
    { "comment_id": "demo_c1", "text": "...", "meme_id": "meme_...", "meme_duration": 2.4, "sfx_id": "sfx_..." }
  ],
  "music_id": "music_...",
  "caption": "...",
  "hashtags": ["#..."]
}
```

### Validate (server-side, không tự sửa)

- Mọi `meme_id`, `music_id`, `sfx_id`, `background_video_id` phải tồn tại trong kho; ID lạ bị chặn.
- `comment_id` phải có trong input, không lặp; `text` phải **khớp nguyên văn** (từng byte) với bình luận gốc.
- Thiếu field/sai kiểu/`meme_duration <= 0` → lỗi.
- Có lỗi: HTTP 422, hiển thị danh sách lỗi có path/code, **không lưu plan, không render**.
- UI có nút test plan lỗi để xem cơ chế chặn. Plan mẫu test vẫn đi qua đúng validator này.
- Kế hoạch chỉ được dùng để tạo job sau khi bấm **Duyệt & lưu**; sửa tay làm nút “Sang hàng đợi” khóa cho đến khi duyệt lại.

## 6. Threads scraper

Đề xuất và chi tiết kỹ thuật: [`docs/THREADS_SCRAPING.md`](docs/THREADS_SCRAPING.md).

### Tìm bài mới theo chủ đề (discovery)

Ở Bước 1, khối **“Tìm bài mới theo chủ đề”** cho phép:

| Trường | Ý nghĩa |
|---|---|
| Chủ đề | Từ khóa người dùng nhập, ví dụ `mèo`, `chó mèo`, `3 giờ sáng`, `công sở`. Có chip gợi ý. |
| Số bài | 1–20 bài ứng viên. Tool trả đúng số tìm được, không bịa thêm. |
| Bài mới trong | 24 giờ / 48 giờ / 3 ngày / 7 ngày. Bài cũ hơn hoặc không rõ ngày bị loại. |
| Ưu tiên | **Xu hướng** (tương tác + độ mới + độ khớp) hoặc **Mới nhất** (thời gian đăng). |
| Phiên Threads | **Tự động** (tài khoản nếu đã login, ngược lại ẩn danh), **Ẩn danh**, **Tài khoản Threads**. |

- **Ẩn danh** dùng session in-memory `threads_guest`, không đăng nhập, chỉ đọc nội dung public. Không phải ẩn IP/antidetect; không vượt login/rate limit.
- **Tài khoản** dùng `persist:threads` sau khi login và thường lấy được nhiều kết quả/bình luận hơn. Nếu chưa login, tool chặn và hiện nút đăng nhập.
- Kết quả là **danh sách ứng viên** (author/time/text/like/comment/share/age/điểm xu hướng). Tool **chưa tải bình luận** cho đến khi người dùng bấm **Dùng bài này & tải bình luận** — tối ưu cho máy yếu và tránh cào thừa.
- Bộ lọc loại reply, bài trích dẫn/gợi ý, bài sai chủ đề, bài cũ/không rõ ngày; dedupe theo code; cap 20 và chỉ chạy một discovery tại một thời điểm.
- Live 2026-10-31: chủ đề `mèo`, 72h, ẩn danh — lần đầu 3/5, lần sau 5/5 bài mới; chọn 1 bài tải 12/231 comments với cảnh báo partial.
- Threads logged-out search có thể chặn “Log in for more”; tool cảnh báo và không tự tạo bài. Đăng nhập Threads để tăng kết quả/bình luận.

Tóm tắt: dùng **Electron Chromium ẩn** + partition `threads_guest` (ẩn danh, in-memory) hoặc `persist:threads` (tài khoản), đọc payload GraphQL/JSON nhúng, tự cuộn/mở bình luận, parser thuần (có unit test). Có thêm discovery theo chủ đề, lọc tuổi/độ liên quan và xếp điểm xu hướng. Ngày 2026-10-31, live scrape **qua chính form Module 1** trên một bài public đã lấy được **7/13 bình luận**, đúng bài gốc, có cảnh báo dữ liệu chưa đầy đủ; không có dữ liệu bịa. Ảnh: `artifacts/e2e/11-live-threads.png`. Threads tùy khu vực/tài khoản có thể yêu cầu đăng nhập — tool có cửa sổ **Đăng nhập Threads** riêng và báo lỗi rõ. Không tự đăng bài. Chạy smoke:

```bash
node_modules/electron/dist/electron.exe scripts/live-threads-smoke.js "<threads-url>"
node_modules/electron/dist/electron.exe scripts/live-threads-discover.js "mèo" 5 72
```

## 7. Renderer slot

- Interface: `app/main/render/index.js` → adapter `render(ctx)`.
- Demo: `app/main/render/demoRenderer.js` dùng ffmpeg, tạo MP4 576×1024@30fps, hook + thẻ bình luận + meme ảnh + nền + nhạc/SFX + watermark.
- Renderer cuối gắn vào `adapters` ở `app/main/render/index.js`; UI đọc metadata và cảnh báo nếu chưa `production`.
- Demo chưa có TTS/voiceover và chưa hỗ trợ meme clip; lỗi rõ ràng, job giữ plan để chạy lại. Không dùng AI khác thay Muse để bịa nội dung.

## 8. Kiểm thử

```bash
npm test          # 31 unit + integration test: contract, library, parser, discovery, gate, job retry, download
npm run test:e2e  # Electron thật + local Muse test portal + render MP4 thật
```

E2E sẽ tạo screenshot và MP4 tại `artifacts/e2e/` (thư mục này **không commit lên repo public**; đặc biệt ảnh live Threads chứa nội dung bên thứ ba):
`01-gate-locked.png`, `03-invalid-plan-blocked.png`, `04-muse-unlocked.png`, `05-muse-plan.png`, `06-approved.png`, `07-job-done.png`, `11-live-threads.png`, `12-discovery.png`, `13-discovery-selected.png`, `demo-final.mp4`.

Checklist nghiệm thu chi tiết: [`ACCEPTANCE_CHECKLIST.md`](ACCEPTANCE_CHECKLIST.md).

Test Muse portal (`tests/muse-portal/server.js` + `tests/fixtures/muse_rule.test.json`) chỉ dùng cho automated test. **Không đưa URL/selector test này vào config bán hàng.** Nó không phải AI, không được gọi trong production.

## 9. Giới hạn & phase sau

- Chưa có URL Muse thật; cần bên bán/người dùng cấu hình `muse_rule.json`. Khi có, kiểm tra login/logout selectors bằng tài khoản thật.
- Rule Muse chi tiết chưa viết; đang là slot.
- Threads API/DOM thay đổi có thể làm scraper hỏng; có timeout, lỗi rõ, fixture test. Live smoke ngày 2026-10-31 lấy được 7/13 bình luận công khai; discovery ẩn danh lấy 3/5 và 5/5 bài mới ở hai lần thử. Vẫn cần kiểm tra với tài khoản/Region của người mua trước khi bán.
- Discovery ẩn danh bị Threads giới hạn tự nhiên (không phải tool cố ý cắt): search logged-out có thể chỉ trả một phần và chặn “Log in for more”. Tool báo đúng số thực tế. Chế độ Tài khoản cần đăng nhập Threads; chưa kiểm thử live với tài khoản thật.
- Renderer cuối, TTS tiếng Việt, xử lý clip meme, style/typography cuối, đóng gói installer và license là phase sau.
- Tuân thủ điều khoản Threads/Muse và quyền nội dung khi vận hành thương mại. Tool không tự đăng bài, không vượt login/rate limit.

## 10. Cấu trúc chính

```
app/main/            Electron main, HTTP API local, store, job queue
  threads/           scraper + parser Threads (có test fixture)
  render/            renderer slot + demoRenderer
  contract.js        input builder + validator
  muse.js            login gate / webview verification / bridge
config/muse_rule.json Muse config slot
renderer/            SPA vanilla (không framework), CSS, app.js
demo/                dữ liệu demo chó/mèo + sample/invalid plan + assets
tests/unit/          unit + API integration
tests/e2e/           Electron E2E + local Muse portal test
scripts/             doctor, launcher, demo assets
artifacts/e2e/       evidence test (screenshots + MP4)
```

## 11. Một số quyết định kỹ thuật

- **Không framework** ở renderer để nhẹ, không bundler, phù hợp máy yếu.
- API local chỉ bind `127.0.0.1`, có token ngẫu nhiên mỗi lần chạy; media cần token.
- Hàng đợi tuần tự, lưu `jobs.json`; job lỗi giữ plan; renderer dùng snapshot tài nguyên.
- ID file bất biến; frontend chỉ truyền ID; tag/name sửa được; xóa file đang dùng bị chặn.
- Không log hay lưu mật khẩu; không có endpoint đăng nhập giả.
