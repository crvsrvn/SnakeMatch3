// 启动器：让服务器进程在 Windows 任务管理器里显示为 SnakeMatch3_Server。
//
// 任务管理器的"名称"取自可执行文件本身，光靠 process.title 只能改控制台标题，
// 改不了映像名。所以这里把当前的 node.exe 复制（同盘时优先硬链接，不占额外空间）
// 成 .run/SnakeMatch3_Server.exe，再用它来跑服务器。
//   - 详细信息页 / Get-Process:  SnakeMatch3_Server
//   - 进程页的控制台窗口标题:     SnakeMatch3_Server（由 server/index.js 里的 process.title 设置）
//
// 非 Windows 平台或加 --plain 时直接在本进程内跑，不做任何额外处理。

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = path.join(ROOT, 'server', 'index.js');
const PROC_NAME = 'SnakeMatch3_Server';

const plain = process.argv.includes('--plain');
if (plain || process.platform !== 'win32') {
  await import(ENTRY);
} else {
  const exe = ensureRenamedExe();
  const child = spawn(exe, [ENTRY, ...process.argv.slice(2)], { stdio: 'inherit' });
  const stop = () => { if (!child.killed) child.kill(); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  child.on('exit', (code, signal) => process.exit(signal ? 1 : code ?? 0));
}

/** 返回一个名为 SnakeMatch3_Server.exe、内容等同当前 node.exe 的可执行文件 */
function ensureRenamedExe() {
  const dir = path.join(ROOT, '.run');
  const exe = path.join(dir, `${PROC_NAME}.exe`);
  const src = process.execPath;
  const srcStat = fs.statSync(src);

  try {
    const cur = fs.statSync(exe);
    // 大小与修改时间都对得上就直接复用，不必每次拷 90MB
    if (cur.size === srcStat.size && cur.mtimeMs >= srcStat.mtimeMs) return exe;
    fs.rmSync(exe, { force: true });
  } catch { /* 还没有，往下建 */ }

  fs.mkdirSync(dir, { recursive: true });
  try {
    fs.linkSync(src, exe);              // 同盘：硬链接，零额外空间
    console.log(`[启动器] 已硬链接 ${path.relative(ROOT, exe)}`);
  } catch {
    console.log(`[启动器] 正在准备 ${path.relative(ROOT, exe)}（复制 node.exe，仅首次需要）…`);
    fs.copyFileSync(src, exe);
    fs.utimesSync(exe, srcStat.atime, srcStat.mtime);
  }
  return exe;
}
