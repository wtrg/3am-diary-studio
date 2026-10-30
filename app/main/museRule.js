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

class MuseRuleSlot {
  constructor(configFile) {
    this.configFile = configFile;
    this.config = this.read();
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

  allowedOrigin() {
    if (!this.isConfigured()) return null;
    try {
      return new URL(this.config.muse.url).origin;
    } catch {
      return null;
    }
  }

  publicInfo() {
    return {
      name: this.config.muse.name || 'Muse',
      configured: this.isConfigured(),
      loginCheckConfigured: this.loginCheckConfigured(),
      url: this.config.muse.url || '',
      bridge: {
        mode: this.config.muse.bridge.mode || 'manual',
        autoReady: this.hasAutoBridge(),
        newChatUrl: this.config.muse.bridge.new_chat_url || '',
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
