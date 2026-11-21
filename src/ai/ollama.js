const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const log = require('../logger');

// Mail Scanner runs its own Ollama server instead of using the one you may
// already have. That way the models it downloads always go to the folder in
// its settings (OLLAMA_MODELS), and your normal Ollama setup is left alone.
const HOST = '127.0.0.1:11435';
const BASE = `http://${HOST}`;
const START_TIMEOUT_MS = 30 * 1000;
const REQUEST_TIMEOUT_MS = 2 * 60 * 1000; // first call includes loading the model

let child = null;
let childDir = null;

// Finds ollama(.exe): the configured path, then PATH, then the usual install folders.
function findExecutable(configured) {
  const exe = process.platform === 'win32' ? 'ollama.exe' : 'ollama';
  const candidates = [];
  if (configured) candidates.push(configured);
  try {
    const lookup = process.platform === 'win32' ? 'where.exe' : 'which';
    const found = execFileSync(lookup, ['ollama'], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
    candidates.push(...found.split(/\r?\n/).map((s) => s.trim()).filter(Boolean));
  } catch { /* not on PATH */ }
  if (process.platform === 'win32') {
    candidates.push(path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Ollama', exe));
  } else {
    candidates.push('/usr/local/bin/ollama', '/opt/homebrew/bin/ollama', '/usr/bin/ollama');
  }
  return candidates.find((p) => p && p.toLowerCase().endsWith(exe) && fs.existsSync(p)) || null;
}

async function ping() {
  try {
    const res = await fetch(`${BASE}/api/version`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Starts the private server if it isn't running. Throws a friendly error when
// Ollama isn't installed or won't start.
async function ensureServer({ ollamaPath, modelsDir }) {
  if (child && childDir !== modelsDir) await stop(); // models folder changed
  if (await ping()) return;

  const exe = findExecutable(ollamaPath);
  if (!exe) {
    const err = new Error('Ollama is not installed. Get it from ollama.com, then press Retry.');
    err.code = 'NO_OLLAMA';
    throw err;
  }
  if (modelsDir) fs.mkdirSync(modelsDir, { recursive: true });

  const env = { ...process.env, OLLAMA_HOST: HOST };
  delete env.OLLAMA_CONTEXT_LENGTH; // your global Ollama setting shouldn't change Laya's
  // Always absolute: a relative folder would land wherever the app was started from.
  if (modelsDir) env.OLLAMA_MODELS = path.resolve(modelsDir);

  log.info('Starting the private Ollama server');
  child = spawn(exe, ['serve'], { env, windowsHide: true, stdio: 'ignore' });
  childDir = modelsDir;
  child.on('exit', (code) => {
    log.info(`Private Ollama server exited (${code})`);
    child = null;
  });
  child.on('error', (err) => log.error('Could not start Ollama', err));

  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await ping()) return;
    if (!child) break;
    await wait(500);
  }
  throw new Error('Ollama did not start. Check that it is installed correctly, then press Retry.');
}

async function stop() {
  if (!child) return;
  const c = child;
  child = null;
  try { c.kill(); } catch { /* already gone */ }
  await wait(300);
}

const withTag = (name) => (name.includes(':') ? name : `${name}:latest`);

async function hasModel(model) {
  const res = await fetch(`${BASE}/api/tags`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`Ollama answered ${res.status}`);
  const { models = [] } = await res.json();
  return models.some((m) => withTag(m.name) === withTag(model));
}

// Downloads a model into the private server's models folder.
// onProgress(fraction 0..1 or null, statusText)
async function pull(model, onProgress) {
  const res = await fetch(`${BASE}/api/pull`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, stream: true })
  });
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`);

  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let newline;
    while ((newline = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      const event = JSON.parse(line);
      if (event.error) throw new Error(event.error);
      const fraction = event.total && Number.isFinite(event.completed) ? event.completed / event.total : null;
      onProgress(fraction, event.status || '');
    }
  }
}

// Asks a decision model (Laya) typed questions about one piece of text.
//   state:     the text to judge
//   questions: { id: { type: 'noul'|'choice'|'score', instructions, criteria? } }
// Resolves to the answers object, keyed by question id.
async function decide({ model, state, questions }) {
  const res = await fetch(`${BASE}/v1/systemone`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    body: JSON.stringify({ model, state, questions, keep_alive: '10m' })
  });
  if (!res.ok) throw new Error(`Laya answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return data.answers || {};
}

module.exports = { ensureServer, stop, hasModel, pull, decide, findExecutable, HOST };
