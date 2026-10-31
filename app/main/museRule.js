'use strict';

const fs = require('node:fs');
const path = require('node:path');

const EMPTY_CONFIG = {
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
};

function arrayOfStrings(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === 'string' && entry.trim()).map((entry) => entry.trim()) : [];
}

function configError(message) {
  const error = new Error(message);
  error.statusCode = 422;
  error.code = 'MUSE_CONFIG_INVALID';
  return error;
}

function normalizeMuseUrl(value) {
  const url = String(value || '').trim();
  if (!url) return '';
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw configError('URL Muse không hợp lệ. Ví dụ đúng: https://muse.example.com/chat');
  }
  if (!/^https?:$/.test(parsed.protocol)) throw configError('URL Muse phải bắt đầu bằng http:// hoặc https://.');
  if (!parsed.hostname) throw configError('URL Muse thiếu tên miền.');
  if (parsed.username || parsed.password) throw configError('Không nhận URL có tài khoản/mật khẩu nhúng. Không lưu mật khẩu trong code.');
  return parsed.toString();
}

function stringField(value, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback;
}

class MuseRuleSlot {
  constructor(configFile) {
    this.configFile = configFile;
    this.config = this.read();
    this.mtimeMs = this.currentMtime();
  }

  currentMtime() {
    try {
      return fs.statSync(this.configFile).mtimeMs;
    } catch {
      return 0;
    }
  }

  reloadIfChanged() {
    const mtimeMs = this.currentMtime();
    if (mtimeMs && mtimeMs !== this.mtimeMs) {
      this.mtimeMs = mtimeMs;
      this.config = this.read();
    }
    return this.config;
  }

  read() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.configFile, 'utf8'));
      const config = {
        ...EMPTY_CONFIG,
        ...raw,
        muse: { ...EMPTY_CONFIG.muse, ...(raw.muse || {}) },
        rule: { ...EMPTY_CONFIG.rule, ...(raw.rule || {}) },
        test_options: { ...EMPTY_CONFIG.test_options, ...(raw.test_options || {}) },
      };
      config.muse.login = { ...EMPTY_CONFIG.muse.login, ...(raw.muse?.login || {}) };
      config.muse.bridge = { ...EMPTY_CONFIG.muse.bridge, ...(raw.muse?.bridge || {}) };
      for (const key of [
        'logged_in_url_contains',
        'logged_out_url_contains',
        'logged_in_selectors',
        'logged_out_selectors',
        'cookie_names',
      ]) {
        config.muse.login[key] = arrayOfStrings(config.muse.login[key]);
      }
      config.muse.url = typeof config.muse.url === 'string' ? config.muse.url.trim() : '';
      config.muse.login.logged_in_url_contains = arrayOfStrings(config.muse.login.logged_in_url_contains);
      if (typeof config.muse.bridge.wait_timeout_ms !== 'number') config.muse.bridge.wait_timeout_ms = 180000;
      return config;
    } catch (error) {
      if (error.code === 'ENOENT') return JSON.parse(JSON.stringify(EMPTY_CONFIG));
      return { ...JSON.parse(JSON.stringify(EMPTY_CONFIG)), _loadError: error.message };
    }
  }

  reload() {
    this.config = this.read();
    this.mtimeMs = this.currentMtime();
    return this.config;
  }

  isConfigured() {
    return Boolean(this.config.muse.url && /^https?:\/\//i.test(this.config.muse.url));
  }

  loginCheckConfigured() {
    const login = this.config.muse.login;
    return Boolean(
      login.logged_in_url_contains.length ||
        login.logged_out_url_contains.length ||
        login.logged_in_selectors.length ||
        login.logged_out_selectors.length ||
        login.cookie_names.length,
    );
  }

  hasAutoBridge() {
    const bridge = this.config.muse.bridge;
    return Boolean(bridge.input_selector && bridge.send_selector && bridge.response_selector);
  }

  samplePlanEnabled() {
    const ruleIsEmpty = !String(this.config.rule?.prompt || '').trim();
    // Plan mẫu chỉ là đường test khi CHƯA gắn rule. Khi rule đã gắn,
    // mọi kế hoạch phải đi qua Muse; tránh bypass gate trong bản bán.
    return ruleIsEmpty && this.config.test_options.enable_sample_plan !== false;
  }

  buildPrompt(input, errors = []) {
    const rule = String(this.config.rule?.prompt || '').trim();
    const errorList = Array.isArray(errors) ? errors.filter(Boolean).map((entry) => `- ${String(entry)}`).join('\n') : '';
    return [
      'Bạn là Muse, não chính của 3AM Diary Studio.',
      'Hãy đọc INPUT JSON bên dưới và TỰ QUYẾT ĐỊNH kế hoạch video ngắn dọc: tiêu đề, thứ tự và nội dung từng phân đoạn, chọn meme/nhạc/SFX từ đúng kho đã cho.',
      'Không viết lại, không tóm tắt, không sửa bất kỳ chữ nào trong trường text của bình luận.',
      '',
      'CHỈ TRẢ VỀ MỘT JSON OBJECT hợp lệ, không markdown, không giải thích ngoài JSON.',
      'Schema bắt buộc:',
      '{"title":"string","segments":[{"comment_id":"string","text":"string","meme_id":"string","meme_duration":number,"sfx_id":"string"}],"music_id":"string","caption":"string","hashtags":["string"]}',
      '',
      'Ràng buộc:',
      '- segments chỉ dùng comment_id có trong INPUT.comments; mỗi comment_id đúng một lần.',
      '- text trong segments phải giống nguyên văn INPUT.comments[].text (byte-for-byte).',
      '- meme_id, sfx_id, music_id phải tồn tại trong INPUT.library.',
      '- settings.target_duration là mục tiêu 60-90 giây; meme_duration là số giây hiển thị meme, lớn hơn 0.',
      '- hashtags là mảng chuỗi, không cần dấu #.',
      '- Không bịa ID, không bịa bình luận, không tạo kết quả nếu thiếu dữ liệu.',
      rule ? `\nRULE BỔ SUNG CỦA MUSE:\n${rule}` : '',
      errorList ? `\nLỖI CẦN SỬA TỪ LẦN TRƯỚC (trả lại JSON đã sửa, không giải thích):\n${errorList}` : '',
      '\nINPUT JSON:',
      JSON.stringify(input, null, 2),
    ]
      .filter((line) => line !== '')
      .join('\n');
  }

  allowedOrigin() {
    if (!this.isConfigured()) return null;
    try {
      return new URL(this.config.muse.url).origin;
    } catch {
      return null;
    }
  }

  saveConfig(input = {}) {
    if (!input || typeof input !== 'object') throw configError('Thiếu dữ liệu cấu hình Muse.');
    const next = JSON.parse(JSON.stringify(this.config));
    delete next._loadError;

    if ('name' in input) {
      const name = stringField(input.name, 'Muse');
      next.muse.name = (name || 'Muse').slice(0, 80);
    }
    if ('url' in input) next.muse.url = normalizeMuseUrl(input.url);

    if (input.login && typeof input.login === 'object') {
      for (const key of ['logged_in_url_contains', 'logged_out_url_contains', 'logged_in_selectors', 'logged_out_selectors', 'cookie_names']) {
        if (key in input.login) next.muse.login[key] = arrayOfStrings(input.login[key]);
      }
    }

    if (input.rule && typeof input.rule === 'object') {
      if ('prompt' in input.rule) {
        const prompt = stringField(input.rule.prompt).slice(0, 20000);
        if (prompt !== next.rule.prompt) {
          const hadPrompt = Boolean(next.rule.prompt);
          next.rule.prompt = prompt;
          next.rule.version = prompt ? (hadPrompt ? (Number(next.rule.version) || 0) + 1 : 1) : 0;
        }
      }
    }

    if (input.bridge && typeof input.bridge === 'object') {
      const bridge = input.bridge;
      if ('mode' in bridge) {
        next.muse.bridge.mode = bridge.mode === 'auto' ? 'auto' : 'manual';
      }
      for (const key of ['new_chat_url', 'input_selector', 'send_selector', 'response_selector']) {
        if (key in bridge) next.muse.bridge[key] = stringField(bridge[key]);
      }
      if ('wait_timeout_ms' in bridge) {
        const wait = Number(bridge.wait_timeout_ms);
        if (!Number.isFinite(wait) || wait < 15000 || wait > 600000) {
          throw configError('Thời gian chờ Muse phải từ 15000 đến 600000 ms.');
        }
        next.muse.bridge.wait_timeout_ms = Math.round(wait);
      }
    }

    const serialized = `${JSON.stringify(next, null, 2)}\n`;
    fs.mkdirSync(path.dirname(this.configFile), { recursive: true });
    const tempFile = `${this.configFile}.${process.pid}.tmp`;
    fs.writeFileSync(tempFile, serialized, 'utf8');
    fs.renameSync(tempFile, this.configFile);
    this.config = this.read();
    this.mtimeMs = this.currentMtime();
    return this.config;
  }

  publicInfo() {
    return {
      name: this.config.muse.name || 'Muse',
      configured: this.isConfigured(),
      loginCheckConfigured: this.loginCheckConfigured(),
      url: this.config.muse.url || '',
      login: {
        cookie_names: [...this.config.muse.login.cookie_names],
        logged_in_url_contains: [...this.config.muse.login.logged_in_url_contains],
        logged_out_url_contains: [...this.config.muse.login.logged_out_url_contains],
        logged_in_selectors: [...this.config.muse.login.logged_in_selectors],
        logged_out_selectors: [...this.config.muse.login.logged_out_selectors],
      },
      bridge: {
        mode: this.config.muse.bridge.mode || 'manual',
        autoReady: this.hasAutoBridge(),
        newChatUrl: this.config.muse.bridge.new_chat_url || '',
        inputSelector: this.config.muse.bridge.input_selector || '',
        sendSelector: this.config.muse.bridge.send_selector || '',
        responseSelector: this.config.muse.bridge.response_selector || '',
        waitTimeoutMs: Number(this.config.muse.bridge.wait_timeout_ms) || 180000,
      },
      rule: {
        prompt: this.config.rule.prompt || '',
        version: Number(this.config.rule.version) || 0,
      },
      ruleAttached: Boolean(this.config.rule.prompt && this.config.rule.prompt.trim()),
      ruleVersion: Number(this.config.rule.version) || 0,
      samplePlanEnabled: this.samplePlanEnabled(),
      configFile: path.basename(this.configFile),
      loadError: this.config._loadError || null,
    };
  }
}

module.exports = { MuseRuleSlot, EMPTY_CONFIG };
