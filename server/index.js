// Local server: static assets + WebSocket endpoint + the fixed-step world loop.

import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer } from 'ws';

import { CONFIG } from '../config/game.config.js';
import { C2S, S2C } from '../shared/protocol.js';
import { Profiles } from './profiles.js';
import { World } from './world.js';

// Console window title. The image name is handled by scripts/start.js (see the notes there).
process.title = 'SnakeMatch3_Server';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

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

wss.on('connection', (ws, req) => {
  const ip = clientIp(req);
  const ctx = { snakeId: null, ip };
  clients.set(ws, ctx);

  send(ws, {
    t: S2C.WELCOME,
    config: CONFIG,
    nicknames: profiles.nicknames(ip),
    defaultNickname: world.freeDefaultName(),
    taken: world.takenNames(),
    ip,
  });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const snake = ctx.snakeId != null ? world.snakes.get(ctx.snakeId) : null;

    switch (msg.t) {
      case C2S.JOIN: {
        if (ctx.snakeId != null) return;
        const nickname = sanitizeNickname(msg.nickname, world.freeDefaultName());
        if (world.isNameTaken(nickname)) {
          // Only the reason code travels; the client renders it in its own language.
          send(ws, {
            t: S2C.REJECT,
            reason: 'nickname-taken',
            suggestion: world.freeVariant(nickname),
            taken: world.takenNames(),
          });
          console.log(`[!] ${ip} asked for the taken nickname ${nickname}, rejected`);
          return;
        }
        const skin = CONFIG.skins.includes(msg.skin) ? msg.skin : CONFIG.defaultSkin;
        const profile = profiles.get(ip, nickname);
        const s = world.addPlayer(profile, skin);
        ctx.snakeId = s.id;
        send(ws, { t: S2C.JOINED, id: s.id, nickname, skin, trophies: profile.trophies });
        console.log(`[+] ${nickname} (${ip}) joined, ${world.snakes.size} snake(s) now`);
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
      world.removeSnake(ctx.snakeId);
      console.log(`[-] ${s ? s.name : ctx.snakeId} (${ip}) left, ${world.snakes.size} snake(s) left`);
    }
    clients.delete(ws);
  });
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

setInterval(() => {
  const now = process.hrtime.bigint();
  acc += Number(now - last) / 1e9;
  last = now;
  if (acc > 0.5) acc = 0.5;          // drop frames instead of spiralling to catch up
  let steps = 0;
  while (acc >= dt && steps++ < 8) {
    world.step(dt);
    frames.push(world.frame());
    if (world.events.length) evs.push(...world.events);
    acc -= dt;
  }
  if (frames.length < FPP) return;

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
