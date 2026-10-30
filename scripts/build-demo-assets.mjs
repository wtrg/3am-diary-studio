import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'demo', 'source');
const out = path.join(root, 'demo', 'assets');

function run(command, args, label) {
  const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) {
    console.error(`[FAIL] ${label}\n${result.stderr || result.stdout}`);
    process.exit(1);
  }
  console.log(`[ok] ${label}`);
}

function ensure(file) {
  if (!fs.existsSync(file)) {
    console.error(`Thiếu file nguồn: ${file}`);
    process.exit(1);
  }
}

for (const dir of ['memes', 'audio', 'background']) fs.mkdirSync(path.join(out, dir), { recursive: true });

const memes = [
  ['dog_sideeye.png', 'dog_sideeye.png'],
  ['cat_judge.png', 'cat_judge.png'],
  ['dog_blanket.png', 'dog_blanket.png'],
  ['cat_glass.png', 'cat_glass.png'],
];
for (const [input, output] of memes) {
  ensure(path.join(source, input));
  run(
    'ffmpeg',
    [
      '-y',
      '-i',
      path.join(source, input),
      '-vf',
      'scale=720:720:force_original_aspect_ratio=increase,crop=720:720',
      '-frames:v',
      '1',
      path.join(out, 'memes', output),
    ],
    `resize ${output}`,
  );
}

ensure(path.join(source, 'cozy_gameplay_bg.png'));
run(
  'ffmpeg',
  [
    '-y',
    '-loop',
    '1',
    '-i',
    path.join(source, 'cozy_gameplay_bg.png'),
    '-vf',
    "scale=760:1350:force_original_aspect_ratio=increase,crop=760:1350,zoompan=z='min(zoom+0.00035,1.10)':x='iw/2-(iw/zoom/2)+20*sin(on/90)':y='ih/2-(ih/zoom/2)':d=300:s=576x1024:fps=30,eq=brightness=-0.06:saturation=0.92,vignette=PI/5",
    '-frames:v',
    '300',
    '-an',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '25',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    path.join(out, 'background', 'cozy_gameplay.mp4'),
  ],
  'background gameplay loop (10s, 576x1024, 30fps)',
);

run(
  'ffmpeg',
  [
    '-y',
    '-loop',
    '1',
    '-i',
    path.join(source, 'dog_sideeye.png'),
    '-vf',
    "scale=900:900,zoompan=z='min(zoom+0.0015,1.18)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=120:s=576x576:fps=30",
    '-frames:v',
    '120',
    '-an',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '25',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    path.join(out, 'memes', 'dog_zoom.mp4'),
  ],
  'short meme clip (4s)',
);

function writeWav(file, seconds, sampleRate, channels, generator) {
  const frames = Math.round(seconds * sampleRate);
  const dataBytes = frames * channels * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * 2, 28);
  buffer.writeUInt16LE(channels * 2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataBytes, 40);
  let offset = 44;
  for (let frame = 0; frame < frames; frame += 1) {
    const t = frame / sampleRate;
    const values = generator(t, frame);
    for (let channel = 0; channel < channels; channel += 1) {
      const value = Math.max(-1, Math.min(1, Array.isArray(values) ? values[channel] : values));
      buffer.writeInt16LE(Math.round(value * 32767), offset);
      offset += 2;
    }
  }
  fs.writeFileSync(file, buffer);
}

const sr = 44100;
const loops = [
  [130.81, 164.81, 196.0, 246.94],
  [110.0, 146.83, 174.61, 220.0],
  [98.0, 130.81, 164.81, 196.0],
  [87.31, 130.81, 164.81, 220.0],
];
const notes = [261.63, 329.63, 392.0, 440.0, 523.25, 659.25];
writeWav(path.join(out, 'audio', 'lofi_night.wav'), 30, sr, 2, (t) => {
  const cycle = t % 7.5;
  const chord = loops[Math.floor(t / 7.5) % loops.length];
  const fade = Math.min(1, cycle / 1.2, (7.5 - cycle) / 1.2);
  const env = Math.max(0, fade);
  const bell = Math.sin(2 * Math.PI * notes[Math.floor(t / 1.875) % notes.length] * t) * 0.035 * Math.max(0, Math.sin(Math.PI * ((t % 1.875) / 1.875)));
  let left = 0;
  let right = 0;
  for (let index = 0; index < chord.length; index += 1) {
    const f = chord[index];
    const amp = 0.055 / (1 + index * 0.35);
    const lfo = 0.75 + 0.25 * Math.sin(2 * Math.PI * 0.08 * t + index);
    left += Math.sin(2 * Math.PI * f * t) * amp * env * lfo;
    right += Math.sin(2 * Math.PI * f * 1.003 * t + index * 0.1) * amp * env * lfo;
  }
  const hiss = (Math.random() * 2 - 1) * 0.004;
  const pulse = Math.sin(2 * Math.PI * 55 * t) * 0.018 * Math.max(0, Math.sin(2 * Math.PI * 0.5 * t));
  left += bell + hiss + pulse;
  right += bell * 0.85 + hiss + pulse;
  return [left, right];
});
console.log('[ok] lofi_night.wav (30s)');

writeWav(path.join(out, 'audio', 'sfx_whoosh.wav'), 0.9, sr, 1, (t) => {
  const env = Math.sin(Math.PI * Math.min(1, t / 0.9)) ** 2;
  const noise = (Math.random() * 2 - 1) * env * 0.32;
  const sweep = Math.sin(2 * Math.PI * (180 + 1300 * (t / 0.9)) * t) * env * 0.08;
  return noise + sweep;
});
writeWav(path.join(out, 'audio', 'sfx_pop.wav'), 0.35, sr, 1, (t) => {
  const env = Math.exp(-28 * t);
  return Math.sin(2 * Math.PI * 760 * t) * env * 0.5 + Math.sin(2 * Math.PI * 1520 * t) * env * 0.14;
});
console.log('[ok] SFX');

console.log('Demo assets ready at', out);
