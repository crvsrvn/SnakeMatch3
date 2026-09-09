// 本地服务器：静态资源 + WebSocket 接入 + 固定步长世界循环。

import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer } from 'ws';

import { CONFIG, SKIN_LABELS } from '../shared/config.js';
import { C2S, S2C } from '../shared/protocol.js';
import { Profiles } from './profiles.js';
import { World } from './world.js';

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

function sanitizeNickname(raw, ip) {
  // 去掉控制字符与 HTML 敏感字符：昵称会被其他客户端渲染进名牌
  let s = '';
  for (const ch of String(raw ?? '')) {
    const code = ch.codePointAt(0);
    if (code < 0x20 || code === 0x7f) continue;
    if (BANNED.includes(ch)) continue;
    s += ch;
  }
  s = s.trim().slice(0, 12);
  return s || `玩家${ip.split('.').pop() || '?'}`;
}

wss.on('connection', (ws, req) => {
  const ip = clientIp(req);
  const ctx = { snakeId: null, ip };
  clients.set(ws, ctx);

  send(ws, {
    t: S2C.WELCOME,
    config: CONFIG,
    skinLabels: SKIN_LABELS,
    suggestedNickname: profiles.suggestNickname(ip),
    ip,
  });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const snake = ctx.snakeId != null ? world.snakes.get(ctx.snakeId) : null;

    switch (msg.t) {
      case C2S.JOIN: {
        if (ctx.snakeId != null) return;
        const nickname = sanitizeNickname(msg.nickname, ip);
        const skin = CONFIG.skins.includes(msg.skin) ? msg.skin : CONFIG.defaultSkin;
        const profile = profiles.get(ip, nickname);
        const s = world.addPlayer(profile, skin);
        ctx.snakeId = s.id;
        send(ws, { t: S2C.JOINED, id: s.id, nickname, skin, trophies: profile.trophies });
        console.log(`[+] ${nickname} (${ip}) 加入，当前 ${world.snakes.size} 条蛇`);
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
      console.log(`[-] ${s ? s.name : ctx.snakeId} (${ip}) 离开，剩余 ${world.snakes.size} 条蛇`);
    }
    clients.delete(ws);
  });
});

// ---------- 固定步长循环 ----------
const dt = 1 / CONFIG.net.tickRate;
let acc = 0;
let last = process.hrtime.bigint();

setInterval(() => {
  const now = process.hrtime.bigint();
  acc += Number(now - last) / 1e9;
  last = now;
  if (acc > 0.5) acc = 0.5;          // 掉帧保护：不做追帧螺旋
  let steps = 0;
  while (acc >= dt && steps++ < 5) {
    world.step(dt);
    acc -= dt;
  }
  if (steps === 0) return;

  const payload = JSON.stringify({ t: S2C.STATE, ...world.snapshot() });
  for (const [ws, ctx] of clients) {
    if (ctx.snakeId != null && ws.readyState === ws.OPEN) ws.send(payload);
  }
}, 1000 / CONFIG.net.tickRate);

process.on('SIGINT', () => { profiles.flush(); process.exit(0); });

server.listen(CONFIG.net.port, () => {
  const addrs = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family === 'IPv4' && !ni.internal) addrs.push(ni.address);
    }
  }
  console.log('SnakeMatch3 服务器已启动');
  console.log(`  本机:   http://localhost:${CONFIG.net.port}`);
  for (const a of addrs) console.log(`  局域网: http://${a}:${CONFIG.net.port}`);
  console.log(`  AI ${CONFIG.ai.count} 条 / 道具 ${CONFIG.items.count} 个 / 地图 ${CONFIG.map.size}`);
});
