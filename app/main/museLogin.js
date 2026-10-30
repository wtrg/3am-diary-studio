'use strict';

const { BrowserWindow, session } = require('electron');
const { MUSE_PARTITION, hostsMatch } = require('./muse');

const SESSION_COOKIE_HINT = /(sess|token|auth|jwt|sid|login|user|remember)/i;

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

class MuseLoginService {
  constructor({ ruleSlot, getParentWindow }) {
    this.ruleSlot = ruleSlot;
    this.getParentWindow = getParentWindow || (() => null);
    this.window = null;
  }

  state() {
    const open = Boolean(this.window && !this.window.isDestroyed());
    return {
      open,
      url: open ? this.window.webContents.getURL() : '',
      partition: MUSE_PARTITION,
    };
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
    win.once('ready-to-show', () => win.show());
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
    const suggestedCookieNames = cookies.map((cookie) => cookie.name).filter((name) => SESSION_COOKIE_HINT.test(name));

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
      localStorageKeys,
      hasPasswordField,
      measuredAt: new Date().toISOString(),
      note:
        'Chỉ đọc tên cookie/khóa lưu trữ để tạo tín hiệu đăng nhập. Tool không lưu giá trị cookie hay mật khẩu.',
    };
  }

  close() {
    if (this.window && !this.window.isDestroyed()) this.window.close();
    this.window = null;
  }
}

module.exports = { MuseLoginService, waitForLoad, SESSION_COOKIE_HINT };
