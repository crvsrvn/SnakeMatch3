// Single entry point behind the double-click scripts in run/.
// Three modes:
//   server  start the server only (one instance per machine; a busy port is a hard error)
//   client  open the browser only (errors out if the server is down, rather than opening a
//           page that cannot connect)
//   both    start the server, wait until it actually answers, then open the browser

import net from 'node:net';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CONFIG } from '../config/game.config.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
// Windows 上 import() 不接受盘符路径，必须给 file:// URL
const ENTRY = pathToFileURL(path.join(ROOT, 'server', 'index.js')).href;
const PORT = CONFIG.net.port;
const LOCAL_URL = `http://localhost:${PORT}`;
const mode = process.argv[2] || 'both';

if (!fs.existsSync(path.join(ROOT, 'node_modules', 'express'))) {
  fail('Dependencies are not installed.', 'Run this once in the project root:  npm install');
}

if (mode === 'server') {
  await requireFreePort();
  await import(ENTRY);
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

function fail(...lines) {
  const width = Math.max(...lines.map((l) => l.length));
  console.error('');
  console.error(`  +${'-'.repeat(width + 2)}+`);
  for (const l of lines) console.error(`  | ${l}${' '.repeat(width - l.length)} |`);
  console.error(`  +${'-'.repeat(width + 2)}+`);
  console.error('');
  process.exit(1);
}
