// Retention features: profiles v2 (one per address, one rename, weekly settlement, daily
// tasks, achievements) and the world rules built on them (crown, regicide, revenge, streaks,
// the near-win alert, room events).
// Run with: node tests/retention.js   (uses a scratch database, never database/db.json)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sm3-')), 'db.json');
process.env.SM3_DB = DB;

const { CONFIG } = await import('../config/game.config.js');
CONFIG.ai.count = 0;
CONFIG.map.size = 60;
CONFIG.retention.roomEvents.intervalSec = 2;
CONFIG.retention.roomEvents.warnSec = 1;
CONFIG.retention.roomEvents.durationSec = 2;

const { Profiles, weekKey, dayKey } = await import('../server/profiles.js');
const { World } = await import('../server/world.js');
const { EV, WILD } = await import('../shared/protocol.js');

const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const write = (obj) => fs.writeFileSync(DB, JSON.stringify(obj));

// ---- v1 -> v2 migration: best record per address, unique names ----
{
  write({
    players: {
      '10.0.0.1::alice': { ip: '10.0.0.1', nickname: 'alice', trophies: 2 },
      '10.0.0.1::al': { ip: '10.0.0.1', nickname: 'al', trophies: 5 },
      '10.0.0.2::alice': { ip: '10.0.0.2', nickname: 'alice', trophies: 1 },
    },
    historyByIp: { '10.0.0.1': ['alice', 'al'] },
  });
  const P = new Profiles();
  assert(P.map.size === 2, 'one profile per address after migration');
  assert(P.byIp('10.0.0.1').nickname === 'al' && P.byIp('10.0.0.1').trophies === 5, 'the record with most trophies survives');
  assert(P.byIp('10.0.0.2').nickname === 'alice', 'the other address keeps its name');
  const saved = JSON.parse(fs.readFileSync(DB, 'utf8'));
  assert(saved.version === 2 && saved.players['10.0.0.1'], 'migrated layout written back');
  console.log('migration OK');
}

// ---- one rename, then locked; nicknames unique across addresses ----
{
  fs.rmSync(DB);
  const P = new Profiles();
  const a = P.create('1.1.1.1', 'Ann');
  assert(P.canRename(a), 'a fresh profile may rename once');
  P.rename(a, 'Annie');
  assert(a.nickname === 'Annie' && !P.canRename(a), 'renamed once and locked');
  assert(P.byNickname('Annie') === a && P.byNickname('Ann') === null, 'lookup follows the rename');
  assert(P.takenNicknames('2.2.2.2').includes('Annie') && !P.takenNicknames('1.1.1.1').includes('Annie'), 'own name is not "taken" for oneself');
  console.log('rename OK');
}

// ---- weekly settlement: last week's top three get medals, the hall records them ----
{
  fs.rmSync(DB);
  const now = weekKey();
  write({
    version: 2, settledWeek: '2000-W01', hall: [],
    players: {
      a: { ip: 'a', nickname: 'A', trophies: 9, weekly: { key: '2000-W02', trophies: 3 } },
      b: { ip: 'b', nickname: 'B', trophies: 9, weekly: { key: '2000-W02', trophies: 5 } },
      c: { ip: 'c', nickname: 'C', trophies: 9, weekly: { key: '2000-W02', trophies: 1 } },
      d: { ip: 'd', nickname: 'D', trophies: 9, weekly: { key: '2000-W02', trophies: 0 } },
    },
  });
  const P = new Profiles();
  assert(P.settledWeek === now, 'settled to the current week');
  assert(P.byIp('b').medal === 1 && P.byIp('a').medal === 2 && P.byIp('c').medal === 3 && P.byIp('d').medal === 0, 'medals by last week trophies');
  assert(P.hall.length === 1 && P.hall[0].week === '2000-W02' && P.hall[0].top[0].nickname === 'B', 'hall entry recorded');
  assert(P.weeklyTrophies(P.byIp('b')) === 0, 'old weekly count does not leak into this week');
  P.addTrophy(P.byIp('b'), 2);
  assert(P.weeklyTrophies(P.byIp('b')) === 2 && P.byIp('b').trophies === 11, 'addTrophy counts for the week and the total');
  console.log('weekly settlement OK');
}

// ---- daily tasks, first win, achievements ----
{
  fs.rmSync(DB);
  const { Progress } = await import('../server/progress.js');
  const P = new Profiles();
  const p = P.create('9.9.9.9', 'Zed');
  const G = new Progress(P);
  let trophies = 0;
  for (let i = 0; i < CONFIG.retention.dailyTasks.eat; i++) trophies += G.onEat(p);
  assert(trophies === 1 && p.daily.done.eat, 'eat task pays exactly once');
  trophies += G.onEat(p);
  assert(trophies === 1, 'no second payment');
  assert(G.onWin(p, 1) === CONFIG.retention.firstWinBonus && G.onWin(p, 2) === 0, 'first win bonus once a day');
  assert(p.achievements.firstWin && p.bestStreak === 2, 'first win achievement and best streak');
  G.onWin(p, 5);
  assert(p.achievements.streak5, 'streak5 achievement');
  G.onMatch(p, [{ wild: false }, { wild: true }, { wild: false }]);
  assert(p.achievements.chain3 && p.achievements.wildMatch && p.daily.chain === 1 && p.daily.done.chain, 'chain and wild achievements, chain task');
  const n = G.drain();
  assert(n.length === 1 && n[0].ip === '9.9.9.9' && n[0].unlocked.includes('chain3') && n[0].tasks.includes('eat'), 'one notice per address with what changed');
  assert(G.drain().length === 0, 'drained');
  p.daily.date = '1999-01-01';
  G.onEat(p);
  assert(p.daily.date === dayKey() && p.daily.eat === 1 && !p.daily.firstWin, 'daily block rolls over');
  console.log('daily/achievements OK');
}

// ---- world: crown, regicide, revenge, streaks, near-win alert, room events ----
{
  fs.rmSync(DB);
  const P = new Profiles();
  const W = new World(P);
  const dt = 1 / CONFIG.net.tickRate;
  const pa = P.create('a', 'A'), pb = P.create('b', 'B');
  pa.trophies = 3; pb.trophies = 3;
  const a = W.addPlayer(pa, 'glass'), b = W.addPlayer(pb, 'glass');
  const events = () => W.events;

  W.frame();
  assert(W.crownId === null || [a.id, b.id].includes(W.crownId), 'crown among players');
  W.award(b, 1);                                   // B pulls ahead
  W.frame();
  assert(W.crownId === b.id, 'crown follows the most trophies');
  W.award(a, 1);                                   // tie at 4: A got there last
  W.frame();
  assert(W.crownId === a.id, 'tie goes to whoever got there last');

  // Regicide: B kills the crown holder A
  W.events = [];
  W.kill(a, 'headLost', b);
  assert(pb.trophies === 5 && events().some((e) => e.t === EV.REGICIDE && e.by === 'B'), 'regicide pays the killer');
  assert(a.nemesisId === b.id, 'the victim remembers the killer');
  assert(pa.nemeses.b === 1, 'nemesis tally persisted');
  // Revenge: A gets B back within the window
  W.time += 1; W.events = []; a.deadUntil = 0; a.colors = [0]; a.beads = a.computeBeads(W.mapSize);
  W.kill(b, 'headLost', a);
  assert(pa.trophies === 5 && events().some((e) => e.t === EV.REVENGE && e.by === 'A'), 'revenge pays');
  assert(a.nemesisId === null, 'revenge clears the grudge');
  // A head-on tie must not count as revenge for either side
  W.time += 1; W.events = [];
  for (const s of [a, b]) { s.deadUntil = 0; s.nemesisId = null; s.colors = [0]; s.beads = s.computeBeads(W.mapSize); }
  W.kill(a, 'headTie', b); W.kill(b, 'headTie', a);
  assert(!events().some((e) => e.t === EV.REVENGE), 'a tie is nobody\'s revenge');
  assert(pa.achievements.tie, 'tie achievement');

  // Streaks: two wins then a death
  for (const s of [a, b]) { s.deadUntil = 0; s.colors = [0]; s.beads = s.computeBeads(W.mapSize); }
  W.events = []; W.win(a); a.deadUntil = 0; W.win(a);
  assert(a.streak === 2 && events().filter((e) => e.t === EV.WIN).every((e) => e.streak >= 1), 'streak counts wins');
  W.events = []; a.deadUntil = 0; a.colors = [0]; a.beads = a.computeBeads(W.mapSize);
  W.kill(a, 'self', null);
  assert(a.streak === 0 && events().some((e) => e.t === EV.DEATH && e.streak === 2), 'death ends the streak and says so');

  // Near-win alert fires once per run
  a.deadUntil = 0; a.colors = [0, 1, 2]; a.beads = a.computeBeads(W.mapSize); a.nearWinTold = false;
  W.events = []; W.resolveMatchesAndWins();
  const nearA = () => events().filter((e) => e.t === EV.NEARWIN && e.id === a.id).length;
  assert(nearA() === 1, 'alert fires');
  W.events = []; W.resolveMatchesAndWins();
  assert(nearA() === 0, 'not twice');
  assert(W.frame().snakes.find((s) => s.id === a.id).nw === 1, 'frame carries the alert flag');

  // Room events: warn -> on -> idle, brawl cuts everyone down, double pays double
  a.colors = new Array(30).fill(0).map((_, i) => i % 3); a.beads = a.computeBeads(W.mapSize);
  let seen = [];
  for (let t = 0; t < 6; t += dt) {
    W.roomEvents.tick(dt, W.events, (k) => W.onRoomEvent(k));
    for (const e of W.events) if (e.t === EV.ROOMEVENT) seen.push(e.phase);
    if (W.roomEvents.active('brawl')) assert(a.colors.length <= CONFIG.retention.roomEvents.brawlLength, 'brawl cut everyone');
    W.events = [];
  }
  assert(seen.join(',').startsWith('warn,on,idle'), `phases in order, got ${seen}`);
  W.roomEvents.phase = 'on'; W.roomEvents.kind = 'double';
  const before = a.trophies;
  a.deadUntil = 0; a.colors = []; W.win(a);
  assert(a.trophies - before >= 2, 'double trophies during the event');
  console.log('world rules OK');
}

fs.rmSync(path.dirname(DB), { recursive: true, force: true });
console.log('retention OK');
