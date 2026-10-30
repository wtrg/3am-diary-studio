'use strict';

// Smoke test thủ công cho adapter Threads. Chạy:
//   node_modules/electron/dist/electron.exe scripts/live-threads-smoke.js "<threads-url>"
// Không dùng trong production. Nếu chưa đăng nhập Threads, kết quả phải là LOGIN_REQUIRED/NO_PAYLOAD/TIMEOUT,
// tuyệt đối không có dữ liệu bịa.

const { app } = require('electron');
const { scrapeThreads } = require('../app/main/threads/scraper');

const url = process.argv[2] || 'https://www.threads.com/@faenight/post/Deit-l6FpQy';

app.whenReady().then(async () => {
  const started = Date.now();
  const result = await scrapeThreads(url, {
    timeoutMs: 40000,
    log: (line) => console.log('[live]', line),
  });
  const summary = {
    elapsed_ms: Date.now() - started,
    ok: Boolean(result.ok),
    code: result.code || null,
    message: result.message || null,
    post_author: result.post?.author || null,
    post_chars: result.post?.text?.length || 0,
    comments: result.comments?.length || 0,
    warnings: result.warnings || [],
  };
  console.log(JSON.stringify(summary, null, 2));
  app.quit();
});

app.on('window-all-closed', () => app.quit());
setTimeout(() => {
  console.error('HARD TIMEOUT: scraper không trả kết quả trong 55s');
  app.exit(2);
}, 55000).unref();
