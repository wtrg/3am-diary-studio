'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { BrowserWindow, nativeTheme } = require('electron');
const {
  CHROME_UA,
  normalizeMode,
  partitionForMode,
  threadsSessionForMode,
  threadsLoginState,
} = require('./scraper');

const SCREENSHOT_TIMEOUT = 90000;

function normalizeForMatch(value) {
  return String(value || '')
    .replace(/\u200b|\u200c|\u200d|\ufeff/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('vi');
}

function safeShotName(value, fallback = 'shot') {
  const cleaned = String(value || '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .slice(0, 80);
  return cleaned || fallback;
}

function screenshotError(code, message, details) {
  const error = new Error(message);
  error.code = code;
  if (details) error.details = details;
  return error;
}

async function roundImageCorners(inputPath, outputPath, radius = 26) {
  const r = Math.max(0, Math.round(Number(radius) || 0));
  if (!r) {
    await fsp.copyFile(inputPath, outputPath);
    return outputPath;
  }
  const filter =
    `format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':` +
    `a='if(lte(hypot(max(abs(X-W/2)-(W/2-${r}),0),max(abs(Y-H/2)-(H/2-${r}),0)),${r}),255,0)'`;
  const result = spawnSync(
    process.env.FFMPEG_PATH || 'ffmpeg',
    ['-hide_banner', '-loglevel', 'error', '-y', '-i', inputPath, '-vf', filter, outputPath],
    { encoding: 'utf8', timeout: 30000, windowsHide: true },
  );
  if (result.status === 0 && fs.existsSync(outputPath)) return outputPath;
  // Nếu ffmpeg không bo được, giữ ảnh gốc (vẫn là ảnh chụp thật, không phải thẻ vẽ lại).
  await fsp.copyFile(inputPath, outputPath);
  return outputPath;
}

function findCardScript(targetText, author, kind) {
  return `
    (() => {
      const target = ${JSON.stringify(targetText)};
      const author = ${JSON.stringify(author || '')};
      const kind = ${JSON.stringify(kind)};
      const norm = (value) => String(value || '')
        .replace(/\\u200b|\\u200c|\\u200d|\\ufeff/g, '')
        .replace(/\\s+/g, ' ')
        .trim()
        .toLocaleLowerCase('vi');
      const targetNorm = norm(target);
      const authorNorm = norm(author);
      const elements = Array.from(document.querySelectorAll('div,article,section'));
      const candidates = [];
      for (const element of elements) {
        const text = norm(element.innerText);
        if (!text || !text.includes(targetNorm)) continue;
        if (authorNorm && !text.includes(authorNorm)) continue;
        const rect = element.getBoundingClientRect();
        if (rect.width < 300 || rect.height < 40) continue;
        if (rect.width > 900 || rect.height > 1200) continue;
        const style = getComputedStyle(element);
        const area = rect.width * rect.height;
        const cardScore =
          (rect.width >= 500 ? 8 : 0) +
          (rect.width <= 760 ? 4 : 0) +
          (/rgb\\(255,\\s*255,\\s*255|rgba\\(255,\\s*255,\\s*255/.test(style.backgroundColor) ? 5 : 0) +
          (parseFloat(style.borderRadius) > 4 ? 2 : 0) +
          (text.includes(authorNorm) ? 3 : 0);
        candidates.push({
          x: rect.x, y: rect.y, width: rect.width, height: rect.height,
          area, score: cardScore, tag: element.tagName,
          textLength: text.length
        });
      }
      if (!candidates.length) return { found: false };
      candidates.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.area - b.area;
      });
      const best = candidates[0];
      const el = elements.find((element) => {
        const r = element.getBoundingClientRect();
        return Math.round(r.x) === Math.round(best.x) && Math.round(r.y) === Math.round(best.y) &&
          Math.round(r.width) === Math.round(best.width) && Math.round(r.height) === Math.round(best.height) &&
          norm(element.innerText).includes(targetNorm);
      });
      if (el) {
        try { el.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch {}
        try {
          for (const other of document.querySelectorAll('[data-3am-shot-card]')) other.removeAttribute('data-3am-shot-card');
          el.setAttribute('data-3am-shot-card', kind);
        } catch {}
      }
      return { found: true, candidate: { ...best, kind }, elementFound: Boolean(el) };
    })()
  `;
}

function currentCardRectScript(targetText, author) {
  return `
    (() => {
      const target = ${JSON.stringify(targetText)};
      const author = ${JSON.stringify(author || '')};
      const norm = (value) => String(value || '')
        .replace(/\\u200b|\\u200c|\\u200d|\\ufeff/g, '')
        .replace(/\\s+/g, ' ')
        .trim()
        .toLocaleLowerCase('vi');
      const targetNorm = norm(target);
      const authorNorm = norm(author);
      const elements = Array.from(document.querySelectorAll('div,article,section'));
      const candidates = [];
      for (const element of elements) {
        const text = norm(element.innerText);
        if (!text || !text.includes(targetNorm)) continue;
        if (authorNorm && !text.includes(authorNorm)) continue;
        const rect = element.getBoundingClientRect();
        if (rect.width < 300 || rect.height < 40 || rect.width > 900 || rect.height > 1200) continue;
        const style = getComputedStyle(element);
        candidates.push({
          x: rect.x, y: rect.y, width: rect.width, height: rect.height,
          score: (rect.width >= 500 ? 8 : 0) + (/rgb\\(255,\\s*255,\\s*255|rgba\\(255,\\s*255,\\s*255/.test(style.backgroundColor) ? 5 : 0),
          area: rect.width * rect.height
        });
      }
      if (!candidates.length) return null;
      candidates.sort((a, b) => (b.score - a.score) || (a.area - b.area));
      return candidates[0];
    })()
  `;
}

const EXPAND_SCRIPT = `
(() => {
  const patterns = [/see more/i, /xem thêm/i, /view more comments/i, /xem thêm bình luận/i, /view replies/i, /xem thêm câu trả lời/i];
  let clicked = 0;
  for (const el of document.querySelectorAll('div[role="button"],button,span[dir="auto"],a[role="link"]')) {
    const label = (el.innerText || '').trim();
    if (!label || label.length > 80) continue;
    if (!patterns.some((pattern) => pattern.test(label))) continue;
    try { el.click(); clicked += 1; } catch {}
    if (clicked >= 20) break;
  }
  return clicked;
})()
`;

const SCROLL_SCRIPT = `
(() => {
  const amount = 650;
  window.scrollBy(0, amount);
  const containers = Array.from(document.querySelectorAll('div')).filter((el) => {
    const style = getComputedStyle(el);
    return /(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 150;
  });
  containers.sort((a, b) => b.scrollHeight - a.scrollHeight);
  for (const el of containers.slice(0, 3)) el.scrollBy(0, amount);
  return { y: window.scrollY, containers: containers.slice(0, 3).map((el) => ({ top: el.scrollTop, height: el.scrollHeight, client: el.clientHeight })) };
})()
`;

const DISMISS_LOGIN_SCRIPT = `
(() => {
  try {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
  } catch {}
  let hidden = 0;
  const dialogs = Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"]'));
  for (const dialog of dialogs) {
    const text = (dialog.innerText || '').slice(0, 900);
    if (!/Threads|Instagram|đăng nhập|log in|join/i.test(text)) continue;
    const buttons = Array.from(dialog.querySelectorAll('[role="button"],button'));
    const close = buttons.find((button) => /close|đóng|not now|để sau|later|skip/i.test((button.innerText || '') + ' ' + (button.getAttribute('aria-label') || '')));
    if (close) {
      try { close.click(); hidden += 1; } catch {}
    }
    try { dialog.style.display = 'none'; hidden += 1; } catch {}
  }
  // Hide full-screen dim overlays. Threads uses z-index:auto on the login
  // backdrop, so do not require a numeric z-index here (otherwise every
  // capture stays darkened by the 70% black login scrim).
  const scrims = Array.from(document.querySelectorAll('div')).filter((el) => {
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const bg = style.backgroundColor || '';
    const alpha = Number((bg.match(/rgba\\([^)]*,\\s*([0-9.]+)\\)/) || [])[1] || 1);
    return style.position === 'fixed' && rect.width > window.innerWidth * 0.8 && rect.height > window.innerHeight * 0.8 &&
      /^rgba?\\(0,\\s*0,\\s*0/.test(bg) && alpha > 0.15;
  });
  for (const el of scrims) {
    try { el.style.display = 'none'; hidden += 1; } catch {}
  }
  try { document.body.style.overflow = ''; } catch {}
  return { hidden, dialogCount: Array.from(document.querySelectorAll('[role="dialog"]')).filter((el) => getComputedStyle(el).display !== 'none').length };
})()
`;

const LIGHT_CARD_SCRIPT = `
(() => {
  const el = document.querySelector('[data-3am-shot-card]');
  if (!el) return false;
  el.setAttribute('data-3am-light-card', '1');
  const set = (node, prop, value) => { try { node.style.setProperty(prop, value, 'important'); } catch {} };
  const skip = new Set(['IMG', 'VIDEO', 'CANVAS', 'PICTURE', 'SVG', 'PATH', 'CIRCLE', 'RECT', 'G', 'LINE', 'POLYLINE', 'POLYGON']);
  set(el, 'background-color', '#ffffff');
  set(el, 'color', '#0f1419');
  set(el, 'box-shadow', 'none');
  for (const node of [el, ...el.querySelectorAll('*')]) {
    if (!skip.has(node.tagName)) {
      set(node, 'background-color', 'transparent');
      set(node, 'color', '#0f1419');
      set(node, 'border-color', '#e7e9ea');
    }
    if (node.tagName === 'SVG') {
      set(node, 'color', '#536471');
      set(node, 'fill', 'currentColor');
    }
    if (node.tagName === 'A') set(node, 'color', '#0f1419');
  }
  return { card: el.getBoundingClientRect().width, nodes: el.querySelectorAll('*').length };
})()
`;

const RESET_SCROLL_SCRIPT = `
(() => {
  window.scrollTo(0, 0);
  const containers = Array.from(document.querySelectorAll('div')).filter((el) => {
    const style = getComputedStyle(el);
    return /(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 150;
  });
  containers.sort((a, b) => b.scrollHeight - a.scrollHeight);
  for (const el of containers.slice(0, 3)) el.scrollTop = 0;
  return containers.length;
})()
`;

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(screenshotError('SCREENSHOT_TIMEOUT', `${label || 'thao tác'} quá thời gian. Dừng, không fallback.`)), ms),
    ),
  ]);
}

async function captureCard(wc, element, targetText, author, outputFile, log, lightCard = true) {
  const found = await withTimeout(wc.executeJavaScript(findCardScript(targetText, author, element), true), 8000, 'Tìm card');
  if (!found || !found.found) return null;
  await new Promise((resolve) => setTimeout(resolve, 260));
  if (lightCard) {
    await withTimeout(wc.executeJavaScript(LIGHT_CARD_SCRIPT, true), 5000, 'Áp theme thẻ sáng').catch((error) =>
      log?.(`Không áp được theme thẻ sáng: ${error.message}`),
    );
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  const rect = await withTimeout(wc.executeJavaScript(currentCardRectScript(targetText, author), true), 5000, 'Đo card');
  if (!rect) return null;
  const pad = 2;
  const x = Math.max(0, Math.floor(rect.x - pad));
  const y = Math.max(0, Math.floor(rect.y - pad));
  const width = Math.min(980 - x, Math.ceil(rect.width + pad * 2));
  const height = Math.min(1360 - y, Math.ceil(rect.height + pad * 2));
  if (width < 250 || height < 70) {
    throw screenshotError(
      'SCREENSHOT_MATCH_FAILED',
      `Khung ${element} quá nhỏ hoặc không ổn định (${width}x${height}). Dừng, không dùng thẻ vẽ lại.`,
    );
  }
  const image = await withTimeout(wc.capturePage({ x, y, width, height }), 12000, 'Capture card');
  if (!image || image.isEmpty()) {
    throw screenshotError('SCREENSHOT_MATCH_FAILED', `Không chụp được ${element}. Dừng job, không fallback.`);
  }
  const size = image.getSize();
  if (size.width < 250 || size.height < 70) {
    throw screenshotError('SCREENSHOT_MATCH_FAILED', `Ảnh ${element} không hợp lệ (${size.width}x${size.height}).`);
  }
  const rawFile = `${outputFile}.raw.png`;
  const roundedFile = `${outputFile}.png`;
  await fsp.writeFile(rawFile, image.toPNG());
  await roundImageCorners(rawFile, roundedFile, 26);
  await fsp.unlink(rawFile).catch(() => {});
  log?.(`Đã chụp ${element}: ${size.width}x${size.height} -> ${path.basename(roundedFile)}`);
  return {
    file: roundedFile,
    width: size.width,
    height: size.height,
    crop: { x, y, width, height },
  };
}

async function captureThreadScreenshots(options = {}) {
  const url = String(options.url || '').trim();
  const post = options.post || {};
  const comments = Array.isArray(options.comments) ? options.comments : [];
  const outputDir = options.outputDir;
  const log = options.log || (() => {});
  const lightCard = options.lightCard === true || process.env.THREADS_SCREENSHOT_LIGHT === '1';
  if (!url || /^demo:/i.test(url) || /DEMO3AM/i.test(url)) {
    throw screenshotError(
      'SCREENSHOT_NOT_AVAILABLE',
      'Không có link Threads thật để chụp card. Job production cần bài live; dữ liệu demo không được dùng ảnh giả.',
    );
  }
  if (!outputDir) throw screenshotError('SCREENSHOT_OUTPUT_MISSING', 'Thiếu thư mục lưu ảnh chụp.');
  await fsp.mkdir(outputDir, { recursive: true });

  let mode = options.mode;
  if (!['guest', 'account'].includes(mode)) {
    const login = await threadsLoginState().catch(() => ({ loggedIn: false }));
    mode = login.loggedIn ? 'account' : 'guest';
  }
  mode = normalizeMode(mode);
  const partition = partitionForMode(mode);
  const ses = threadsSessionForMode(mode);
  let win = null;
  let timer = null;
  let previousTheme = null;

  const startedAt = Date.now();
  const timeout = setTimeout(() => {
    log('Screenshot: watchdog hết thời gian, đóng cửa sổ.');
    try {
      if (win && !win.isDestroyed()) win.destroy();
    } catch {}
  }, options.timeoutMs || SCREENSHOT_TIMEOUT);

  try {
    try {
      previousTheme = nativeTheme.themeSource;
      nativeTheme.themeSource = 'light';
    } catch {}
    win = new BrowserWindow({
      width: 1000,
      height: 1400,
      show: false,
      backgroundColor: '#ffffff',
      webPreferences: {
        partition,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        javascript: true,
        images: true,
        backgroundThrottling: false,
        spellcheck: false,
      },
    });
    win.setMenuBarVisibility(false);
    const wc = win.webContents;
    wc.setUserAgent(CHROME_UA);
    wc.setZoomFactor(1);
    wc.on('render-process-gone', (_event, details) => log(`Screenshot renderer gone: ${JSON.stringify(details)}`));
    wc.on('unresponsive', () => log('Screenshot renderer unresponsive.'));
    log('Screenshot: mở trang Threads...');

    const loadPromise = new Promise((resolve) => {
      wc.once('did-finish-load', resolve);
      wc.once('did-fail-load', (_event, code, description) => {
        log(`Screenshot load lỗi: ${code} ${description}`);
        resolve();
      });
    });
    await withTimeout(wc.loadURL(url), 20000, 'Tải trang Threads').catch((error) => log(`loadURL: ${error.message}`));
    await Promise.race([loadPromise, new Promise((resolve) => setTimeout(resolve, 15000))]);
    log(`Screenshot: trang đã tải ${wc.getURL()}`);
    await new Promise((resolve) => setTimeout(resolve, 2200));

    await withTimeout(wc.executeJavaScript(RESET_SCROLL_SCRIPT, true), 5000, 'Reset scroll').catch(() => {});
    for (let round = 0; round < 4; round += 1) {
      await withTimeout(wc.executeJavaScript(EXPAND_SCRIPT, true), 5000, 'Mở See more').catch(() => {});
      await withTimeout(wc.executeJavaScript(DISMISS_LOGIN_SCRIPT, true), 5000, 'Đóng login overlay')
        .then((result) => {
          if (result?.hidden) log(`Screenshot: đã ẩn ${result.hidden} lớp login/overlay.`);
        })
        .catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 600));
    }
    const overlayCheck = await withTimeout(
      wc.executeJavaScript(`(() => {
        const visible = (el) => {
          if (!el || !el.getClientRects().length) return false;
          const style = getComputedStyle(el);
          return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0.01;
        };
        const dialogs = Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"]')).filter(visible);
        const loginDialogs = dialogs.filter((el) => /Bày tỏ nhiều hơn qua Threads|Join Threads|Log in to Threads|Log in or sign up for Threads|Instagram/i.test(el.innerText || ''));
        const scrims = Array.from(document.querySelectorAll('div')).filter((el) => {
          if (!visible(el)) return false;
          const style = getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          return style.position === 'fixed' && rect.width > window.innerWidth * 0.8 && rect.height > window.innerHeight * 0.8 &&
            Number(style.zIndex) >= 1 && /rgba\\(0,\\s*0,\\s*0/.test(style.backgroundColor);
        });
        return { loginModal: loginDialogs.length > 0, dialog: dialogs.length > 0, scrims: scrims.length };
      })()`, true),
      5000,
      'Kiểm tra overlay',
    ).catch(() => ({ loginModal: false, dialog: false, scrims: 0 }));
    if (overlayCheck.loginModal || overlayCheck.scrims > 0) {
      throw screenshotError(
        'SCREENSHOT_BLOCKED_BY_LOGIN',
        'Threads đang che nội dung bằng modal đăng nhập; không chụp trang bị che. Hãy đăng nhập Threads (chế độ Tài khoản) rồi chạy lại.',
      );
    }
    log('Screenshot: bắt đầu chụp card bài gốc...');

    const postText = String(post.text || '').trim();
    const postFileBase = path.join(outputDir, 'post');
    let postShot = null;
    if (postText) {
      postShot = await captureCard(wc, 'post', postText, post.author, postFileBase, log, lightCard);
    }
    if (!postShot) {
      throw screenshotError(
        'SCREENSHOT_MATCH_FAILED',
        'Không tìm thấy card bài gốc trên DOM Threads để chụp. Dừng job; không vẽ lại thẻ giả.',
      );
    }

    const result = { ok: true, post: postShot.file, comments: {}, mode, capturedAt: new Date().toISOString(), warnings: [] };
    const pending = new Map();
    for (const comment of comments) {
      const text = String(comment.text || '').trim();
      if (!text) continue;
      pending.set(comment.comment_id, comment);
    }

    await wc.executeJavaScript(RESET_SCROLL_SCRIPT, true).catch(() => {});
    let rounds = 0;
    while (pending.size && rounds < 32) {
      for (const [commentId, comment] of [...pending.entries()]) {
        const fileBase = path.join(outputDir, `comment-${safeShotName(commentId)}`);
        const shot = await captureCard(wc, 'comment', comment.text, comment.author, fileBase, log, lightCard).catch((error) => {
          if (error.code === 'SCREENSHOT_MATCH_FAILED') return null;
          throw error;
        });
        if (shot) {
          result.comments[commentId] = shot.file;
          pending.delete(commentId);
        }
      }
      if (!pending.size) break;
      await wc.executeJavaScript(SCROLL_SCRIPT, true).catch(() => {});
      await wc.executeJavaScript(DISMISS_LOGIN_SCRIPT, true).catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 800));
      rounds += 1;
    }

    if (pending.size) {
      const missing = [...pending.keys()];
      throw screenshotError(
        'SCREENSHOT_MATCH_FAILED',
        `Thiếu ảnh chụp thật cho bình luận: ${missing.join(', ')}. Dừng job; không vẽ lại thẻ giả.`,
        { missing, post: postShot.file },
      );
    }
    log(`Chụp xong ${Object.keys(result.comments).length} bình luận trong ${Date.now() - startedAt}ms.`);
    return result;
  } finally {
    clearTimeout(timeout);
    if (win && !win.isDestroyed()) {
      try {
        const contents = win.webContents;
        if (contents.debugger?.isAttached()) contents.debugger.detach();
      } catch {}
      try { win.destroy(); } catch {}
    }
    try {
      if (previousTheme) nativeTheme.themeSource = previousTheme;
    } catch {}
    try { ses.setUserAgent(CHROME_UA); } catch {}
  }
}

module.exports = {
  captureThreadScreenshots,
  normalizeForMatch,
  roundImageCorners,
  safeShotName,
};
