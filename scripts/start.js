// Launcher: on Windows the server runs from a copy of node.exe with a rewritten name and
// version resource, so both places Task Manager shows a name say SnakeMatch3 instead of
// node.exe / Node.js JavaScript Runtime. See scripts/serverExe.js for how.
//
// On other platforms, or with --plain, the server just runs in this process.

import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ensureServerExe } from './serverExe.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = path.join(ROOT, 'server', 'index.js');

if (process.argv.includes('--plain') || process.platform !== 'win32') {
  await import(pathToFileURL(ENTRY).href);   // on Windows import() rejects drive-letter paths, it needs a file:// URL
} else {
  const { exe, branded } = await ensureServerExe(ROOT);
  if (!branded) console.log('[launcher] image name changed, version resource not rewritten (the Processes tab still shows the Node.js name)');
  const child = spawn(exe, [ENTRY, ...process.argv.slice(2)], { stdio: 'inherit' });
  const stop = () => { if (!child.killed) child.kill(); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  child.on('exit', (code, signal) => process.exit(signal ? 1 : code ?? 0));
}
