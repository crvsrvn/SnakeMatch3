// Build an executable that looks like "the SnakeMatch3 server".
//
// Windows Task Manager shows a name in two places, from two different sources:
//   - Details tab / Get-Process -> the image name, i.e. the file name
//   - Processes tab             -> FileDescription in the PE version resource, unrelated
//                                  to the file name
// Renaming the file alone still leaves "Node.js JavaScript Runtime" on the Processes tab.
// So we copy node.exe and rewrite its version resource and icon with rcedit -- the same
// trick Electron uses to turn electron.exe into an app name.
//
// The copy matters: a hard link shares its data with node.exe, and rewriting the resource
// would corrupt the real node.exe on the system.

import fs from 'node:fs';
import path from 'node:path';

const NAME = 'SnakeMatch3_Server';

const VERSION_INFO = {
  'version-string': {
    CompanyName: 'SnakeMatch3',
    FileDescription: 'SnakeMatch3 Server',      // this is what the Processes tab shows
    ProductName: 'SnakeMatch3 Server',
    InternalName: NAME,
    OriginalFilename: `${NAME}.exe`,
    LegalCopyright: '',
  },
  'file-version': '1.0.0.0',
  'product-version': '1.0.0.0',
};

/**
 * @returns {Promise<{exe: string, branded: boolean}>} an executable ready to run server/index.js
 */
export async function ensureServerExe(root) {
  const dir = path.join(root, '.run');
  const exe = path.join(dir, `${NAME}.exe`);
  const stampFile = path.join(dir, 'exe.stamp.json');
  const src = process.execPath;
  const srcStat = fs.statSync(src);
  const want = { src, size: srcStat.size, mtimeMs: srcStat.mtimeMs };

  // Reuse the copy while the source node.exe is unchanged, rather than copying 90MB and
  // rewriting resources on every launch
  try {
    const stamp = JSON.parse(fs.readFileSync(stampFile, 'utf8'));
    if (fs.existsSync(exe) && stamp.src === want.src
      && stamp.size === want.size && stamp.mtimeMs === want.mtimeMs) {
      return { exe, branded: !!stamp.branded };
    }
  } catch { /* missing or unreadable, rebuild */ }

  fs.mkdirSync(dir, { recursive: true });
  console.log(`[launcher] preparing ${path.relative(root, exe)} (copies node.exe, only when the Node version changes)...`);
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
    const rcedit = mod.rcedit ?? mod.default;   // v5 exports a name, older versions a default
    await rcedit(exe, icon ? { ...VERSION_INFO, icon } : VERSION_INFO);
    return true;
  } catch (e) {
    console.warn('[launcher] could not rewrite the version resource, the Processes tab will still show Node.js:', e.message);
    console.warn('[launcher] install the optional dependency to fix it: npm install --save-optional rcedit');
    return false;
  }
}

/**
 * Write a 32x32 ICO: a dark disc with one specular bead.
 * It only has to be recognisable in Task Manager, so the BMP is written by hand rather
 * than pulling in an image library.
 */
function writeIcon(file) {
  const N = 32;
  const px = new Uint8Array(N * N * 4);            // BGRA
  const put = (x, y, r, g, b, a) => {
    const i = ((N - 1 - y) * N + x) * 4;            // BMP rows run bottom-up
    px[i] = b; px[i + 1] = g; px[i + 2] = r; px[i + 3] = a;
  };
  const cx = (N - 1) / 2, cy = (N - 1) / 2, R = N / 2 - 0.5;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d > R) { put(x, y, 0, 0, 0, 0); continue; }
      const edge = Math.min(1, (R - d) / 1.5);      // a little edge antialiasing
      // Highlight at the top left fading to the bottom right, to read as a sphere
      const sh = Math.max(0, 1 - Math.hypot(x - cx * 0.62, y - cy * 0.62) / (R * 1.15));
      const spec = Math.max(0, 1 - Math.hypot(x - N * 0.34, y - N * 0.30) / (R * 0.42)) ** 2;
      const r = Math.round((26 + 60 * sh) * (1 - spec) + 255 * spec);
      const g = Math.round((150 + 90 * sh) * (1 - spec) + 255 * spec);
      const b = Math.round((200 + 55 * sh) * (1 - spec) + 255 * spec);
      put(x, y, r, g, b, Math.round(255 * edge));
    }
  }

  const maskRow = Math.ceil(N / 32) * 4;            // 1bpp AND mask, rows padded to 4 bytes
  const mask = Buffer.alloc(maskRow * N, 0);
  const dib = Buffer.alloc(40);
  dib.writeUInt32LE(40, 0);
  dib.writeInt32LE(N, 4);
  dib.writeInt32LE(N * 2, 8);                      // height includes the AND mask, so double it
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
    return null;                                    // the icon is a nicety; skip it if it fails
  }
}
