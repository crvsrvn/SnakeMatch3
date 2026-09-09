// 客户端入口：登录 -> 建场景 -> 主循环（插值采样 / 渲染 / 特效 / HUD）。

import * as THREE from 'three';
import { Net } from './net.js';
import { createScene } from './scene.js';
import { SnakeViews } from './snakeView.js';
import { setBeadSegments } from './skins.js';
import { ItemViews } from './itemView.js';
import { Effects } from './effects.js';
import { Minimap } from './minimap.js';
import { Hud } from './hud.js';
import { Input } from './input.js';
import * as A from './audio.js';
import { EV, WILD } from '/shared/protocol.js';
import { wrap, toroidalDelta, clamp } from '/shared/mathUtil.js';

let CONFIG = null, MAP = 0;
let gfx = null, views = null, itemViews = null, fx = null, hud = null, minimap = null;
let myId = null, anchorInit = false, camDist = 0, matchStreak = 0, lastMatchAt = 0;
let myDeath = null, myKiller = '', markerUntil = 0;
const anchor = { x: 0, y: 0 };
const tmp = new THREE.Vector3();

const ui = {
  login: document.getElementById('login'),
  nick: document.getElementById('nickInput'),
  history: document.getElementById('nickHistory'),
  skins: document.getElementById('skinList'),
  play: document.getElementById('playBtn'),
  hint: document.getElementById('nickHint'),
  foot: document.getElementById('loginFoot'),
};
let takenNames = new Set();
let welcomed = false;
let chosenSkin = localStorage.getItem('sm3.skin') || 'glass';

const net = new Net({ onWelcome, onJoined, onReject, onEvents, onClose, onError });
net.connect();

const input = new Input(
  (dir, sprint) => net.sendInput(dir, sprint),
  () => net.sendJump(),
  () => hud?.toast(A.toggleMute() ? '已静音' : '已取消静音'),
);

const fxColor = (c) => (c === WILD ? 0xffffff : CONFIG.colors[c]);

// ---------------- 登录 ----------------

function onWelcome(m) {
  CONFIG = m.config;
  MAP = CONFIG.map.size;
  camDist = CONFIG.camera.distance;
  if (!CONFIG.skins.includes(chosenSkin)) chosenSkin = CONFIG.defaultSkin;

  takenNames = new Set(m.taken || []);
  const history = m.nicknames || [];
  const preferred = [localStorage.getItem('sm3.nick'), ...history]
    .find((n) => n && !takenNames.has(n));
  ui.nick.value = preferred || m.defaultNickname || '';
  ui.history.innerHTML = history.map((n) => {
    const t = takenNames.has(n) ? ' taken' : '';
    return `<span class="nickChip${t}" data-nick="${escapeAttr(n)}"`
      + `${t ? ' title="当前有人在用"' : ''}>${escapeHtml(n)}</span>`;
  }).join('');
  ui.history.querySelectorAll('.nickChip').forEach((b) => b.addEventListener('click', () => {
    if (b.classList.contains('taken')) return;
    ui.nick.value = b.dataset.nick;
    checkNickname();
  }));

  ui.skins.innerHTML = CONFIG.skins.map((s) => `
    <div class="skinBtn${s === chosenSkin ? ' on' : ''}" data-skin="${s}">
      <span class="dot ${s}"></span>${m.skinLabels[s] || s}
    </div>`).join('');
  ui.skins.querySelectorAll('.skinBtn').forEach((b) => b.addEventListener('click', () => {
    chosenSkin = b.dataset.skin;
    ui.skins.querySelectorAll('.skinBtn').forEach((x) => x.classList.toggle('on', x === b));
  }));

  welcomed = true;
  ui.play.textContent = '进入战场';
  ui.foot.textContent = `你的地址 ${m.ip} · 同一地址可以开多个网页、用不同昵称各玩各的`;
  checkNickname();
}

/** 昵称占用的即时提示。服务器在 JOIN 时还会再判一次，这里只是提前告诉玩家 */
function checkNickname() {
  const v = ui.nick.value.trim();
  const taken = v !== '' && takenNames.has(v);
  ui.hint.classList.toggle('bad', taken);
  ui.hint.classList.toggle('ok', !taken && v !== '');
  ui.hint.textContent = taken ? `「${v}」已经有人在用，换一个吧`
    : (v === '' ? '留空则自动分配一个名字' : '');
  ui.play.disabled = taken || !welcomed;
  return !taken;
}
ui.nick.addEventListener('input', checkNickname);

function onReject(m) {
  takenNames = new Set(m.taken || [...takenNames, ui.nick.value.trim()]);
  ui.nick.value = m.suggestion || '';
  ui.play.disabled = false;
  ui.play.textContent = '进入战场';
  checkNickname();
  ui.hint.classList.remove('ok');
  ui.hint.classList.add('bad');
  ui.hint.textContent = `${m.reason}${m.suggestion ? `，已替你改成「${m.suggestion}」` : ''}`;
}

ui.play.addEventListener('click', () => {
  if (!checkNickname()) return;
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
  welcomed = false;
  ui.login.classList.remove('gone');
  ui.play.disabled = true;
  ui.play.textContent = '连接已断开';
  ui.foot.textContent = '服务器连接断开，刷新页面重新进入（不支持断线重连）';
}
function onError() { ui.foot.textContent = '无法连接服务器，请确认本地服务器已启动'; }

// ---------------- 场景与主循环 ----------------

function boot() {
  setBeadSegments(...CONFIG.graphics.beadSegments);
  gfx = createScene(CONFIG);
  views = new SnakeViews(gfx.scene, CONFIG, gfx.CSS2DObject);
  itemViews = new ItemViews(gfx.scene, CONFIG);
  fx = new Effects(gfx.scene, CONFIG);
  hud = new Hud(CONFIG);
  minimap = new Minimap(document.getElementById('minimap'), CONFIG);
  frameInterval = 1000 / Math.max(15, CONFIG.graphics.maxFps);

  addEventListener('wheel', (e) => {
    camDist = clamp(camDist + Math.sign(e.deltaY) * 2.5, CONFIG.camera.minDistance, CONFIG.camera.maxDistance);
  }, { passive: true });

  requestAnimationFrame(frame);
}

let last = performance.now();
let fpsAcc = 0, fpsN = 0, workAcc = 0;
let nextDue = 0, frameInterval = 1000 / 60;

function frame(now) {
  requestAnimationFrame(frame);
  // 帧率上限：按固定节拍判定而不是"距上一帧够久了吗"，
  // 后者在 144Hz 屏上会退化成 48fps（两帧不够、三帧才够）。
  if (now < nextDue) return;
  nextDue = nextDue + frameInterval <= now ? now + frameInterval : nextDue + frameInterval;

  const workStart = now;
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;

  net.update(dt);
  const st = net.sample();
  if (st) {
    const me = st.snakes.find((s) => s.id === myId);
    if (me) {
      if (me.dead && me.deathPos) followCamera(me.deathPos, dt, me.tp);
      else if (me.beads.length) followCamera(me.beads[0], dt, me.tp);
      hud.setSelf(me);
      hud.setDeath(me.dead ? me.dead : null, myKiller);
    }
    const cullRadius = camDist * 1.5 + CONFIG.graphics.cullMargin;
    views.sync(st.snakes, anchor, myId, dt, cullRadius, CONFIG.graphics.labelRadius);
    itemViews.sync(st.items, anchor, dt, cullRadius);
    hud.setBoard(st.snakes, myId, dt);
    minimap.draw(st.snakes, st.items, myId, myDeath, dt);
  }

  updateDeathMarker(now / 1000);
  fx.update(dt);
  gfx.placeCamera(anchor.x, anchor.y, camDist);
  gfx.renderer.render(gfx.scene, gfx.camera);
  gfx.labelRenderer.render(gfx.scene, gfx.camera);

  fpsAcc += dt; fpsN++;
  workAcc += performance.now() - workStart;
  if (fpsAcc >= 0.5) {
    hud.setStatus(Math.round(fpsN / fpsAcc), (workAcc / fpsN).toFixed(1), net.ping);
    fpsAcc = 0; fpsN = 0; workAcc = 0;
  }
}

/** 焦点在环面上朝目标平滑靠拢；重生等瞬移时直接吸附 */
function followCamera(target, dt, teleported) {
  const dx = toroidalDelta(anchor.x, target.x, MAP);
  const dy = toroidalDelta(anchor.y, target.y, MAP);
  if (!anchorInit || teleported || Math.hypot(dx, dy) > 20) {
    anchor.x = target.x; anchor.y = target.y; anchorInit = true;
    return;
  }
  const k = 1 - Math.pow(1 - CONFIG.camera.followLerp, dt * 60);
  anchor.x = wrap(anchor.x + dx * k, MAP);
  anchor.y = wrap(anchor.y + dy * k, MAP);
}

/** 死亡点标记：从死亡起显示，重生后再保留 deathMarkerSec 秒 */
function updateDeathMarker(nowSec) {
  if (!myDeath || nowSec > markerUntil) {
    if (fx.markerVisible) fx.markerOff();
    if (myDeath && nowSec > markerUntil) myDeath = null;
    return;
  }
  if (!fx.markerVisible) fx.markerOn();
  const x = anchor.x + toroidalDelta(anchor.x, myDeath.x, MAP);
  const y = anchor.y + toroidalDelta(anchor.y, myDeath.y, MAP);
  fx.marker.position.set(x, -CONFIG.snake.beadRadius, -y);
}

// ---------------- 事件 -> 特效 / 音效 / 公告 ----------------

/** 游戏坐标 -> 渲染坐标（展开到相机焦点附近） */
function toRender(p, out) {
  const x = anchor.x + toroidalDelta(anchor.x, p[0], MAP);
  const y = anchor.y + toroidalDelta(anchor.y, p[1], MAP);
  return out.set(x, p[2] || 0, -y);
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
        fx.burst(toRender(e.p, tmp), fxColor(e.c), 8, 3.5, 0.4);
        if (near > 0.5) A.sfxEat();
        break;
      }
      case EV.MATCH: {
        const nowMs = performance.now();
        matchStreak = nowMs - lastMatchAt < 900 ? matchStreak + 1 : 0;
        lastMatchAt = nowMs;
        const color = fxColor(e.c);
        // 先留下会闪烁的"虚拟珠"，告诉玩家是哪几颗被消掉了
        for (const p of e.pts) {
          fx.ghost(toRender(p, tmp), color);
          fx.burst(toRender(p, tmp), color, 12, 5, 0.4);
        }
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
        const beads = e.beads || [];
        for (const d of beads) fx.burst(toRender(d, tmp), fxColor(d[3]), 10, 6, 0.5);
        fx.ring(toRender(e.p, tmp), 0xff6a7d, 8, 0.5);
        if (e.id === myId) {
          A.sfxDie();
          myDeath = { x: e.p[0], y: e.p[1] };
          myKiller = e.by;
          markerUntil = Infinity;                 // 停顿期间一直显示，重生时改成有限时长
          hud.toast(`你被 ${e.by} 撞掉了`, 'bad');
        } else {
          hud.toast(`${e.name} 被 ${e.by} 淘汰`);
        }
        break;
      }
      case EV.RESPAWN:
        if (e.id === myId) markerUntil = performance.now() / 1000 + CONFIG.snake.deathMarkerSec;
        break;
      case EV.WILD:
        hud.toast('彩虹珠出现了！可当作任意颜色（看小地图）', 'wild');
        break;
      case EV.WIN:
        if (e.id === myId) { A.sfxWin(); hud.toast(`消完了！奖杯 +1（共 ${e.trophies}）`, 'win'); }
        else hud.toast(`${e.name} 清空珠子，夺得第 ${e.trophies} 座奖杯`, 'win');
        break;
    }
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }
