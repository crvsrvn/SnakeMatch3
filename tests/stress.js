// 服务器压力测试：100 条 AI 蛇，量单帧耗时、可持续 tick 率、各阶段占比与带宽。
// 运行： node tests/stress.js [蛇数] [地图边长]
//
// 判定标准：单帧耗时的 p99 要明显小于一个 tick 的预算（60Hz=16.7ms / 30Hz=33.3ms），
// 否则一旦某帧超时就会挤掉后面的帧，表现为服务器"掉帧"。

import { CONFIG } from '../config/game.config.js';

const SNAKES = Number(process.argv[2] || 100);
const MAP = Number(process.argv[3] || CONFIG.map.size);

CONFIG.ai.count = SNAKES;
CONFIG.map.size = MAP;
// 道具密度跟着地图面积走，保持和默认配置相当
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

// ---------- 1) 单帧耗时 ----------
const WARMUP = 120;
const TICKS = 2400;                       // 60Hz 下 40 秒
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

// ---------- 2) 带宽 ----------
const packet = { t: 'state', f: [], items: world.itemsSnapshot(), ev: [] };
for (let i = 0; i < CONFIG.net.framesPerPacket; i++) { world.step(dt); packet.f.push(world.frame()); }
const packetBytes = JSON.stringify(packet).length;
const packetHz = CONFIG.net.tickRate / CONFIG.net.framesPerPacket;

// ---------- 3) 真实时钟下能否跑满 ----------
const realHz = await measureRealtime(world, CONFIG.net.tickRate, 5);

// ---------- 报告 ----------
let live = 0, beads = 0;
for (const s of world.snakes.values()) { if (!s.deadUntil) live++; beads += s.beads.length; }

console.log(`蛇 ${SNAKES} 条（存活 ${live}）/ 地图 ${MAP}×${MAP} / 道具 ${world.items.length} / 珠子总数 ${beads}`);
console.log(`模拟 ${TICKS} tick，配置 tickRate = ${CONFIG.net.tickRate}Hz`);
console.log('单帧耗时(ms):'
  + `  平均 ${(totalNs / TICKS / 1e6).toFixed(3)}`
  + `  p50 ${pct(0.5).toFixed(3)}  p95 ${pct(0.95).toFixed(3)}`
  + `  p99 ${pct(0.99).toFixed(3)}  最大 ${sorted[sorted.length - 1].toFixed(3)}`);

console.log('各阶段占比:');
const totalPhase = Object.values(phaseNs).reduce((a, b) => a + b, 0);
const rows = Object.entries(phaseNs).sort((a, b) => b[1] - a[1]);
for (const [k, ns] of rows) {
  console.log(`  ${(k + '                     ').slice(0, 22)} ${(ns / TICKS / 1e6).toFixed(3)} ms/帧`
    + `  ${(ns / totalNs * 100).toFixed(1)}%`);
}
console.log(`  ${'移动+采样珠坐标      '.slice(0, 22)} ${((totalNs - totalPhase) / TICKS / 1e6).toFixed(3)} ms/帧`
  + `  ${((totalNs - totalPhase) / totalNs * 100).toFixed(1)}%`);

const p99 = pct(0.99);
console.log(`预算占用:  60Hz(16.67ms) 用掉 ${(p99 / 16.667 * 100).toFixed(1)}%`
  + `   30Hz(33.33ms) 用掉 ${(p99 / 33.333 * 100).toFixed(1)}%   （按 p99 计）`);
console.log(`真实时钟下实测 ${realHz.hz.toFixed(1)} tick/s（目标 ${CONFIG.net.tickRate}），最大间隔 ${realHz.maxGap.toFixed(1)}ms`);
console.log(`单包 ${(packetBytes / 1024).toFixed(1)} KB × ${packetHz}/s = ${(packetBytes * packetHz / 1024).toFixed(0)} KB/s 每客户端`);

/** 用和服务器一样的定时器+累加器结构跑若干秒，看实际能推进多少 tick */
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
