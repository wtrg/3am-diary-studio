'use strict';

const crypto = require('node:crypto');

const COMMENT_KEYS = ['comment_id', 'author', 'time', 'text', 'likes'];

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (isObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function hashInput(input) {
  return crypto.createHash('sha256').update(stableStringify(input)).digest('hex');
}

function mapComment(comment) {
  return {
    comment_id: comment.comment_id,
    author: comment.author,
    time: comment.time,
    text: comment.text,
    likes: comment.likes,
  };
}

function buildMuseInput({ post, comments, library, settings }) {
  if (!post) throw new Error('Chưa có bài Threads');
  if (!Array.isArray(comments) || comments.length === 0) throw new Error('Chưa chọn bình luận nào');
  if (!Array.isArray(library)) throw new Error('Kho file không hợp lệ');
  if (!isObject(settings)) throw new Error('Thiếu cài đặt video');

  const memes = [];
  const music = [];
  const sfx = [];
  const backgrounds = [];
  for (const item of library) {
    if (item.kind === 'meme') {
      memes.push({ meme_id: item.id, tags: item.tags.slice(), duration: item.duration });
    } else if (item.kind === 'music') {
      music.push({ music_id: item.id, mood: item.tags.join(', ') });
    } else if (item.kind === 'sfx') {
      sfx.push({ sfx_id: item.id, use: item.name });
    } else if (item.kind === 'background') {
      backgrounds.push({ background_video_id: item.id, tags: item.tags.slice(), duration: item.duration });
    }
  }

  return {
    post: {
      post_id: post.post_id || '',
      url: post.url || '',
      author: post.author || '',
      time: post.time || '',
      text: post.text || '',
      likes: Number(post.likes) || 0,
      comments_count: Number(post.comments_count) || 0,
      shares_count: Number(post.shares_count) || 0,
    },
    comments: comments.map(mapComment),
    library: [...memes, ...music, ...sfx, ...backgrounds],
    settings: {
      voice: settings.voice,
      background_video_id: settings.background_video_id,
      watermark: settings.watermark,
      target_duration: settings.target_duration,
    },
  };
}

function preflightInput(input, library) {
  const errors = [];
  if (!input.post || !input.post.url) errors.push({ code: 'POST_REQUIRED', message: 'Chưa có bài Threads.' });
  if (!Array.isArray(input.comments) || input.comments.length === 0) {
    errors.push({ code: 'COMMENTS_REQUIRED', message: 'Cần chọn ít nhất 1 bình luận.' });
  }
  const counts = { meme: 0, music: 0, sfx: 0, background: 0 };
  for (const item of library) if (counts[item.kind] !== undefined) counts[item.kind] += 1;
  if (counts.meme === 0) errors.push({ code: 'MEME_REQUIRED', message: 'Kho chưa có meme.' });
  if (counts.music === 0) errors.push({ code: 'MUSIC_REQUIRED', message: 'Kho chưa có nhạc nền.' });
  if (counts.sfx === 0) errors.push({ code: 'SFX_REQUIRED', message: 'Kho chưa có SFX.' });
  if (counts.background === 0) errors.push({ code: 'BACKGROUND_REQUIRED', message: 'Kho chưa có video nền.' });
  if (!input.settings.background_video_id) {
    errors.push({ code: 'BACKGROUND_NOT_SELECTED', message: 'Chưa chọn video nền.' });
  } else if (!library.some((item) => item.kind === 'background' && item.id === input.settings.background_video_id)) {
    errors.push({ code: 'BACKGROUND_NOT_FOUND', message: 'Video nền đã chọn không có trong kho.' });
  }
  if (!input.settings.voice || typeof input.settings.voice !== 'string') {
    errors.push({ code: 'VOICE_REQUIRED', message: 'Chưa chọn giọng đọc.' });
  }
  if (!input.settings.watermark || typeof input.settings.watermark !== 'string') {
    errors.push({ code: 'WATERMARK_REQUIRED', message: 'Chưa nhập watermark kênh.' });
  }
  const target = Number(input.settings.target_duration);
  if (!Number.isInteger(target) || target < 60 || target > 90) {
    errors.push({ code: 'TARGET_DURATION_RANGE', message: 'Thời lượng đích phải từ 60 đến 90 giây.' });
  }
  return errors;
}

function extractJsonText(raw) {
  if (typeof raw !== 'string') return { error: 'Kết quả Muse không phải chuỗi văn bản.' };
  let text = raw.trim();
  if (!text) return { error: 'Kết quả Muse đang trống.' };
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) text = fenced[1].trim();

  const first = text.indexOf('{');
  if (first < 0) return { error: 'Không tìm thấy JSON trong kết quả Muse.' };
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let index = first; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escape) escape = false;
      else if (char === '\\') escape = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        const candidate = text.slice(first, index + 1);
        try {
          return { value: JSON.parse(candidate) };
        } catch (error) {
          return { error: `JSON không hợp lệ: ${error.message}` };
        }
      }
    }
  }
  return { error: 'JSON không đóng ngoặc đầy đủ.' };
}

function validatePlan(rawPlan, input) {
  const errors = [];
  const add = (path, code, message) => errors.push({ path, code, message });
  if (!isObject(rawPlan)) {
    return { ok: false, errors: [{ path: '$', code: 'PLAN_NOT_OBJECT', message: 'Kế hoạch phải là một JSON object.' }] };
  }

  const commentById = new Map();
  for (const comment of input.comments || []) commentById.set(comment.comment_id, comment);
  const memeIds = new Set();
  const musicIds = new Set();
  const sfxIds = new Set();
  const backgroundIds = new Set();
  const seenLibraryIds = new Set();
  for (const item of input.library || []) {
    const id = item.meme_id || item.music_id || item.sfx_id || item.background_video_id;
    if (!id) continue;
    if (seenLibraryIds.has(id)) add('$.library', 'DUPLICATE_LIBRARY_ID', `ID kho bị trùng: ${id}`);
    seenLibraryIds.add(id);
    if (item.meme_id) memeIds.add(item.meme_id);
    if (item.music_id) musicIds.add(item.music_id);
    if (item.sfx_id) sfxIds.add(item.sfx_id);
    if (item.background_video_id) backgroundIds.add(item.background_video_id);
  }

  if (typeof rawPlan.title !== 'string' || !rawPlan.title.trim()) {
    add('$.title', 'TITLE_INVALID', 'Thiếu tiêu đề hook (title).');
  }
  if (typeof rawPlan.music_id !== 'string' || !rawPlan.music_id) {
    add('$.music_id', 'MUSIC_REQUIRED', 'Thiếu music_id.');
  } else if (!musicIds.has(rawPlan.music_id)) {
    add('$.music_id', 'UNKNOWN_MUSIC_ID', `music_id lạ, không có trong kho: ${rawPlan.music_id}`);
  }
  if (!musicIds.size) add('$.music_id', 'LIBRARY_MUSIC_EMPTY', 'Input không có nhạc nào để đối chiếu.');

  if (!Array.isArray(rawPlan.segments) || rawPlan.segments.length === 0) {
    add('$.segments', 'SEGMENTS_INVALID', 'segments phải là mảng và có ít nhất 1 đoạn.');
  } else {
    const usedComments = new Set();
    rawPlan.segments.forEach((segment, index) => {
      const at = `$.segments[${index}]`;
      if (!isObject(segment)) {
        add(at, 'SEGMENT_NOT_OBJECT', 'Đoạn không phải object.');
        return;
      }
      if (typeof segment.comment_id !== 'string' || !segment.comment_id) {
        add(`${at}.comment_id`, 'COMMENT_ID_REQUIRED', 'Thiếu comment_id.');
      } else {
        const source = commentById.get(segment.comment_id);
        if (!source) {
          add(`${at}.comment_id`, 'UNKNOWN_COMMENT_ID', `comment_id lạ, không nằm trong input: ${segment.comment_id}`);
        } else {
          if (usedComments.has(segment.comment_id)) {
            add(`${at}.comment_id`, 'DUPLICATE_COMMENT', `Bình luận bị lặp: ${segment.comment_id}`);
          }
          usedComments.add(segment.comment_id);
          if (typeof segment.text !== 'string') {
            add(`${at}.text`, 'TEXT_MISSING', 'Thiếu text bình luận.');
          } else if (segment.text !== source.text) {
            add(`${at}.text`, 'TEXT_MISMATCH', 'Nội dung bình luận không khớp nguyên văn input.');
          }
        }
      }
      if (typeof segment.meme_id !== 'string' || !segment.meme_id) {
        add(`${at}.meme_id`, 'MEME_REQUIRED', 'Thiếu meme_id.');
      } else if (!memeIds.has(segment.meme_id)) {
        add(`${at}.meme_id`, 'UNKNOWN_MEME_ID', `meme_id lạ, không có trong kho: ${segment.meme_id}`);
      }
      if (typeof segment.meme_duration !== 'number' || !Number.isFinite(segment.meme_duration) || segment.meme_duration <= 0) {
        add(`${at}.meme_duration`, 'MEME_DURATION_INVALID', 'meme_duration phải là số lớn hơn 0.');
      }
      if (typeof segment.sfx_id !== 'string' || !segment.sfx_id) {
        add(`${at}.sfx_id`, 'SFX_REQUIRED', 'Thiếu sfx_id.');
      } else if (!sfxIds.has(segment.sfx_id)) {
        add(`${at}.sfx_id`, 'UNKNOWN_SFX_ID', `sfx_id lạ, không có trong kho: ${segment.sfx_id}`);
      }
    });
  }

  if (!memeIds.size) add('$.segments', 'LIBRARY_MEME_EMPTY', 'Input không có meme nào để đối chiếu.');
  if (!sfxIds.size) add('$.segments', 'LIBRARY_SFX_EMPTY', 'Input không có SFX nào để đối chiếu.');
  if (typeof rawPlan.caption !== 'string') {
    add('$.caption', 'CAPTION_INVALID', 'caption phải là chuỗi.');
  }
  if (!Array.isArray(rawPlan.hashtags) || rawPlan.hashtags.some((tag) => typeof tag !== 'string')) {
    add('$.hashtags', 'HASHTAGS_INVALID', 'hashtags phải là mảng chuỗi.');
  }
  if (!input.settings || !backgroundIds.has(input.settings.background_video_id)) {
    add('$.settings.background_video_id', 'UNKNOWN_BACKGROUND_ID', 'Video nền không có trong kho.');
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, errors: [], plan: JSON.parse(JSON.stringify(rawPlan)) };
}

function planReferences(plan, library) {
  if (!plan) return [];
  const wanted = new Set();
  if (plan.music_id) wanted.add(plan.music_id);
  for (const segment of plan.segments || []) {
    if (segment.meme_id) wanted.add(segment.meme_id);
    if (segment.sfx_id) wanted.add(segment.sfx_id);
  }
  return library.filter((item) => wanted.has(item.id));
}

module.exports = {
  COMMENT_KEYS,
  stableStringify,
  hashInput,
  mapComment,
  buildMuseInput,
  preflightInput,
  extractJsonText,
  validatePlan,
  planReferences,
};
