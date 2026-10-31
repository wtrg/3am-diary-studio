'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');

const PS1 = path.join(__dirname, 'windowsTts.ps1');
const POWERSHELL = process.env.POWERSHELL_PATH || 'powershell.exe';

function buildNarrationText(plan) {
  const title = String(plan?.title || '').trim();
  const segments = Array.isArray(plan?.segments) ? plan.segments : [];
  const parts = [];
  if (title) parts.push(title);
  for (const segment of segments) {
    const text = String(segment?.text || '').trim();
    if (text) parts.push(text);
  }
  return parts.join('\n\n');
}

function ttsAvailable() {
  return process.platform === 'win32' && fs.existsSync(PS1);
}

async function synthesizeVietnamese({ text, outputPath, language = 'vi-VN', timeoutMs = 90000 }) {
  if (!ttsAvailable()) {
    throw new Error('Windows TTS không khả dụng trên máy này. Hãy tắt tự đọc hoặc dùng file giọng đọc.');
  }
  if (!String(text || '').trim()) throw new Error('Không có nội dung để đọc bằng TTS.');
  if (!outputPath) throw new Error('Thiếu đường dẫn file TTS.');
  await fsp.mkdir(path.dirname(outputPath), { recursive: true });
  const textPath = `${outputPath}.txt`;
  await fsp.writeFile(textPath, String(text), 'utf8');
  return new Promise((resolve, reject) => {
    const child = spawn(
      POWERSHELL,
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        PS1,
        '-TextFile',
        textPath,
        '-OutputFile',
        outputPath,
        '-Language',
        language,
      ],
      { windowsHide: true },
    );
    let stderr = '';
    let stdout = '';
    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
    }, timeoutMs);
    child.stdout.on('data', (chunk) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk) => (stderr += chunk.toString()));
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(new Error(`Không chạy được Windows TTS: ${error.message}`));
    });
    child.on('close', async (code) => {
      clearTimeout(timer);
      await fsp.unlink(textPath).catch(() => {});
      let size = 0;
      try { size = (await fsp.stat(outputPath)).size; } catch {}
      if (code === 0 && size > 44) {
        resolve({ file: outputPath, bytes: size, stdout: stdout.trim() });
        return;
      }
      reject(
        new Error(
          `Windows TTS thất bại (${stderr.trim() || `exit ${code}`}). Không tự tạo voice khác; hãy tắt tự đọc hoặc dùng file giọng đọc.`,
        ),
      );
    });
  });
}

module.exports = { buildNarrationText, synthesizeVietnamese, ttsAvailable };
