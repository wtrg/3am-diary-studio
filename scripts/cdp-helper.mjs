import fs from 'node:fs/promises';
import path from 'node:path';

const DEBUG_URL = process.env.CDP_URL || 'http://127.0.0.1:9333';
const args = process.argv.slice(2);

function arg(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

const targets = await fetch(`${DEBUG_URL}/json/list`).then((response) => response.json());
const target =
  targets.find((entry) => entry.type === 'page' && entry.title === '3AM Diary Studio') ||
  targets.find((entry) => entry.type === 'page' && /127\.0\.0\.1:\d+\/\?token=/.test(entry.url));
if (!target) {
  console.error('No app page target found');
  process.exit(1);
}

const socket = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map();
const exceptions = [];
const consoleErrors = [];
let nextId = 1;

function send(method, params = {}) {
  const id = nextId++;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }
    }, 180000);
  });
}

await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
    return;
  }
  if (message.method === 'Runtime.exceptionThrown') {
    exceptions.push(message.params.exceptionDetails?.exception?.description || message.params.exceptionDetails?.text || 'exception');
  }
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
    consoleErrors.push(message.params.args.map((entry) => entry.value || entry.description || '').join(' '));
  }
});

await send('Runtime.enable');
await send('Page.enable');

if (args.includes('--reload')) {
  await send('Page.reload', { ignoreCache: true });
  await new Promise((resolve) => setTimeout(resolve, 2200));
}

const expression = arg('--eval');
let result = null;
if (expression) {
  try {
    const evaluation = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    result = evaluation.result?.value;
    if (evaluation.exceptionDetails) {
      result = {
        error: evaluation.exceptionDetails.exception?.description || evaluation.exceptionDetails.text,
      };
    }
  } catch (error) {
    result = { error: error.message };
  }
  console.log(JSON.stringify(result, null, 2));
}

const shot = arg('--shot');
if (shot) {
  await fs.mkdir(path.dirname(shot), { recursive: true });
  const image = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await fs.writeFile(shot, Buffer.from(image.data, 'base64'));
  console.log(`screenshot: ${shot}`);
}

const wait = Number(arg('--wait') || 300);
if (wait) await new Promise((resolve) => setTimeout(resolve, wait));

if (exceptions.length) console.log('EXCEPTIONS', JSON.stringify(exceptions, null, 2));
if (consoleErrors.length) console.log('CONSOLE_ERRORS', JSON.stringify(consoleErrors, null, 2));

socket.close();
setTimeout(() => process.exit(0), 100);
