import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ELECTRON = require('electron');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const THREADS_URL =
  process.env.LIVE_THREADS_URL ||
  'https://www.threads.com/@faenight/post/Deit-l6FpQy/and-another-thing-keep-your-dogs-out-of-the-comments-of-posts-about-cats';
const OUT_DIR = path.join(ROOT, '.sample');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), '3am-live-prod-'));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

async function waitFor(fn, { timeout = 30000, interval = 300, label = 'condition' } = {}) {
  const deadline = Date.now() + timeout;
  let last = null;
  while (Date.now() < deadline) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) {
      last = error;
    }
    await sleep(interval);
  }
  throw new Error(`Timeout chờ ${label}${last ? `: ${last.message}` : ''}`);
}

let child = null;
let output = '';
try {
  await fsp.mkdir(OUT_DIR, { recursive: true });
  const dataDir = path.join(TMP, 'data');
  const userData = path.join(TMP, 'userdata');
  await fsp.mkdir(dataDir, { recursive: true });
  await fsp.mkdir(userData, { recursive: true });

  const debugPort = await freePort();
  child = spawn(ELECTRON, ['.', `--remote-debugging-port=${debugPort}`], {
    cwd: ROOT,
    env: { ...process.env, APP_USER_DATA_DIR: userData, APP_DATA_DIR: dataDir, E2E_TEST: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: false,
  });
  child.stdout.on('data', (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    output += chunk.toString();
  });

  const ready = await waitFor(
    () => {
      const match = output.match(/\[e2e\] app ready (\{.*\})/);
      return match ? JSON.parse(match[1]) : null;
    },
    { timeout: 30000, label: 'Electron ready' },
  );
  const token = new URL(ready.url).searchParams.get('token');
  const base = `http://127.0.0.1:${ready.port}`;
  const api = async (pathname, { method = 'GET', body } = {}) => {
    const response = await fetch(base + pathname, {
      method,
      headers: { 'X-App-Token': token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`${method} ${pathname}: ${data.error?.message || `HTTP ${response.status}`}`);
    return data;
  };

  const status = await api('/api/status');
  if (status.renderer?.production !== true) throw new Error('Renderer production chưa sẵn sàng.');

  await api('/api/demo/load', { method: 'POST' });
  console.log('[live] demo assets loaded');

  const scraped = await api('/api/threads/scrape', { method: 'POST', body: { url: THREADS_URL, mode: 'guest' } });
  const comments = scraped.result.comments || [];
  if (comments.length < 3) throw new Error(`Cần ít nhất 3 bình luận thật, chỉ lấy được ${comments.length}.`);
  const chosen = comments.slice(0, 3);
  console.log(`[live] scraped ${comments.length} comments; choose ${chosen.length}`);

  await api('/api/workspace/selection', { method: 'PUT', body: { ids: chosen.map((comment) => comment.comment_id) } });
  await api('/api/workspace/settings', {
    method: 'PUT',
    body: { voice: 'Giọng nữ kể chuyện (ấm, chậm)', voice_tts: process.env.LIVE_VOICE === '1', background_video_id: 'bg_demo_cozy', watermark: '@3am.diary.demo', target_duration: 60 },
  });

  const inputData = await api('/api/plan/input');
  if (!inputData.ready) throw new Error(`Input chưa sẵn sàng: ${JSON.stringify(inputData.errors)}`);

  const plan = {
    title: '3 giờ sáng: chó mèo và những bình luận không thể tin nổi',
    segments: chosen.map((comment, index) => ({
      comment_id: comment.comment_id,
      text: comment.text,
      meme_id: ['meme_demo_dog_shock_gif', 'meme_demo_cat_judge', 'meme_demo_dog_blanket'][index % 3],
      meme_duration: 2.3,
      sfx_id: ['sfx_demo_whoosh', 'sfx_demo_pop', 'sfx_demo_whoosh'][index % 3],
    })),
    music_id: 'music_demo_lofi',
    caption: 'Chó mèo lúc 3 giờ sáng.',
    hashtags: ['3am', 'dogcat'],
  };
  const imported = await api('/api/plan/import', { method: 'POST', body: { raw: JSON.stringify(plan), source: 'sample' } });
  await api('/api/plan/approve', { method: 'POST', body: { plan: imported.plan } });
  const created = await api('/api/jobs', { method: 'POST', body: {} });
  const jobId = created.job.id;
  console.log(`[live] job ${jobId} renderer=${created.job.renderer?.label || ''}`);

  const job = await waitFor(
    async () => {
      const data = await api('/api/jobs');
      const current = data.jobs.find((entry) => entry.id === jobId);
      if (!current) return null;
      if (current.status === 'error') throw new Error(`Render lỗi: ${current.error}`);
      if (current.status === 'done') return current;
      return null;
    },
    { timeout: 300000, interval: 2000, label: 'production render' },
  );

  if (!/Production/i.test(job.renderer?.label || job.renderer?.key || '')) {
    throw new Error(`Job không dùng renderer production: ${JSON.stringify(job.renderer)}`);
  }
  const screensDir = path.join(dataDir, 'screens', jobId);
  const screens = fs.existsSync(screensDir) ? fs.readdirSync(screensDir).filter((name) => /\.png$/i.test(name)) : [];
  if (screens.length < chosen.length + 1) {
    throw new Error(`Thiếu screenshot thật: có ${screens.length}, cần tối thiểu ${chosen.length + 1}.`);
  }
  const copyDir = path.join(OUT_DIR, 'live-prod-screens');
  await fsp.rm(copyDir, { recursive: true, force: true });
  await fsp.mkdir(copyDir, { recursive: true });
  for (const name of screens) await fsp.copyFile(path.join(screensDir, name), path.join(copyDir, name));

  const mp4Response = await fetch(`${base}/media/outputs/${encodeURIComponent(job.output_file)}?download=1`, {
    headers: { 'X-App-Token': token },
  });
  if (!mp4Response.ok) throw new Error(`Tải MP4 lỗi HTTP ${mp4Response.status}`);
  const mp4 = Buffer.from(await mp4Response.arrayBuffer());
  const outputFile = path.join(OUT_DIR, 'live-production-e2e.mp4');
  await fsp.writeFile(outputFile, mp4);

  const probe = spawnSync(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration:stream=width,height,r_frame_rate', '-of', 'json', outputFile],
    { encoding: 'utf8' },
  );
  if (probe.status !== 0) throw new Error(`ffprobe lỗi: ${probe.stderr}`);
  const meta = JSON.parse(probe.stdout);
  const video = meta.streams?.find((stream) => stream.width && stream.height);
  const duration = Number(meta.format?.duration || 0);
  if (video?.width !== 576 || video?.height !== 1024) throw new Error(`Sai kích thước: ${video?.width}x${video?.height}`);
  if (!(duration >= 60 && duration <= 90)) throw new Error(`Sai thời lượng: ${duration}`);

  console.log(
    JSON.stringify(
      {
        ok: true,
        jobId,
        jobStatus: job.status,
        renderer: job.renderer,
        screenshots: screens.length,
        screenshot_copy: copyDir,
        output: outputFile,
        bytes: mp4.length,
        width: video.width,
        height: video.height,
        fps: video.r_frame_rate,
        duration: Number(duration.toFixed(2)),
        comments: chosen.map((comment) => ({ author: comment.author, text: comment.text.slice(0, 60) })),
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error('[live] FAIL', error.message);
  console.error('[live] app log tail:', output ? output.slice(-2500) : '(none)');
  process.exitCode = 1;
} finally {
  if (child) {
    try {
      child.kill();
    } catch {}
    await sleep(1200);
  }
  await fsp.rm(TMP, { recursive: true, force: true }).catch(() => {});
}
