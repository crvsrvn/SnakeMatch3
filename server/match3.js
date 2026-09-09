// 三消结算：连续 >=3 颗同色即消除，消除后重新扫描形成连锁。
// colors 与 positions 是平行数组（positions 仅用于生成特效事件，可为 null）。

const MIN_RUN = 3;

/**
 * @returns {Array<{color:number, points:Array<[number,number,number]>}>} 每次消除的记录（按连锁顺序）
 */
export function resolveMatches(colors, positions) {
  const groups = [];
  for (;;) {
    let i = 0;
    let hit = -1;
    let run = 0;
    while (i < colors.length) {
      let j = i;
      while (j + 1 < colors.length && colors[j + 1] === colors[i]) j++;
      if (j - i + 1 >= MIN_RUN) { hit = i; run = j - i + 1; break; }
      i = j + 1;
    }
    if (hit < 0) break;

    const color = colors[hit];
    const points = [];
    if (positions) {
      for (let k = hit; k < hit + run; k++) {
        const p = positions[k];
        points.push([p.x, p.y, p.z]);
      }
      positions.splice(hit, run);
    }
    colors.splice(hit, run);
    groups.push({ color, points });
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
