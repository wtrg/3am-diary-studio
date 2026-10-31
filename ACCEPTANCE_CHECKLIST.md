# Checklist nghiệm thu — 3AM Diary Studio frontend

Ngày audit: 2026-10-30/31. Môi trường: Windows, Node 24, Electron 34.5.8, ffmpeg 9.0.

## Cách chạy lại

```bash
npm install
npm test
npm run test:e2e
```

- `npm test`: **31/31 pass** (contract, parser, discovery filter, library, API integration, gate server-side, job retry, download).
- `npm run test:e2e`: PASS. Tự mở Electron + local Muse test portal, đi đủ luồng, xuất MP4 thật và tải lại.
- Artifact: `artifacts/e2e/` (screenshots + `demo-final.mp4`).

## 1. Login gate chặn đúng khi chưa login Muse

| Kiểm tra | Kết quả | Bằng chứng |
|---|---|---|
| Chưa cấu hình Muse → toàn bộ nút gọi Muse disabled | PASS | `artifacts/e2e/01-gate-locked.png`; DOM E2E assert `[data-muse-action]` disabled |
| Câu bắt buộc hiển thị đúng từng chữ | PASS | Banner toàn cục + gate card Bước 3: “Cần đăng nhập tài khoản Muse kèm theo tool để tiếp tục. Không có tài khoản, tool không chạy.” E2E so sánh exact text |
| Khung Muse tích hợp thật (webview) tồn tại khi cấu hình URL | PASS | E2E assert webview URL = config URL; screenshot 02 |
| Trước login: nút gửi Muse và nạp kết quả Muse disabled | PASS | E2E assert disabled; screenshot 01/02/03 |
| Sau login test portal + verify: chip “Muse: đã đăng nhập”, nút mở khóa | PASS | E2E bấm login trong webview → verify server-side → assert enabled; screenshot `04-muse-unlocked.png` |
| Server chặn nguồn `muse` khi chưa login (không chỉ ẩn UI) | PASS | `tests/unit/server.integration.test.js`: POST `/api/plan/import` source muse → 403 `MUSE_LOGIN_REQUIRED`, đúng gateMessage |
| Không có nút “bỏ qua Muse”, “đăng nhập giả”, fallback AI | PASS | Không có endpoint/nút; test plan mẫu được ghi rõ là TEST, nguồn plan lưu `sample` |
| Không lưu mật khẩu Muse trong code | PASS | Không có credential; chỉ cookie Electron partition `persist:muse` |
| Mất wifi → không gọi Muse, thông báo rõ, không bịa kết quả | PASS | UI kiểm tra `online`; scraper trả OFFLINE; Muse actions disabled khi offline |
| Plan mẫu test tự tắt khi rule Muse đã gắn | PASS | `MuseRuleSlot.samplePlanEnabled()` yêu cầu `rule.prompt` rỗng; tránh bypass gate ở bản bán |

## 2. Validate JSON chặn đúng ID không có trong kho / text sai

| Kiểm tra | Kết quả | Bằng chứng |
|---|---|---|
| Plan lỗi test bị chặn | PASS | `artifacts/e2e/03-invalid-plan-blocked.png`; HTTP 422 |
| Bắt ID lạ | PASS | Errors có `UNKNOWN_MEME_ID`, `UNKNOWN_MUSIC_ID`, `UNKNOWN_SFX_ID`, `UNKNOWN_COMMENT_ID` |
| Bắt text không khớp nguyên văn | PASS | `TEXT_MISMATCH` ở `$.segments[0].text` |
| Không hiển thị plan lỗi như plan hợp lệ | PASS | E2E assert `planEditor` không tồn tại sau plan lỗi |
| Không lưu plan lỗi | PASS | Workspace API `draft_plan = null` sau lỗi |
| Không tự sửa, không render | PASS | UI ghi “Đã dừng, không tự sửa và không render”; không có job nào được tạo |
| Không render nếu kế hoạch chưa duyệt | PASS | Nút “Sang hàng đợi”/tạo job disabled; server `/api/jobs` trả 409 `PLAN_NOT_APPROVED` nếu gọi trực tiếp |
| Validator không mutate plan đầu vào | PASS | Unit test deep compare invalidPlan trước/sau |

## 3. Sửa tay trong Module 3 đổi được plan trước khi render

| Kiểm tra | Kết quả | Bằng chứng |
|---|---|---|
| Sửa tiêu đề hook, đổi meme, đổi thứ tự | PASS | E2E: title “Tiêu đề E2E đã sửa tay”, segment 0 meme dog_blanket, kéo segment 0 xuống |
| Plan sau sửa phải được duyệt lại | PASS | `planDirty` → nút queue disabled; approve lưu server |
| Job dùng snapshot plan đã sửa (không dùng sample gốc) | PASS | E2E job plan title/meme/order đúng; `artifacts/e2e/07-job-done.png` |
| Video thành phẩm phản ánh sửa tay | PASS | `artifacts/e2e/06-approved.png`, `07-job-done.png`; frame render kiểm tra title/meme đổi |
| Plan lỗi sau khi lưu → không render, lỗi hiện rõ | PASS | approve API 422 + `planErrors`; `planValidationErrors` hiển thị path/code |
| Job lỗi → giữ plan, chạy lại không sửa plan | PASS | Unit integration: adapter fail có chủ đích → error, plan còn; retry → done attempts ≥2. Thực tế UI: lần render đầu lỗi ffmpeg spawn, job giữ plan, bấm chạy lại → MP4 thành công |

## 4. Các yêu cầu còn lại

| Yêu cầu | Kết quả | Ghi chú |
|---|---|---|
| 4 module tiếng Việt | PASS | Bước 1–4, UI tiếng Việt |
| Bài gốc + bình luận có author/time/like/comment/share | PASS | Parser + demo + UI |
| Không viết lại text bình luận | PASS | Readonly, validator exact byte; unit test |
| Chọn/bỏ + sắp xếp bình luận | PASS | UI checkbox + ↑↓; server lưu thứ tự |
| Kho meme/nhạc/SFX/nền; id duy nhất/bất biến; tag; search; preview; CRUD | PASS | UI + Library tests |
| Input JSON đúng contract | PASS | `tests/unit/contract.test.js` |
| Trình duyệt Muse + trạng thái login | PASS | Webview thật + verify cookie/selector; test portal |
| Sửa title/order/meme/music/SFX trước Module 4 | PASS | E2E + screenshots |
| Hàng đợi chờ/đang dựng/xong/lỗi | PASS | Jobs API + UI trạng thái, progress |
| Xem video + tải MP4 + lịch sử | PASS | Modal video readyState 4, duration 60, 576×1024; Range 206; download 200 |
| Job lỗi giữ plan + chạy lại | PASS | Integration test + live incident |
| 576×1024, 30fps, 60–90s | PASS | Settings enforce; ffprobe MP4: 576×1024, 30/1, 60s |
| Rule Muse slot tên `muse_rule` | PASS | `config/muse_rule.json`, rule.prompt trống |
| Renderer slot | PASS | `app/main/render/index.js`; demo adapter được đánh dấu non-production |
| Không tự đăng TikTok/Facebook | PASS | Không có code/endpoint publish |
| Không fallback AI / AI khác | PASS | Không tích hợp provider khác; plan test ghi TEST |
| UI nhẹ, local | PASS | Vanilla JS, không framework, không build step |
| 3 đường mở: lệnh, Desktop, Start Menu | PASS | `3am-diary-studio`, shortcut Desktop và Start Menu đều mở cửa sổ `3AM Diary Studio` visible; shortcut target = wscript + `scripts/launch.vbs` |
| Live Threads scraper + frontend | PASS (một phần) | Live scrape 2026-10-31 **qua form Module 1**: bài gốc `faenight`, 7/13 bình luận, warning partial, ảnh `artifacts/e2e/11-live-threads.png`; không bịa. Cần chạy lại với account/Region người mua |
| Discovery theo chủ đề — ẩn danh | PASS (live) | Chủ đề `mèo`, 72h, ẩn danh: 5/5 bài mới trong UI, bấm chọn 1 bài tải 12/231 bình luận; ảnh `artifacts/e2e/12-discovery.png`, `13-discovery-selected.png` |
| Discovery lọc bài cũ / không rõ ngày | PASS | `buildCandidates` loại bài >72h, thiếu `taken_at`, reply, trích dẫn/gợi ý, sai từ khóa; stats live: 4 bài cũ + 3 sai chủ đề bị loại (lần chạy UI), 13 bài cũ bị loại (lần đầu) |
| Discovery đúng số lượng / không bịa | PASS | Lần 3/5 hiển thị cảnh báo `3/5`, lần 5/5 đủ; tool không lấp thêm. Unit test zero-result cũng có warning |
| Discovery chế độ Tài khoản | PASS (gate) | Server 401 `THREADS_LOGIN_REQUIRED` khi chưa login; UI hiện lỗi + nút Đăng nhập. Chưa test live với tài khoản Threads thật |
| Discovery giới hạn tải | PASS | Max 20 bài; một discovery tại một thời điểm (`DISCOVERY_BUSY`); chỉ tải comments của bài được chọn |
| Ẩn danh không vượt kiểm soát | PASS | Session in-memory `threads_guest`, không login; không proxy/antidetect/CAPTCHA bypass; Threads limit được hiển thị, không tự tạo dữ liệu |

## 5. Ghi chú trung thực / việc còn lại

1. **Muse thật chưa được cấu hình** vì chưa có URL/selector/tài khoản thật trong phiên này. Toàn bộ cơ chế login gate/webview/bridge đã được test bằng **Muse test portal local** (chỉ test). Khi có thông tin thật, điền `config/muse_rule.json` và chạy lại checklist login/logout.
2. **Threads live/discovery** đã chạy qua form frontend khi chưa login: single post 7/13 comments; discovery chủ đề `mèo` 5/5 bài mới, chọn bài tải 12/231 comments. Vẫn cần test với account/Region người mua vì Threads có thể login wall hoặc trả ít hơn. Timeout cứng đã sửa lỗi treo do `Network.enable`; parser/fixture/discovery tests pass.
3. **Renderer demo** chưa có giọng đọc/TTS, chưa hỗ trợ clip meme, style chưa phải renderer cuối. Renderer cuối là phase sau.
4. **Đóng gói thương mại** (installer, bản quyền, ffmpeg bundle, auto-update) chưa làm trong phase frontend.
5. Rủi ro tuân thủ: cần bảo đảm quyền dùng tài khoản Muse/Threads và nội dung theo điều khoản nền tảng khi bán tool.

## Kết luận

Ba tiêu chí nghiệm thu bắt buộc đều PASS bằng test tự động và ảnh chụp:

- Login gate chặn đúng, thông điệp đúng, server-side.
- Validate chặn ID lạ/text sai, không lưu plan lỗi, không render.
- Sửa tay thay đổi plan và MP4 thành phẩm; job giữ plan khi lỗi.

Phần chưa hoàn tất đúng phạm vi phase này: rule Muse chi tiết, kết nối Muse thật, renderer cuối, live Threads với tài khoản thật, đóng gói thương mại.

## 6. Bổ sung production + Muse setup (2026-10-31)

| Kiểm tra | Kết quả | Bằng chứng |
|---|---|---|
| Cấu hình Muse ngay trong app (URL + bridge + rule) | PASS | E2E: mở modal, lưu URL/selector; unit test lưu rule + tăng version |
| Mở cửa sổ đăng nhập Muse thật | PASS | Probe `https://muse.ai/`: cửa sổ mở đúng “Muse — Your Personal AI Agent”, có ô email/SĐT; ảnh `.sample/real-muse-login.png` |
| Khung Muse nhúng trang thật | PASS | Probe webview: URL `https://muse.ai/`, title đúng; ảnh `.sample/real-muse-webview.png` |
| Đo cookie phiên thật, không lưu giá trị | PASS | E2E: baseline đăng xuất → cookie mới `muse_test_session` được gợi ý; gate mở |
| Không false-unlock bởi cookie anonymous | PASS | Probe muse.ai: `hatch_native_auth_*` có trước/sau baseline nhưng `suggestedCookieNames=[]`; chỉ cookie mới/strong được chọn |
| Sao chép prompt Muse khi chưa có selector | PASS | Route `/api/muse/prompt` + nút UI; unit/integration test prompt chứa contract/lỗi |
| Dò selector Muse | PASS | `/api/muse/inspect` + UI; tìm được input/login trên muse.ai thật; E2E tìm `#muse-login` trên portal |
| Dùng selector dò được cho bridge | PASS | Nút “Dùng” điền vào ô bridge tương ứng; lưu qua API cấu hình |
| Không tự nhận đăng nhập khi còn ô mật khẩu | PASS | UI không tự check cookie khi `hasPasswordField=true` |
| Prompt gửi Muse có contract + rule + lỗi | PASS | Unit test `buildPrompt`; E2E bridge trả plan hợp lệ |
| Chụp post/comment thật, cắt đúng khung | PASS (live) | `.sample/live-prod-screens/post.png` + 3 comment PNG từ job production |
| Không còn ảnh bị tối bởi login backdrop | PASS | Đã ẩn backdrop `z-index:auto`; frame thẻ trắng trong `.sample/live-frames/` |
| Thiếu ảnh chụp → dừng job, không vẽ thẻ giả | PASS | `productionGuards.test.js`: thiếu post/comment đều throw `SCREENSHOT_MATCH_FAILED`; renderer dùng cùng guard |
| Rule Muse sửa được trong app, tự tắt plan mẫu | PASS | Ô rule trong modal; `saveConfig` tăng version, `samplePlanEnabled=false`; unit test |
| Gửi lỗi validate lại cho Muse sửa | PASS | Nút “Gửi lỗi cho Muse sửa”; server ghép lỗi vào prompt; unit/integration test assert prompt chứa lỗi |
| Production renderer qua hàng đợi | PASS (live) | `npm run test:live-production`: job done, 4 screenshot, 60s, 576×1024@30, ~3.2 MB |
| GIF/clip meme + SFX + nền + nhạc + watermark | PASS | Frame production: GIF/ảnh meme, watermark `@3am.diary.demo`, mark 3AM; audio trong MP4 |
| Renderer production thiếu file → giữ plan | PASS | Renderer throw, JobQueue giữ plan (integration test cho job retry; nhánh screenshot chưa tự động) |
| Upload/chọn file giọng đọc | PASS | Kind `voice`; library test; settings lưu `voice_track_id`; JobQueue truyền path |
| Renderer trộn voice track | PASS | Smoke 60s 576×1024 có audio stream; integration test assert `voiceTrackPath` |
| Unit + E2E toàn repo | PASS | 41/41 unit; E2E PASS gồm cấu hình/login đo phiên/bridge/render |
| Voice/TTS tiếng Việt tự sinh | **CHƯA** | Renderer chỉ dùng `voiceTrackPath` nếu có file giọng |
| Muse thật: mở trang/login window | PASS | `https://muse.ai/` mở đúng; chưa đăng nhập tài khoản thật |
| Muse thật: đăng nhập + cookie sau login + bridge selector | **CHƯA TEST** | Không có credential/selector thật trong phiên này; người dùng đăng nhập rồi Đo phiên |
