// 客户端插值回归测试：直接加载 client/js/net.js（把 '/shared/' 说明符改写成 file: URL），
// 用合成的、到达时刻带抖动的服务器包流驱动它，检查渲染的平滑性。
// 覆盖两个曾经出过问题的点：
//   1) 渲染时钟必须单调 —— 早期版本每收一包就把 renderT 拉向目标，收包抖动直接变成画面抖动
//   2) 长度变化(吃/三消)不得造成位置突跳 —— 早期版本一旦珠数变化就整条蛇吸附到最新帧
// 运行： node tests/interp.js

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

// 可复现的伪随机，保证测试结果稳定
let seed = 12345;
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

/** 合成一帧服务器位置：一条沿 +x 直线前进的蛇，中途吃到道具、随后三消 */
function makeFrame(tick, startX) {
  const st = tick * TICK;
  const headX = startX + SPEED * st;
  let n = 6;
  if (st >= 0.7) n = 7;         // 吃到道具，长度 +1
  if (st >= 1.1) n = 4;         // 触发三消，长度 -3
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
    while (nextPacketAt <= simT) {                 // 收包时刻带 ±15ms 抖动
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

  // 1) 渲染时钟必须单调，且单帧推进量不超过 FRAME 的 1.15 倍
  //    —— 纠偏只允许微调播放速率(±10%)，不允许直接把 renderT 拨到目标值
  let maxClockStep = 0;
  for (let i = 1; i < clocks.length; i++) {
    const d = clocks[i] - clocks[i - 1];
    if (d < 0) throw new Error(`[${label}] 渲染时钟回退：${clocks[i - 1]} -> ${clocks[i]}`);
    maxClockStep = Math.max(maxClockStep, d);
  }
  if (maxClockStep > FRAME * 1.15) {
    throw new Error(`[${label}] 渲染时钟被直接拨表：单帧推进 ${(maxClockStep * 1000).toFixed(2)}ms`
      + ` > ${(FRAME * 1150).toFixed(2)}ms`);
  }

  // 2) 逐帧位移：跨越边界按环面最短路还原
  const step = [];
  for (let i = 31; i < heads.length; i++) {        // 跳过启动预热
    let d = heads[i] - heads[i - 1];
    if (d > MAP / 2) d -= MAP; else if (d < -MAP / 2) d += MAP;
    step.push(d);
  }
  const mean = step.reduce((a, b) => a + b, 0) / step.length;
  const max = Math.max(...step), min = Math.min(...step);
  const expected = SPEED * FRAME;
  console.log(`[${label}] 帧数 ${heads.length}  平均位移 ${mean.toFixed(4)}（理论 ${expected.toFixed(4)}）`
    + `  最大 ${max.toFixed(4)}  最小 ${min.toFixed(4)}  最大/平均 ${(max / mean).toFixed(2)}`);

  // 阈值来自两项已知误差之和，而不是拍脑袋：
  //   a) 渲染时钟纠偏被钳在 ±10%，逐帧位移本就会有 ±10% 的正常波动
  //   b) 线上坐标是 2 位小数，两端各 ±0.01 的量化误差最多再贡献 ±0.02 的逐帧位移
  // 即 max <= 1.1*expected + 0.02，min >= 0.9*expected - 0.02，换算成相对 mean 约 [0.76, 1.27]。
  // 实测：max/mean≈1.20、min/mean≈0.88。注入"每收一包就拨表"的老 bug 会由上面的时钟断言抓到，
  // 注入"长度变化即整条吸附"的老 bug 会让 max/mean 冲到 2.8 以上。
  const q = 0.02 / mean;
  if (Math.abs(mean - expected) / expected > 0.05) throw new Error(`[${label}] 平均速度偏离理论值`);
  if (max / mean > 1.1 + q) throw new Error(`[${label}] 存在突跳帧：${max.toFixed(4)} vs 平均 ${mean.toFixed(4)}`);
  if (min / mean < 0.9 - q) throw new Error(`[${label}] 存在卡顿帧：${min.toFixed(4)} vs 平均 ${mean.toFixed(4)}`);
}

run(10, '普通行进（含吃/三消导致的长度变化）');
run(MAP - 12, '跨越地图边界');
console.log('插值平滑性检查通过 ✔');
