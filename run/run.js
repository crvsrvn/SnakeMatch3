// Single entry point behind the double-click scripts in run/.
// Three modes:
//   server  start the server only (one instance per machine; a busy port is a hard error)
//   client  open the browser only (errors out if the server is down, rather than opening a
//           page that cannot connect)
//   both    start the server, wait until it actually answers, then open the browser
//   address print the URLs clients should use (local + LAN), copy the LAN one to the
//           clipboard (console text is awkward to select by hand), and say if the server is up
//   reload  ask the running server to re-read config/game.config.js and database/db.json
//           (POST /admin/reload, loopback only) and print what changed

import net from 'node:net';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
// Windows 上 import() 不接受盘符路径，必须给 file:// URL
const ENTRY = pathToFileURL(path.join(ROOT, 'server', 'index.js')).href;
// The config is imported dynamically so that `reload` still reaches the server when the
// admin has just broken the file (the server keeps its old values and reports the error).
const mode = process.argv[2] || 'both';
const PORT = await import('../config/game.config.js').then((m) => m.CONFIG.net.port, (e) => {
  if (mode !== 'reload') fail('config/game.config.js does not load:', `  ${e.message}`);
  console.log(`[run] config/game.config.js does not load (${e.message}), assuming port 3000`);
  return 3000;
});
const LOCAL_URL = `http://localhost:${PORT}`;

if (!fs.existsSync(path.join(ROOT, 'node_modules', 'express'))) {
  fail('Dependencies are not installed.', 'Run this once in the project root:  npm install');
}

if (mode === 'server') {
  await requireFreePort();
  await import(ENTRY);
} else if (mode === 'address') {
  const up = await portInUse(PORT);
  console.log(up ? '[run] server is running' : '[run] server is NOT running (start it with run/1-start-server.cmd)');
  printAddresses();
  copyToClipboard(`http://${lanAddresses()[0] || 'localhost'}:${PORT}`);
} else if (mode === 'reload') {
  if (!(await portInUse(PORT))) {
    fail(`The server is not running (nothing answers on port ${PORT}).`,
      'Nothing to reload: the next start reads the files fresh anyway.');
  }
  const r = await (await fetch(`http://127.0.0.1:${PORT}/admin/reload`, { method: 'POST' })).json();
  console.log('');
  if (r.config.error) console.log(`  config: FAILED, old values kept -> ${r.config.error}`);
  else console.log(`  config: ${r.config.changed.length ? 'changed ' + r.config.changed.join(', ') : 'unchanged'}`);
  if (r.config.needsRestart?.length) console.log(`          "${r.config.needsRestart.join(', ')}" only takes effect after a restart`);
  if (r.db.error) console.log(`  db:     FAILED, old data kept -> ${r.db.error}`);
  else console.log(`  db:     ${r.db.records} player record(s) loaded`);
  console.log('  clients: live values applied; scene-setup values (shadows, bloom, bead segments) need a page reload');
} else if (mode === 'client') {
  if (!(await portInUse(PORT))) {
    fail(`The server is not running (nothing answers on port ${PORT}).`,
      'Double-click run/1-start-server.cmd first');
  }
  printAddresses();
  openBrowser(LOCAL_URL);
} else {
  if (await portInUse(PORT)) {
    console.log('[run] server is already running, just opening the game.');
    printAddresses();
    openBrowser(LOCAL_URL);
    process.exit(0);
  }
  waitUntilUp().then(() => { printAddresses(); openBrowser(LOCAL_URL); });
  await import(ENTRY);
}

// ---------- Helpers ----------

/** One server per machine: the port is the natural lock */
async function requireFreePort() {
  if (!(await portInUse(PORT))) return;
  fail(
    `Port ${PORT} is already in use -- the server is most likely already running.`,
    'Only one server instance can run on this machine.',
    '  - To play:      double-click run/2-open-game.cmd',
    '  - To restart:   close the old server window first, then start again',
    `  - If something else owns ${PORT}: change net.port in config/game.config.js`,
  );
}

function portInUse(port) {
  return new Promise((resolve) => {
    const sock = net.createConnection({ host: '127.0.0.1', port });
    const done = (v) => { sock.destroy(); resolve(v); };
    sock.on('connect', () => done(true));
    sock.on('error', () => done(false));
    sock.setTimeout(800, () => done(false));
  });
}

async function waitUntilUp(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await portInUse(PORT)) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) if (ni.family === 'IPv4' && !ni.internal) out.push(ni.address);
  }
  return out;
}

function printAddresses() {
  console.log('');
  console.log(`  local: ${LOCAL_URL}`);
  for (const a of lanAddresses()) {
    console.log(`  LAN:   http://${a}:${PORT}   <- other devices on this network use this`);
  }
  console.log('');
}

function openBrowser(url) {
  const [cmd, args] = process.platform === 'win32'
    ? ['cmd', ['/c', 'start', '', url]]
    : process.platform === 'darwin'
      ? ['open', [url]]
      : ['xdg-open', [url]];
  try {
    spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
    console.log(`[run] opened ${url} in the default browser`);
  } catch {
    console.log(`[run] could not open a browser, please visit ${url} manually`);
  }
}

function copyToClipboard(text) {
  const [cmd, args] = process.platform === 'win32' ? ['clip', []]
    : process.platform === 'darwin' ? ['pbcopy', []] : ['xclip', ['-selection', 'clipboard']];
  try {
    const p = spawn(cmd, args, { stdio: ['pipe', 'ignore', 'ignore'] });
    p.on('error', () => console.log('[run] clipboard not available'));
    p.on('exit', (code) => { if (code === 0) console.log(`[run] copied to clipboard: ${text}`); });
    p.stdin.end(text);
  } catch {
    console.log('[run] clipboard not available');
  }
}

function fail(...lines) {
  const width = Math.max(...lines.map((l) => l.length));
  console.error('');
  console.error(`  +${'-'.repeat(width + 2)}+`);
  for (const l of lines) console.error(`  | ${l}${' '.repeat(width - l.length)} |`);
  console.error(`  +${'-'.repeat(width + 2)}+`);
  console.error('');
  process.exit(1);
}
