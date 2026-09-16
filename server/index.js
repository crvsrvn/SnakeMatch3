// Local server: static assets + WebSocket endpoint + the fixed-step world loop.

import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import express from 'express';
import { WebSocketServer } from 'ws';

import { CONFIG } from '../config/game.config.js';
import { C2S, S2C, EV } from '../shared/protocol.js';
import { Profiles } from './profiles.js';
import { World } from './world.js';
import { syncInPlace } from '../shared/sync.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_URL = pathToFileURL(path.join(ROOT, 'config', 'game.config.js')).href;

const app = express();
app.use(express.static(path.join(ROOT, 'client')));
app.use('/shared', express.static(path.join(ROOT, 'shared')));
app.use('/vendor/three', express.static(path.join(ROOT, 'node_modules', 'three')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const profiles = new Profiles();
const world = new World(profiles);
/** @type {Map<import('ws').WebSocket, {snakeId:number|null, ip:string}>} */
const clients = new Map();

function clientIp(req) {
  const raw = req.socket.remoteAddress || 'unknown';
  return raw.replace(/^::ffff:/, '').replace(/^::1$/, '127.0.0.1');
}

function send(ws, obj) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

/** The config snapshot a client runs on: the map edge is whatever it has grown to by now */
function clientConfig() {
  return { ...CONFIG, map: { ...CONFIG.map, size: world.mapSize } };
}

/** Bots and map size follow the player count; everyone (login screen included) hears of a
 *  new edge, so a client that joins later boots with the right one */
function rebalance() {
  if (!world.rebalance()) return;
  for (const ws of clients.keys()) send(ws, { t: S2C.MAP, size: world.mapSize });
}

const BANNED = ['<', '>', '&', '"', "'", '\\', '`'];

function sanitizeNickname(raw, fallback) {
  // Strip control and HTML-sensitive characters: nicknames get rendered into other
  // clients name tags
  let s = '';
  for (const ch of String(raw ?? '')) {
    const code = ch.codePointAt(0);
    if (code < 0x20 || code === 0x7f) continue;
    if (BANNED.includes(ch)) continue;
    s += ch;
  }
  s = s.trim().slice(0, 12);
  return s || fallback;
}

/** A nickname is taken if someone is playing under it or another address owns it */
function nameTaken(name, ip) {
  return world.isNameTaken(name) || (profiles.byNickname(name)?.ip ?? ip) !== ip;
}

/** Everything in play plus every other address's name, so the login screen can warn early */
function takenNames(ip) {
  return [...new Set([...world.takenNames(), ...profiles.takenNicknames(ip)])];
}

/** The profile as the login screen shows it: record, standing, and what happened while away */
function profileCard(p) {
  return {
    ...world.progress.snapshot(p),
    nickname: p.nickname,
    trophies: p.trophies,
    renamesLeft: Math.max(0, CONFIG.profiles.maxRenames - p.renames),
    nemesis: profiles.topNemesis(p),
    rank: profiles.rank(p),
    overtakenBy: profiles.overtakenBy(p),
  };
}

wss.on('connection', (ws, req) => {
  const ip = clientIp(req);
  const ctx = { snakeId: null, ip, joinedAt: 0 };
  clients.set(ws, ctx);

  profiles.settleWeek();                 // a new week may have started since the last trophy
  const profile = profiles.byIp(ip);
  send(ws, {
    t: S2C.WELCOME,
    config: clientConfig(),
    profile: profile ? profileCard(profile) : null,
    hall: profiles.hall,
    firstVisit: !profile,                 // this address has never joined: show the tutorial
    defaultNickname: world.freeDefaultName((n) => nameTaken(n, ip)),
    taken: takenNames(ip),
    ip,
  });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const snake = ctx.snakeId != null ? world.snakes.get(ctx.snakeId) : null;

    switch (msg.t) {
      case C2S.JOIN: {
        if (ctx.snakeId != null) return;
        // Only the reason code travels; the client renders it in its own language.
        const reject = (reason, nickname) => {
          send(ws, {
            t: S2C.REJECT, reason,
            suggestion: reason === 'nickname-taken' ? world.freeVariant(nickname, (n) => nameTaken(n, ip)) : null,
            taken: takenNames(ip),
          });
          console.log(`[!] ${ip} asked for ${nickname}: ${reason}`);
        };
        // One address, one profile, one snake at a time. The name is chosen on the first
        // join and may be changed maxRenames times after that; a locked name is kept
        // whatever the client sent.
        let profile = profiles.byIp(ip);
        const wanted = sanitizeNickname(msg.nickname, profile ? profile.nickname : world.freeDefaultName((n) => nameTaken(n, ip)));
        if (profile && world.isNameTaken(profile.nickname)) return reject('already-playing', profile.nickname);
        if (!profile) {
          if (nameTaken(wanted, ip)) return reject('nickname-taken', wanted);
          profile = profiles.create(ip, wanted);
        } else if (wanted !== profile.nickname && profiles.canRename(profile)) {
          if (nameTaken(wanted, ip)) return reject('nickname-taken', wanted);
          console.log(`[~] ${ip} renamed ${profile.nickname} -> ${wanted}`);
          profiles.rename(profile, wanted);
        }
        const nickname = profile.nickname;
        // The client shows locks, but the server is the authority: an unknown or
        // still-locked skin silently falls back to the default one, an unearned title to none.
        const unlocked = CONFIG.skins.includes(msg.skin)
          && profile.trophies >= (CONFIG.skinUnlock[msg.skin] || 0);
        const skin = unlocked ? msg.skin : CONFIG.defaultSkin;
        profile.title = msg.title && profile.achievements[msg.title] ? msg.title : null;
        const s = world.addPlayer(profile, skin);
        ctx.snakeId = s.id;
        ctx.joinedAt = Date.now();
        rebalance();   // before JOINED, so the newcomer boots with the grown map instead of rebuilding it
        send(ws, { t: S2C.JOINED, id: s.id, nickname, skin, trophies: profile.trophies, title: profile.title });
        send(ws, { t: S2C.PROGRESS, ...world.progress.snapshot(profile), unlocked: [], tasks: [], bonus: 0 });
        console.log(`[+] ${nickname} (${ip}) joined with ${profile.trophies} trophies, skin ${skin}, ${world.snakes.size} snake(s) now, map ${world.mapSize}`);
        break;
      }
      case C2S.INPUT: {
        if (!snake) return;
        if (typeof msg.dir === 'number' && Number.isFinite(msg.dir)) snake.targetDir = msg.dir;
        snake.sprint = !!msg.sprint;
        break;
      }
      case C2S.JUMP: {
        if (snake) snake.tryJump(world.time);
        break;
      }
      case C2S.PING: {
        send(ws, { t: S2C.PONG, c: msg.c });
        break;
      }
    }
  });

  ws.on('close', () => {
    if (ctx.snakeId != null) {
      const s = world.snakes.get(ctx.snakeId);
      if (s?.profile) profiles.touchSeen(s.profile);   // "while you were away" starts now
      world.removeSnake(ctx.snakeId);
      rebalance();
      const mins = ((Date.now() - ctx.joinedAt) / 60000).toFixed(1);
      const who = s ? `${s.name} (${ip}) with ${s.trophies} trophies` : `${ctx.snakeId} (${ip})`;
      console.log(`[-] ${who} left after ${mins} min, ${world.snakes.size} snake(s) left, map ${world.mapSize}`);
    }
    clients.delete(ws);
  });
});

// ---------- Admin (loopback only): run/6-reload.cmd ----------
// Only a process on this machine can reach these; the LAN gets a 403.

app.use('/admin', (req, res, next) => {
  const a = req.socket.remoteAddress;
  if (a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1') return next();
  res.status(403).json({ error: 'admin routes are local only' });
});

/** Broadcast the live config; the client merges it into the object its modules already hold */
function broadcastConfig() {
  for (const ws of clients.keys()) send(ws, { t: S2C.CONFIG, config: clientConfig() });
}

/**
 * Re-read config/game.config.js and database/db.json without a restart. The config module
 * is imported again under a fresh query string (ESM caches by URL) and its values are
 * copied into the existing CONFIG object, so every module that imported CONFIG sees the
 * new numbers on its next read. Values consumed once at startup (port, tick rate, frames
 * per packet, client scene setup) still need a restart / page reload -- the reply says so.
 */
app.post('/admin/reload', async (req, res) => {
  const report = { config: {}, db: {} };
  try {
    const fresh = (await import(`${CONFIG_URL}?t=${Date.now()}`)).CONFIG;
    const before = Object.fromEntries(Object.keys(CONFIG).map((k) => [k, JSON.stringify(CONFIG[k])]));
    syncInPlace(CONFIG, fresh);
    report.config.changed = Object.keys(CONFIG).filter((k) => JSON.stringify(CONFIG[k]) !== before[k]);
    report.config.needsRestart = ['net'].filter((k) => report.config.changed.includes(k));
  } catch (e) {
    report.config.error = e.message;    // syntax error in the file: keep the old values
  }
  try {
    report.db.records = profiles.reload();
    for (const s of world.snakes.values()) if (s.profile) { s.trophies = s.profile.trophies; s.title = s.profile.title; }
  } catch (e) {
    report.db.error = e.message;
  }
  rebalance();                          // ai.count / map.* may have changed
  broadcastConfig();
  console.log(`[admin] reload: config ${report.config.error ? 'FAILED ' + report.config.error : report.config.changed.join(', ') || 'unchanged'}; db ${report.db.error ? 'FAILED ' + report.db.error : report.db.records + ' record(s)'}`);
  res.json(report);
});

// ---------- Fixed-step loop ----------
// The timer wakes far more often than one tick: Windows timer granularity is around 15ms,
// so waking once per tick usually produces 0 or 2 steps and the broadcast interval jumps
// between 30ms and 60ms.
// Each packet carries framesPerPacket frames; the client only interpolates, never predicts.
const dt = 1 / CONFIG.net.tickRate;
const FPP = Math.max(1, CONFIG.net.framesPerPacket);
let acc = 0;
let last = process.hrtime.bigint();
let frames = [];
let evs = [];

// Wins and deaths that involve a human; bot-on-bot traffic would drown the console.
function logEvent(ev) {
  if (ev.t === EV.WIN) {
    const s = world.snakes.get(ev.id);
    if (s && !s.isAI) console.log(`[*] ${ev.name} won, ${ev.trophies} trophies now`);
  } else if (ev.t === EV.DEATH) {
    const victim = world.snakes.get(ev.id);
    let killer = null;
    for (const s of world.snakes.values()) if (s.name === ev.by) { killer = s; break; }
    if ((victim && !victim.isAI) || (killer && !killer.isAI)) {
      const tag = (s) => (s && s.isAI ? ' (bot)' : '');
      console.log(`[x] ${ev.name}${tag(victim)} killed by ${ev.by}${tag(killer)} [${ev.cause}], ${ev.beads.length} beads lost`);
    }
  }
}

setInterval(() => {
  const now = process.hrtime.bigint();
  acc += Number(now - last) / 1e9;
  last = now;
  if (acc > 0.5) acc = 0.5;          // drop frames instead of spiralling to catch up
  let steps = 0;
  while (acc >= dt && steps++ < 8) {
    world.step(dt);
    frames.push(world.frame());
    if (world.events.length) {
      evs.push(...world.events);
      for (const ev of world.events) logEvent(ev);
    }
    acc -= dt;
  }
  if (frames.length < FPP) return;

  // Progress moved for someone: only they hear about it
  const notices = world.progress.drain();
  if (notices.length) {
    const byIp = new Map(notices.map((n) => [n.ip, n]));
    for (const [ws, ctx] of clients) {
      const n = ctx.snakeId != null && byIp.get(ctx.ip);
      if (n) send(ws, { t: S2C.PROGRESS, ...n, ip: undefined });
    }
  }

  let joined = false;
  for (const ctx of clients.values()) if (ctx.snakeId != null) { joined = true; break; }
  if (joined) {
    const payload = JSON.stringify({
      t: S2C.STATE, f: frames, items: world.itemsSnapshot(), ev: evs,
    });
    for (const [ws, ctx] of clients) {
      if (ctx.snakeId != null && ws.readyState === ws.OPEN) ws.send(payload);
    }
  }
  frames = [];
  evs = [];
}, Math.max(1, Math.floor(500 / CONFIG.net.tickRate)));

process.on('SIGINT', () => { profiles.save(); process.exit(0); });

// The port is the "one server per machine" lock. run.js probes it first for a friendly
// message, but two double-clicks racing each other still land here.
// This has to be attached to wss as well: ws re-emits the http server error on itself, and
// its listener is registered earlier, so hooking only `server` still crashes with an
// unhandled error event.
function onListenError(e) {
  if (e.code !== 'EADDRINUSE') throw e;
  console.error('');
  console.error(`  Port ${CONFIG.net.port} is already in use; the server is probably running.`);
  console.error('  Only one instance per machine. To play, double-click run/2-open-game.cmd');
  console.error('');
  process.exit(1);
}
server.on('error', onListenError);
wss.on('error', onListenError);

server.listen(CONFIG.net.port, () => {
  const addrs = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family === 'IPv4' && !ni.internal) addrs.push(ni.address);
    }
  }
  console.log('SnakeMatch3 server is up');
  console.log(`  local: http://localhost:${CONFIG.net.port}`);
  for (const a of addrs) console.log(`  LAN:   http://${a}:${CONFIG.net.port}`);
  console.log(`  ${CONFIG.ai.count} bots / ${CONFIG.items.count} items / map ${CONFIG.map.size}`);
});
