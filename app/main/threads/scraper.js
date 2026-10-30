'use strict';

const { BrowserWindow, session } = require('electron');
const { parseThreadsUrl, collectFromPayloads, safeParseJson, payloadsFromPageScripts } = require('./parse');

const PARTITION = 'persist:threads';
const GUEST_PARTITION = 'threads_guest';
const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36';

function normalizeMode(mode) {
  return mode === 'guest' ? 'guest' : 'account';
}

function partitionForMode(mode) {
  return normalizeMode(mode) === 'guest' ? GUEST_PARTITION : PARTITION;
}

function threadsSession() {
  const ses = session.fromPartition(PARTITION);
  ses.setUserAgent(CHROME_UA, 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7');
  return ses;
}

function threadsSessionForMode(mode) {
  const ses = session.fromPartition(partitionForMode(mode));
  ses.setUserAgent(CHROME_UA, 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7');
  return ses;
}

async function threadsLoginState() {
  const ses = threadsSession();
  let cookies = [];
  try {
    cookies = await ses.cookies.get({ domain: '.threads.com' });
    const instagram = await ses.cookies.get({ domain: '.instagram.com' });
    cookies = cookies.concat(instagram);
  } catch {
    return { loggedIn: false, checked: false };
  }
  const names = new Set(cookies.map((cookie) => cookie.name));
  const loggedIn = names.has('sessionid') || names.has('sessionid_threads') || names.has('ds_user_id');
  return {
    loggedIn,
    checked: true,
    cookies: cookies.map((cookie) => cookie.name).filter((name) => /session|user/i.test(name)),
  };
}

function openThreadsLoginWindow(parent) {
  const ses = threadsSession();
  const win = new BrowserWindow({
    width: 1120,
    height: 820,
    parent: parent || undefined,
    modal: false,
    show: true,
    title: 'Đăng nhập Threads để cào bình luận',
    backgroundColor: '#0b1020',
    webPreferences: {
      partition: PARTITION,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadURL('https://www.threads.com/login');
  return { opened: true };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label || 'thao tác'} quá thời gian`)), ms)),
  ]);
}

const EXPAND_SCRIPT = `
(() => {
  const patterns = [
    /xem thêm bình luận/i, /xem thêm câu trả lời/i, /xem các câu trả lời/i,
    /xem thêm phản hồi/i, /view more comments/i, /view more replies/i,
    /view all comments/i, /see more comments/i, /load more comments/i,
    /more replies/i, /view \\d+ replies/i, /xem \\d+ phản hồi/i
  ];
  const isVisible = (el) => {
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  const candidates = Array.from(document.querySelectorAll('div[role="button"], button, span[dir="auto"], a[role="link"]'));
  let clicked = 0;
  for (const el of candidates) {
    const label = (el.innerText || el.textContent || '').trim();
    if (!label || label.length > 120) continue;
    if (!patterns.some((pattern) => pattern.test(label))) continue;
    if (!isVisible(el)) continue;
    try {
      el.click();
      clicked += 1;
    } catch {}
    if (clicked >= 12) break;
  }
  return clicked;
})()
`;

const SCROLL_SCRIPT = `
(() => {
  const amount = Math.max(window.innerHeight * 0.9, 700);
  window.scrollBy(0, amount);
  const containers = Array.from(document.querySelectorAll('div')).filter((el) => {
    const style = getComputedStyle(el);
    return /(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 200;
  });
  for (const el of containers.slice(0, 4)) el.scrollBy(0, amount);
  return window.scrollY;
})()
`;

function isLoginWallUrl(url) {
  try {
    const parsed = new URL(url);
    return /login|accounts\.instagram\.com|challenge/i.test(parsed.pathname + parsed.search);
  } catch {
    return false;
  }
}

async function scrapeThreads(rawUrl, options = {}) {
  const parsed = parseThreadsUrl(rawUrl);
  const mode = normalizeMode(options.mode);
  const log = options.log || (() => {});
  const timeoutMs = options.timeoutMs || 45000;
  const deadline = Date.now() + timeoutMs;
  const scrollRounds = options.scrollRounds ?? 8;
  const payloads = [];
  const scriptTexts = new Set();
  const watchers = [];
  let win = null;
  let debuggerAttached = false;
  let timedOut = false;
  let networkEnable = null;

  const ses = threadsSessionForMode(mode);
  const partition = partitionForMode(mode);
  const timer = setTimeout(() => {
    timedOut = true;
    try {
      if (win && !win.isDestroyed()) {
        win.webContents.stop();
        win.destroy();
      }
    } catch {}
  }, timeoutMs);

  try {
    win = new BrowserWindow({
      width: 1280,
      height: 960,
      show: false,
      skipTaskbar: true,
      backgroundColor: '#0b1020',
      webPreferences: {
        partition,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        javascript: true,
        images: false,
        backgroundThrottling: false,
        spellcheck: false,
      },
    });
    win.setMenuBarVisibility(false);
    const wc = win.webContents;
    wc.setUserAgent(CHROME_UA);

    try {
      wc.debugger.attach('1.3');
      debuggerAttached = true;
    } catch (error) {
      log(`Không gắn được debugger: ${error.message}`);
    }

    if (debuggerAttached) {
      const pending = new Set();
      // Gửi Network.enable song song với loadURL; một số bản Electron treo
      // sendCommand trước khi có navigation nên tuyệt đối không await trước load.
      networkEnable = wc.debugger
        .sendCommand('Network.enable', { maxTotalBufferSize: 200 * 1024 * 1024 })
        .catch((error) => {
          log(`Network.enable lỗi: ${error.message}`);
          return null;
        });
      const onResponse = (_event, method, params) => {
        if (method !== 'Network.responseReceived') return;
        const type = params.type;
        const url = params.response?.url || '';
        if (!/graphql|\/api\//i.test(url)) return;
        if (!['XHR', 'Fetch', 'Script', 'Other'].includes(type)) return;
        pending.add(params.requestId);
      };
      const onFinished = async (_event, method, params) => {
        if (method !== 'Network.loadingFinished') return;
        if (!pending.has(params.requestId)) return;
        pending.delete(params.requestId);
        try {
          const body = await withTimeout(
            wc.debugger.sendCommand('Network.getResponseBody', { requestId: params.requestId }),
            3000,
            'Network.getResponseBody',
          );
          if (!body || !body.body) return;
          const text = body.base64Encoded ? Buffer.from(body.body, 'base64').toString('utf8') : body.body;
          const json = safeParseJson(text);
          if (json) payloads.push({ url: 'network:graphql', json, at: Date.now() });
        } catch {}
      };
      const onDetach = () => {
        log('Debugger đã detach.');
      };
      wc.debugger.on('message', onResponse);
      wc.debugger.on('message', onFinished);
      wc.debugger.on('detach', onDetach);
      watchers.push(() => {
        wc.debugger.removeListener('message', onResponse);
        wc.debugger.removeListener('message', onFinished);
        wc.debugger.removeListener('detach', onDetach);
      });
    }

    const loadPromise = new Promise((resolve) => {
      wc.once('did-finish-load', resolve);
      wc.once('did-fail-load', (_e, code, description) => {
        log(`Tải trang thất bại: ${code} ${description}`);
        resolve();
      });
    });
    wc.loadURL(parsed.originalUrl).catch(() => {});
    await Promise.race([loadPromise, delay(Math.max(1000, deadline - Date.now()))]);
    if (timedOut || Date.now() >= deadline) {
      return { ok: false, code: 'TIMEOUT', message: 'Threads tải quá lâu. Kiểm tra wifi rồi thử lại.' };
    }
    if (debuggerAttached && networkEnable) {
      await withTimeout(networkEnable, 2500, 'Network.enable').catch((error) => log(error.message));
    }
    await delay(1800);
    if (Date.now() >= deadline) {
      return { ok: false, code: 'TIMEOUT', message: 'Threads tải quá lâu. Kiểm tra wifi rồi thử lại.' };
    }

    const currentUrl = wc.getURL();
    if (isLoginWallUrl(currentUrl)) {
      return {
        ok: false,
        code: 'LOGIN_REQUIRED',
        message: 'Threads yêu cầu đăng nhập để xem bài và bình luận. Hãy đăng nhập Threads trong tool rồi cào lại.',
      };
    }

    for (let round = 0; round < scrollRounds; round += 1) {
      if (win.isDestroyed()) break;
      if (Date.now() >= deadline) break;
      try {
        await withTimeout(wc.executeJavaScript(EXPAND_SCRIPT, true), 5000, 'Mở rộng bình luận');
        await withTimeout(wc.executeJavaScript(SCROLL_SCRIPT, true), 4000, 'Cuộn trang');
      } catch (error) {
        log(`Tương tác trang: ${error.message}`);
      }
      await delay(round < 2 ? 1100 : 650);
    }

    if (Date.now() >= deadline) {
      return { ok: false, code: 'TIMEOUT', message: 'Threads tải quá lâu. Kiểm tra wifi rồi thử lại.' };
    }

    try {
      const afterUrl = wc.getURL();
      if (isLoginWallUrl(afterUrl)) {
        return {
          ok: false,
          code: 'LOGIN_REQUIRED',
          message: 'Threads yêu cầu đăng nhập để xem bài và bình luận. Hãy đăng nhập Threads trong tool rồi cào lại.',
        };
      }
      const texts = await withTimeout(
        wc.executeJavaScript(
          `Array.from(document.querySelectorAll('script[type="application/json"]')).map((s) => s.textContent).filter(Boolean)`,
          true,
        ),
        5000,
        'Đọc JSON trang',
      );
      for (const text of texts || []) scriptTexts.add(text);
    } catch (error) {
      log(`Không đọc được JSON nhúng trong trang: ${error.message}`);
    }

    await delay(500);
    const embedded = payloadsFromPageScripts([...scriptTexts]);
    const allPayloads = [...embedded, ...payloads];
    log(`Payloads: ${allPayloads.length}`);
    if (options.debugDump && allPayloads.length) {
      const fs = require('node:fs');
      const path = require('node:path');
      const file = path.join(options.debugDump, `threads-${Date.now()}.json`);
      fs.mkdirSync(options.debugDump, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(allPayloads, null, 2));
      log(`Đã lưu payload debug: ${file}`);
    }

    if (!allPayloads.length) {
      return {
        ok: false,
        code: 'NO_PAYLOAD',
        message:
          'Không nhận được dữ liệu bài Threads. Có thể bạn chưa đăng nhập Threads, bài bị hạn chế, hoặc Threads đổi cách tải dữ liệu.',
      };
    }

    const result = collectFromPayloads(allPayloads, parsed.originalUrl, { requireReplySignal: false });
    if (!result.ok) {
      return {
        ok: false,
        code: result.code || 'NO_POST_DATA',
        message: result.message || 'Không đọc được bài Threads.',
      };
    }
    return {
      ...result,
      source: 'live_threads',
      scraped_at: new Date().toISOString(),
    };
  } catch (error) {
    if (timedOut) {
      return { ok: false, code: 'TIMEOUT', message: 'Threads tải quá lâu. Kiểm tra wifi rồi thử lại.' };
    }
    return {
      ok: false,
      code: 'SCRAPE_ERROR',
      message: `Không cào được Threads: ${error.message}`,
    };
  } finally {
    clearTimeout(timer);
    for (const stop of watchers) {
      try {
        stop();
      } catch {}
    }
    if (win && !win.isDestroyed()) {
      try {
        const contents = win.webContents;
        if (debuggerAttached && contents?.debugger?.isAttached()) contents.debugger.detach();
      } catch {}
      try {
        win.destroy();
      } catch {}
    }
    log('Đóng cửa sổ cào Threads.');
    try {
      ses.setUserAgent(CHROME_UA);
    } catch {}
  }
}

module.exports = {
  PARTITION,
  GUEST_PARTITION,
  CHROME_UA,
  normalizeMode,
  partitionForMode,
  threadsSession,
  threadsSessionForMode,
  threadsLoginState,
  openThreadsLoginWindow,
  scrapeThreads,
  isLoginWallUrl,
  delay,
  withTimeout,
};
