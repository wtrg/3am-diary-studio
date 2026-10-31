import assert from 'node:assert/strict';
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
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), '3am-e2e-'));
const ARTIFACTS = path.join(ROOT, 'artifacts', 'e2e');
const GATE = 'Cần đăng nhập tài khoản Muse kèm theo tool để tiếp tục. Không có tài khoản, tool không chạy.';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

async function waitFor(fn, { timeout = 20000, interval = 150, label = 'condition' } = {}) {
  const deadline = Date.now() + timeout;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await sleep(interval);
  }
  throw new Error(`Timeout chờ ${label}${lastError ? `: ${lastError.message}` : ''}`);
}

class Cdp {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.pending = new Map();
    this.nextId = 1;
    this.exceptions = [];
    this.consoleErrors = [];
    this.ready = new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result);
        return;
      }
      if (message.method === 'Runtime.exceptionThrown') {
        this.exceptions.push(message.params.exceptionDetails?.exception?.description || message.params.exceptionDetails?.text);
      }
      if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
        this.consoleErrors.push(message.params.args.map((arg) => arg.value || arg.description || '').join(' '));
      }
    });
  }

  async init() {
    await this.ready;
    await this.send('Runtime.enable');
    await this.send('Page.enable');
  }

  send(method, params = {}) {
    const id = this.nextId++;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, 180000);
    });
  }

  async eval(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Runtime exception');
    }
    return result.result?.value;
  }

  async screenshot(name) {
    await fsp.mkdir(ARTIFACTS, { recursive: true });
    const image = await this.send('Page.captureScreenshot', { format: 'png' });
    const file = path.join(ARTIFACTS, name);
    await fsp.writeFile(file, Buffer.from(image.data, 'base64'));
    console.log(`[shot] ${file}`);
    return file;
  }

  close() {
    try {
      this.socket.close();
    } catch {}
  }
}

async function stopProcess(child) {
  if (!child || child.killed) return;
  try {
    child.kill();
  } catch {}
  await sleep(600);
}

let electronProcess = null;
let portalProcess = null;
let cdp = null;

try {
  await fsp.mkdir(ARTIFACTS, { recursive: true });
  const dataDir = path.join(TMP, 'data');
  const userData = path.join(TMP, 'userdata');
  await fsp.mkdir(dataDir, { recursive: true });
  await fsp.mkdir(userData, { recursive: true });

  const portalPort = await freePort();
  const debugPort = await freePort();
  const configFile = path.join(TMP, 'muse_rule.test.json');
  const portalUrl = `http://127.0.0.1:${portalPort}/`;
  // Start from an empty slot so the E2E exercises in-app Muse setup + real login window.
  await fsp.writeFile(
    configFile,
    JSON.stringify(
      {
        version: 1,
        muse: {
          name: 'Muse',
          url: '',
          login: {
            logged_in_url_contains: [],
            logged_out_url_contains: [],
            logged_in_selectors: [],
            logged_out_selectors: [],
            cookie_names: [],
          },
          bridge: {
            mode: 'manual',
            new_chat_url: '',
            input_selector: '',
            send_selector: '',
            response_selector: '',
            wait_timeout_ms: 180000,
          },
        },
        rule: { prompt: '', version: 0 },
        test_options: { enable_sample_plan: true },
      },
      null,
      2,
    ),
  );

  portalProcess = spawn(process.execPath, [path.join(ROOT, 'tests', 'muse-portal', 'server.js')], {
    cwd: ROOT,
    env: { ...process.env, MUSE_PORTAL_PORT: String(portalPort) },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  portalProcess.stderr.on('data', (chunk) => process.stderr.write(`[portal] ${chunk}`));
  await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${portalPort}/health`);
    return response.ok;
  }, { label: 'Muse test portal' });

  let appLog = '';
  electronProcess = spawn(ELECTRON, ['.', `--remote-debugging-port=${debugPort}`], {
    cwd: ROOT,
    env: {
      ...process.env,
      APP_USER_DATA_DIR: userData,
      APP_DATA_DIR: dataDir,
      MUSE_RULE_FILE: configFile,
      E2E_TEST: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: false,
  });
  let resolveReady;
  const readyPromise = new Promise((resolve) => {
    resolveReady = resolve;
  });
  electronProcess.stdout.on('data', (chunk) => {
    const text = chunk.toString();
    appLog += text;
    if (text.includes('[e2e] app ready')) {
      const line = text.split('[e2e] app ready')[1].trim();
      try {
        resolveReady(JSON.parse(line));
      } catch {
        resolveReady({});
      }
    }
  });
  electronProcess.stderr.on('data', (chunk) => {
    appLog += chunk.toString();
  });

  const appInfo = await Promise.race([
    readyPromise,
    waitFor(() => null, { timeout: 20000, label: 'Electron ready' }).catch(() => null),
  ]);
  if (!appInfo || !appInfo.port) {
    throw new Error(`Electron không khởi động: ${appLog.slice(-3000)}`);
  }
  const token = new URL(appInfo.url).searchParams.get('token');
  const base = `http://127.0.0.1:${appInfo.port}`;
  const apiGet = async (pathname) => {
    const response = await fetch(base + pathname, { headers: { 'X-App-Token': token } });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || `HTTP ${response.status}`);
    return data;
  };

  const target = await waitFor(async () => {
    const list = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((response) => response.json());
    return list.find((entry) => entry.type === 'page' && entry.title === '3AM Diary Studio');
  }, { label: 'DevTools page target' });

  cdp = new Cdp(target.webSocketDebuggerUrl);
  await cdp.init();

  await waitFor(() => cdp.eval(`!document.getElementById('app')?.hidden`), { label: 'app UI' });

  // 1. Login gate blocks everything Muse related.
  const gateState = await cdp.eval(`(() => ({
    banner: document.querySelector('.banner-gate')?.innerText || '',
    buttons: [...document.querySelectorAll('[data-muse-action]')].map((button) => ({ action: button.dataset.museAction, disabled: button.disabled }))
  }))()`);
  assert.ok(gateState.banner.includes(GATE), 'exact Muse gate message is visible in the global banner');
  assert.ok(gateState.buttons.every((button) => button.disabled), 'Muse actions are disabled before login');
  await cdp.screenshot('01-gate-locked.png');

  // 1b. In-app Muse setup: empty slot -> URL + bridge selectors saved by UI.
  await cdp.eval(`document.querySelector('[data-action="config-muse"]').click()`);
  await waitFor(() => cdp.eval(`Boolean(document.querySelector('form[data-form="muse-config"]'))`), { label: 'Muse config modal' });
  await cdp.screenshot('01b-muse-config.png');
  await cdp.eval(`(() => {
    const form = document.querySelector('form[data-form="muse-config"]');
    form.querySelector('[name="url"]').value = ${JSON.stringify(portalUrl)};
    form.querySelector('[name="bridge_mode"]').value = 'auto';
    form.querySelector('[name="bridge_input_selector"]').value = '#muse-input';
    form.querySelector('[name="bridge_send_selector"]').value = '#muse-send';
    form.querySelector('[name="bridge_response_selector"]').value = '#muse-response';
    form.querySelector('[name="bridge_wait_timeout_ms"]').value = '20000';
    form.requestSubmit();
    return true;
  })()`);
  await waitFor(() => cdp.eval(`!document.querySelector('form[data-form="muse-config"]') && document.getElementById('museChip')?.textContent.includes('chưa đăng nhập')`), { label: 'Muse config saved' });
  const configuredStatus = await apiGet('/api/muse/status');
  assert.equal(configuredStatus.configured, true, 'Muse URL is configured through the UI');
  assert.equal(configuredStatus.loginCheckConfigured, false, 'login signal is not invented before measuring');
  assert.equal(configuredStatus.url, portalUrl);

  // Open the real login window BEFORE logging in so the tool captures a
  // logged-out baseline and can distinguish new login cookies.
  await cdp.eval(`document.querySelector('[data-action="open-muse-login"]').click()`);
  await sleep(2600);

  // 2. Demo load and input readiness.
  await cdp.eval(`document.querySelector('.sidebar [data-action="demo-load"]').click()`);
  await waitFor(() => cdp.eval(`document.querySelectorAll('.comment-row').length === 5`), { label: 'demo comments' });
  await cdp.eval(`document.querySelector('.step-nav [data-action="go-step"][data-step="3"]').click()`);
  await waitFor(() => cdp.eval(`document.querySelector('#inputPanel .badge')?.textContent.includes('SẴN SÀNG')`), { label: 'input ready' });
  assert.equal((await apiGet('/api/plan/input')).ready, true);
  await waitFor(
    () =>
      cdp.eval(`(() => { try { return document.querySelector('webview')?.getURL() === ${JSON.stringify(portalUrl)}; } catch { return false; } })()`),
    { label: 'embedded Muse webview loaded' },
  );
  const moduleGate = await cdp.eval(`(() => ({
    card: document.querySelector('.gate-message')?.textContent,
    buttons: [...document.querySelectorAll('[data-muse-action]')].map((button) => ({ action: button.dataset.museAction, disabled: button.disabled })),
    webviewUrl: (() => { try { return document.querySelector('webview').getURL(); } catch { return ''; } })()
  }))()`);
  assert.equal(moduleGate.card, GATE, 'exact Muse gate message is repeated in Module 3');
  assert.ok(moduleGate.buttons.every((button) => button.disabled), 'Muse actions remain disabled before login');
  assert.equal(moduleGate.webviewUrl, portalUrl, 'embedded webview loads the configured Muse URL');
  await cdp.screenshot('02-input-ready.png');

  // 3. Invalid plan must be blocked with all required error codes and must not create a plan.
  await cdp.eval(`document.querySelector('[data-action="import-invalid-sample"]').click()`);
  await waitFor(() => cdp.eval(`Boolean(document.querySelector('#planValidationErrors'))`), { label: 'validation errors' });
  const invalidState = await cdp.eval(`(() => ({
    codes: [...document.querySelectorAll('#planValidationErrors code')].map((el) => el.textContent.trim()).filter(Boolean),
    planEditor: Boolean(document.getElementById('planEditor')),
    banner: document.querySelector('.banner-offline')?.innerText.slice(0, 300)
  }))()`);
  for (const code of ['UNKNOWN_MEME_ID', 'UNKNOWN_MUSIC_ID', 'UNKNOWN_SFX_ID', 'TEXT_MISMATCH']) {
    assert.ok(invalidState.codes.some((entry) => entry.includes(code)), `validation code ${code}`);
  }
  assert.equal(invalidState.planEditor, false, 'invalid plan is not displayed');
  const workspaceAfterInvalid = await apiGet('/api/workspace');
  assert.equal(workspaceAfterInvalid.workspace.draft_plan, null, 'invalid plan is not stored');
  await cdp.screenshot('03-invalid-plan-blocked.png');

  // 4. Login via the embedded browser, then measure the real login window's cookies
  //    through the UI; server verification unlocks Muse actions.
  const loggedInInsideFrame = await cdp.eval(`(async () => {
    const webview = document.querySelector('webview');
    return webview.executeJavaScript("(() => { const button = document.querySelector('#muse-login'); if (!button) return 'already'; button.click(); return 'clicked'; })()");
  })()`);
  assert.ok(['clicked', 'already'].includes(loggedInInsideFrame));
  await sleep(1200);
  await cdp.eval(`document.querySelector('[data-action="config-muse"]').click()`);
  await waitFor(() => cdp.eval(`Boolean(document.querySelector('form[data-form="muse-config"]'))`), { label: 'Muse config modal for measurement' });
  await cdp.eval(`document.querySelector('[data-action="measure-muse-session"]').click()`);
  await waitFor(() => cdp.eval(`document.querySelectorAll('[data-muse-cookie]').length > 0`), { timeout: 40000, label: 'Muse login window cookie measurement' });
  const measuredCookies = await cdp.eval(`(() => ({
    all: [...document.querySelectorAll('[data-muse-cookie]')].map((input) => input.value),
    checked: [...document.querySelectorAll('[data-muse-cookie]:checked')].map((input) => input.value),
    note: document.getElementById('museMeasureResult')?.innerText || ''
  }))()`);
  assert.ok(measuredCookies.all.includes('muse_test_session'), 'login window measurement reads the real session cookie name');
  assert.ok(measuredCookies.checked.includes('muse_test_session'), 'new login cookie is preselected as login signal');
  assert.match(measuredCookies.note, /baseline đăng xuất/i, 'measurement reports the logged-out baseline');
  await cdp.screenshot('04a-muse-session-measured.png');
  await cdp.eval(`document.querySelector('[data-action="apply-muse-measurement"]').click()`);
  await waitFor(() => cdp.eval(`document.getElementById('museChip')?.textContent.includes('đã đăng nhập')`), { label: 'Muse login verification after measurement' });
  const measuredLoginStatus = await apiGet('/api/muse/status');
  assert.equal(measuredLoginStatus.loginCheckConfigured, true, 'measured cookie is saved as login signal');
  assert.equal(measuredLoginStatus.loggedIn, true, 'Muse gate unlocks from the measured session');
  await cdp.eval(`document.querySelector('[data-action="verify-muse"]').click()`);
  const unlockedState = await cdp.eval(`[...document.querySelectorAll('[data-muse-action]')].map((button) => ({ action: button.dataset.museAction, disabled: button.disabled }))`);
  assert.ok(unlockedState.every((button) => button.disabled === false), 'Muse actions unlock after verified login');
  await cdp.screenshot('04-muse-unlocked.png');

  // 5. Auto bridge returns a valid plan.
  await cdp.eval(`document.querySelector('[data-action="bridge-send"]').click()`);
  await waitFor(() => cdp.eval(`Boolean(document.getElementById('planEditor'))`), { timeout: 30000, label: 'Muse bridge plan' });
  const bridgeState = await cdp.eval(`(() => ({
    source: document.querySelector('#planEditor .plan-badges')?.innerText,
    title: document.getElementById('planTitle')?.value,
    errors: document.querySelector('#planValidationErrors')?.innerText || null
  }))()`);
  assert.match(bridgeState.source, /MUSE/, 'plan source is Muse');
  assert.equal(bridgeState.errors, null);
  assert.ok(bridgeState.title.length > 5);
  await cdp.screenshot('05-muse-plan.png');

  // 6. Manual edit + reorder, then approve; verify server state matches.
  const editResult = await cdp.eval(`(async () => {
    const title = document.getElementById('planTitle');
    title.value = 'Tiêu đề E2E đã sửa tay';
    title.dispatchEvent(new Event('input', { bubbles: true }));
    const meme = document.querySelector('[data-segment-field="meme_id"][data-segment-index="0"]');
    meme.value = 'meme_demo_dog_blanket';
    meme.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('[data-action="plan-move-down"][data-index="0"]').click();
    await new Promise((resolve) => setTimeout(resolve, 300));
    document.querySelector('[data-action="approve-plan"]').click();
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return {
      queueDisabled: document.getElementById('planQueueButton')?.disabled,
      badges: document.querySelector('#planEditor .plan-badges')?.innerText
    };
  })()`);
  const workspaceApproved = await apiGet('/api/workspace');
  assert.equal(editResult.queueDisabled, false, 'queue is allowed only after approval');
  assert.match(editResult.badges, /ĐÃ DUYỆT/);
  assert.equal(workspaceApproved.workspace.approved_plan.title, 'Tiêu đề E2E đã sửa tay');
  assert.equal(workspaceApproved.workspace.approved_plan.segments[0].comment_id, 'demo_c2', 'segment reorder persisted');
  assert.equal(workspaceApproved.workspace.approved_plan.segments[1].comment_id, 'demo_c1');
  assert.equal(workspaceApproved.workspace.approved_plan.segments[1].meme_id, 'meme_demo_dog_blanket', 'meme edit persisted');
  await cdp.screenshot('06-approved.png');

  // 7. Queue and real MP4 export.
  await cdp.eval(`document.querySelector('.step-nav [data-action="go-step"][data-step="4"]').click()`);
  await waitFor(() => cdp.eval(`!document.querySelector('[data-action="add-job"]')?.disabled`), { label: 'add job enabled' });
  await cdp.eval(`document.querySelector('[data-action="add-job"]').click()`);
  const doneJob = await waitFor(async () => {
    const data = await apiGet('/api/jobs');
    const job = data.jobs[0];
    if (job.status === 'error') throw new Error(`Render lỗi: ${job.error}`);
    if (job.status === 'done') return job;
    return null;
  }, { timeout: 170000, interval: 1500, label: 'MP4 render done' });
  assert.equal(doneJob.plan.title, 'Tiêu đề E2E đã sửa tay');
  assert.equal(doneJob.plan.segments[0].comment_id, 'demo_c2');
  assert.ok(doneJob.output_bytes > 100000, 'MP4 has content');

  const download = await fetch(`${base}${doneJob.download_url}&token=${token}`);
  assert.equal(download.status, 200, 'MP4 download responds');
  const downloadBytes = Buffer.from(await download.arrayBuffer());
  assert.ok(downloadBytes.length > 100000);
  const finalMp4 = path.join(ARTIFACTS, 'demo-final.mp4');
  await fsp.writeFile(finalMp4, downloadBytes);
  const probe = spawnSync('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration:stream=width,height,r_frame_rate', '-of', 'json', finalMp4,
  ], { encoding: 'utf8' });
  if (probe.status === 0) {
    const info = JSON.parse(probe.stdout);
    assert.equal(info.streams[0].width, 576);
    assert.equal(info.streams[0].height, 1024);
    assert.match(info.streams[0].r_frame_rate, /^30\//);
    assert.ok(Math.abs(Number(info.format.duration) - 60) < 0.2);
  }
  await cdp.eval(`document.querySelector('.step-nav [data-action="go-step"][data-step="4"]').click()`);
  await sleep(900);
  await cdp.screenshot('07-job-done.png');
  console.log('[e2e] PASS', JSON.stringify({ jobId: doneJob.id, bytes: downloadBytes.length, artifacts: ARTIFACTS }, null, 2));
  if (cdp.exceptions.length) console.log('Runtime exceptions:', cdp.exceptions);
  if (cdp.consoleErrors.length) console.log('Console errors:', cdp.consoleErrors);
} catch (error) {
  console.error('[e2e] FAIL', error.stack || error.message);
  if (cdp) {
    try {
      await cdp.screenshot('failure.png');
      console.error((await cdp.eval(`document.getElementById('view')?.innerText.slice(0, 4000)`)) || '');
    } catch {}
  }
  process.exitCode = 1;
} finally {
  try {
    if (cdp) {
      await cdp.eval(`window.desktop?.quit?.()`).catch(() => {});
    }
  } catch {}
  await stopProcess(electronProcess);
  await stopProcess(portalProcess);
  try {
    cdp?.close();
  } catch {}
  console.log(`[e2e] temp data: ${TMP}`);
}
