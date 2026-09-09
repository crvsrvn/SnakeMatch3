// 蛇实体：连续运动 + 轨迹折线。
// 核心不变式：第 i 颗珠永远位于"头部沿轨迹回退 i * beadSpacing 弧长"处。
// 因此吃珠(头部插入)、三消(数组 splice)、断尾接管(折线拼接)都只是数组操作。
// 坐标在内部保持"不回绕"的连续值，只在对外输出/碰撞时取模到地图内。

import { CONFIG } from '../config/game.config.js';
import { wrap, turnToward } from '../shared/mathUtil.js';

const S = CONFIG.snake;
const MAP = CONFIG.map.size;
const TRAIL_LEN = S.maxLength * S.beadSpacing + 3; // 轨迹保留的弧长

export class Snake {
  constructor(id, name, isAI, skin) {
    this.id = id;
    this.name = name;
    this.isAI = isAI;
    this.skin = skin;
    this.trophies = 0;

    this.colors = [];
    this.trail = [];          // index 0 = 最新(头部)，元素 {x,y,z,o}
    this.odo = 0;             // 里程计；某点距头部弧长 = odo - point.o
    this.x = 0; this.y = 0; this.z = 0;
    this.dir = 0;
    this.targetDir = 0;
    this.sprint = false;
    this.jumpT = -1;          // <0 表示不在空中
    this.jumpCd = 0;
    this.invulnUntil = 0;
    this.noSelfUntil = 0;     // 吞并断尾后的短暂自撞豁免
    this.deadUntil = 0;       // > world.time 表示正在死亡停顿中
    this.deathPos = null;     // 死亡时的头部位置，停顿期间相机与标记都用它
    this.beads = [];          // 每帧缓存的珠子世界坐标(已取模)
  }

  get length() { return this.colors.length; }

  respawn(x, y, angle, colors, now) {
    this.x = x; this.y = y; this.z = 0;
    this.dir = angle; this.targetDir = angle;
    this.sprint = false;
    this.jumpT = -1; this.jumpCd = 0;
    this.odo = 0;
    this.colors = colors;
    this.invulnUntil = now + S.spawnInvulnerable;
    this.noSelfUntil = now + S.spawnInvulnerable;
    this.deadUntil = 0;
    // 沿反方向铺一条直线轨迹，保证一出生身体就是完整的
    this.trail = [];
    const cx = Math.cos(angle), cy = Math.sin(angle);
    for (let d = 0; d <= TRAIL_LEN; d += 0.3) {
      this.trail.push({ x: x - cx * d, y: y - cy * d, z: 0, o: -d });
    }
    this.beads = this.computeBeads();
  }

  /** AI 不会冲刺 */
  sprinting() { return this.sprint && !this.isAI; }

  speed() {
    return S.baseSpeed * (this.sprinting() ? S.sprintMultiplier : 1);
  }

  /** 冲刺时转向变钝：跑得快就别想拐急弯 */
  turnRate() {
    return S.turnRate * (this.sprinting() ? S.sprintTurnFactor : 1);
  }

  tryJump(now) {
    if (this.jumpT >= 0 || this.jumpCd > 0) return false;
    this.jumpT = 0;
    this.jumpCd = S.jumpCooldown;
    return true;
  }

  step(dt) {
    this.dir = turnToward(this.dir, this.targetDir, this.turnRate() * dt);
    const step = this.speed() * dt;
    this.x += Math.cos(this.dir) * step;
    this.y += Math.sin(this.dir) * step;
    this.odo += step;

    if (this.jumpCd > 0) this.jumpCd -= dt;
    if (this.jumpT >= 0) {
      this.jumpT += dt;
      const u = this.jumpT / S.jumpDuration;
      if (u >= 1) { this.jumpT = -1; this.z = 0; }
      else this.z = S.jumpHeight * 4 * u * (1 - u); // 抛物线
    }

    this.trail.unshift({ x: this.x, y: this.y, z: this.z, o: this.odo });
    // 裁剪：保证倒数第二个点仍覆盖所需弧长
    while (this.trail.length > 2 && this.odo - this.trail[this.trail.length - 2].o > TRAIL_LEN) {
      this.trail.pop();
    }
  }

  /** 轨迹上距头部弧长 d 处的点（未取模） */
  pointAt(d) {
    const t = this.trail;
    let i = 0;
    while (i < t.length - 1 && this.odo - t[i + 1].o < d) i++;
    const a = t[i], b = t[Math.min(i + 1, t.length - 1)];
    const da = this.odo - a.o, db = this.odo - b.o;
    const k = db > da ? (d - da) / (db - da) : 0;
    return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k };
  }

  /** 计算全部珠子的世界坐标（已取模到地图内） */
  computeBeads() {
    const out = [];
    const t = this.trail;
    let i = 0;
    for (let n = 0; n < this.colors.length; n++) {
      const d = n * S.beadSpacing;
      while (i < t.length - 1 && this.odo - t[i + 1].o < d) i++;
      const a = t[i], b = t[Math.min(i + 1, t.length - 1)];
      const da = this.odo - a.o, db = this.odo - b.o;
      const k = db > da ? (d - da) / (db - da) : 0;
      out.push({
        x: wrap(a.x + (b.x - a.x) * k, MAP),
        y: wrap(a.y + (b.y - a.y) * k, MAP),
        z: a.z + (b.z - a.z) * k,
      });
    }
    return out;
  }

  /**
   * 被从第 k 节切断：自身保留 [0, k)，返回断掉的那一段。
   * @returns {{pts: Array<{x,y,z}>, colors: number[]}} pts 按"靠近头部 -> 尾端"排序
   */
  severAt(k) {
    const startD = k * S.beadSpacing;
    const endD = (this.colors.length - 1) * S.beadSpacing;
    const pts = [this.pointAt(startD)];
    for (const p of this.trail) {          // trail 按弧长递增排列
      const d = this.odo - p.o;
      if (d > startD && d < endD) pts.push({ x: p.x, y: p.y, z: p.z });
    }
    if (endD > startD) pts.push(this.pointAt(endD));
    const colors = this.colors.slice(k);
    this.colors.length = k;
    return { pts, colors };
  }

  /**
   * 把断尾接到自己头前：新头 = 对方尾端，颜色反转后前置。
   * pts 需按"连接点 -> 尾端"排序，连接点会被平移对齐到自己当前头部。
   */
  prependChain(pts, colors, now) {
    const base = pts[0];
    const mapped = [];
    for (let i = pts.length - 1; i >= 1; i--) {   // 反转；跳过 i=0(连接点与自身头部重合)
      mapped.push({
        x: this.x + (pts[i].x - base.x),
        y: this.y + (pts[i].y - base.y),
        z: this.z + (pts[i].z - base.z),
        o: 0,
      });
    }

    // 只切下一颗珠时没有可拼接的折线，退化成"在头部插入"，头位置与朝向不变
    if (mapped.length > 0) {
      const trail = mapped.concat(this.trail);
      let o = this.odo;
      trail[0].o = o;
      for (let i = 1; i < trail.length; i++) {
        const dx = trail[i].x - trail[i - 1].x, dy = trail[i].y - trail[i - 1].y;
        o -= Math.hypot(dx, dy);
        trail[i].o = o;
      }
      this.trail = trail;
      this.x = trail[0].x; this.y = trail[0].y; this.z = trail[0].z;
      const p1 = trail[1];
      this.dir = Math.atan2(trail[0].y - p1.y, trail[0].x - p1.x);
      this.targetDir = this.dir;
    }

    this.colors = colors.slice().reverse().concat(this.colors);
    if (this.colors.length > S.maxLength) this.colors.length = S.maxLength;
    this.noSelfUntil = now + 0.8;

    while (this.trail.length > 2 && this.odo - this.trail[this.trail.length - 2].o > TRAIL_LEN) {
      this.trail.pop();
    }
  }
}
