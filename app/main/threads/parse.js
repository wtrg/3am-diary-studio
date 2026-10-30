'use strict';

const THREADS_HOSTS = new Set(['threads.com', 'www.threads.com', 'threads.net', 'www.threads.net']);

function parseThreadsUrl(rawUrl) {
  let url;
  try {
    url = new URL(String(rawUrl || '').trim());
  } catch {
    throw Object.assign(new Error('Link Threads không hợp lệ.'), { code: 'INVALID_URL' });
  }
  if (!/^https?:$/.test(url.protocol) || !THREADS_HOSTS.has(url.hostname.toLowerCase())) {
    throw Object.assign(new Error('Chỉ chấp nhận link thread(s).com hoặc thread(s).net.'), { code: 'INVALID_URL' });
  }
  const parts = url.pathname.split('/').filter(Boolean);
  let username = '';
  let code = '';
  if (parts[0] && parts[0].startsWith('@')) username = parts[0].slice(1);
  const postIndex = parts.findIndex((part) => part === 'post' || part === 't');
  if (postIndex >= 0) code = parts[postIndex + 1] || '';
  if (!code && parts.length >= 2 && parts[0] === 't') code = parts[1];
  if (!code) throw Object.assign(new Error('Link không chứa mã bài viết Threads.'), { code: 'INVALID_URL' });
  return {
    url: `https://www.threads.com/@${username || 'post'}/post/${code}`,
    originalUrl: url.toString(),
    username,
    code,
  };
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asString(value) {
  return typeof value === 'string' ? value : '';
}

function asNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return 0;
}

function timeToIso(value) {
  if (value === null || value === undefined) return '';
  const number = asNumber(value);
  if (!number) return typeof value === 'string' ? value : '';
  const ms = number > 1e12 ? number : number * 1000;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function userOf(node) {
  if (isObject(node.user)) return node.user;
  if (isObject(node.author)) return node.author;
  return null;
}

function postText(node) {
  if (isObject(node.caption) && typeof node.caption.text === 'string') return node.caption.text;
  if (typeof node.text === 'string') return node.text;
  if (isObject(node.text_post_app_info) && typeof node.text_post_app_info.text === 'string') {
    return node.text_post_app_info.text;
  }
  return '';
}

function looksLikePost(node) {
  if (!isObject(node)) return false;
  const user = userOf(node);
  if (!user || typeof user.username !== 'string' || !user.username) return false;
  const hasIdentity = (typeof node.code === 'string' && node.code) || node.pk !== undefined;
  if (!hasIdentity) return false;
  return Boolean(isObject(node.text_post_app_info) || isObject(node.caption) || typeof node.text === 'string' || node.like_count !== undefined);
}

function normalizePost(node, pathHint, payloadHint) {
  const info = isObject(node.text_post_app_info) ? node.text_post_app_info : {};
  const user = userOf(node) || {};
  const code = typeof node.code === 'string' && node.code ? node.code : '';
  const pk = node.pk !== undefined ? String(node.pk) : '';
  const id = code || (pk ? `th_${pk}` : '');
  const parent = isObject(node.parent_post) ? node.parent_post : null;
  const replyFlag = info.is_reply === true || Boolean(parent);
  return {
    id,
    code,
    pk,
    author: asString(user.username).replace(/^@/, ''),
    display_name: asString(user.full_name || user.display_name),
    text: postText(node),
    taken_at: timeToIso(node.taken_at),
    likes: asNumber(node.like_count ?? info.like_count),
    comments_count: asNumber(info.direct_reply_count ?? node.direct_reply_count ?? node.reply_count),
    shares_count: asNumber(info.reshare_count ?? node.reshare_count ?? node.share_count),
    is_reply: replyFlag,
    parent_code: parent ? asString(parent.code) : '',
    pathHint,
    payloadHint,
    score:
      (postText(node) ? 4 : 0) +
      (replyFlag ? 4 : 0) +
      (info.direct_reply_count ? 2 : 0) +
      (node.like_count ? 1 : 0),
  };
}

function collectRawPosts(payloads) {
  const found = [];
  const seenObjects = new WeakSet();
  const payloadsArray = Array.isArray(payloads) ? payloads : [];
  payloadsArray.forEach((payload, payloadIndex) => {
    const root = isObject(payload) && 'json' in payload ? payload.json : payload;
    const payloadHint = isObject(payload) ? payload.url || payload.source || '' : '';
    if (!isObject(root) && !Array.isArray(root)) return;
    const stack = [{ value: root, path: '$' }];
    let guard = 0;
    while (stack.length && guard < 500000) {
      guard += 1;
      const { value, path } = stack.pop();
      if (Array.isArray(value)) {
        for (let index = value.length - 1; index >= 0; index -= 1) {
          stack.push({ value: value[index], path: `${path}[${index}]` });
        }
        continue;
      }
      if (!isObject(value) || seenObjects.has(value)) continue;
      seenObjects.add(value);
      if (looksLikePost(value)) {
        const normalized = normalizePost(value, path, payloadHint);
        if (normalized.id) found.push(normalized);
      }
      for (const key of Object.keys(value)) {
        const child = value[key];
        if (child && typeof child === 'object') {
          stack.push({ value: child, path: `${path}.${key}` });
        }
      }
    }
  });
  return found;
}

function mergePosts(rawPosts) {
  const byId = new Map();
  for (const post of rawPosts) {
    const existing = byId.get(post.id);
    if (!existing) {
      byId.set(post.id, post);
      continue;
    }
    const preferred = post.score > existing.score ? post : existing;
    preferred.likes = Math.max(existing.likes, post.likes);
    preferred.comments_count = Math.max(existing.comments_count, post.comments_count);
    preferred.shares_count = Math.max(existing.shares_count, post.shares_count);
    preferred.is_reply = existing.is_reply || post.is_reply;
    preferred.parent_code = existing.parent_code || post.parent_code;
    preferred.text = existing.text || post.text;
    preferred.pathHint = existing.pathHint;
    preferred.payloadHint = existing.payloadHint;
    byId.set(post.id, preferred);
  }
  return [...byId.values()];
}

function hasReplySignal(post) {
  if (post.is_reply) return true;
  const path = String(post.pathHint || '').toLowerCase();
  const payload = String(post.payloadHint || '').toLowerCase();
  return /repl(y|ies)|comment|child/.test(path) || /repl(y|ies)|comment/.test(payload);
}

function isLikelyComment(post) {
  if (hasReplySignal(post)) return true;
  // Threads puts replies inside "thread_items"; when the API omits is_reply,
  // reply-to-author metadata is the next reliable signal.
  return post.author && post.text;
}

function toContractPost(main) {
  return {
    post_id: main.id,
    url: '',
    author: main.author,
    time: main.taken_at,
    text: main.text,
    likes: main.likes,
    comments_count: main.comments_count,
    shares_count: main.shares_count,
  };
}

function buildResult(rawPosts, parsedUrl, options = {}) {
  const merged = mergePosts(rawPosts);
  let main = merged.find((post) => post.code && post.code === parsedUrl.code);
  if (!main) {
    main = merged
      .filter((post) => !post.is_reply)
      .sort((a, b) => b.score - a.score)[0];
  }
  if (!main) {
    return {
      ok: false,
      code: 'NO_POST_DATA',
      message: 'Không đọc được bài viết Threads. Có thể trang chưa tải xong hoặc Threads đã đổi cấu trúc dữ liệu.',
    };
  }

  const candidates = merged.filter((post) => {
    if (post.id === main.id) return false;
    if (!post.text.trim()) return false;
    if (post.code && main.code && post.code === main.code) return false;
    return isLikelyComment(post);
  });
  const replyCandidates = candidates.filter(hasReplySignal);
  const comments = options.requireReplySignal
    ? replyCandidates
    : replyCandidates.length
      ? replyCandidates
      : candidates;

  comments.sort((a, b) => {
    const at = Date.parse(a.taken_at) || 0;
    const bt = Date.parse(b.taken_at) || 0;
    if (at !== bt) return at - bt;
    return a.id.localeCompare(b.id);
  });

  const warnings = [];
  if (!comments.length) {
    warnings.push('Không tìm thấy bình luận nào trong dữ liệu Threads tải về. Hãy thử cuộn/đăng nhập Threads rồi cào lại.');
  } else if (!replyCandidates.length) {
    warnings.push('Threads không trả cờ “reply” rõ ràng; danh sách dưới đây là các bài viết con đọc được. Hãy kiểm tra trước khi chọn.');
  } else if (main.comments_count && comments.length < main.comments_count) {
    warnings.push(`Threads báo ${main.comments_count} bình luận nhưng chỉ tải được ${comments.length}. Có thể cần đăng nhập hoặc mở thêm bình luận.`);
  }

  const post = {
    post_id: main.id,
    url: parsedUrl.originalUrl,
    author: main.author,
    time: main.taken_at,
    text: main.text,
    likes: main.likes,
    comments_count: main.comments_count,
    shares_count: main.shares_count,
  };

  const normalizedComments = comments.map((comment) => ({
    comment_id: comment.id,
    author: comment.author,
    time: comment.taken_at,
    text: comment.text,
    likes: comment.likes,
    comments_count: comment.comments_count,
    shares_count: comment.shares_count,
    url: comment.code ? `https://www.threads.com/@${comment.author}/post/${comment.code}` : '',
    is_reply: true,
    parent_code: comment.parent_code,
  }));

  return {
    ok: true,
    post,
    comments: normalizedComments,
    warnings,
    stats: {
      loaded: normalizedComments.length,
      reported: main.comments_count,
      rawPosts: merged.length,
    },
  };
}

function collectFromPayloads(payloads, rawUrl, options = {}) {
  const parsedUrl = parseThreadsUrl(rawUrl);
  const rawPosts = collectRawPosts(payloads);
  return buildResult(rawPosts, parsedUrl, options);
}

function safeParseJson(text) {
  if (typeof text !== 'string') return null;
  let candidate = text.trim();
  if (!candidate) return null;
  if (candidate.startsWith('for (;;);')) candidate = candidate.slice(9);
  if (!/^[{\[]/.test(candidate)) return null;
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

function payloadsFromPageScripts(scriptTexts) {
  const payloads = [];
  for (const text of scriptTexts || []) {
    const parsed = safeParseJson(text);
    if (parsed) payloads.push({ url: 'page:embedded-json', json: parsed });
  }
  return payloads;
}

module.exports = {
  THREADS_HOSTS,
  parseThreadsUrl,
  collectRawPosts,
  collectFromPayloads,
  buildResult,
  safeParseJson,
  payloadsFromPageScripts,
  postText,
  looksLikePost,
};
