'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildNarrationText } = require('../../app/main/tts');

test('narration text reads the Muse title and comment text verbatim', () => {
  const plan = {
    title: 'Tiêu đề hook',
    segments: [
      { comment_id: 'c1', text: 'Bình luận một, giữ nguyên văn.' },
      { comment_id: 'c2', text: 'Bình luận hai =))' },
    ],
  };
  assert.equal(
    buildNarrationText(plan),
    'Tiêu đề hook\n\nBình luận một, giữ nguyên văn.\n\nBình luận hai =))',
  );
  assert.equal(buildNarrationText({ title: '', segments: [] }), '');
});
