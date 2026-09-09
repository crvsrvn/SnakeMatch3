// run/ 里那几个双击脚本统一走这里。
// 三种模式：
//   server  只起服务器（本机只允许一个实例，端口被占就报错退出）
//   client  只打开浏览器（服务器没起就报错，不会开一个连不上的空页面）
//   both    起服务器，等它真的能连上了再打开浏览器

import net from 'node:net';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CONFIG } from '../config/game.config.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = CONFIG.net.port;
const LOCAL_URL = `http://localhost:${PORT}`;
const mode = process.argv[2] || 'both';

if (!fs.existsSync(path.join(ROOT, 'node_modules', 'express'))) {
  fail('依赖还没装好。', '请先在项目根目录运行一次：  npm install');
}

if (mode === 'server') {
  await requireFreePort();
  await import('./start.js');
} else if (mode === 'client') {
  if (!(await portInUse(PORT))) {
    fail(`服务器没有在运行（端口 ${PORT} 上没人应答）。`, '请先双击 run/1-启动服务器.cmd');
  }
  printAddresses();
  openBrowser(LOCAL_URL);
} else {
  if (await portInUse(PORT)) {
    console.log(`[run] 服务器已经在运行，直接打开游戏。`);
    printAddresses();
    openBrowser(LOCAL_URL);
    process.exit(0);
  }
  waitUntilUp().then(() => { printAddresses(); openBrowser(LOCAL_URL); });
  await import('./start.js');
}

// ---------- 工具 ----------

/** 本机只允许一个服务器实例：端口就是天然的锁 */
async function requireFreePort() {
  if (!(await portInUse(PORT))) return;
  fail(
    `端口 ${PORT} 已经被占用 —— 多半是服务器已经在运行了。`,
    '本机同时只能开一个服务器实例。',
    '  · 想进游戏：  双击 run/2-打开游戏.cmd',
    '  · 想重启：    先关掉之前那个服务器窗口，再启动',
    `  · 如果是别的程序占用了 ${PORT}：改 config/game.config.js 里的 net.port`,
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
  console.log(`  本机:   ${LOCAL_URL}`);
  for (const a of lanAddresses()) console.log(`  局域网: http://${a}:${PORT}   ← 同一网络下的其他设备用这个`);
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
    console.log(`[run] 已在默认浏览器打开 ${url}`);
  } catch {
    console.log(`[run] 打不开浏览器，请手动访问 ${url}`);
  }
}

function fail(...lines) {
  const width = Math.max(...lines.map((l) => [...l].reduce((n, c) => n + (c.charCodeAt(0) > 255 ? 2 : 1), 0)));
  console.error('');
  console.error(`  ┌${'─'.repeat(width + 2)}┐`);
  for (const l of lines) {
    const w = [...l].reduce((n, c) => n + (c.charCodeAt(0) > 255 ? 2 : 1), 0);
    console.error(`  │ ${l}${' '.repeat(width - w)} │`);
  }
  console.error(`  └${'─'.repeat(width + 2)}┘`);
  console.error('');
  process.exit(1);
}
