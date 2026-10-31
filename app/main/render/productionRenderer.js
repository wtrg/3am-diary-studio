'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { captureThreadScreenshots } = require('../threads/screenshot');
const { assertScreenshotCoverage } = require('./productionGuards');
const { synthesizeVietnamese, buildNarrationText } = require('../tts');

const WIDTH = 576;
const HEIGHT = 1024;
const FPS = 30;
const INTRO_SECONDS = 2.6;
const OUTRO_SECONDS = 1.4;
const CARD_WIDTH = 528;

function ffmpegBinary() {
  return process.env.FFMPEG_PATH || 'ffmpeg';
}

function checkFfmpeg() {
  const binary = ffmpegBinary();
  let last = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = spawnSync(binary, ['-version'], { encoding: 'utf8', timeout: 10000, windowsHide: true });
    if (!result.error && result.status === 0) return;
    last = result.error || new Error(`exit ${result.status}`);
    if (attempt === 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 350);
  }
  throw new Error(
    `Không chạy được ffmpeg (${binary}): ${last?.message || 'không rõ lỗi'}. Renderer production cần ffmpeg. Kế hoạch được giữ nguyên.`,
  );
}

function allocateTimings(segments, targetDuration) {
  const usable = Math.max(segments.length * 3.5, targetDuration - INTRO_SECONDS - OUTRO_SECONDS);
  const weights = segments.map((segment) => {
    const length = String(segment.text || '').length;
    return Math.max(0.8, Math.min(2.6, 0.65 + length / 95));
  });
  const total = weights.reduce((sum, value) => sum + value, 0);
  let durations = weights.map((weight) => (weight / total) * usable);
  const minimum = Math.min(4, usable / segments.length);
  if (durations.some((value) => value < minimum)) durations = segments.map(() => usable / segments.length);
  let cursor = INTRO_SECONDS;
  return segments.map((segment, index) => {
    const start = cursor;
    cursor += durations[index];
    return { start, end: cursor, duration: durations[index] };
  });
}

function findFont(bold) {
  const candidates = bold
    ? ['C:/Windows/Fonts/arialbd.ttf', 'C:/Windows/Fonts/seguisb.ttf', 'C:/Windows/Fonts/segoeuib.ttf']
    : ['C:/Windows/Fonts/arial.ttf', 'C:/Windows/Fonts/segoeui.ttf'];
  return candidates.find((file) => fs.existsSync(file)) || null;
}

function fPath(file) {
  return String(file).replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

function wrapLines(text, max = 25) {
  const words = String(text || '').replace(/\s+/g, ' ').trim().split(' ');
  const lines = [];
  let current = '';
  for (const word of words) {
    if (!current) current = word;
    else if ((current + ' ' + word).length <= max) current += ' ' + word;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : ['3AM Diary'];
}

function isGif(asset) {
  return asset && /\.gif$/i.test(asset.file || asset.absolutePath || '');
}

function isStaticImage(asset) {
  return asset && (asset.mediaType === 'image' || /\.(png|jpe?g|webp|gif)$/i.test(asset.file || asset.absolutePath || ''));
}

function runFfmpeg(args, { cwd, duration, onProgress, appendLog }) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegBinary(), args, { cwd, windowsHide: true });
    let stdoutBuffer = '';
    let stderr = '';
    let watchdog = null;
    child.stdout.on('data', (chunk) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() || '';
      for (const line of lines) {
        const match = /^out_time_ms=(\d+)$/.exec(line.trim());
        if (match) {
          const seconds = Number(match[1]) / 1e6;
          onProgress('Đang dựng video', Math.min(98, 25 + (seconds / duration) * 73));
        }
      }
    });
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      if (stderr.length > 40000) stderr = stderr.slice(-40000);
    });
    child.on('error', (error) => reject(new Error(`Không chạy được ffmpeg: ${error.message}`)));
    child.on('close', (code) => {
      clearTimeout(watchdog);
      if (code === 0) return resolve();
      const tail = stderr.split(/\r?\n/).filter(Boolean).slice(-10).join('\n');
      appendLog(tail);
      reject(new Error(`ffmpeg thoát mã ${code}. ${tail || 'Không có log.'}`));
    });
    watchdog = setTimeout(() => {
      try { child.kill(); } catch {}
      reject(new Error('Dựng video quá lâu (>12 phút). Job dừng; kế hoạch được giữ nguyên.'));
    }, 12 * 60 * 1000);
  });
}

async function render(ctx) {
  const { plan, settings, assets, outputPath, tempDir, onProgress, appendLog, post, comments } = ctx;
  checkFfmpeg();
  const targetDuration = Math.max(60, Math.min(90, Number(settings.target_duration) || 60));
  const segments = plan.segments;
  if (!Array.isArray(segments) || !segments.length) throw new Error('Kế hoạch không có segment.');
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  const background = assetById.get(settings.background_video_id);
  const music = assetById.get(plan.music_id);
  if (!background) throw new Error('Thiếu video nền trong job. Kế hoạch được giữ nguyên.');
  if (!music) throw new Error('Thiếu nhạc nền trong job. Kế hoạch được giữ nguyên.');

  const commentById = new Map((comments || []).map((comment) => [comment.comment_id, comment]));
  const screenshotComments = [];
  for (const segment of segments) {
    const source = commentById.get(segment.comment_id);
    if (!source) throw new Error(`Thiếu bình luận nguồn ${segment.comment_id}; không thể chụp ảnh thật.`);
    screenshotComments.push({
      comment_id: segment.comment_id,
      author: source.author,
      text: source.text,
    });
  }

  const screensDir = ctx.screensDir || path.join(tempDir, 'screens');
  onProgress('Chụp ảnh post/bình luận live', 4);
  appendLog('Production: bắt đầu chụp ảnh DOM Threads cho post và từng bình luận.');
  const screenshots = await captureThreadScreenshots({
    url: post?.url,
    post,
    comments: screenshotComments,
    outputDir: screensDir,
    mode: ctx.threadsMode,
    log: (line) => appendLog(line),
  });
  if (ctx.job) {
    ctx.job.screenshots = screenshots;
    ctx.job.screenshot_count = Object.keys(screenshots.comments || {}).length + 1;
  }
  assertScreenshotCoverage(segments, screenshots);
  onProgress('Đã chụp xong; chuẩn bị ffmpeg', 22);

  let voiceTrackPath = ctx.voiceTrackPath && fs.existsSync(ctx.voiceTrackPath) ? ctx.voiceTrackPath : null;
  if (!voiceTrackPath && settings.voice_tts) {
    const narration = buildNarrationText(plan);
    if (!narration) throw new Error('Đã bật tự đọc nhưng plan không có nội dung để đọc.');
    onProgress('Tạo giọng đọc tiếng Việt (Windows TTS)', 8);
    appendLog('TTS: đang đọc nguyên văn title + bình luận bằng voice Windows vi-VN.');
    voiceTrackPath = path.join(tempDir, 'voice-tts.wav');
    await synthesizeVietnamese({ text: narration, outputPath: voiceTrackPath });
    appendLog('TTS: đã tạo file giọng đọc.');
  }

  const timings = allocateTimings(segments, targetDuration);
  const inputs = [];
  const filters = [];
  const audioLabels = [];
  inputs.push('-stream_loop', '-1', '-i', background.absolutePath); // 0
  inputs.push('-stream_loop', '-1', '-i', music.absolutePath); // 1
  let inputIndex = 2;

  filters.push(
    `[0:v]scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase,crop=${WIDTH}:${HEIGHT},setsar=1,fps=${FPS},eq=brightness=-0.06:saturation=0.95[base]`,
  );
  filters.push(`[1:a]atrim=0:${targetDuration},volume=0.20[music]`);
  audioLabels.push('[music]');

  // Post screenshot is the intro/hook card (2.6s, then hidden).
  inputs.push('-loop', '1', '-framerate', String(FPS), '-t', String(INTRO_SECONDS), '-i', screenshots.post);
  const postInput = inputIndex++;
  filters.push(
    `[${postInput}:v]scale=${CARD_WIDTH}:-2:flags=lanczos,format=rgba,fade=t=in:st=0:d=0.18:alpha=1,fade=t=out:st=${(INTRO_SECONDS - 0.25).toFixed(3)}:d=0.25:alpha=1[postcard]`,
  );
  let videoChain = 'base';
  filters.push(
    `[${videoChain}][postcard]overlay=x=(W-w)/2:y=34:enable='between(t,0,${INTRO_SECONDS})'[vpost]`,
  );
  videoChain = 'vpost';

  // Every segment uses its own live DOM screenshot, never a redrawn card.
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const timing = timings[index];
    const file = screenshots.comments[segment.comment_id];
    inputs.push(
      '-loop', '1', '-framerate', String(FPS), '-t', timing.duration.toFixed(3), '-i', file,
    );
    const imageIndex = inputIndex++;
    const cardLabel = `card${index}`;
    filters.push(
      `[${imageIndex}:v]scale=${CARD_WIDTH}:-2:flags=lanczos,format=rgba,fade=t=in:st=0:d=0.16:alpha=1,fade=t=out:st=${Math.max(0.1, timing.duration - 0.2).toFixed(3)}:d=0.2:alpha=1,setpts=PTS-STARTPTS+${timing.start.toFixed(3)}/TB[${cardLabel}]`,
    );
    const next = `vcard${index}`;
    filters.push(
      `[${videoChain}][${cardLabel}]overlay=x=(W-w)/2:y=34:enable='between(t,${timing.start.toFixed(3)},${timing.end.toFixed(3)})'[${next}]`,
    );
    videoChain = next;

    const meme = assetById.get(segment.meme_id);
    if (!meme) throw new Error(`Thiếu meme ${segment.meme_id} trong job. Kế hoạch được giữ nguyên.`);
    const memeDuration = Math.max(0.7, Math.min(Number(segment.meme_duration) || 2, timing.duration - 0.7, 5));
    const memeStart = timing.start + 0.45;
    const memeEnd = memeStart + memeDuration;
    if (isGif(meme)) {
      inputs.push('-ignore_loop', '0', '-t', memeDuration.toFixed(3), '-i', meme.absolutePath);
    } else if (isStaticImage(meme)) {
      inputs.push('-loop', '1', '-framerate', String(FPS), '-t', memeDuration.toFixed(3), '-i', meme.absolutePath);
    } else {
      inputs.push('-stream_loop', '-1', '-t', memeDuration.toFixed(3), '-i', meme.absolutePath);
    }
    const memeIndex = inputIndex++;
    const memeLabel = `meme${index}`;
    filters.push(
      `[${memeIndex}:v]scale=300:-2:force_original_aspect_ratio=decrease,format=rgba,fps=${FPS},fade=t=in:st=0:d=0.16:alpha=1,fade=t=out:st=${Math.max(0.1, memeDuration - 0.2).toFixed(3)}:d=0.2:alpha=1,setpts=PTS-STARTPTS+${memeStart.toFixed(3)}/TB[${memeLabel}]`,
    );
    const nextWithMeme = `vmeme${index}`;
    filters.push(
      `[${videoChain}][${memeLabel}]overlay=x=8:y=650:enable='between(t,${memeStart.toFixed(3)},${memeEnd.toFixed(3)})'[${nextWithMeme}]`,
    );
    videoChain = nextWithMeme;

    const sfx = assetById.get(segment.sfx_id);
    if (!sfx) throw new Error(`Thiếu SFX ${segment.sfx_id}. Kế hoạch được giữ nguyên.`);
    inputs.push('-i', sfx.absolutePath);
    const sfxIndex = inputIndex++;
    const sfxLabel = `sfx${index}`;
    const delayMs = Math.max(0, Math.round((timing.start + 0.15) * 1000));
    filters.push(`[${sfxIndex}:a]atrim=0:4,volume=0.55,adelay=${delayMs}|${delayMs}[${sfxLabel}]`);
    audioLabels.push(`[${sfxLabel}]`);
  }

  // Optional voice track from the job (TTS phase later). Never generated by this renderer.
  if (voiceTrackPath && fs.existsSync(voiceTrackPath)) {
    inputs.push('-i', voiceTrackPath);
    const voiceIndex = inputIndex++;
    filters.push(`[${voiceIndex}:a]atrim=0:${targetDuration},volume=1.0[voice]`);
    audioLabels.push('[voice]');
  }

  const watermark = String(settings.watermark || '').trim();
  if (watermark) {
    const font = findFont(true);
    if (font) {
      filters.push(
        `[${videoChain}]drawtext=fontfile='${fPath(font)}':text='${watermark.replace(/'/g, "\\'")}':fontsize=22:fontcolor=white@0.72:x=24:y=h-58:shadowcolor=black@0.8:shadowx=2:shadowy=2[wm]`,
      );
      videoChain = 'wm';
    }
  }

  // Small 3AM mark. Keep it aside from the channel watermark.
  const brandFont = findFont(true);
  if (brandFont) {
    filters.push(
      `[${videoChain}]drawtext=fontfile='${fPath(brandFont)}':text='3AM':fontsize=19:fontcolor=0xF472B6@0.75:x=w-tw-24:y=h-56:shadowcolor=black@0.8:shadowx=2:shadowy=2[vout]`,
    );
    videoChain = 'vout';
  } else {
    filters.push(`[${videoChain}]null[vout]`);
    videoChain = 'vout';
  }

  const audioMix = audioLabels.length > 1
    ? `${audioLabels.join('')}amix=inputs=${audioLabels.length}:duration=first:dropout_transition=0:normalize=0,afade=t=in:st=0:d=1.2,afade=t=out:st=${(targetDuration - 1.8).toFixed(3)}:d=1.8[aout]`
    : `${audioLabels[0]}afade=t=in:st=0:d=1.2,afade=t=out:st=${(targetDuration - 1.8).toFixed(3)}:d=1.8[aout]`;
  filters.push(audioMix);

  const filterGraph = filters.join(';\n');
  if (filterGraph.length > 30000) {
    throw new Error('Plan quá nhiều đoạn cho renderer production; giảm số bình luận dưới 12. Kế hoạch giữ nguyên.');
  }
  const args = [
    '-hide_banner',
    '-y',
    ...inputs,
    '-filter_complex',
    filterGraph,
    '-map',
    '[vout]',
    '-map',
    '[aout]',
    '-t',
    String(targetDuration),
    '-r',
    String(FPS),
    '-c:v',
    'libx264',
    '-preset',
    process.env.PRODUCTION_RENDER_PRESET || 'veryfast',
    '-crf',
    '23',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '160k',
    '-movflags',
    '+faststart',
    '-progress',
    'pipe:1',
    '-nostats',
    outputPath,
  ];
  appendLog(`Production: ${segments.length} segment, ${targetDuration}s, card ảnh thật, ${inputs.length} input.`);
  onProgress('Dựng MP4 từ ảnh chụp thật', 30);
  await runFfmpeg(args, { cwd: tempDir, duration: targetDuration, onProgress, appendLog });
  onProgress('Đóng gói MP4', 99);
  return {
    file: outputPath,
    durationSeconds: targetDuration,
    width: WIDTH,
    height: HEIGHT,
    fps: FPS,
    screenshots,
  };
}

module.exports = {
  id: 'production',
  label: 'Production · ảnh chụp Threads thật',
  production: true,
  note:
    'Chụp card post/comment trực tiếp từ DOM Threads bằng Electron, dùng ảnh PNG thật (không vẽ lại), meme ảnh/GIF, SFX, nền và nhạc. Cần GUI Electron + Threads truy cập được. Voice chỉ dùng nếu job truyền voiceTrackPath; chưa tự TTS.',
  render,
  _internals: { allocateTimings, wrapLines },
};
