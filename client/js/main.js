// Client entry point: login -> build the scene -> main loop (sample, render, effects, HUD).

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
import { t, applyStatic, setLang, getLang, onLangChange, skinLabel } from './i18n.js';
import { EV, WILD } from '/shared/protocol.js';
import { wrap, toroidalDelta, clamp } from '/shared/mathUtil.js';

let CONFIG = null, MAP = 0;
let gfx = null, views = null, itemViews = null, fx = null, hud = null, minimap = null;
let myId = null, anchorInit = false, camDist = 0, matchStreak = 0, lastMatchAt = 0;
let myDeath = null, myKiller = '', markerUntil = 0;
let severArmedAt = 0;                    // 接上断尾的时刻，用来把随后那一帧的相机瞬移换成滑移
const camGlide = { x: 0, y: 0, t: 0 };   // 待消化的相机偏移（游戏坐标）与剩余秒数
const SEVER_ARM_MS = 1000;               // 事件先到、瞬移那一帧晚到（插值延迟），这是等待窗口
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
  langs: document.getElementById('langSwitch'),
};
let takenNames = new Set();
let nickHistory = [];
let welcomed = false;
let chosenSkin = localStorage.getItem('sm3.skin') || 'glass';
let foot = null;                       // {key, vars} so the footer survives a language switch

applyStatic();
syncLangButtons();

const net = new Net({ onWelcome, onJoined, onReject, onEvents, onClose, onError });
net.connect();

const input = new Input(
  (dir, sprint) => net.sendInput(dir, sprint),
  () => net.sendJump(),
  () => hud?.toast(t(A.toggleMute() ? 'toast.muted' : 'toast.unmuted')),
);

const fxColor = (c) => (c === WILD ? 0xffffff : CONFIG.colors[c]);

// ---------------- Language ----------------

function syncLangButtons() {
  for (const b of ui.langs.querySelectorAll('button')) {
    b.classList.toggle('on', b.dataset.lang === getLang());
  }
}
ui.langs.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b) setLang(b.dataset.lang);
});
onLangChange(() => {
  syncLangButtons();
  renderHistory();
  renderSkins();
  renderFoot();
  checkNickname();
});

// ---------------- Login ----------------

function onWelcome(m) {
  CONFIG = m.config;
  MAP = CONFIG.map.size;
  camDist = CONFIG.camera.distance;
  if (!CONFIG.skins.includes(chosenSkin)) chosenSkin = CONFIG.defaultSkin;

  takenNames = new Set(m.taken || []);
  nickHistory = m.nicknames || [];
  const preferred = [localStorage.getItem('sm3.nick'), ...nickHistory]
    .find((n) => n && !takenNames.has(n));
  ui.nick.value = preferred || m.defaultNickname || '';
  renderHistory();
  renderSkins();

  welcomed = true;
  setPlayLabel('login.play');
  foot = { key: 'login.footIp', vars: { ip: m.ip } };
  renderFoot();
  checkNickname();
}

function renderHistory() {
  ui.history.innerHTML = nickHistory.map((n) => {
    const taken = takenNames.has(n) ? ' taken' : '';
    return `<span class="nickChip${taken}" data-nick="${escapeAttr(n)}"`
      + `${taken ? ` title="${escapeAttr(t('login.chipTaken'))}"` : ''}>${escapeHtml(n)}</span>`;
  }).join('');
  ui.history.querySelectorAll('.nickChip').forEach((b) => b.addEventListener('click', () => {
    if (b.classList.contains('taken')) return;
    ui.nick.value = b.dataset.nick;
    checkNickname();
  }));
}

function renderSkins() {
  if (!CONFIG) return;
  ui.skins.innerHTML = CONFIG.skins.map((s) => `
    <div class="skinBtn${s === chosenSkin ? ' on' : ''}" data-skin="${s}">
      <span class="dot ${s}"></span>${escapeHtml(skinLabel(s))}
    </div>`).join('');
  ui.skins.querySelectorAll('.skinBtn').forEach((b) => b.addEventListener('click', () => {
    chosenSkin = b.dataset.skin;
    ui.skins.querySelectorAll('.skinBtn').forEach((x) => x.classList.toggle('on', x === b));
  }));
}

function renderFoot() {
  ui.foot.textContent = foot ? t(foot.key, foot.vars) : '';
}

/** Keep the label as a key, so a language switch re-renders the button correctly */
function setPlayLabel(key) {
  ui.play.dataset.i18n = key;
  ui.play.textContent = t(key);
}

/**
 * Instant feedback on a taken nickname. The server checks again on JOIN; this only tells
 * the player before they press the button.
 */
function checkNickname() {
  const v = ui.nick.value.trim();
  const taken = v !== '' && takenNames.has(v);
  ui.hint.classList.toggle('bad', taken);
  ui.hint.classList.toggle('ok', !taken && v !== '');
  ui.hint.textContent = taken ? t('login.hintTaken', { name: v })
    : (v === '' ? t('login.hintEmpty') : '');
  ui.play.disabled = taken || !welcomed;
  return !taken;
}
ui.nick.addEventListener('input', checkNickname);

function onReject(m) {
  const attempted = ui.nick.value.trim();
  takenNames = new Set(m.taken || [...takenNames, attempted]);
  ui.nick.value = m.suggestion || '';
  ui.play.disabled = false;
  setPlayLabel('login.play');
  checkNickname();
  ui.hint.classList.remove('ok');
  ui.hint.classList.add('bad');
  ui.hint.textContent = t('login.rejectTaken', { name: attempted })
    + (m.suggestion ? t('login.renamed', { name: m.suggestion }) : '');
}

ui.play.addEventListener('click', () => {
  if (!checkNickname()) return;
  const nick = ui.nick.value.trim();
  localStorage.setItem('sm3.nick', nick);
  localStorage.setItem('sm3.skin', chosenSkin);
  A.initAudio();
  A.resumeAudio();
  ui.play.disabled = true;
  setPlayLabel('login.joining');
  net.join(nick, chosenSkin);
});
ui.nick.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !ui.play.disabled) ui.play.click(); });

function onJoined(m) {
  myId = m.id;
  if (!gfx) boot();
  ui.login.classList.add('gone');
  hud.show();
  input.enabled = true;
  hud.toast(t('toast.welcome', { name: m.nickname }));
}

function onClose() {
  input.enabled = false;
  welcomed = false;
  ui.login.classList.remove('gone');
  ui.play.disabled = true;
  setPlayLabel('login.disconnected');
  foot = { key: 'login.footClosed' };
  renderFoot();
}
function onError() { foot = { key: 'login.footError' }; renderFoot(); }

// ---------------- Scene and main loop ----------------

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
  // Frame cap on a fixed beat rather than "has enough time passed since the last frame":
  // the latter degrades to 48fps on a 144Hz screen (two frames too few, three too many).
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
      hud.setPause(me.dead ? me.dead : null, me.win, myKiller, me.trophies);
    }
    const cullRadius = camDist * 1.5 + CONFIG.graphics.cullMargin;
    views.sync(st.snakes, anchor, myId, dt, cullRadius, CONFIG.graphics.labelRadius);
    itemViews.sync(st.items, anchor, dt, cullRadius);
    hud.setBoard(st.snakes, myId, dt);
    minimap.draw(st.snakes, st.items, myId, myDeath, dt);
  }

  updateDeathMarker(now / 1000);
  fx.update(dt);
  // The camera never moves on its own: distance is the player's to set with the wheel, and
  // the framing must not shift under them when something happens in the world.
  gfx.placeCamera(anchor.x, anchor.y, camDist);
  gfx.render();

  fpsAcc += dt; fpsN++;
  workAcc += performance.now() - workStart;
  if (fpsAcc >= 0.5) {
    hud.setStatus(Math.round(fpsN / fpsAcc), (workAcc / fpsN).toFixed(1), net.ping);
    fpsAcc = 0; fpsN = 0; workAcc = 0;
  }
}

/** Ease the focus towards the target across the torus; snap on teleports such as respawn */
function followCamera(target, dt, teleported) {
  const dx = toroidalDelta(anchor.x, target.x, MAP);
  const dy = toroidalDelta(anchor.y, target.y, MAP);
  const jumped = !anchorInit || teleported || Math.hypot(dx, dy) > 20;
  // 接上断尾时头部被移到断尾的另一端，是唯一一种“玩家没动、画面却整个换地方”的瞬移：
  // 直接吸附会让人瞬间失去方向，所以保留当前取景，再用 severGlideSec 把偏移滑掉。
  if (jumped && anchorInit && camGlide.t <= 0
      && performance.now() - severArmedAt < SEVER_ARM_MS) {
    camGlide.x = -dx; camGlide.y = -dy; camGlide.t = CONFIG.camera.severGlideSec;
    severArmedAt = 0;
  }
  if (camGlide.t > 0) {
    // 焦点 = 当前头部 + 逐渐衰减的偏移：起点正好是滑移开始时的取景，终点正好是头部，
    // smoothstep 让两端速度为零，中途走完大部分距离。滑移期间不吸附：同一次瞬移会在
    // 相邻两帧之间被采样很多次，tp 标记会连着好几帧都为真。
    camGlide.t = Math.max(0, camGlide.t - dt);
    const u = camGlide.t / CONFIG.camera.severGlideSec;
    const e = u * u * (3 - 2 * u);
    anchor.x = wrap(target.x + camGlide.x * e, MAP);
    anchor.y = wrap(target.y + camGlide.y * e, MAP);
    return;
  }
  if (jumped) {
    anchor.x = target.x; anchor.y = target.y; anchorInit = true;
    return;
  }
  const k = 1 - Math.pow(1 - CONFIG.camera.followLerp, dt * 60);
  anchor.x = wrap(anchor.x + dx * k, MAP);
  anchor.y = wrap(anchor.y + dy * k, MAP);
}

/** Death marker: shown from the moment of death, then deathMarkerSec longer after respawn */
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

// ---------------- Events -> effects / sound / announcements ----------------

/** Game coordinates -> render coordinates (unwrapped near the camera focus) */
function toRender(p, out) {
  const x = anchor.x + toroidalDelta(anchor.x, p[0], MAP);
  const y = anchor.y + toroidalDelta(anchor.y, p[1], MAP);
  return out.set(x, p[2] || 0, -y);
}

function nearness(p) {
  const d = Math.hypot(toroidalDelta(anchor.x, p[0], MAP), toroidalDelta(anchor.y, p[1], MAP));
  return clamp(1 - d / 45, 0, 1);      // distant events stay silent, or the whole map is in your ears
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
        // Leave blinking "ghost" beads behind first, so the player sees which ones cleared
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
        // Scan wave over the grafted section, so it is obvious where those beads came from
        views.flash(e.aid, e.n);
        if (e.aid === myId) {
          severArmedAt = performance.now();   // 我接上了断尾，给随后的头部瞬移准备好相机滑移
          hud.toast(t('toast.severed', { name: e.bn, n: e.n }), 'gain');
        }
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
          markerUntil = Infinity;                 // held through the pause, bounded on respawn
          hud.toast(t('toast.killedBy', { by: e.by }), 'bad');
        } else {
          hud.toast(t('toast.eliminated', { name: e.name, by: e.by }));
        }
        break;
      }
      case EV.RESPAWN:
        if (e.id === myId) markerUntil = performance.now() / 1000 + CONFIG.snake.deathMarkerSec;
        break;
      case EV.WILD:
        hud.toast(t('toast.wild'), 'wild');
        break;
      case EV.WIN:
        if (e.id === myId) A.sfxWin();             // your own win is shown by the pause panel
        else hud.toast(t('toast.winOther', { name: e.name, trophies: e.trophies }), 'win');
        break;
    }
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }
