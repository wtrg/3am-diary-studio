'use strict';

const { session, webContents } = require('electron');

const MUSE_PARTITION = 'persist:muse';
const MUSE_LOGIN_MESSAGE =
  'Cần đăng nhập tài khoản Muse kèm theo tool để tiếp tục. Không có tài khoản, tool không chạy.';

function museSession() {
  return session.fromPartition(MUSE_PARTITION);
}

function hostsMatch(actualUrl, allowedOrigin) {
  try {
    const actual = new URL(actualUrl);
    const allowed = new URL(allowedOrigin);
    return actual.origin === allowed.origin || actual.hostname.endsWith(`.${allowed.hostname}`);
  } catch {
    return false;
  }
}

class MuseGate {
  constructor(ruleSlot) {
    this.rule = ruleSlot;
    this.loggedIn = false;
    this.verifiedAt = null;
    this.lastError = '';
    this.webContentsId = null;
    this._resetOnNavigation();
  }

  _resetOnNavigation() {
    try {
      const ses = museSession();
      ses.on('will-download', () => {});
    } catch {}
    const { app } = require('electron');
    if (app) {
      app.on('web-contents-created', (_event, contents) => {
        try {
          if (contents.session !== museSession()) return;
          contents.on('did-navigate', () => {
            this.loggedIn = false;
            this.verifiedAt = null;
          });
          contents.on('did-navigate-in-page', () => {
            this.loggedIn = false;
            this.verifiedAt = null;
          });
        } catch {}
      });
    }
  }

  status() {
    const info = this.rule.publicInfo();
    let reason = '';
    if (!info.configured) reason = 'Chưa cấu hình muse.url trong config/muse_rule.json.';
    else if (!info.loginCheckConfigured) reason = 'Chưa cấu hình cách kiểm tra đăng nhập Muse trong muse_rule.json.';
    else if (!this.loggedIn) reason = 'Chưa xác thực được phiên đăng nhập Muse.';
    return {
      ...info,
      loggedIn: Boolean(info.configured && info.loginCheckConfigured && this.loggedIn),
      verifiedAt: this.verifiedAt,
      message: reason || 'Đã đăng nhập Muse.',
      gateMessage: MUSE_LOGIN_MESSAGE,
    };
  }

  async cookiesForMuse() {
    const names = this.rule.config.muse.login.cookie_names;
    if (!names.length || !this.rule.isConfigured()) return { matched: false, hasCookieCheck: names.length > 0 };
    try {
      const ses = museSession();
      const all = await ses.cookies.get({ url: this.rule.config.muse.url });
      const foundNames = new Set(all.map((cookie) => cookie.name));
      return { matched: names.some((name) => foundNames.has(name)), hasCookieCheck: true, found: [...foundNames] };
    } catch (error) {
      return { matched: false, hasCookieCheck: true, error: error.message };
    }
  }

  findWebview(id) {
    const numeric = Number(id);
    const fromId = Number.isInteger(numeric) ? webContents.fromId(numeric) : null;
    const candidates = fromId ? [fromId] : webContents.getAllWebContents();
    const matches = [];
    for (const contents of candidates) {
      if (!contents || contents.isDestroyed()) continue;
      const type = contents.getType();
      if (type !== 'webview' && type !== 'window') continue;
      try {
        if (contents.session !== museSession()) continue;
      } catch {
        continue;
      }
      matches.push(contents);
    }
    // Prefer the embedded Muse frame, fall back to the standalone login window.
    return matches.find((contents) => contents.getType() === 'webview') || matches[0] || null;
  }

  async verify({ webContentsId } = {}) {
    const info = this.rule.publicInfo();
    if (!info.configured) {
      this.loggedIn = false;
      return { ...this.status(), ok: false };
    }
    if (!info.loginCheckConfigured) {
      this.loggedIn = false;
      return { ...this.status(), ok: false };
    }

    const login = this.rule.config.muse.login;
    const allowedOrigin = this.rule.allowedOrigin();
    let positive = false;
    let negative = false;
    const evidence = {};

    const cookie = await this.cookiesForMuse();
    evidence.cookie = cookie;
    if (cookie.hasCookieCheck && cookie.matched) positive = true;

    let contents = this.findWebview(webContentsId);
    if (!contents && this.webContentsId) contents = this.findWebview(this.webContentsId);
    if (contents) {
      const currentUrl = contents.getURL();
      evidence.url = currentUrl;
      if (!hostsMatch(currentUrl, allowedOrigin)) {
        this.loggedIn = false;
        this.lastError = 'Webview Muse đang mở sai domain, không xác thực đăng nhập.';
        return { ...this.status(), ok: false, error: this.lastError };
      }
      if (login.logged_out_url_contains.some((pattern) => currentUrl.includes(pattern))) negative = true;
      if (login.logged_in_url_contains.some((pattern) => currentUrl.includes(pattern))) positive = true;

      for (const selector of login.logged_out_selectors) {
        try {
          const found = await contents.executeJavaScript(
            `Boolean(document.querySelector(${JSON.stringify(selector)}))`,
            true,
          );
          if (found) {
            negative = true;
            break;
          }
        } catch {}
      }
      for (const selector of login.logged_in_selectors) {
        try {
          const found = await contents.executeJavaScript(
            `Boolean(document.querySelector(${JSON.stringify(selector)}))`,
            true,
          );
          if (found) {
            positive = true;
            break;
          }
        } catch {}
      }
      this.webContentsId = contents.id;
    } else if (login.logged_in_url_contains.length || login.logged_in_selectors.length || login.logged_out_selectors.length) {
      evidence.webview = 'not-open';
    }

    this.loggedIn = positive && !negative;
    this.verifiedAt = this.loggedIn ? new Date().toISOString() : null;
    this.lastError = this.loggedIn
      ? ''
      : negative
        ? 'Muse đang hiển thị trạng thái đăng xuất/chưa đăng nhập.'
        : 'Chưa thấy tín hiệu đăng nhập Muse. Hãy đăng nhập trong khung Muse rồi kiểm tra lại.';
    return { ...this.status(), ok: this.loggedIn, evidence };
  }

  requireLogin() {
    const status = this.status();
    if (!status.loggedIn) {
      const error = new Error(status.gateMessage);
      error.statusCode = 403;
      error.code = 'MUSE_LOGIN_REQUIRED';
      error.gateMessage = status.gateMessage;
      throw error;
    }
    return true;
  }

  async sendPrompt({ webContentsId, text }) {
    this.requireLogin();
    if (!this.rule.hasAutoBridge()) {
      const error = new Error(
        'Chưa cấu hình bridge tự động trong muse_rule.json. Hãy copy JSON input sang Muse và dán JSON kế hoạch trả về.',
      );
      error.statusCode = 400;
      error.code = 'MUSE_BRIDGE_NOT_CONFIGURED';
      throw error;
    }
    const bridge = this.rule.config.muse.bridge;
    const contents = this.findWebview(webContentsId) || this.findWebview(this.webContentsId);
    if (!contents) {
      const error = new Error('Chưa mở khung hoặc cửa sổ Muse. Hãy mở Muse trong Module 3 (hoặc cửa sổ đăng nhập) rồi thử lại.');
      error.statusCode = 400;
      error.code = 'MUSE_WEBVIEW_NOT_OPEN';
      throw error;
    }
    if (!hostsMatch(contents.getURL(), this.rule.allowedOrigin())) {
      const error = new Error('Khung Muse không nằm đúng domain đã cấu hình.');
      error.statusCode = 400;
      error.code = 'MUSE_WRONG_ORIGIN';
      throw error;
    }

    const fillScript = `
      (() => {
        const text = ${JSON.stringify(String(text))};
        const input = document.querySelector(${JSON.stringify(bridge.input_selector)});
        if (!input) return { ok: false, code: 'INPUT_NOT_FOUND' };
        input.focus();
        if (input.isContentEditable) {
          try {
            const selection = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(input);
            selection.removeAllRanges();
            selection.addRange(range);
          } catch {}
          let inserted = false;
          try { inserted = document.execCommand('insertText', false, text); } catch {}
          if (!inserted) {
            input.textContent = text;
            input.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, inputType: 'insertText', data: text }));
          }
          input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
        } else {
          const proto = input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
          setter.call(input, text);
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
        return { ok: true, editable: Boolean(input.isContentEditable) };
      })()
    `;
    const clickScript = `
      (() => {
        const button = document.querySelector(${JSON.stringify(bridge.send_selector)});
        if (!button) return { ok: false, code: 'SEND_NOT_FOUND' };
        if (button.disabled || button.getAttribute('aria-disabled') === 'true') return { ok: false, code: 'SEND_DISABLED' };
        try { button.scrollIntoView({ block: 'center' }); } catch {}
        button.click();
        return { ok: true };
      })()
    `;
    let fill;
    try {
      fill = await contents.executeJavaScript(fillScript, true);
    } catch (error) {
      const wrapped = new Error(`Không điền được input sang Muse: ${error.message}`);
      wrapped.statusCode = 500;
      wrapped.code = 'MUSE_SEND_FAILED';
      throw wrapped;
    }
    if (!fill || !fill.ok) {
      const error = new Error(`Bridge Muse không tìm thấy ô nhập (${fill?.code || 'UNKNOWN'}).`);
      error.statusCode = 400;
      error.code = fill?.code || 'MUSE_BRIDGE_FAILED';
      throw error;
    }
    // React editors enable the send button after the input/change events settle.
    await new Promise((resolve) => setTimeout(resolve, 350));
    let clicked;
    try {
      clicked = await contents.executeJavaScript(clickScript, true);
      if (clicked?.code === 'SEND_DISABLED') {
        await new Promise((resolve) => setTimeout(resolve, 450));
        clicked = await contents.executeJavaScript(clickScript, true);
      }
    } catch (error) {
      const wrapped = new Error(`Không bấm được nút gửi Muse: ${error.message}`);
      wrapped.statusCode = 500;
      wrapped.code = 'MUSE_SEND_FAILED';
      throw wrapped;
    }
    if (!clicked || !clicked.ok) {
      const error = new Error(`Bridge Muse không bấm được nút gửi (${clicked?.code || 'UNKNOWN'}).`);
      error.statusCode = 400;
      error.code = clicked?.code || 'MUSE_BRIDGE_FAILED';
      throw error;
    }

    const deadline = Date.now() + Math.max(15000, Number(bridge.wait_timeout_ms) || 180000);
    let previous = '';
    let stableCount = 0;
    let lastText = '';
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 2500));
      let textNow = '';
      try {
        textNow = await contents.executeJavaScript(
          `(() => { const el = document.querySelector(${JSON.stringify(bridge.response_selector)}); return el ? (el.innerText || el.textContent || '') : ''; })()`,
          true,
        );
      } catch {}
      lastText = textNow || lastText;
      if (textNow && textNow === previous && textNow.includes('{')) {
        stableCount += 1;
        if (stableCount >= 2) return { raw: textNow, waitedMs: Math.max(0, Date.now() - (deadline - (Number(bridge.wait_timeout_ms) || 180000))) };
      } else {
        stableCount = 0;
      }
      previous = textNow;
    }
    const timeoutError = new Error(
      lastText
        ? 'Muse trả lời nhưng chưa thấy JSON ổn định. Hãy kiểm tra khung Muse rồi dán JSON thủ công.'
        : 'Hết thời gian chờ Muse trả lời. Không tự tạo kết quả thay Muse.',
    );
    timeoutError.statusCode = 504;
    timeoutError.code = 'MUSE_RESPONSE_TIMEOUT';
    throw timeoutError;
  }
}

module.exports = { MUSE_PARTITION, MUSE_LOGIN_MESSAGE, MuseGate, museSession, hostsMatch };
