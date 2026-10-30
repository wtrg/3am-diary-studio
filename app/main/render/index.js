'use strict';

/*
 * RENDERER SLOT
 * Interface:
 *   adapter.render({ job, plan, post, comments, settings, assets, outputPath, tempDir,
 *                    screensDir, voiceTrackPath, onProgress, appendLog, signal })
 * Adapter không được sửa plan. Thiếu ảnh/file/không dựng được thì throw để job lỗi,
 * giữ nguyên plan cho lần chạy lại.
 *
 * Chọn adapter:
 * - Dữ liệu demo (post.source === 'demo') dùng demo renderer để test offline.
 * - Bài Threads live dùng production renderer, bắt buộc chụp ảnh DOM thật.
 * - Có thể override bằng biến môi trường RENDERER_ADAPTER=demo|production.
 */
const adapters = {
  demo: require('./demoRenderer'),
  production: require('./productionRenderer'),
};

function requestedKey() {
  const requested = process.env.RENDERER_ADAPTER;
  return requested && adapters[requested] ? requested : '';
}

function getAdapter(job) {
  const forced = requestedKey();
  if (forced) return adapters[forced];
  const isDemo =
    job?.post?.source === 'demo' ||
    /(^demo:|DEMO3AM)/i.test(String(job?.post?.url || ''));
  if (isDemo) return adapters.demo;
  return adapters.production || adapters.demo;
}

function describeAdapter(adapter) {
  return {
    id: adapter.id || 'demo',
    label: adapter.label || adapter.id || 'Renderer',
    production: Boolean(adapter.production),
    note: adapter.note || '',
  };
}

function describe() {
  const forced = requestedKey();
  if (forced) return describeAdapter(adapters[forced]);
  return {
    id: 'auto',
    label: 'Production (live) · Demo (dữ liệu demo)',
    production: true,
    note:
      'Bài Threads live dùng production renderer + ảnh chụp DOM thật; dữ liệu demo dùng renderer demo offline. Không vẽ lại card nếu ảnh chụp thiếu.',
  };
}

module.exports = { getAdapter, describe, describeAdapter, adapters };
