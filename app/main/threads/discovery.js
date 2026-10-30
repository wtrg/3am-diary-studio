'use strict';

// Không đưa "cho" vào stopword vì "chó" (dog) và "cho" (for) cùng dạng sau khi bỏ dấu.
const STOPWORDS = new Set([
  'va', 'cua', 'voi', 'la', 'co', 'cac', 'nhung', 'mot', 'nhu', 'de', 'tren', 'duoi',
  'trong', 'ngoai', 'khi', 'thi', 'ma', 'nay', 'do', 'roi', 'lai', 'cung', 've', 'tu', 'den',
  'and', 'the', 'for', 'with', 'about', 'from', 'this', 'that', 'are', 'you',
]);

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[^\p{L}\p{N}\s#]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function extractTokens(topic) {
  const normalized = normalizeText(topic).replace(/#/g, ' ').trim();
  if (!normalized) return [];
  const words = normalized.split(/\s+/).filter((word) => word.length >= 2 && !STOPWORDS.has(word));
  if (words.length) return [...new Set(words)].slice(0, 8);
  return normalized ? [normalized] : [];
}

function ageHoursFrom(iso, now = Date.now()) {
  if (!iso) return null;
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) return null;
  const hours = (now - timestamp) / 3600000;
  if (!Number.isFinite(hours)) return null;
  return Math.max(0, hours);
}

function trendScore({ likes, comments, shares, ageHours, maxAgeHours, relevance }) {
  const engagement = Math.max(0, likes) + Math.max(0, comments) * 2 + Math.max(0, shares) * 3;
  const freshness = 1 - Math.min(1, ageHours / Math.max(1, maxAgeHours));
  return Math.round((Math.log10(1 + engagement) * 2.1 + freshness * 4 + relevance * 2) * 100) / 100;
}

function mergeCandidates(rawPosts) {
  const byCode = new Map();
  for (const post of rawPosts) {
    if (!post || !post.code) continue;
    const existing = byCode.get(post.code);
    if (!existing) {
      byCode.set(post.code, { ...post });
      continue;
    }
    existing.likes = Math.max(existing.likes || 0, post.likes || 0);
    existing.comments_count = Math.max(existing.comments_count || 0, post.comments_count || 0);
    existing.shares_count = Math.max(existing.shares_count || 0, post.shares_count || 0);
    existing.text = existing.text || post.text;
    existing.taken_at = existing.taken_at || post.taken_at;
    existing.author = existing.author || post.author;
    if (!existing.pathHint && post.pathHint) existing.pathHint = post.pathHint;
  }
  return [...byCode.values()];
}

function candidateUrl(post) {
  if (!post.author || !post.code) return '';
  return `https://www.threads.com/@${encodeURIComponent(post.author)}/post/${encodeURIComponent(post.code)}`;
}

function buildCandidates(rawPosts, options = {}) {
  const {
    topic = '',
    limit = 5,
    maxAgeHours = 72,
    sort = 'trend',
    now = Date.now(),
    requireSearchPath = true,
  } = options;
  const safeLimit = Math.max(1, Math.min(20, Number(limit) || 5));
  const safeMaxAge = Math.max(1, Math.min(24 * 30, Number(maxAgeHours) || 72));
  const tokens = extractTokens(topic);
  const posts = mergeCandidates(Array.isArray(rawPosts) ? rawPosts : []);
  const stats = {
    raw: Array.isArray(rawPosts) ? rawPosts.length : 0,
    unique: posts.length,
    filtered_reply: 0,
    filtered_old: 0,
    filtered_no_age: 0,
    filtered_relevance: 0,
    filtered_quoted: 0,
    selected: 0,
  };
  const candidates = [];

  for (const post of posts) {
    const path = String(post.pathHint || '');
    if (/quoted_attachment_post|share_info|suggested|related/i.test(path)) {
      stats.filtered_quoted += 1;
      continue;
    }
    if (requireSearchPath && !/searchResults/i.test(path)) {
      stats.filtered_quoted += 1;
      continue;
    }
    if (post.is_reply || post.parent_code) {
      stats.filtered_reply += 1;
      continue;
    }
    if (!post.text || !post.text.trim() || !post.code || !post.author) {
      stats.filtered_relevance += 1;
      continue;
    }
    const ageHours = ageHoursFrom(post.taken_at, now);
    if (ageHours === null) {
      stats.filtered_no_age += 1;
      continue;
    }
    if (ageHours > safeMaxAge) {
      stats.filtered_old += 1;
      continue;
    }
    const textNormalized = normalizeText(post.text);
    const matched = tokens.filter((token) => textNormalized.includes(token));
    if (tokens.length && matched.length === 0) {
      stats.filtered_relevance += 1;
      continue;
    }
    const relevance = tokens.length ? matched.length / tokens.length : 0;
    const score = trendScore({
      likes: post.likes,
      comments: post.comments_count,
      shares: post.shares_count,
      ageHours,
      maxAgeHours: safeMaxAge,
      relevance,
    });
    candidates.push({
      post_id: post.code,
      code: post.code,
      author: post.author,
      time: post.taken_at,
      text: post.text,
      likes: Number(post.likes) || 0,
      comments_count: Number(post.comments_count) || 0,
      shares_count: Number(post.shares_count) || 0,
      age_hours: Math.round(ageHours * 10) / 10,
      trend_score: score,
      relevance: Math.round(relevance * 100) / 100,
      matched_terms: matched,
      has_comments: (Number(post.comments_count) || 0) > 0,
      url: candidateUrl(post),
      source: 'threads',
    });
  }

  if (sort === 'recent') {
    candidates.sort((a, b) => {
      const at = Date.parse(a.time) || 0;
      const bt = Date.parse(b.time) || 0;
      if (bt !== at) return bt - at;
      return b.trend_score - a.trend_score;
    });
  } else {
    candidates.sort((a, b) => {
      if (b.trend_score !== a.trend_score) return b.trend_score - a.trend_score;
      return (Date.parse(b.time) || 0) - (Date.parse(a.time) || 0);
    });
  }

  const selected = candidates.slice(0, safeLimit);
  stats.selected = selected.length;
  const warnings = [];
  const filteredBits = [];
  if (stats.filtered_old) filteredBits.push(`${stats.filtered_old} bài cũ hơn ${safeMaxAge} giờ`);
  if (stats.filtered_no_age) filteredBits.push(`${stats.filtered_no_age} bài thiếu thời gian đăng`);
  if (stats.filtered_relevance) filteredBits.push(`${stats.filtered_relevance} bài không khớp chủ đề`);
  if (stats.filtered_quoted) filteredBits.push(`${stats.filtered_quoted} mục trích dẫn/gợi ý`);
  if (filteredBits.length) warnings.push(`Đã lọc bỏ ${filteredBits.join(', ')}.`);
  if (selected.length < safeLimit) {
    warnings.push(
      `Chỉ tìm được ${selected.length}/${safeLimit} bài mới phù hợp trong ${safeMaxAge} giờ. Tool không tự tạo thêm bài.`,
    );
  }

  return {
    candidates: selected,
    tokens,
    stats,
    warnings,
    requested: safeLimit,
    found: selected.length,
    maxAgeHours: safeMaxAge,
  };
}

function buildSearchUrl(topic, sort = 'trend') {
  const query = String(topic || '').trim();
  const type = sort === 'recent' ? 'recent' : 'default';
  return `https://www.threads.com/search?q=${encodeURIComponent(query)}&serp_type=${type}`;
}

module.exports = {
  STOPWORDS,
  normalizeText,
  extractTokens,
  ageHoursFrom,
  trendScore,
  mergeCandidates,
  buildCandidates,
  buildSearchUrl,
  candidateUrl,
};
