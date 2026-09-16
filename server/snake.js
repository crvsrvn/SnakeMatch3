// The snake entity: continuous motion along a polyline trail.
// Core invariant: bead i always sits at arc length i * beadSpacing back along the trail.
// That makes eating (insert at the head), matching (array splice) and grafting a severed
// tail (splice the polyline) all plain array operations.
// Coordinates stay unwrapped internally and are only reduced into the map when they are
// published or tested for collision.

import { CONFIG } from '../config/game.config.js';
import { wrap, turnToward } from '../shared/mathUtil.js';

const S = CONFIG.snake;
const TRAIL_LEN = S.maxLength * S.beadSpacing + 3; // arc length of trail we keep

export class Snake {
  constructor(id, name, isAI, skin) {
    this.id = id;
    this.name = name;
    this.isAI = isAI;
    this.skin = skin;
    this.trophies = 0;
    this.trophyAt = -1;       // world time of the last trophy; breaks ties for the crown
    this.streak = 0;          // wins without dying in between
    this.nemesisId = null;    // who killed us last, for the revenge window
    this.nemesisUntil = 0;
    this.nearWinTold = false; // the "almost cleared" alert fired for this run
    this.title = null;        // achievement id shown before the name, players only

    this.colors = [];
    this.trail = [];          // index 0 = newest (the head); entries are {x,y,z,o}
    this.odo = 0;             // odometer; arc length from the head = odo - point.o
    this.x = 0; this.y = 0; this.z = 0;
    this.dir = 0;
    this.targetDir = 0;
    this.sprint = false;
    this.jumpT = -1;          // < 0 means not airborne
    this.jumpCd = 0;
    this.invulnUntil = 0;
    this.invulnHardUntil = 0; // hard cap on the overlap grace, so nobody stays invulnerable forever
    this.noSelfUntil = 0;     // brief self-collision waiver after grafting a tail
    this.deadUntil = 0;       // > world.time while paused (either dead or settling a win)
    this.won = false;         // the pause is a win, not a death
    this.deathPos = null;     // head position at death; the camera and marker use it while paused
    this.beads = [];          // bead world positions cached each frame (already wrapped)
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
    this.invulnHardUntil = this.invulnUntil + S.invulnGraceMax;
    this.noSelfUntil = now + S.spawnInvulnerable;
    this.deadUntil = 0;
    // Lay a straight trail backwards, so the body is complete the instant we spawn
    this.trail = [];
    const cx = Math.cos(angle), cy = Math.sin(angle);
    for (let d = 0; d <= TRAIL_LEN; d += 0.3) {
      this.trail.push({ x: x - cx * d, y: y - cy * d, z: 0, o: -d });
    }
  }

  /** Bots never sprint */
  sprinting() { return this.sprint && !this.isAI; }

  speed() {
    return S.baseSpeed * (this.sprinting() ? S.sprintMultiplier : 1);
  }

  /** Turning gets sluggish while sprinting: go fast, give up the tight corners */
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
      else this.z = S.jumpHeight * 4 * u * (1 - u); // parabola
    }

    this.trail.unshift({ x: this.x, y: this.y, z: this.z, o: this.odo });
    // Trim, keeping the second to last point still covering the arc length we need
    while (this.trail.length > 2 && this.odo - this.trail[this.trail.length - 2].o > TRAIL_LEN) {
      this.trail.pop();
    }
  }

  /**
   * Insert a bead at the head. The head jumps one spacing forward along its heading, so every
   * existing bead keeps its place and the new one appears in front, instead of the whole body
   * shifting back by a bead.
   */
  prependBead(c) {
    this.colors.unshift(c);
    const d = S.beadSpacing;
    this.x += Math.cos(this.dir) * d;
    this.y += Math.sin(this.dir) * d;
    this.odo += d;
    this.trail.unshift({ x: this.x, y: this.y, z: this.z, o: this.odo });
  }

  /** Point at arc length d back from the head (not wrapped) */
  pointAt(d) {
    const t = this.trail;
    let i = 0;
    while (i < t.length - 1 && this.odo - t[i + 1].o < d) i++;
    const a = t[i], b = t[Math.min(i + 1, t.length - 1)];
    const da = this.odo - a.o, db = this.odo - b.o;
    const k = db > da ? (d - da) / (db - da) : 0;
    return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k };
  }

  /** World positions of every bead, wrapped into a map of edge mapSize */
  computeBeads(mapSize) {
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
        x: wrap(a.x + (b.x - a.x) * k, mapSize),
        y: wrap(a.y + (b.y - a.y) * k, mapSize),
        z: a.z + (b.z - a.z) * k,
      });
    }
    return out;
  }

  /**
   * Cut at bead k: keep [0, k) and return the severed piece.
   * @returns {{pts: Array<{x,y,z}>, colors: number[]}} pts ordered from the cut towards the tail tip
   */
  severAt(k) {
    const startD = k * S.beadSpacing;
    const endD = (this.colors.length - 1) * S.beadSpacing;
    const pts = [this.pointAt(startD)];
    for (const p of this.trail) {          // the trail is ordered by increasing arc length
      const d = this.odo - p.o;
      if (d > startD && d < endD) pts.push({ x: p.x, y: p.y, z: p.z });
    }
    if (endD > startD) pts.push(this.pointAt(endD));
    const colors = this.colors.slice(k);
    this.colors.length = k;
    return { pts, colors };
  }

  /**
   * Graft a severed tail in front of our head: the new head is their tail tip and the
   * colors go on reversed.
   * pts must run from the joint towards the tail tip. Like prependBead, the joint lands one
   * spacing ahead of our head, so every bead we already had keeps its place.
   */
  prependChain(pts, colors, now) {
    const base = pts[0];
    const jx = this.x + Math.cos(this.dir) * S.beadSpacing;
    const jy = this.y + Math.sin(this.dir) * S.beadSpacing;
    const mapped = [];
    for (let i = pts.length - 1; i >= 0; i--) {   // reversed: tail tip first, the joint last
      mapped.push({
        x: jx + (pts[i].x - base.x),
        y: jy + (pts[i].y - base.y),
        z: this.z + (pts[i].z - base.z),
        o: 0,
      });
    }

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

    this.colors = colors.slice().reverse().concat(this.colors);
    if (this.colors.length > S.maxLength) this.colors.length = S.maxLength;
    this.noSelfUntil = now + 0.8;

    while (this.trail.length > 2 && this.odo - this.trail[this.trail.length - 2].o > TRAIL_LEN) {
      this.trail.pop();
    }
  }
}
