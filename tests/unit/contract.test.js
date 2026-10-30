'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  buildMuseInput,
  preflightInput,
  validatePlan,
  extractJsonText,
  hashInput,
} = require('../../app/main/contract');

const ROOT = path.resolve(__dirname, '..', '..');
const demoPost = JSON.parse(fs.readFileSync(path.join(ROOT, 'demo', 'demo-post.json'), 'utf8'));
const samplePlan = JSON.parse(fs.readFileSync(path.join(ROOT, 'demo', 'sample-plan.json'), 'utf8'));
const invalidPlan = JSON.parse(fs.readFileSync(path.join(ROOT, 'demo', 'invalid-plan.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'demo', 'assets.json'), 'utf8'));

function demoLibrary() {
  return manifest.map((entry) => ({
    id: entry.id,
    kind: entry.kind,
    name: entry.name,
    tags: entry.tags,
    duration: entry.kind === 'meme' ? 0 : 10,
  }));
}

function demoInput() {
  return buildMuseInput({
    post: demoPost.post,
    comments: demoPost.comments,
    library: demoLibrary(),
    settings: {
      voice: 'Giọng nữ kể chuyện (ấm, chậm)',
      background_video_id: 'bg_demo_cozy',
      watermark: '@3am.diary.demo',
      target_duration: 60,
    },
  });
}

test('buildMuseInput follows the contract and preserves comment text', () => {
  const input = demoInput();
  assert.deepEqual(Object.keys(input).sort(), ['comments', 'library', 'post', 'settings'].sort());
  assert.equal(input.comments.length, 5);
  for (const comment of input.comments) {
    assert.deepEqual(Object.keys(comment).sort(), ['author', 'comment_id', 'likes', 'text', 'time'].sort());
    assert.equal(comment.text, demoPost.comments.find((item) => item.comment_id === comment.comment_id).text);
  }
  assert.equal(input.settings.background_video_id, 'bg_demo_cozy');
  assert.ok(input.library.some((item) => item.meme_id === 'meme_demo_dog_sideeye'));
  assert.ok(input.library.some((item) => item.music_id === 'music_demo_lofi'));
  assert.ok(input.library.some((item) => item.sfx_id === 'sfx_demo_pop'));
  assert.ok(input.library.some((item) => item.background_video_id === 'bg_demo_cozy'));
});

test('preflight accepts the demo and reports missing pieces', () => {
  const input = demoInput();
  assert.deepEqual(preflightInput(input, demoLibrary()), []);
  const errors = preflightInput({ ...input, settings: { ...input.settings, background_video_id: '' } }, demoLibrary());
  assert.ok(errors.some((error) => error.code === 'BACKGROUND_NOT_SELECTED'));
  const missingLibrary = demoLibrary().filter((item) => item.kind !== 'music');
  assert.ok(preflightInput(input, missingLibrary).some((error) => error.code === 'MUSIC_REQUIRED'));
});

test('sample plan validates; invalid plan is rejected with every required rule', () => {
  const input = demoInput();
  const valid = validatePlan(samplePlan, input);
  assert.equal(valid.ok, true, JSON.stringify(valid.errors));
  assert.deepEqual(valid.plan, samplePlan);

  const invalidSnapshot = JSON.parse(JSON.stringify(invalidPlan));
  const invalid = validatePlan(invalidPlan, input);
  assert.equal(invalid.ok, false);
  const codes = new Set(invalid.errors.map((error) => error.code));
  for (const code of ['TEXT_MISMATCH', 'UNKNOWN_MEME_ID', 'UNKNOWN_SFX_ID', 'UNKNOWN_COMMENT_ID', 'UNKNOWN_MUSIC_ID']) {
    assert.ok(codes.has(code), `missing ${code}: ${[...codes].join(',')}`);
  }
  assert.deepEqual(invalidPlan, invalidSnapshot, 'validator must not mutate input');
});

test('unknown ids anywhere are blocked and text must be byte-for-byte', () => {
  const input = demoInput();
  const plan = JSON.parse(JSON.stringify(samplePlan));
  plan.segments[0].meme_id = 'meme_unknown';
  plan.segments[1].sfx_id = 'sfx_unknown';
  plan.segments[2].text += ' ';
  plan.music_id = 'music_unknown';
  const result = validatePlan(plan, input);
  assert.equal(result.ok, false);
  const codes = result.errors.map((error) => error.code);
  assert.ok(codes.includes('UNKNOWN_MEME_ID'));
  assert.ok(codes.includes('UNKNOWN_SFX_ID'));
  assert.ok(codes.includes('TEXT_MISMATCH'));
  assert.ok(codes.includes('UNKNOWN_MUSIC_ID'));
});

test('duplicate comment ids in plan are rejected', () => {
  const input = demoInput();
  const plan = JSON.parse(JSON.stringify(samplePlan));
  plan.segments[1].comment_id = plan.segments[0].comment_id;
  plan.segments[1].text = plan.segments[0].text;
  const result = validatePlan(plan, input);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === 'DUPLICATE_COMMENT'));
});

test('extractJsonText handles fences and surrounding text but never repairs malformed JSON', () => {
  assert.deepEqual(extractJsonText('```json\n{"a":1}\n```').value, { a: 1 });
  assert.deepEqual(extractJsonText('Kết quả:\n{"title":"x"}\nHết.').value, { title: 'x' });
  assert.match(extractJsonText('{"title": ').error, /không đóng ngoặc/i);
  assert.match(extractJsonText('not json').error, /Không tìm thấy JSON/i);
});

test('input hash is stable across object key order', () => {
  const a = demoInput();
  const b = JSON.parse(JSON.stringify(a));
  b.settings = { target_duration: b.settings.target_duration, voice: b.settings.voice, watermark: b.settings.watermark, background_video_id: b.settings.background_video_id };
  assert.equal(hashInput(a), hashInput(b));
});
