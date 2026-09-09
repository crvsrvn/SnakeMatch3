// Client interpolation regression test: load client/js/net.js directly (rewriting the
// '/shared/' specifier to a file: URL) and drive it with a synthetic packet stream whose
// arrival times jitter, then check how smooth the result is.
// It covers two bugs that actually happened:
//   1) the render clock must be monotonic -- an early version pulled renderT to the target on
//      every packet, which turned arrival jitter straight into visible stutter
//   2) a length change (eating, matching) must not jump the position -- an early version
//      snapped the whole snake to the newest frame whenever the bead count changed
// Run with: node tests/interp.js

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CONFIG } from '../config/game.config.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const sharedUrl = pathToFileURL(path.join(ROOT, 'shared')).href;
const src = fs.readFileSync(path.join(ROOT, 'client', 'js', 'net.js'), 'utf8')
  .split("'/shared/").join(`'${sharedUrl}/`);
const { Net } = await import(`data:text/javascript,${encodeURIComponent(src)}`);

const TICK = 1 / CONFIG.net.tickRate;
const PKT = CONFIG.net.framesPerPacket;
const FRAME = 1 / 60;
const SPACING = CONFIG.snake.beadSpacing;
const SPEED = CONFIG.snake.baseSpeed;
const MAP = CONFIG.map.size;

// Reproducible pseudo-random, so the test is stable
let seed = 12345;
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

/** Synthesise one server frame: a snake running straight along +x that eats an item and
 *  then clears a match */
function makeFrame(tick, startX) {
  const st = tick * TICK;
  const headX = startX + SPEED * st;
  let n = 6;
  if (st >= 0.7) n = 7;         // ate an item, length +1
  if (st >= 1.1) n = 4;         // match cleared, length -3
  const b = [];
  for (let i = 0; i < n; i++) {
    b.push(Math.round((((headX - i * SPACING) % MAP) + MAP) % MAP * 100) / 100, 20, 0);
  }
  return {
    st: Math.round(st * 1000) / 1000,
    snakes: [{ id: 1, n: 'T', sk: 'glass', ai: 0, tr: 0, d: 0, iv: 0, c: new Array(n).fill(0), b }],
  };
}

function run(startX, label) {
  const net = new Net({});
  net.onMessage({ t: 'welcome', config: CONFIG });

  let simT = 0, nextPacketAt = 0, tick = 0;
  const clocks = [], heads = [];
  while (simT < 4) {
    while (nextPacketAt <= simT) {                 // arrival times jitter by +/-15ms
      const f = [];
      for (let k = 0; k < PKT; k++) f.push(makeFrame(tick++, startX));
      net.onMessage({ t: 'state', f, items: [], ev: [] });
      nextPacketAt += PKT * TICK + (rand() - 0.5) * 0.03;
    }
    net.update(FRAME);
    const s = net.sample();
    if (s) { clocks.push(net.renderT); heads.push(s.snakes[0].beads[0].x); }
    simT += FRAME;
  }

  // 1) The render clock must be monotonic, and advance at most 1.15x FRAME per frame --
  //    correction may only nudge the playback rate (+/-10%), never set renderT outright
  let maxClockStep = 0;
  for (let i = 1; i < clocks.length; i++) {
    const d = clocks[i] - clocks[i - 1];
    if (d < 0) throw new Error(`[${label}] render clock went backwards: ${clocks[i - 1]} -> ${clocks[i]}`);
    maxClockStep = Math.max(maxClockStep, d);
  }
  if (maxClockStep > FRAME * 1.15) {
    throw new Error(`[${label}] render clock was set outright: ${(maxClockStep * 1000).toFixed(2)}ms in one frame`
      + ` > ${(FRAME * 1150).toFixed(2)}ms`);
  }

  // 2) Per-frame displacement, reconstructed across edges by the shortest toroidal path
  const step = [];
  for (let i = 31; i < heads.length; i++) {        // skip the warm-up
    let d = heads[i] - heads[i - 1];
    if (d > MAP / 2) d -= MAP; else if (d < -MAP / 2) d += MAP;
    step.push(d);
  }
  const mean = step.reduce((a, b) => a + b, 0) / step.length;
  const max = Math.max(...step), min = Math.min(...step);
  const expected = SPEED * FRAME;
  console.log(`[${label}] frames ${heads.length}  mean step ${mean.toFixed(4)} (theory ${expected.toFixed(4)})`
    + `  max ${max.toFixed(4)}  min ${min.toFixed(4)}  max/mean ${(max / mean).toFixed(2)}`);

  // The thresholds are the sum of two known error terms rather than a guess:
  //   a) clock correction is clamped to +/-10%, so a +/-10% swing in step size is normal
  //   b) coordinates go over the wire with 2 decimals, and +/-0.01 at each end contributes at
  //      most +/-0.02 to a single step
  // So max <= 1.1*expected + 0.02 and min >= 0.9*expected - 0.02, roughly [0.76, 1.27] of the
  // mean. Measured: max/mean about 1.20, min/mean about 0.88. Reintroducing the "set the
  // clock on every packet" bug trips the clock assertion above; reintroducing the "snap the
  // whole snake on a length change" bug pushes max/mean past 2.8.
  const q = 0.02 / mean;
  if (Math.abs(mean - expected) / expected > 0.05) throw new Error(`[${label}] mean speed is off the theoretical value`);
  if (max / mean > 1.1 + q) throw new Error(`[${label}] a frame jumped: ${max.toFixed(4)} vs mean ${mean.toFixed(4)}`);
  if (min / mean < 0.9 - q) throw new Error(`[${label}] a frame stalled: ${min.toFixed(4)} vs mean ${mean.toFixed(4)}`);
}

run(10, 'ordinary travel, including length changes from eating and matching');
run(MAP - 12, 'crossing the map edge');
console.log('interpolation smoothness OK');
