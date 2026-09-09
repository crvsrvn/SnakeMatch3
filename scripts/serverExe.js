// 生成一个"看起来就是 SnakeMatch3 服务器"的可执行文件。
//
// Windows 任务管理器有两处名字，来源不同：
//   · 详细信息页 / Get-Process  -> 映像名，取自文件名本身
//   · 进程页                    -> PE 版本资源里的 FileDescription，跟文件名无关
// 只改文件名的话，进程页仍然显示 "Node.js JavaScript Runtime"。
// 所以这里复制一份 node.exe，再用 rcedit 改写它的版本资源与图标 ——
// 这正是 Electron 把 electron.exe 变成自家应用名的做法。
//
// 注意：一定要复制，不能用硬链接。硬链接和 node.exe 共享同一份数据，
// 改资源会把系统里真正的 node.exe 一起改坏。

import fs from 'node:fs';
import path from 'node:path';

const NAME = 'SnakeMatch3_Server';

const VERSION_INFO = {
  'version-string': {
    CompanyName: 'SnakeMatch3',
    FileDescription: 'SnakeMatch3 Server',      // 进程页显示的就是这一条
    ProductName: 'SnakeMatch3 Server',
    InternalName: NAME,
    OriginalFilename: `${NAME}.exe`,
    LegalCopyright: '',
  },
  'file-version': '1.0.0.0',
  'product-version': '1.0.0.0',
};

/**
 * @returns {Promise<{exe: string, branded: boolean}>} 可直接用来跑 server/index.js 的可执行文件
 */
export async function ensureServerExe(root) {
  const dir = path.join(root, '.run');
  const exe = path.join(dir, `${NAME}.exe`);
  const stampFile = path.join(dir, 'exe.stamp.json');
  const src = process.execPath;
  const srcStat = fs.statSync(src);
  const want = { src, size: srcStat.size, mtimeMs: srcStat.mtimeMs };

  // 源 node.exe 没变就直接复用，不必每次拷 90MB + 重写资源
  try {
    const stamp = JSON.parse(fs.readFileSync(stampFile, 'utf8'));
    if (fs.existsSync(exe) && stamp.src === want.src
      && stamp.size === want.size && stamp.mtimeMs === want.mtimeMs) {
      return { exe, branded: !!stamp.branded };
    }
  } catch { /* 没有或读坏了，重建 */ }

  fs.mkdirSync(dir, { recursive: true });
  console.log(`[启动器] 准备 ${path.relative(root, exe)}（复制 node.exe，仅在 Node 版本变化时发生）…`);
  fs.rmSync(exe, { force: true });
  fs.copyFileSync(src, exe);

  const icon = writeIcon(path.join(dir, `${NAME}.ico`));
  const branded = await brand(exe, icon);
  fs.writeFileSync(stampFile, JSON.stringify({ ...want, branded }, null, 2));
  return { exe, branded };
}

async function brand(exe, icon) {
  try {
    const mod = await import('rcedit');
    const rcedit = mod.rcedit ?? mod.default;   // v5 具名导出，旧版是默认导出
    await rcedit(exe, icon ? { ...VERSION_INFO, icon } : VERSION_INFO);
    return true;
  } catch (e) {
    console.warn('[启动器] 改写版本资源失败，进程页仍会显示 Node.js 的名字：', e.message);
    console.warn('[启动器] 装上可选依赖即可修复：npm install --save-optional rcedit');
    return false;
  }
}

/**
 * 写一枚 32×32 的 ICO：深色圆底 + 一颗高光珠子。
 * 只为了在任务管理器里一眼认出来，所以直接手写 BMP 位图，不引入图形库。
 */
function writeIcon(file) {
  const N = 32;
  const px = new Uint8Array(N * N * 4);            // BGRA
  const put = (x, y, r, g, b, a) => {
    const i = ((N - 1 - y) * N + x) * 4;            // BMP 是自下而上
    px[i] = b; px[i + 1] = g; px[i + 2] = r; px[i + 3] = a;
  };
  const cx = (N - 1) / 2, cy = (N - 1) / 2, R = N / 2 - 0.5;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d > R) { put(x, y, 0, 0, 0, 0); continue; }
      const edge = Math.min(1, (R - d) / 1.5);      // 边缘一点抗锯齿
      // 左上高光 -> 右下变暗的球面感
      const sh = Math.max(0, 1 - Math.hypot(x - cx * 0.62, y - cy * 0.62) / (R * 1.15));
      const spec = Math.max(0, 1 - Math.hypot(x - N * 0.34, y - N * 0.30) / (R * 0.42)) ** 2;
      const r = Math.round((26 + 60 * sh) * (1 - spec) + 255 * spec);
      const g = Math.round((150 + 90 * sh) * (1 - spec) + 255 * spec);
      const b = Math.round((200 + 55 * sh) * (1 - spec) + 255 * spec);
      put(x, y, r, g, b, Math.round(255 * edge));
    }
  }

  const maskRow = Math.ceil(N / 32) * 4;            // 1bpp AND 掩码，行按 4 字节对齐
  const mask = Buffer.alloc(maskRow * N, 0);
  const dib = Buffer.alloc(40);
  dib.writeUInt32LE(40, 0);
  dib.writeInt32LE(N, 4);
  dib.writeInt32LE(N * 2, 8);                      // 高度含 AND 掩码，要写两倍
  dib.writeUInt16LE(1, 12);
  dib.writeUInt16LE(32, 14);
  dib.writeUInt32LE(px.length + mask.length, 20);

  const image = Buffer.concat([dib, Buffer.from(px), mask]);
  const dirEntry = Buffer.alloc(16);
  dirEntry[0] = N; dirEntry[1] = N;
  dirEntry.writeUInt16LE(1, 4);
  dirEntry.writeUInt16LE(32, 6);
  dirEntry.writeUInt32LE(image.length, 8);
  dirEntry.writeUInt32LE(6 + 16, 12);
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);

  try {
    fs.writeFileSync(file, Buffer.concat([header, dirEntry, image]));
    return file;
  } catch {
    return null;                                    // 图标只是锦上添花，写不出来就算了
  }
}
