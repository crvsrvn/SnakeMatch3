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
import { Progress, nextMilestone, milestones, achievementName } from './progress.js';
import { RoomEventBanner } from './roomEvent.js';
import * as A from './audio.js';
import { t, applyStatic, setLang, getLang, onLangChange, skinLabel } from './i18n.js';
import { EV, WILD } from '/shared/protocol.js';
import { syncInPlace } from '/shared/sync.js';
import { wrap, toroidalDelta, clamp } from '/shared/mathUtil.js';

let CONFIG = null, MAP = 0;
let gfx = null, views = null, itemViews = null, fx = null, hud = null, minimap = null;
let progress = null, banner = null;
let myId = null, myName = '', anchorInit = false, camDist = 0, matchStreak = 0, lastMatchAt = 0;
let myDeath = null, myDeathReason = '', myDeathStats = '', markerUntil = 0;
let myWin = { gain: 1, streak: 0 };      // what the last win was worth, for the win panel
const life = { min: Infinity, eat: 0, sever: 0 };   // this life's near-miss stats, for the death panel
let crownId = null;                      // who wore the crown last frame, to announce a change
let severArmedAt = 0;                    // 接上断尾的时刻，用来把随后那一帧的相机瞬移换成滑移
const camGlide = { x: 0, y: 0, t: 0 };   // 待消化的相机偏移（游戏坐标）与剩余秒数
const SEVER_ARM_MS = 1000;               // 事件先到、瞬移那一帧晚到（插值延迟），这是等待窗口
const anchor = { x: 0, y: 0 };
const tmp = new THREE.Vector3();

const ui = {
  login: document.getElementById('login'),
  nick: document.getElementById('nickInput'),
  record: document.getElementById('record'),
  recordList: document.getElementById('recordList'),
  titleField: document.getElementById('titleField'),
  titleSelect: document.getElementById('titleSelect'),
  hall: document.getElementById('hall'),
  skins: document.getElementById('skinList'),
  play: document.getElementById('playBtn'),
  hint: document.getElementById('nickHint'),
  foot: document.getElementById('loginFoot'),
  langs: document.getElementById('langSwitch'),
  tutorial: document.getElementById('tutorial'),
  tutOk: document.getElementById('tutOk'),
};
let takenNames = new Set();
let profile = null;                    // this address's record from WELCOME, or null on a first visit
let hall = [];                         // weekly top three, newest week first
let welcomed = false;
let firstVisit = false;                // the server has never seen this address: tutorial before the first join
let chosenSkin = localStorage.getItem('sm3.skin') || 'glass';
let foot = null;                       // {key, vars} so the footer survives a language switch

applyStatic();
syncLangButtons();

const net = new Net({ onWelcome, onJoined, onReject, onEvents, onMap, onConfig, onProgress, onClose, onError });
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
  renderRecord();
  renderTitles();
  renderHall();
  renderFoot();
  checkNickname();                     // also re-renders the skins
});

// ---------------- Login ----------------

function onWelcome(m) {
  CONFIG = m.config;
  MAP = CONFIG.map.size;
  camDist = CONFIG.camera.distance;
  if (!CONFIG.skins.includes(chosenSkin)) chosenSkin = CONFIG.defaultSkin;

  takenNames = new Set(m.taken || []);
  profile = m.profile;
  hall = m.hall || [];
  // A known address gets its own name back, editable only while renames remain; a new one
  // gets the last name typed here (if free) or the server's default
  const saved = localStorage.getItem('sm3.nick');
  ui.nick.value = profile ? profile.nickname : ((saved && !takenNames.has(saved) && saved) || m.defaultNickname || '');
  ui.nick.readOnly = !!profile && profile.renamesLeft === 0;
  renderRecord();
  renderTitles();
  renderHall();

  welcomed = true;
  firstVisit = !!m.firstVisit;
  setPlayLabel('login.play');
  foot = { key: 'login.footIp', vars: { ip: m.ip } };
  renderFoot();
  checkNickname();
}

/** The record card: standing, medal, streak, next milestone, and what happened while away */
function renderRecord() {
  ui.record.hidden = !profile || !CONFIG;
  if (ui.record.hidden) return;
  const p = profile;
  const line = (cls, text) => `<div class="${cls}">${escapeHtml(text)}</div>`;
  const rows = [
    line('', t('login.recRank', { rank: p.rank, n: p.trophies })
      + ' · ' + t('login.recWeek', { n: p.weekly }) + ' · ' + t('login.recStreak', { n: p.bestStreak })),
  ];
  if (p.medal) rows.push(line('good', t(`login.medal${p.medal}`)));
  const next = nextMilestone(p.trophies, CONFIG);
  rows.push(line('dim', next ? t('login.nextUnlock', next) : t('login.allUnlocked')));
  if (p.overtakenBy?.length) rows.push(line('warn', t('login.overtaken', { names: p.overtakenBy.join(', '), rank: p.rank })));
  if (p.nemesis) rows.push(line('warn', t('login.nemesis', { name: p.nemesis.nickname, n: p.nemesis.n })));
  ui.recordList.innerHTML = rows.join('');
}

/** Title picker: one option per unlocked achievement; hidden until there is one */
function renderTitles() {
  const ids = profile?.achievements || [];
  ui.titleField.hidden = ids.length === 0;
  if (ui.titleField.hidden) return;
  const current = ui.titleSelect.value || profile.title || '';
  ui.titleSelect.innerHTML = [`<option value="">${escapeHtml(t('login.noTitle'))}</option>`]
    .concat(ids.map((id) => `<option value="${id}">${escapeHtml(`${t(`title.${id}`)} — ${achievementName(id, CONFIG)}`)}</option>`))
    .join('');
  ui.titleSelect.value = ids.includes(current) ? current : '';
}

function renderHall() {
  const week = (key) => {
    const m = /^(\d+)-W(\d+)$/.exec(key);
    return m ? t('login.week', { y: m[1], w: Number(m[2]) }) : key;
  };
  ui.hall.innerHTML = hall.length ? hall.map((h) => `<div><span class="w">${escapeHtml(week(h.week))}</span>`
    + h.top.map((p, i) => `${['🥇', '🥈', '🥉'][i]} <span class="n">${escapeHtml(p.nickname)}</span> <em>${p.trophies}</em>`).join(' · ')
    + '</div>').join('') : `<div>${escapeHtml(t('login.hallEmpty'))}</div>`;
}

/** Trophies this address still lacks for a skin; 0 = usable. Mirrors the server's JOIN check. */
function skinLock(s) {
  const need = CONFIG.skinUnlock[s] || 0;
  return (profile?.trophies || 0) >= need ? 0 : need;
}

function renderSkins() {
  if (!CONFIG) return;
  if (skinLock(chosenSkin)) chosenSkin = CONFIG.defaultSkin;   // the nickname changed and lost the skin
  ui.skins.innerHTML = CONFIG.skins.map((s) => {
    const lock = skinLock(s);
    const cls = (s === chosenSkin ? ' on' : '') + (lock ? ' locked' : '');
    const tag = lock ? t('login.skinLocked', { n: lock }) : '';
    return `<div class="skinBtn${cls}" data-skin="${s}">
      <span class="dot ${s}"></span>${escapeHtml(skinLabel(s))}${tag ? `<span class="lock">${escapeHtml(tag)}</span>` : ''}
    </div>`;
  }).join('');
  ui.skins.querySelectorAll('.skinBtn').forEach((b) => b.addEventListener('click', () => {
    if (b.classList.contains('locked')) return;
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
  if (taken) ui.hint.textContent = t('login.hintTaken', { name: v });
  else if (profile && ui.nick.readOnly) ui.hint.textContent = t('login.hintLocked');
  else if (profile && v !== profile.nickname) ui.hint.textContent = t('login.hintRename', { n: profile.renamesLeft });
  else ui.hint.textContent = v === '' && !profile ? t('login.hintEmpty') : '';
  ui.play.disabled = taken || !welcomed;
  renderSkins();                       // locks follow the address's trophy count
  return !taken;
}
ui.nick.addEventListener('input', checkNickname);

function onReject(m) {
  const attempted = ui.nick.value.trim();
  takenNames = new Set(m.taken || [...takenNames, attempted]);
  ui.play.disabled = false;
  setPlayLabel('login.play');
  if (m.reason === 'already-playing') {       // a second tab from this address: nothing to rename
    checkNickname();
    ui.hint.classList.remove('ok');
    ui.hint.classList.add('bad');
    ui.hint.textContent = t('login.rejectPlaying');
    return;
  }
  ui.nick.value = m.suggestion || '';
  checkNickname();
  ui.hint.classList.remove('ok');
  ui.hint.classList.add('bad');
  ui.hint.textContent = t('login.rejectTaken', { name: attempted })
    + (m.suggestion ? t('login.renamed', { name: m.suggestion }) : '');
}

ui.play.addEventListener('click', () => {
  if (!checkNickname()) return;
  if (firstVisit) {                    // read the rules first; OK joins
    firstVisit = false;
    ui.tutorial.hidden = false;
    return;
  }
  join();
});
ui.tutOk.addEventListener('click', () => { ui.tutorial.hidden = true; join(); });

function join() {
  const nick = ui.nick.value.trim();
  localStorage.setItem('sm3.nick', nick);
  localStorage.setItem('sm3.skin', chosenSkin);
  A.initAudio();
  A.resumeAudio();
  ui.play.disabled = true;
  setPlayLabel('login.joining');
  net.join(nick, chosenSkin, ui.titleSelect.value || null);
}
ui.nick.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !ui.play.disabled) ui.play.click(); });

function onJoined(m) {
  myId = m.id;
  myName = m.nickname;
  if (!gfx) boot();
  ui.login.classList.add('gone');
  hud.show();
  input.enabled = true;
  resetLife();
  hud.toast(t('toast.welcome', { name: m.nickname }));
}

function onProgress(m) { progress?.onMessage(m); }

function resetLife() { life.min = Infinity; life.eat = 0; life.sever = 0; }

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

/** The map grew or shrank with the player count. The views read CONFIG.map.size live; only
 *  the ground and boundary geometry are sized once and have to be rebuilt. */
function onMap(size) {
  CONFIG.map.size = size;
  MAP = size;
  gfx?.setMapSize(size);
}

/** The admin hot-reloaded the config: merge into the object every module holds, keep the map in step */
function onConfig(config) {
  syncInPlace(CONFIG, config);
  gfx?.setBloom(CONFIG.graphics.bloom);
  if (CONFIG.map.size !== MAP) onMap(CONFIG.map.size);
  if (!CONFIG.skins.includes(chosenSkin)) chosenSkin = CONFIG.defaultSkin;
  renderSkins();
}

// ---------------- Scene and main loop ----------------

function boot() {
  setBeadSegments(...CONFIG.graphics.beadSegments);
  gfx = createScene(CONFIG);
  views = new SnakeViews(gfx.scene, CONFIG, gfx.CSS2DObject);
  itemViews = new ItemViews(gfx.scene, CONFIG);
  fx = new Effects(gfx.scene, CONFIG);
  hud = new Hud(CONFIG);
  minimap = new Minimap(document.getElementById('minimap'), CONFIG);
  progress = new Progress(CONFIG, hud);
  banner = new RoomEventBanner(CONFIG, hud);
  views.onTrail = (p, color) => fx.burst(p, color, 2, 0.8, 0.5);   // milestone cosmetic: tail puffs
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
      if (me.beads.length) life.min = Math.min(life.min, me.colors.length);
      hud.setSelf(me);
      hud.setPause(me.dead ? me.dead : null, me.win, me.win
        ? { trophies: me.trophies, gain: myWin.gain, streak: myWin.streak }
        : { reason: myDeathReason, stats: myDeathStats });
    }
    const cullRadius = camDist * 1.5 + CONFIG.graphics.cullMargin;
    views.sync(st.snakes, anchor, myId, dt, cullRadius, CONFIG.graphics.labelRadius);
    itemViews.sync(st.items, anchor, dt, cullRadius);
    hud.setBoard(st.snakes, myId, dt);
    minimap.draw(st.snakes, st.items, myId, myDeath, dt);
    banner.sync(st.roomEvent);
    announceCrown(st.snakes);
  }

  updateDeathMarker(now / 1000);
  fx.update(dt, headOf);
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

/** The crown changed heads: say so (also on arrival, so a newcomer knows who to hunt) */
function announceCrown(snakes) {
  const king = snakes.find((s) => s.crown);
  const id = king ? king.id : null;
  if (id === crownId) return;
  crownId = id;
  if (!king) return;
  if (king.id === myId) hud.toast(t('toast.crownMe'), 'win');
  else hud.toast(t('toast.crown', { name: king.name }), 'win');
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

/** Head position and heading of a drawn snake, for effects that follow it */
function headOf(sid) { return views.headOf(sid); }

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
        // Pop the new head bead, so it reads as "added in front" rather than the body shifting
        views.flash(e.sid, 1, {
          dur: CONFIG.graphics.eatFlashSec, scale: CONFIG.graphics.eatFlashScale,
          color: fxColor(e.c), orb: CONFIG.graphics.eatFlashOrb, orbOpacity: 0.3,
        });
        fx.burst(toRender(e.p, tmp), fxColor(e.c), 8, 3.5, 0.4);
        if (near > 0.5) A.sfxEat();
        if (e.sid === myId) life.eat++;
        break;
      }
      case EV.MATCH: {
        const nowMs = performance.now();
        matchStreak = nowMs - lastMatchAt < 900 ? matchStreak + 1 : 0;
        lastMatchAt = nowMs;
        const color = fxColor(e.c);
        // Blinking "ghost" beads ride ahead of the owner's head, so the player sees which
        // ones cleared; the bursts stay where the beads were
        e.pts.forEach((p, i) => {
          fx.ghost(toRender(p, tmp), color, e.sid, i);
          fx.burst(toRender(p, tmp), color, 12, 5, 0.4);
        });
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
        views.flash(e.aid, e.n, { dur: CONFIG.graphics.severFlashSec });
        if (e.aid === myId) {
          severArmedAt = performance.now();   // 我接上了断尾，给随后的头部瞬移准备好相机滑移
          hud.toast(t('toast.severed', { name: e.bn, n: e.n }), 'gain');
          life.sever++;
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
        // Milestone cosmetic: a veteran goes out with a bigger bang
        const big = milestones(e.tr || 0, CONFIG).burst;
        for (const d of beads) fx.burst(toRender(d, tmp), fxColor(d[3]), big ? 18 : 10, big ? 9 : 6, 0.5);
        fx.ring(toRender(e.p, tmp), 0xff6a7d, 8, 0.5);
        if (big) fx.ring(toRender(e.p, tmp), 0xffd45e, 14, 0.9);
        // Say exactly what happened, e.g. "You ran into your own body"
        const mine = e.id === myId;
        const reason = t(`death.${e.cause}`, {
          who: mine ? t('death.you') : e.name, whose: mine ? 'your' : 'their', by: e.by,
        });
        if (mine) {
          A.sfxDie();
          myDeath = { x: e.p[0], y: e.p[1] };
          myDeathReason = reason;
          // Near-miss line for the panel: how close this life got, and what it did
          const min = life.min === Infinity ? 0 : life.min;
          myDeathStats = (min <= CONFIG.retention.nearWinBeads ? t('death.nearMiss', { min }) + ' ' : '')
            + t('death.stats', { min, eat: life.eat, sever: life.sever });
          markerUntil = Infinity;                 // held through the pause, bounded on respawn
          hud.toast(reason, 'bad');
          if (e.cause !== 'self') hud.toast(t('toast.nemesisMark', { name: e.by, sec: CONFIG.retention.revengeSec }), 'bad');
        } else {
          hud.toast(reason);
        }
        if (e.streak) {                           // a streak worth announcing just ended
          const v = { name: e.name, by: e.by, n: e.streak };
          hud.toast(t(mine ? 'toast.streakEndMe' : e.cause === 'self' ? 'toast.streakEndSelf' : 'toast.streakEnd', v), 'wild');
        }
        break;
      }
      case EV.RESPAWN:
        if (e.id === myId) {
          markerUntil = performance.now() / 1000 + CONFIG.snake.deathMarkerSec;
          resetLife();
        }
        if (milestones(e.tr || 0, CONFIG).spawn) {   // milestone cosmetic: a spawn halo
          const p = toRender([e.p[0], e.p[1], 0], tmp);
          fx.ring(p, 0xffd45e, 10, 0.8);
          fx.ring(p, 0xffffff, 6, 0.5);
        }
        break;
      case EV.WILD:
        hud.toast(t('toast.wild'), 'wild');
        break;
      case EV.WIN:
        if (e.id === myId) {                       // your own win is shown by the pause panel
          A.sfxWin();
          myWin = { gain: e.gain || 1, streak: e.streak || 0 };
        } else {
          hud.toast(t('toast.winOther', { name: e.name, trophies: e.trophies }), 'win');
        }
        break;
      case EV.REGICIDE:
        hud.toast(e.by === myName ? t('toast.regicideMe', { name: e.name })
          : t('toast.regicide', { by: e.by, name: e.name }), 'win');
        break;
      case EV.REVENGE:
        hud.toast(e.by === myName ? t('toast.revengeMe', { name: e.name })
          : t('toast.revenge', { by: e.by, name: e.name }), 'win');
        break;
      case EV.NEARWIN:
        hud.toast(e.id === myId ? t('toast.nearWinMe', { n: e.n }) : t('toast.nearWin', { name: e.name, n: e.n }), 'wild');
        break;
      case EV.ROOMEVENT:
        banner.onEvent(e);
        break;
    }
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
