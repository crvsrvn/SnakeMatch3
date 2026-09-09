// 客户端入口：登录 -> 建场景 -> 主循环（插值采样 / 渲染 / 特效 / HUD）。

import * as THREE from 'three';
import { Net } from './net.js';
import { createScene } from './scene.js';
import { SnakeViews } from './snakeView.js';
import { ItemViews } from './itemView.js';
import { Effects } from './effects.js';
import { Hud } from './hud.js';
import { Input } from './input.js';
import * as A from './audio.js';
import { EV } from '/shared/protocol.js';
import { wrap, toroidalDelta, clamp } from '/shared/mathUtil.js';

let CONFIG = null, MAP = 0;
let gfx = null, views = null, itemViews = null, fx = null, hud = null;
let myId = null, anchorInit = false, camDist = 0, matchStreak = 0, lastMatchAt = 0;
const anchor = { x: 0, y: 0 };
const tmp = new THREE.Vector3();

const ui = {
  login: document.getElementById('login'),
  nick: document.getElementById('nickInput'),
  skins: document.getElementById('skinList'),
  play: document.getElementById('playBtn'),
  foot: document.getElementById('loginFoot'),
};
let chosenSkin = localStorage.getItem('sm3.skin') || 'glass';

const net = new Net({ onWelcome, onJoined, onEvents, onClose, onError });
net.connect();

const input = new Input(
  (dir, sprint) => net.sendInput(dir, sprint),
  () => net.sendJump(),
  () => hud?.toast(A.toggleMute() ? '已静音' : '已取消静音'),
);

// ---------------- 登录 ----------------

function onWelcome(m) {
  CONFIG = m.config;
  MAP = CONFIG.map.size;
  camDist = CONFIG.camera.distance;
  ui.nick.value = localStorage.getItem('sm3.nick') || m.suggestedNickname || '';
  if (!CONFIG.skins.includes(chosenSkin)) chosenSkin = CONFIG.defaultSkin;

  ui.skins.innerHTML = CONFIG.skins.map((s) => `
    <div class="skinBtn${s === chosenSkin ? ' on' : ''}" data-skin="${s}">
      <span class="dot ${s}"></span>${m.skinLabels[s] || s}
    </div>`).join('');
  ui.skins.querySelectorAll('.skinBtn').forEach((b) => b.addEventListener('click', () => {
    chosenSkin = b.dataset.skin;
    ui.skins.querySelectorAll('.skinBtn').forEach((x) => x.classList.toggle('on', x === b));
  }));

  ui.play.disabled = false;
  ui.play.textContent = '进入战场';
  ui.foot.textContent = `你的地址 ${m.ip} · 昵称与奖杯按此绑定`;
}

ui.play.addEventListener('click', () => {
  const nick = ui.nick.value.trim();
  localStorage.setItem('sm3.nick', nick);
  localStorage.setItem('sm3.skin', chosenSkin);
  A.initAudio();
  A.resumeAudio();
  ui.play.disabled = true;
  ui.play.textContent = '进入中…';
  net.join(nick, chosenSkin);
});
ui.nick.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !ui.play.disabled) ui.play.click(); });

function onJoined(m) {
  myId = m.id;
  if (!gfx) boot();
  ui.login.classList.add('gone');
  hud.show();
  input.enabled = true;
  hud.toast(`欢迎，${m.nickname}！消完全部珠子即可夺杯`);
}

function onClose() {
  input.enabled = false;
  ui.login.classList.remove('gone');
  ui.play.disabled = true;
  ui.play.textContent = '连接已断开';
  ui.foot.textContent = '服务器连接断开，刷新页面重新进入（不支持断线重连）';
}
function onError() { ui.foot.textContent = '无法连接服务器，请确认本地服务器已启动'; }

// ---------------- 场景与主循环 ----------------

function boot() {
  gfx = createScene(CONFIG);
  views = new SnakeViews(gfx.scene, CONFIG, gfx.CSS2DObject);
  itemViews = new ItemViews(gfx.scene, CONFIG);
  fx = new Effects(gfx.scene);
  hud = new Hud(CONFIG);

  addEventListener('wheel', (e) => {
    camDist = clamp(camDist + Math.sign(e.deltaY) * 2.5, CONFIG.camera.minDistance, CONFIG.camera.maxDistance);
  }, { passive: true });

  requestAnimationFrame(frame);
}

let last = performance.now();
let fpsAcc = 0, fpsN = 0, fpsShown = 0;

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;

  net.update(dt);
  const st = net.sample();
  if (st) {
    const me = st.snakes.find((s) => s.id === myId);
    if (me) {
      followCamera(me.beads[0], dt);
      hud.setSelf(me);
    }
    views.sync(st.snakes, anchor, myId, dt);
    itemViews.sync(st.items, anchor, dt);
    hud.setBoard(st.snakes, myId);
  }

  fx.update(dt);
  gfx.placeCamera(anchor.x, anchor.y, camDist);
  gfx.renderer.render(gfx.scene, gfx.camera);
  gfx.labelRenderer.render(gfx.scene, gfx.camera);

  fpsAcc += dt; fpsN++;
  if (fpsAcc >= 0.5) {
    fpsShown = Math.round(fpsN / fpsAcc);
    fpsAcc = 0; fpsN = 0;
    hud.setStatus(fpsShown, net.ping);
  }
}

/** 焦点在环面上朝蛇头平滑靠拢；重生等瞬移时直接吸附 */
function followCamera(head, dt) {
  const dx = toroidalDelta(anchor.x, head.x, MAP);
  const dy = toroidalDelta(anchor.y, head.y, MAP);
  if (!anchorInit || Math.hypot(dx, dy) > 20) {
    anchor.x = head.x; anchor.y = head.y; anchorInit = true;
    return;
  }
  const k = 1 - Math.pow(1 - CONFIG.camera.followLerp, dt * 60);
  anchor.x = wrap(anchor.x + dx * k, MAP);
  anchor.y = wrap(anchor.y + dy * k, MAP);
}

// ---------------- 事件 -> 特效 / 音效 / 公告 ----------------

/** 游戏坐标 -> 渲染坐标（展开到相机焦点附近） */
function toRender(p, out) {
  const x = anchor.x + toroidalDelta(anchor.x, p[0], MAP);
  const y = anchor.y + toroidalDelta(anchor.y, p[1], MAP);
  return out.set(x, p[2], -y);
}

function nearness(p) {
  const d = Math.hypot(toroidalDelta(anchor.x, p[0], MAP), toroidalDelta(anchor.y, p[1], MAP));
  return clamp(1 - d / 45, 0, 1);      // 远处不出声，避免整张地图的动静都往耳朵里灌
}

function onEvents(evs) {
  if (!fx) return;
  for (const e of evs) {
    switch (e.t) {
      case EV.EAT: {
        const near = nearness(e.p);
        if (near <= 0) break;
        fx.burst(toRender(e.p, tmp), CONFIG.colors[e.c], 8, 3.5, 0.4);
        if (near > 0.5) A.sfxEat();
        break;
      }
      case EV.MATCH: {
        const now = performance.now();
        matchStreak = now - lastMatchAt < 900 ? matchStreak + 1 : 0;
        lastMatchAt = now;
        const color = CONFIG.colors[e.c];
        for (const p of e.pts) fx.burst(toRender(p, tmp), color, 16, 6, 0.5);
        if (e.pts.length) fx.ring(toRender(e.pts[0], tmp), color, 6, 0.5);
        if (nearness(e.pts[0] || [anchor.x, anchor.y, 0]) > 0.3) A.sfxMatch(matchStreak);
        break;
      }
      case EV.HITBODY: {
        const near = nearness(e.p);
        fx.burst(toRender(e.p, tmp), 0xffffff, 26, 8, 0.6);
        fx.ring(toRender(e.p, tmp), 0xffd45e, 7, 0.45);
        if (near > 0.05) A.sfxCrack(near);
        break;
      }
      case EV.HITHEAD: {
        const near = nearness(e.p);
        fx.burst(toRender(e.p, tmp), 0xbfefff, 40, 11, 0.7);
        fx.ring(toRender(e.p, tmp), 0x9ff0ff, 9, 0.55);
        if (near > 0.05) A.sfxClink(near);
        break;
      }
      case EV.DEATH: {
        const drops = e.drops || [];
        for (const d of drops) fx.burst(toRender(d, tmp), CONFIG.colors[d[3]], 12, 5, 0.5);
        if (drops.length) fx.ring(toRender(drops[0], tmp), 0xff6a7d, 8, 0.5);
        if (e.id === myId) { A.sfxDie(); hud.toast(`你被 ${e.by} 撞掉了，珠子散落原地`, 'bad'); }
        else hud.toast(`${e.name} 被 ${e.by} 淘汰，散落 ${drops.length} 颗珠子`);
        break;
      }
      case EV.WIN:
        if (e.id === myId) { A.sfxWin(); hud.toast(`消完了！奖杯 +1（共 ${e.trophies}）`, 'win'); }
        else hud.toast(`${e.name} 清空珠子，夺得第 ${e.trophies} 座奖杯`, 'win');
        break;
    }
  }
}
