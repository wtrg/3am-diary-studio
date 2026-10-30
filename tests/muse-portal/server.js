'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.MUSE_PORTAL_PORT || 9444);
const samplePlan = fs.readFileSync(path.join(__dirname, '..', '..', 'demo', 'sample-plan.json'), 'utf8');

function page(loggedIn) {
  if (!loggedIn) {
    return `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8" />
  <title>Muse test portal</title>
  <style>
    body { margin:0; min-height:100vh; display:grid; place-items:center; background:#0b1020; color:#eaf2ff; font:14px "Segoe UI",sans-serif; }
    .card { width:min(420px,90vw); padding:28px; border:1px solid #2a3a59; border-radius:16px; background:#111c30; }
    h1 { margin:0 0 8px; font-size:20px; }
    p { color:#95a7c6; line-height:1.6; }
    button { margin-top:14px; width:100%; padding:11px 14px; border:0; border-radius:9px; background:#ec4899; color:white; font-weight:600; cursor:pointer; }
    code { color:#c4b5fd; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Muse test portal</h1>
    <p>Đây là trang login giả lập <strong>chỉ dùng cho automated test</strong> của frontend. Không phải Muse thật và không được bật trong config bán hàng.</p>
    <p>Cookie test: <code>muse_test_session</code>. Selector login: <code>#muse-login</code>.</p>
    <button id="muse-login">Đăng nhập Muse (test)</button>
  </div>
  <script>
    document.getElementById('muse-login').addEventListener('click', () => {
      document.cookie = 'muse_test_session=1; path=/; SameSite=Lax';
      location.reload();
    });
  </script>
</body>
</html>`;
  }
  return `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8" />
  <title>Muse test portal</title>
  <style>
    * { box-sizing:border-box; }
    body { margin:0; background:#0b1020; color:#eaf2ff; font:14px "Segoe UI",sans-serif; }
    header { padding:13px 16px; border-bottom:1px solid #273651; display:flex; justify-content:space-between; align-items:center; background:#0f1a2c; }
    header strong { font-size:13px; }
    header span { color:#6ee7b7; font-size:11px; }
    main { max-width:720px; margin:0 auto; padding:18px; display:flex; flex-direction:column; gap:10px; }
    #muse-app { display:flex; flex-direction:column; gap:10px; }
    h1 { font-size:17px; margin:0; }
    p { color:#8ba0c0; font-size:12px; margin:0; line-height:1.5; }
    textarea { min-height:170px; resize:vertical; background:#070d18; color:#cbd8ed; border:1px solid #2a3a59; border-radius:10px; padding:11px; font:11px Consolas,monospace; }
    button { align-self:flex-start; padding:9px 16px; border:0; border-radius:8px; background:#ec4899; color:white; font-weight:600; cursor:pointer; }
    #muse-response { min-height:110px; background:#070d18; border:1px solid #2a3a59; border-radius:10px; padding:11px; font:11px Consolas,monospace; color:#a7f3d0; white-space:pre-wrap; overflow-wrap:anywhere; }
    .label { font-size:10px; text-transform:uppercase; color:#6680a5; letter-spacing:.08em; }
  </style>
</head>
<body>
  <header><strong>Muse test portal</strong><span id="muse-app">Đã đăng nhập</span></header>
  <main>
    <h1>Khung Muse giả lập để test bridge</h1>
    <p>Nhận JSON input, sau 650ms trả lại một plan mẫu hợp lệ để test validate + duyệt + render. Không phải AI thật.</p>
    <span class="label">Input JSON</span>
    <textarea id="muse-input" placeholder="JSON input từ tool"></textarea>
    <button id="muse-send">Gửi cho Muse (test)</button>
    <span class="label">Response JSON</span>
    <div id="muse-response"></div>
  </main>
  <script>
    const SAMPLE = ${JSON.stringify(samplePlan)};
    document.getElementById('muse-send').addEventListener('click', () => {
      const input = document.getElementById('muse-input').value;
      const response = document.getElementById('muse-response');
      response.textContent = 'Đang xử lý test...';
      if (!input.trim()) {
        response.textContent = 'Không có input.';
        return;
      }
      setTimeout(() => {
        response.textContent = SAMPLE;
      }, 650);
    });
  </script>
</body>
</html>`;
}

const server = http.createServer((req, res) => {
  const loggedIn = /(?:^|;\s*)muse_test_session=1(?:;|$)/.test(req.headers.cookie || '');
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, loggedIn }));
    return;
  }
  const html = page(loggedIn);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(html);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[muse-portal] http://127.0.0.1:${PORT}/`);
});
