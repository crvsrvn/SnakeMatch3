// The authoritative world: a fixed-step simulation of every snake, item, collision and
// match, producing the frames that get broadcast.

import { CONFIG } from '../config/game.config.js';
import { EV, WILD } from '../shared/protocol.js';
import { wrap, toroidalDelta, toroidalDist2, randRange, randInt } from '../shared/mathUtil.js';
import { Snake } from './snake.js';
import { AIBrain } from './ai.js';
import { resolveMatches, randomColors } from './match3.js';
import { Progress } from './progress.js';
import { RoomEvents } from './roomEvents.js';

const S = CONFIG.snake;
const R = CONFIG.retention;
const NCOL = CONFIG.colors.length;
const HIT_D2 = (S.beadRadius * 2 * S.hitFactor) ** 2;
const EAT_D2 = (S.beadRadius + CONFIG.items.radius) ** 2;

const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;

export class World {
  constructor(profiles) {
    this.profiles = profiles;
    this.progress = new Progress(profiles);
    this.roomEvents = new RoomEvents();
    this.crownId = null;              // the player wearing the crown this frame, if any
    this.snakes = new Map();
    this.brains = new Map();
    this.items = [];
    this.events = [];
    this.time = 0;
    this.nextId = 1;
    this.nextItemId = 1;
    this.wildTimer = CONFIG.items.wild.intervalSec * 0.4;   // hold off a little before the first cluster
    this.mapSize = CONFIG.map.size;   // current edge; grows and shrinks with the player count

    for (let i = 0; i < CONFIG.ai.count; i++) this.spawnAI();
    this.refillItems();
  }

  // ---------- Lifecycle ----------

  /** Bots take the lowest free number: bot1, bot2, ... so a returning bot fills the gap */
  spawnAI() {
    let i = 0;
    while (this.isNameTaken(`bot${i + 1}`)) i++;
    const s = new Snake(this.nextId++, `bot${i + 1}`, true, CONFIG.skins[i % CONFIG.skins.length]);
    this.placeAtFreeSpot(s);
    this.snakes.set(s.id, s);
    this.brains.set(s.id, new AIBrain());
    return s;
  }

  /**
   * Bots and map size follow the player count, to be called after a player joins or leaves:
   * every player replaces one bot until none are left, and brings areaPerPlayer of field.
   * @returns true if the map size changed and the clients have to be told
   */
  rebalance() {
    const bots = [...this.snakes.values()].filter((s) => s.isAI);
    const players = this.snakes.size - bots.length;
    const want = Math.max(0, CONFIG.ai.count - players);
    while (bots.length > want) this.removeSnake(bots.pop().id);
    while (bots.length < want) bots.push(this.spawnAI());

    const M = CONFIG.map;
    const size = Math.ceil(Math.sqrt(M.size ** 2 + players * M.areaPerPlayer) / M.gridStep) * M.gridStep;
    if (size === this.mapSize) return false;
    this.resize(size);
    return true;
  }

  /**
   * Growing needs nothing else: every position is still inside. Shrinking folds the strip
   * beyond the new edge back onto the map, so items there are wrapped, and any snake that
   * was in it gets the spawn grace -- a wall moving onto you is not a collision you caused.
   */
  resize(size) {
    const shrinking = size < this.mapSize;
    this.mapSize = size;
    if (!shrinking) return;
    for (const it of this.items) { it.x = wrap(it.x, size); it.y = wrap(it.y, size); }
    for (const s of this.snakes.values()) {
      if (!s.beads.some((b) => b.x >= size || b.y >= size)) continue;
      s.invulnUntil = this.time + S.spawnInvulnerable;
      s.invulnHardUntil = s.invulnUntil + S.invulnGraceMax;
    }
  }

  /** Items follow the area, so a grown map is stocked as densely as the base one */
  get itemScale() { return (this.mapSize / CONFIG.map.size) ** 2; }

  addPlayer(profile, skin) {
    const s = new Snake(this.nextId++, profile.nickname, false, skin);
    s.profile = profile;
    s.trophies = profile.trophies;
    s.title = profile.title;
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

  /** Append digits to the requested name until it is free, still within 12 characters
   *  @param taken (name) => bool, defaults to "in play"; the server adds names other addresses own */
  freeVariant(name, taken = (n) => this.isNameTaken(n)) {
    const base = name.replace(/\d+$/, '') || name;
    for (let i = 2; i < 1000; i++) {
      const suffix = String(i);
      const c = base.slice(0, Math.max(1, 12 - suffix.length)) + suffix;
      if (!taken(c)) return c;
    }
    return this.freeDefaultName(taken);
  }

  /**
   * Default nickname when the player leaves the field blank: Snake 1, Snake 2, ...
   * (skipping numbers already in use). It stays in one language on purpose -- a nickname
   * is shown to every other player, so it cannot follow one viewer's UI language.
   */
  freeDefaultName(taken = (n) => this.isNameTaken(n)) {
    for (let n = 1; ; n++) if (!taken(`Snake ${n}`)) return `Snake ${n}`;
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
        x = wrap(near.x + Math.cos(a) * r, this.mapSize);
        y = wrap(near.y + Math.sin(a) * r, this.mapSize);
      } else {
        x = randRange(0, this.mapSize); y = randRange(0, this.mapSize);
      }
      const d = this.nearestBeadDist(x, y, s.id);
      if (d > bestD) { bestD = d; best = { x, y }; }
      if (d > (near ? 5 : 14)) break;
    }
    s.respawn(best.x, best.y, randRange(0, Math.PI * 2),
      randomColors(S.initialLength, NCOL), this.time);
    s.beads = s.computeBeads(this.mapSize);   // the body is complete the instant we spawn
  }

  nearestBeadDist(x, y, skipId) {
    let min = Infinity;
    for (const s of this.snakes.values()) {
      if (s.id === skipId || s.deadUntil) continue;
      for (const b of s.beads) min = Math.min(min, toroidalDist2(x, y, b.x, b.y, this.mapSize));
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
      if (brain) brain.update(s, dt, this.mapSize);
      s.step(dt);
    }
    for (const s of this.snakes.values()) {
      if (!s.deadUntil) s.beads = s.computeBeads(this.mapSize);
    }

    this.pickupItems();
    this.updateInvuln();
    this.resolveCollisions();
    this.resolveMatchesAndWins();
    this.refillItems();
    this.tickWildClusters(dt);
    this.roomEvents.tick(dt, this.events, (kind) => this.onRoomEvent(kind));
  }

  /** One-off reactions when a room event begins; the ongoing ones are read where they apply */
  onRoomEvent(kind) {
    if (kind !== 'brawl') return;
    // Brawl: everyone alive is cut down to a few beads, so the next minute is a scramble
    for (const s of this.snakes.values()) {
      if (!this.alive(s) || s.colors.length <= R.roomEvents.brawlLength) continue;
      s.colors.length = R.roomEvents.brawlLength;
      s.beads = s.computeBeads(this.mapSize);
    }
  }

  /** Every trophy goes through here, so the in-memory count, the tie-breaker and the profile agree */
  award(s, n) {
    s.trophies += n;
    s.trophyAt = this.time;
    if (s.profile) this.profiles.addTrophy(s.profile, n);
  }

  /** Run a progress hook for a player (bots have no profile) and award what it returns */
  track(s, hook, ...args) {
    if (!s.profile) return;
    const n = this.progress[hook](s.profile, ...args);
    if (n) this.award(s, n);
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
    return toroidalDist2(p.x, p.y, q.x, q.y, this.mapSize) < HIT_D2;
  }

  // ---------- Items ----------

  countNormalItems() {
    let n = 0;
    for (const it of this.items) if (it.c !== WILD) n++;
    return n;
  }

  refillItems() {
    let guard = 0;
    while (this.countNormalItems() < CONFIG.items.count * this.itemScale
      && this.items.length < CONFIG.items.maxOnMap * this.itemScale && guard++ < 200) {
      let x = randRange(0, this.mapSize), y = randRange(0, this.mapSize);
      for (let i = 0; i < 12; i++) {
        if (this.nearestBeadDist(x, y, -1) > CONFIG.items.minSpawnDistance) break;
        x = randRange(0, this.mapSize); y = randRange(0, this.mapSize);
      }
      this.items.push({ id: this.nextItemId++, x, y, c: randInt(NCOL) });
    }
  }

  /** Periodically spawn a cluster of wild beads somewhere random */
  tickWildClusters(dt) {
    const W = CONFIG.items.wild;
    const rate = this.roomEvents.active('rainbow') ? R.roomEvents.rainbowRate : 1;   // rainbow shower
    this.wildTimer -= dt * rate;
    if (this.wildTimer > 0) return;
    this.wildTimer = W.intervalSec;

    let onMap = 0;
    for (const it of this.items) if (it.c === WILD) onMap++;
    if (onMap + W.clusterSize > W.maxOnMap * rate) return;
    if (this.items.length + W.clusterSize > CONFIG.items.maxOnMap * this.itemScale) return;

    let cx = randRange(0, this.mapSize), cy = randRange(0, this.mapSize);
    for (let i = 0; i < 12; i++) {
      if (this.nearestBeadDist(cx, cy, -1) > CONFIG.items.minSpawnDistance + W.spread) break;
      cx = randRange(0, this.mapSize); cy = randRange(0, this.mapSize);
    }
    for (let i = 0; i < W.clusterSize; i++) {
      const a = (i / W.clusterSize) * Math.PI * 2 + randRange(0, 1);
      const r = i === 0 ? 0 : W.spread * (0.5 + Math.random() * 0.5);
      this.items.push({
        id: this.nextItemId++,
        x: wrap(cx + Math.cos(a) * r, this.mapSize),
        y: wrap(cy + Math.sin(a) * r, this.mapSize),
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
        if (toroidalDist2(head.x, head.y, it.x, it.y, this.mapSize) >= EAT_D2) continue;
        this.items.splice(i, 1);
        s.prependBead(it.c);
        s.beads = s.computeBeads(this.mapSize);
        this.events.push({ t: EV.EAT, p: [r2(it.x), r2(it.y), 0], c: it.c, sid: s.id });
        this.track(s, 'onEat');
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
          const d2 = toroidalDist2(head.x, head.y, b.beads[k].x, b.beads[k].y, this.mapSize);
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
          this.kill(a, 'self', null);
          break;
        }
      }
    }
  }

  /** Head on head: whoever hit more squarely wins, loses one head bead, and kills the
   *  other; a dead heat kills both */
  headOn(a, b) {
    const ha = a.beads[0], hb = b.beads[0];
    const dx = toroidalDelta(ha.x, hb.x, this.mapSize), dy = toroidalDelta(ha.y, hb.y, this.mapSize);
    const len = Math.hypot(dx, dy) || 1e-6;
    const fa = (Math.cos(a.dir) * dx + Math.sin(a.dir) * dy) / len;
    const fb = (Math.cos(b.dir) * -dx + Math.sin(b.dir) * -dy) / len;

    this.events.push({
      t: EV.HITHEAD,
      p: [r2(ha.x + dx / 2), r2(ha.y + dy / 2), r2((ha.z + hb.z) / 2)],
    });

    if (Math.abs(fa - fb) < S.headOnTieEpsilon) {   // equally square, both die
      this.kill(a, 'headTie', b); this.kill(b, 'headTie', a);
    } else if (fa > fb) {
      this.popHead(a); this.kill(b, 'headLost', a);
    } else {
      this.popHead(b); this.kill(a, 'headLost', b);
    }
  }

  popHead(s) {
    if (!s.colors.length) return;
    s.colors.shift();
    s.beads = s.computeBeads(this.mapSize);
  }

  /** a's head hit b's bead k: b keeps the front part, the tail is reversed and grafted
   *  in front of a's head */
  severTail(a, b, k) {
    const p = a.beads[0];
    const hit = [r2(p.x), r2(p.y), r2(p.z)];
    const before = a.colors.length;
    const sev = b.severAt(k);
    b.beads = b.computeBeads(this.mapSize);
    a.prependChain(sev.pts, sev.colors, this.time);
    a.beads = a.computeBeads(this.mapSize);
    // Beads actually gained: prependChain truncates at maxLength, so use the length
    // difference rather than the size of the severed piece
    this.events.push({
      t: EV.HITBODY, p: hit,
      aid: a.id, an: a.name, bid: b.id, bn: b.name,
      n: a.colors.length - before,
    });
    this.track(a, 'onSever', a.colors.length - before);
  }

  // ---------- Death and respawn ----------

  /**
   * @param cause 'self' | 'headTie' | 'headLost' -- the client turns it into a sentence
   * @param killer the other snake, or null when we did it to ourselves
   */
  kill(s, cause, killer) {
    if (s.deadUntil) return;
    const head = s.beads[0] || { x: s.x, y: s.y, z: 0 };
    // The beads vanish with the snake, nothing is dropped; these coordinates only feed
    // the client-side burst
    const beads = s.beads.map((b, i) => [r2(b.x), r2(b.y), r2(b.z), s.colors[i]]);
    s.deathPos = { x: wrap(head.x, this.mapSize), y: wrap(head.y, this.mapSize) };
    s.deadUntil = this.time + S.deathPauseSec;
    s.colors = [];
    s.beads = [];
    const ev = {
      t: EV.DEATH, id: s.id, name: s.name, by: killer ? killer.name : s.name, cause,
      p: [r2(s.deathPos.x), r2(s.deathPos.y), 0], beads, tr: s.trophies,
    };
    if (s.streak >= 2) ev.streak = s.streak;    // a streak worth announcing just ended
    this.events.push(ev);
    s.streak = 0;
    this.track(s, 'onDeath', cause, killer?.profile || null);
    if (!killer) return;

    // Regicide: bringing down the crown holder is worth a trophy on its own
    if (s.id === this.crownId) {
      this.award(killer, R.regicideBonus);
      this.events.push({ t: EV.REGICIDE, by: killer.name, name: s.name });
      this.track(killer, 'onRegicide');
    }
    // Revenge: they killed us a moment ago and we got them back. "A moment ago" excludes
    // this very step, or the second half of a head-on tie would count as revenge for the first.
    if (killer.nemesisId === s.id && this.time < killer.nemesisUntil
        && killer.nemesisUntil - R.revengeSec < this.time) {
      killer.nemesisId = null;
      this.award(killer, R.revengeBonus);
      this.events.push({ t: EV.REVENGE, by: killer.name, name: s.name });
      this.track(killer, 'onRevenge');
    }
    s.nemesisId = killer.id;
    s.nemesisUntil = this.time + R.revengeSec;
  }

  /** A win pauses in place just like a death, so the player can read the panel, then
   *  starts a fresh run */
  beginWinPause(s) {
    s.deathPos = { x: wrap(s.x, this.mapSize), y: wrap(s.y, this.mapSize) };
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
      s.beads = s.computeBeads(this.mapSize);
      s.nearWinTold = false;
      this.events.push({ t: EV.RESPAWN, id: s.id, p: [r2(s.x), r2(s.y)], tr: s.trophies });
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
      if (groups.length) {
        s.beads = s.computeBeads(this.mapSize);
        this.track(s, 'onMatch', groups);
      }
      const n = s.colors.length;
      if (n === 0) {
        this.win(s);
      } else if (n <= R.nearWinBeads && !s.nearWinTold) {
        // Almost there: tell the room, so the last beads are the hardest to clear
        s.nearWinTold = true;
        this.events.push({ t: EV.NEARWIN, id: s.id, name: s.name, n });
      } else if (n > R.nearWinBeads) {
        s.nearWinTold = false;              // grew back (grafted a tail): the alert can fire again
      }
    }
  }

  win(s) {
    s.streak++;
    const before = s.trophies;
    this.award(s, this.roomEvents.active('double') ? 2 : 1);
    this.track(s, 'onWin', s.streak);        // daily first win adds its bonus here
    this.events.push({
      t: EV.WIN, id: s.id, name: s.name, trophies: s.trophies,
      gain: s.trophies - before, streak: s.streak,
    });
    this.beginWinPause(s);
  }

  // ---------- Snapshots ----------

  /** The crown goes to the player (never a bot) with the most trophies; ties to whoever got there last */
  updateCrown() {
    let best = null;
    for (const s of this.snakes.values()) {
      if (s.isAI || s.trophies < 1) continue;
      if (!best || s.trophies > best.trophies
          || (s.trophies === best.trophies && s.trophyAt > best.trophyAt)) best = s;
    }
    this.crownId = best ? best.id : null;
  }

  /** One frame of positions. Items go through itemsSnapshot() instead of repeating here.
   *  The retention fields (cr, ws, nw, nm, md, wk, tt) are only written when set, to keep
   *  the bot rows -- most of the packet -- as short as before. */
  frame() {
    this.updateCrown();
    const snakes = [];
    for (const s of this.snakes.values()) {
      const row = {
        id: s.id, n: s.name, sk: s.skin, ai: s.isAI ? 1 : 0,
        tr: s.trophies, d: r3(s.dir), iv: r2(Math.max(0, s.invulnUntil - this.time)),
        c: s.colors, b: [],
      };
      if (s.id === this.crownId) row.cr = 1;
      if (s.streak >= 2) row.ws = s.streak;
      if (s.nearWinTold) row.nw = 1;
      if (s.nemesisId != null && this.time < s.nemesisUntil) row.nm = s.nemesisId;
      if (s.profile) {
        if (s.profile.medal) row.md = s.profile.medal;
        const wk = this.profiles.weeklyTrophies(s.profile);
        if (wk) row.wk = wk;
        if (s.title) row.tt = s.title;
      }
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
    const f = { st: r3(this.time), snakes };
    const re = this.roomEvents.snapshot();
    if (re) f.re = re;
    return f;
  }

  itemsSnapshot() {
    return this.items.map((it) => [it.id, r2(it.x), r2(it.y), it.c]);
  }
}
