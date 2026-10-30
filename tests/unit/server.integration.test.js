'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { LocalServer } = require('../../app/main/server');
const { Library } = require('../../app/main/library');
const { Workspace } = require('../../app/main/workspace');
const { JobQueue } = require('../../app/main/jobs');
const { DemoService } = require('../../app/main/demo');
const { MUSE_LOGIN_MESSAGE } = require('../../app/main/muse');

const ROOT = path.resolve(__dirname, '..', '..');
const GATE = MUSE_LOGIN_MESSAGE;
const SAMPLE_PLAN = JSON.parse(fs.readFileSync(path.join(ROOT, 'demo', 'sample-plan.json'), 'utf8'));

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), '3am-server-test-'));
}

function createFakeMuse() {
  const fake = {
    loggedIn: false,
    verifiedAt: null,
    status() {
      return {
        name: 'Muse',
        configured: true,
        loginCheckConfigured: true,
        loggedIn: fake.loggedIn,
        verifiedAt: fake.verifiedAt,
        gateMessage: GATE,
        bridge: { autoReady: true, mode: 'auto' },
        ruleAttached: false,
        samplePlanEnabled: true,
        configFile: 'muse_rule.json',
        message: fake.loggedIn ? 'Đã đăng nhập Muse.' : 'Chưa xác thực được phiên đăng nhập Muse.',
      };
    },
    async verify() {
      return { ...fake.status(), ok: fake.loggedIn };
    },
    async sendPrompt() {
      if (!fake.loggedIn) {
        const error = new Error(GATE);
        error.statusCode = 403;
        error.code = 'MUSE_LOGIN_REQUIRED';
        error.gateMessage = GATE;
        throw error;
      }
      return { raw: JSON.stringify(SAMPLE_PLAN) };
    },
  };
  return fake;
}

function createFakeQueue(dataDir, library) {
  const control = { fail: false, renders: [] };
  const adapter = {
    id: 'test-adapter',
    label: 'Test adapter',
    production: false,
    note: 'test',
    async render(ctx) {
      control.renders.push(JSON.parse(JSON.stringify(ctx.plan)));
      ctx.onProgress('Đang test', 50);
      if (control.fail) throw new Error('Lỗi test có chủ đích');
      fs.writeFileSync(ctx.outputPath, Buffer.alloc(4096, 7));
      return { file: ctx.outputPath, durationSeconds: 60, width: 576, height: 1024, fps: 30 };
    },
  };
  const queue = new JobQueue({ dataDir, library, adapterProvider: () => adapter });
  return { queue, control };
}

function createHarness(t) {
  const dir = tempDir();
  const root = ROOT;
  const library = new Library(dir);
  const workspace = new Workspace(dir);
  const demo = new DemoService({ rootDir: root, library, workspace });
  const fakeMuse = createFakeMuse();
  const { queue, control } = createFakeQueue(dir, library);
  const discoveryControl = { calls: [] };
  const threadsControl = { loggedIn: false };
  const ruleSlot = {
    samplePlanEnabled: () => true,
    reload: () => ({}),
    publicInfo: () => ({ samplePlanEnabled: true }),
  };
  const server = new LocalServer({
    rootDir: root,
    dataDir: dir,
    library,
    workspace,
    jobs: queue,
    muse: fakeMuse,
    ruleSlot,
    demo,
    scrapeThreads: async () => ({ ok: false, code: 'LOGIN_REQUIRED', message: 'test login required' }),
    discoverThreads: async (options) => {
      discoveryControl.calls.push(options);
      return {
        ok: true,
        candidates: [
          {
            post_id: 'disco1',
            code: 'disco1',
            author: 'test_cat',
            time: new Date().toISOString(),
            text: 'Mèo test mới',
            likes: 10,
            comments_count: 2,
            shares_count: 1,
            age_hours: 1,
            trend_score: 9.5,
            relevance: 1,
            matched_terms: ['meo'],
            has_comments: true,
            url: 'https://www.threads.com/@test_cat/post/disco1',
          },
        ],
        warnings: ['test warning'],
        stats: { selected: 1 },
        meta: { ...options, searchUrl: 'https://www.threads.com/search?q=test' },
        requested: options.limit,
        found: 1,
        tokens: ['meo'],
      };
    },
    threadsLoginState: async () => ({ loggedIn: threadsControl.loggedIn, checked: true }),
    openThreadsLoginWindow: async () => ({ opened: true }),
    isOnline: () => true,
    quit: () => {},
    openDataFolder: () => {},
    getAppInfo: () => ({ name: '3AM Test', version: '0.0.0' }),
  });
  t.after(async () => {
    await server.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const base = () => `http://127.0.0.1:${server.port}`;
  const request = async (pathname, options = {}) => {
    const headers = { 'X-App-Token': server.token, ...(options.headers || {}) };
    let body = options.body;
    if (options.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.json);
    }
    const response = await fetch(base() + pathname, { method: options.method || 'GET', headers, body });
    const text = await response.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    return { status: response.status, data, headers: response.headers };
  };
  return { server, dir, library, workspace, demo, fakeMuse, queue, control, discoveryControl, threadsControl, request, base };
}

async function waitForJob(harness, jobId, status, timeout = 6000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await harness.request(`/api/jobs/${jobId}`);
    if (result.data?.job?.status === status) return result.data.job;
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
  throw new Error(`Job did not reach ${status}`);
}

test('full API flow: gate, strict validation, manual edit, queue, retry, export', async (t) => {
  const h = createHarness(t);
  await h.server.start();

  const status = await h.request('/api/status');
  assert.equal(status.status, 200);
  assert.equal(status.data.muse.loggedIn, false);
  assert.equal(status.data.muse.gateMessage, GATE);

  const demo = await h.request('/api/demo/load', { method: 'POST', json: {} });
  assert.equal(demo.status, 200);
  assert.equal(demo.data.workspace.post.author, 'meo.va.cho');
  assert.equal(demo.data.workspace.comments.length, 5);

  const input = await h.request('/api/plan/input');
  assert.equal(input.status, 200);
  assert.equal(input.data.ready, true);
  assert.equal(input.data.input.comments.length, 5);
  assert.ok(input.data.input.library.some((item) => item.background_video_id === 'bg_demo_cozy'));
  for (const comment of input.data.input.comments) {
    const source = demo.data.workspace.comments.find((entry) => entry.comment_id === comment.comment_id);
    assert.equal(comment.text, source.text);
  }

  const lockedMuseImport = await h.request('/api/plan/import', {
    method: 'POST',
    json: { raw: JSON.stringify(SAMPLE_PLAN), source: 'muse' },
  });
  assert.equal(lockedMuseImport.status, 403);
  assert.equal(lockedMuseImport.data.error.code, 'MUSE_LOGIN_REQUIRED');
  assert.equal(lockedMuseImport.data.error.gateMessage, GATE);

  const invalid = await h.request('/api/plan/import-sample', { method: 'POST', json: { invalid: true } });
  assert.equal(invalid.status, 422);
  assert.equal(invalid.data.error.code, 'PLAN_INVALID');
  assert.ok(Array.isArray(invalid.data.error.details) && invalid.data.error.details.length > 0);
  const codes = new Set(invalid.data.error.details.map((error) => error.code));
  assert.ok(codes.has('UNKNOWN_MEME_ID'));
  assert.ok(codes.has('UNKNOWN_MUSIC_ID'));
  assert.ok(codes.has('UNKNOWN_SFX_ID'));
  assert.ok(codes.has('TEXT_MISMATCH'));

  const workspaceAfterInvalid = await h.request('/api/workspace');
  assert.equal(workspaceAfterInvalid.data.workspace.draft_plan, null, 'invalid plan must not be stored');
  assert.equal(workspaceAfterInvalid.data.workspace.approved_plan, null);

  const valid = await h.request('/api/plan/import-sample', { method: 'POST', json: {} });
  assert.equal(valid.status, 200);
  assert.equal(valid.data.plan.title, SAMPLE_PLAN.title);
  assert.equal(valid.data.workspace.draft_plan.title, SAMPLE_PLAN.title);
  assert.equal(valid.data.workspace.approved_plan, null, 'import must not auto-approve');

  const edited = JSON.parse(JSON.stringify(valid.data.plan));
  edited.title = 'Tiêu đề người dùng sửa tay';
  edited.segments[0].meme_id = 'meme_demo_cat_glass';
  edited.music_id = 'music_demo_lofi';
  const approved = await h.request('/api/plan/approve', { method: 'POST', json: { plan: edited } });
  assert.equal(approved.status, 200);
  assert.equal(approved.data.workspace.approved_plan.title, 'Tiêu đề người dùng sửa tay');
  assert.equal(approved.data.workspace.approved_plan.segments[0].meme_id, 'meme_demo_cat_glass');

  const jobResponse = await h.request('/api/jobs', { method: 'POST', json: {} });
  assert.equal(jobResponse.status, 201);
  const job = await waitForJob(h, jobResponse.data.job.id, 'done');
  assert.equal(job.plan.title, 'Tiêu đề người dùng sửa tay');
  assert.equal(job.plan.segments[0].meme_id, 'meme_demo_cat_glass');
  assert.equal(job.plan_source, 'sample');
  assert.ok(h.control.renders.length >= 1);
  assert.equal(h.control.renders[0].title, 'Tiêu đề người dùng sửa tay');
  assert.equal(h.control.renders[0].segments[0].meme_id, 'meme_demo_cat_glass');

  const range = await h.request(`/media/outputs/${job.output_file}`, {
    headers: { Range: 'bytes=0-99' },
  });
  assert.equal(range.status, 206);
  assert.match(range.headers.get('content-range'), /^bytes 0-99\//);

  const deleteReferenced = await h.request('/api/library/music_demo_lofi', { method: 'DELETE' });
  assert.equal(deleteReferenced.status, 409);
  assert.equal(deleteReferenced.data.error.code, 'FILE_IN_USE');

  h.control.fail = true;
  const failing = await h.request('/api/jobs', { method: 'POST', json: {} });
  assert.equal(failing.status, 201);
  const failed = await waitForJob(h, failing.data.job.id, 'error');
  assert.match(failed.error, /Lỗi test có chủ đích/);
  assert.ok(failed.plan, 'failed job keeps its plan');
  assert.equal(failed.plan.title, 'Tiêu đề người dùng sửa tay');
  const workspaceAfterFailure = await h.request('/api/workspace');
  assert.ok(workspaceAfterFailure.data.workspace.approved_plan, 'approved plan must survive a failed job');

  h.control.fail = false;
  const retried = await h.request(`/api/jobs/${failing.data.job.id}/retry`, { method: 'POST', json: {} });
  assert.equal(retried.status, 200);
  const retriedDone = await waitForJob(h, failing.data.job.id, 'done');
  assert.equal(retriedDone.plan.title, 'Tiêu đề người dùng sửa tay');
  assert.ok(retriedDone.attempts >= 2);

  h.fakeMuse.loggedIn = true;
  h.fakeMuse.verifiedAt = new Date().toISOString();
  const unlockedImport = await h.request('/api/plan/import', {
    method: 'POST',
    json: { raw: '```json\n' + JSON.stringify(SAMPLE_PLAN) + '\n```', source: 'muse' },
  });
  assert.equal(unlockedImport.status, 200);
  assert.equal(unlockedImport.data.workspace.plan_meta.source, 'muse');
});

test('scrape failures are surfaced without overwriting the current post', async (t) => {
  const h = createHarness(t);
  await h.server.start();
  await h.request('/api/demo/load', { method: 'POST', json: {} });
  const before = await h.request('/api/workspace');
  const scrape = await h.request('/api/threads/scrape', {
    method: 'POST',
    json: { url: 'https://www.threads.com/@main/post/ABC' },
  });
  assert.equal(scrape.status, 401);
  assert.equal(scrape.data.error.code, 'LOGIN_REQUIRED');
  const after = await h.request('/api/workspace');
  assert.equal(after.data.workspace.post.post_id, before.data.workspace.post.post_id);
});

test('discovery defaults to anonymous, returns candidates, and gates account mode', async (t) => {
  const h = createHarness(t);
  await h.server.start();

  const anonymous = await h.request('/api/threads/discover', {
    method: 'POST',
    json: { topic: 'mèo', limit: 3, maxAgeHours: 72, sort: 'trend', mode: 'auto' },
  });
  assert.equal(anonymous.status, 200);
  assert.equal(anonymous.data.result.candidates.length, 1);
  assert.equal(anonymous.data.result.candidates[0].code, 'disco1');
  assert.equal(h.discoveryControl.calls[0].mode, 'guest');
  assert.equal(h.discoveryControl.calls[0].topic, 'mèo');
  assert.equal(h.discoveryControl.calls[0].limit, 3);

  const accountLocked = await h.request('/api/threads/discover', {
    method: 'POST',
    json: { topic: 'mèo', limit: 3, maxAgeHours: 72, mode: 'account' },
  });
  assert.equal(accountLocked.status, 401);
  assert.equal(accountLocked.data.error.code, 'THREADS_LOGIN_REQUIRED');

  h.threadsControl.loggedIn = true;
  const accountOpen = await h.request('/api/threads/discover', {
    method: 'POST',
    json: { topic: 'mèo', limit: 2, maxAgeHours: 48, mode: 'account' },
  });
  assert.equal(accountOpen.status, 200);
  assert.equal(h.discoveryControl.calls.at(-1).mode, 'account');

  const shortTopic = await h.request('/api/threads/discover', {
    method: 'POST',
    json: { topic: 'a', limit: 3, maxAgeHours: 72, mode: 'guest' },
  });
  assert.equal(shortTopic.status, 400);
  assert.equal(shortTopic.data.error.code, 'INVALID_TOPIC');
});

test('request without app token is rejected', async (t) => {
  const h = createHarness(t);
  await h.server.start();
  const response = await fetch(`${h.base()}/api/status`);
  assert.equal(response.status, 403);
});
