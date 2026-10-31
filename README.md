# 3AM Diary Studio — Frontend local

Tool dựng video dọc kiểu **3AM Diary**: gameplay chạy nền, thẻ bình luận Threads đổi theo từng đoạn, hook mở đầu, meme/Clip ngắn ở điểm ngắt, watermark kênh và nhạc nền nhỏ.

Đây là **phase frontend + production renderer**: 4 module, contract Muse, login gate, kho file, hàng đợi, renderer production dùng **ảnh chụp Threads thật** và xuất MP4 thật. Muse có thể cấu hình và đăng nhập **ngay trong app**; rule chi tiết vẫn là slot, **không tự đăng video**.

## 1. Trạng thái phase này

| Hạng mục | Trạng thái |
|---|---|
| 4 module frontend tiếng Việt | Đã xong |
| Login gate Muse (khóa toàn bộ nút gọi Muse) | Đã xong, kiểm tra server-side |
| Contract input/output + validate | Đã xong, chặn ID lạ / text sai |
| Kho file (id bất biến, tag, preview, CRUD) | Đã xong |
| Trình duyệt Muse tích hợp (`<webview>`) | Đã xong, có **Cấu hình Muse** ngay trong app |
| Cửa sổ đăng nhập Muse + đo cookie phiên | Đã xong; mở đúng `https://muse.ai/` thật + test portal; chưa đăng nhập tài khoản thật |
| Baseline đăng xuất chống false-unlock | Đã xong; cookie anonymous không được tự chọn |
| Sao chép prompt Muse (khi chưa có selector) | Đã xong |
| Dò selector ô nhập/nút gửi/phản hồi từ trang Muse | Đã xong; test trên trang login thật + E2E portal |
| Threads scraper + login Threads | Đã xong, có live smoke |
| Tìm bài theo chủ đề (discovery) | Đã xong: ẩn danh/tài khoản, lọc bài mới, điểm xu hướng |
| Hàng đợi + xem/tải MP4 + lịch sử + retry | Đã xong |
| Chụp ảnh post/comment thật, cắt khung | Đã xong, live; thiếu ảnh thì dừng job |
| Renderer production (thẻ trắng, GIF/clip, SFX, watermark) | Đã xong; chưa tự TTS |
| Prompt gửi Muse (contract + rule slot + lỗi cần sửa) | Đã xong |
| Rule chi tiết cho Muse | Slot + ô nhập trong app; nội dung rule do Muse cung cấp (đang trống) |
| Gửi lỗi validate lại cho Muse sửa | Đã xong |
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

Bài demo dùng renderer demo (thẻ vẽ, 576×1024@30, 60 giây). **Bài Threads live tự dùng renderer production**: chụp post/comment thật, cắt khung, thẻ trắng giống mẫu, meme ảnh/GIF/clip, SFX, nền, nhạc, watermark. Cả hai chưa tự TTS; có thể truyền `voiceTrackPath` khi có file giọng.

## 4. Cấu hình Muse (slot `muse_rule`)

### Cách mới: cấu hình và đăng nhập ngay trong app

1. Mở app → banner Muse → **Cấu hình Muse** (hoặc nút cùng tên ở Bước 3). URL đã điền sẵn `https://muse.ai/` (Muse AI của Meta); có thể đổi nếu nhà cung cấp khác.
2. Điền selector bridge nếu có, bấm **Lưu cấu hình**.
3. Bấm **Lưu & mở cửa sổ đăng nhập** **trước khi đăng nhập** → đăng nhập Muse trong cửa sổ riêng (partition `persist:muse`, dùng chung với khung Muse). Tool **không lưu mật khẩu**; đã kiểm tra cửa sổ này mở đúng trang Muse thật.
4. Trong cửa sổ đó, bấm **Đo phiên hiện tại** tại modal cấu hình. Tool đã chụp **baseline đăng xuất** khi mở cửa sổ; sau khi đăng nhập, nó chỉ gợi ý cookie **mới xuất hiện** hoặc cookie phiên mạnh (`c_user`, `xs`, `sessionid`…). Cookie anonymous như `hatch_native_auth_*` **không được tự chọn**.
5. Chọn đúng cookie (và/hoặc bấm **Dùng URL đăng nhập** nếu URL đổi) → **Dùng tín hiệu đã chọn & lưu**. Tool lưu vào `config/muse_rule.json`, kiểm tra lại phiên và mở khóa Muse.
6. Nếu chưa biết selector bridge: trong Cấu hình Muse bấm **Dò selector trang Muse** → chọn ứng viên cho ô nhập/nút gửi/vùng phản hồi, hoặc bấm **Sao chép prompt gửi Muse** để dán thủ công. Inspector chỉ trả selector + nhãn, không trả nội dung tin nhắn.
7. Đã kiểm tra inspector trên trang login Muse thật: tìm được ô `Mobile number or email` và nút `Log in`. Trong chat Muse thật, dò sau khi đăng nhập để lấy selector chat.

Thông tin cũng có thể sửa tay trong file (định dạng dưới). Không cần tắt app sau khi lưu UI; **Tải lại cấu hình** đọc lại file.

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
- **Prompt gửi Muse** do `MuseRuleSlot.buildPrompt` ghép: contract JSON, ràng buộc text nguyên văn/ID hợp lệ, rule bổ sung (nếu có) và danh sách lỗi lần trước (nếu có). Nội dung chọn bình luận/meme/nhạc vẫn do Muse quyết; frontend không tự quyết.
- **`rule.prompt` sửa được ngay trong “Cấu hình Muse”** (ô “Rule / prompt bổ sung”) hoặc trong file. Rule được chèn vào đầu prompt gửi Muse; phiên bản tự tăng khi nội dung đổi. Mặc định đang trống.
- **Plan mẫu test tự tắt khi `rule.prompt` có nội dung.** Đây là chốt an toàn: khi rule Muse thật đã gắn, không còn đường tạo kế hoạch test không qua Muse. Có thể tắt sớm hơn bằng `test_options.enable_sample_plan: false`.
- Khi Muse trả kế hoạch sai, UI có nút **“Gửi lỗi cho Muse sửa”**: gửi lại input + danh sách lỗi validate để Muse trả JSON mới; tool vẫn không tự sửa.
- Nếu chưa cấu hình bridge selector, **Sao chép prompt gửi Muse** tạo prompt đầy đủ (contract + rule + input + lỗi) để dán thủ công; không cần bridge tự động.
- Sau khi đo phiên, khung Muse tự tải lại để đồng bộ cookie từ cửa sổ đăng nhập. Bridge hỗ trợ ô nhập thường và contenteditable, chờ nút gửi bật rồi mới bấm.
- **Baseline đăng xuất:** mở cửa sổ đăng nhập trước khi login. Tool chỉ gợi ý cookie mới/strong session, không gợi ý cookie anonymous `hatch_native_auth_*` của muse.ai. Nếu không có baseline, tool không tự chọn cookie; người dùng chọn tay.
- Trang login Muse có thể mở popup (OAuth). Main process mở popup cùng partition; không lưu mật khẩu.
- Đăng nhập/đo phiên dùng chung partition `persist:muse`; cấu hình chỉ lưu **tên** cookie/selector, không lưu giá trị cookie hay mật khẩu.

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

## 7. Renderer production

- Interface: `app/main/render/index.js` → adapter `render(ctx)`. Tự chọn **demo** cho bài demo, **production** cho bài Threads live; có thể ép bằng `RENDERER_ADAPTER=demo|production`.
- Production: `app/main/render/productionRenderer.js` + `app/main/threads/screenshot.js`.
  - Mở Threads bằng Electron ẩn, ẩn modal/login backdrop (kể cả backdrop `z-index:auto`), tìm element nhỏ nhất chứa đủ author + text, chụp `capturePage` đúng khung post/comment, bo góc PNG.
  - Thẻ dùng ảnh chụp thật; **thiếu ảnh nào thì throw `SCREENSHOT_MATCH_FAILED`, job lỗi, không vẽ thẻ giả**.
  - Video 576×1024@30, 60–90 giây: intro post 2.6s, thẻ bình luận đổi theo segment, meme ảnh/**GIF động**/clip video, SFX, nhạc 0.20, watermark + mark 3AM; hỗ trợ `voiceTrackPath` nếu có file giọng.
  - Ảnh chụp mặc định giữ theme sáng của Threads; nếu DOM đổi dark, đặt `THREADS_SCREENSHOT_LIGHT=1` để áp thẻ sáng (chỉ đổi màu, không đổi chữ).
- Renderer demo vẫn dùng cho dữ liệu demo, không dùng ảnh giả cho bài live. Không dùng AI khác thay Muse để bịa nội dung.
- Voice/TTS: **chưa tự sinh**; renderer nhận file giọng nếu job truyền `voiceTrackPath`.

## 8. Kiểm thử

```bash
npm test                  # 39 unit + integration test: contract, library, parser, discovery, Muse config/prompt, screenshot guard, gate, job retry, download
npm run test:e2e          # Electron thật: cấu hình Muse trong UI → mở cửa sổ login → đo cookie → bridge → render MP4
npm run test:live-production  # LIVE: Threads thật → job queue → chụp post/comment thật → production MP4
```

E2E sẽ tạo screenshot và MP4 tại `artifacts/e2e/` (thư mục này **không commit lên repo public**; đặc biệt ảnh live Threads chứa nội dung bên thứ ba):
`01-gate-locked.png`, `01b-muse-config.png`, `03-invalid-plan-blocked.png`, `04a-muse-session-measured.png`, `04-muse-unlocked.png`, `05-muse-plan.png`, `06-approved.png`, `07-job-done.png`, `11-live-threads.png`, `12-discovery.png`, `13-discovery-selected.png`, `demo-final.mp4`.

`npm run test:live-production` ghi MP4 + ảnh chụp thật vào `.sample/` (không commit) và kiểm tra ffprobe 576×1024/30fps/60s; lần chạy gần nhất lưu 4 ảnh chụp và video ~3.1 MB.

Checklist nghiệm thu chi tiết: [`ACCEPTANCE_CHECKLIST.md`](ACCEPTANCE_CHECKLIST.md).

Test Muse portal (`tests/muse-portal/server.js` + `tests/fixtures/muse_rule.test.json`) chỉ dùng cho automated test. **Không đưa URL/selector test này vào config bán hàng.** Nó không phải AI, không được gọi trong production.

## 9. Giới hạn & phase sau

- **Muse thật:** URL đã cấu hình sẵn `https://muse.ai/`; đã mở thành công cả cửa sổ đăng nhập riêng và khung Muse nhúng, thấy đúng trang “Muse — Your Personal AI Agent” (ảnh local `.sample/real-muse-login.png`, `.sample/real-muse-webview.png`). **Chưa đăng nhập bằng tài khoản thật** (không có credential trong phiên này), nên chưa xác nhận được cookie/URL sau đăng nhập và selector bridge của Muse. Người dùng chỉ cần mở Cấu hình Muse → mở cửa sổ đăng nhập → đăng nhập → Đo phiên.
- **Bridge tự động Muse:** cần selector thật (ô chat, nút gửi, vùng trả lời). Khi chưa có, dùng **Sao chép prompt gửi Muse** + dán JSON trả về; đây là luồng thật, không phải fallback AI.
- **Rule Muse chi tiết** vẫn là slot; prompt tự sinh contract + rule bổ sung, không tự chọn nội dung thay Muse.
- **Threads:** live 2026-10-31, job production qua hàng đợi lấy 7 bình luận công khai, chọn 3, chụp **4 ảnh thật** (post + 3 comment), render 60s 576×1024@30fps ~3.1 MB; thẻ trắng đúng khung, GIF/ảnh meme, SFX, nền, nhạc, watermark. Video/ảnh bằng chứng nằm trong `.sample/` (không commit) và E2E trong `artifacts/` (không commit).
- **Thiếu ảnh chụp** hoặc DOM Threads đổi cấu trúc → job báo `SCREENSHOT_MATCH_FAILED`, không vẽ thẻ giả, plan được giữ. Guard này có unit test riêng (`productionGuards.test.js`) cho thiếu ảnh post/comment.
- **Voice/TTS tiếng Việt chưa tự sinh.** Renderer nhận `voiceTrackPath` nếu có file giọng; sample tham chiếu có voice nhưng tool chưa tạo voice.
- **Giao diện thẻ** giữ theme sáng thật của Threads; nếu Threads trả dark theme, bật `THREADS_SCREENSHOT_LIGHT=1` để áp thẻ sáng (không đổi chữ/ảnh).
- Discovery ẩn danh bị Threads giới hạn tự nhiên (không phải tool cố ý cắt): search logged-out có thể chỉ trả một phần và chặn “Log in for more”. Tool báo đúng số thực tế. Chế độ Tài khoản cần đăng nhập Threads.
- Đóng gói installer/license, style/typography cuối, xử lý clip meme nâng cao là phase sau.
- Tuân thủ điều khoản Threads/Muse và quyền nội dung khi vận hành thương mại. Tool không tự đăng bài, không vượt login/rate limit.

## 10. Cấu trúc chính

```
app/main/            Electron main, HTTP API local, store, job queue
  threads/           scraper + parser + screenshot Threads (có test fixture)
  render/            renderer slot + demoRenderer + productionRenderer
  contract.js        input builder + validator
  muse.js            login gate / webview verification / bridge
  museLogin.js       cửa sổ đăng nhập Muse + đo cookie phiên
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
