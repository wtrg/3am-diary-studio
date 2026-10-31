'use strict';

const crypto = require('node:crypto');
const { BrowserWindow, session } = require('electron');
const { MUSE_PARTITION, hostsMatch } = require('./muse');
const { INSPECT_SELECTORS_SCRIPT } = require('./museInspect');

const SESSION_COOKIE_HINT = /(sess|token|auth|jwt|sid|login|user|remember)/i;
const STRONG_LOGIN_COOKIE = /^(c_user|xs|sessionid|session|sid|auth_token|access_token|jwt)$/i;

function configError(message, code = 'MUSE_SESSION_ERROR') {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = code;
  return error;
}

function waitForLoad(contents, timeoutMs = 20000) {
  if (!contents.isLoading()) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      contents.removeListener('did-finish-load', finish);
      contents.removeListener('did-fail-load', finish);
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    contents.once('did-finish-load', finish);
    contents.once('did-fail-load', finish);
  });
}

function cookieFingerprint(cookie) {
  return crypto
    .createHash('sha256')
    .update(`${cookie.name}=${cookie.value || ''}`)
    .digest('hex')
    .slice(0, 16);
}

class MuseLoginService {
  constructor({ ruleSlot, getParentWindow }) {
    this.ruleSlot = ruleSlot;
    this.getParentWindow = getParentWindow || (() => null);
    this.window = null;
    this.baseline = null;
    this.baselinePromise = null;
  }

  state() {
    const open = Boolean(this.window && !this.window.isDestroyed());
    return {
      open,
      url: open ? this.window.webContents.getURL() : '',
      partition: MUSE_PARTITION,
      baselineCaptured: Boolean(this.baseline),
    };
  }

  async snapshot() {
    const win = this.window;
    if (!win || win.isDestroyed()) return null;
    const url = win.webContents.getURL();
    if (!/^https?:\/\//i.test(url)) return null;
    const cookies = await session.fromPartition(MUSE_PARTITION).cookies.get({ url });
    const fingerprints = {};
    for (const cookie of cookies) fingerprints[cookie.name] = cookieFingerprint(cookie);
    let localStorageKeys = [];
    try {
      localStorageKeys = await win.webContents.executeJavaScript('Object.keys(localStorage || {})', true);
    } catch {}
    return {
      url,
      at: new Date().toISOString(),
      cookies: fingerprints,
      localStorageKeys: Array.isArray(localStorageKeys) ? localStorageKeys.sort() : [],
    };
  }

  captureBaseline() {
    if (this.baselinePromise) return this.baselinePromise;
    this.baselinePromise = (async () => {
      // Cookies may be written just after did-finish-load; wait for the page to settle.
      await new Promise((resolve) => setTimeout(resolve, 1200));
      const snapshot = await this.snapshot();
      if (snapshot && !this.baseline) this.baseline = snapshot;
      return this.baseline;
    })();
    return this.baselinePromise;
  }

  open() {
    if (!this.ruleSlot.isConfigured()) {
      throw configError(
        'Chưa cấu hình URL Muse. Mở “Cấu hình Muse”, nhập URL trang Muse rồi lưu trước khi đăng nhập.',
        'MUSE_NOT_CONFIGURED',
      );
    }
    if (this.window && !this.window.isDestroyed()) {
      if (this.window.isMinimized()) this.window.restore();
      this.window.show();
      this.window.focus();
      return { ...this.state(), focused: true };
    }

    this.baseline = null;
    this.baselinePromise = null;
    const parent = this.getParentWindow();
    const win = new BrowserWindow({
      width: 1180,
      height: 860,
      minWidth: 900,
      minHeight: 640,
      parent: parent && !parent.isDestroyed() ? parent : undefined,
      show: false,
      backgroundColor: '#0b1020',
      title: `Đăng nhập ${this.ruleSlot.config.muse.name || 'Muse'}`,
      autoHideMenuBar: true,
      webPreferences: {
        partition: MUSE_PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        spellcheck: false,
      },
    });
    win.setMenuBarVisibility(false);
    win.on('page-title-updated', (event) => {
      event.preventDefault();
      win.setTitle('Đăng nhập Muse');
    });
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (!/^https?:\/\//i.test(url)) return { action: 'deny' };
      try {
        const popup = new BrowserWindow({
          width: 640,
          height: 780,
          parent: win,
          autoHideMenuBar: true,
          webPreferences: {
            partition: MUSE_PARTITION,
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
          },
        });
        popup.loadURL(url);
      } catch {}
      return { action: 'deny' };
    });
    win.once('ready-to-show', () => {
      win.show();
      win.focus();
      try { win.moveTop(); } catch {}
    });
    win.webContents.once('did-finish-load', () => {
      // Capture the pre-login state once, so later measurement can distinguish
      // genuinely new login cookies from Muse's anonymous auth cookies.
      void this.captureBaseline().catch(() => {});
    });
    win.on('closed', () => {
      if (this.window === win) this.window = null;
    });
    this.window = win;
    win.loadURL(this.ruleSlot.config.muse.url);
    return { ...this.state(), url: this.ruleSlot.config.muse.url };
  }

  async measure() {
    if (!this.ruleSlot.isConfigured()) {
      throw configError('Chưa cấu hình URL Muse. Không thể đo phiên đăng nhập.', 'MUSE_NOT_CONFIGURED');
    }
    if (!this.window || this.window.isDestroyed()) this.open();
    const win = this.window;
    await waitForLoad(win.webContents);
    const url = win.webContents.getURL();
    if (!/^https?:\/\//i.test(url) || !hostsMatch(url, this.ruleSlot.allowedOrigin())) {
      throw configError(
        `Cửa sổ đăng nhập đang mở ngoài domain Muse (${url || 'about:blank'}). Hãy quay lại trang Muse rồi đo lại.`,
        'MUSE_WRONG_ORIGIN',
      );
    }

    const title = win.webContents.getTitle();
    const rawCookies = await session.fromPartition(MUSE_PARTITION).cookies.get({ url });
    const cookies = rawCookies.map((cookie) => ({
      name: cookie.name,
      domain: cookie.domain,
      path: cookie.path,
      session: Boolean(cookie.session),
      httpOnly: Boolean(cookie.httpOnly),
      secure: Boolean(cookie.secure),
    }));

    const baseline = this.baseline && hostsMatch(this.baseline.url, this.ruleSlot.allowedOrigin()) ? this.baseline : null;
    const currentFingerprints = new Map(rawCookies.map((cookie) => [cookie.name, cookieFingerprint(cookie)]));
    const baselineNames = new Set(Object.keys(baseline?.cookies || {}));
    const newCookieNames = cookies.map((cookie) => cookie.name).filter((name) => !baselineNames.has(name));
    const changedCookieNames = cookies
      .map((cookie) => cookie.name)
      .filter((name) => baselineNames.has(name) && baseline.cookies[name] !== currentFingerprints.get(name));
    const urlChanged = Boolean(baseline && baseline.url !== url);
    let suggestedUrlContains = '';
    if (urlChanged) {
      try {
        const pathname = new URL(url).pathname;
        if (pathname && pathname !== '/') suggestedUrlContains = pathname;
      } catch {}
    }
    // Anonymous Muse cookies such as hatch_native_auth_* exist before login.
    // Only strong session names, or names that appeared after the logged-out
    // baseline, are safe to preselect. Everything else stays manual.
    const suggestedCookieNames = cookies
      .map((cookie) => cookie.name)
      .filter((name) => STRONG_LOGIN_COOKIE.test(name) || newCookieNames.includes(name))
      .filter((name) => name !== 'hatch_native_auth_csrf' && name !== 'hatch_native_auth_temp' && name !== 'hatch_native_auth_device' && name !== 'hatch_native_auth_state');

    let localStorageKeys = [];
    let hasPasswordField = false;
    try {
      const page = await win.webContents.executeJavaScript(
        `(() => ({
          keys: Object.keys(localStorage || {}).slice(0, 80),
          hasPassword: Boolean(document.querySelector('input[type="password"]')),
        }))()`,
        true,
      );
      localStorageKeys = Array.isArray(page?.keys) ? page.keys.filter((key) => typeof key === 'string') : [];
      hasPasswordField = Boolean(page?.hasPassword);
    } catch {}

    return {
      ok: true,
      url,
      title,
      cookies,
      suggestedCookieNames,
      newCookieNames,
      changedCookieNames,
      urlChanged,
      suggestedUrlContains,
      baselineCaptured: Boolean(baseline),
      baselineAt: baseline?.at || null,
      localStorageKeys,
      hasPasswordField,
      measuredAt: new Date().toISOString(),
      note:
        'Chỉ đọc tên cookie/khóa lưu trữ để tạo tín hiệu đăng nhập. Tool không lưu giá trị cookie hay mật khẩu. Cookie mới sau baseline an toàn hơn cookie anonymous.',
    };
  }

  async inspectSelectors() {
    if (!this.ruleSlot.isConfigured()) {
      throw configError('Chưa cấu hình URL Muse. Không thể dò selector.', 'MUSE_NOT_CONFIGURED');
    }
    if (!this.window || this.window.isDestroyed()) {
      throw configError('Hãy mở cửa sổ Muse trước khi dò selector.', 'MUSE_LOGIN_WINDOW_NOT_OPEN');
    }
    const win = this.window;
    await waitForLoad(win.webContents);
    const url = win.webContents.getURL();
    if (!hostsMatch(url, this.ruleSlot.allowedOrigin())) {
      throw configError('Cửa sổ Muse đang mở ngoài domain đã cấu hình.', 'MUSE_WRONG_ORIGIN');
    }
    const result = await Promise.race([
      win.webContents.executeJavaScript(INSPECT_SELECTORS_SCRIPT, true),
      new Promise((_, reject) =>
        setTimeout(() => reject(configError('Dò selector quá thời gian.', 'MUSE_INSPECT_TIMEOUT')), 10000),
      ),
    ]);
    return {
      ok: true,
      url,
      title: win.webContents.getTitle(),
      groups: result?.groups || { inputs: [], sendButtons: [], responses: [], loginHints: [] },
      inspectedAt: new Date().toISOString(),
    };
  }

  close() {
    if (this.window && !this.window.isDestroyed()) this.window.close();
    this.window = null;
  }
}

module.exports = { MuseLoginService, waitForLoad, SESSION_COOKIE_HINT };
