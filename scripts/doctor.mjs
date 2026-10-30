import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
let warnings = 0;

function ok(label, detail = '') {
  console.log(`[OK]   ${label}${detail ? ` — ${detail}` : ''}`);
}
function warn(label, detail = '') {
  warnings += 1;
  console.log(`[WARN] ${label}${detail ? ` — ${detail}` : ''}`);
}
function fail(label, detail = '') {
  failures += 1;
  console.log(`[FAIL] ${label}${detail ? ` — ${detail}` : ''}`);
}
function run(binary, args) {
  return spawnSync(binary, args, { encoding: 'utf8', timeout: 15000, windowsHide: true });
}

const major = Number(process.versions.node.split('.')[0]);
if (major >= 20) ok('Node.js', process.version);
else fail('Node.js', `${process.version} — cần >= 20`);

const electronPath = path.join(ROOT, 'node_modules', 'electron', 'path.txt');
if (fs.existsSync(electronPath)) {
  const relative = fs.readFileSync(electronPath, 'utf8').trim();
  const executable = path.join(ROOT, 'node_modules', 'electron', 'dist', relative);
  if (fs.existsSync(executable)) ok('Electron', executable);
  else fail('Electron binary', `thiếu ${executable}. Chạy npm install lại.`);
} else {
  fail('Electron', 'chưa cài. Chạy npm install.');
}

for (const binary of ['ffmpeg', 'ffprobe']) {
  const result = run(binary, ['-version']);
  if (!result.error && result.status === 0) {
    ok(binary, String(result.stdout || '').split('\n')[0].slice(0, 80));
  } else {
    fail(binary, 'không chạy được. Cài ffmpeg full build và thêm vào PATH (hoặc đặt FFMPEG_PATH/FFPROBE_PATH).');
  }
}

const ruleFile = path.resolve(process.env.MUSE_RULE_FILE || path.join(ROOT, 'config', 'muse_rule.json'));
if (!fs.existsSync(ruleFile)) {
  fail('Muse config', `thiếu ${ruleFile}`);
} else {
  try {
    const rule = JSON.parse(fs.readFileSync(ruleFile, 'utf8'));
    if (rule.muse?.url) {
      ok('Muse URL', rule.muse.url);
      const login = rule.muse.login || {};
      if ((login.cookie_names || []).length || (login.logged_in_selectors || []).length || (login.logged_in_url_contains || []).length) {
        ok('Muse login check', 'đã cấu hình tín hiệu đăng nhập');
      } else {
        warn('Muse login check', 'chưa cấu hình cookie/selector — Muse sẽ luôn khóa (đúng thiết kế an toàn)');
      }
      if (rule.muse.bridge?.input_selector && rule.muse.bridge?.send_selector && rule.muse.bridge?.response_selector) {
        ok('Muse bridge', 'tự động');
      } else {
        warn('Muse bridge', 'chưa cấu hình selector — dùng copy/paste JSON');
      }
    } else {
      warn('Muse URL', 'chưa điền muse.url — Muse locked; có thể dùng plan mẫu để test UI');
    }
    if (rule.rule?.prompt) warn('Muse rule', 'rule.prompt đang có nội dung; phase này dự kiến để trống');
  } catch (error) {
    fail('Muse config JSON', error.message);
  }
}

const demoAssets = ['background/cozy_gameplay.mp4', 'audio/lofi_night.wav', 'audio/sfx_pop.wav', 'memes/dog_sideeye.png'];
for (const asset of demoAssets) {
  const file = path.join(ROOT, 'demo', 'assets', asset);
  if (!fs.existsSync(file)) fail('Demo asset', `thiếu ${asset}`);
}
if (!failures) ok('Demo assets', 'đủ file');

const dataDir = path.join(process.env.APPDATA || '', '3AM Diary Studio', 'data');
console.log(`\nData (dự kiến): ${process.env.APPDATA ? dataDir : '(Electron userData)/data'}`);
console.log('Chạy app: npm start');
console.log('Test: npm test && npm run test:e2e\n');

if (failures) {
  console.log(`Kết quả: ${failures} lỗi, ${warnings} cảnh báo.`);
  process.exitCode = 1;
} else {
  console.log(`Kết quả: sẵn sàng chạy demo (${warnings} cảnh báo).`);
}
