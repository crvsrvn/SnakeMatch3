// 环面(上下左右穿越)几何与通用数学工具，服务端与客户端共用。

export function wrap(v, size) {
  const r = v % size;
  return r < 0 ? r + size : r;
}

/** 从 from 到 to 的最短环面增量，结果落在 [-size/2, size/2) */
export function toroidalDelta(from, to, size) {
  let d = to - from;
  const h = size * 0.5;
  if (d > h) d -= size;
  else if (d < -h) d += size;
  return d;
}

export function toroidalDist2(ax, ay, bx, by, size) {
  const dx = toroidalDelta(ax, bx, size);
  const dy = toroidalDelta(ay, by, size);
  return dx * dx + dy * dy;
}

export function lerp(a, b, t) { return a + (b - a) * t; }

export function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

/** 把角度 cur 朝 target 旋转，单次最多 maxDelta */
export function turnToward(cur, target, maxDelta) {
  let d = target - cur;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  if (Math.abs(d) <= maxDelta) return target;
  return cur + Math.sign(d) * maxDelta;
}

export function randRange(a, b) { return a + Math.random() * (b - a); }

export function randInt(n) { return Math.floor(Math.random() * n); }
