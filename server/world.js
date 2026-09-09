// The authoritative world: a fixed-step simulation of every snake, item, collision and
// match, producing the frames that get broadcast.

import { CONFIG } from '../config/game.config.js';
import { EV, WILD } from '../shared/protocol.js';
import { wrap, toroidalDelta, toroidalDist2, randRange, randInt } from '../shared/mathUtil.js';
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
    this.wildTimer = CONFIG.items.wild.intervalSec * 0.4;   // hold off a little before the first cluster

    for (let i = 0; i < CONFIG.ai.count; i++) this.spawnAI(i);
    this.refillItems();
  }

  // ---------- Lifecycle ----------

  spawnAI(i) {
    const s = new Snake(this.nextId++, `bot${i + 1}`, true, CONFIG.skins[i % CONFIG.skins.length]);
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

  /** Is anyone on the field (bots included) already using this name? */
  isNameTaken(name) {
    for (const s of this.snakes.values()) if (s.name === name) return true;
    return false;
  }

  /** Every nickname currently in play, so the login screen can warn early */
  takenNames() {
    return [...this.snakes.values()].map((s) => s.name);
  }

  /** Append digits to the requested name until it is free, still within 12 characters */
  freeVariant(name) {
    const base = name.replace(/\d+$/, '') || name;
    for (let i = 2; i < 1000; i++) {
      const suffix = String(i);
      const c = base.slice(0, Math.max(1, 12 - suffix.length)) + suffix;
      if (!this.isNameTaken(c)) return c;
    }
    return this.freeDefaultName();
  }

  /**
   * Default nickname when the player leaves the field blank: Snake 1, Snake 2, ...
   * (skipping numbers already in use). It stays in one language on purpose -- a nickname
   * is shown to every other player, so it cannot follow one viewer's UI language.
   */
  freeDefaultName() {
    const used = new Set();
    for (const s of this.snakes.values()) {
      const m = /^Snake (\d+)$/.exec(s.name);
      if (m) used.add(Number(m[1]));
    }
    let n = 1;
    while (used.has(n)) n++;
    return `Snake ${n}`;
  }

  removeSnake(id) {
    this.snakes.delete(id);
    this.brains.delete(id);
  }

  /** @param near if given, look within respawnNearRadius of it; otherwise anywhere on the map */
  placeAtFreeSpot(s, near) {
    const R = S.respawnNearRadius;
    let best = null, bestD = -1;
    for (let i = 0; i < 40; i++) {
      let x, y;
      if (near) {
        const a = randRange(0, Math.PI * 2);
        const r = 2 + Math.sqrt(Math.random()) * (R - 2);
        x = wrap(near.x + Math.cos(a) * r, MAP);
        y = wrap(near.y + Math.sin(a) * r, MAP);
      } else {
        x = randRange(0, MAP); y = randRange(0, MAP);
      }
      const d = this.nearestBeadDist(x, y, s.id);
      if (d > bestD) { bestD = d; best = { x, y }; }
      if (d > (near ? 5 : 14)) break;
    }
    s.respawn(best.x, best.y, randRange(0, Math.PI * 2),
      randomColors(S.initialLength, NCOL), this.time);
  }

  nearestBeadDist(x, y, skipId) {
    let min = Infinity;
    for (const s of this.snakes.values()) {
      if (s.id === skipId || s.deadUntil) continue;
      for (const b of s.beads) min = Math.min(min, toroidalDist2(x, y, b.x, b.y, MAP));
    }
    return Math.sqrt(min);
  }

  // ---------- Main loop ----------

  step(dt) {
    this.time += dt;
    this.events = [];

    this.respawnDead();

    for (const s of this.snakes.values()) {
      if (s.deadUntil) continue;
      const brain = this.brains.get(s.id);
      if (brain) brain.update(s, dt);
      s.step(dt);
    }
    for (const s of this.snakes.values()) {
      if (!s.deadUntil) s.beads = s.computeBeads();
    }

    this.pickupItems();
    this.updateInvuln();
    this.resolveCollisions();
    this.resolveMatchesAndWins();
    this.refillItems();
    this.tickWildClusters(dt);
  }

  immune(s) { return this.time < s.invulnUntil; }

  /**
   * Invulnerable means out of collision entirely: cannot hit anyone, cannot be hit.
   * Cutting it off purely on time leaves a hole -- if we still overlap someone on the frame
   * it expires, the very next step kills us or severs our tail. So when it expires while
   * still overlapping, we keep extending until contact is broken, with a hard cap so that
   * someone tailgating an invulnerable snake cannot keep it invulnerable forever.
   */
  updateInvuln() {
    for (const s of this.snakes.values()) {
      if (!s.invulnUntil || this.time < s.invulnUntil || !this.alive(s)) continue;
      if (this.time >= s.invulnHardUntil || !this.overlapping(s)) s.invulnUntil = 0;
      else s.invulnUntil = this.time + 0.05;
    }
  }

  /** Overlapping in a way that would resolve the instant collisions come back:
   *  our head touching them, or their head touching us */
  overlapping(a) {
    for (const b of this.snakes.values()) {
      if (b === a || !this.alive(b) || this.immune(b)) continue;
      for (const q of b.beads) if (this.touch(a.beads[0], q)) return true;
      for (const p of a.beads) if (this.touch(b.beads[0], p)) return true;
    }
    return false;
  }

  alive(s) { return !s.deadUntil && s.beads.length > 0; }

  touch(p, q) {
    if (Math.abs(p.z - q.z) > S.jumpClearance) return false;
    return toroidalDist2(p.x, p.y, q.x, q.y, MAP) < HIT_D2;
  }

  // ---------- Items ----------

  countNormalItems() {
    let n = 0;
    for (const it of this.items) if (it.c !== WILD) n++;
    return n;
  }

  refillItems() {
    let guard = 0;
    while (this.countNormalItems() < CONFIG.items.count
      && this.items.length < CONFIG.items.maxOnMap && guard++ < 200) {
      let x = randRange(0, MAP), y = randRange(0, MAP);
      for (let i = 0; i < 12; i++) {
        if (this.nearestBeadDist(x, y, -1) > CONFIG.items.minSpawnDistance) break;
        x = randRange(0, MAP); y = randRange(0, MAP);
      }
      this.items.push({ id: this.nextItemId++, x, y, c: randInt(NCOL) });
    }
  }

  /** Periodically spawn a cluster of wild beads somewhere random */
  tickWildClusters(dt) {
    const W = CONFIG.items.wild;
    this.wildTimer -= dt;
    if (this.wildTimer > 0) return;
    this.wildTimer = W.intervalSec;

    let onMap = 0;
    for (const it of this.items) if (it.c === WILD) onMap++;
    if (onMap + W.clusterSize > W.maxOnMap) return;
    if (this.items.length + W.clusterSize > CONFIG.items.maxOnMap) return;

    let cx = randRange(0, MAP), cy = randRange(0, MAP);
    for (let i = 0; i < 12; i++) {
      if (this.nearestBeadDist(cx, cy, -1) > CONFIG.items.minSpawnDistance + W.spread) break;
      cx = randRange(0, MAP); cy = randRange(0, MAP);
    }
    for (let i = 0; i < W.clusterSize; i++) {
      const a = (i / W.clusterSize) * Math.PI * 2 + randRange(0, 1);
      const r = i === 0 ? 0 : W.spread * (0.5 + Math.random() * 0.5);
      this.items.push({
        id: this.nextItemId++,
        x: wrap(cx + Math.cos(a) * r, MAP),
        y: wrap(cy + Math.sin(a) * r, MAP),
        c: WILD,
      });
    }
    this.events.push({ t: EV.WILD, p: [r2(cx), r2(cy)] });
  }

  pickupItems() {
    for (const s of this.snakes.values()) {
      if (!this.alive(s)) continue;
      const head = s.beads[0];
      if (head.z > S.beadRadius) continue;        // No eating mid-jump: press space to skip a color you do not want
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

  // ---------- Collisions ----------

  resolveCollisions() {
    const list = [...this.snakes.values()].filter((s) => this.alive(s));
    const done = new Set();   // snakes already resolved this frame, so nothing cascades twice

    // 1) Head on head
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        if (done.has(a.id) || done.has(b.id)) continue;
        if (this.immune(a) || this.immune(b)) continue;
        if (!this.touch(a.beads[0], b.beads[0])) continue;
        this.headOn(a, b);
        done.add(a.id); done.add(b.id);
      }
    }

    // 2) Head into another body -> sever and graft the tail
    for (const a of list) {
      if (done.has(a.id) || this.immune(a) || !this.alive(a)) continue;
      const head = a.beads[0];
      let best = null;
      for (const b of list) {
        if (b === a || done.has(b.id) || this.immune(b) || !this.alive(b)) continue;
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

    // 3) Into ourselves
    if (S.selfCollision === 'die') {
      for (const a of list) {
        if (this.immune(a) || this.time < a.noSelfUntil || !this.alive(a)) continue;
        const head = a.beads[0];
        for (let k = S.selfCollisionMinIndex; k < a.beads.length; k++) {
          if (!this.touch(head, a.beads[k])) continue;
          this.kill(a, 'themselves');
          break;
        }
      }
    }
  }

  /** Head on head: whoever hit more squarely wins, loses one head bead, and kills the
   *  other; a dead heat kills both */
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

    if (Math.abs(fa - fb) < S.headOnTieEpsilon) {   // equally square, both die
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

  /** a's head hit b's bead k: b keeps the front part, the tail is reversed and grafted
   *  in front of a's head */
  severTail(a, b, k) {
    const p = a.beads[0];
    const hit = [r2(p.x), r2(p.y), r2(p.z)];
    const before = a.colors.length;
    const sev = b.severAt(k);
    b.beads = b.computeBeads();
    a.prependChain(sev.pts, sev.colors, this.time);
    a.beads = a.computeBeads();
    // Beads actually gained: prependChain truncates at maxLength, so use the length
    // difference rather than the size of the severed piece
    this.events.push({
      t: EV.HITBODY, p: hit,
      aid: a.id, an: a.name, bid: b.id, bn: b.name,
      n: a.colors.length - before,
    });
  }

  // ---------- Death and respawn ----------

  kill(s, byName) {
    if (s.deadUntil) return;
    const head = s.beads[0] || { x: s.x, y: s.y, z: 0 };
    // The beads vanish with the snake, nothing is dropped; these coordinates only feed
    // the client-side burst
    const beads = s.beads.map((b, i) => [r2(b.x), r2(b.y), r2(b.z), s.colors[i]]);
    s.deathPos = { x: wrap(head.x, MAP), y: wrap(head.y, MAP) };
    s.deadUntil = this.time + S.deathPauseSec;
    s.colors = [];
    s.beads = [];
    this.events.push({
      t: EV.DEATH, id: s.id, name: s.name, by: byName,
      p: [r2(s.deathPos.x), r2(s.deathPos.y), 0], beads,
    });
  }

  /** A win pauses in place just like a death, so the player can read the panel, then
   *  starts a fresh run */
  beginWinPause(s) {
    s.deathPos = { x: wrap(s.x, MAP), y: wrap(s.y, MAP) };
    s.deadUntil = this.time + S.winPauseSec;
    s.won = true;
  }

  respawnDead() {
    for (const s of this.snakes.values()) {
      if (!s.deadUntil || this.time < s.deadUntil) continue;
      s.deadUntil = 0;
      if (s.won) {
        s.won = false;
        this.placeAtFreeSpot(s);                  // after a win: start over somewhere else
      } else {
        this.placeAtFreeSpot(s, s.deathPos);      // after a death: near where we fell, so the marker is in view
      }
      s.beads = s.computeBeads();
      this.events.push({ t: EV.RESPAWN, id: s.id, p: [r2(s.x), r2(s.y)] });
    }
  }

  // ---------- Matching and winning ----------

  resolveMatchesAndWins() {
    for (const s of this.snakes.values()) {
      if (s.deadUntil) continue;                  // length is 0 while paused; that is not a win
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
        this.beginWinPause(s);
      }
    }
  }

  // ---------- Snapshots ----------

  /** One frame of positions. Items go through itemsSnapshot() instead of repeating here. */
  frame() {
    const snakes = [];
    for (const s of this.snakes.values()) {
      const row = {
        id: s.id, n: s.name, sk: s.skin, ai: s.isAI ? 1 : 0,
        tr: s.trophies, d: r3(s.dir), iv: r2(Math.max(0, s.invulnUntil - this.time)),
        c: s.colors, b: [],
      };
      if (s.deadUntil) {
        row.dead = r2(s.deadUntil - this.time);   // seconds of pause left
        row.dp = [r2(s.deathPos.x), r2(s.deathPos.y)];
        if (s.won) row.win = 1;                   // this pause is a win, not a death
      } else {
        const b = new Array(s.beads.length * 3);
        for (let i = 0; i < s.beads.length; i++) {
          b[i * 3] = r2(s.beads[i].x);
          b[i * 3 + 1] = r2(s.beads[i].y);
          b[i * 3 + 2] = r2(s.beads[i].z);
        }
        row.b = b;
      }
      snakes.push(row);
    }
    return { st: r3(this.time), snakes };
  }

  itemsSnapshot() {
    return this.items.map((it) => [it.id, r2(it.x), r2(it.y), it.c]);
  }
}
