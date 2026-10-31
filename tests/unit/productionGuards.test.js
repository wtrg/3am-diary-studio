'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { assertScreenshotCoverage } = require('../../app/main/render/productionGuards');

test('production requires a real post screenshot and every segment comment screenshot', () => {
  const segments = [{ comment_id: 'c1' }, { comment_id: 'c2' }];
  assert.equal(assertScreenshotCoverage(segments, { post: 'post.png', comments: { c1: 'c1.png', c2: 'c2.png' } }), true);
});

test('missing post screenshot stops the job instead of drawing a fake card', () => {
  assert.throws(
    () => assertScreenshotCoverage([{ comment_id: 'c1' }], { comments: { c1: 'c1.png' } }),
    (error) => error.code === 'SCREENSHOT_MATCH_FAILED' && /post/.test(error.message),
  );
});

test('missing comment screenshot stops the job and names the comment', () => {
  assert.throws(
    () => assertScreenshotCoverage([{ comment_id: 'c1' }, { comment_id: 'missing' }], { post: 'post.png', comments: { c1: 'c1.png' } }),
    (error) => error.code === 'SCREENSHOT_MATCH_FAILED' && /missing/.test(error.message),
  );
});
