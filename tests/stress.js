// Server load test: 100 bot snakes, measuring per-frame cost, sustainable tick rate, the
// share taken by each phase, and bandwidth.
// Run with: node tests/stress.js [snakes] [map size]
//
// The bar: p99 frame cost must sit well under one tick of budget (16.7ms at 60Hz, 33.3ms at
// 30Hz). Otherwise one slow frame eats into the next and the server visibly drops frames.

import { CONFIG } from '../config/game.config.js';

const SNAKES = Number(process.argv[2] || 100);
const MAP = Number(process.argv[3] || CONFIG.map.size);

CONFIG.ai.count = SNAKES;
CONFIG.map.size = MAP;
// Item density follows map area, so it matches the default configuration
CONFIG.items.count = Math.round(24 * (MAP / 110) ** 2);
CONFIG.items.maxOnMap = Math.max(CONFIG.items.count * 4, 90);

const { World } = await import('../server/world.js');

const world = new World({ addTrophy() {} });
const dt = 1 / CONFIG.net.tickRate;
const PHASES = ['respawnDead', 'pickupItems', 'resolveCollisions', 'resolveMatchesAndWins', 'refillItems', 'tickWildClusters'];
const phaseNs = Object.fromEntries(PHASES.map((k) => [k, 0]));
for (const name of PHASES) {
  const orig = world[name].bind(world);
  world[name] = (...a) => {
    const t = process.hrtime.bigint();
    const r = orig(...a);
    phaseNs[name] += Number(process.hrtime.bigint() - t);
    return r;
  };
}

// ---------- 1) Per-frame cost ----------
const WARMUP = 120;
const TICKS = 2400;                       // 40 seconds at 60Hz
for (let i = 0; i < WARMUP; i++) world.step(dt);
for (const k of PHASES) phaseNs[k] = 0;

const samples = new Float64Array(TICKS);
let totalNs = 0;
for (let i = 0; i < TICKS; i++) {
  const t = process.hrtime.bigint();
  world.step(dt);
  const ns = Number(process.hrtime.bigint() - t);
  samples[i] = ns / 1e6;
  totalNs += ns;
}
const sorted = Float64Array.from(samples).sort();
const pct = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];

// ---------- 2) Bandwidth ----------
const packet = { t: 'state', f: [], items: world.itemsSnapshot(), ev: [] };
for (let i = 0; i < CONFIG.net.framesPerPacket; i++) { world.step(dt); packet.f.push(world.frame()); }
const packetBytes = JSON.stringify(packet).length;
const packetHz = CONFIG.net.tickRate / CONFIG.net.framesPerPacket;

// ---------- 3) Can it keep up against a real clock ----------
const realHz = await measureRealtime(world, CONFIG.net.tickRate, 5);

// ---------- Report ----------
let live = 0, beads = 0;
for (const s of world.snakes.values()) { if (!s.deadUntil) live++; beads += s.beads.length; }

console.log(`${SNAKES} snakes (${live} alive) / map ${MAP}x${MAP} / ${world.items.length} items / ${beads} beads total`);
console.log(`simulated ${TICKS} ticks, configured tickRate = ${CONFIG.net.tickRate}Hz`);
console.log('frame cost (ms):'
  + `  mean ${(totalNs / TICKS / 1e6).toFixed(3)}`
  + `  p50 ${pct(0.5).toFixed(3)}  p95 ${pct(0.95).toFixed(3)}`
  + `  p99 ${pct(0.99).toFixed(3)}  max ${sorted[sorted.length - 1].toFixed(3)}`);

console.log('share by phase:');
const totalPhase = Object.values(phaseNs).reduce((a, b) => a + b, 0);
const rows = Object.entries(phaseNs).sort((a, b) => b[1] - a[1]);
for (const [k, ns] of rows) {
  console.log(`  ${(k + '                     ').slice(0, 22)} ${(ns / TICKS / 1e6).toFixed(3)} ms/frame`
    + `  ${(ns / totalNs * 100).toFixed(1)}%`);
}
console.log(`  ${'move + sample beads   '.slice(0, 22)} ${((totalNs - totalPhase) / TICKS / 1e6).toFixed(3)} ms/frame`
  + `  ${((totalNs - totalPhase) / totalNs * 100).toFixed(1)}%`);

const p99 = pct(0.99);
console.log(`budget used:  60Hz (16.67ms) ${(p99 / 16.667 * 100).toFixed(1)}%`
  + `   30Hz (33.33ms) ${(p99 / 33.333 * 100).toFixed(1)}%   (measured at p99)`);
console.log(`against a real clock: ${realHz.hz.toFixed(1)} tick/s (target ${CONFIG.net.tickRate}), largest gap ${realHz.maxGap.toFixed(1)}ms`);
console.log(`packet ${(packetBytes / 1024).toFixed(1)} KB x ${packetHz}/s = ${(packetBytes * packetHz / 1024).toFixed(0)} KB/s per client`);

/** Run the same timer + accumulator structure the server uses, and see how many ticks it
 *  actually manages */
function measureRealtime(w, hz, seconds) {
  return new Promise((resolve) => {
    const step = 1 / hz;
    let acc = 0, ticks = 0, maxGap = 0;
    let last = process.hrtime.bigint();
    const t0 = last;
    const timer = setInterval(() => {
      const now = process.hrtime.bigint();
      const gap = Number(now - last) / 1e6;
      maxGap = Math.max(maxGap, gap);
      acc += gap / 1000;
      last = now;
      if (acc > 0.5) acc = 0.5;
      let n = 0;
      while (acc >= step && n++ < 8) { w.step(step); acc -= step; ticks++; }
      if (Number(now - t0) / 1e9 >= seconds) {
        clearInterval(timer);
        resolve({ hz: ticks / (Number(process.hrtime.bigint() - t0) / 1e9), maxGap });
      }
    }, Math.max(1, Math.floor(500 / hz)));
  });
}
