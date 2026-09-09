// 权威世界：固定步长模拟所有蛇、道具、碰撞与三消，并产出广播快照。

import { CONFIG } from '../shared/config.js';
import { EV } from '../shared/protocol.js';
import { toroidalDelta, toroidalDist2, randRange, randInt } from '../shared/mathUtil.js';
import { Snake } from './snake.js';
import { AIBrain } from './ai.js';
import { resolveMatches, randomColors } from './match3.js';

const S = CONFIG.snake;
const MAP = CONFIG.map.size;
const NCOL = CONFIG.colors.length;
const HIT_D2 = (S.beadRadius * 2 * S.hitFactor) ** 2;
const EAT_D2 = (S.beadRadius + CONFIG.items.radius) ** 2;

const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;

export class World {
  constructor(profiles) {
    this.profiles = profiles;
    this.snakes = new Map();
    this.brains = new Map();
    this.items = [];
    this.events = [];
    this.time = 0;
    this.nextId = 1;
    this.nextItemId = 1;

    for (let i = 0; i < CONFIG.ai.count; i++) this.spawnAI(i);
    this.refillItems();
  }

  // ---------- 生命周期 ----------

  spawnAI(i) {
    const names = CONFIG.ai.names;
    const suffix = i >= names.length ? String(i) : '';
    const s = new Snake(this.nextId++, names[i % names.length] + suffix, true,
      CONFIG.skins[i % CONFIG.skins.length]);
    this.placeAtFreeSpot(s);
    this.snakes.set(s.id, s);
    this.brains.set(s.id, new AIBrain());
    return s;
  }

  addPlayer(profile, skin) {
    const s = new Snake(this.nextId++, profile.nickname, false, skin);
    s.profile = profile;
    s.trophies = profile.trophies;
    this.placeAtFreeSpot(s);
    this.snakes.set(s.id, s);
    return s;
  }

  removeSnake(id) {
    this.snakes.delete(id);
    this.brains.delete(id);
  }

  placeAtFreeSpot(s) {
    let best = { x: randRange(0, MAP), y: randRange(0, MAP) };
    let bestD = -1;
    for (let i = 0; i < 30; i++) {
      const x = randRange(0, MAP), y = randRange(0, MAP);
      const d = this.nearestBeadDist(x, y, s.id);
      if (d > bestD) { bestD = d; best = { x, y }; }
      if (d > 14) break;
    }
    s.respawn(best.x, best.y, randRange(0, Math.PI * 2),
      randomColors(S.initialLength, NCOL), this.time);
  }

  nearestBeadDist(x, y, skipId) {
    let min = Infinity;
    for (const s of this.snakes.values()) {
      if (s.id === skipId) continue;
      for (const b of s.beads) min = Math.min(min, toroidalDist2(x, y, b.x, b.y, MAP));
    }
    return Math.sqrt(min);
  }

  // ---------- 主循环 ----------

  step(dt) {
    this.time += dt;
    this.events = [];

    for (const s of this.snakes.values()) {
      const brain = this.brains.get(s.id);
      if (brain) brain.update(s, dt);
      s.step(dt);
    }
    for (const s of this.snakes.values()) s.beads = s.computeBeads();

    this.pickupItems();
    this.resolveCollisions();
    this.resolveMatchesAndWins();
    this.refillItems();
  }

  immune(s) { return this.time < s.invulnUntil; }

  touch(p, q) {
    if (Math.abs(p.z - q.z) > S.jumpClearance) return false;
    return toroidalDist2(p.x, p.y, q.x, q.y, MAP) < HIT_D2;
  }

  // ---------- 道具 ----------

  refillItems() {
    let guard = 0;
    while (this.items.length < CONFIG.items.count && guard++ < 200) {
      let x = randRange(0, MAP), y = randRange(0, MAP);
      for (let i = 0; i < 12; i++) {
        if (this.nearestBeadDist(x, y, -1) > CONFIG.items.minSpawnDistance) break;
        x = randRange(0, MAP); y = randRange(0, MAP);
      }
      this.items.push({ id: this.nextItemId++, x, y, c: randInt(NCOL) });
    }
  }

  pickupItems() {
    for (const s of this.snakes.values()) {
      const head = s.beads[0];
      if (!head) continue;
      if (head.z > S.beadRadius) continue;        // 跳跃中不吃：可用空格主动跳过不想要的颜色
      if (s.colors.length >= S.maxLength) continue;
      for (let i = this.items.length - 1; i >= 0; i--) {
        const it = this.items[i];
        if (toroidalDist2(head.x, head.y, it.x, it.y, MAP) >= EAT_D2) continue;
        this.items.splice(i, 1);
        s.colors.unshift(it.c);
        s.beads = s.computeBeads();
        this.events.push({ t: EV.EAT, p: [r2(it.x), r2(it.y), 0], c: it.c });
        break;
      }
    }
  }

  // ---------- 碰撞 ----------

  resolveCollisions() {
    const list = [...this.snakes.values()];
    const done = new Set();   // 本帧已结算过的蛇，避免连环重复判定

    // 1) 头对头
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        if (done.has(a.id) || done.has(b.id)) continue;
        if (this.immune(a) || this.immune(b)) continue;
        if (!a.beads.length || !b.beads.length) continue;
        if (!this.touch(a.beads[0], b.beads[0])) continue;
        this.headOn(a, b);
        done.add(a.id); done.add(b.id);
      }
    }

    // 2) 头撞他人身体 -> 断尾接管
    for (const a of list) {
      if (done.has(a.id) || this.immune(a) || !a.beads.length) continue;
      const head = a.beads[0];
      let best = null;
      for (const b of list) {
        if (b === a || done.has(b.id) || this.immune(b)) continue;
        for (let k = 1; k < b.beads.length; k++) {
          if (!this.touch(head, b.beads[k])) continue;
          const d2 = toroidalDist2(head.x, head.y, b.beads[k].x, b.beads[k].y, MAP);
          if (!best || d2 < best.d2) best = { b, k, d2 };
        }
      }
      if (!best) continue;
      this.severTail(a, best.b, best.k);
      done.add(a.id); done.add(best.b.id);
    }

    // 3) 撞到自己
    if (S.selfCollision === 'die') {
      for (const a of list) {
        if (this.immune(a) || this.time < a.noSelfUntil || !a.beads.length) continue;
        const head = a.beads[0];
        for (let k = S.selfCollisionMinIndex; k < a.beads.length; k++) {
          if (!this.touch(head, a.beads[k])) continue;
          this.kill(a, '自己');
          break;
        }
      }
    }
  }

  /** 头对头：比较"正前方程度"，胜者消一颗头珠，败者死亡重生；势均力敌则同归于尽 */
  headOn(a, b) {
    const ha = a.beads[0], hb = b.beads[0];
    const dx = toroidalDelta(ha.x, hb.x, MAP), dy = toroidalDelta(ha.y, hb.y, MAP);
    const len = Math.hypot(dx, dy) || 1e-6;
    const fa = (Math.cos(a.dir) * dx + Math.sin(a.dir) * dy) / len;
    const fb = (Math.cos(b.dir) * -dx + Math.sin(b.dir) * -dy) / len;

    this.events.push({
      t: EV.HITHEAD,
      p: [r2(ha.x + dx / 2), r2(ha.y + dy / 2), r2((ha.z + hb.z) / 2)],
    });

    if (Math.abs(fa - fb) < S.headOnTieEpsilon) {   // 正得一样，同归于尽
      this.kill(a, b.name); this.kill(b, a.name);
    } else if (fa > fb) {
      this.popHead(a); this.kill(b, a.name);
    } else {
      this.popHead(b); this.kill(a, b.name);
    }
  }

  popHead(s) {
    if (!s.colors.length) return;
    s.colors.shift();
    s.beads = s.computeBeads();
  }

  /** a 的头撞到 b 的第 k 节：b 只保留前段，断尾反转后接到 a 头前 */
  severTail(a, b, k) {
    const p = a.beads[0];
    this.events.push({ t: EV.HITBODY, p: [r2(p.x), r2(p.y), r2(p.z)] });
    const sev = b.severAt(k);
    b.beads = b.computeBeads();
    a.prependChain(sev.pts, sev.colors, this.time);
    a.beads = a.computeBeads();
  }

  kill(s, byName) {
    const drops = this.dropBeads(s);
    this.events.push({ t: EV.DEATH, id: s.id, name: s.name, by: byName, drops });
    this.placeAtFreeSpot(s);
  }

  /** 死亡时珠子原地留下，和普通道具进同一个池子，谁都能捡 */
  dropBeads(s) {
    const drops = [];
    for (let i = 0; i < s.beads.length; i++) {
      if (this.items.length >= CONFIG.items.maxOnMap) break;
      const b = s.beads[i];
      this.items.push({ id: this.nextItemId++, x: b.x, y: b.y, c: s.colors[i] });
      drops.push([r2(b.x), r2(b.y), r2(b.z), s.colors[i]]);
    }
    return drops;
  }

  // ---------- 三消与胜利 ----------

  resolveMatchesAndWins() {
    for (const s of this.snakes.values()) {
      const groups = resolveMatches(s.colors, s.beads);
      for (const g of groups) {
        this.events.push({
          t: EV.MATCH, c: g.color, sid: s.id,
          pts: g.points.map((p) => [r2(p[0]), r2(p[1]), r2(p[2])]),
        });
      }
      if (groups.length) s.beads = s.computeBeads();
      if (s.colors.length === 0) {
        s.trophies++;
        if (s.profile) this.profiles.addTrophy(s.profile);
        this.events.push({ t: EV.WIN, id: s.id, name: s.name, trophies: s.trophies });
        this.placeAtFreeSpot(s);
      }
    }
  }

  // ---------- 快照 ----------

  snapshot() {
    const snakes = [];
    for (const s of this.snakes.values()) {
      const b = new Array(s.beads.length * 3);
      for (let i = 0; i < s.beads.length; i++) {
        b[i * 3] = r2(s.beads[i].x);
        b[i * 3 + 1] = r2(s.beads[i].y);
        b[i * 3 + 2] = r2(s.beads[i].z);
      }
      snakes.push({
        id: s.id, n: s.name, sk: s.skin, ai: s.isAI ? 1 : 0,
        tr: s.trophies, d: r3(s.dir), iv: this.immune(s) ? 1 : 0,
        c: s.colors, b,
      });
    }
    return {
      st: r3(this.time),   // 快照时间戳（不能叫 t，会与消息类型字段冲突）
      snakes,
      items: this.items.map((it) => [it.id, r2(it.x), r2(it.y), it.c]),
      ev: this.events,
    };
  }
}
