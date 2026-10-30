'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

function ensureDirSync(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true });
}

function readJsonSync(file, fallback) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    if (!text.trim()) return structuredClone(fallback);
    return JSON.parse(text);
  } catch (error) {
    if (error.code === 'ENOENT') return structuredClone(fallback);
    throw new Error(`Không đọc được dữ liệu ${path.basename(file)}: ${error.message}`);
  }
}

async function writeJsonAtomic(file, data) {
  await ensureDir(path.dirname(file));
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  const payload = JSON.stringify(data, null, 2);
  await fsp.writeFile(temp, payload, 'utf8');
  await fsp.rename(temp, file);
}

async function pathExists(target) {
  try {
    await fsp.access(target);
    return true;
  } catch {
    return false;
  }
}

function safeFileName(name, fallback = 'file') {
  const cleaned = String(name || '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\.+$/g, '')
    .trim()
    .slice(0, 160);
  return cleaned || fallback;
}

module.exports = {
  ensureDir,
  ensureDirSync,
  readJsonSync,
  writeJsonAtomic,
  pathExists,
  safeFileName,
};
