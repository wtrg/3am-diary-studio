'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { readJsonSync, writeJsonAtomic, ensureDir } = require('./fsutil');
const { getAdapter, describe } = require('./render');

const STATUS = {
  QUEUED: 'queued',
  RENDERING: 'rendering',
  DONE: 'done',
  ERROR: 'error',
};

const STATUS_LABEL = {
  queued: 'Chờ dựng',
  rendering: 'Đang dựng',
  done: 'Xong',
  error: 'Lỗi',
};

function jobId() {
  return `job_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
}

class JobQueue {
  constructor({ dataDir, library, now, adapterProvider } = {}) {
    this.dataDir = dataDir;
    this.library = library;
    this.outputDir = path.join(dataDir, 'outputs');
    this.tempRoot = path.join(dataDir, 'tmp');
    this.file = path.join(dataDir, 'jobs.json');
    this.adapterProvider = adapterProvider || getAdapter;
    this.now = now || (() => new Date().toISOString());
    this.jobs = readJsonSync(this.file, []);
    if (!Array.isArray(this.jobs)) this.jobs = [];
    this.running = false;
    this._persistChain = Promise.resolve();
    this._prepare();
  }

  _prepare() {
    fs.mkdirSync(this.outputDir, { recursive: true });
    fs.mkdirSync(this.tempRoot, { recursive: true });
  }

  async load() {
    let changed = false;
    for (const job of this.jobs) {
      if (job.status === STATUS.RENDERING) {
        job.status = STATUS.ERROR;
        job.error = 'Ứng dụng đã tắt khi job đang dựng. Kế hoạch được giữ nguyên để chạy lại.';
        job.stage = 'Bị gián đoạn';
        job.updated_at = this.now();
        changed = true;
      }
    }
    if (changed) await this.persist();
    this.pump();
  }

  persist() {
    this._persistChain = this._persistChain.then(() => writeJsonAtomic(this.file, this.jobs));
    return this._persistChain;
  }

  list() {
    return this.jobs
      .slice()
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  }

  get(id) {
    return this.jobs.find((job) => job.id === id) || null;
  }

  async enqueue(input) {
    const id = jobId();
    const now = this.now();
    const job = {
      id,
      created_at: now,
      updated_at: now,
      status: STATUS.QUEUED,
      stage: 'Trong hàng đợi',
      progress: 0,
      title: input.title || input.plan?.title || 'Video chưa đặt tên',
      plan: JSON.parse(JSON.stringify(input.plan)),
      plan_source: input.plan_source || 'unknown',
      post: JSON.parse(JSON.stringify(input.post || null)),
      comments: JSON.parse(JSON.stringify(input.comments || [])),
      settings: JSON.parse(JSON.stringify(input.settings || {})),
      assets: JSON.parse(JSON.stringify(input.assets || [])),
      input_hash: input.input_hash || '',
      output_file: null,
      output_bytes: 0,
      duration_seconds: null,
      width: 576,
      height: 1024,
      fps: 30,
      error: null,
      attempts: 0,
      logs: [],
      renderer: describe(),
    };
    this.jobs.push(job);
    await this.persist();
    this.pump();
    return job;
  }

  async retry(id) {
    const job = this.get(id);
    if (!job) return null;
    if (job.status === STATUS.RENDERING) {
      throw Object.assign(new Error('Job đang dựng, không thể chạy lại lúc này.'), { statusCode: 409 });
    }
    job.status = STATUS.QUEUED;
    job.stage = 'Chạy lại trong hàng đợi';
    job.progress = 0;
    job.error = null;
    job.updated_at = this.now();
    await this.persist();
    this.pump();
    return job;
  }

  async pump() {
    if (this.running) return;
    const next = this.jobs
      .filter((job) => job.status === STATUS.QUEUED)
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))[0];
    if (!next) return;
    this.running = true;
    this._run(next)
      .catch(() => {})
      .finally(() => {
        this.running = false;
        setImmediate(() => this.pump());
      });
  }

  _appendLog(job, line) {
    const text = String(line || '').replace(/\s+$/g, '');
    if (!text) return;
    const last = job.logs[job.logs.length - 1];
    if (last === text) return;
    job.logs.push(text.slice(0, 800));
    if (job.logs.length > 60) job.logs.splice(0, job.logs.length - 60);
  }

  async _run(job) {
    job.status = STATUS.RENDERING;
    job.stage = 'Chuẩn bị dựng';
    job.progress = 1;
    job.error = null;
    job.attempts = (job.attempts || 0) + 1;
    job.updated_at = this.now();
    job.renderer = describe();
    await this.persist();

    const outputFile = `${job.id}.mp4`;
    const outputPath = path.join(this.outputDir, outputFile);
    const tempDir = await fsp.mkdtemp(path.join(this.tempRoot, `${job.id}-`));
    let lastSave = 0;
    let lastProgress = -1;

    const onProgress = (stage, percent) => {
      job.stage = stage || job.stage;
      const value = Math.max(0, Math.min(99, Math.round(Number(percent) || 0)));
      job.progress = Math.max(job.progress, value);
      job.updated_at = this.now();
      const now = Date.now();
      if (now - lastSave > 700 && job.progress !== lastProgress) {
        lastSave = now;
        lastProgress = job.progress;
        this.persist().catch(() => {});
      }
    };

    try {
      const assets = [];
      for (const asset of job.assets || []) {
        const current = this.library.get(asset.id);
        if (!current) {
          throw new Error(
            `File "${asset.name || asset.id}" (${asset.id}) không còn trong kho. Kế hoạch được giữ nguyên; hãy khôi phục file rồi chạy lại.`,
          );
        }
        assets.push({ ...asset, file: current.file, absolutePath: this.library.mediaPath(current) });
      }

      const adapter = this.adapterProvider();
      const result = await adapter.render({
        job,
        plan: JSON.parse(JSON.stringify(job.plan)),
        post: job.post,
        comments: job.comments,
        settings: job.settings,
        assets,
        outputPath,
        tempDir,
        onProgress,
        appendLog: (line) => this._appendLog(job, line),
        signal: { aborted: false },
      });

      const stat = await fsp.stat(outputPath);
      if (!stat.size) throw new Error('Renderer không tạo được file MP4 (file rỗng).');
      job.status = STATUS.DONE;
      job.stage = 'Hoàn tất';
      job.progress = 100;
      job.output_file = outputFile;
      job.output_bytes = stat.size;
      if (result && Number.isFinite(result.durationSeconds)) job.duration_seconds = result.durationSeconds;
      if (result && result.width) job.width = result.width;
      if (result && result.height) job.height = result.height;
      if (result && result.fps) job.fps = result.fps;
      job.updated_at = this.now();
      await this.persist();
    } catch (error) {
      job.status = STATUS.ERROR;
      job.stage = 'Lỗi khi dựng';
      job.error = error.message || 'Lỗi không xác định khi dựng video.';
      job.updated_at = this.now();
      this._appendLog(job, `ERROR: ${job.error}`);
      await this.persist();
      try {
        await fsp.unlink(outputPath);
      } catch {}
    } finally {
      try {
        await fsp.rm(tempDir, { recursive: true, force: true });
      } catch {}
      job.updated_at = this.now();
      await this.persist();
    }
  }

  async remove(id) {
    const index = this.jobs.findIndex((job) => job.id === id);
    if (index < 0) return null;
    const job = this.jobs[index];
    if (job.status === STATUS.RENDERING) {
      throw Object.assign(new Error('Không thể xóa job đang dựng.'), { statusCode: 409 });
    }
    this.jobs.splice(index, 1);
    await this.persist();
    if (job.output_file) {
      try {
        await fsp.unlink(path.join(this.outputDir, job.output_file));
      } catch {}
    }
    return job;
  }

  outputPath(job) {
    if (!job || !job.output_file) return null;
    return path.join(this.outputDir, job.output_file);
  }

  referencedLibraryIds() {
    const ids = new Set();
    for (const job of this.jobs) {
      if (job.status === STATUS.DONE) continue;
      for (const asset of job.assets || []) if (asset.id) ids.add(asset.id);
    }
    return ids;
  }

  publicJob(job) {
    if (!job) return null;
    return {
      ...job,
      status_label: STATUS_LABEL[job.status] || job.status,
      output_url: job.status === STATUS.DONE ? `/media/outputs/${job.output_file}` : null,
      download_url: job.status === STATUS.DONE ? `/media/outputs/${job.output_file}?download=1` : null,
    };
  }
}

module.exports = { JobQueue, STATUS, STATUS_LABEL };
