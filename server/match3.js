// Match-3 resolution: a run of >=3 of one color clears, then we rescan so chains happen.
// A WILD bead stands in for any color: a window counts as one color as long as every
// non-wild bead in it agrees.
// `colors` and `positions` are parallel arrays (positions only feeds the effect event and
// may be null).

import { WILD } from '../shared/protocol.js';

const MIN_RUN = 3;

/** Leftmost clearable run, or null if there is none */
function findRun(colors) {
  for (let i = 0; i < colors.length; i++) {
    let base = colors[i] === WILD ? null : colors[i];   // null = all wild so far, color undecided
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
 * @returns {Array<{color:number, points:Array<[number,number,number]>}>} one entry per clear, in chain order
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

/** Random colors with no run of 3, so a fresh snake does not clear for free */
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
