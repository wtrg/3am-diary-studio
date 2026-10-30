'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { MuseRuleSlot } = require('../../app/main/museRule');

function tempRule(t, config) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), '3am-muse-rule-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'muse_rule.json');
  fs.writeFileSync(file, JSON.stringify(config, null, 2));
  return new MuseRuleSlot(file);
}

test('sample plan is enabled while the Muse rule slot is empty', (t) => {
  const slot = tempRule(t, {
    muse: { url: '', login: {}, bridge: {} },
    rule: { prompt: '', version: 0 },
    test_options: { enable_sample_plan: true },
  });
  assert.equal(slot.samplePlanEnabled(), true);
  assert.equal(slot.isConfigured(), false);
  assert.equal(slot.loginCheckConfigured(), false);
});

test('sample plan automatically disables once a Muse rule is attached', (t) => {
  const slot = tempRule(t, {
    muse: { url: 'https://muse.example/', login: { cookie_names: ['sid'] }, bridge: {} },
    rule: { prompt: 'RULE MUSE THẬT', version: 1 },
    test_options: { enable_sample_plan: true },
  });
  assert.equal(slot.isConfigured(), true);
  assert.equal(slot.loginCheckConfigured(), true);
  assert.equal(slot.samplePlanEnabled(), false);
});

test('sample plan can be disabled explicitly while slot is empty', (t) => {
  const slot = tempRule(t, {
    muse: { url: '', login: {}, bridge: {} },
    rule: { prompt: '', version: 0 },
    test_options: { enable_sample_plan: false },
  });
  assert.equal(slot.samplePlanEnabled(), false);
});

test('saveConfig persists the Muse URL and login signals without touching the rule prompt', (t) => {
  const slot = tempRule(t, {
    muse: { url: '', login: {}, bridge: {} },
    rule: { prompt: 'RULE MUSE THẬT', version: 7 },
    test_options: { enable_sample_plan: false },
  });
  const saved = slot.saveConfig({
    name: ' Muse riêng ',
    url: 'https://muse.example.com/app?x=1',
    login: {
      cookie_names: [' session_id ', '', 'auth_token'],
      logged_in_url_contains: ['/app'],
      logged_in_selectors: ['[data-me]'],
    },
    bridge: {
      mode: 'auto',
      input_selector: '#input',
      send_selector: '#send',
      response_selector: '#response',
      wait_timeout_ms: 30000,
    },
  });
  assert.equal(saved.muse.url, 'https://muse.example.com/app?x=1');
  assert.deepEqual(saved.muse.login.cookie_names, ['session_id', 'auth_token']);
  assert.equal(saved.muse.login.logged_in_url_contains[0], '/app');
  assert.equal(saved.muse.bridge.wait_timeout_ms, 30000);
  assert.equal(saved.rule.prompt, 'RULE MUSE THẬT');
  assert.equal(saved.rule.version, 7);
  assert.equal(slot.samplePlanEnabled(), false);
  const onDisk = JSON.parse(fs.readFileSync(slot.configFile, 'utf8'));
  assert.equal(onDisk.muse.bridge.input_selector, '#input');
  assert.equal(onDisk.muse.name, 'Muse riêng');
  assert.ok(slot.publicInfo().login.cookie_names.includes('session_id'));
  assert.equal(slot.publicInfo().bridge.inputSelector, '#input');
});

test('saveConfig rejects non-http URLs and embedded credentials', (t) => {
  const slot = tempRule(t, { muse: { url: '', login: {}, bridge: {} }, rule: { prompt: '', version: 0 } });
  assert.throws(() => slot.saveConfig({ url: 'file:///etc/passwd' }), /http/i);
  assert.throws(() => slot.saveConfig({ url: 'javascript:alert(1)' }), /http/i);
  assert.throws(() => slot.saveConfig({ url: 'https://user:secret@muse.example.com/' }), /mật khẩu/i);
  assert.throws(() => slot.saveConfig({ url: 'https://muse.example.com/', bridge: { wait_timeout_ms: 1000 } }), /15000/);
});

test('saveConfig creates the config file when the slot is empty', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), '3am-muse-rule-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'nested', 'muse_rule.json');
  const slot = new MuseRuleSlot(file);
  assert.equal(slot.isConfigured(), false);
  slot.saveConfig({ url: 'http://127.0.0.1:9444/', login: { cookie_names: ['muse_test_session'] } });
  assert.equal(slot.isConfigured(), true);
  assert.equal(slot.loginCheckConfigured(), true);
  assert.equal(fs.existsSync(file), true);
});

test('buildPrompt embeds the contract, verbatim rule, extra Muse rule and validation errors', (t) => {
  const slot = tempRule(t, {
    muse: { url: 'https://muse.example/', login: { cookie_names: ['sid'] }, bridge: {} },
    rule: { prompt: 'Ưu tiên meme GIF, nhịp nhanh.', version: 2 },
    test_options: { enable_sample_plan: true },
  });
  const input = {
    post: { post_id: 'p1', text: 'bài gốc' },
    comments: [{ comment_id: 'c1', text: 'bình luận nguyên văn' }],
    library: [{ meme_id: 'm1', tags: ['hài'], duration: 0 }],
    settings: { target_duration: 60 },
  };
  const prompt = slot.buildPrompt(input, ['UNKNOWN_MEME_ID: m2', 'TEXT_MISMATCH: c1']);
  assert.match(prompt, /Muse, não chính/);
  assert.match(prompt, /byte-for-byte/);
  assert.match(prompt, /comment_id/);
  assert.match(prompt, /Ưu tiên meme GIF/);
  assert.match(prompt, /UNKNOWN_MEME_ID: m2/);
  assert.match(prompt, /bình luận nguyên văn/);
  assert.match(prompt, /"meme_id": "m1"/);
  assert.doesNotMatch(prompt, /mật khẩu|password/i);
});

test('an invalid config file fails closed for Muse and keeps a load error', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), '3am-muse-rule-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'muse_rule.json');
  fs.writeFileSync(file, '{broken');
  const slot = new MuseRuleSlot(file);
  assert.equal(slot.isConfigured(), false);
  assert.ok(slot.publicInfo().loadError);
});
