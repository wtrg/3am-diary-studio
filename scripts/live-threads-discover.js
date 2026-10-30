'use strict';

// Smoke test thủ công cho Threads discovery. Chạy:
//   node_modules/electron/dist/electron.exe scripts/live-threads-discover.js "mèo" 5 72
// Không tự lưu bài vào kho/workspace; chỉ in danh sách ứng viên.

const { app } = require('electron');
const { discoverThreads } = require('../app/main/threads/discoverThreads');

const topic = process.argv[2] || 'mèo';
const limit = Number(process.argv[3]) || 5;
const maxAgeHours = Number(process.argv[4]) || 72;

app.whenReady().then(async () => {
  const started = Date.now();
  const result = await discoverThreads({
    topic,
    limit,
    maxAgeHours,
    sort: 'trend',
    mode: 'guest',
    log: (line) => console.log('[discover]', line),
  });
  const summary = {
    elapsed_ms: Date.now() - started,
    ok: Boolean(result.ok),
    code: result.code || null,
    message: result.message || null,
    found: result.found || 0,
    warnings: result.warnings || [],
    stats: result.stats || null,
    candidates: (result.candidates || []).map((candidate) => ({
      author: candidate.author,
      time: candidate.time,
      age_hours: candidate.age_hours,
      likes: candidate.likes,
      comments: candidate.comments_count,
      shares: candidate.shares_count,
      trend_score: candidate.trend_score,
      relevance: candidate.relevance,
      matched_terms: candidate.matched_terms,
      text: candidate.text.slice(0, 100),
      url: candidate.url,
    })),
  };
  console.log(JSON.stringify(summary, null, 2));
  app.quit();
});

setTimeout(() => {
  console.error('HARD TIMEOUT discovery 55s');
  app.exit(2);
}, 55000).unref();
