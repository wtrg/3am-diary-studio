'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const WIDTH = 576;
const HEIGHT = 1024;
const FPS = 30;
const INTRO_SECONDS = 2.6;
const OUTRO_SECONDS = 1.6;

function ffmpegBinary() {
  return process.env.FFMPEG_PATH || 'ffmpeg';
}

function checkFfmpeg() {
  const binary = ffmpegBinary();
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = spawnSync(binary, ['-version'], { encoding: 'utf8', timeout: 10000, windowsHide: true });
    if (!result.error && result.status === 0) return;
    lastError = result.error || new Error(`exit ${result.status}`);
    if (attempt === 0) {
      // Một số máy Windows chặn/lock lần spawn đầu khi antivirus quét binary.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 400);
    }
  }
  throw new Error(
    `Không chạy được ffmpeg (${binary}): ${lastError?.message || 'không rõ lỗi'}. Renderer demo cần ffmpeg để xuất MP4. Cài ffmpeg và thêm vào PATH (hoặc đặt FFMPEG_PATH), rồi chạy lại job. Kế hoạch vẫn được giữ nguyên.`,
  );
}

function escapeFilterText(text) {
  return String(text).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r?\n/g, ' ');
}

function wrapText(text, maxChars) {
  const words = String(text).replace(/\r\n/g, '\n').split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  for (const word of words) {
    if (!current) {
      current = word;
    } else if ((current + ' ' + word).length <= maxChars) {
      current += ' ' + word;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  if (!lines.length) lines.push('');
  return lines;
}

function formatLikes(value) {
  const number = Number(value) || 0;
  if (number >= 1000000) return `${(number / 1000000).toFixed(1).replace('.', ',')}M`;
  if (number >= 1000) return `${(number / 1000).toFixed(1).replace('.', ',')}K`;
  return String(number);
}

function formatTime(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return '';
  const pad = (number) => String(number).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())} ${pad(date.getDate())}/${pad(date.getMonth() + 1)}`;
}

function allocateTimings(segments, targetDuration) {
  const usable = Math.max(segments.length * 3, targetDuration - INTRO_SECONDS - OUTRO_SECONDS);
  const weights = segments.map((segment) => {
    const length = String(segment.text || '').length;
    return Math.max(0.8, Math.min(2.4, 0.65 + length / 100));
  });
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  let durations = weights.map((weight) => (weight / totalWeight) * usable);
  const minimum = Math.min(3.4, usable / segments.length);
  if (durations.some((duration) => duration < minimum)) {
    durations = segments.map(() => usable / segments.length);
  }
  let cursor = INTRO_SECONDS;
  return segments.map((segment, index) => {
    const start = cursor;
    cursor += durations[index];
    return { start, duration: durations[index], end: cursor };
  });
}

function findSystemFont(bold) {
  const candidates = bold
    ? ['C:/Windows/Fonts/arialbd.ttf', 'C:/Windows/Fonts/segoeuib.ttf', 'C:/Windows/Fonts/seguisb.ttf']
    : ['C:/Windows/Fonts/arial.ttf', 'C:/Windows/Fonts/segoeui.ttf'];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

async function prepareFonts(tempDir) {
  const regular = findSystemFont(false);
  const bold = findSystemFont(true);
  if (!regular) throw new Error('Không tìm thấy font hệ thống hỗ trợ tiếng Việt (Arial/Segoe UI).');
  await fsp.copyFile(regular, path.join(tempDir, 'font_regular.ttf'));
  await fsp.copyFile(bold || regular, path.join(tempDir, 'font_bold.ttf'));
  return {
    regular: 'font_regular.ttf',
    bold: bold ? 'font_bold.ttf' : 'font_regular.ttf',
  };
}

function drawTextFileFilter({ file, font, size, color, x, y, lineSpacing, alpha, box, boxColor, borderW, borderColor }) {
  const parts = [
    `fontfile=${font}`,
    `textfile=${file}`,
    'expansion=none',
    `fontsize=${size}`,
    `fontcolor=${color}`,
    `x=${x}`,
    `y=${y}`,
    `line_spacing=${lineSpacing}`,
    'shadowcolor=black@0.7',
    'shadowx=2',
    'shadowy=2',
  ];
  if (alpha !== undefined) parts.push(`alpha='${alpha}'`);
  if (borderW) parts.push(`borderw=${borderW}`, `bordercolor=${borderColor || 'black@0.8'}`);
  if (box) parts.push('box=1', `boxcolor=${boxColor || 'black@0.55'}`, `boxborderw=${box}`);
  return `drawtext=${parts.join(':')}`;
}

function drawStaticFilter({ text, font, size, color, x, y, box, boxColor, boxBorder, borderW, borderColor, enable }) {
  const parts = [
    `fontfile=${font}`,
    `text='${escapeFilterText(text)}'`,
    `fontsize=${size}`,
    `fontcolor=${color}`,
    `x=${x}`,
    `y=${y}`,
    'shadowcolor=black@0.8',
    'shadowx=2',
    'shadowy=2',
  ];
  if (box) parts.push('box=1', `boxcolor=${boxColor || 'black@0.5'}`, `boxborderw=${boxBorder ?? 12}`);
  if (borderW) parts.push(`borderw=${borderW}`, `bordercolor=${borderColor || 'black@0.8'}`);
  if (enable) parts.push(`enable='${enable}'`);
  return `drawtext=${parts.join(':')}`;
}

function pickTextStyle(text) {
  const length = String(text || '').length;
  if (length <= 100) return { fontSize: 32, maxChars: 27, lineHeight: 39 };
  if (length <= 230) return { fontSize: 28, maxChars: 31, lineHeight: 35 };
  return { fontSize: 23, maxChars: 37, lineHeight: 30 };
}

function colorForIndex(index) {
  const palette = ['0x8B5CF6', '0xEC4899', '0x22D3EE', '0xF59E0B', '0x34D399'];
  return palette[index % palette.length];
}

async function render(ctx) {
  const { plan, settings, assets, outputPath, tempDir, onProgress, appendLog } = ctx;
  checkFfmpeg();
  onProgress('Chuẩn bị media', 4);

  const targetDuration = Math.max(60, Math.min(90, Number(settings.target_duration) || 60));
  const segments = plan.segments;
  if (!Array.isArray(segments) || !segments.length) throw new Error('Kế hoạch không có segment.');
  const timings = allocateTimings(segments, targetDuration);
  const fonts = await prepareFonts(tempDir);

  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  const commentById = new Map((ctx.comments || []).map((comment) => [comment.comment_id, comment]));
  const background = assetById.get(settings.background_video_id || '');
  if (!background) throw new Error('Thiếu video nền trong job. Kế hoạch được giữ nguyên.');
  const music = assetById.get(plan.music_id);
  if (!music) throw new Error('Thiếu nhạc nền trong job. Kế hoạch được giữ nguyên.');

  const inputs = [];
  const filterParts = [];
  const cleanup = [];
  const writeText = async (name, content) => {
    await fsp.writeFile(path.join(tempDir, name), content, 'utf8');
    return name;
  };

  inputs.push('-stream_loop', '-1', '-i', background.absolutePath);
  inputs.push('-stream_loop', '-1', '-i', music.absolutePath);

  filterParts.push(
    `[0:v]scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase,crop=${WIDTH}:${HEIGHT},setsar=1,fps=${FPS},eq=brightness=-0.12:saturation=0.92[base]`,
  );

  const audioLabels = [];
  filterParts.push(`[1:a]atrim=0:${targetDuration},volume=0.20[music]`);
  audioLabels.push('[music]');

  const memes = [];
  let inputIndex = 2;
  if (ctx.voiceTrackPath && fs.existsSync(ctx.voiceTrackPath)) {
    inputs.push('-i', ctx.voiceTrackPath);
    filterParts.push(`[${inputIndex}:a]atrim=0:${targetDuration},volume=1.0[voice]`);
    audioLabels.push('[voice]');
    inputIndex += 1;
  }
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const asset = assetById.get(segment.meme_id);
    if (!asset) throw new Error(`Không tìm thấy meme ${segment.meme_id} trong job. Kế hoạch được giữ nguyên.`);
    if (asset.mediaType !== 'image') {
      throw new Error(
        `Renderer demo chưa hỗ trợ meme dạng clip (${asset.name}). Hãy chọn meme ảnh cho bản demo hoặc gắn renderer cuối cùng. Kế hoạch được giữ nguyên.`,
      );
    }
    const timing = timings[index];
    const overlayDuration = Math.max(0.8, Math.min(Number(segment.meme_duration) || 2, timing.duration - 0.8, 5));
    const overlayStart = timing.start + 0.45;
    inputs.push('-loop', '1', '-framerate', String(FPS), '-t', overlayDuration.toFixed(3), '-i', asset.absolutePath);
    const memeLabel = `m${index}`;
    filterParts.push(
      `[${inputIndex}:v]scale=400:400:force_original_aspect_ratio=decrease,pad=412:412:(ow-iw)/2:(oh-ih)/2:color=white@0.9,format=rgba,fade=t=in:st=0:d=0.18:alpha=1,fade=t=out:st=${Math.max(0.1, overlayDuration - 0.24).toFixed(3)}:d=0.24:alpha=1,setpts=PTS-STARTPTS+${overlayStart.toFixed(3)}/TB[${memeLabel}]`,
    );
    memes.push({ label: memeLabel, start: overlayStart, end: overlayStart + overlayDuration });
    inputIndex += 1;
  }

  let videoChain = 'base';
  memes.forEach((meme, index) => {
    const next = `v${index + 1}`;
    filterParts.push(
      `[${videoChain}][${meme.label}]overlay=82:76:enable='between(t,${meme.start.toFixed(3)},${meme.end.toFixed(3)})':eof_action=pass:shortest=0[${next}]`,
    );
    videoChain = next;
  });

  // Header / hook title card
  const titleLines = wrapText(plan.title, 19);
  const titleLineHeight = 61;
  const titleFont = titleLines.length > 3 ? 42 : 48;
  const titleHeight = titleLines.length * titleLineHeight + 98;
  const titleTop = Math.max(120, 380 - titleHeight / 2);
  const titleFile = await writeText('title.txt', titleLines.join('\n'));
  filterParts.push(
    `[${videoChain}]drawbox=x=24:y=${titleTop}:w=${WIDTH - 48}:h=${titleHeight}:color=black@0.67:t=fill:enable='between(t,0,${INTRO_SECONDS})'[th0]`,
  );
  videoChain = 'th0';
  filterParts.push(
    `[${videoChain}]drawbox=x=24:y=${titleTop}:w=8:h=${titleHeight}:color=0xEC4899@0.95:t=fill:enable='between(t,0,${INTRO_SECONDS})'[th1]`,
  );
  videoChain = 'th1';
  filterParts.push(
    `[${videoChain}]${drawTextFileFilter({
      file: titleFile,
      font: fonts.bold,
      size: titleFont,
      color: 'white',
      x: '(w-text_w)/2',
      y: String(titleTop + 50),
      lineSpacing: 10,
      alpha: `if(lt(t,0.35),t/0.35,if(gt(t,${INTRO_SECONDS - 0.3}),(${INTRO_SECONDS}-t)/0.3,1))`,
    })}[th2]`,
  );
  videoChain = 'th2';
  filterParts.push(
    `[${videoChain}]${drawStaticFilter({
      text: '3AM DIARY',
      font: fonts.bold,
      size: 22,
      color: '0xF9A8D4',
      x: '(w-text_w)/2',
      y: String(titleTop - 42),
      box: true,
      boxColor: 'black@0.55',
      boxBorder: 10,
      enable: `between(t,0,${INTRO_SECONDS})`,
    })}[th3]`,
  );
  videoChain = 'th3';

  // Comment cards
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const timing = timings[index];
    const style = pickTextStyle(segment.text);
    const lines = wrapText(segment.text, style.maxChars);
    const cardHeight = Math.min(468, 122 + lines.length * style.lineHeight);
    let cardTop = 926 - cardHeight;
    if (cardTop < 448) cardTop = 448;
    const commentMeta = commentById.get(segment.comment_id) || {};
    const author = String(commentMeta.author || '').trim();
    const metaLine = `${author ? `@${author.replace(/^@/, '')}` : 'Threads'}   ·   ${formatLikes(commentMeta.likes)} lượt thích${formatTime(commentMeta.time) ? `   ·   ${formatTime(commentMeta.time)}` : ''}`;
    const metaFile = await writeText(`meta-${index}.txt`, metaLine);
    const bodyFile = await writeText(`body-${index}.txt`, lines.join('\n'));
    const accent = colorForIndex(index);
    const enable = `between(t,${timing.start.toFixed(3)},${timing.end.toFixed(3)})`;
    const fadeAlpha = `if(lt(t,${timing.start.toFixed(3)}),0,if(lt(t,${(timing.start + 0.25).toFixed(3)}),(t-${timing.start.toFixed(3)})/0.25,if(gt(t,${(timing.end - 0.22).toFixed(3)}),(${timing.end.toFixed(3)}-t)/0.22,1)))`;

    const boxLabel = `c${index}a`;
    filterParts.push(
      `[${videoChain}]drawbox=x=24:y=${cardTop}:w=${WIDTH - 48}:h=${cardHeight}:color=black@0.70:t=fill:enable='${enable}'[${boxLabel}]`,
    );
    videoChain = boxLabel;
    const accentLabel = `c${index}b`;
    filterParts.push(
      `[${videoChain}]drawbox=x=24:y=${cardTop}:w=7:h=${cardHeight}:color=${accent}@0.95:t=fill:enable='${enable}'[${accentLabel}]`,
    );
    videoChain = accentLabel;
    const metaLabel = `c${index}c`;
    filterParts.push(
      `[${videoChain}]${drawTextFileFilter({
        file: metaFile,
        font: fonts.bold,
        size: 20,
        color: '0xE9D5FF',
        x: '48',
        y: String(cardTop + 26),
        lineSpacing: 4,
        alpha: fadeAlpha,
      })}[${metaLabel}]`,
    );
    videoChain = metaLabel;
    const bodyLabel = `c${index}d`;
    filterParts.push(
      `[${videoChain}]${drawTextFileFilter({
        file: bodyFile,
        font: fonts.regular,
        size: style.fontSize,
        color: 'white',
        x: '48',
        y: String(cardTop + 72),
        lineSpacing: style.lineHeight - style.fontSize,
        alpha: fadeAlpha,
      })}[${bodyLabel}]`,
    );
    videoChain = bodyLabel;
    const progressLabel = `c${index}e`;
    const progressWidth = (WIDTH - 48) * ((index + 1) / segments.length);
    filterParts.push(
      `[${videoChain}]drawbox=x=24:y=${cardTop + cardHeight - 5}:w=${progressWidth.toFixed(1)}:h=5:color=${accent}@0.8:t=fill:enable='${enable}'[${progressLabel}]`,
    );
    videoChain = progressLabel;
  }

  // Watermark
  const watermarkFile = await writeText('watermark.txt', String(settings.watermark || '').slice(0, 120));
  filterParts.push(
    `[${videoChain}]${drawTextFileFilter({
      file: watermarkFile,
      font: fonts.bold,
      size: 24,
      color: 'white@0.65',
      x: '28',
      y: String(HEIGHT - 70),
      lineSpacing: 4,
    })}[wm]`,
  );
  videoChain = 'wm';

  // Small bug/logo bottom-right
  filterParts.push(
    `[${videoChain}]${drawStaticFilter({
      text: '3AM',
      font: fonts.bold,
      size: 20,
      color: 'white@0.38',
      x: String(WIDTH - 82),
      y: String(HEIGHT - 66),
    })}[vout]`,
  );

  // SFX
  let sfxCount = 0;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const asset = assetById.get(segment.sfx_id);
    if (!asset) throw new Error(`Không tìm thấy SFX ${segment.sfx_id}. Kế hoạch được giữ nguyên.`);
    if (asset.mediaType === 'image') throw new Error('SFX không hợp lệ.');
    inputs.push('-i', asset.absolutePath);
    const delayMs = Math.max(0, Math.round((timings[index].start + 0.15) * 1000));
    const label = `s${sfxCount}`;
    filterParts.push(
      `[${inputIndex}:a]atrim=0:4,volume=0.55,adelay=${delayMs}|${delayMs}[${label}]`,
    );
    audioLabels.push(`[${label}]`);
    inputIndex += 1;
    sfxCount += 1;
  }

  if (audioLabels.length > 1) {
    filterParts.push(
      `${audioLabels.join('')}amix=inputs=${audioLabels.length}:duration=first:dropout_transition=0:normalize=0,afade=t=in:st=0:d=1.2,afade=t=out:st=${(targetDuration - 1.8).toFixed(3)}:d=1.8[aout]`,
    );
  } else {
    filterParts.push(
      `[music]afade=t=in:st=0:d=1.2,afade=t=out:st=${(targetDuration - 1.8).toFixed(3)}:d=1.8[aout]`,
    );
  }

  const filterGraph = filterParts.join(';\n');
  if (filterGraph.length > 30000) {
    throw new Error(
      `Plan có ${segments.length} đoạn tạo filter quá dài cho renderer demo. Hãy giảm số bình luận (dưới 12 đoạn) cho bản demo; kế hoạch được giữ nguyên.`,
    );
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
    process.env.DEMO_RENDER_PRESET || 'veryfast',
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

  onProgress('Render khung hình + âm thanh', 10);
  appendLog(`ffmpeg target ${targetDuration}s, ${segments.length} segments`);
  await new Promise((resolve, reject) => {
    const child = spawn(ffmpegBinary(), args, { cwd: tempDir, windowsHide: true });
    let stderr = '';
    let stdoutBuffer = '';
    let killed = false;
    child.stdout.on('data', (chunk) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() || '';
      for (const line of lines) {
        const match = /^out_time_ms=(\d+)$/.exec(line.trim());
        if (match) {
          const seconds = Number(match[1]) / 1e6;
          const progress = Math.max(10, Math.min(98, 10 + (seconds / targetDuration) * 88));
          onProgress('Đang dựng video', progress);
        }
      }
    });
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      if (stderr.length > 40000) stderr = stderr.slice(-40000);
    });
    child.on('error', (error) => {
      reject(new Error(`Không chạy được ffmpeg: ${error.message}`));
    });
    child.on('close', (code) => {
      if (killed) return;
      if (code === 0) return resolve();
      const tail = stderr
        .split(/\r?\n/)
        .filter(Boolean)
        .slice(-8)
        .join('\n');
      appendLog(tail);
      reject(new Error(`ffmpeg thoát với mã ${code}. ${tail || 'Không có log.'}`));
    });
    const watchdog = setTimeout(() => {
      killed = true;
      child.kill();
      reject(new Error('Dựng video quá lâu (>12 phút). Job dừng; kế hoạch được giữ nguyên.'));
    }, 12 * 60 * 1000);
    child.on('close', () => clearTimeout(watchdog));
  });

  onProgress('Đóng gói MP4', 99);
  return { file: outputPath, durationSeconds: targetDuration, width: WIDTH, height: HEIGHT, fps: FPS };
}

module.exports = {
  id: 'demo',
  label: 'Renderer demo (ffmpeg)',
  production: false,
  note: 'Bản demo dựng MP4 576x1024@30fps từ plan: nền + hook + thẻ bình luận + meme ảnh + nhạc/SFX. Chưa có giọng đọc và chưa phải renderer cuối cùng. Gắn renderer cuối trong app/main/render/index.js.',
  render,
  _internals: { wrapText, allocateTimings, formatLikes, pickTextStyle },
};
