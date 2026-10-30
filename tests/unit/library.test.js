'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Library, normalizeTags } = require('../../app/main/library');

const ROOT = path.resolve(__dirname, '..', '..');
const DEMO_IMAGE = path.join(ROOT, 'demo', 'assets', 'memes', 'dog_sideeye.png');
const DEMO_MUSIC = path.join(ROOT, 'demo', 'assets', 'audio', 'lofi_night.wav');
const DEMO_MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'demo', 'assets.json'), 'utf8'));

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), '3am-lib-test-'));
}

function stage(dataDir, source, name) {
  const dir = path.join(dataDir, 'tmp');
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, name);
  fs.copyFileSync(source, target);
  return target;
}

test('tags are trimmed, deduped case-insensitively, and capped', () => {
  assert.deepEqual(normalizeTags([' chó ', 'Chó', 'mèo', '  ', '3am']), ['chó', 'mèo', '3am']);
});

test('library assigns immutable unique ids and preserves them when editing tags/name', async (t) => {
  const dir = tempDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const library = new Library(dir);
  const image = await library.addFromTempFile({
    tempFile: stage(dir, DEMO_IMAGE, 'reaction.png'),
    originalName: 'reaction.png',
    kind: 'meme',
    name: 'Chó liếc',
    tags: ['chó', 'hài'],
    mime: 'image/png',
  });
  assert.match(image.id, /^meme_[a-f0-9]{12}$/);
  assert.equal(image.mediaType, 'image');
  assert.equal(image.duration, 0);

  const updated = await library.update(image.id, { name: 'Tên mới', tags: ['mèo', 'mèo', 'vui'] });
  assert.equal(updated.id, image.id);
  assert.equal(updated.file, image.file);
  assert.equal(updated.name, 'Tên mới');
  assert.deepEqual(updated.tags, ['mèo', 'vui']);

  const rehydrated = new Library(dir);
  const found = rehydrated.get(image.id);
  assert.equal(found.id, image.id);
  assert.equal(found.name, 'Tên mới');
  assert.deepEqual(found.tags, ['mèo', 'vui']);
});

test('library rejects invalid kinds and extensions', async (t) => {
  const dir = tempDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const library = new Library(dir);
  await assert.rejects(
    library.addFromTempFile({
      tempFile: stage(dir, DEMO_IMAGE, 'bad.png'),
      originalName: 'bad.png',
      kind: 'background',
      name: 'bad',
      tags: [],
    }),
    /không được hỗ trợ/i,
  );
});

test('demo import is idempotent and keeps stable ids', async (t) => {
  const dir = tempDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const library = new Library(dir);
  for (const entry of DEMO_MANIFEST) {
    await library.importDemoItem({
      id: entry.id,
      kind: entry.kind,
      name: entry.name,
      tags: entry.tags,
      sourceFile: path.join(ROOT, 'demo', 'assets', entry.file),
      mime: entry.mime,
      mediaType: entry.mediaType,
      duration: entry.duration,
    });
  }
  assert.equal(library.list().length, DEMO_MANIFEST.length);
  await library.update('music_demo_lofi', { tags: ['người dùng sửa'] });
  for (const entry of DEMO_MANIFEST) {
    await library.importDemoItem({
      id: entry.id,
      kind: entry.kind,
      name: entry.name,
      tags: entry.tags,
      sourceFile: path.join(ROOT, 'demo', 'assets', entry.file),
      mime: entry.mime,
      mediaType: entry.mediaType,
    });
  }
  assert.equal(library.list().length, DEMO_MANIFEST.length);
  assert.deepEqual(library.get('music_demo_lofi').tags, ['người dùng sửa']);
  assert.ok(fs.existsSync(library.mediaPath(library.get('bg_demo_cozy'))));
});

test('deleting removes metadata and media', async (t) => {
  const dir = tempDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const library = new Library(dir);
  const item = await library.addFromTempFile({
    tempFile: stage(dir, DEMO_MUSIC, 'lofi.wav'),
    originalName: 'lofi.wav',
    kind: 'music',
    name: 'Lofi',
    tags: ['nhẹ'],
    mime: 'audio/wav',
  });
  const file = library.mediaPath(item);
  assert.ok(fs.existsSync(file));
  assert.ok(item.duration > 0);
  await library.remove(item.id);
  assert.equal(library.get(item.id), null);
  assert.equal(fs.existsSync(file), false);
});
