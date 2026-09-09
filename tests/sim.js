// 无头压力/回归测试：在缩小的地图里塞满 AI，长时间跑模拟，检查不变量。
// 运行： node tests/sim.js
import { CONFIG } from '../shared/config.js';

// 必须在动态 import(world) 之前改配置：各模块在载入时会缓存派生常量
CONFIG.map.size = 44;
CONFIG.ai.count = 12;
CONFIG.items.count = 30;

const { World } = await import('../server/world.js');
const { EV } = await import('../shared/protocol.js');

const world = new World({ addTrophy() {} });
const dt = 1 / CONFIG.net.tickRate;
const counts = {};
let maxLen = 0, maxBytes = 0, ticks = 0;

const SECONDS = 120;
for (let i = 0; i < SECONDS / dt; i++) {
  world.step(dt);
  ticks++;
  for (const e of world.events) counts[e.t] = (counts[e.t] || 0) + 1;

  for (const s of world.snakes.values()) {
    maxLen = Math.max(maxLen, s.colors.length);
    if (s.colors.length > CONFIG.snake.maxLength) throw new Error(`超长: ${s.colors.length}`);
    if (s.beads.length !== s.colors.length) throw new Error('珠子数与颜色数不一致');
    for (const b of s.beads) {
      if (!Number.isFinite(b.x) || !Number.isFinite(b.y) || !Number.isFinite(b.z)) throw new Error('坐标 NaN');
      if (b.x < 0 || b.x > CONFIG.map.size || b.y < 0 || b.y > CONFIG.map.size) throw new Error(`越界 ${b.x},${b.y}`);
    }
    // 相邻珠间距应接近 beadSpacing（跨越边界时用环面距离）
    for (let k = 1; k < s.beads.length; k++) {
      const p = s.beads[k - 1], q = s.beads[k];
      const h = CONFIG.map.size / 2;
      let dx = q.x - p.x, dy = q.y - p.y;
      if (dx > h) dx -= CONFIG.map.size; else if (dx < -h) dx += CONFIG.map.size;
      if (dy > h) dy -= CONFIG.map.size; else if (dy < -h) dy += CONFIG.map.size;
      const d = Math.hypot(dx, dy);
      if (d > CONFIG.snake.beadSpacing * 1.6) throw new Error(`珠子断开: ${d.toFixed(2)} (蛇 ${s.name} 第 ${k} 节)`);
    }
  }
  if (i % 30 === 0) maxBytes = Math.max(maxBytes, JSON.stringify(world.snapshot()).length);
}

console.log(`模拟 ${SECONDS}s / ${ticks} tick，蛇 ${world.snakes.size} 条`);
console.log('事件统计:', counts);
console.log('最长蛇:', maxLen, '  单帧快照最大字节:', maxBytes,
  ` (${(maxBytes * CONFIG.net.tickRate / 1024).toFixed(1)} KB/s 每客户端)`);

const need = [EV.EAT, EV.MATCH, EV.HITBODY, EV.DEATH];
const missing = need.filter((k) => !counts[k]);
if (missing.length) throw new Error(`预期事件未出现: ${missing.join(',')}`);
console.log('全部不变量通过 ✔');
