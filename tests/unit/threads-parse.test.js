'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  parseThreadsUrl,
  collectFromPayloads,
  payloadsFromPageScripts,
} = require('../../app/main/threads/parse');

const ROOT = path.resolve(__dirname, '..', '..');
const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'threads-graphql.json'), 'utf8'));

const URL = 'https://www.threads.com/@main_author/post/DEMO123';

test('parseThreadsUrl accepts threads.com/net post links and rejects other hosts', () => {
  assert.equal(parseThreadsUrl(URL).code, 'DEMO123');
  assert.equal(parseThreadsUrl('https://threads.net/@x/post/ABC').username, 'x');
  assert.throws(() => parseThreadsUrl('https://example.com/@x/post/ABC'), /thread/i);
  assert.throws(() => parseThreadsUrl('https://www.threads.com/@x'), /mã bài/i);
});

test('collectFromPayloads keeps the main post and verbatim reply comments only', () => {
  const result = collectFromPayloads([{ url: 'network:graphql', json: fixture }], URL);
  assert.equal(result.ok, true);
  assert.equal(result.post.author, 'main_author');
  assert.match(result.post.text, /Bài gốc/);
  assert.equal(result.comments.length, 3);
  assert.deepEqual(result.comments.map((comment) => comment.comment_id), ['R1', 'R2', 'R3']);
  assert.equal(result.comments[0].text, 'Bình luận một\ngiữ nguyên xuống dòng.');
  assert.equal(result.comments[0].likes, 55);
  assert.ok(!result.comments.some((comment) => comment.comment_id === 'SUG1'), 'suggested post must not be a comment');
  assert.equal(result.comments[0].time, new Date(1720000100 * 1000).toISOString());
  assert.ok(result.warnings.some((warning) => /báo 5 bình luận/i.test(warning)));
});

test('duplicate payloads are deduped by post code', () => {
  const result = collectFromPayloads(
    [
      { url: 'network:graphql', json: fixture },
      { url: 'network:graphql', json: fixture },
    ],
    URL,
  );
  assert.equal(result.comments.length, 3);
});

test('page embedded JSON scripts are parsed separately', () => {
  const payloads = payloadsFromPageScripts([JSON.stringify(fixture), 'not json', 'for (;;);' + JSON.stringify(fixture)]);
  assert.equal(payloads.length, 2);
  const result = collectFromPayloads(payloads, URL);
  assert.equal(result.comments.length, 3);
});

test('no post data yields a clear error instead of fabricated content', () => {
  const result = collectFromPayloads([{ url: 'network:graphql', json: { data: {} } }], URL);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'NO_POST_DATA');
});
