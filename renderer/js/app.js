'use strict';

const GATE_FALLBACK =
  'Cần đăng nhập tài khoản Muse kèm theo tool để tiếp tục. Không có tài khoản, tool không chạy.';

const TOKEN = new URLSearchParams(window.location.search).get('token') || '';

const KINDS = {
  meme: { label: 'Meme', plural: 'Meme', accept: '.png,.jpg,.jpeg,.webp,.gif,.mp4,.mov,.webm,.m4v' },
  music: { label: 'Nhạc nền', plural: 'Nhạc nền', accept: '.mp3,.wav,.m4a,.aac,.ogg,.flac' },
  sfx: { label: 'SFX', plural: 'SFX', accept: '.mp3,.wav,.m4a,.aac,.ogg' },
  background: { label: 'Video nền', plural: 'Video nền', accept: '.mp4,.mov,.webm,.m4v' },
};

const JOB_FILTERS = [
  ['all', 'Tất cả'],
  ['active', 'Đang xử lý'],
  ['done', 'Xong'],
  ['error', 'Lỗi'],
];

const VOICE_SUGGESTIONS = [
  'Giọng nữ kể chuyện (ấm, chậm)',
  'Giọng nam trầm',
  'Giọng nữ nhanh',
  'Giọng kể trung tính',
];

function blankStatus() {
  return {
    app: {},
    muse: {
      name: 'Muse',
      configured: false,
      loginCheckConfigured: false,
      loggedIn: false,
      verifiedAt: null,
      gateMessage: GATE_FALLBACK,
      bridge: { autoReady: false, mode: 'manual' },
      ruleAttached: false,
      samplePlanEnabled: true,
      configFile: 'muse_rule.json',
    },
    threads: { loggedIn: false, checked: false },
    renderer: { id: 'demo', label: 'Renderer demo', production: false, note: '' },
    library: { stats: {}, total: 0 },
    online: true,
    sample_plan_enabled: true,
  };
}

const state = {
  token: TOKEN,
  step: 1,
  status: blankStatus(),
  workspace: null,
  planInput: null,
  planInputErrors: [],
  inputHash: null,
  inputReady: false,
  plan: null,
  planMeta: null,
  planDirty: false,
  planErrors: [],
  planErrorMessage: '',
  planErrorCode: '',
  approved: false,
  jobs: [],
  jobFilter: 'all',
  jobSignature: '',
  jobError: '',
  library: [],
  libraryStats: { meme: 0, music: 0, sfx: 0, background: 0 },
  libraryFilter: { kind: 'all', q: '', tag: '' },
  threadsSession: { loggedIn: false, checked: false },
  threadsMode: 'auto',
  discovery: {
    topic: '',
    limit: 5,
    maxAgeHours: 72,
    sort: 'trend',
    loading: false,
    candidates: [],
    warnings: [],
    stats: null,
    meta: null,
    error: null,
    selectedCode: '',
  },
  scrapeUrl: '',
  scraping: false,
  scrapeError: null,
  scrapeWarnings: [],
  threadsLoginOpened: false,
  manualResponse: '',
  uploadKind: 'meme',
  settingsVoice: '',
  busy: {},
  uploadStatus: '',
  museWebview: null,
  museWebviewId: null,
  museExpanded: false,
  museTimer: null,
  jobsTimer: null,
  threadsTimer: null,
  statusTimer: null,
  step3Loaded: false,
  step3Error: '',
  modalResolve: null,
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

function esc(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (char) => {
    if (char === '&') return '&amp;';
    if (char === '<') return '&lt;';
    if (char === '>') return '&gt;';
    if (char === '"') return '&quot;';
    return '&#39;';
  });
}

function fmtLikes(value) {
  const number = Number(value) || 0;
  if (number >= 1000000) return `${(number / 1000000).toFixed(1).replace('.', ',')}M`;
  if (number >= 1000) return `${(number / 1000).toFixed(1).replace('.', ',')}K`;
  return String(number);
}

function fmtCount(value) {
  return new Intl.NumberFormat('vi-VN').format(Number(value) || 0);
}

function fmtTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
  }).format(date);
}

function fmtDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

function fmtDuration(seconds, mediaType) {
  if (mediaType === 'image' || seconds === 0) return 'Ảnh tĩnh';
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return '—';
  const minutes = Math.floor(value / 60);
  const secs = Math.floor(value % 60);
  return `${minutes}:${String(secs).padStart(2, '0')}`;
}

function fmtBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value >= 1024 * 1024 * 1024) return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(0)} KB`;
  return `${value} B`;
}

function plural(count, one, many) {
  return `${count} ${count === 1 ? one : many}`;
}

function kindLabel(kind) {
  return KINDS[kind]?.label || kind || 'File';
}

function kindBadge(kind) {
  const tone = kind === 'meme' ? 'badge-pink' : kind === 'music' ? 'badge-violet' : kind === 'sfx' ? 'badge-cyan' : 'badge-green';
  return `<span class="badge ${tone}">${esc(kindLabel(kind))}</span>`;
}

function mediaUrl(pathname) {
  if (!pathname) return '';
  try {
    const url = new URL(pathname, window.location.origin);
    url.searchParams.set('token', state.token);
    return `${url.pathname}${url.search}`;
  } catch {
    return '';
  }
}

function downloadUrl(pathname) {
  if (!pathname) return '';
  try {
    const url = new URL(pathname, window.location.origin);
    url.searchParams.set('download', '1');
    url.searchParams.set('token', state.token);
    return `${url.pathname}${url.search}`;
  } catch {
    return '';
  }
}

function isMuseConfigured() {
  return Boolean(state.status.muse?.configured);
}

function isMuseUnlocked() {
  return Boolean(state.status.muse?.configured && state.status.muse?.loggedIn);
}

function isMuseBridgeReady() {
  return Boolean(state.status.muse?.bridge?.autoReady);
}

function isOnlineNow() {
  if (state.status.online === false) return false;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
  return true;
}

function gateMessage() {
  return state.status.muse?.gateMessage || GATE_FALLBACK;
}

function threadsLoggedIn() {
  return Boolean(state.threadsSession?.loggedIn);
}

function resolvedThreadsMode(requested = state.threadsMode) {
  if (requested === 'guest' || requested === 'account') return requested;
  return threadsLoggedIn() ? 'account' : 'guest';
}

function threadsModeLabel(mode = state.threadsMode) {
  if (mode === 'guest') return 'Ẩn danh';
  if (mode === 'account') return 'Tài khoản Threads';
  return threadsLoggedIn() ? 'Tự động · tài khoản' : 'Tự động · ẩn danh';
}

function discoveryModeNote() {
  if (state.threadsMode === 'guest') {
    return 'Ẩn danh: không đăng nhập Threads. Threads có thể chỉ trả một phần kết quả/bình luận; tool sẽ báo rõ và không tự tạo thêm.';
  }
  if (state.threadsMode === 'account') {
    return threadsLoggedIn()
      ? 'Chế độ tài khoản: đang dùng phiên Threads đã đăng nhập; bình luận thường đầy đủ hơn.'
      : 'Chế độ tài khoản cần đăng nhập Threads trước. Hãy đăng nhập hoặc chuyển sang Ẩn danh.';
  }
  return threadsLoggedIn()
    ? 'Tự động: đang dùng phiên Threads đã đăng nhập.'
    : 'Tự động: chưa đăng nhập Threads nên sẽ chạy ẩn danh. Đăng nhập để lấy thêm bình luận.';
}

function ageLabel(hours) {
  const value = Number(hours);
  if (!Number.isFinite(value) || value < 0) return '—';
  if (value < 1) return 'dưới 1 giờ';
  if (value < 24) return `${String(Math.round(value * 10) / 10).replace('.', ',')} giờ`;
  return `${String(Math.round((value / 24) * 10) / 10).replace('.', ',')} ngày`;
}

function hasEffectiveApproval() {
  return Boolean(state.workspace?.approved_plan) && !state.planDirty;
}

function inputReady() {
  return Boolean(state.inputReady && state.planInput);
}

function currentPost() {
  return state.workspace?.post || null;
}

function allComments() {
  return Array.isArray(state.workspace?.comments) ? state.workspace.comments : [];
}

function selectedIds() {
  return Array.isArray(state.workspace?.selected_comment_ids) ? state.workspace.selected_comment_ids : [];
}

function selectedCommentObjects() {
  const map = new Map(allComments().map((comment) => [comment.comment_id, comment]));
  return selectedIds().map((id) => map.get(id)).filter(Boolean);
}

function commentMap() {
  return new Map(allComments().map((comment) => [comment.comment_id, comment]));
}

function orderedComments() {
  const comments = allComments();
  const selected = new Set(selectedIds());
  const byId = new Map(comments.map((comment) => [comment.comment_id, comment]));
  const first = selectedIds().map((id) => byId.get(id)).filter(Boolean);
  const rest = comments.filter((comment) => !selected.has(comment.comment_id));
  return [...first, ...rest];
}

function libraryOf(kind) {
  return state.library.filter((item) => !kind || item.kind === kind);
}

function libraryById(id) {
  return state.library.find((item) => item.id === id) || null;
}

function libraryStatsFromItems() {
  const stats = { meme: 0, music: 0, sfx: 0, background: 0 };
  for (const item of state.library) if (stats[item.kind] !== undefined) stats[item.kind] += 1;
  return stats;
}

function allKindsPresent() {
  const stats = libraryStatsFromItems();
  return stats.meme > 0 && stats.music > 0 && stats.sfx > 0 && stats.background > 0;
}

function planSourceLabel(source) {
  if (source === 'sample') return 'Plan mẫu (test)';
  if (source === 'muse') return 'Muse';
  return 'Chưa rõ nguồn';
}

function planSourceBadge(source) {
  if (source === 'sample') return '<span class="badge badge-amber">PLAN MẪU · TEST</span>';
  if (source === 'muse') return '<span class="badge badge-violet">MUSE</span>';
  return '<span class="badge">KHÔNG RÕ</span>';
}

class ApiError extends Error {
  constructor(status, payload) {
    const info = payload?.error || payload || {};
    super(info.message || `Lỗi HTTP ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.code = info.code || payload?.code || 'HTTP_ERROR';
    this.details = info.details || payload?.details || payload?.errors || null;
    this.gateMessage = info.gateMessage || payload?.gateMessage || '';
    this.payload = payload;
  }
}

async function api(path, options = {}) {
  const headers = { 'X-App-Token': state.token, ...(options.headers || {}) };
  let body = options.body;
  if (options.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.json);
  }
  const response = await fetch(path, { method: options.method || 'GET', headers, body, signal: options.signal });
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!response.ok) throw new ApiError(response.status, data);
  return data;
}

function showToast(message, type = 'info', timeout = 5000) {
  const host = document.getElementById('toastHost');
  if (!host) return;
  const node = document.createElement('div');
  node.className = `toast toast-${type}`;
  node.textContent = message;
  host.appendChild(node);
  window.setTimeout(() => {
    node.style.opacity = '0';
    node.style.transform = 'translateY(6px)';
    node.style.transition = 'opacity .2s ease, transform .2s ease';
    window.setTimeout(() => node.remove(), 240);
  }, timeout);
}

async function copyText(text, successMessage = 'Đã sao chép.') {
  try {
    await navigator.clipboard.writeText(String(text));
    showToast(successMessage, 'ok', 2200);
  } catch {
    const area = document.createElement('textarea');
    area.value = String(text);
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    try {
      document.execCommand('copy');
      showToast(successMessage, 'ok', 2200);
    } catch {
      showToast('Không sao chép được. Hãy chọn nội dung và copy thủ công.', 'warn');
    } finally {
      area.remove();
    }
  }
}

function scrollViewToElement(element, offset = 16) {
  const view = document.getElementById('view');
  if (!view || !element) return;
  const top = element.getBoundingClientRect().top - view.getBoundingClientRect().top + view.scrollTop - offset;
  view.scrollTo({ top: Math.max(0, top), behavior: 'auto' });
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function setBusy(key, value) {
  state.busy = { ...state.busy, [key]: Boolean(value) };
}

function planStateText() {
  if (!state.plan) return '';
  if (state.planDirty) return 'Có chỉnh sửa chưa duyệt. Bấm “Duyệt & lưu” để cập nhật kế hoạch trước khi dựng.';
  if (state.workspace?.approved_plan) return `Đã duyệt lúc ${fmtDateTime(state.workspace.approved_at)}.`;
  return 'Chưa duyệt. Kiểm tra nội dung, sau đó bấm “Duyệt & lưu kế hoạch”.';
}

function planStateTone() {
  if (state.planDirty) return 'stale-strip';
  if (state.workspace?.approved_plan) return 'approved-strip';
  return 'stale-strip';
}

function planInputCounts() {
  const counts = { comments: 0, memes: 0, music: 0, sfx: 0, backgrounds: 0 };
  if (!state.planInput) return counts;
  counts.comments = Array.isArray(state.planInput.comments) ? state.planInput.comments.length : 0;
  for (const item of state.planInput.library || []) {
    if (item.meme_id) counts.memes += 1;
    else if (item.music_id) counts.music += 1;
    else if (item.sfx_id) counts.sfx += 1;
    else if (item.background_video_id) counts.backgrounds += 1;
  }
  return counts;
}

function buildInputWarnings() {
  if (!state.planInputErrors?.length) return '';
  return `
    <div class="alert alert-warn">
      <span class="alert-icon">!</span>
      <div class="grow">
        <strong>Input chưa sẵn sàng.</strong>
        <ul class="error-list">
          ${state.planInputErrors
            .map((error) => `<li>${esc(error.message || error.code)} <code>${esc(error.code || '')}</code></li>`)
            .join('')}
        </ul>
      </div>
    </div>`;
}

function planErrorsBlock() {
  if (!state.planErrorCode && !state.planErrors.length && !state.planErrorMessage) return '';
  const items = (state.planErrors || [])
    .map((error) => `<li>${esc(error.message || error.code)} <code>${esc(error.path || '')} ${esc(error.code || '')}</code></li>`)
    .join('');
  return `
    <div class="alert alert-error" id="planValidationErrors">
      <span class="alert-icon">!</span>
      <div class="grow">
        <strong>${esc(state.planErrorMessage || 'Kế hoạch không hợp lệ.')}</strong>
        <div class="small" style="margin-top:2px">
          Tool đã dừng. Không tự sửa ID/nội dung, không tự render.
        </div>
        ${items ? `<ul class="error-list">${items}</ul>` : ''}
      </div>
    </div>`;
}

function renderChrome() {
  const titles = {
    1: ['Cào bài Threads', 'BƯỚC 1 / 4 · NGUỒN BÀI'],
    2: ['Kho file', 'BƯỚC 2 / 4 · TÀI NGUYÊN'],
    3: ['Muse &amp; duyệt kế hoạch', 'BƯỚC 3 / 4 · NỘI DUNG'],
    4: ['Hàng đợi &amp; xuất video', 'BƯỚC 4 / 4 · XUẤT BẢN'],
  };
  const current = titles[state.step] || titles[1];
  const titleEl = document.getElementById('pageTitle');
  if (titleEl) titleEl.innerHTML = current[0];
  const eyebrow = document.getElementById('pageEyebrow');
  if (eyebrow) eyebrow.textContent = current[1];

  $$('.step-item').forEach((button) => {
    button.classList.toggle('is-active', Number(button.dataset.step) === state.step);
  });

  const stats = libraryStatsFromItems();
  const stepDone = {
    1: Boolean(currentPost()),
    2: stats.meme > 0 && stats.music > 0 && stats.sfx > 0 && stats.background > 0,
    3: Boolean(state.workspace?.approved_plan),
    4: state.jobs.some((job) => job.status === 'done'),
  };
  $$('[data-step-dot]').forEach((dot) => {
    dot.classList.toggle('is-done', Boolean(stepDone[Number(dot.dataset.stepDot)]));
    dot.classList.toggle('is-locked', false);
  });

  renderChips();
  renderSidebarConnection();
  renderGlobalBanner();

  const version = document.getElementById('footerVersion');
  if (version) {
    version.textContent = `v${state.status.app?.version || '0.1.0'} · ${state.status.renderer?.label || 'Renderer demo'} · local`;
  }
  const netChip = document.getElementById('netChip');
  if (netChip) {
    netChip.classList.toggle('is-online', isOnlineNow());
    netChip.classList.toggle('is-offline', !isOnlineNow());
    netChip.innerHTML = `<span class="dot"></span><span>${isOnlineNow() ? 'Online' : 'Mất mạng'}</span>`;
  }
}

function renderChips() {
  const museChip = document.getElementById('museChip');
  if (museChip) {
    const unlocked = isMuseUnlocked();
    museChip.classList.toggle('is-logged-in', unlocked);
    museChip.classList.toggle('is-locked', !unlocked);
    museChip.textContent = unlocked
      ? 'Muse: đã đăng nhập'
      : isMuseConfigured()
        ? 'Muse: chưa đăng nhập'
        : 'Muse: chưa cấu hình';
    museChip.title = unlocked ? 'Muse đã xác thực đăng nhập' : gateMessage();
  }
  const rendererChip = document.getElementById('rendererChip');
  if (rendererChip) {
    const renderer = state.status.renderer || {};
    const label = renderer.label || 'Renderer demo';
    rendererChip.textContent = /^renderer\b/i.test(label) ? label : `Renderer: ${label}`;
    rendererChip.title = renderer.note || '';
  }
  const netChip = document.getElementById('netChip');
  if (netChip) {
    netChip.classList.toggle('is-online', isOnlineNow());
    netChip.classList.toggle('is-offline', !isOnlineNow());
    netChip.innerHTML = `<span class="dot"></span><span>${isOnlineNow() ? 'Online' : 'Mất mạng'}</span>`;
  }
}

function renderSidebarConnection() {
  const host = document.getElementById('sidebarConnection');
  if (!host) return;
  const museOk = isMuseUnlocked();
  const threadsOk = Boolean(state.threadsSession?.loggedIn);
  const museText = museOk ? 'Đã đăng nhập' : isMuseConfigured() ? 'Chưa đăng nhập' : 'Chưa cấu hình';
  host.innerHTML = `
    <div class="conn-line"><span class="dot ${museOk ? 'text-green' : 'text-amber'}"></span><strong>Muse</strong><span>${esc(museText)}</span></div>
    <div class="conn-line"><span class="dot ${threadsOk ? 'text-green' : 'text-faint'}"></span><strong>Threads</strong><span>${threadsOk ? 'Đã đăng nhập' : 'Chưa đăng nhập'}</span></div>
    <div class="conn-line"><span class="dot text-faint"></span><strong>Kho</strong><span>${state.library.length} file</span></div>
  `;
}

function renderGlobalBanner() {
  const host = document.getElementById('globalBanner');
  if (!host) return;
  const blocks = [];
  if (!isOnlineNow()) {
    blocks.push(`
      <div class="banner banner-offline">
        <div class="banner-icon" style="background:rgba(251,113,133,.12);color:var(--red)">!</div>
        <div class="grow"><strong>Mất kết nối mạng.</strong> Muse cần wifi để chạy. Tool sẽ không tự bịa kế hoạch hoặc dùng AI khác thay Muse.</div>
      </div>`);
  }
  if (state.planErrorCode || state.planErrors.length) {
    blocks.push(`
      <div class="banner banner-offline">
        <div class="banner-icon" style="background:rgba(251,113,133,.12);color:var(--red)">!</div>
        <div class="grow">
          <strong>Kế hoạch bị chặn.</strong> ${esc(state.planErrorMessage || 'JSON không hợp lệ.')}
          ${state.planErrors.length ? `<span> · ${state.planErrors.length} lỗi cần xem.</span>` : ''}
          <div class="small" style="margin-top:2px">Không tự sửa ID/nội dung · Không render.</div>
        </div>
        <div class="banner-actions">
          <button class="btn btn-sm" data-action="show-plan-errors">Xem chi tiết lỗi</button>
        </div>
      </div>`);
  }
  if (!isMuseUnlocked()) {
    const hints = [];
    if (!isMuseConfigured()) {
      hints.push('Bấm “Cấu hình Muse” để nhập URL trang Muse kèm tool và mở phiên đăng nhập.');
    } else if (!state.status.muse?.loginCheckConfigured) {
      hints.push('Đã có URL Muse nhưng chưa đo tín hiệu đăng nhập. Mở “Cấu hình Muse” → đăng nhập → “Đo phiên hiện tại”.');
    } else {
      hints.push('Đăng nhập trong khung Muse ở Bước 3, sau đó bấm “Kiểm tra đăng nhập”.');
    }
    blocks.push(`
      <div class="banner banner-gate">
        <div class="banner-icon">!</div>
        <div class="grow">
          <strong>Muse đang khóa.</strong> ${esc(gateMessage())}
          <div class="small text-muted" style="margin-top:3px">${hints.join(' ')}</div>
        </div>
        <div class="banner-actions">
          <button class="btn btn-sm btn-primary" data-action="config-muse">Cấu hình Muse</button>
          ${isMuseConfigured() ? '<button class="btn btn-sm" data-action="open-muse-login">Đăng nhập Muse</button>' : ''}
          <button class="btn btn-sm" data-action="go-step" data-step="3">Mở Bước 3</button>
        </div>
      </div>`);
  }
  host.innerHTML = blocks.join('');
}

function layoutMuse(layout) {
  return `<div class="muse-layout ${state.museExpanded ? 'is-expanded' : ''}" id="museLayout">${layout}</div>`;
}

function browserPanelHtml() {
  const muse = state.status.muse || {};
  let frame;
  if (!muse.configured) {
    frame = `
      <div class="browser-placeholder" id="museFrameHost">
        <div class="big-mark">MUSE</div>
        <h4>Chưa cấu hình Muse</h4>
        <p>
          Nhập URL trang Muse kèm theo tool để mở phiên đăng nhập ngay trong ứng dụng.
          Sau khi đăng nhập, bấm “Đo phiên hiện tại” để lưu đúng tín hiệu đăng nhập.
        </p>
        <div class="btn-row">
          <button class="btn btn-primary" data-action="config-muse">Cấu hình Muse</button>
          <button class="btn btn-ghost" data-action="reload-muse-config">Tải lại file cấu hình</button>
        </div>
        <p class="small text-faint">Không lưu mật khẩu. Không có fallback AI. Không có chế độ chạy không cần Muse.</p>
      </div>`;
  } else {
    frame = `<div id="museFrameHost" style="height:100%"></div>`;
  }
  return `
    <section class="panel browser-panel">
      <div class="browser-head">
        <div class="browser-title">
          <span class="dot ${isMuseUnlocked() ? 'text-green' : 'text-amber'}"></span>
          <strong>Trình duyệt Muse</strong>
          <span class="url">${esc(muse.url || 'chưa cấu hình')}</span>
        </div>
        <div class="browser-actions">
          <button class="btn btn-sm" data-action="config-muse">Cấu hình Muse</button>
          <button class="icon-btn" title="Tải lại khung Muse" data-action="reload-muse-page" ${muse.configured ? '' : 'disabled'}>↻</button>
          <button class="icon-btn" title="${state.museExpanded ? 'Thu nhỏ' : 'Mở rộng'} khung Muse" data-action="toggle-muse-expand">${state.museExpanded ? '⇱' : '⇲'}</button>
        </div>
      </div>
      <div class="browser-frame" id="museBrowserFrame">${frame}</div>
      <div class="browser-note">
        <span>Phiên Muse dùng cookie của Electron — không lưu mật khẩu trong code.</span>
        <span class="dot ${isMuseUnlocked() ? 'text-green' : 'text-amber'}"></span>
      </div>
    </section>`;
}

function gateCardHtml() {
  const muse = state.status.muse || {};
  if (isMuseUnlocked()) {
    return `
      <div class="gate-card gate-ok">
        <div class="gate-top">
          <div class="gate-mark">✓</div>
          <div class="grow">
            <h3>${esc(muse.name || 'Muse')} đã đăng nhập</h3>
            <p class="gate-message">Đã xác thực phiên đăng nhập bằng cấu hình tại ${esc(muse.configFile || 'muse_rule.json')}.</p>
            <div class="gate-sub">Xác thực lúc: ${esc(fmtDateTime(muse.verifiedAt))}${muse.ruleAttached ? ' · Rule Muse đã gắn.' : ' · Rule Muse chưa gắn (slot để trống).'}</div>
          </div>
        </div>
        <div class="gate-actions">
          <button class="btn btn-sm" data-action="verify-muse">Kiểm tra lại đăng nhập</button>
          <button class="btn btn-sm btn-ghost" data-action="focus-muse">Mở khung Muse</button>
        </div>
      </div>`;
  }
  let hint = 'Đăng nhập trong khung Muse bên trái, sau đó bấm “Kiểm tra đăng nhập”.';
  if (!muse.configured) hint = 'Chưa cấu hình Muse. Bấm “Cấu hình Muse” để nhập URL và mở phiên đăng nhập.';
  else if (!muse.loginCheckConfigured) hint = 'Đã có URL Muse nhưng chưa đo tín hiệu đăng nhập. Mở “Cấu hình Muse” → đăng nhập → “Đo phiên hiện tại”.';
  return `
    <div class="gate-card">
      <div class="gate-top">
        <div class="gate-mark">!</div>
        <div class="grow">
          <h3>Muse đang khóa</h3>
          <p class="gate-message">${esc(gateMessage())}</p>
          <div class="gate-sub">${esc(hint)}</div>
        </div>
      </div>
      <div class="gate-actions">
        <button class="btn btn-sm btn-primary" data-action="config-muse">Cấu hình Muse</button>
        <button class="btn btn-sm" data-action="open-muse-login" ${muse.configured ? '' : 'disabled'}>Mở cửa sổ đăng nhập Muse</button>
        <button class="btn btn-sm" data-action="focus-muse" ${muse.configured ? '' : 'disabled'}>Mở khung Muse</button>
        <button class="btn btn-sm" data-action="verify-muse" ${muse.configured && muse.loginCheckConfigured ? '' : 'disabled'}>Kiểm tra đăng nhập</button>
        <button class="btn btn-sm btn-ghost" data-action="reload-muse-config">Tải lại cấu hình</button>
      </div>
    </div>`;
}

function settingsCardHtml() {
  const settings = state.workspace?.settings || {};
  const backgrounds = libraryOf('background');
  const voice = settings.voice || '';
  return `
    <section class="panel panel-soft">
      <div class="panel-head">
        <div><h3>Thiết lập video</h3><div class="sub">Người dùng chọn; không phải nội dung do frontend tự quyết.</div></div>
      </div>
      <div class="panel-body">
        <div class="settings-grid">
          <div class="field span-2">
            <label for="settingsVoice">Giọng đọc</label>
            <input class="input" id="settingsVoice" list="voiceSuggestions" placeholder="Ví dụ: Giọng nữ kể chuyện (ấm, chậm)" value="${esc(voice)}" />
            <datalist id="voiceSuggestions">${VOICE_SUGGESTIONS.map((v) => `<option value="${esc(v)}"></option>`).join('')}</datalist>
            <span class="hint">Chuỗi cài đặt giọng; renderer/TTS cuối sẽ dùng giá trị này.</span>
          </div>
          <div class="field span-2">
            <label for="settingsBackground">Video nền gameplay</label>
            <select class="select" id="settingsBackground">
              <option value="">— Chọn video nền —</option>
              ${backgrounds
                .map(
                  (item) =>
                    `<option value="${esc(item.id)}" ${settings.background_video_id === item.id ? 'selected' : ''}>${esc(item.name)} · ${esc(fmtDuration(item.duration, item.mediaType))}</option>`,
                )
                .join('')}
            </select>
            <span class="hint">ID: ${esc(settings.background_video_id || 'chưa chọn')} · lấy từ kho, không đổi tên ID.</span>
          </div>
          <div class="field span-2">
            <label for="settingsWatermark">Watermark kênh</label>
            <input class="input" id="settingsWatermark" placeholder="@kenhcuaban" value="${esc(settings.watermark || '')}" />
          </div>
          <div class="field span-2">
            <label for="settingsDuration">Thời lượng đích</label>
            <div class="range-row">
              <input type="range" id="settingsDuration" min="60" max="90" step="1" value="${Number(settings.target_duration) || 60}" />
              <span class="range-value" id="settingsDurationValue">${Number(settings.target_duration) || 60}s</span>
            </div>
            <span class="hint">Theo chuẩn 60–90 giây. Đổi cài đặt sẽ yêu cầu duyệt lại kế hoạch.</span>
          </div>
        </div>
        <div class="btn-row" style="margin-top:12px">
          <button class="btn btn-sm btn-primary" data-action="save-settings" ${state.busy.settings ? 'disabled' : ''}>
            ${state.busy.settings ? '<span class="spinner spin"></span> Đang lưu...' : 'Lưu thiết lập video'}
          </button>
        </div>
      </div>
    </section>`;
}

function inputPanelHtml() {
  const counts = planInputCounts();
  const json = state.planInput ? JSON.stringify(state.planInput, null, 2) : '';
  return `
    <section class="panel panel-soft" id="inputPanel">
      <div class="panel-head">
        <div><h3>Input gửi Muse</h3><div class="sub">JSON tự tạo từ bài + bình luận đã chọn + kho file + thiết lập.</div></div>
        <span class="badge ${inputReady() ? 'badge-green' : 'badge-amber'}">${inputReady() ? 'SẴN SÀNG' : 'CHƯA SẴN SÀNG'}</span>
      </div>
      <div class="panel-body section-stack">
        ${buildInputWarnings()}
        <div class="plan-summary">
          <span>Bình luận <strong>${counts.comments}</strong></span>
          <span>Meme <strong>${counts.memes}</strong></span>
          <span>Nhạc <strong>${counts.music}</strong></span>
          <span>SFX <strong>${counts.sfx}</strong></span>
          <span>Nền <strong>${counts.backgrounds}</strong></span>
        </div>
        ${
          json
            ? `<div class="code-block">
                <div class="code-toolbar">
                  <span>muse_input.json</span>
                  <div class="btn-row">
                    <button class="btn btn-sm btn-ghost" data-action="copy-input" ${inputReady() ? '' : 'disabled'}>Sao chép</button>
                    <button class="btn btn-sm btn-ghost" data-action="download-input" ${inputReady() ? '' : 'disabled'}>Tải JSON</button>
                  </div>
                </div>
                <pre id="museInputJson">${esc(json)}</pre>
              </div>`
            : `<div class="empty" style="padding:18px"><span>Chưa tạo được input. Hoàn tất bài, bình luận và kho file trước.</span></div>`
        }
        <div class="contract-note">
          Hợp đồng: <code>post · comments[{comment_id, author, time, text, likes}] · library[{meme_id…} / {music_id…} / {sfx_id…}] · settings{voice, background_video_id, watermark, target_duration}</code>.
          Frontend chỉ truyền ID; không tự quyết nội dung.
        </div>
      </div>
    </section>`;
}

function museActionsHtml() {
  const unlocked = isMuseUnlocked();
  const online = isOnlineNow();
  const bridgeReady = isMuseBridgeReady();
  const ready = inputReady();
  const gate = gateMessage();
  const disabledBase = !unlocked || !online || !ready;
  return `
    <section class="panel panel-soft" id="museActions">
      <div class="panel-head">
        <div><h3>Gọi Muse</h3><div class="sub">Mọi nội dung phải đi qua Muse hoặc do bạn sửa tay.</div></div>
        <span class="badge ${unlocked ? 'badge-green' : 'badge-amber'}">${unlocked ? 'MUSE SẴN SÀNG' : 'ĐANG KHÓA'}</span>
      </div>
      <div class="panel-body section-stack">
        <div class="muse-actions">
          <button class="btn btn-primary" data-action="bridge-send" data-muse-action="bridge" data-muse-autoready="${bridgeReady ? '1' : '0'}" ${disabledBase || !bridgeReady || state.busy.bridge ? 'disabled' : ''} title="${esc(gate)}">
            ${state.busy.bridge ? '<span class="spinner spin"></span> Đang chờ Muse...' : 'Gửi input & nhận kế hoạch từ Muse'}
          </button>
          <div class="gate-hint">
            ${
              bridgeReady
                ? 'Bridge tự động dùng selector trong muse_rule.json. Không tự tạo kết quả nếu Muse không trả JSON.'
                : 'Bridge tự động chưa cấu hình (input_selector / send_selector / response_selector). Hãy copy JSON sang Muse và dán kết quả bên dưới.'
            }
          </div>
        </div>
        <div class="hr"></div>
        <div class="manual-box">
          <div class="mini-head">
            <h4>Dán kết quả Muse</h4>
            <span class="hint">JSON output phải đúng hợp đồng</span>
          </div>
          <textarea class="textarea" id="museManualResponse" data-muse-manual placeholder='Dán JSON Muse trả về: {"title": "...", "segments": [...] ...}' ${unlocked ? '' : 'disabled'}>${esc(state.manualResponse || '')}</textarea>
          <div class="btn-row">
            <button class="btn btn-sm" data-action="import-muse" data-muse-action="import" ${disabledBase || state.busy.import ? 'disabled' : ''} title="${esc(gate)}">
              ${state.busy.import ? '<span class="spinner spin"></span> Đang kiểm tra...' : 'Kiểm tra & nạp kế hoạch'}
            </button>
            ${!unlocked ? `<span class="gate-hint">${esc(gate)}</span>` : ''}
            ${unlocked && !online ? '<span class="gate-hint">Mất mạng — không gọi Muse.</span>' : ''}
            ${unlocked && !ready ? '<span class="gate-hint">Input chưa sẵn sàng.</span>' : ''}
          </div>
        </div>
        <div class="sample-test">
          <div class="sample-head">
            <div>
              <h4>Test luồng khi chưa gắn rule Muse</h4>
              <p>Chỉ dùng plan mẫu để test 4 module. Đây không phải kết quả Muse và không được tính là nội dung thật.</p>
            </div>
            <span class="badge badge-amber">TEST</span>
          </div>
          <div class="btn-row">
            <button class="btn btn-sm" data-action="import-sample" ${ready && state.status.muse?.samplePlanEnabled !== false && !state.busy.sample ? '' : 'disabled'}>Nạp plan mẫu hợp lệ</button>
            <button class="btn btn-sm btn-danger" data-action="import-invalid-sample" ${ready && state.status.muse?.samplePlanEnabled !== false && !state.busy.sample ? '' : 'disabled'}>Nạp plan lỗi (test validation)</button>
          </div>
        </div>
        <div class="contract-note">
          Không fallback AI · Không tự sửa JSON · Không render nếu validate sai. Rule Muse là slot <code>config/muse_rule.json</code>.
        </div>
      </div>
    </section>`;
}

function planEditorHtml() {
  if (!state.plan) {
    return `
      <section class="panel panel-soft">
        <div class="panel-head"><div><h3>Kế hoạch video</h3><div class="sub">Chưa có kế hoạch. Gửi Muse hoặc nạp plan mẫu để test.</div></div></div>
        <div class="panel-body">
          <div class="empty" style="padding:22px">
            <div class="empty-mark">JSON</div>
            <strong>Chưa nạp kế hoạch</strong>
            <p>Muse phải trả JSON đúng hợp đồng. Frontend sẽ validate ID kho và text nguyên văn trước khi cho bạn xem/sửa.</p>
          </div>
        </div>
      </section>`;
  }
  const comments = commentMap();
  const memes = libraryOf('meme');
  const music = libraryOf('music');
  const sfx = libraryOf('sfx');
  const meta = state.workspace?.plan_meta || state.planMeta || {};
  const approved = hasEffectiveApproval();
  const source = meta.source || 'unknown';
  const plan = state.plan;
  const hashtagsValue = Array.isArray(plan.hashtags) ? plan.hashtags.join(', ') : '';
  return `
    <section class="panel" id="planEditor">
      <div class="panel-head">
        <div>
          <div class="plan-editor-head">
            <h3>Kế hoạch video</h3>
            <div class="plan-badges">
              ${planSourceBadge(source)}
              ${approved ? '<span class="badge badge-green">ĐÃ DUYỆT</span>' : '<span class="badge badge-amber">CHƯA DUYỆT</span>'}
            </div>
          </div>
          <div class="sub">Sửa tiêu đề, thứ tự, meme, nhạc, SFX. Text bình luận khóa nguyên văn.</div>
        </div>
      </div>
      <div class="panel-body plan-editor">
        ${planErrorsBlock()}
        ${state.workspace?.plan_stale ? `<div class="stale-strip">Input đã thay đổi (${esc(state.workspace.stale_reason || 'cài đặt/bình luận')}). Cần duyệt lại trước khi render.</div>` : ''}
        <div class="${planStateTone()}" id="planStateLine">${esc(planStateText())}</div>
        <div class="field">
          <label for="planTitle">Tiêu đề hook</label>
          <input class="input plan-title-input" id="planTitle" data-plan-field="title" value="${esc(plan.title)}" />
        </div>
        <div class="plan-meta-grid">
          <div class="field">
            <label for="planMusic">Nhạc nền</label>
            <select class="select" id="planMusic" data-plan-field="music_id">
              ${music
                .map(
                  (item) =>
                    `<option value="${esc(item.id)}" ${plan.music_id === item.id ? 'selected' : ''}>${esc(item.name)} · ${esc(item.tags.join(', ') || 'không tag')}</option>`,
                )
                .join('')}
              ${!music.some((item) => item.id === plan.music_id) ? `<option value="${esc(plan.music_id)}" selected>ID lạ: ${esc(plan.music_id)}</option>` : ''}
            </select>
          </div>
          <div class="field">
            <label>Nguồn kế hoạch</label>
            <div class="input" style="display:flex;align-items:center;gap:8px;height:36px">${planSourceBadge(source)} <span class="small text-faint">${esc(fmtDateTime(meta.imported_at))}</span></div>
          </div>
        </div>
        <div class="segment-list">
          ${plan.segments
            .map((segment, index) => {
              const comment = comments.get(segment.comment_id) || {};
              return `
                <div class="segment-card">
                  <div class="segment-top">
                    <div style="display:flex;gap:7px;align-items:center;min-width:0">
                      <span class="segment-index">${String(index + 1).padStart(2, '0')}</span>
                      <span class="segment-author">@${esc(comment.author || 'không rõ')} · ${esc(fmtTime(comment.time))} · ${esc(fmtLikes(comment.likes))} lượt thích</span>
                    </div>
                    <div class="segment-actions">
                      <button class="icon-btn" data-action="plan-move-up" data-index="${index}" title="Đưa lên" ${index === 0 ? 'disabled' : ''}>↑</button>
                      <button class="icon-btn" data-action="plan-move-down" data-index="${index}" title="Đưa xuống" ${index === plan.segments.length - 1 ? 'disabled' : ''}>↓</button>
                    </div>
                  </div>
                  <div class="segment-text">${esc(segment.text)}</div>
                  <div class="segment-controls">
                    <div class="field">
                      <label>Meme</label>
                      <select class="select" data-segment-field="meme_id" data-segment-index="${index}">
                        ${memes
                          .map(
                            (item) =>
                              `<option value="${esc(item.id)}" ${segment.meme_id === item.id ? 'selected' : ''}>${esc(item.name)} · ${esc(fmtDuration(item.duration, item.mediaType))}</option>`,
                          )
                          .join('')}
                        ${!memes.some((item) => item.id === segment.meme_id) ? `<option value="${esc(segment.meme_id)}" selected>ID lạ: ${esc(segment.meme_id)}</option>` : ''}
                      </select>
                    </div>
                    <div class="field">
                      <label>Giây meme</label>
                      <input class="input" type="number" min="0.5" max="10" step="0.1" data-segment-field="meme_duration" data-segment-index="${index}" value="${esc(segment.meme_duration)}" />
                    </div>
                    <div class="field">
                      <label>SFX</label>
                      <select class="select" data-segment-field="sfx_id" data-segment-index="${index}">
                        ${sfx
                          .map(
                            (item) =>
                              `<option value="${esc(item.id)}" ${segment.sfx_id === item.id ? 'selected' : ''}>${esc(item.name)}</option>`,
                          )
                          .join('')}
                        ${!sfx.some((item) => item.id === segment.sfx_id) ? `<option value="${esc(segment.sfx_id)}" selected>ID lạ: ${esc(segment.sfx_id)}</option>` : ''}
                      </select>
                    </div>
                  </div>
                </div>`;
            })
            .join('')}
        </div>
        <div class="field">
          <label for="planCaption">Caption</label>
          <textarea class="textarea" id="planCaption" data-plan-field="caption">${esc(plan.caption || '')}</textarea>
        </div>
        <div class="field">
          <label for="planHashtags">Hashtags</label>
          <input class="input" id="planHashtags" data-plan-field="hashtags" value="${esc(hashtagsValue)}" placeholder="#3amdiary, #chomeo" />
          <span class="hint">Cách nhau bằng dấu phẩy hoặc khoảng trắng.</span>
        </div>
        <div class="plan-summary">
          <span>Segments <strong>${plan.segments.length}</strong></span>
          <span>Meme gắn <strong>${plan.segments.filter((segment) => segment.meme_id).length}</strong></span>
          <span>SFX gắn <strong>${plan.segments.filter((segment) => segment.sfx_id).length}</strong></span>
          <span>Thời lượng đích <strong>${Number(state.workspace?.settings?.target_duration) || 60}s</strong></span>
        </div>
        <div class="plan-actions">
          <div class="btn-row">
            <button class="btn btn-primary" data-action="approve-plan" ${state.busy.approving ? 'disabled' : ''}>
              ${state.busy.approving ? '<span class="spinner spin"></span> Đang kiểm tra...' : 'Duyệt & lưu kế hoạch'}
            </button>
            <button class="btn btn-sm btn-ghost" data-action="download-plan">Tải plan JSON</button>
          </div>
          <div class="right">
            <button class="btn btn-sm" id="planQueueButton" data-action="go-step" data-step="4" ${approved ? '' : 'disabled'}>Sang hàng đợi</button>
          </div>
        </div>
        <div class="contract-note">
          Khi bấm duyệt, server kiểm tra lại: mọi meme/music/sfx ID phải có trong kho; text phải khớp nguyên văn input; không có ID lạ. Sai thì dừng.
        </div>
      </div>
    </section>`;
}

function workflowHtml() {
  const hasPost = Boolean(currentPost());
  const stats = libraryStatsFromItems();
  const readyBits = [];
  if (!hasPost) readyBits.push('bài Threads');
  if (!selectedIds().length) readyBits.push('bình luận đã chọn');
  if (!stats.meme) readyBits.push('meme');
  if (!stats.music) readyBits.push('nhạc');
  if (!stats.sfx) readyBits.push('SFX');
  if (!stats.background) readyBits.push('video nền');
  return `
    <div class="workflow-col">
      <div id="museGateWrap">${gateCardHtml()}</div>
      ${
        state.step3Error
          ? `<div class="alert alert-error"><span class="alert-icon">!</span><div class="grow">${esc(state.step3Error)}</div></div>`
          : ''
      }
      ${
        readyBits.length
          ? `<div class="alert alert-warn"><span class="alert-icon">!</span><div class="grow"><strong>Chưa đủ dữ liệu:</strong> ${esc(readyBits.join(', '))}. <div class="btn-row" style="margin-top:6px"><button class="btn btn-sm" data-action="go-step" data-step="1">Về Bước 1</button><button class="btn btn-sm" data-action="go-step" data-step="2">Về kho file</button><button class="btn btn-sm btn-ghost" data-action="demo-load">Nạp demo</button></div></div></div>`
          : ''
      }
      ${settingsCardHtml()}
      ${inputPanelHtml()}
      ${museActionsHtml()}
      ${!state.plan ? `<div id="planImportErrors">${planErrorsBlock()}</div>` : ''}
      ${planEditorHtml()}
    </div>`;
}

function discoveryModeNoteHtml() {
  const needLogin = state.threadsMode === 'account' && !threadsLoggedIn();
  return `
    <span class="dot ${threadsLoggedIn() ? 'text-green' : 'text-amber'}"></span>
    <span>${esc(discoveryModeNote())}</span>
    ${needLogin ? '<button class="btn btn-sm" data-action="open-threads-login">Đăng nhập Threads</button>' : ''}
  `;
}

function candidateCardHtml(candidate, index) {
  const selected = state.discovery.selectedCode === candidate.code;
  const commentBadge = candidate.has_comments
    ? `<span class="badge badge-cyan">${esc(fmtLikes(candidate.comments_count))} bình luận</span>`
    : '<span class="badge">0 bình luận</span>';
  return `
    <article class="candidate-card ${selected ? 'is-selected' : ''}" data-candidate-id="${esc(candidate.code)}">
      <div class="candidate-top">
        <span class="candidate-rank">${String(index + 1).padStart(2, '0')}</span>
        <div class="candidate-author">
          <strong>@${esc(candidate.author)}</strong>
          <span>${esc(fmtTime(candidate.time))} · ${esc(ageLabel(candidate.age_hours))} trước</span>
        </div>
        <span class="badge badge-violet">Xu hướng ${esc(String(candidate.trend_score).replace('.', ','))}</span>
      </div>
      <div class="candidate-text">${esc(candidate.text)}</div>
      <div class="candidate-meta">
        <span>${esc(fmtLikes(candidate.likes))} lượt thích</span>
        ${commentBadge}
        <span>${esc(fmtLikes(candidate.shares_count))} chia sẻ</span>
        <span class="candidate-match">Khớp: ${esc((candidate.matched_terms || []).join(', ') || '—')}</span>
      </div>
      <div class="candidate-actions">
        <a class="btn btn-sm btn-ghost" href="${esc(candidate.url)}" target="_blank" rel="noreferrer">Mở Threads ↗</a>
        <button class="btn btn-sm ${selected ? 'btn-success' : 'btn-primary'}" data-action="use-candidate" data-code="${esc(candidate.code)}" data-url="${esc(candidate.url)}" ${state.discovery.loading || state.scraping ? 'disabled' : ''}>
          ${selected ? 'Đã chọn bài này' : 'Dùng bài này & tải bình luận'}
        </button>
      </div>
    </article>`;
}

function discoveryPanelHtml() {
  const d = state.discovery;
  const searchMeta = d.meta;
  const warnings = [
    ...(d.warnings || []),
  ];
  const mode = d.meta?.mode || resolvedThreadsMode();
  const resultHead = searchMeta
    ? `<div class="discovery-result-head">
         <div>
           <h4>Ứng viên từ Threads</h4>
           <span class="small text-faint">Tìm "${esc(searchMeta.topic)}" · ${esc(searchMeta.mode === 'guest' ? 'ẩn danh' : 'tài khoản')} · trong ${esc(String(searchMeta.maxAgeHours))} giờ · ${esc(searchMeta.sort === 'recent' ? 'mới nhất' : 'xu hướng')}</span>
         </div>
         <span class="badge ${d.candidates.length ? 'badge-green' : 'badge-amber'}">${d.candidates.length}/${esc(String(searchMeta.limit))} bài</span>
       </div>`
    : '';
  const modeNote = mode === 'guest'
    ? 'Bạn đang xem bài public không đăng nhập. Bình luận của bài được chọn có thể thiếu; đăng nhập Threads để lấy thêm.'
    : 'Bài ứng viên chỉ là danh sách để bạn chọn. Tool chỉ tải bình luận của đúng bài bạn bấm chọn.';
  return `
    <section class="panel discovery-panel" id="discoveryPanel">
      <div class="panel-head">
        <div>
          <h3>Tìm bài mới theo chủ đề</h3>
          <div class="sub">Nhập chủ đề, số bài và khoảng thời gian. Tool lọc bài cũ, xếp theo độ mới + tương tác; không tự bịa bài.</div>
        </div>
        <span class="badge badge-cyan">DISCOVERY</span>
      </div>
      <div class="panel-body">
        <div class="discover-grid">
          <div class="field discover-topic">
            <label for="discoverTopic">Chủ đề muốn cào</label>
            <input class="input" id="discoverTopic" list="discoverTopicSuggestions" placeholder="Ví dụ: chó mèo, 3 giờ sáng, công sở, học đường..." value="${esc(d.topic)}" autocomplete="off" ${d.loading ? 'disabled' : ''} />
            <datalist id="discoverTopicSuggestions">
              <option value="chó mèo"></option>
              <option value="mèo"></option>
              <option value="3 giờ sáng"></option>
              <option value="công sở"></option>
              <option value="học đường"></option>
              <option value="tình yêu"></option>
            </datalist>
          </div>
          <div class="field">
            <label for="discoverLimit">Số bài</label>
            <input class="input" id="discoverLimit" type="number" min="1" max="20" step="1" value="${esc(String(d.limit))}" ${d.loading ? 'disabled' : ''} />
          </div>
          <div class="field">
            <label for="discoverAge">Bài mới trong</label>
            <select class="select" id="discoverAge" ${d.loading ? 'disabled' : ''}>
              <option value="24" ${d.maxAgeHours === 24 ? 'selected' : ''}>24 giờ</option>
              <option value="48" ${d.maxAgeHours === 48 ? 'selected' : ''}>48 giờ</option>
              <option value="72" ${d.maxAgeHours === 72 ? 'selected' : ''}>3 ngày</option>
              <option value="168" ${d.maxAgeHours === 168 ? 'selected' : ''}>7 ngày</option>
            </select>
          </div>
          <div class="field">
            <label for="discoverSort">Ưu tiên</label>
            <select class="select" id="discoverSort" ${d.loading ? 'disabled' : ''}>
              <option value="trend" ${d.sort === 'trend' ? 'selected' : ''}>Xu hướng</option>
              <option value="recent" ${d.sort === 'recent' ? 'selected' : ''}>Mới nhất</option>
            </select>
          </div>
          <div class="field">
            <label for="threadsMode">Phiên Threads</label>
            <select class="select" id="threadsMode" ${d.loading ? 'disabled' : ''}>
              <option value="auto" ${state.threadsMode === 'auto' ? 'selected' : ''}>Tự động</option>
              <option value="guest" ${state.threadsMode === 'guest' ? 'selected' : ''}>Ẩn danh (không login)</option>
              <option value="account" ${state.threadsMode === 'account' ? 'selected' : ''}>Tài khoản Threads</option>
            </select>
          </div>
          <div class="field discover-submit">
            <label>&nbsp;</label>
            <button class="btn btn-primary" data-action="discover-threads" ${d.loading ? 'disabled' : ''}>
              ${d.loading ? '<span class="spinner spin"></span> Đang tìm...' : 'Tìm bài phù hợp'}
            </button>
          </div>
        </div>
        <div class="discover-suggest">
          <span class="small text-faint">Gợi ý:</span>
          ${['chó mèo', 'mèo', '3 giờ sáng', 'công sở', 'học đường'].map((topic) => `<button class="tag-chip" data-action="suggest-topic" data-topic="${esc(topic)}">${esc(topic)}</button>`).join('')}
          <span class="small text-faint">Bình luận chỉ tải khi bạn chọn 1 bài.</span>
        </div>
        <div class="discover-mode" id="discoverModeNote">${discoveryModeNoteHtml()}</div>
        <div class="discover-note">
          <span id="discoverModeLine">Chế độ ${esc(threadsModeLabel())}.</span> Chỉ giữ bài trong khoảng thời gian đã chọn; bài không rõ ngày bị loại. Điểm xu hướng = tương tác + độ mới + độ khớp từ khóa.
        </div>
        ${
          d.loading
            ? `<div class="progress-line"><div class="progress-label"><span>Đang mở Threads search, cuộn và lọc bài...</span><span>Có thể 10–40 giây</span></div><div class="progress-track"><div class="progress-fill" style="width:62%;animation:pulse 1.4s ease-in-out infinite"></div></div></div>`
            : ''
        }
        ${
          d.error
            ? `<div class="alert alert-error">
                 <span class="alert-icon">!</span>
                 <div class="grow">
                   <strong>Không tìm được danh sách bài.</strong>
                   <div>${esc(d.error.message || '')}</div>
                   <div class="btn-row" style="margin-top:7px">
                     ${d.error.code === 'THREADS_LOGIN_REQUIRED' ? '<button class="btn btn-sm" data-action="open-threads-login">Đăng nhập Threads</button>' : ''}
                     <button class="btn btn-sm" data-action="discover-threads">Thử lại</button>
                   </div>
                 </div>
               </div>`
            : ''
        }
        ${
          warnings.length
            ? `<div class="alert alert-warn"><span class="alert-icon">!</span><div class="grow">${warnings.map((warning) => `<div>${esc(warning)}</div>`).join('')}</div></div>`
            : ''
        }
        ${
          searchMeta
            ? `<div class="discovery-results">
                 ${resultHead}
                 <div class="discover-result-note">${esc(modeNote)}</div>
                 ${
                   d.candidates.length
                     ? `<div class="candidate-list">${d.candidates.map((candidate, index) => candidateCardHtml(candidate, index)).join('')}</div>`
                     : `<div class="empty" style="padding:22px"><div class="empty-mark">0</div><strong>Không có bài mới phù hợp</strong><p>Thử từ khóa rộng hơn, tăng khoảng thời gian, hoặc đăng nhập Threads. Tool không tự tạo bài để lấp chỗ trống.</p><div class="btn-row"><button class="btn btn-sm" data-action="discover-threads">Tìm lại</button><button class="btn btn-sm btn-ghost" data-action="open-threads-login">Đăng nhập Threads</button></div></div>`
                 }
               </div>`
            : `<div class="discover-empty-hint">Nhập chủ đề và bấm “Tìm bài phù hợp”. Kết quả là bài public mới; chưa tải bình luận cho đến khi bạn chọn.</div>`
        }
      </div>
    </section>`;
}

function step1Html() {
  const post = currentPost();
  const comments = orderedComments();
  const selected = selectedIds();
  const selectedSet = new Set(selected);
  const stats = libraryStatsFromItems();
  return `
    <div class="page">
      <div class="page-head">
        <div>
          <h2>Cào hoặc nhập bài Threads</h2>
          <p>Tìm bài mới theo chủ đề hoặc dán link Threads. Nội dung bình luận được giữ nguyên văn; bạn chỉ chọn/bỏ và sắp xếp thứ tự.</p>
        </div>
        <div class="btn-row">
          <button class="btn btn-sm" data-action="demo-load">Nạp dữ liệu demo chó/mèo</button>
        </div>
      </div>

      ${discoveryPanelHtml()}

      <section class="panel">
        <div class="panel-body source-card">
          <form data-form="scrape" id="scrapeForm">
            <div class="field">
              <label for="threadsUrl">Link bài Threads</label>
              <div class="source-row">
                <input class="input input-mono" id="threadsUrl" name="url" placeholder="https://www.threads.com/@tai_khoan/post/..." value="${esc(state.scrapeUrl || post?.url || '')}" ${state.scraping ? 'disabled' : ''} autocomplete="off" />
                <button class="btn btn-primary" type="submit" ${state.scraping ? 'disabled' : ''}>
                  ${state.scraping ? '<span class="spinner spin"></span> Đang cào...' : 'Cào bài Threads'}
                </button>
                <button class="btn" type="button" data-action="open-threads-login">Đăng nhập Threads</button>
              </div>
            </div>
          </form>

          ${
            state.scraping
              ? `<div class="progress-line" id="scrapeProgress">
                  <div class="progress-label"><span>Đang mở Threads, đợi dữ liệu và mở rộng bình luận...</span><span>Có thể 20–60 giây</span></div>
                  <div class="progress-track"><div class="progress-fill" style="width:62%;animation:pulse 1.4s ease-in-out infinite"></div></div>
                </div>`
              : ''
          }
          ${scrapeErrorHtml()}
          ${state.scrapeWarnings.length
            ? `<div class="alert alert-warn"><span class="alert-icon">!</span><div class="grow">${state.scrapeWarnings.map((warning) => `<div>${esc(warning)}</div>`).join('')}</div></div>`
            : ''}
          <div class="source-meta">
            <div id="threadsSessionBox">${threadsSessionHtml()}</div>
            <div class="inline-actions">
              <button class="btn btn-sm btn-ghost" data-action="refresh-threads">Kiểm tra lại Threads</button>
              <button class="btn btn-sm btn-ghost" data-action="refresh-status">Làm mới trạng thái</button>
            </div>
          </div>
          <div class="steps-hint">
            <div class="hint-card"><strong>Threads cần đăng nhập riêng</strong><span>Bài công khai có thể vẫn yêu cầu đăng nhập để xem đủ bình luận. Đây là phiên Threads, tách khỏi Muse.</span></div>
            <div class="hint-card"><strong>Không viết lại nội dung</strong><span>Tool giữ nguyên text bình luận, tên tài khoản, thời gian, like/comment/share. Bạn chỉ chọn &amp; sắp xếp.</span></div>
            <div class="hint-card"><strong>Không tự bịa dữ liệu</strong><span>Nếu bị chặn hoặc mất mạng, tool báo lỗi và dừng; không tạo bài/bình luận giả.</span></div>
          </div>
        </div>
      </section>

      ${
        post
          ? `${postCardHtml(post)}
             ${
               comments.length
                 ? `<section class="panel comments-panel">
                     <div class="comments-toolbar">
                       <div class="selected-count">Đã chọn <strong>${selected.length}</strong> / ${comments.length} bình luận</div>
                       <div class="btn-row">
                         <button class="btn btn-sm btn-ghost" data-action="select-all-comments">Chọn tất cả</button>
                         <button class="btn btn-sm btn-ghost" data-action="clear-comments">Bỏ chọn tất cả</button>
                       </div>
                     </div>
                     <div class="comments-list">
                       ${comments
                         .map((comment) => {
                           const order = selected.indexOf(comment.comment_id);
                           const first = order === 0;
                           const last = order === selected.length - 1;
                           const isSelected = order >= 0;
                           return `
                             <div class="comment-row ${isSelected ? 'is-selected' : ''}" data-comment-row="${esc(comment.comment_id)}">
                               <div class="comment-order">${isSelected ? String(order + 1).padStart(2, '0') : '—'}</div>
                               <div class="checkbox-wrap">
                                 <input class="checkbox" type="checkbox" data-select-comment="${esc(comment.comment_id)}" ${isSelected ? 'checked' : ''} aria-label="Chọn bình luận của ${esc(comment.author)}" />
                               </div>
                               <div class="comment-main">
                                 <div class="comment-head">
                                   <strong>@${esc(comment.author || 'không rõ')}</strong>
                                   <span class="sep">·</span>
                                   <span>${esc(fmtTime(comment.time))}</span>
                                   <span class="readonly-note">nguyên văn</span>
                                 </div>
                                 <div class="comment-text">${esc(comment.text)}</div>
                                 <div class="comment-metrics">
                                   <span>${esc(fmtLikes(comment.likes))} lượt thích</span>
                                   <span>${esc(fmtLikes(comment.comments_count))} phản hồi</span>
                                   <span>${esc(fmtLikes(comment.shares_count))} chia sẻ</span>
                                 </div>
                               </div>
                               <div class="comment-actions">
                                 <button class="icon-btn" title="Đưa lên" data-action="move-comment-up" data-id="${esc(comment.comment_id)}" ${!isSelected || first ? 'disabled' : ''}>↑</button>
                                 <button class="icon-btn" title="Đưa xuống" data-action="move-comment-down" data-id="${esc(comment.comment_id)}" ${!isSelected || last ? 'disabled' : ''}>↓</button>
                               </div>
                             </div>`;
                         })
                         .join('')}
                     </div>
                   </section>`
                 : `<section class="panel panel-soft"><div class="empty"><div class="empty-mark">!</div><strong>Chưa có bình luận nào được đọc</strong><p>Có thể Threads chưa tải đủ, bài bị hạn chế, hoặc cần đăng nhập Threads. Hãy thử lại, hoặc nạp dữ liệu demo để test luồng.</p><div class="btn-row"><button class="btn" data-action="retry-scrape">Thử lại</button><button class="btn btn-ghost" data-action="demo-load">Nạp demo</button></div></div></section>`
             }`
          : `<section class="panel panel-soft">
              <div class="empty">
                <div class="empty-mark">URL</div>
                <strong>Chưa có bài Threads</strong>
                <p>Dán link bài Threads để bắt đầu, hoặc nạp dữ liệu mẫu chó/mèo. Dữ liệu demo được ghi rõ là demo, không giả làm Threads thật.</p>
                <div class="btn-row"><button class="btn btn-primary" data-action="demo-load">Nạp dữ liệu demo</button></div>
              </div>
            </section>`
      }

      <div class="action-bar">
        <div class="note">Bước 2 dùng kho file local. Meme/nhạc/SFX/nền phải có ID cố định trước khi gửi Muse.</div>
        <div class="btn-row">
          <button class="btn" data-action="go-step" data-step="2" ${!post || selected.length === 0 ? 'disabled' : ''}>Tiếp tục: Chọn kho file</button>
        </div>
      </div>
      ${stats.meme + stats.music + stats.sfx + stats.background === 0 ? `<div class="contract-note">Kho file đang trống — bạn có thể nạp demo hoặc thêm file ở Bước 2.</div>` : ''}
    </div>`;
}

function threadsSessionHtml() {
  const threads = state.threadsSession || {};
  const loggedIn = Boolean(threads.loggedIn);
  return `
    <span class="chip ${loggedIn ? 'is-logged-in' : ''}" style="height:24px">
      <span class="dot"></span>
      Threads: ${loggedIn ? 'đã đăng nhập' : 'chưa đăng nhập'}
    </span>
    <span class="small text-faint" style="margin-left:8px">${loggedIn ? 'Tài khoản sẵn sàng; bình luận thường đầy đủ hơn.' : 'Ẩn danh không cần login; đăng nhập để lấy thêm bình luận.'}</span>`;
}

function scrapeErrorHtml() {
  if (!state.scrapeError) return '';
  const error = state.scrapeError;
  const login = error.code === 'LOGIN_REQUIRED' || error.code === 'THREADS_LOGIN_REQUIRED';
  return `
    <div class="alert alert-error">
      <span class="alert-icon">!</span>
      <div class="grow">
        <strong>${login ? 'Threads yêu cầu đăng nhập.' : 'Không cào được bài Threads.'}</strong>
        <div style="margin-top:2px">${esc(error.message || '')}</div>
        <div class="btn-row" style="margin-top:8px">
          ${login ? '<button class="btn btn-sm" data-action="open-threads-login">Đăng nhập Threads</button>' : ''}
          <button class="btn btn-sm" data-action="retry-scrape">Thử lại</button>
          <button class="btn btn-sm btn-ghost" data-action="demo-load">Dùng dữ liệu demo (test)</button>
        </div>
        <div class="contract-note" style="margin-top:6px">Không dùng AI khác, không tự tạo bình luận khi cào lỗi.</div>
      </div>
    </div>`;
}

function postCardHtml(post) {
  const isDemo = post.source === 'demo' || String(post.url || '').includes('DEMO');
  return `
    <section class="post-card">
      <div class="post-top">
        <div class="post-author">
          <div class="avatar">${esc((post.author || '?').slice(0, 2))}</div>
          <div class="post-author-text">
            <strong>@${esc(post.author || 'không rõ')}</strong>
            <span>${esc(fmtTime(post.time))} · ${isDemo ? 'Dữ liệu demo' : 'Bài gốc Threads'}</span>
          </div>
        </div>
        <div class="btn-row">
          ${isDemo ? '<span class="badge badge-demo">DEMO · KHÔNG PHẢI THREADS THẬT</span>' : '<span class="badge badge-cyan">THREADS · BÀI GỐC</span>'}
          ${!isDemo && post.url ? `<a class="btn btn-sm btn-ghost" href="${esc(post.url)}" target="_blank" rel="noreferrer">Mở bài gốc ↗</a>` : ''}
        </div>
      </div>
      <div class="post-text">${esc(post.text || '')}</div>
      <div class="post-metrics">
        <div class="metric"><strong>${esc(fmtLikes(post.likes))}</strong><span>Lượt thích</span></div>
        <div class="metric"><strong>${esc(fmtLikes(post.comments_count))}</strong><span>Bình luận</span></div>
        <div class="metric"><strong>${esc(fmtLikes(post.shares_count))}</strong><span>Chia sẻ</span></div>
        <div class="metric"><strong>${allComments().length}</strong><span>Bình luận đã đọc</span></div>
      </div>
    </section>`;
}

function step2Html() {
  const stats = libraryStatsFromItems();
  const tabs = [['all', 'Tất cả'], ['meme', 'Meme'], ['music', 'Nhạc nền'], ['sfx', 'SFX'], ['background', 'Video nền']];
  const tags = tagFrequency();
  const canContinue = allKindsPresent();
  const missing = [];
  if (!stats.meme) missing.push('meme');
  if (!stats.music) missing.push('nhạc nền');
  if (!stats.sfx) missing.push('SFX');
  if (!stats.background) missing.push('video nền');
  return `
    <div class="page">
      <div class="page-head">
        <div>
          <h2>Kho file local</h2>
          <p>Meme ảnh/clip, nhạc nền, SFX và video nền gameplay. ID là cố định; frontend chỉ truyền ID, không đổi tên ID.</p>
        </div>
        <div class="btn-row">
          <button class="btn btn-sm btn-ghost" data-action="demo-load">Nạp kho demo</button>
        </div>
      </div>

      <section class="panel">
        <div class="library-toolbar">
          <div class="tabs">
            ${tabs
              .map(
                ([kind, label]) =>
                  `<button class="tab ${state.libraryFilter.kind === kind ? 'is-active' : ''}" data-action="filter-kind" data-kind="${kind}">${label}<span class="count">${kind === 'all' ? state.library.length : stats[kind] || 0}</span></button>`,
              )
              .join('')}
          </div>
          <div class="btn-row">
            <select class="select" id="uploadKind" style="width:130px;height:32px;font-size:11.5px" ${state.busy.upload ? 'disabled' : ''}>
              ${Object.entries(KINDS)
                .map(([kind, meta]) => `<option value="${kind}" ${state.uploadKind === kind ? 'selected' : ''}>${meta.label}</option>`)
                .join('')}
            </select>
            <label class="btn btn-primary btn-sm upload-btn">
              ${state.busy.upload ? '<span class="spinner spin"></span> Đang tải...' : 'Thêm file'}
              <input type="file" multiple data-upload-file accept=".png,.jpg,.jpeg,.webp,.gif,.mp4,.mov,.webm,.m4v,.mp3,.wav,.m4a,.aac,.ogg,.flac" ${state.busy.upload ? 'disabled' : ''} />
            </label>
          </div>
        </div>
        <div class="library-filters">
          <div class="search-wrap">
            <span class="search-icon">⌕</span>
            <input class="input" id="librarySearch" placeholder="Tìm theo tên, ID, tag..." value="${esc(state.libraryFilter.q)}" />
          </div>
          <div class="tag-filter" id="libraryTagFilters">
            ${tags
              .slice(0, 22)
              .map(
                (tag) =>
                  `<button class="tag-chip ${state.libraryFilter.tag.toLowerCase() === tag.toLowerCase() ? 'is-active' : ''}" data-action="filter-tag" data-tag="${esc(tag)}">${esc(tag)}</button>`,
              )
              .join('')}
            ${state.libraryFilter.tag ? `<button class="tag-chip is-active" data-action="filter-tag" data-tag="${esc(state.libraryFilter.tag)}">${esc(state.libraryFilter.tag)} ×</button>` : ''}
            ${state.libraryFilter.tag || state.libraryFilter.q ? `<button class="btn btn-sm btn-ghost" data-action="clear-library-filter">Xóa lọc</button>` : ''}
          </div>
          <div class="small text-faint" id="libraryResultCount">${filteredLibrary().length} file</div>
        </div>
        <div class="library-grid" id="libraryResults">${libraryResultsHtml()}</div>
      </section>

      <div class="action-bar">
        <div class="note">
          ${
            canContinue
              ? 'Kho đã đủ 4 loại. Tiếp tục để tạo input gửi Muse.'
              : `Cần thêm: ${missing.join(', ')}. Kho phải đủ meme, nhạc nền, SFX và video nền trước khi dựng video.`
          }
        </div>
        <div class="btn-row">
          <button class="btn" data-action="go-step" data-step="1">Quay lại bài Threads</button>
          <button class="btn btn-primary" data-action="go-step" data-step="3" ${canContinue ? '' : 'disabled'}>Tiếp tục: Muse &amp; kế hoạch</button>
        </div>
      </div>
    </div>`;
}

function tagFrequency() {
  const counts = new Map();
  for (const item of state.library) {
    for (const tag of item.tags || []) {
      counts.set(tag, (counts.get(tag) || 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'vi')).map(([tag]) => tag);
}

function filteredLibrary() {
  const query = state.libraryFilter.q.trim().toLocaleLowerCase('vi');
  const tag = state.libraryFilter.tag.toLocaleLowerCase('vi');
  const kind = state.libraryFilter.kind;
  return state.library.filter((item) => {
    if (kind !== 'all' && item.kind !== kind) return false;
    if (tag && !(item.tags || []).some((entry) => entry.toLocaleLowerCase('vi') === tag)) return false;
    if (!query) return true;
    const haystack = [item.name, item.id, item.kind, ...(item.tags || [])].join(' ').toLocaleLowerCase('vi');
    return haystack.includes(query);
  });
}

function libraryResultsHtml() {
  const items = filteredLibrary();
  if (!items.length) {
    const isFiltered = state.libraryFilter.q || state.libraryFilter.tag || state.libraryFilter.kind !== 'all';
    return `
      <div class="empty" style="grid-column:1/-1;padding:42px 20px">
        <div class="empty-mark">${isFiltered ? '⌕' : '+'}</div>
        <strong>${isFiltered ? 'Không có file khớp bộ lọc' : 'Kho file đang trống'}</strong>
        <p>${isFiltered ? 'Thử xóa lọc hoặc đổi tag.' : 'Thêm meme, nhạc, SFX và video nền. Hoặc nạp kho demo để chạy luồng mẫu.'}</p>
        <div class="btn-row">
          ${isFiltered ? '<button class="btn" data-action="clear-library-filter">Xóa bộ lọc</button>' : '<button class="btn btn-primary" data-action="demo-load">Nạp kho demo</button>'}
        </div>
      </div>`;
  }
  return items.map((item) => libraryCardHtml(item)).join('');
}

function libraryCardHtml(item) {
  const src = mediaUrl(item.media_url);
  let media;
  if (item.mediaType === 'image') {
    media = `<img src="${esc(src)}" alt="${esc(item.name)}" loading="lazy" />`;
  } else if (item.mediaType === 'video') {
    media = `<video src="${esc(src)}#t=0.1" muted preload="metadata" playsinline></video><span class="media-play">▶</span>`;
  } else {
    media = '';
  }
  return `
    <article class="library-card" data-library-id="${esc(item.id)}">
      <div class="library-media ${item.mediaType === 'audio' ? 'is-audio' : ''}" data-action="preview-file" data-id="${esc(item.id)}">
        ${media}
        <div class="media-badges">
          <span>${kindBadge(item.kind)}</span>
          <span class="badge ${item.demo ? 'badge-demo' : ''}">${item.demo ? 'DEMO' : esc(fmtDuration(item.duration, item.mediaType))}</span>
        </div>
        ${
          item.mediaType === 'audio'
            ? `<div class="audio-preview"><audio controls preload="none" src="${esc(src)}"></audio></div>`
            : ''
        }
      </div>
      <div class="library-body">
        <div class="library-title-row">
          <div class="library-title">${esc(item.name)}</div>
          <button class="icon-btn" title="Đổi tên" data-action="rename-file" data-id="${esc(item.id)}">✎</button>
        </div>
        <div class="library-sub">
          <div class="id-row">
            <span class="id-pill" title="${esc(item.id)}">${esc(item.id)}</span>
            <button class="copy-mini" data-action="copy-id" data-id="${esc(item.id)}">copy</button>
          </div>
          <span>${esc(fmtBytes(item.size))}</span>
        </div>
        <div class="tags-line">
          ${(item.tags || [])
            .map(
              (tag) =>
                `<span class="tag">${esc(tag)}<button type="button" data-action="remove-tag" data-id="${esc(item.id)}" data-tag="${esc(tag)}" title="Xóa tag">×</button></span>`,
            )
            .join('')}
          <span class="tag-add">
            <input data-tag-input="${esc(item.id)}" placeholder="+ tag" aria-label="Thêm tag cho ${esc(item.name)}" />
            <button class="copy-mini" data-action="add-tag" data-id="${esc(item.id)}">+</button>
          </span>
        </div>
        <div class="library-sub">
          <span>${esc(kindLabel(item.kind))} · ${esc(fmtDuration(item.duration, item.mediaType))}</span>
          <div class="library-card-actions">
            <button class="icon-btn danger" title="Xóa file" data-action="delete-file" data-id="${esc(item.id)}">×</button>
          </div>
        </div>
      </div>
    </article>`;
}

function step3Html() {
  return `
    <div class="page">
      <div class="page-head">
        <div>
          <h2>Muse &amp; duyệt kế hoạch</h2>
          <p>Khung Muse tích hợp + input JSON + validate nghiêm ngặt. Bạn xem, sửa tay và duyệt kế hoạch trước khi sang hàng đợi.</p>
        </div>
        <div class="btn-row">
          <button class="btn btn-sm" data-action="go-step" data-step="2">Kho file</button>
          <button class="btn btn-sm" data-action="verify-muse">Kiểm tra Muse</button>
        </div>
      </div>
      ${layoutMuse(browserPanelHtml() + workflowHtml())}
    </div>`;
}

function step4Html() {
  const approvedPlan = state.workspace?.approved_plan || null;
  const localPlan = state.plan;
  const renderer = state.status.renderer || {};
  const stats = jobCounts();
  return `
    <div class="page">
      <div class="page-head">
        <div>
          <h2>Hàng đợi &amp; xuất video</h2>
          <p>Job được xếp hàng tuần tự. Lỗi sẽ giữ nguyên kế hoạch để chạy lại; tool không tự sửa plan.</p>
        </div>
        <div class="btn-row">
          <button class="btn btn-sm btn-ghost" data-action="go-step" data-step="3">Về kế hoạch</button>
        </div>
      </div>

      <div class="plan-create-card" id="planCreate">
        <div class="plan-create-main">
          ${
            approvedPlan
              ? `<h3>${esc(approvedPlan.title)}</h3>
                 <p>${planSourceBadge(state.workspace?.plan_meta?.source)} <span style="margin-left:6px">${approvedPlan.segments.length} đoạn · ${Number(state.workspace?.settings?.target_duration) || 60}s · ${esc(state.workspace?.settings?.watermark || '')}</span></p>
                 ${state.planDirty ? '<div class="stale-strip" style="margin-top:8px">Bạn đang có chỉnh sửa chưa duyệt. Hãy quay lại Bước 3 và duyệt lại trước khi dựng.</div>' : ''}`
              : localPlan
                ? `<h3>Kế hoạch chưa được duyệt</h3><p>Kế hoạch cần được duyệt ở Bước 3 trước khi render.</p>`
                : `<h3>Chưa có kế hoạch</h3><p>Nạp kế hoạch từ Muse (hoặc plan mẫu để test), duyệt ở Bước 3.</p>`
          }
        </div>
        <div class="btn-row">
          <button class="btn btn-primary" data-action="add-job" ${!hasEffectiveApproval() || state.busy.job ? 'disabled' : ''}>
            ${state.busy.job ? '<span class="spinner spin"></span> Đang tạo job...' : 'Đưa vào hàng đợi &amp; dựng'}
          </button>
        </div>
      </div>

      <div class="alert alert-info">
        <span class="alert-icon">i</span>
        <div class="grow">
          <strong>Renderer hiện tại: ${esc(renderer.label || 'Renderer demo')}.</strong>
          ${esc(renderer.note || 'Bản demo 576×1024@30fps, chưa phải renderer cuối.')}
          <div class="small" style="margin-top:2px">Hàng đợi giữ snapshot kế hoạch; nếu job lỗi, bấm “Chạy lại” với cùng kế hoạch.</div>
        </div>
      </div>
      ${state.jobError ? `<div class="alert alert-error"><span class="alert-icon">!</span><div class="grow">${esc(state.jobError)}</div></div>` : ''}

      <section class="panel">
        <div class="panel-head">
          <div><h3>Hàng đợi &amp; lịch sử</h3><div class="sub">Chờ dựng · Đang dựng · Xong · Lỗi</div></div>
          <div class="btn-row">
            <button class="btn btn-sm btn-ghost" data-action="refresh-jobs">Làm mới</button>
          </div>
        </div>
        <div class="panel-body" style="padding-bottom:0">
          <div class="queue-summary" id="queueStats">${queueStatsHtml(stats)}</div>
          <div class="btn-row" style="margin-top:14px">
            ${JOB_FILTERS.map(
              ([key, label]) =>
                `<button class="tab ${state.jobFilter === key ? 'is-active' : ''}" data-action="job-filter" data-filter="${key}">${label}${key === 'all' ? `<span class="count">${state.jobs.length}</span>` : ''}</button>`,
            ).join('')}
          </div>
        </div>
        <div class="jobs-list" id="jobsArea">${jobsAreaHtml()}</div>
      </section>
    </div>`;
}

function jobCounts() {
  return {
    queued: state.jobs.filter((job) => job.status === 'queued').length,
    rendering: state.jobs.filter((job) => job.status === 'rendering').length,
    done: state.jobs.filter((job) => job.status === 'done').length,
    error: state.jobs.filter((job) => job.status === 'error').length,
  };
}

function queueStatsHtml(stats = jobCounts()) {
  return `
    <div class="stat-card"><span>Chờ dựng</span><strong>${stats.queued}</strong></div>
    <div class="stat-card"><span>Đang dựng</span><strong class="text-amber">${stats.rendering}</strong></div>
    <div class="stat-card"><span>Xong</span><strong class="text-green">${stats.done}</strong></div>
    <div class="stat-card"><span>Lỗi</span><strong class="text-red">${stats.error}</strong></div>`;
}

function filteredJobs() {
  if (state.jobFilter === 'active') return state.jobs.filter((job) => ['queued', 'rendering'].includes(job.status));
  if (state.jobFilter === 'done') return state.jobs.filter((job) => job.status === 'done');
  if (state.jobFilter === 'error') return state.jobs.filter((job) => job.status === 'error');
  return state.jobs;
}

function jobsAreaHtml() {
  const jobs = filteredJobs();
  if (!jobs.length) {
    return `
      <div class="empty queue-empty">
        <div class="empty-mark">MP4</div>
        <strong>Chưa có job nào</strong>
        <p>Duyệt kế hoạch ở Bước 3, sau đó đưa vào hàng đợi để dựng video local.</p>
        <div class="btn-row"><button class="btn btn-sm" data-action="go-step" data-step="3">Về kế hoạch</button></div>
      </div>`;
  }
  return jobs.map((job) => jobCardHtml(job)).join('');
}

function jobCardHtml(job) {
  const statusClass = `status-${job.status}`;
  const active = ['queued', 'rendering'].includes(job.status);
  return `
    <article class="job-card" data-job-id="${esc(job.id)}">
      <div class="job-main">
        <button class="job-thumb" data-action="view-job-plan" data-id="${esc(job.id)}" title="Xem snapshot kế hoạch">
          <span>${job.status === 'done' ? 'MP4' : esc(job.status_label || job.status)}</span>
        </button>
        <div class="job-content">
          <div class="job-top">
            <div>
              <div class="job-title">${esc(job.title)}</div>
              <div class="job-meta">
                <span class="status-chip ${statusClass}">${esc(job.status_label || job.status)}</span>
                <span>${esc(job.id)}</span>
                <span>${esc(fmtDateTime(job.created_at))}</span>
                <span>Nguồn: ${esc(planSourceLabel(job.plan_source))}</span>
                <span>Lần chạy: ${Number(job.attempts) || 0}</span>
              </div>
            </div>
          </div>
          ${
            active
              ? `<div class="job-progress"><span>${esc(job.stage || 'Đang xử lý')}</span><div class="progress-track"><div class="progress-fill" style="width:${Math.max(2, Math.min(100, Number(job.progress) || 0))}%"></div></div><span>${Math.max(0, Math.min(100, Math.round(Number(job.progress) || 0)))}%</span></div>`
              : ''
          }
          <div class="job-actions">
            ${
              job.status === 'done'
                ? `<button class="btn btn-sm btn-primary" data-action="watch-job" data-id="${esc(job.id)}">Xem video</button>
                   <a class="btn btn-sm" href="${esc(downloadUrl(job.download_url))}">Tải MP4</a>`
                : ''
            }
            ${
              job.status === 'error'
                ? `<button class="btn btn-sm" data-action="retry-job" data-id="${esc(job.id)}">Chạy lại (giữ nguyên kế hoạch)</button>`
                : ''
            }
            <button class="btn btn-sm btn-ghost" data-action="view-job-plan" data-id="${esc(job.id)}">Xem snapshot</button>
            ${job.status === 'error' ? '<span class="small text-faint">Plan không bị sửa</span>' : ''}
          </div>
        </div>
      </div>
      ${job.status === 'error' ? `<div class="job-error"><strong>Lỗi:</strong> ${esc(job.error || 'Không rõ lỗi.')}</div>` : ''}
      ${job.logs?.length
        ? `<details style="margin:0 14px 12px"><summary class="small text-faint" style="cursor:pointer">Log kỹ thuật</summary><div class="job-logs">${esc(job.logs.join('\n'))}</div></details>`
        : ''}
      ${job.status === 'done'
        ? `<div class="job-video-wrap">
             <video controls preload="metadata" src="${esc(mediaUrl(job.output_url))}#t=0.1"></video>
             <div class="job-video-info">
               <h4>${esc(job.title)}</h4>
               <p>${job.width}×${job.height} · ${job.fps}fps · ${Number(job.duration_seconds || 0).toFixed(0)} giây · ${esc(fmtBytes(job.output_bytes))}</p>
               <div class="btn-row"><button class="btn btn-sm" data-action="watch-job" data-id="${esc(job.id)}">Xem lớn</button><a class="btn btn-sm" href="${esc(downloadUrl(job.download_url))}">Tải MP4</a></div>
             </div>
           </div>`
        : ''}
    </article>`;
}

function renderView({ preserveScroll = true } = {}) {
  const view = document.getElementById('view');
  if (!view) return;
  const scrollTop = preserveScroll ? view.scrollTop : 0;
  let html = '';
  if (state.step === 1) html = step1Html();
  else if (state.step === 2) html = step2Html();
  else if (state.step === 3) html = step3Html();
  else html = step4Html();
  view.innerHTML = html;
  if (preserveScroll) view.scrollTop = scrollTop;

  if (state.step === 3) {
    ensureMuseWebview();
    startMuseTimer();
  } else {
    stopMuseTimer();
    state.museWebview = null;
    state.museWebviewId = null;
  }
  if (state.step === 4) {
    scheduleJobsPoll(900);
  } else {
    stopJobsPoll();
  }
  if (state.step === 1) {
    // no timers
  }
}

function renderWorkflow() {
  if (state.step !== 3) return;
  const col = document.querySelector('.workflow-col');
  if (!col) return;
  const scroll = col.closest('.page')?.parentElement?.scrollTop;
  col.outerHTML = workflowHtml();
  if (typeof scroll === 'number' && document.getElementById('view')) document.getElementById('view').scrollTop = scroll;
  updateMuseActionButtons();
}

function renderJobsArea() {
  if (state.step !== 4) return;
  const stats = document.getElementById('queueStats');
  if (stats) stats.innerHTML = queueStatsHtml();
  const area = document.getElementById('jobsArea');
  if (area) area.innerHTML = jobsAreaHtml();
  const planCreate = document.getElementById('planCreate');
  if (planCreate) {
    // Rebuild only when approval/dirty changes would alter the add-job state.
    const button = planCreate.querySelector('[data-action="add-job"]');
    if (button) button.disabled = !hasEffectiveApproval() || Boolean(state.busy.job);
  }
  renderChrome();
}

function renderLibraryResults() {
  if (state.step !== 2) return;
  const host = document.getElementById('libraryResults');
  if (host) host.innerHTML = libraryResultsHtml();
  const count = document.getElementById('libraryResultCount');
  if (count) count.textContent = `${filteredLibrary().length} file`;
}

function updateMuseActionButtons() {
  const unlocked = isMuseUnlocked();
  const online = isOnlineNow();
  const ready = inputReady();
  $$('[data-muse-action]').forEach((button) => {
    const kind = button.dataset.museAction;
    if (kind === 'bridge') {
      button.disabled = !unlocked || !online || !ready || !isMuseBridgeReady() || Boolean(state.busy.bridge);
    } else if (kind === 'import') {
      button.disabled = !unlocked || !online || !ready || Boolean(state.busy.import);
    }
  });
  const wrapper = document.getElementById('museGateWrap');
  if (wrapper) wrapper.innerHTML = gateCardHtml();
  const actionsPanel = document.getElementById('museActions');
  const badge = actionsPanel?.querySelector('.panel-head .badge');
  if (badge) {
    badge.className = `badge ${unlocked ? 'badge-green' : 'badge-amber'}`;
    badge.textContent = unlocked ? 'MUSE SẴN SÀNG' : 'ĐANG KHÓA';
  }
}

function updateMuseGate() {
  updateMuseActionButtons();
  renderChips();
  renderGlobalBanner();
  renderSidebarConnection();
}

function ensureMuseWebview() {
  if (state.step !== 3) return;
  const muse = state.status.muse || {};
  if (!muse.configured) return;
  const host = document.getElementById('museFrameHost');
  if (!host) return;
  if (state.museWebview && state.museWebview.isConnected) return;
  if (state.museWebview) {
    // Config edits rerender the view; keep the live session webview when the origin is unchanged.
    let sameOrigin = false;
    try {
      const current = new URL(state.museWebview.getAttribute('src'));
      const next = new URL(muse.url);
      sameOrigin = current.origin === next.origin;
    } catch {}
    if (sameOrigin) {
      host.innerHTML = '';
      host.appendChild(state.museWebview);
      return;
    }
  }
  host.innerHTML = '';
  const webview = document.createElement('webview');
  webview.setAttribute('partition', 'persist:muse');
  webview.setAttribute('src', muse.url);
  webview.setAttribute('allowpopups', 'false');
  webview.style.width = '100%';
  webview.style.height = '100%';
  webview.style.border = '0';
  webview.addEventListener('dom-ready', () => {
    try {
      state.museWebviewId = webview.getWebContentsId();
    } catch {
      state.museWebviewId = null;
    }
    window.setTimeout(() => verifyMuse(false), 700);
  });
  webview.addEventListener('did-navigate', () => {
    window.setTimeout(() => verifyMuse(false), 900);
  });
  webview.addEventListener('did-navigate-in-page', () => {
    window.setTimeout(() => verifyMuse(false), 900);
  });
  webview.addEventListener('did-fail-load', (event) => {
    if (event.errorCode === -3) return;
    showToast('Không tải được khung Muse. Kiểm tra wifi hoặc muse.url trong muse_rule.json.', 'warn', 6000);
  });
  host.appendChild(webview);
  state.museWebview = webview;
}

function commaList(value) {
  return String(value || '')
    .split(/[\n,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function museConfigFormHtml() {
  const muse = state.status.muse || {};
  const login = muse.login || {};
  const bridge = muse.bridge || {};
  return `
    <div class="modal" style="max-width:780px">
      <div class="modal-head">
        <div>
          <h3>Cấu hình Muse</h3>
          <p>Nhập URL trang Muse kèm tool, đăng nhập trong cửa sổ riêng, rồi đo tín hiệu phiên. Tool chỉ lưu tên cookie/selector — không lưu mật khẩu.</p>
        </div>
        <button class="icon-btn" data-action="close-modal" title="Đóng">×</button>
      </div>
      <form data-form="muse-config">
        <div class="modal-body">
          <div class="field">
            <label for="museName">Tên hiển thị</label>
            <input class="input" id="museName" name="name" value="${esc(muse.name || 'Muse')}" maxlength="80" />
          </div>
          <div class="field">
            <label for="museUrl">URL Muse <span class="req">*</span></label>
            <input class="input" id="museUrl" name="url" value="${esc(muse.url || '')}" placeholder="https://..." autofocus />
            <span class="hint">Phải là http:// hoặc https://. URL này cũng là domain được phép mở trong khung Muse.</span>
          </div>

          <div class="muse-config-section">
            <strong>Tín hiệu đăng nhập</strong>
            <span class="small text-faint">Đăng nhập trong cửa sổ Muse, sau đó bấm “Đo phiên hiện tại”. Có thể nhập tay nếu đã biết.</span>
          </div>
          <div class="field">
            <label for="museCookieNames">Tên cookie đăng nhập</label>
            <input class="input" id="museCookieNames" name="cookie_names" value="${esc((login.cookie_names || []).join(', '))}" placeholder="session_id, auth_token" />
            <span class="hint">Phân tách bằng dấu phẩy. Chỉ tên cookie, không nhập giá trị.</span>
          </div>
          <div class="muse-config-grid">
            <div class="field">
              <label for="museLoggedInUrl">URL chứa (đã đăng nhập)</label>
              <input class="input" id="museLoggedInUrl" name="logged_in_url_contains" value="${esc((login.logged_in_url_contains || []).join(', '))}" placeholder="/chat, /app" />
            </div>
            <div class="field">
              <label for="museLoggedOutUrl">URL chứa (đã đăng xuất)</label>
              <input class="input" id="museLoggedOutUrl" name="logged_out_url_contains" value="${esc((login.logged_out_url_contains || []).join(', '))}" placeholder="/login, /signin" />
            </div>
            <div class="field">
              <label for="museLoggedInSelector">Selector đã đăng nhập</label>
              <input class="input" id="museLoggedInSelector" name="logged_in_selectors" value="${esc((login.logged_in_selectors || []).join(', '))}" placeholder="[data-user-menu]" />
            </div>
            <div class="field">
              <label for="museLoggedOutSelector">Selector đã đăng xuất</label>
              <input class="input" id="museLoggedOutSelector" name="logged_out_selectors" value="${esc((login.logged_out_selectors || []).join(', '))}" placeholder="form[action*=login]" />
            </div>
          </div>

          <div class="muse-measure-box" id="museMeasureResult">
            <div class="small text-faint">Chưa đo phiên. Bấm “Đo phiên hiện tại” sau khi đăng nhập trong cửa sổ Muse.</div>
          </div>

          <div class="muse-config-section">
            <strong>Bridge gửi/nhận kế hoạch (tùy chọn)</strong>
            <span class="small text-faint">Để trống thì dùng luồng dán JSON thủ công. Không tự tạo kết quả nếu Muse không trả JSON.</span>
          </div>
          <div class="muse-config-grid">
            <div class="field">
              <label for="museBridgeMode">Chế độ bridge</label>
              <select class="select" id="museBridgeMode" name="bridge_mode">
                <option value="manual" ${bridge.mode !== 'auto' ? 'selected' : ''}>Thủ công (copy/paste JSON)</option>
                <option value="auto" ${bridge.mode === 'auto' ? 'selected' : ''}>Tự động (selector)</option>
              </select>
            </div>
            <div class="field">
              <label for="museBridgeWait">Chờ tối đa (ms)</label>
              <input class="input" id="museBridgeWait" name="bridge_wait_timeout_ms" type="number" min="15000" max="600000" step="1000" value="${Number(bridge.waitTimeoutMs) || 180000}" />
            </div>
            <div class="field">
              <label for="museNewChatUrl">URL tạo phiên mới</label>
              <input class="input" id="museNewChatUrl" name="bridge_new_chat_url" value="${esc(bridge.newChatUrl || '')}" placeholder="https://.../new" />
            </div>
            <div class="field">
              <label for="museInputSelector">Selector ô nhập</label>
              <input class="input" id="museInputSelector" name="bridge_input_selector" value="${esc(bridge.inputSelector || '')}" placeholder="textarea[data-chat-input]" />
            </div>
            <div class="field">
              <label for="museSendSelector">Selector nút gửi</label>
              <input class="input" id="museSendSelector" name="bridge_send_selector" value="${esc(bridge.sendSelector || '')}" placeholder="button[data-send]" />
            </div>
            <div class="field">
              <label for="museResponseSelector">Selector phản hồi</label>
              <input class="input" id="museResponseSelector" name="bridge_response_selector" value="${esc(bridge.responseSelector || '')}" placeholder="[data-message='assistant']" />
            </div>
          </div>
          <p class="small text-faint">Mật khẩu Muse chỉ nhập trong cửa sổ đăng nhập. Tool không lưu mật khẩu dưới dạng văn bản.</p>
        </div>
        <div class="modal-foot">
          <button class="btn btn-ghost" type="button" data-action="close-modal">Đóng</button>
          <button class="btn" type="button" data-action="measure-muse-session">Đo phiên hiện tại</button>
          <button class="btn" type="button" data-action="open-muse-login">Lưu &amp; mở cửa sổ đăng nhập</button>
          <button class="btn btn-primary" type="submit">Lưu cấu hình</button>
        </div>
      </form>
    </div>`;
}

function openMuseConfigDialog() {
  openModal(museConfigFormHtml());
}

function museConfigPayload(form) {
  const data = new FormData(form);
  return {
    name: String(data.get('name') || 'Muse'),
    url: String(data.get('url') || ''),
    login: {
      cookie_names: commaList(data.get('cookie_names')),
      logged_in_url_contains: commaList(data.get('logged_in_url_contains')),
      logged_out_url_contains: commaList(data.get('logged_out_url_contains')),
      logged_in_selectors: commaList(data.get('logged_in_selectors')),
      logged_out_selectors: commaList(data.get('logged_out_selectors')),
    },
    bridge: {
      mode: String(data.get('bridge_mode') || 'manual'),
      new_chat_url: String(data.get('bridge_new_chat_url') || ''),
      input_selector: String(data.get('bridge_input_selector') || ''),
      send_selector: String(data.get('bridge_send_selector') || ''),
      response_selector: String(data.get('bridge_response_selector') || ''),
      wait_timeout_ms: Number(data.get('bridge_wait_timeout_ms')) || 180000,
    },
  };
}

async function saveMuseConfig(form, { keepOpen = false, quiet = false } = {}) {
  if (!form) return false;
  const data = museConfigPayload(form);
  if (!data.url.trim()) {
    showToast('Nhập URL Muse trước khi lưu.', 'warn');
    form.querySelector('#museUrl')?.focus();
    return false;
  }
  try {
    const result = await api('/api/muse/config', { method: 'POST', json: data });
    state.status.muse = { ...state.status.muse, ...(result.status || {}) };
    updateMuseGate();
    if (!keepOpen) {
      closeModal();
      renderChrome();
      renderView({ preserveScroll: true });
    }
    if (!quiet) showToast('Đã lưu cấu hình Muse.', 'ok', 3000);
    return true;
  } catch (error) {
    showToast(error.message, 'error', 6500);
    return false;
  }
}

async function openMuseLoginUi(button) {
  const form = button?.closest('form[data-form="muse-config"]');
  if (form) {
    const saved = await saveMuseConfig(form, { keepOpen: true, quiet: true });
    if (!saved) return;
  }
  try {
    await api('/api/muse/session/open', { method: 'POST', json: {} });
    showToast('Đã mở cửa sổ đăng nhập Muse. Đăng nhập ở cửa sổ đó rồi bấm “Đo phiên hiện tại”.', 'ok', 6000);
  } catch (error) {
    showToast(error.message, 'error', 6500);
  }
}

function renderMuseMeasurement(result) {
  const host = document.getElementById('museMeasureResult');
  if (!host) return;
  const suggested = new Set(result.suggestedCookieNames || []);
  const cookies = Array.isArray(result.cookies) ? result.cookies : [];
  const rows = cookies.length
    ? cookies
        .map(
          (cookie) => `
        <label class="muse-cookie-row">
          <input type="checkbox" data-muse-cookie value="${esc(cookie.name)}" ${suggested.has(cookie.name) && !result.hasPasswordField ? 'checked' : ''} />
          <span class="mono-small">${esc(cookie.name)}</span>
          <span class="small text-faint">${esc(cookie.domain || '')} · ${cookie.httpOnly ? 'httpOnly' : 'js'} · ${cookie.session ? 'session' : 'có hạn'}</span>
        </label>`,
        )
        .join('')
    : '<div class="small text-amber">Không thấy cookie nào cho domain Muse. Hãy kiểm tra đã đăng nhập và đang đứng đúng domain Muse.</div>';
  host.innerHTML = `
    <div class="measure-head">
      <div>
        <strong>Đo lúc ${esc(fmtDateTime(result.measuredAt))}</strong>
        <div class="small text-faint">${esc(result.url || '')}${result.title ? ` · ${esc(result.title)}` : ''}</div>
      </div>
      ${result.hasPasswordField ? '<span class="badge badge-amber">Trang còn ô mật khẩu</span>' : '<span class="badge badge-green">Không thấy ô mật khẩu</span>'}
    </div>
    <div class="small text-faint">Chọn đúng cookie sinh ra sau khi đăng nhập. Tool chỉ lưu tên cookie, không lưu giá trị.</div>
    <div class="muse-cookie-list">${rows}</div>
    <div class="btn-row">
      <button class="btn btn-sm btn-primary" type="button" data-action="apply-muse-measurement">Dùng cookie đã chọn &amp; lưu</button>
    </div>`;
}

async function measureMuseSessionUi(button) {
  const form = button?.closest('form[data-form="muse-config"]');
  if (form) {
    const saved = await saveMuseConfig(form, { keepOpen: true, quiet: true });
    if (!saved) return;
  }
  const host = document.getElementById('museMeasureResult');
  if (host) host.innerHTML = '<div class="small text-faint">Đang đọc phiên Muse...</div>';
  if (button) button.disabled = true;
  try {
    const result = await api('/api/muse/session/measure', { method: 'POST', json: {} });
    renderMuseMeasurement(result);
  } catch (error) {
    if (host) host.innerHTML = `<div class="small text-amber">${esc(error.message)}</div>`;
    showToast(error.message, 'error', 6500);
  } finally {
    if (button) button.disabled = false;
  }
}

async function applyMuseMeasurement(button) {
  const form = button?.closest('form[data-form="muse-config"]');
  if (!form) return;
  const checked = [...document.querySelectorAll('[data-muse-cookie]:checked')].map((input) => input.value);
  if (!checked.length) {
    showToast('Chọn ít nhất một cookie đăng nhập. Nếu không thấy cookie, hãy đăng nhập lại trong cửa sổ Muse.', 'warn', 5500);
    return;
  }
  const cookieInput = form.querySelector('[name="cookie_names"]');
  if (cookieInput) cookieInput.value = checked.join(', ');
  const saved = await saveMuseConfig(form, { keepOpen: false, quiet: true });
  if (!saved) return;
  showToast('Đã lưu tín hiệu đăng nhập. Đang kiểm tra phiên Muse...', 'info', 3500);
  await verifyMuse(true);
}

async function verifyMuse(showFeedback = true) {
  if (!isMuseConfigured()) {
    if (showFeedback) showToast('Chưa cấu hình Muse trong config/muse_rule.json.', 'warn');
    return;
  }
  if (!state.status.muse?.loginCheckConfigured) {
    if (showFeedback) showToast('Chưa cấu hình cách kiểm tra đăng nhập Muse (cookie/selector).', 'warn');
    return;
  }
  try {
    const result = await api('/api/muse/verify', {
      method: 'POST',
      json: { webContentsId: state.museWebviewId || null },
    });
    state.status.muse = { ...state.status.muse, ...result };
    updateMuseGate();
    if (showFeedback) {
      if (result.loggedIn) showToast('Đã xác thực đăng nhập Muse.', 'ok', 2500);
      else showToast(result.message || gateMessage(), 'warn', 5000);
    }
  } catch (error) {
    if (showFeedback) showToast(error.message, 'error', 6000);
  }
}

function startMuseTimer() {
  stopMuseTimer();
  if (!isMuseConfigured()) return;
  state.museTimer = window.setInterval(() => {
    if (state.step === 3) verifyMuse(false);
  }, 25000);
}

function stopMuseTimer() {
  if (state.museTimer) window.clearInterval(state.museTimer);
  state.museTimer = null;
}

function hasActiveJobs() {
  return state.jobs.some((job) => job.status === 'queued' || job.status === 'rendering');
}

function scheduleJobsPoll(delay = 1400) {
  stopJobsPoll();
  if (state.step !== 4) return;
  state.jobsTimer = window.setTimeout(async () => {
    if (state.step !== 4) return;
    await refreshJobs({ quiet: true });
    scheduleJobsPoll(hasActiveJobs() ? 1300 : 6000);
  }, delay);
}

function stopJobsPoll() {
  if (state.jobsTimer) window.clearTimeout(state.jobsTimer);
  state.jobsTimer = null;
}

async function refreshJobs({ quiet = false } = {}) {
  try {
    const data = await api('/api/jobs');
    const next = Array.isArray(data?.jobs) ? data.jobs : [];
    const signature = next
      .map((job) => `${job.id}:${job.status}:${job.progress}:${job.attempts}:${job.updated_at}:${job.output_file || ''}`)
      .join('|');
    state.jobs = next;
    if (state.step === 4 && signature !== state.jobSignature) {
      state.jobSignature = signature;
      renderJobsArea();
    } else if (state.step === 4) {
      renderChrome();
    }
  } catch (error) {
    if (!quiet) showToast(error.message, 'error');
  }
}

async function refreshStatus({ quiet = true } = {}) {
  try {
    const data = await api('/api/status');
    state.status = { ...state.status, ...data };
    if (data.threads) state.threadsSession = data.threads;
    renderChrome();
    if (state.step === 1) {
      const box = document.getElementById('threadsSessionBox');
      if (box) box.innerHTML = threadsSessionHtml();
    }
    if (state.step === 3) updateMuseGate();
  } catch (error) {
    if (!quiet) showToast(error.message, 'error');
  }
}

async function refreshThreadsSession({ rerender = true } = {}) {
  try {
    const data = await api('/api/threads/session');
    state.threadsSession = data;
    if (state.step === 1) {
      const box = document.getElementById('threadsSessionBox');
      if (box) box.innerHTML = threadsSessionHtml();
      if (rerender) renderSidebarConnection();
    }
    return data;
  } catch (error) {
    if (rerender) showToast(error.message, 'error');
    return state.threadsSession;
  }
}

async function refreshLibrary() {
  const data = await api('/api/library');
  state.library = data.items || [];
  state.libraryStats = data.stats || libraryStatsFromItems();
  state.status.library = { stats: state.libraryStats, total: state.library.length };
}

async function refreshWorkspace({ hydratePlan = false } = {}) {
  const data = await api('/api/workspace');
  if (data.workspace) {
    state.workspace = data.workspace;
    state.planMeta = data.workspace.plan_meta || state.planMeta;
    state.approved = Boolean(data.workspace.approved_plan);
    if (hydratePlan && !state.planDirty) {
      state.plan = data.workspace.draft_plan || data.workspace.approved_plan || null;
    }
  }
  return data;
}

async function refreshPlanInput() {
  try {
    const data = await api('/api/plan/input');
    state.planInput = data.input || null;
    state.planInputErrors = Array.isArray(data.errors) ? data.errors : [];
    state.inputReady = Boolean(data.ready);
    state.inputHash = data.input_hash || null;
  } catch (error) {
    state.planInput = null;
    state.inputReady = false;
    state.planInputErrors = error.details && Array.isArray(error.details) ? error.details : [{ code: error.code, message: error.message }];
    state.inputHash = null;
  }
}

function hydrateFromLoad(data) {
  if (data.workspace) {
    state.workspace = data.workspace;
    state.plan = data.workspace.draft_plan || data.workspace.approved_plan || null;
    state.planMeta = data.workspace.plan_meta || null;
    state.approved = Boolean(data.workspace.approved_plan);
    state.planDirty = false;
    state.planErrors = [];
    state.planErrorMessage = '';
    state.planErrorCode = '';
    state.scrapeUrl = data.workspace.post?.url || state.scrapeUrl;
  }
  if (data.selected_comments) {
    // Keep workspace as the source of truth; this is for compatibility.
  }
  if (data.library?.items) {
    state.library = data.library.items;
    state.libraryStats = data.library.stats || libraryStatsFromItems();
    state.status.library = { stats: state.libraryStats, total: state.library.length };
  }
}

async function reloadAll({ hydratePlan = true } = {}) {
  const [status, workspace, library, jobs] = await Promise.all([
    api('/api/status'),
    api('/api/workspace'),
    api('/api/library'),
    api('/api/jobs'),
  ]);
  state.status = { ...state.status, ...status };
  state.threadsSession = status.threads || state.threadsSession;
  state.workspace = workspace.workspace || null;
  state.plan = hydratePlan && !state.planDirty
    ? state.workspace?.draft_plan || state.workspace?.approved_plan || null
    : state.plan;
  state.planMeta = state.workspace?.plan_meta || null;
  state.approved = Boolean(state.workspace?.approved_plan);
  state.library = library.items || [];
  state.libraryStats = library.stats || libraryStatsFromItems();
  state.jobs = jobs.jobs || [];
  state.jobSignature = state.jobs
    .map((job) => `${job.id}:${job.status}:${job.progress}:${job.attempts}:${job.updated_at}:${job.output_file || ''}`)
    .join('|');
  state.scrapeUrl = state.workspace?.post?.url || state.scrapeUrl;
  if (!state.planDirty) {
    state.planErrors = [];
    state.planErrorMessage = '';
    state.planErrorCode = '';
  }
}

function syncMuseFromStatus() {
  updateMuseGate();
}

function stepTitles() {
  return ['', 'Cào bài Threads', 'Kho file', 'Muse & duyệt kế hoạch', 'Hàng đợi & xuất video'];
}

async function goStep(step, { force = false } = {}) {
  const next = Math.max(1, Math.min(4, Number(step)));
  state.step = next;
  renderChrome();
  renderView({ preserveScroll: false });
  if (next === 3) {
    void syncStep3({ initial: true });
  }
  if (next === 4) {
    void refreshJobs({ quiet: true });
  }
  if (next === 1) {
    void refreshThreadsSession({ rerender: false });
  }
}

async function syncStep3({ initial = false } = {}) {
  try {
    const [workspace, inputData, museStatus] = await Promise.all([
      api('/api/workspace'),
      api('/api/plan/input'),
      api('/api/muse/status'),
    ]);
    if (!state.planDirty) {
      state.workspace = workspace.workspace || state.workspace;
      state.plan = workspace.workspace?.draft_plan || workspace.workspace?.approved_plan || null;
      state.planMeta = workspace.workspace?.plan_meta || null;
      state.approved = Boolean(workspace.workspace?.approved_plan);
    } else if (workspace.workspace) {
      state.workspace = workspace.workspace;
    }
    state.planInput = inputData.input || null;
    state.planInputErrors = Array.isArray(inputData.errors) ? inputData.errors : [];
    state.inputReady = Boolean(inputData.ready);
    state.inputHash = inputData.input_hash || null;
    state.status.muse = { ...state.status.muse, ...museStatus };
    state.step3Error = '';
    renderChrome();
    renderWorkflow();
    if (isMuseConfigured() && state.museWebview) {
      window.setTimeout(() => verifyMuse(false), 300);
    }
  } catch (error) {
    state.step3Error = error.message;
    renderWorkflow();
  }
}

function readDiscoveryForm() {
  const topic = (document.getElementById('discoverTopic')?.value || state.discovery.topic || '').trim();
  const limit = Math.max(1, Math.min(20, Number(document.getElementById('discoverLimit')?.value) || 5));
  const maxAgeHours = Number(document.getElementById('discoverAge')?.value) || 72;
  const sort = document.getElementById('discoverSort')?.value === 'recent' ? 'recent' : 'trend';
  const requestedMode = document.getElementById('threadsMode')?.value || state.threadsMode;
  state.threadsMode = ['guest', 'account'].includes(requestedMode) ? requestedMode : 'auto';
  state.discovery.topic = topic;
  state.discovery.limit = limit;
  state.discovery.maxAgeHours = maxAgeHours;
  state.discovery.sort = sort;
  return { topic, limit, maxAgeHours, sort };
}

async function discoverThreadsUi() {
  if (state.discovery.loading || state.scraping) return;
  const form = readDiscoveryForm();
  if (form.topic.length < 2) {
    state.discovery.error = { code: 'INVALID_TOPIC', message: 'Nhập chủ đề ít nhất 2 ký tự, ví dụ “mèo” hoặc “công sở”.' };
    renderView({ preserveScroll: true });
    return;
  }
  const requested = state.threadsMode;
  if (requested === 'account' && !threadsLoggedIn()) {
    state.discovery.error = {
      code: 'THREADS_LOGIN_REQUIRED',
      message: 'Chế độ Tài khoản Threads cần đăng nhập Threads trước. Hãy đăng nhập hoặc chọn Ẩn danh.',
    };
    renderView({ preserveScroll: true });
    return;
  }
  const mode = requested === 'auto' ? (threadsLoggedIn() ? 'account' : 'guest') : requested;
  state.discovery.loading = true;
  state.discovery.error = null;
  state.discovery.candidates = [];
  state.discovery.warnings = [];
  state.discovery.stats = null;
  state.discovery.meta = null;
  state.discovery.selectedCode = '';
  renderChrome();
  renderView({ preserveScroll: true });

  const controller = new AbortController();
  const hardTimeout = window.setTimeout(() => controller.abort(), 70000);
  try {
    const data = await api('/api/threads/discover', {
      method: 'POST',
      json: {
        topic: form.topic,
        limit: form.limit,
        maxAgeHours: form.maxAgeHours,
        sort: form.sort,
        mode,
      },
      signal: controller.signal,
    });
    const result = data.result || {};
    state.discovery.candidates = Array.isArray(result.candidates) ? result.candidates : [];
    state.discovery.warnings = Array.isArray(result.warnings) ? result.warnings : [];
    state.discovery.stats = result.stats || null;
    state.discovery.meta = {
      ...(result.meta || {}),
      limit: Number(result.requested) || form.limit,
      found: Number(result.found) || 0,
    };
    if (data.threads) state.threadsSession = data.threads;
    state.discovery.error = null;
    state.discovery.loading = false;
    renderChrome();
    renderView({ preserveScroll: true });
    if (state.discovery.candidates.length) {
      window.setTimeout(() => scrollViewToElement(document.querySelector('.candidate-card'), 70), 120);
      showToast(`Tìm được ${state.discovery.candidates.length} bài mới phù hợp.`, 'ok', 4500);
    } else {
      showToast('Không có bài mới phù hợp; xem cảnh báo và thử từ khóa/khoảng thời gian khác.', 'warn', 6500);
    }
  } catch (error) {
    const aborted = error.name === 'AbortError';
    state.discovery.loading = false;
    state.discovery.error = {
      code: aborted ? 'TIMEOUT' : error.code,
      message: aborted
        ? 'Tìm Threads quá lâu (>70 giây). Tool đã dừng; không tạo dữ liệu giả. Kiểm tra wifi/đăng nhập Threads rồi thử lại.'
        : error.message,
    };
    renderChrome();
    renderView({ preserveScroll: true });
    showToast(state.discovery.error.message, 'error', 7000);
  } finally {
    window.clearTimeout(hardTimeout);
  }
}

async function useCandidate(code) {
  if (state.discovery.loading || state.scraping) return;
  const candidate = state.discovery.candidates.find((item) => item.code === code);
  if (!candidate) {
    showToast('Không tìm thấy bài ứng viên. Hãy tìm lại danh sách.', 'warn');
    return;
  }
  if (currentPost()) {
    const ok = await confirmDialog({
      title: 'Dùng bài này?',
      message: `Bài @${candidate.author} sẽ thay bài đang làm và reset kế hoạch hiện tại. Lịch sử job vẫn được giữ. Tiếp tục?`,
      confirmLabel: 'Dùng bài này',
    });
    if (!ok) return;
  }
  const mode = state.discovery.meta?.mode || resolvedThreadsMode();
  if (mode === 'account' && !threadsLoggedIn()) {
    state.scrapeError = {
      code: 'THREADS_LOGIN_REQUIRED',
      message: 'Bài này đang ở chế độ Tài khoản Threads nhưng phiên đã đăng xuất. Hãy đăng nhập lại hoặc tìm ở chế độ Ẩn danh.',
    };
    renderChrome();
    renderView({ preserveScroll: true });
    return;
  }
  state.discovery.selectedCode = code;
  await scrapeFromUrl(candidate.url, { mode, candidateCode: code });
}

async function scrapeFromUrl(url, options = {}) {
  if (state.scraping) return;
  const value = String(url || '').trim();
  if (!value) {
    showToast('Hãy dán link bài Threads trước.', 'warn');
    return;
  }
  if (!isOnlineNow()) {
    state.scrapeError = { code: 'OFFLINE', message: 'Mất kết nối mạng. Không thể cào Threads.' };
    renderView();
    return;
  }
  const mode = options.mode || resolvedThreadsMode();
  if (mode === 'account' && !threadsLoggedIn()) {
    state.scrapeError = {
      code: 'THREADS_LOGIN_REQUIRED',
      message: 'Chế độ Tài khoản Threads cần đăng nhập Threads trước. Hãy đăng nhập hoặc chọn Ẩn danh.',
    };
    renderChrome();
    renderView({ preserveScroll: true });
    return;
  }
  state.scraping = true;
  state.scrapeError = null;
  state.scrapeWarnings = [];
  state.scrapeUrl = value;
  if (options.candidateCode) state.discovery.selectedCode = options.candidateCode;
  renderView({ preserveScroll: true });
  const controller = new AbortController();
  const hardTimeout = window.setTimeout(() => controller.abort(), 75000);
  try {
    const data = await api('/api/threads/scrape', { method: 'POST', json: { url: value, mode }, signal: controller.signal });
    state.workspace = data.workspace;
    state.scrapeWarnings = data.result?.warnings || [];
    state.plan = null;
    state.planDirty = false;
    state.planErrors = [];
    state.planErrorMessage = '';
    state.planErrorCode = '';
    state.scrapeError = null;
    state.scraping = false;
    if (data.workspace?.post) state.scrapeUrl = data.workspace.post.url || value;
    await refreshStatus({ quiet: true });
    renderChrome();
    renderView({ preserveScroll: false });
    if (options.candidateCode) {
      window.setTimeout(() => scrollViewToElement(document.querySelector('.post-card'), 10), 100);
    }
    showToast(`Đã cào ${data.result?.comments?.length || 0} bình luận.`, 'ok');
  } catch (error) {
    state.scraping = false;
    const aborted = error.name === 'AbortError';
    state.scrapeError = {
      code: aborted ? 'TIMEOUT' : error.code,
      message: aborted
        ? 'Cào Threads quá lâu (>75 giây). Tool đã dừng; không tạo dữ liệu giả. Kiểm tra wifi/đăng nhập Threads rồi thử lại.'
        : error.message,
      details: error.details || null,
    };
    renderChrome();
    renderView({ preserveScroll: true });
    showToast(state.scrapeError.message, 'error', 6000);
    if (['LOGIN_REQUIRED', 'THREADS_LOGIN_REQUIRED'].includes(error.code)) void refreshThreadsSession({ rerender: true });
  } finally {
    window.clearTimeout(hardTimeout);
  }
}

async function openThreadsLogin() {
  try {
    await api('/api/threads/login', { method: 'POST', json: {} });
    state.threadsLoginOpened = true;
    showToast('Đã mở cửa sổ đăng nhập Threads. Đăng nhập xong quay lại tool và bấm “Kiểm tra lại Threads”.', 'info', 7000);
    if (state.threadsTimer) window.clearInterval(state.threadsTimer);
    let tries = 0;
    state.threadsTimer = window.setInterval(async () => {
      tries += 1;
      const session = await refreshThreadsSession({ rerender: false });
      if (session?.loggedIn) {
        window.clearInterval(state.threadsTimer);
        state.threadsTimer = null;
        if (state.step === 1) renderView({ preserveScroll: true });
        showToast('Threads đã đăng nhập. Bạn có thể chọn chế độ Tài khoản để lấy thêm bình luận.', 'ok', 5000);
      } else if (tries >= 18) {
        window.clearInterval(state.threadsTimer);
        state.threadsTimer = null;
      }
    }, 5000);
    renderView({ preserveScroll: true });
  } catch (error) {
    showToast(error.message, 'error', 6000);
  }
}

async function demoLoad() {
  const hasData = Boolean(state.workspace?.post) || Boolean(state.plan) || state.jobs.length > 0;
  if (hasData) {
    const ok = await confirmDialog({
      title: 'Nạp dữ liệu demo?',
      message: 'Dữ liệu demo sẽ thay bài đang làm, lựa chọn bình luận và thiết lập hiện tại. Lịch sử job vẫn được giữ. Tiếp tục?',
      confirmLabel: 'Nạp demo',
    });
    if (!ok) return;
  }
  try {
    state.busy.demo = true;
    renderView({ preserveScroll: true });
    const data = await api('/api/demo/load', { method: 'POST', json: {} });
    const [status, libraryData, workspaceData, jobsData] = await Promise.all([
      api('/api/status'),
      api('/api/library'),
      api('/api/workspace'),
      api('/api/jobs'),
    ]);
    state.status = { ...state.status, ...status };
    state.threadsSession = status.threads || state.threadsSession;
    state.library = libraryData.items || [];
    state.libraryStats = libraryData.stats || libraryStatsFromItems();
    state.workspace = workspaceData.workspace || null;
    state.plan = null;
    state.planDirty = false;
    state.planErrors = [];
    state.planErrorMessage = '';
    state.planErrorCode = '';
    state.planMeta = null;
    state.approved = false;
    state.jobs = jobsData.jobs || [];
    state.jobSignature = state.jobs.map((job) => `${job.id}:${job.status}:${job.progress}:${job.updated_at}`).join('|');
    state.scrapeUrl = state.workspace?.post?.url || '';
    state.step = 1;
    state.busy.demo = false;
    renderChrome();
    renderView({ preserveScroll: false });
    await refreshPlanInput();
    showToast('Đã nạp dữ liệu demo chó/mèo. Đây là dữ liệu mẫu, không phải Threads thật.', 'ok', 6500);
  } catch (error) {
    state.busy.demo = false;
    renderView({ preserveScroll: true });
    showToast(error.message, 'error', 7000);
  }
}

async function updateSelection(ids) {
  try {
    setBusy('selection', true);
    const data = await api('/api/workspace/selection', { method: 'PUT', json: { ids } });
    if (data.workspace) state.workspace = data.workspace;
    state.approved = Boolean(state.workspace?.approved_plan);
    state.planInput = null;
    state.inputReady = false;
    renderChrome();
    renderView({ preserveScroll: true });
  } catch (error) {
    showToast(error.message, 'error');
    await refreshWorkspace({ hydratePlan: false }).catch(() => {});
    renderView({ preserveScroll: true });
  } finally {
    setBusy('selection', false);
  }
}

async function onToggleComment(id, checked) {
  const current = selectedIds().slice();
  if (checked) {
    if (!current.includes(id)) current.push(id);
  } else {
    const index = current.indexOf(id);
    if (index >= 0) current.splice(index, 1);
  }
  await updateSelection(current);
}

async function moveComment(id, direction) {
  const current = selectedIds().slice();
  const index = current.indexOf(id);
  if (index < 0) return;
  const next = direction === 'up' ? index - 1 : index + 1;
  if (next < 0 || next >= current.length) return;
  [current[index], current[next]] = [current[next], current[index]];
  await updateSelection(current);
}

async function saveSettings() {
  const voice = document.getElementById('settingsVoice')?.value || '';
  const background = document.getElementById('settingsBackground')?.value || '';
  const watermark = document.getElementById('settingsWatermark')?.value || '';
  const target = Number(document.getElementById('settingsDuration')?.value || 60);
  try {
    setBusy('settings', true);
    const data = await api('/api/workspace/settings', {
      method: 'PUT',
      json: { voice, background_video_id: background, watermark, target_duration: target },
    });
    if (data.workspace) state.workspace = data.workspace;
    state.approved = Boolean(state.workspace?.approved_plan);
    state.planDirty = false;
    await refreshPlanInput();
    setBusy('settings', false);
    renderChrome();
    renderWorkflow();
    showToast('Đã lưu thiết lập video. Nếu có kế hoạch, hãy duyệt lại.', 'ok');
  } catch (error) {
    setBusy('settings', false);
    renderWorkflow();
    showToast(error.message, 'error');
  }
}

function createEmptyPlanErrors() {
  return [];
}

async function importPlanRaw(raw, source, { successMessage } = {}) {
  state.planErrors = createEmptyPlanErrors();
  state.planErrorMessage = '';
  state.planErrorCode = '';
  try {
    setBusy(source === 'sample' ? 'sample' : 'import', true);
    renderWorkflow();
    const data = await api('/api/plan/import', { method: 'POST', json: { raw, source } });
    state.workspace = data.workspace || state.workspace;
    state.plan = data.plan || null;
    state.planMeta = state.workspace?.plan_meta || null;
    state.planDirty = false;
    state.planErrors = [];
    state.planErrorMessage = '';
    state.planErrorCode = '';
    state.approved = false;
    state.inputReady = true;
    setBusy('sample', false);
    setBusy('import', false);
    renderChrome();
    renderWorkflow();
    showToast(successMessage || 'Đã nạp kế hoạch và validate thành công. Hãy xem/sửa rồi duyệt.', 'ok', 6000);
    window.setTimeout(() => scrollViewToElement(document.getElementById('planEditor'), 10), 80);
  } catch (error) {
    setBusy('sample', false);
    setBusy('import', false);
    state.planErrors = Array.isArray(error.details) ? error.details : [];
    state.planErrorMessage = error.message;
    state.planErrorCode = error.code;
    renderChrome();
    renderWorkflow();
    window.setTimeout(() => scrollViewToElement(document.getElementById('planValidationErrors'), 8), 80);
    showToast(error.message, 'error', 7000);
  }
}

async function importSample(invalid = false) {
  state.planErrors = [];
  state.planErrorMessage = '';
  state.planErrorCode = '';
  try {
    setBusy('sample', true);
    renderWorkflow();
    const data = await api('/api/plan/import-sample', { method: 'POST', json: { invalid } });
    state.workspace = data.workspace || state.workspace;
    state.plan = data.plan || null;
    state.planMeta = state.workspace?.plan_meta || null;
    state.planDirty = false;
    state.planErrors = [];
    state.planErrorMessage = '';
    state.planErrorCode = '';
    state.approved = false;
    setBusy('sample', false);
    renderChrome();
    renderWorkflow();
    showToast(invalid ? 'Plan lỗi đã bị chặn đúng.' : 'Đã nạp plan mẫu. Đây là dữ liệu test, không phải kết quả Muse.', invalid ? 'warn' : 'ok', 6000);
    if (!invalid) {
      window.setTimeout(() => scrollViewToElement(document.getElementById('planEditor'), 10), 80);
    }
  } catch (error) {
    setBusy('sample', false);
    state.planErrors = Array.isArray(error.details) ? error.details : [];
    state.planErrorMessage = error.message;
    state.planErrorCode = error.code;
    renderChrome();
    renderWorkflow();
    window.setTimeout(() => scrollViewToElement(document.getElementById('planValidationErrors'), 8), 80);
    showToast(error.message, 'error', 7000);
  }
}

async function importManualMuse() {
  const raw = document.getElementById('museManualResponse')?.value || state.manualResponse || '';
  if (!raw.trim()) {
    showToast('Hãy dán JSON kết quả Muse trước.', 'warn');
    return;
  }
  await importPlanRaw(raw, 'muse', { successMessage: 'Muse trả kế hoạch hợp lệ. Hãy xem/sửa rồi duyệt.' });
}

async function sendToMuse() {
  if (!inputReady()) {
    showToast('Input chưa sẵn sàng.', 'warn');
    return;
  }
  try {
    setBusy('bridge', true);
    renderWorkflow();
    const data = await api('/api/muse/bridge/send', {
      method: 'POST',
      json: { webContentsId: state.museWebviewId || null, input: state.planInput },
    });
    const raw = data.raw || '';
    state.manualResponse = raw;
    setBusy('bridge', false);
    renderWorkflow();
    if (!raw.trim()) {
      showToast('Muse không trả nội dung. Không tự tạo kết quả.', 'warn', 7000);
      return;
    }
    await importPlanRaw(raw, 'muse', { successMessage: 'Đã nhận kết quả Muse và validate. Hãy xem/sửa rồi duyệt.' });
  } catch (error) {
    setBusy('bridge', false);
    renderWorkflow();
    showToast(error.message, 'error', 8000);
  }
}

function collectPlanFromState() {
  if (!state.plan) return null;
  const plan = JSON.parse(JSON.stringify(state.plan));
  plan.hashtags = Array.isArray(plan.hashtags) ? plan.hashtags : [];
  return plan;
}

async function approvePlan() {
  const plan = collectPlanFromState();
  if (!plan) return;
  setBusy('approving', true);
  state.planErrors = [];
  state.planErrorMessage = '';
  state.planErrorCode = '';
  renderWorkflow();
  try {
    const data = await api('/api/plan/approve', { method: 'POST', json: { plan } });
    state.workspace = data.workspace || state.workspace;
    state.plan = data.plan || plan;
    state.planMeta = state.workspace?.plan_meta || state.planMeta;
    state.planDirty = false;
    state.planErrors = [];
    state.planErrorMessage = '';
    state.planErrorCode = '';
    state.approved = true;
    setBusy('approving', false);
    renderChrome();
    renderWorkflow();
    showToast('Đã duyệt kế hoạch. Bạn có thể sang hàng đợi để dựng.', 'ok', 4500);
  } catch (error) {
    setBusy('approving', false);
    state.planErrors = Array.isArray(error.details) ? error.details : [];
    state.planErrorMessage = error.message;
    state.planErrorCode = error.code;
    renderChrome();
    renderWorkflow();
    scrollViewToElement(document.getElementById('planValidationErrors'), 8);
    showToast(error.message, 'error', 7000);
  }
}

function markPlanDirtyAndUpdate() {
  state.planDirty = true;
  state.planErrorCode = '';
  state.planErrors = [];
  state.planErrorMessage = '';
  const line = document.getElementById('planStateLine');
  if (line) {
    line.className = 'stale-strip';
    line.textContent = planStateText();
  }
  const queueButton = document.getElementById('planQueueButton');
  if (queueButton) queueButton.disabled = true;
}

function updateSegmentOption(index, field, value) {
  if (!state.plan?.segments?.[index]) return;
  if (field === 'meme_duration') {
    state.plan.segments[index][field] = value === '' ? 0 : Number(value);
  } else {
    state.plan.segments[index][field] = value;
  }
  markPlanDirtyAndUpdate();
}

function moveSegment(index, direction) {
  if (!state.plan?.segments) return;
  const next = direction === 'up' ? index - 1 : index + 1;
  if (next < 0 || next >= state.plan.segments.length) return;
  [state.plan.segments[index], state.plan.segments[next]] = [state.plan.segments[next], state.plan.segments[index]];
  state.planDirty = true;
  renderWorkflow();
  const line = document.getElementById('planStateLine');
  if (line) {
    line.className = 'stale-strip';
    line.textContent = planStateText();
  }
}

async function addJob() {
  if (!hasEffectiveApproval()) {
    showToast('Kế hoạch chưa được duyệt hoặc có thay đổi chưa lưu. Hãy duyệt lại ở Bước 3.', 'warn', 6000);
    return;
  }
  try {
    setBusy('job', true);
    state.jobError = '';
    renderView({ preserveScroll: true });
    const data = await api('/api/jobs', { method: 'POST', json: {} });
    const job = data.job;
    if (job) {
      state.jobs = [job, ...state.jobs.filter((item) => item.id !== job.id)];
      state.jobSignature = '';
    }
    setBusy('job', false);
    renderChrome();
    renderView({ preserveScroll: true });
    showToast('Đã thêm job vào hàng đợi.', 'ok');
    scheduleJobsPoll(700);
  } catch (error) {
    setBusy('job', false);
    state.jobError = error.message;
    if (error.code === 'PLAN_STALE') {
      await refreshWorkspace({ hydratePlan: false }).catch(() => {});
    }
    renderChrome();
    renderView({ preserveScroll: true });
    showToast(error.message, 'error', 7000);
  }
}

async function retryJob(id) {
  try {
    const data = await api(`/api/jobs/${encodeURIComponent(id)}/retry`, { method: 'POST', json: {} });
    const job = data.job;
    if (job) state.jobs = state.jobs.map((item) => (item.id === job.id ? job : item));
    renderJobsArea();
    showToast('Đã chạy lại với đúng kế hoạch cũ. Plan không bị sửa.', 'ok', 5000);
    scheduleJobsPoll(500);
  } catch (error) {
    showToast(error.message, 'error', 6000);
  }
}

function openModal(html) {
  const host = document.getElementById('modalHost');
  if (!host) return;
  host.innerHTML = html;
  host.hidden = false;
  window.setTimeout(() => {
    const focus = host.querySelector('[autofocus]');
    if (focus) focus.focus();
  }, 30);
}

function closeModal(result = false) {
  const host = document.getElementById('modalHost');
  if (!host) return;
  const resolver = state.modalResolve;
  state.modalResolve = null;
  host.hidden = true;
  host.innerHTML = '';
  if (resolver) resolver(result);
}

function confirmDialog({ title, message, confirmLabel = 'Xác nhận', danger = false }) {
  return new Promise((resolve) => {
    state.modalResolve = resolve;
    openModal(`
      <div class="modal" style="max-width:520px">
        <div class="modal-head">
          <div><h3>${esc(title)}</h3><p>${esc(message)}</p></div>
          <button class="icon-btn" data-action="modal-cancel" title="Đóng">×</button>
        </div>
        <div class="modal-foot">
          <button class="btn" data-action="modal-cancel">Hủy</button>
          <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-action="modal-confirm">${esc(confirmLabel)}</button>
        </div>
      </div>`);
  });
}

function previewFile(id) {
  const item = libraryById(id);
  if (!item) return;
  const src = mediaUrl(item.media_url);
  let media = '';
  if (item.mediaType === 'image') media = `<img src="${esc(src)}" alt="${esc(item.name)}" />`;
  else if (item.mediaType === 'video') media = `<video src="${esc(src)}" controls preload="metadata"></video>`;
  else if (item.mediaType === 'audio') media = `<audio src="${esc(src)}" controls preload="metadata"></audio>`;
  openModal(`
    <div class="modal">
      <div class="modal-head">
        <div><h3>${esc(item.name)}</h3><p>${esc(kindLabel(item.kind))} · ${esc(fmtDuration(item.duration, item.mediaType))}</p></div>
        <button class="icon-btn" data-action="close-modal" title="Đóng">×</button>
      </div>
      <div class="modal-body">
        <div class="modal-preview">
          <div class="modal-media">${media}</div>
          <div class="modal-meta">
            <dl class="kv">
              <dt>ID</dt><dd><span class="id-pill">${esc(item.id)}</span> <button class="copy-mini" data-action="copy-id" data-id="${esc(item.id)}">copy</button></dd>
              <dt>Loại</dt><dd>${esc(kindLabel(item.kind))}</dd>
              <dt>Media</dt><dd>${esc(item.mediaType)}</dd>
              <dt>Thời lượng</dt><dd>${esc(fmtDuration(item.duration, item.mediaType))}</dd>
              <dt>Dung lượng</dt><dd>${esc(fmtBytes(item.size))}</dd>
              <dt>Tag</dt><dd>${esc((item.tags || []).join(', ') || 'chưa có')}</dd>
              <dt>Tạo lúc</dt><dd>${esc(fmtDateTime(item.createdAt))}</dd>
              ${item.demo ? '<dt>Nguồn</dt><dd>File demo</dd>' : ''}
            </dl>
            <div class="contract-note">ID này là cố định và được truyền vào kế hoạch; frontend không tự đổi tên ID.</div>
          </div>
        </div>
      </div>
      <div class="modal-foot"><button class="btn" data-action="close-modal">Đóng</button></div>
    </div>`);
}

function renameFileDialog(id) {
  const item = libraryById(id);
  if (!item) return;
  openModal(`
    <div class="modal" style="max-width:520px">
      <div class="modal-head">
        <div><h3>Đổi tên file</h3><p>ID giữ nguyên: <span class="mono-small">${esc(item.id)}</span></p></div>
        <button class="icon-btn" data-action="close-modal" title="Đóng">×</button>
      </div>
      <form data-form="rename-file" data-id="${esc(item.id)}">
        <div class="modal-body">
          <div class="field">
            <label for="renameInput">Tên hiển thị</label>
            <input class="input" id="renameInput" name="name" value="${esc(item.name)}" autofocus maxlength="160" />
          </div>
        </div>
        <div class="modal-foot">
          <button class="btn" type="button" data-action="close-modal">Hủy</button>
          <button class="btn btn-primary" type="submit">Lưu tên</button>
        </div>
      </form>
    </div>`);
}

async function renameFile(id, name) {
  try {
    const data = await api(`/api/library/${encodeURIComponent(id)}`, { method: 'PATCH', json: { name } });
    state.library = state.library.map((item) => (item.id === id ? { ...item, ...data.item } : item));
    closeModal();
    renderView({ preserveScroll: true });
    showToast('Đã đổi tên file. ID không đổi.', 'ok', 3000);
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function addTagFromInput(input) {
  const id = input?.dataset?.tagInput;
  const value = input?.value?.trim();
  if (!id || !value) return;
  const item = libraryById(id);
  if (!item) return;
  if ((item.tags || []).some((tag) => tag.toLocaleLowerCase('vi') === value.toLocaleLowerCase('vi'))) {
    showToast('Tag đã có trên file.', 'warn', 2500);
    return;
  }
  await updateTags(id, [...(item.tags || []), value]);
}

async function updateTags(id, tags) {
  try {
    const data = await api(`/api/library/${encodeURIComponent(id)}`, { method: 'PATCH', json: { tags } });
    state.library = state.library.map((item) => (item.id === id ? { ...item, ...data.item } : item));
    rebuildTagUi();
    renderView({ preserveScroll: true });
  } catch (error) {
    showToast(error.message, 'error');
  }
}

function rebuildTagUi() {
  // Tag chips in the toolbar are derived; full step 2 render is triggered by callers.
}

async function removeTag(id, tag) {
  const item = libraryById(id);
  if (!item) return;
  await updateTags(id, (item.tags || []).filter((entry) => entry !== tag));
}

async function deleteFile(id) {
  const item = libraryById(id);
  if (!item) return;
  const ok = await confirmDialog({
    title: 'Xóa file khỏi kho?',
    message: `“${item.name}” sẽ bị xóa khỏi kho. Nếu file đang được dùng trong kế hoạch/job, server sẽ chặn xóa.`,
    confirmLabel: 'Xóa file',
    danger: true,
  });
  if (!ok) return;
  try {
    await api(`/api/library/${encodeURIComponent(id)}`, { method: 'DELETE' });
    state.library = state.library.filter((entry) => entry.id !== id);
    state.libraryStats = libraryStatsFromItems();
    renderChrome();
    renderView({ preserveScroll: true });
    showToast('Đã xóa file.', 'ok');
  } catch (error) {
    showToast(error.message, 'error', 6000);
  }
}

async function uploadFiles(files, kind) {
  if (!files?.length || state.busy.upload) return;
  setBusy('upload', true);
  state.uploadStatus = `Đang tải ${files.length} file...`;
  renderView({ preserveScroll: true });
  let success = 0;
  const failures = [];
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    state.uploadStatus = `Đang tải ${index + 1}/${files.length}: ${file.name}`;
    const statusEl = document.getElementById('uploadStatus');
    if (statusEl) statusEl.textContent = state.uploadStatus;
    try {
      const params = new URLSearchParams({ kind, name: file.name, tags: '' });
      await api(`/api/library/upload?${params.toString()}`, {
        method: 'POST',
        body: file,
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
      });
      success += 1;
    } catch (error) {
      failures.push(`${file.name}: ${error.message}`);
    }
  }
  setBusy('upload', false);
  state.uploadStatus = '';
  try {
    await refreshLibrary();
  } catch {}
  renderChrome();
  renderView({ preserveScroll: true });
  if (success) showToast(`Đã thêm ${success} file vào kho.`, 'ok', 4000);
  if (failures.length) showToast(`Không tải được ${failures.length} file. ${failures[0]}`, 'error', 8000);
}

function watchJob(id) {
  const job = state.jobs.find((item) => item.id === id);
  if (!job || job.status !== 'done') return;
  openModal(`
    <div class="modal video-modal">
      <div class="modal-head">
        <div><h3>${esc(job.title)}</h3><p>${job.width}×${job.height} · ${job.fps}fps · ${Number(job.duration_seconds || 0).toFixed(0)} giây · ${esc(fmtBytes(job.output_bytes))}</p></div>
        <button class="icon-btn" data-action="close-modal" title="Đóng">×</button>
      </div>
      <div class="modal-body">
        <video controls preload="metadata" src="${esc(mediaUrl(job.output_url))}"></video>
        <div class="btn-row">
          <a class="btn btn-primary" href="${esc(downloadUrl(job.download_url))}">Tải MP4</a>
          <button class="btn" data-action="view-job-plan" data-id="${esc(job.id)}">Xem snapshot plan</button>
        </div>
        <div class="contract-note">Video được dựng từ snapshot kế hoạch tại thời điểm tạo job. Nếu job lỗi, plan được giữ nguyên.</div>
      </div>
    </div>`);
}

function viewJobPlan(id) {
  const job = state.jobs.find((item) => item.id === id);
  if (!job) return;
  const json = JSON.stringify(job.plan, null, 2);
  openModal(`
    <div class="modal">
      <div class="modal-head">
        <div><h3>Snapshot kế hoạch</h3><p>${esc(job.title)} · ${esc(job.id)}</p></div>
        <button class="icon-btn" data-action="close-modal" title="Đóng">×</button>
      </div>
      <div class="modal-body">
        <div class="btn-row">
          <span class="badge">${esc(job.status_label || job.status)}</span>
          ${planSourceBadge(job.plan_source)}
          <span class="badge">Nguồn: ${esc(planSourceLabel(job.plan_source))}</span>
          <span class="badge">Lần chạy: ${Number(job.attempts) || 0}</span>
        </div>
        <div class="code-block"><div class="code-toolbar"><span>job_plan.json</span><button class="btn btn-sm btn-ghost" data-action="copy-job-plan" data-id="${esc(job.id)}">Sao chép</button></div><pre>${esc(json)}</pre></div>
        <div class="contract-note">Job lưu bản snapshot riêng; chạy lại sẽ dùng đúng plan này, không tự sửa.</div>
      </div>
      <div class="modal-foot"><button class="btn" data-action="close-modal">Đóng</button></div>
    </div>`);
}

function showRendererInfo() {
  const renderer = state.status.renderer || {};
  openModal(`
    <div class="modal" style="max-width:600px">
      <div class="modal-head">
        <div><h3>Renderer</h3><p>Slot renderer có thể thay ở phase sau.</p></div>
        <button class="icon-btn" data-action="close-modal" title="Đóng">×</button>
      </div>
      <div class="modal-body">
        <div class="alert ${renderer.production ? 'alert-ok' : 'alert-warn'}">
          <span class="alert-icon">${renderer.production ? '✓' : '!'}</span>
          <div class="grow"><strong>${esc(renderer.label || 'Renderer demo')}</strong><div>${esc(renderer.note || 'Chưa có mô tả.')}</div></div>
        </div>
        <dl class="kv">
          <dt>Adapter</dt><dd class="mono-small">${esc(renderer.id || 'demo')}</dd>
          <dt>Production</dt><dd>${renderer.production ? 'Có' : 'Chưa — đây là bản demo'}</dd>
          <dt>Khung hình</dt><dd>576×1024 · 30fps</dd>
          <dt>Thời lượng</dt><dd>60–90 giây</dd>
        </dl>
        <div class="contract-note">
          Renderer demo dựng được nền + hook + thẻ bình luận + meme ảnh + nhạc/SFX. Chưa có giọng đọc/TTS. Renderer cuối có thể gắn vào <code>app/main/render/index.js</code>.
        </div>
      </div>
      <div class="modal-foot"><button class="btn" data-action="close-modal">Đóng</button></div>
    </div>`);
}

async function reloadMuseConfig() {
  try {
    const status = await api('/api/muse/reload', { method: 'POST', json: {} });
    state.status.muse = { ...state.status.muse, ...status };
    renderChrome();
    renderView({ preserveScroll: false });
    showToast(
      status.configured
        ? 'Đã tải lại cấu hình Muse. Hãy đăng nhập trong khung và kiểm tra.'
        : 'Cấu hình Muse vẫn chưa có muse.url hợp lệ.',
      status.configured ? 'ok' : 'warn',
      5000,
    );
  } catch (error) {
    showToast(error.message, 'error');
  }
}

function focusMuse() {
  if (state.step !== 3) {
    goStep(3);
    return;
  }
  const host = document.getElementById('museBrowserFrame');
  if (host) host.scrollIntoView({ behavior: 'smooth', block: 'center' });
  if (!isMuseConfigured()) showToast('Chưa cấu hình Muse trong config/muse_rule.json.', 'warn', 5000);
}

function toggleMuseExpand() {
  state.museExpanded = !state.museExpanded;
  const layout = document.getElementById('museLayout');
  if (layout) layout.classList.toggle('is-expanded', state.museExpanded);
  const button = document.querySelector('[data-action="toggle-muse-expand"]');
  if (button) {
    button.textContent = state.museExpanded ? '⇱' : '⇲';
    button.title = `${state.museExpanded ? 'Thu nhỏ' : 'Mở rộng'} khung Muse`;
  }
}

function onPlanTitleInput(target) {
  if (!state.plan) return;
  const field = target.dataset.planField;
  if (!field) return;
  if (field === 'hashtags') {
    state.plan.hashtags = String(target.value)
      .split(/[,\s]+/)
      .map((tag) => tag.trim())
      .filter(Boolean);
  } else {
    state.plan[field] = target.value;
  }
  markPlanDirtyAndUpdate();
}

function onSegmentFieldChange(target) {
  const index = Number(target.dataset.segmentIndex);
  const field = target.dataset.segmentField;
  if (!Number.isInteger(index) || !field) return;
  updateSegmentOption(index, field, target.value);
}

function handleDelegatedInput(event) {
  const target = event.target;
  if (target.matches('#threadsUrl')) {
    state.scrapeUrl = target.value;
    return;
  }
  if (target.matches('#discoverTopic')) {
    state.discovery.topic = target.value;
    return;
  }
  if (target.matches('#discoverLimit')) {
    state.discovery.limit = Number(target.value) || 5;
    return;
  }
  if (target.matches('#settingsDuration')) {
    const value = document.getElementById('settingsDurationValue');
    if (value) value.textContent = `${target.value}s`;
    return;
  }
  if (target.matches('#settingsVoice') || target.matches('#settingsBackground') || target.matches('#settingsWatermark')) {
    return;
  }
  if (target.matches('#uploadKind')) {
    state.uploadKind = target.value;
    return;
  }
  if (target.matches('#museManualResponse')) {
    state.manualResponse = target.value;
    return;
  }
  if (target.matches('#librarySearch')) {
    state.libraryFilter.q = target.value;
    window.clearTimeout(state.searchTimer);
    state.searchTimer = window.setTimeout(() => renderLibraryResults(), 90);
    return;
  }
  if (target.matches('[data-plan-field]')) {
    onPlanTitleInput(target);
    return;
  }
  if (target.matches('[data-segment-field]')) {
    if (target.tagName === 'SELECT' || target.type === 'number') {
      // handled on change; input can arrive first for number, keep local updated
    }
    return;
  }
}

function handleDelegatedChange(event) {
  const target = event.target;
  if (target.matches('[data-select-comment]')) {
    void onToggleComment(target.dataset.selectComment, target.checked);
    return;
  }
  if (target.matches('[data-plan-field]') || target.matches('[data-segment-field]')) {
    onPlanTitleInput(target);
    if (target.matches('[data-segment-field]')) onSegmentFieldChange(target);
    return;
  }
  if (target.matches('#uploadKind')) {
    state.uploadKind = target.value;
    return;
  }
  if (target.matches('#discoverAge')) {
    state.discovery.maxAgeHours = Number(target.value) || 72;
    return;
  }
  if (target.matches('#discoverSort')) {
    state.discovery.sort = target.value === 'recent' ? 'recent' : 'trend';
    return;
  }
  if (target.matches('#threadsMode')) {
    state.threadsMode = ['guest', 'account'].includes(target.value) ? target.value : 'auto';
    const note = document.getElementById('discoverModeNote');
    if (note) note.innerHTML = discoveryModeNoteHtml();
    const modeLine = document.getElementById('discoverModeLine');
    if (modeLine) modeLine.textContent = `Chế độ ${threadsModeLabel()}.`;
    return;
  }
  if (target.matches('[data-upload-file]')) {
    const files = Array.from(target.files || []);
    const kind = document.getElementById('uploadKind')?.value || state.uploadKind || 'meme';
    if (files.length) void uploadFiles(files, kind);
  }
}

async function onDocumentClick(event) {
  if (event.target === document.getElementById('modalHost')) {
    closeModal();
    return;
  }
  const actionEl = event.target.closest('[data-action]');
  if (!actionEl) return;
  const action = actionEl.dataset.action;
  if (!action) return;
  if (action === 'preview-file' && event.target.closest('audio, video')) return;

  if (action === 'go-step') {
    event.preventDefault();
    void goStep(Number(actionEl.dataset.step));
    return;
  }
  if (action === 'demo-load') {
    event.preventDefault();
    void demoLoad();
    return;
  }
  if (action === 'quit-app') {
    event.preventDefault();
    const ok = await confirmDialog({
      title: 'Tắt ứng dụng?',
      message: 'Job đang dựng sẽ bị gián đoạn và được đánh dấu lỗi khi mở lại; kế hoạch vẫn được giữ. Tiếp tục?',
      confirmLabel: 'Tắt ứng dụng',
      danger: true,
    });
    if (!ok) return;
    if (window.desktop?.quit) window.desktop.quit();
    else await api('/api/app/quit', { method: 'POST', json: {} }).catch(() => {});
    return;
  }
  if (action === 'open-data-folder') {
    event.preventDefault();
    if (window.desktop?.openDataFolder) await window.desktop.openDataFolder().catch(() => {});
    else await api('/api/app/open-data', { method: 'POST', json: {} }).catch(() => {});
    return;
  }
  if (action === 'show-renderer-info') {
    showRendererInfo();
    return;
  }
  if (action === 'show-plan-errors') {
    event.preventDefault();
    if (state.step !== 3) {
      await goStep(3);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    scrollViewToElement(document.getElementById('planValidationErrors'), 8);
    return;
  }
  if (action === 'open-threads-login') {
    event.preventDefault();
    await openThreadsLogin();
    return;
  }
  if (action === 'refresh-threads') {
    event.preventDefault();
    await refreshThreadsSession({ rerender: true });
    if (state.step === 1) renderView({ preserveScroll: true });
    showToast(state.threadsSession?.loggedIn ? 'Threads đã đăng nhập.' : 'Threads vẫn chưa đăng nhập.', state.threadsSession?.loggedIn ? 'ok' : 'warn', 3500);
    return;
  }
  if (action === 'refresh-status') {
    event.preventDefault();
    await refreshStatus({ quiet: false });
    showToast('Đã làm mới trạng thái.', 'ok', 2200);
    return;
  }
  if (action === 'retry-scrape') {
    event.preventDefault();
    void scrapeFromUrl(state.scrapeUrl || document.getElementById('threadsUrl')?.value || '', { mode: resolvedThreadsMode() });
    return;
  }
  if (action === 'discover-threads') {
    event.preventDefault();
    await discoverThreadsUi();
    return;
  }
  if (action === 'suggest-topic') {
    event.preventDefault();
    const topic = actionEl.dataset.topic || '';
    state.discovery.topic = topic;
    const input = document.getElementById('discoverTopic');
    if (input) {
      input.value = topic;
      input.focus();
    }
    return;
  }
  if (action === 'use-candidate') {
    event.preventDefault();
    await useCandidate(actionEl.dataset.code || '');
    return;
  }
  if (action === 'select-all-comments') {
    event.preventDefault();
    await updateSelection(allComments().map((comment) => comment.comment_id));
    return;
  }
  if (action === 'clear-comments') {
    event.preventDefault();
    await updateSelection([]);
    return;
  }
  if (action === 'move-comment-up' || action === 'move-comment-down') {
    event.preventDefault();
    await moveComment(actionEl.dataset.id, action === 'move-comment-up' ? 'up' : 'down');
    return;
  }
  if (action === 'filter-kind') {
    event.preventDefault();
    state.libraryFilter.kind = actionEl.dataset.kind || 'all';
    renderView({ preserveScroll: false });
    return;
  }
  if (action === 'filter-tag') {
    event.preventDefault();
    const tag = actionEl.dataset.tag || '';
    state.libraryFilter.tag = state.libraryFilter.tag.toLowerCase() === tag.toLowerCase() ? '' : tag;
    renderView({ preserveScroll: false });
    return;
  }
  if (action === 'clear-library-filter') {
    event.preventDefault();
    state.libraryFilter = { kind: 'all', q: '', tag: '' };
    renderView({ preserveScroll: false });
    return;
  }
  if (action === 'preview-file') {
    event.preventDefault();
    previewFile(actionEl.dataset.id);
    return;
  }
  if (action === 'copy-id') {
    event.preventDefault();
    const item = libraryById(actionEl.dataset.id);
    if (item) await copyText(item.id, 'Đã sao chép ID.');
    return;
  }
  if (action === 'rename-file') {
    event.preventDefault();
    renameFileDialog(actionEl.dataset.id);
    return;
  }
  if (action === 'delete-file') {
    event.preventDefault();
    await deleteFile(actionEl.dataset.id);
    return;
  }
  if (action === 'add-tag') {
    event.preventDefault();
    const input = actionEl.closest('.library-body')?.querySelector('[data-tag-input]');
    await addTagFromInput(input);
    return;
  }
  if (action === 'remove-tag') {
    event.preventDefault();
    await removeTag(actionEl.dataset.id, actionEl.dataset.tag);
    return;
  }
  if (action === 'save-settings') {
    event.preventDefault();
    await saveSettings();
    return;
  }
  if (action === 'copy-input') {
    event.preventDefault();
    if (state.planInput) await copyText(JSON.stringify(state.planInput, null, 2), 'Đã sao chép input JSON.');
    return;
  }
  if (action === 'download-input') {
    event.preventDefault();
    if (state.planInput) downloadText('muse_input.json', JSON.stringify(state.planInput, null, 2));
    return;
  }
  if (action === 'download-plan') {
    event.preventDefault();
    if (state.plan) downloadText('plan.json', JSON.stringify(state.plan, null, 2));
    return;
  }
  if (action === 'bridge-send') {
    event.preventDefault();
    await sendToMuse();
    return;
  }
  if (action === 'import-muse') {
    event.preventDefault();
    await importManualMuse();
    return;
  }
  if (action === 'import-sample') {
    event.preventDefault();
    await importSample(false);
    return;
  }
  if (action === 'import-invalid-sample') {
    event.preventDefault();
    await importSample(true);
    return;
  }
  if (action === 'approve-plan') {
    event.preventDefault();
    await approvePlan();
    return;
  }
  if (action === 'plan-move-up' || action === 'plan-move-down') {
    event.preventDefault();
    moveSegment(Number(actionEl.dataset.index), action === 'plan-move-up' ? 'up' : 'down');
    return;
  }
  if (action === 'config-muse') {
    event.preventDefault();
    openMuseConfigDialog();
    return;
  }
  if (action === 'open-muse-login') {
    event.preventDefault();
    await openMuseLoginUi(actionEl);
    return;
  }
  if (action === 'measure-muse-session') {
    event.preventDefault();
    await measureMuseSessionUi(actionEl);
    return;
  }
  if (action === 'apply-muse-measurement') {
    event.preventDefault();
    await applyMuseMeasurement(actionEl);
    return;
  }
  if (action === 'verify-muse') {
    event.preventDefault();
    await verifyMuse(true);
    return;
  }
  if (action === 'reload-muse-config') {
    event.preventDefault();
    await reloadMuseConfig();
    return;
  }
  if (action === 'reload-muse-page') {
    event.preventDefault();
    if (state.museWebview) {
      state.museWebview.reload();
      showToast('Đang tải lại khung Muse...', 'info', 2200);
    } else showToast('Khung Muse chưa mở.', 'warn');
    return;
  }
  if (action === 'focus-muse') {
    event.preventDefault();
    focusMuse();
    return;
  }
  if (action === 'toggle-muse-expand') {
    event.preventDefault();
    toggleMuseExpand();
    return;
  }
  if (action === 'add-job') {
    event.preventDefault();
    await addJob();
    return;
  }
  if (action === 'refresh-jobs') {
    event.preventDefault();
    await refreshJobs({ quiet: false });
    showToast('Đã làm mới hàng đợi.', 'ok', 2200);
    return;
  }
  if (action === 'job-filter') {
    event.preventDefault();
    state.jobFilter = actionEl.dataset.filter || 'all';
    renderJobsArea();
    return;
  }
  if (action === 'retry-job') {
    event.preventDefault();
    await retryJob(actionEl.dataset.id);
    return;
  }
  if (action === 'watch-job') {
    event.preventDefault();
    watchJob(actionEl.dataset.id);
    return;
  }
  if (action === 'view-job-plan') {
    event.preventDefault();
    viewJobPlan(actionEl.dataset.id);
    return;
  }
  if (action === 'copy-job-plan') {
    event.preventDefault();
    const job = state.jobs.find((item) => item.id === actionEl.dataset.id);
    if (job) await copyText(JSON.stringify(job.plan, null, 2), 'Đã sao chép snapshot plan.');
    return;
  }
  if (action === 'close-modal') {
    event.preventDefault();
    closeModal(false);
    return;
  }
  if (action === 'modal-cancel') {
    event.preventDefault();
    closeModal(false);
    return;
  }
  if (action === 'modal-confirm') {
    event.preventDefault();
    closeModal(true);
    return;
  }
}

async function onDocumentSubmit(event) {
  const form = event.target;
  if (!form.matches('form[data-form]')) return;
  event.preventDefault();
  if (form.dataset.form === 'scrape') {
    const value = new FormData(form).get('url') || document.getElementById('threadsUrl')?.value || '';
    await scrapeFromUrl(String(value), { mode: resolvedThreadsMode() });
    return;
  }
  if (form.dataset.form === 'rename-file') {
    const id = form.dataset.id;
    const name = new FormData(form).get('name') || '';
    await renameFile(id, String(name));
    return;
  }
  if (form.dataset.form === 'muse-config') {
    await saveMuseConfig(form, { keepOpen: false });
  }
}

function onDocumentKeydown(event) {
  if (event.key === 'Escape') {
    const host = document.getElementById('modalHost');
    if (host && !host.hidden) closeModal(false);
    return;
  }
  if (event.key === 'Enter' && event.target.matches('[data-tag-input]')) {
    event.preventDefault();
    void addTagFromInput(event.target);
  }
}

function setupEvents() {
  document.addEventListener('click', (event) => {
    void onDocumentClick(event);
  });
  document.addEventListener('submit', (event) => {
    void onDocumentSubmit(event);
  });
  document.addEventListener('input', handleDelegatedInput);
  document.addEventListener('change', handleDelegatedChange);
  document.addEventListener('keydown', onDocumentKeydown);
  window.addEventListener('online', () => {
    void refreshStatus({ quiet: true });
  });
  window.addEventListener('offline', () => {
    state.status.online = false;
    renderChrome();
    if (state.step === 3) updateMuseGate();
  });
}

function showBootError(message) {
  const boot = document.getElementById('boot');
  if (!boot) return;
  boot.innerHTML = `
    <div class="boot-mark">3AM</div>
    <div class="boot-title">Không khởi động được tool</div>
    <div class="boot-sub" style="max-width:520px;text-align:center;line-height:1.6">${esc(message)}</div>
    <button class="btn" id="bootRetry" style="margin-top:14px">Thử lại</button>
  `;
  document.getElementById('bootRetry')?.addEventListener('click', () => window.location.reload());
}

async function boot() {
  if (!state.token) {
    showBootError('Thiếu token phiên. Hãy mở ứng dụng 3AM Diary Studio từ shortcut thay vì mở URL trực tiếp.');
    return;
  }
  try {
    const [status, workspace, library, jobs] = await Promise.all([
      api('/api/status'),
      api('/api/workspace'),
      api('/api/library'),
      api('/api/jobs'),
    ]);
    state.status = { ...blankStatus(), ...status };
    state.threadsSession = status.threads || state.threadsSession;
    state.workspace = workspace.workspace || null;
    state.plan = state.workspace?.draft_plan || state.workspace?.approved_plan || null;
    state.planMeta = state.workspace?.plan_meta || null;
    state.approved = Boolean(state.workspace?.approved_plan);
    state.library = library.items || [];
    state.libraryStats = library.stats || libraryStatsFromItems();
    state.jobs = jobs.jobs || [];
    state.jobSignature = state.jobs.map((job) => `${job.id}:${job.status}:${job.progress}:${job.attempts}:${job.updated_at}:${job.output_file || ''}`).join('|');
    state.scrapeUrl = state.workspace?.post?.url || '';
    state.uploadKind = 'meme';

    document.getElementById('boot').hidden = true;
    const app = document.getElementById('app');
    app.hidden = false;
    setupEvents();
    state.step = 1;
    renderChrome();
    renderView({ preserveScroll: false });
    await refreshPlanInput();
    state.statusTimer = window.setInterval(() => {
      if (!document.hidden) void refreshStatus({ quiet: true });
    }, 30000);
  } catch (error) {
    showBootError(error.message || 'Không kết nối được local server.');
  }
}

void boot();
