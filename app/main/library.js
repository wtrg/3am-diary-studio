'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { ensureDirSync, readJsonSync, writeJsonAtomic, safeFileName } = require('./fsutil');

const KIND_PREFIX = {
  meme: 'meme',
  music: 'music',
  sfx: 'sfx',
  background: 'bg',
};

const KIND_RULES = {
  meme: {
    exts: ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.mp4', '.mov', '.webm', '.m4v'],
    maxBytes: 200 * 1024 * 1024,
    media: 'image',
  },
  music: {
    exts: ['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac'],
    maxBytes: 80 * 1024 * 1024,
    media: 'audio',
  },
  sfx: {
    exts: ['.mp3', '.wav', '.m4a', '.aac', '.ogg'],
    maxBytes: 30 * 1024 * 1024,
    media: 'audio',
  },
  background: {
    exts: ['.mp4', '.mov', '.webm', '.m4v'],
    maxBytes: 512 * 1024 * 1024,
    media: 'video',
  },
};

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);

function normalizeTags(tags) {
  const source = Array.isArray(tags)
    ? tags
    : String(tags || '')
        .split(',')
        .map((tag) => tag.trim());
  const seen = new Set();
  const out = [];
  for (const raw of source) {
    if (typeof raw !== 'string') continue;
    const tag = raw.trim().replace(/\s+/g, ' ');
    if (!tag) continue;
    const key = tag.toLocaleLowerCase('vi');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag.slice(0, 48));
  }
  return out.slice(0, 24);
}

function probeDuration(file) {
  const args = [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    file,
  ];
  let result = spawnSync('ffprobe', args, { encoding: 'utf8', timeout: 20000, windowsHide: true });
  if (result.status === 0 && result.stdout) {
    const value = Number.parseFloat(result.stdout.trim());
    if (Number.isFinite(value) && value >= 0) return { duration: Math.round(value * 1000) / 1000, probed: true };
  }
  result = spawnSync('ffmpeg', ['-hide_banner', '-i', file], { encoding: 'utf8', timeout: 20000, windowsHide: true });
  const text = String(result.stderr || '');
  const match = text.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (match) {
    const seconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
    return { duration: Math.round(seconds * 1000) / 1000, probed: true };
  }
  return { duration: 0, probed: false };
}

function createIdFactory() {
  return (kind) => {
    const prefix = KIND_PREFIX[kind];
    if (!prefix) throw new Error(`Loại file không hợp lệ: ${kind}`);
    return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
  };
}

class Library {
  constructor(dataDir, options = {}) {
    this.dataDir = dataDir;
    this.mediaDir = path.join(dataDir, 'library', 'media');
    this.metaFile = path.join(dataDir, 'library.json');
    this.newId = options.newId || createIdFactory();
    this.probe = options.probe || probeDuration;
    this.now = options.now || (() => new Date().toISOString());
    this.writeChain = Promise.resolve();
    ensureDirSync(this.mediaDir);
    this.items = readJsonSync(this.metaFile, []);
    if (!Array.isArray(this.items)) this.items = [];
  }

  list() {
    return this.items
      .slice()
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  }

  get(id) {
    return this.items.find((item) => item.id === id) || null;
  }

  getMany(ids) {
    const wanted = new Set(ids || []);
    return this.items.filter((item) => wanted.has(item.id));
  }

  mediaPath(item) {
    return path.join(this.mediaDir, item.file);
  }

  persist() {
    this.writeChain = this.writeChain.then(() => writeJsonAtomic(this.metaFile, this.items));
    return this.writeChain;
  }

  validateUpload({ kind, originalName, size }) {
    const rule = KIND_RULES[kind];
    if (!rule) return `Loại file không hợp lệ: ${kind}`;
    const ext = path.extname(String(originalName || '')).toLowerCase();
    if (!rule.exts.includes(ext)) return `Định dạng ${ext || '(không rõ)'} không được hỗ trợ cho ${kind}`;
    if (!Number.isFinite(size) || size <= 0) return 'File rỗng hoặc thiếu dung lượng';
    if (size > rule.maxBytes) return `File quá lớn (tối đa ${Math.round(rule.maxBytes / 1024 / 1024)} MB)`;
    return null;
  }

  async addFromTempFile({ tempFile, originalName, kind, name, tags, mime }) {
    const stat = await fsp.stat(tempFile);
    const error = this.validateUpload({ kind, originalName, size: stat.size });
    if (error) throw Object.assign(new Error(error), { statusCode: 400, code: 'INVALID_FILE' });

    let id;
    do {
      id = this.newId(kind);
    } while (this.get(id));

    const ext = path.extname(originalName).toLowerCase();
    const storedFile = `${id}${ext}`;
    const target = path.join(this.mediaDir, storedFile);
    await fsp.rename(tempFile, target);

    const extSet = IMAGE_EXT;
    const isImageMeme = kind === 'meme' && extSet.has(ext);
    const probe = isImageMeme ? { duration: 0, probed: true } : this.probe(target);
    const now = this.now();
    const item = {
      id,
      kind,
      name: safeFileName(name || path.basename(originalName, ext), kind),
      tags: normalizeTags(tags),
      duration: probe.duration,
      durationProbed: probe.probed,
      mediaType: isImageMeme ? 'image' : KIND_RULES[kind].media,
      mime: mime || '',
      size: stat.size,
      file: storedFile,
      createdAt: now,
      updatedAt: now,
    };
    this.items.push(item);
    await this.persist();
    return item;
  }

  async importDemoItem({ id, kind, name, tags, sourceFile, mime, mediaType, duration }) {
    if (!id || !KIND_PREFIX[kind]) throw new Error(`Demo asset không hợp lệ: ${id || kind}`);
    if (!fs.existsSync(sourceFile)) throw new Error(`Thiếu file demo: ${path.basename(sourceFile)}`);
    const existing = this.get(id);
    const ext = path.extname(sourceFile).toLowerCase();
    const storedFile = `${id}${ext}`;
    const target = path.join(this.mediaDir, storedFile);
    if (existing) {
      if (!fs.existsSync(target)) await fsp.copyFile(sourceFile, target);
      return existing;
    }
    if (this.items.some((item) => item.id === id)) {
      throw new Error(`ID demo bị trùng loại file: ${id}`);
    }
    const stat = await fsp.stat(sourceFile);
    const rule = KIND_RULES[kind];
    if (!rule.exts.includes(ext)) throw new Error(`Định dạng demo không hợp lệ cho ${kind}: ${ext}`);
    await fsp.copyFile(sourceFile, target);
    const probe = mediaType === 'image' ? { duration: 0, probed: true } : this.probe(target);
    const now = this.now();
    const item = {
      id,
      kind,
      name: safeFileName(name, id),
      tags: normalizeTags(tags),
      duration: Number.isFinite(duration) ? duration : probe.duration,
      durationProbed: probe.probed,
      mediaType: mediaType || rule.media,
      mime: mime || '',
      size: stat.size,
      file: storedFile,
      createdAt: now,
      updatedAt: now,
      demo: true,
    };
    this.items.push(item);
    await this.persist();
    return item;
  }

  async update(id, patch = {}) {
    const item = this.get(id);
    if (!item) return null;
    if (patch.name !== undefined) {
      const name = safeFileName(patch.name, item.name);
      if (!name) throw Object.assign(new Error('Tên file không được để trống'), { statusCode: 400, code: 'INVALID_NAME' });
      item.name = name;
    }
    if (patch.tags !== undefined) item.tags = normalizeTags(patch.tags);
    item.updatedAt = this.now();
    await this.persist();
    return item;
  }

  async remove(id) {
    const index = this.items.findIndex((item) => item.id === id);
    if (index < 0) return null;
    const [item] = this.items.splice(index, 1);
    await this.persist();
    try {
      await fsp.unlink(this.mediaPath(item));
    } catch (error) {
      if (error.code !== 'ENOENT') {
        this.items.splice(index, 0, item);
        await this.persist();
        throw error;
      }
    }
    return item;
  }

  findReferences(plan) {
    if (!plan) return [];
    const ids = new Set();
    if (plan.music_id) ids.add(plan.music_id);
    for (const segment of plan.segments || []) {
      if (segment && segment.meme_id) ids.add(segment.meme_id);
      if (segment && segment.sfx_id) ids.add(segment.sfx_id);
    }
    return this.items.filter((item) => ids.has(item.id));
  }

  stats() {
    const counts = { meme: 0, music: 0, sfx: 0, background: 0 };
    for (const item of this.items) if (counts[item.kind] !== undefined) counts[item.kind] += 1;
    return counts;
  }
}

module.exports = {
  Library,
  KIND_RULES,
  KIND_PREFIX,
  normalizeTags,
  probeDuration,
  createIdFactory,
};
