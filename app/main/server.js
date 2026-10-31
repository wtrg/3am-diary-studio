'use strict';

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { URL } = require('node:url');
const {
  buildMuseInput,
  preflightInput,
  extractJsonText,
  validatePlan,
  hashInput,
} = require('./contract');
const { safeFileName } = require('./fsutil');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.aac': 'audio/aac',
};

const UPLOAD_LIMITS = {
  meme: 200 * 1024 * 1024,
  music: 80 * 1024 * 1024,
  sfx: 30 * 1024 * 1024,
  background: 512 * 1024 * 1024,
};

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(payload);
}

function errorBody(error) {
  return {
    error: {
      code: error.code || 'INTERNAL_ERROR',
      message: error.message || 'Có lỗi xảy ra.',
      gateMessage: error.gateMessage,
      details: error.details,
    },
  };
}

function httpError(status, code, message, details) {
  const error = new Error(message);
  error.statusCode = status;
  error.code = code;
  error.details = details;
  return error;
}

async function readJsonBody(req, limit = 2 * 1024 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > limit) throw httpError(413, 'BODY_TOO_LARGE', 'Dữ liệu gửi lên quá lớn.');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw httpError(400, 'INVALID_JSON', 'Body JSON không hợp lệ.');
  }
}

async function streamToTempFile(req, tempDir, maxBytes) {
  const length = Number(req.headers['content-length']);
  if (!Number.isFinite(length) || length <= 0) throw httpError(411, 'CONTENT_LENGTH_REQUIRED', 'Thiếu Content-Length khi tải file.');
  if (length > maxBytes) throw httpError(413, 'FILE_TOO_LARGE', 'File vượt quá giới hạn cho phép.');
  await fsp.mkdir(tempDir, { recursive: true });
  const tempFile = path.join(tempDir, `upload-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.tmp`);
  let total = 0;
  const out = fs.createWriteStream(tempFile, { flags: 'wx' });
  try {
    for await (const chunk of req) {
      total += chunk.length;
      if (total > maxBytes) {
        out.destroy();
        await fsp.unlink(tempFile).catch(() => {});
        throw httpError(413, 'FILE_TOO_LARGE', 'File vượt quá giới hạn cho phép.');
      }
      if (!out.write(chunk)) await new Promise((resolve) => out.once('drain', resolve));
    }
    await new Promise((resolve, reject) => out.end((error) => (error ? reject(error) : resolve())));
  } catch (error) {
    out.destroy();
    await fsp.unlink(tempFile).catch(() => {});
    throw error;
  }
  return { tempFile, size: total };
}

function serveFile(req, res, filePath, { downloadName, cache = false } = {}) {
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return json(res, 404, { error: { code: 'FILE_NOT_FOUND', message: 'Không tìm thấy file.' } });
  }
  if (!stat.isFile()) return json(res, 404, { error: { code: 'FILE_NOT_FOUND', message: 'Không tìm thấy file.' } });
  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME[ext] || 'application/octet-stream';
  const headers = {
    'Content-Type': mime,
    'Accept-Ranges': 'bytes',
    'Cache-Control': cache ? 'private, max-age=300' : 'no-store',
    'X-Content-Type-Options': 'nosniff',
  };
  if (downloadName) {
    const utf8Name = safeFileName(downloadName, 'video.mp4');
    const asciiName = utf8Name.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_') || 'video.mp4';
    headers['Content-Disposition'] = `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(utf8Name)}`;
  }
  const range = req.headers.range;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (match) {
      let start = match[1] ? Number(match[1]) : 0;
      let end = match[2] ? Number(match[2]) : stat.size - 1;
      if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= stat.size) {
        res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
        return res.end();
      }
      end = Math.min(end, stat.size - 1);
      headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
      headers['Content-Length'] = end - start + 1;
      res.writeHead(206, headers);
      fs.createReadStream(filePath, { start, end }).pipe(res);
      return;
    }
  }
  headers['Content-Length'] = stat.size;
  res.writeHead(200, headers);
  fs.createReadStream(filePath).pipe(res);
}

class LocalServer {
  constructor(options) {
    this.rootDir = options.rootDir;
    this.staticDir = path.join(options.rootDir, 'renderer');
    this.library = options.library;
    this.workspace = options.workspace;
    this.jobs = options.jobs;
    this.muse = options.muse;
    this.ruleSlot = options.ruleSlot;
    this.demo = options.demo;
    this.dataDir = options.dataDir;
    this.scrapeThreads = options.scrapeThreads;
    this.discoverThreads = options.discoverThreads || (async () => ({
      ok: false,
      code: 'DISCOVERY_UNAVAILABLE',
      message: 'Discovery Threads chưa được khởi tạo.',
    }));
    this.threadsLoginState = options.threadsLoginState;
    this.openThreadsLoginWindow = options.openThreadsLoginWindow;
    this.openMuseLoginWindow = options.openMuseLoginWindow || (async () => {
      throw httpError(501, 'MUSE_LOGIN_WINDOW_UNAVAILABLE', 'Cửa sổ đăng nhập Muse chưa được khởi tạo.');
    });
    this.measureMuseSession = options.measureMuseSession || (async () => {
      throw httpError(501, 'MUSE_SESSION_MEASURE_UNAVAILABLE', 'Chưa khởi tạo được bộ đo phiên Muse.');
    });
    this.inspectMusePage = options.inspectMusePage || (async () => {
      throw httpError(501, 'MUSE_INSPECT_UNAVAILABLE', 'Chưa khởi tạo được bộ dò selector Muse.');
    });
    this.threadsDiscoverBusy = false;
    this.isOnline = options.isOnline || (() => true);
    this.quit = options.quit || (() => {});
    this.openDataFolder = options.openDataFolder || (() => {});
    this.getAppInfo = options.getAppInfo || (() => ({}));
    this.token = crypto.randomBytes(24).toString('hex');
    this.server = http.createServer((req, res) => this.handle(req, res));
    this.port = 0;
  }

  async start() {
    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(0, '127.0.0.1', () => {
        this.port = this.server.address().port;
        this.server.removeListener('error', reject);
        resolve();
      });
    });
    return { port: this.port, url: this.url() };
  }

  url() {
    return `http://127.0.0.1:${this.port}/?token=${this.token}`;
  }

  async stop() {
    await new Promise((resolve) => this.server.close(resolve));
  }

  authenticated(req, url) {
    const header = req.headers['x-app-token'];
    const query = url.searchParams.get('token');
    return (typeof header === 'string' && header === this.token) || query === this.token;
  }

  async handle(req, res) {
    const url = new URL(req.url, `http://127.0.0.1:${this.port}`);
    try {
      if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/media/')) {
        if (!this.authenticated(req, url)) {
          return json(res, 403, { error: { code: 'FORBIDDEN', message: 'Thiếu hoặc sai token ứng dụng.' } });
        }
      }
      if (url.pathname.startsWith('/api/')) return await this.handleApi(req, res, url);
      if (url.pathname.startsWith('/media/')) return await this.handleMedia(req, res, url);
      return this.serveStatic(req, res, url);
    } catch (error) {
      const status = Number(error.statusCode) || 500;
      if (status >= 500) console.error('[server]', error);
      if (!res.headersSent) json(res, status, errorBody(error));
      else res.end();
    }
  }

  serveStatic(req, res, url) {
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === '/') pathname = '/index.html';
    const filePath = path.resolve(this.staticDir, `.${pathname}`);
    if (!filePath.startsWith(this.staticDir + path.sep)) {
      return json(res, 403, { error: { code: 'FORBIDDEN', message: 'Đường dẫn không hợp lệ.' } });
    }
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      return json(res, 404, { error: { code: 'NOT_FOUND', message: 'Không tìm thấy trang.' } });
    }
    serveFile(req, res, filePath, { cache: false });
  }

  currentInput({ requireReady = false } = {}) {
    const state = this.workspace.snapshot();
    if (!state.post || !state.comments.length) {
      if (requireReady) throw httpError(400, 'POST_REQUIRED', 'Chưa có bài Threads. Hãy cào bài hoặc nạp demo.');
      return { input: null, errors: [{ code: 'POST_REQUIRED', message: 'Chưa có bài Threads.' }], library: this.library.list() };
    }
    const selected = this.workspace.selectedComments();
    const library = this.library.list();
    let input;
    try {
      input = buildMuseInput({ post: state.post, comments: selected, library, settings: state.settings });
    } catch (error) {
      if (requireReady) throw httpError(400, 'INPUT_NOT_READY', error.message);
      return { input: null, errors: [{ code: 'INPUT_NOT_READY', message: error.message }], library };
    }
    const errors = preflightInput(input, library);
    if (requireReady && errors.length) {
      throw httpError(422, 'INPUT_NOT_READY', 'Input chưa sẵn sàng để gửi Muse.', errors);
    }
    return { input, errors, library };
  }

  assertMusePlanSourceAllowed(source) {
    if (source === 'muse') {
      if (!this.muse.status().loggedIn) {
        const error = httpError(403, 'MUSE_LOGIN_REQUIRED', this.muse.status().gateMessage);
        error.gateMessage = this.muse.status().gateMessage;
        throw error;
      }
    } else if (source === 'sample') {
      if (!this.ruleSlot.samplePlanEnabled()) {
        throw httpError(403, 'SAMPLE_DISABLED', 'Chế độ plan mẫu đã bị tắt trong muse_rule.json.');
      }
    } else {
      throw httpError(400, 'INVALID_SOURCE', 'Nguồn plan không hợp lệ.');
    }
  }

  async importPlanRaw(raw, source) {
    this.assertMusePlanSourceAllowed(source);
    const { input, library } = this.currentInput({ requireReady: true });
    const extracted = extractJsonText(raw);
    if (extracted.error) throw httpError(422, 'PLAN_JSON_INVALID', extracted.error);
    const result = validatePlan(extracted.value, input);
    if (!result.ok) {
      const error = httpError(422, 'PLAN_INVALID', 'Kế hoạch không hợp lệ. Đã dừng, không tự sửa và không render.', result.errors);
      error.details = result.errors;
      throw error;
    }
    const state = await this.workspace.setDraftPlan(result.plan, {
      source,
      imported_at: new Date().toISOString(),
      input_hash: hashInput(input),
      origin_label: source === 'muse' ? 'Muse' : 'Plan mẫu (test)',
    });
    return { workspace: state, plan: result.plan, preflight: preflightInput(input, library), input_hash: hashInput(input) };
  }

  async handleApi(req, res, url) {
    const { pathname } = url;
    const method = req.method || 'GET';

    if (pathname === '/api/status' && method === 'GET') {
      return json(res, 200, {
        app: this.getAppInfo(),
        muse: this.muse.status(),
        threads: await this.threadsLoginState(),
        library: { stats: this.library.stats(), total: this.library.list().length },
        renderer: require('./render').describe(),
        online: Boolean(this.isOnline()),
        sample_plan_enabled: this.ruleSlot.samplePlanEnabled(),
        ui: { gate_message: this.muse.status().gateMessage },
      });
    }

    if (pathname === '/api/workspace' && method === 'GET') {
      const computed = this.currentInput();
      return json(res, 200, {
        workspace: this.workspace.snapshot(),
        selected_comments: this.workspace.selectedComments(),
        preflight: computed.errors,
        input_hash: computed.input ? hashInput(computed.input) : null,
        library_stats: this.library.stats(),
      });
    }

    if (pathname === '/api/workspace/selection' && method === 'PUT') {
      const body = await readJsonBody(req);
      const state = await this.workspace.setSelectedComments(body.ids || []);
      return json(res, 200, { workspace: state, selected_comments: this.workspace.selectedComments() });
    }

    if (pathname === '/api/workspace/settings' && method === 'PUT') {
      const body = await readJsonBody(req);
      const state = await this.workspace.setSettings(body);
      return json(res, 200, { workspace: state });
    }

    if (pathname === '/api/library' && method === 'GET') {
      const kind = url.searchParams.get('kind');
      let items = this.library.list();
      if (kind) items = items.filter((item) => item.kind === kind);
      return json(res, 200, {
        items: items.map((item) => ({
          ...item,
          media_url: `/media/library/${encodeURIComponent(item.id)}`,
        })),
        stats: this.library.stats(),
      });
    }

    if (pathname === '/api/library/upload' && method === 'POST') {
      const kind = url.searchParams.get('kind') || '';
      const limit = UPLOAD_LIMITS[kind];
      if (!limit) throw httpError(400, 'INVALID_KIND', 'Loại file không hợp lệ.');
      const { tempFile, size } = await streamToTempFile(req, path.join(this.dataDir, 'tmp'), limit);
      try {
        const item = await this.library.addFromTempFile({
          tempFile,
          originalName: url.searchParams.get('name') || 'file',
          kind,
          name: url.searchParams.get('name') || '',
          tags: url.searchParams.get('tags') || '',
          mime: req.headers['content-type'] || '',
        });
        return json(res, 201, { item: { ...item, media_url: `/media/library/${encodeURIComponent(item.id)}` }, size });
      } catch (error) {
        await fsp.unlink(tempFile).catch(() => {});
        throw error;
      }
    }

    const libraryMatch = pathname.match(/^\/api\/library\/([^/]+)$/);
    if (libraryMatch && method === 'PATCH') {
      const item = this.library.get(decodeURIComponent(libraryMatch[1]));
      if (!item) throw httpError(404, 'NOT_FOUND', 'Không tìm thấy file.');
      const body = await readJsonBody(req);
      const updated = await this.library.update(item.id, { name: body.name, tags: body.tags });
      return json(res, 200, { item: { ...updated, media_url: `/media/library/${encodeURIComponent(updated.id)}` } });
    }
    if (libraryMatch && method === 'DELETE') {
      const item = this.library.get(decodeURIComponent(libraryMatch[1]));
      if (!item) throw httpError(404, 'NOT_FOUND', 'Không tìm thấy file.');
      const refs = new Set();
      for (const plan of [this.workspace.state.draft_plan, this.workspace.state.approved_plan]) {
        for (const ref of this.library.findReferences(plan)) refs.add(ref.id);
      }
      for (const id of this.jobs.referencedLibraryIds()) refs.add(id);
      if (refs.has(item.id)) {
        throw httpError(
          409,
          'FILE_IN_USE',
          'File đang được dùng trong kế hoạch hoặc job chưa xong. Hãy xử lý job/kế hoạch trước khi xóa.',
        );
      }
      await this.library.remove(item.id);
      return json(res, 200, { removed: item.id });
    }

    if (pathname === '/api/plan/input' && method === 'GET') {
      const computed = this.currentInput();
      return json(res, 200, {
        input: computed.input,
        errors: computed.errors,
        ready: Boolean(computed.input) && computed.errors.length === 0,
        input_hash: computed.input ? hashInput(computed.input) : null,
        library_stats: this.library.stats(),
      });
    }

    if (pathname === '/api/plan/import' && method === 'POST') {
      const body = await readJsonBody(req, 4 * 1024 * 1024);
      if (typeof body.raw !== 'string') throw httpError(400, 'RAW_REQUIRED', 'Thiếu nội dung JSON kế hoạch.');
      const result = await this.importPlanRaw(body.raw, body.source || 'muse');
      return json(res, 200, result);
    }

    if (pathname === '/api/plan/import-sample' && method === 'POST') {
      const body = await readJsonBody(req);
      const raw = body.invalid ? this.demo.invalidPlanRaw() : this.demo.samplePlanRaw();
      const result = await this.importPlanRaw(raw, 'sample');
      return json(res, 200, result);
    }

    if (pathname === '/api/plan/approve' && method === 'POST') {
      const body = await readJsonBody(req, 4 * 1024 * 1024);
      if (!body.plan || typeof body.plan !== 'object') throw httpError(400, 'PLAN_REQUIRED', 'Thiếu kế hoạch để duyệt.');
      const meta = this.workspace.state.plan_meta;
      if (!meta) throw httpError(400, 'PLAN_NOT_IMPORTED', 'Chưa nạp kế hoạch từ Muse/plan mẫu.');
      const { input } = this.currentInput({ requireReady: true });
      const result = validatePlan(body.plan, input);
      if (!result.ok) {
        throw httpError(422, 'PLAN_INVALID', 'Kế hoạch sau khi sửa không hợp lệ. Đã dừng, không render.', result.errors);
      }
      const state = await this.workspace.approvePlan(result.plan, {
        ...meta,
        approved_source: meta.source,
        approved_input_hash: hashInput(input),
      });
      return json(res, 200, { workspace: state, plan: result.plan });
    }

    if (pathname === '/api/muse/status' && method === 'GET') {
      return json(res, 200, this.muse.status());
    }
    if (pathname === '/api/muse/config' && method === 'POST') {
      const body = await readJsonBody(req);
      this.ruleSlot.saveConfig(body);
      this.muse.loggedIn = false;
      this.muse.verifiedAt = null;
      return json(res, 200, { ok: true, status: this.muse.status() });
    }
    if (pathname === '/api/muse/session/open' && method === 'POST') {
      const result = await this.openMuseLoginWindow();
      return json(res, 200, { ok: true, window: result, status: this.muse.status() });
    }
    if (pathname === '/api/muse/session/measure' && method === 'POST') {
      const result = await this.measureMuseSession();
      return json(res, 200, result);
    }
    if (pathname === '/api/muse/inspect' && method === 'POST') {
      const result = await this.inspectMusePage();
      return json(res, 200, result);
    }
    if (pathname === '/api/muse/verify' && method === 'POST') {
      const body = await readJsonBody(req);
      const result = await this.muse.verify({ webContentsId: body.webContentsId });
      return json(res, 200, result);
    }
    if (pathname === '/api/muse/reload' && method === 'POST') {
      this.ruleSlot.reload();
      this.muse.loggedIn = false;
      return json(res, 200, this.muse.status());
    }
    if (pathname === '/api/muse/prompt' && method === 'POST') {
      if (!this.muse.status().loggedIn) {
        const error = httpError(403, 'MUSE_LOGIN_REQUIRED', this.muse.status().gateMessage);
        error.gateMessage = this.muse.status().gateMessage;
        throw error;
      }
      const body = await readJsonBody(req, 8 * 1024 * 1024);
      const prompt = this.ruleSlot.buildPrompt(body.input || {}, Array.isArray(body.errors) ? body.errors : []);
      return json(res, 200, { prompt });
    }
    if (pathname === '/api/muse/bridge/send' && method === 'POST') {
      const body = await readJsonBody(req, 8 * 1024 * 1024);
      const text = body.input
        ? this.ruleSlot.buildPrompt(body.input, Array.isArray(body.errors) ? body.errors : [])
        : body.text || '';
      const result = await this.muse.sendPrompt({ webContentsId: body.webContentsId, text });
      return json(res, 200, { ...result, prompt: text });
    }

    if (pathname === '/api/threads/session' && method === 'GET') {
      return json(res, 200, await this.threadsLoginState());
    }
    if (pathname === '/api/threads/login' && method === 'POST') {
      const result = await this.openThreadsLoginWindow();
      return json(res, 200, result);
    }
    if (pathname === '/api/threads/discover' && method === 'POST') {
      if (!this.isOnline()) {
        throw httpError(503, 'OFFLINE', 'Mất kết nối mạng. Tool không tự bịa dữ liệu; hãy kiểm tra wifi rồi thử lại.');
      }
      const body = await readJsonBody(req);
      const topic = String(body.topic || '').trim();
      if (topic.length < 2) throw httpError(400, 'INVALID_TOPIC', 'Chủ đề cần có ít nhất 2 ký tự.');
      if (topic.length > 120) throw httpError(400, 'INVALID_TOPIC', 'Chủ đề quá dài.');
      const limit = Math.max(1, Math.min(20, Number(body.limit) || 5));
      const maxAgeHours = Math.max(1, Math.min(24 * 30, Number(body.maxAgeHours) || 72));
      const sort = body.sort === 'recent' ? 'recent' : 'trend';
      const login = await this.threadsLoginState();
      let mode = body.mode;
      if (!['guest', 'account'].includes(mode)) mode = login.loggedIn ? 'account' : 'guest';
      if (mode === 'account' && !login.loggedIn) {
        const error = httpError(
          401,
          'THREADS_LOGIN_REQUIRED',
          'Chế độ Tài khoản Threads cần đăng nhập Threads trước khi tìm bài. Hãy đăng nhập Threads hoặc chọn Ẩn danh.',
        );
        error.gateMessage = error.message;
        throw error;
      }
      if (this.threadsDiscoverBusy) {
        throw httpError(429, 'DISCOVERY_BUSY', 'Đang có một lượt tìm Threads khác. Chờ hoàn tất rồi thử lại.');
      }
      this.threadsDiscoverBusy = true;
      let result;
      try {
        result = await Promise.race([
          this.discoverThreads({ topic, limit, maxAgeHours, sort, mode }),
          new Promise((resolve) =>
            setTimeout(
              () =>
                resolve({
                  ok: false,
                  code: 'TIMEOUT',
                  message: 'Threads tìm kiếm quá lâu. Kiểm tra wifi/đăng nhập Threads rồi thử lại.',
                }),
              55000,
            ),
          ),
        ]);
      } finally {
        this.threadsDiscoverBusy = false;
      }
      if (!result.ok) {
        const status = result.code === 'THREADS_LOGIN_REQUIRED' ? 401 : result.code === 'TIMEOUT' ? 504 : 422;
        const error = new Error(result.message || 'Không tìm được bài Threads.');
        error.statusCode = status;
        error.code = result.code || 'DISCOVERY_FAILED';
        error.details = result;
        throw error;
      }
      return json(res, 200, {
        result: {
          candidates: result.candidates || [],
          warnings: result.warnings || [],
          stats: result.stats || null,
          meta: result.meta || null,
          requested: result.requested,
          found: result.found,
          tokens: result.tokens || [],
        },
        threads: await this.threadsLoginState(),
      });
    }
    if (pathname === '/api/threads/scrape' && method === 'POST') {
      if (!this.isOnline()) {
        throw httpError(503, 'OFFLINE', 'Mất kết nối mạng. Tool không tự bịa dữ liệu; hãy kiểm tra wifi rồi thử lại.');
      }
      const body = await readJsonBody(req);
      const login = await this.threadsLoginState();
      let mode = body.mode;
      if (!['guest', 'account'].includes(mode)) mode = login.loggedIn ? 'account' : 'guest';
      if (mode === 'account' && !login.loggedIn) {
        const error = httpError(
          401,
          'THREADS_LOGIN_REQUIRED',
          'Chế độ Tài khoản Threads cần đăng nhập Threads trước khi cào bài. Hãy đăng nhập Threads hoặc chọn Ẩn danh.',
        );
        error.gateMessage = error.message;
        throw error;
      }
      const result = await Promise.race([
        this.scrapeThreads(body.url, { mode }),
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                ok: false,
                code: 'TIMEOUT',
                message: 'Threads tải quá lâu. Kiểm tra wifi/đăng nhập Threads rồi thử lại.',
              }),
            60000,
          ),
        ),
      ]);
      if (!result.ok) {
        const error = new Error(result.message || 'Không cào được Threads.');
        error.statusCode = result.code === 'LOGIN_REQUIRED' ? 401 : 422;
        error.code = result.code || 'SCRAPE_FAILED';
        error.details = result;
        throw error;
      }
      const state = await this.workspace.setPostAndComments(result.post, result.comments);
      return json(res, 200, {
        result: {
          post: result.post,
          comments: result.comments,
          warnings: result.warnings || [],
          stats: result.stats || {},
        },
        workspace: state,
        selected_comments: this.workspace.selectedComments(),
      });
    }

    if (pathname === '/api/jobs' && method === 'GET') {
      return json(res, 200, { jobs: this.jobs.list().map((job) => this.jobs.publicJob(job)) });
    }
    if (pathname === '/api/jobs' && method === 'POST') {
      const state = this.workspace.snapshot();
      if (!state.approved_plan) {
        throw httpError(409, 'PLAN_NOT_APPROVED', 'Kế hoạch chưa được duyệt. Không thể tạo job.');
      }
      const { input } = this.currentInput({ requireReady: true });
      const check = validatePlan(state.approved_plan, input);
      if (!check.ok) {
        await this.workspace.setPlanStale('Kế hoạch không còn khớp input hiện tại. Hãy duyệt lại.');
        throw httpError(422, 'PLAN_STALE', 'Kế hoạch không còn hợp lệ với dữ liệu hiện tại. Không render.', check.errors);
      }
      const ids = new Set([state.settings.background_video_id]);
      ids.add(check.plan.music_id);
      for (const segment of check.plan.segments) {
        ids.add(segment.meme_id);
        ids.add(segment.sfx_id);
      }
      const assets = [...ids]
        .map((id) => this.library.get(id))
        .filter(Boolean)
        .map(({ id, kind, name, tags, duration, file, mediaType, mime, size }) => ({
          id,
          kind,
          name,
          tags,
          duration,
          file,
          mediaType,
          mime,
          size,
        }));
      const missing = [...ids].filter((id) => !this.library.get(id));
      if (missing.length) {
        throw httpError(409, 'ASSET_MISSING', `Thiếu file trong kho: ${missing.join(', ')}. Kế hoạch được giữ nguyên.`);
      }
      const job = await this.jobs.enqueue({
        title: check.plan.title,
        plan: check.plan,
        plan_source: state.plan_meta?.source || 'unknown',
        post: state.post,
        comments: input.comments,
        settings: state.settings,
        assets,
        input_hash: hashInput(input),
      });
      return json(res, 201, { job: this.jobs.publicJob(job) });
    }

    const jobMatch = pathname.match(/^\/api\/jobs\/([^/]+)(?:\/(retry|delete))?$/);
    if (jobMatch) {
      const id = decodeURIComponent(jobMatch[1]);
      const action = jobMatch[2] || '';
      const job = this.jobs.get(id);
      if (!job) throw httpError(404, 'JOB_NOT_FOUND', 'Không tìm thấy job.');
      if (method === 'GET' && !action) return json(res, 200, { job: this.jobs.publicJob(job) });
      if (method === 'POST' && action === 'retry') {
        const retried = await this.jobs.retry(id);
        return json(res, 200, { job: this.jobs.publicJob(retried) });
      }
      if (method === 'POST' && action === 'delete') {
        await this.jobs.remove(id);
        return json(res, 200, { removed: id });
      }
    }

    if (pathname === '/api/demo/sample-plan' && method === 'GET') {
      return json(res, 200, {
        raw: this.demo.samplePlanRaw(),
        invalid_raw: this.demo.invalidPlanRaw(),
        enabled: this.ruleSlot.samplePlanEnabled(),
      });
    }
    if (pathname === '/api/demo/load' && method === 'POST') {
      const result = await this.demo.load();
      return json(res, 200, {
        ...result,
        workspace: this.workspace.snapshot(),
        selected_comments: this.workspace.selectedComments(),
        library: { items: this.library.list(), stats: this.library.stats() },
      });
    }
    if (pathname === '/api/app/open-data' && method === 'POST') {
      this.openDataFolder();
      return json(res, 200, { ok: true });
    }
    if (pathname === '/api/app/quit' && method === 'POST') {
      json(res, 200, { ok: true });
      setTimeout(() => this.quit(), 100);
      return;
    }

    throw httpError(404, 'NOT_FOUND', 'API không tồn tại.');
  }

  async handleMedia(req, res, url) {
    const method = req.method || 'GET';
    if (!['GET', 'HEAD'].includes(method)) throw httpError(405, 'METHOD_NOT_ALLOWED', 'Không hỗ trợ phương thức này.');
    const libraryMatch = url.pathname.match(/^\/media\/library\/([^/]+)$/);
    if (libraryMatch) {
      const item = this.library.get(decodeURIComponent(libraryMatch[1]));
      if (!item) throw httpError(404, 'NOT_FOUND', 'Không tìm thấy file trong kho.');
      return serveFile(req, res, this.library.mediaPath(item), { cache: true });
    }
    const outputMatch = url.pathname.match(/^\/media\/outputs\/([^/]+)$/);
    if (outputMatch) {
      const file = path.basename(decodeURIComponent(outputMatch[1]));
      if (!file || file !== decodeURIComponent(outputMatch[1])) throw httpError(403, 'FORBIDDEN', 'Tên file không hợp lệ.');
      const job = this.jobs.get(path.basename(file, '.mp4'));
      if (!job || job.output_file !== file) throw httpError(404, 'NOT_FOUND', 'Không tìm thấy video.');
      return serveFile(req, res, this.jobs.outputPath(job), {
        downloadName: url.searchParams.get('download') ? `${safeFileName(job.title, 'video')}.mp4` : null,
      });
    }
    throw httpError(404, 'NOT_FOUND', 'Không tìm thấy media.');
  }
}

module.exports = {
  LocalServer,
  MIME,
  UPLOAD_LIMITS,
  readJsonBody,
  httpError,
  serveFile,
};
