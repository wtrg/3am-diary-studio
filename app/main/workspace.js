'use strict';

const path = require('node:path');
const { readJsonSync, writeJsonAtomic } = require('./fsutil');

const DEFAULT_SETTINGS = {
  voice: '',
  voice_track_id: '',
  voice_tts: false,
  background_video_id: '',
  watermark: '',
  target_duration: 60,
};

function defaultState() {
  return {
    version: 1,
    post: null,
    comments: [],
    selected_comment_ids: [],
    settings: { ...DEFAULT_SETTINGS },
    draft_plan: null,
    plan_meta: null,
    approved_plan: null,
    approved_at: null,
    plan_stale: false,
    stale_reason: null,
    updated_at: new Date().toISOString(),
  };
}

function normalizeComment(comment, index) {
  if (!comment || typeof comment !== 'object') throw new Error(`Bình luận #${index + 1} không hợp lệ`);
  const text = comment.text;
  if (typeof text !== 'string' || !text.trim()) throw new Error(`Bình luận #${index + 1} thiếu nội dung`);
  const commentId = String(comment.comment_id || '').trim();
  if (!commentId) throw new Error(`Bình luận #${index + 1} thiếu comment_id`);
  return {
    comment_id: commentId,
    author: String(comment.author || ''),
    time: String(comment.time || ''),
    text,
    likes: Number(comment.likes) || 0,
    comments_count: Number(comment.comments_count) || 0,
    shares_count: Number(comment.shares_count) || 0,
    url: String(comment.url || ''),
    is_reply: Boolean(comment.is_reply),
  };
}

class Workspace {
  constructor(dataDir) {
    this.file = path.join(dataDir, 'workspace.json');
    const loaded = readJsonSync(this.file, defaultState());
    this.state = { ...defaultState(), ...loaded, settings: { ...DEFAULT_SETTINGS, ...(loaded.settings || {}) } };
    if (!Array.isArray(this.state.comments)) this.state.comments = [];
    if (!Array.isArray(this.state.selected_comment_ids)) this.state.selected_comment_ids = [];
  }

  snapshot() {
    return JSON.parse(JSON.stringify(this.state));
  }

  touch() {
    this.state.updated_at = new Date().toISOString();
    return writeJsonAtomic(this.file, this.state);
  }

  invalidatePlan(reason) {
    this.state.approved_plan = null;
    this.state.approved_at = null;
    if (this.state.draft_plan) {
      this.state.plan_stale = true;
      this.state.stale_reason = reason;
    }
  }

  async setPostAndComments(post, comments) {
    if (!post || typeof post !== 'object') throw Object.assign(new Error('Bài Threads không hợp lệ'), { statusCode: 400 });
    const normalized = comments.map(normalizeComment);
    const ids = new Set();
    for (const comment of normalized) {
      if (ids.has(comment.comment_id)) {
        throw Object.assign(new Error(`comment_id bị trùng: ${comment.comment_id}`), { statusCode: 400, code: 'DUPLICATE_COMMENT_ID' });
      }
      ids.add(comment.comment_id);
    }
    this.state.post = JSON.parse(JSON.stringify(post));
    this.state.comments = normalized;
    this.state.selected_comment_ids = normalized.map((comment) => comment.comment_id);
    this.state.draft_plan = null;
    this.state.plan_meta = null;
    this.state.approved_plan = null;
    this.state.approved_at = null;
    this.state.plan_stale = false;
    this.state.stale_reason = null;
    await this.touch();
    return this.snapshot();
  }

  async setSelectedComments(ids) {
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) {
      throw Object.assign(new Error('Danh sách bình luận đã chọn không hợp lệ'), { statusCode: 400 });
    }
    const known = new Map(this.state.comments.map((comment) => [comment.comment_id, comment]));
    const seen = new Set();
    const ordered = [];
    for (const id of ids) {
      if (!known.has(id)) throw Object.assign(new Error(`Bình luận không tồn tại: ${id}`), { statusCode: 400, code: 'UNKNOWN_COMMENT_ID' });
      if (seen.has(id)) throw Object.assign(new Error(`Bình luận bị lặp: ${id}`), { statusCode: 400, code: 'DUPLICATE_COMMENT_ID' });
      seen.add(id);
      ordered.push(id);
    }
    this.state.selected_comment_ids = ordered;
    this.invalidatePlan('Danh sách bình luận đã thay đổi. Hãy kiểm tra lại kế hoạch.');
    await this.touch();
    return this.snapshot();
  }

  async setSettings(patch) {
    if (!patch || typeof patch !== 'object') throw Object.assign(new Error('Cài đặt không hợp lệ'), { statusCode: 400 });
    const next = { ...this.state.settings };
    if (patch.voice !== undefined) next.voice = String(patch.voice);
    if (patch.voice_track_id !== undefined) next.voice_track_id = String(patch.voice_track_id);
    if (patch.voice_tts !== undefined) next.voice_tts = Boolean(patch.voice_tts);
    if (patch.background_video_id !== undefined) next.background_video_id = String(patch.background_video_id);
    if (patch.watermark !== undefined) next.watermark = String(patch.watermark).slice(0, 120);
    if (patch.target_duration !== undefined) next.target_duration = Number(patch.target_duration);
    this.state.settings = next;
    this.invalidatePlan('Cài đặt video đã thay đổi. Hãy kiểm tra lại kế hoạch.');
    await this.touch();
    return this.snapshot();
  }

  selectedComments() {
    const byId = new Map(this.state.comments.map((comment) => [comment.comment_id, comment]));
    return this.state.selected_comment_ids.map((id) => byId.get(id)).filter(Boolean);
  }

  async setDraftPlan(plan, meta) {
    this.state.draft_plan = JSON.parse(JSON.stringify(plan));
    this.state.plan_meta = { ...meta };
    this.state.approved_plan = null;
    this.state.approved_at = null;
    this.state.plan_stale = false;
    this.state.stale_reason = null;
    await this.touch();
    return this.snapshot();
  }

  async approvePlan(plan, meta) {
    this.state.draft_plan = JSON.parse(JSON.stringify(plan));
    this.state.plan_meta = { ...meta };
    this.state.approved_plan = JSON.parse(JSON.stringify(plan));
    this.state.approved_at = new Date().toISOString();
    this.state.plan_stale = false;
    this.state.stale_reason = null;
    await this.touch();
    return this.snapshot();
  }

  async clearAll() {
    this.state = defaultState();
    await this.touch();
    return this.snapshot();
  }

  async savePost(post) {
    this.state.post = JSON.parse(JSON.stringify(post));
    await this.touch();
    return this.snapshot();
  }

  async setPlanStale(reason) {
    this.invalidatePlan(reason);
    await this.touch();
    return this.snapshot();
  }
}

module.exports = { Workspace, DEFAULT_SETTINGS, normalizeComment };
