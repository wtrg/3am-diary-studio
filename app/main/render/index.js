'use strict';

/*
 * RENDERER SLOT
 * Adapter cuối cùng sẽ được gắn ở đây (phase sau). Queue chỉ gọi interface:
 *   adapter.render({ job, plan, post, comments, settings, assets, outputPath, tempDir,
 *                    onProgress, appendLog, signal })
 * Trả về { file, durationSeconds?, width?, height?, fps? }.
 * Adapter KHÔNG được sửa plan. Nếu thiếu file/không dựng được thì throw để job lỗi,
 * giữ nguyên plan cho lần chạy lại.
 */
const adapters = {
  demo: require('./demoRenderer'),
  // production: require('./productionRenderer'),  // gắn renderer cuối cùng tại đây
};

function adapterKey() {
  const requested = process.env.RENDERER_ADAPTER || 'demo';
  return adapters[requested] ? requested : 'demo';
}

function getAdapter() {
  return adapters[adapterKey()];
}

function describe() {
  const adapter = getAdapter();
  return {
    id: adapter.id || adapterKey(),
    label: adapter.label || adapterKey(),
    production: Boolean(adapter.production),
    note: adapter.note || '',
  };
}

module.exports = { getAdapter, describe, adapters };
