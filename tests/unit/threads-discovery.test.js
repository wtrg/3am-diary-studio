'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeText,
  extractTokens,
  buildCandidates,
  buildSearchUrl,
  ageHoursFrom,
} = require('../../app/main/threads/discovery');

const NOW = Date.parse('2026-10-31T00:00:00.000Z');
const isoHoursAgo = (hours) => new Date(NOW - hours * 3600000).toISOString();

function post(overrides = {}) {
  return {
    id: overrides.code || 'code',
    code: overrides.code || 'code',
    author: overrides.author || 'main_author',
    text: overrides.text ?? 'Mèo nhà tôi nhìn chằm chằm vào góc tường.',
    taken_at: overrides.taken_at ?? isoHoursAgo(2),
    likes: overrides.likes ?? 120,
    comments_count: overrides.comments_count ?? 12,
    shares_count: overrides.shares_count ?? 3,
    is_reply: overrides.is_reply || false,
    parent_code: overrides.parent_code || '',
    pathHint: overrides.pathHint || '$.data.searchResults.edges[0].node.thread.thread_items[0].post',
  };
}

test('normalizes Vietnamese diacritics for topic relevance', () => {
  assert.equal(normalizeText('Chó MÈO 🐱 đáng yêu'), 'cho meo dang yeu');
  assert.deepEqual(extractTokens('Chó mèo đáng yêu'), ['cho', 'meo', 'dang', 'yeu']);
  assert.deepEqual(extractTokens('mèo đang ngủ'), ['meo', 'dang', 'ngu']);
  assert.equal(extractTokens('#mèo')[0], 'meo');
  assert.equal(ageHoursFrom(isoHoursAgo(2), NOW), 2);
});

test('filters old posts, replies, quoted posts, missing time and unrelated topics', () => {
  const raw = [
    post({ code: 'FRESH', text: 'Mèo nhà tôi rất quậy.', taken_at: isoHoursAgo(2) }),
    post({ code: 'OLD', text: 'Mèo cũ rồi.', taken_at: isoHoursAgo(100) }),
    post({ code: 'NOTIME', text: 'Mèo không rõ ngày.', taken_at: '' }),
    post({ code: 'REPLY', text: 'Mèo reply', is_reply: true }),
    post({ code: 'QUOTED', text: 'Mèo quoted', pathHint: '$.data.searchResults.edges[0].node.thread.thread_items[0].post.text_post_app_info.share_info.quoted_attachment_post' }),
    post({ code: 'UNRELATED', text: 'Cách luộc thịt heo ngon.', taken_at: isoHoursAgo(1) }),
    post({ code: 'OTHERPATH', text: 'Mèo trong suggested', pathHint: '$.data.suggested.edges[0].post' }),
  ];
  const result = buildCandidates(raw, { topic: 'mèo', limit: 5, maxAgeHours: 72, now: NOW });
  assert.deepEqual(result.candidates.map((candidate) => candidate.code), ['FRESH']);
  assert.equal(result.stats.filtered_old, 1);
  assert.equal(result.stats.filtered_no_age, 1);
  assert.equal(result.stats.filtered_reply, 1);
  assert.ok(result.stats.filtered_relevance >= 1);
  assert.ok(result.stats.filtered_quoted >= 1);
  assert.ok(result.warnings.some((warning) => /cũ hơn 72 giờ/.test(warning)));
  assert.ok(result.warnings.length > 0);
});

test('dedupes by code, keeps strongest metrics, and caps result count', () => {
  const raw = [
    post({ code: 'A', likes: 10, comments_count: 1 }),
    post({ code: 'A', likes: 500, comments_count: 9 }),
    post({ code: 'B', text: 'Mèo thứ hai', likes: 5 }),
    post({ code: 'C', text: 'Mèo thứ ba', likes: 1 }),
  ];
  const result = buildCandidates(raw, { topic: 'mèo', limit: 2, maxAgeHours: 72, now: NOW });
  assert.equal(result.found, 2);
  assert.equal(result.candidates[0].code, 'A');
  assert.equal(result.candidates[0].likes, 500);
  assert.equal(result.stats.unique, 3);
});

test('sorts by trend or recency and produces safe URLs', () => {
  const raw = [
    post({ code: 'OLD_BUT_VIRAL', text: 'Mèo viral', likes: 9000, comments_count: 100, taken_at: isoHoursAgo(60) }),
    post({ code: 'NEW', text: 'Mèo mới', likes: 20, comments_count: 1, taken_at: isoHoursAgo(1) }),
  ];
  const trend = buildCandidates(raw, { topic: 'mèo', limit: 2, maxAgeHours: 72, sort: 'trend', now: NOW });
  const recent = buildCandidates(raw, { topic: 'mèo', limit: 2, maxAgeHours: 72, sort: 'recent', now: NOW });
  assert.equal(trend.candidates[0].code, 'OLD_BUT_VIRAL');
  assert.equal(recent.candidates[0].code, 'NEW');
  assert.equal(trend.candidates[0].url, 'https://www.threads.com/@main_author/post/OLD_BUT_VIRAL');
});

test('returns zero with an explicit warning instead of invented content', () => {
  const result = buildCandidates([post({ text: 'Mèo cũ', taken_at: isoHoursAgo(500) })], {
    topic: 'mèo',
    limit: 5,
    maxAgeHours: 24,
    now: NOW,
  });
  assert.equal(result.found, 0);
  assert.equal(result.candidates.length, 0);
  assert.ok(result.warnings.some((warning) => /0\/5/.test(warning)));
});

test('builds Threads search URLs for trend/recent', () => {
  assert.match(buildSearchUrl('chó mèo', 'trend'), /search\?q=ch%C3%B3%20m%C3%A8o&serp_type=default/);
  assert.match(buildSearchUrl('mèo', 'recent'), /serp_type=recent/);
});
