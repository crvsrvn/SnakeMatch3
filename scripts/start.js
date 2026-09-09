// 启动器：在 Windows 上用一个改过名与版本资源的可执行文件来跑服务器，
// 这样任务管理器的两处名字都是 SnakeMatch3 而不是 node.exe / Node.js JavaScript Runtime。
// 具体怎么做见 scripts/serverExe.js。
//
// 非 Windows 平台或加 --plain 时直接在本进程内跑，不做任何额外处理。

import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ensureServerExe } from './serverExe.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = path.join(ROOT, 'server', 'index.js');

if (process.argv.includes('--plain') || process.platform !== 'win32') {
  await import(pathToFileURL(ENTRY).href);   // Windows 上 import() 不接受盘符绝对路径，必须是 file:// URL
} else {
  const { exe, branded } = await ensureServerExe(ROOT);
  if (!branded) console.log('[启动器] 映像名已改，但版本资源未改写（进程页仍显示 Node.js 的名字）');
  const child = spawn(exe, [ENTRY, ...process.argv.slice(2)], { stdio: 'inherit' });
  const stop = () => { if (!child.killed) child.kill(); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  child.on('exit', (code, signal) => process.exit(signal ? 1 : code ?? 0));
}
