'use strict';

const { BrowserWindow } = require('electron');
const { collectRawPosts, payloadsFromPageScripts, safeParseJson } = require('./parse');
const { buildCandidates, buildSearchUrl } = require('./discovery');
const {
  CHROME_UA,
  normalizeMode,
  partitionForMode,
  threadsSessionForMode,
  threadsLoginState,
  isLoginWallUrl,
  delay,
  withTimeout,
} = require('./scraper');

const SCROLL_SEARCH_SCRIPT = `
(() => {
  const amount = Math.max(window.innerHeight * 0.95, 800);
  window.scrollBy(0, amount);
  const containers = Array.from(document.querySelectorAll('div')).filter((el) => {
    const style = getComputedStyle(el);
    return /(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 200;
  });
  for (const el of containers.slice(0, 5)) el.scrollBy(0, amount);
  return window.scrollY;
})()
`;

async function discoverThreads(options = {}) {
  const topic = String(options.topic || '').trim().slice(0, 120);
  if (topic.length < 2) {
    return { ok: false, code: 'INVALID_TOPIC', message: 'Chủ đề cần có ít nhất 2 ký tự.' };
  }
  const limit = Math.max(1, Math.min(20, Number(options.limit) || 5));
  const maxAgeHours = Math.max(1, Math.min(24 * 30, Number(options.maxAgeHours) || 72));
  const sort = options.sort === 'recent' ? 'recent' : 'trend';
  const mode = normalizeMode(options.mode);
  const log = options.log || (() => {});
  const timeoutMs = options.timeoutMs || 40000;
  const deadline = Date.now() + timeoutMs;
  const searchUrl = buildSearchUrl(topic, sort);

  if (mode === 'account') {
    const sessionState = await threadsLoginState();
    if (!sessionState.loggedIn) {
      return {
        ok: false,
        code: 'THREADS_LOGIN_REQUIRED',
        loginRequired: true,
        message:
          'Chế độ Tài khoản Threads cần đăng nhập Threads trước khi tìm bài. Hãy đăng nhập Threads hoặc chọn chế độ Ẩn danh.',
      };
    }
  }

  const partition = partitionForMode(mode);
  const ses = threadsSessionForMode(mode);
  const payloads = [];
  const scriptTexts = new Set();
  const watchers = [];
  let win = null;
  let debuggerAttached = false;
  let timedOut = false;
  let networkEnable = null;

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
          if (json) payloads.push({ url: 'network:search', json, at: Date.now() });
        } catch {}
      };
      const onDetach = () => log('Debugger discovery đã detach.');
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
        log(`Tải search thất bại: ${code} ${description}`);
        resolve();
      });
    });
    wc.loadURL(searchUrl).catch(() => {});
    await Promise.race([loadPromise, delay(Math.max(1000, deadline - Date.now()))]);
    if (timedOut || Date.now() >= deadline) {
      return { ok: false, code: 'TIMEOUT', message: 'Threads tìm kiếm quá lâu. Kiểm tra wifi rồi thử lại.' };
    }
    if (debuggerAttached && networkEnable) {
      await withTimeout(networkEnable, 2500, 'Network.enable').catch((error) => log(error.message));
    }
    await delay(1900);
    if (Date.now() >= deadline) {
      return { ok: false, code: 'TIMEOUT', message: 'Threads tìm kiếm quá lâu. Kiểm tra wifi rồi thử lại.' };
    }

    if (isLoginWallUrl(wc.getURL())) {
      return {
        ok: false,
        code: 'THREADS_LOGIN_REQUIRED',
        loginRequired: true,
        message:
          'Threads chuyển sang trang đăng nhập khi tìm kiếm. Hãy đăng nhập Threads hoặc thử lại ở chế độ Ẩn danh.',
      };
    }

    for (let round = 0; round < 7; round += 1) {
      if (win.isDestroyed() || Date.now() >= deadline) break;
      try {
        await withTimeout(wc.executeJavaScript(SCROLL_SEARCH_SCRIPT, true), 4500, 'Cuộn search');
      } catch (error) {
        log(`Cuộn search: ${error.message}`);
      }
      await delay(round < 2 ? 1000 : 750);
    }

    let pageInfo = { loginLimited: false, title: '', url: '' };
    try {
      pageInfo = await withTimeout(
        wc.executeJavaScript(
          `(() => ({
            loginLimited: /Log in for more|Log in to see more|Đăng nhập để xem thêm/i.test(document.body.innerText),
            title: document.title || '',
            url: location.href
          }))()`,
          true,
        ),
        4000,
        'Đọc trạng thái search',
      );
      const texts = await withTimeout(
        wc.executeJavaScript(
          `Array.from(document.querySelectorAll('script[type="application/json"]')).map((s) => s.textContent).filter(Boolean)`,
          true,
        ),
        5000,
        'Đọc JSON search',
      );
      for (const text of texts || []) scriptTexts.add(text);
    } catch (error) {
      log(`Không đọc được trạng thái trang search: ${error.message}`);
    }

    if (Date.now() >= deadline) {
      return { ok: false, code: 'TIMEOUT', message: 'Threads tìm kiếm quá lâu. Kiểm tra wifi rồi thử lại.' };
    }

    const embedded = payloadsFromPageScripts([...scriptTexts]);
    const allPayloads = [...embedded, ...payloads];
    log(`Search payloads: ${allPayloads.length}`);

    if (options.debugDump && allPayloads.length) {
      const fs = require('node:fs');
      const path = require('node:path');
      const file = path.join(options.debugDump, `threads-search-${Date.now()}.json`);
      fs.mkdirSync(options.debugDump, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(allPayloads, null, 2));
      log(`Đã lưu payload search debug: ${file}`);
    }

    if (!allPayloads.length) {
      return {
        ok: false,
        code: 'NO_PAYLOAD',
        message:
          'Threads không trả dữ liệu tìm kiếm. Có thể do chưa đăng nhập, khu vực bị hạn chế, hoặc Threads đổi cấu trúc. Không có dữ liệu nào được tạo thêm.',
      };
    }

    const rawPosts = collectRawPosts(allPayloads);
    const built = buildCandidates(rawPosts, {
      topic,
      limit,
      maxAgeHours,
      sort,
      now: Date.now(),
      requireSearchPath: true,
    });
    const warnings = built.warnings.slice();
    if (pageInfo.loginLimited) {
      warnings.unshift(
        mode === 'guest'
          ? 'Threads đang giới hạn kết quả khi chưa đăng nhập. Chọn chế độ Tài khoản Threads để lấy thêm bài và bình luận.'
          : 'Threads hiển thị giới hạn kết quả cho phiên hiện tại; thử từ khóa khác hoặc kiểm tra lại đăng nhập.',
      );
    }
    if (mode === 'guest' && built.found < limit) {
      warnings.push('Ẩn danh chỉ đọc nội dung công khai. Đăng nhập Threads để tìm được nhiều bài mới hơn.');
    }

    return {
      ok: true,
      candidates: built.candidates,
      warnings: [...new Set(warnings)],
      stats: built.stats,
      tokens: built.tokens,
      requested: limit,
      found: built.found,
      meta: {
        topic,
        mode,
        limit,
        maxAgeHours,
        sort,
        searchUrl,
        loginLimited: Boolean(pageInfo.loginLimited),
        payloads: allPayloads.length,
        rawPosts: rawPosts.length,
        searchedAt: new Date().toISOString(),
      },
    };
  } catch (error) {
    if (timedOut) {
      return { ok: false, code: 'TIMEOUT', message: 'Threads tìm kiếm quá lâu. Kiểm tra wifi rồi thử lại.' };
    }
    return {
      ok: false,
      code: 'DISCOVERY_ERROR',
      message: `Không tìm được bài Threads theo chủ đề: ${error.message}`,
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
    log('Đóng cửa sổ discovery Threads.');
    try {
      ses.setUserAgent(CHROME_UA);
    } catch {}
  }
}

module.exports = { discoverThreads, SCROLL_SEARCH_SCRIPT };
