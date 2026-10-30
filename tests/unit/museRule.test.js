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

test('an invalid config file fails closed for Muse and keeps a load error', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), '3am-muse-rule-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'muse_rule.json');
  fs.writeFileSync(file, '{broken');
  const slot = new MuseRuleSlot(file);
  assert.equal(slot.isConfigured(), false);
  assert.ok(slot.publicInfo().loadError);
});
