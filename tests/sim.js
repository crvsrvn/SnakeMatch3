// Headless stress and regression test: pack bots into a shrunken map, simulate for a long
// time, and check the invariants.
// Run with: node tests/sim.js
import { CONFIG } from '../config/game.config.js';

// Config has to change before world is imported: modules cache derived constants on load
CONFIG.map.size = 44;
CONFIG.ai.count = 12;
CONFIG.items.count = 30;
CONFIG.items.wild.intervalSec = 8;

const { World } = await import('../server/world.js');
const { EV, WILD } = await import('../shared/protocol.js');

// ---- Kinematics: sprinting should be faster but much harder to turn ----
{
  const { Snake } = await import('../server/snake.js');
  const radius = (sprint) => {
    const s = new Snake(1, 't', false, 'glass');   // isAI=false, or sprinting is ignored
    s.respawn(20, 20, 0, [0, 1, 2], 0);
    s.sprint = sprint;
    s.targetDir = Math.PI;                          // always ask for a U-turn -> always turn at max rate
    const dt = 1 / CONFIG.net.tickRate;
    return s.speed() / s.turnRate();                // min turn radius = speed / angular speed
  };
  const normal = radius(false), sprinting = radius(true);
  const expected = CONFIG.snake.sprintMultiplier / CONFIG.snake.sprintTurnFactor;
  console.log(`turn radius: normal ${normal.toFixed(2)}  sprinting ${sprinting.toFixed(2)}`
    + `  (${(sprinting / normal).toFixed(2)}x, expected ${expected.toFixed(2)}x)`);
  if (Math.abs(sprinting / normal - expected) > 1e-6) throw new Error('sprint turn radius does not match the config');
  if (sprinting <= normal) throw new Error('sprinting turns better than walking');
}

const world = new World({ addTrophy() {} });
const dt = 1 / CONFIG.net.tickRate;
const counts = {};
let maxLen = 0, maxBytes = 0, ticks = 0, maxItems = 0, deadSeen = 0;

const SECONDS = 120;
for (let i = 0; i < SECONDS / dt; i++) {
  world.step(dt);
  ticks++;
  for (const e of world.events) counts[e.t] = (counts[e.t] || 0) + 1;
  maxItems = Math.max(maxItems, world.items.length);
  if (world.items.length > CONFIG.items.maxOnMap) throw new Error(`too many items: ${world.items.length}`);

  for (const s of world.snakes.values()) {
    if (s.deadUntil) {
      deadSeen++;
      if (s.colors.length || s.beads.length) throw new Error('a paused snake should have no beads');
      if (!s.deathPos) throw new Error('a dead snake has no death position');
      continue;
    }
    maxLen = Math.max(maxLen, s.colors.length);
    if (s.colors.length === 0) throw new Error('a live snake has length 0 (it should have won and respawned)');
    if (s.colors.length > CONFIG.snake.maxLength) throw new Error(`over max length: ${s.colors.length}`);
    if (s.beads.length !== s.colors.length) throw new Error('bead count and color count disagree');
    for (const b of s.beads) {
      if (!Number.isFinite(b.x) || !Number.isFinite(b.y) || !Number.isFinite(b.z)) throw new Error('coordinate is NaN');
      if (b.x < 0 || b.x > CONFIG.map.size || b.y < 0 || b.y > CONFIG.map.size) throw new Error(`out of bounds ${b.x},${b.y}`);
    }
    // Neighbouring beads should sit about beadSpacing apart (toroidal distance across edges)
    for (let k = 1; k < s.beads.length; k++) {
      const p = s.beads[k - 1], q = s.beads[k];
      const h = CONFIG.map.size / 2;
      let dx = q.x - p.x, dy = q.y - p.y;
      if (dx > h) dx -= CONFIG.map.size; else if (dx < -h) dx += CONFIG.map.size;
      if (dy > h) dy -= CONFIG.map.size; else if (dy < -h) dy += CONFIG.map.size;
      const d = Math.hypot(dx, dy);
      if (d > CONFIG.snake.beadSpacing * 1.6) throw new Error(`chain broken: ${d.toFixed(2)} (snake ${s.name}, bead ${k})`);
    }
  }
  if (i % 30 === 0) {
    const packet = { f: [world.frame(), world.frame()], items: world.itemsSnapshot(), ev: world.events };
    maxBytes = Math.max(maxBytes, JSON.stringify(packet).length);
  }
}

const wildOnMap = world.items.filter((it) => it.c === WILD).length;
const packetHz = CONFIG.net.tickRate / CONFIG.net.framesPerPacket;
console.log(`simulated ${SECONDS}s / ${ticks} ticks, ${world.snakes.size} snakes`);
console.log('event counts:', counts);
console.log(`longest snake ${maxLen}  peak items ${maxItems} (cap ${CONFIG.items.maxOnMap}, ${wildOnMap} wild right now)`);
console.log(`largest packet ${maxBytes} bytes (${(maxBytes * packetHz / 1024).toFixed(1)} KB/s per client)`);

if (!deadSeen) throw new Error('no snake was ever in a death pause');
const need = [EV.EAT, EV.MATCH, EV.HITBODY, EV.DEATH, EV.RESPAWN, EV.WILD];
const missing = need.filter((k) => !counts[k]);
if (missing.length) throw new Error(`expected events never fired: ${missing.join(',')}`);
// Deaths and wins both pause before respawning, so together they should match the respawns
const paused = (counts[EV.DEATH] || 0) + (counts[EV.WIN] || 0);
if (paused !== counts[EV.RESPAWN]) {
  // Allow for snakes still paused on the last few frames
  const diff = paused - counts[EV.RESPAWN];
  if (diff < 0 || diff > world.snakes.size) throw new Error(`pause/respawn count mismatch: ${paused} vs ${counts[EV.RESPAWN]}`);
}
console.log('all invariants hold OK');
