// 三消结算：连续 >=3 颗同色即消除，消除后重新扫描形成连锁。
// 万能珠(WILD)可以顶替任意颜色：一个窗口只要"所有非万能珠同色"就算同色。
// colors 与 positions 是平行数组（positions 仅用于生成特效事件，可为 null）。

import { WILD } from '../shared/protocol.js';

const MIN_RUN = 3;

/** 找出最靠左的一段可消窗口；没有则返回 null */
function findRun(colors) {
  for (let i = 0; i < colors.length; i++) {
    let base = colors[i] === WILD ? null : colors[i];   // null 表示"目前全是万能珠，颜色待定"
    let j = i;
    while (j + 1 < colors.length) {
      const c = colors[j + 1];
      if (c === WILD) { j++; continue; }
      if (base === null) { base = c; j++; continue; }
      if (c === base) { j++; continue; }
      break;
    }
    if (j - i + 1 >= MIN_RUN) {
      return { start: i, count: j - i + 1, color: base === null ? WILD : base };
    }
  }
  return null;
}

/**
 * @returns {Array<{color:number, points:Array<[number,number,number]>}>} 每次消除的记录（按连锁顺序）
 */
export function resolveMatches(colors, positions) {
  const groups = [];
  for (;;) {
    const run = findRun(colors);
    if (!run) break;

    const points = [];
    if (positions) {
      for (let k = run.start; k < run.start + run.count; k++) {
        const p = positions[k];
        points.push([p.x, p.y, p.z]);
      }
      positions.splice(run.start, run.count);
    }
    colors.splice(run.start, run.count);
    groups.push({ color: run.color, points });
  }
  return groups;
}

/** 生成一组不含 3 连的随机颜色，避免出生瞬间白送消除 */
export function randomColors(n, paletteSize) {
  const out = [];
  for (let i = 0; i < n; i++) {
    let c;
    do { c = Math.floor(Math.random() * paletteSize); }
    while (i >= 2 && out[i - 1] === c && out[i - 2] === c);
    out.push(c);
  }
  return out;
}
