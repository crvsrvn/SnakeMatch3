// Rendering a snake: the bead mesh pool, the bead aura, the name tag, the heading arrow,
// the invulnerability shield, and the scan wave after a tail is grafted.
// The server sends coordinates wrapped into the map; here the chain is unwrapped bead by
// bead into continuous render coordinates, so a snake crossing an edge still looks like one
// connected body sliding through.
// A snake in its death pause has no beads, only a name tag left at the death spot.

import * as THREE from 'three';
import { makeBead, retintBead, SPINNING_SKINS, FLOW_SKINS, flowPhase } from './skins.js';
import { Aura } from './aura.js';
import { MEDALS } from './hud.js';
import { milestones } from './progress.js';
import { t } from './i18n.js';
import { toroidalDelta } from '/shared/mathUtil.js';
import { WILD } from '/shared/protocol.js';

const TRAIL_EVERY = 0.12;                         // seconds between tail particle puffs (milestone cosmetic)

export class SnakeViews {
  constructor(scene, CONFIG, CSS2DObject) {
    this.scene = scene;
    this.C = CONFIG;
    this.CSS2DObject = CSS2DObject;
    this.views = new Map();
    this.t = 0;                                   // global clock driving the pattern flow
    this.arrowGeo = new THREE.ConeGeometry(0.3, 0.9, 3).rotateZ(-Math.PI / 2);
    this.bubbleGeo = new THREE.SphereGeometry(1, 20, 12);
    this.shieldRingGeo = new THREE.TorusGeometry(1, 0.045, 6, 36);
    // Crown for the room's top player, beacon for a snake about to clear: shared geometry,
    // meshes built per view only when first needed
    this.crownBandGeo = new THREE.TorusGeometry(1, 0.16, 8, 24);
    this.crownSpikeGeo = new THREE.ConeGeometry(0.22, 0.8, 4);
    this.crownMat = new THREE.MeshStandardMaterial({
      color: 0xffd45e, emissive: 0xffb01e, emissiveIntensity: 0.9, metalness: 0.8, roughness: 0.3,
    });
    this.beaconGeo = new THREE.CylinderGeometry(0.5, 0.5, 9, 16, 1, true);
    this.beaconMat = new THREE.MeshBasicMaterial({
      color: 0xffd45e, transparent: true, opacity: 0.22, side: THREE.DoubleSide,
      depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.onTrail = null;                          // (position, colorHex) => void, set by main to spawn particles
  }

  /**
   * A snake just gained beads at its head: run a scan wave over the first n of them.
   * @param opts { dur: seconds, scale: peak size of the crest bead (1 = no bulge),
   *   color: crest orb tint, orb: crest orb radius in bead radii at the start (it grows to
   *   ~1.9x that; 0 = no orb), orbOpacity: its peak opacity }
   */
  flash(id, n, opts) {
    if (n > 0) this.views.get(id)?.startFlash(n, opts);
  }

  /** The view of a snake whose head is drawn this frame (headPos, dir), or null */
  headOf(id) {
    const v = this.views.get(id);
    return v && v.group.visible && v.arrow.visible ? v : null;
  }

  colorOf(c) { return c === WILD ? null : this.C.colors[c]; }

  /** Squared toroidal distance from a point to the camera focus */
  near2(p, anchor) {
    const MAP = this.C.map.size;
    const dx = toroidalDelta(anchor.x, p.x, MAP), dy = toroidalDelta(anchor.y, p.y, MAP);
    return dx * dx + dy * dy;
  }

  /** A snake counts as far only when every bead is outside the radius -- testing the head
   *  alone would drop long snakes whose head is far but whose tail is right here */
  isFar(s, anchor, r2) {
    const MAP = this.C.map.size;
    const beads = s.beads.length ? s.beads : (s.deathPos ? [s.deathPos] : null);
    if (!beads) return true;
    for (const b of beads) {
      const dx = toroidalDelta(anchor.x, b.x, MAP);
      const dy = toroidalDelta(anchor.y, b.y, MAP);
      if (dx * dx + dy * dy < r2) return false;
    }
    return true;
  }

  /**
   * @param anchor camera focus in game coordinates; every render position is unwrapped near it
   * @param cullRadius snakes beyond this are hidden whole: three.js skips the entire subtree
   *                   of a node with visible=false, which is the single biggest render saving
   *                   with a hundred players on the map
   */
  sync(snakes, anchor, myId, dt, cullRadius, labelRadius) {
    this.t += dt;
    const seen = new Set();
    const r2 = cullRadius * cullRadius;
    const lr2 = labelRadius * labelRadius;
    const nemesis = snakes.find((s) => s.id === myId)?.nemesis ?? null;   // who killed me lately
    let drawn = 0;
    for (const s of snakes) {
      seen.add(s.id);
      let v = this.views.get(s.id);
      if (!v) { v = new SnakeView(this, s); this.views.set(s.id, v); }
      if (s.id !== myId && this.isFar(s, anchor, r2)) { v.hide(); continue; }
      v.update(s, anchor, s.id === myId, dt, lr2, s.id === nemesis);
      drawn++;
    }
    this.drawn = drawn;
    for (const [id, v] of this.views) {
      if (!seen.has(id)) { v.dispose(); this.views.delete(id); }
    }
  }
}

class SnakeView {
  constructor(owner, data) {
    this.o = owner;
    const C = owner.C;
    this.group = new THREE.Group();
    owner.scene.add(this.group);
    this.meshes = [];
    this.skin = data.skin;
    this.headPos = new THREE.Vector3();
    this.dir = 0;                                 // heading as last drawn; effects ride on it

    const arrowMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 });
    this.arrow = new THREE.Mesh(owner.arrowGeo, arrowMat);
    this.arrow.position.y = -C.snake.beadRadius + 0.06;
    this.group.add(this.arrow);

    // Invulnerability shield: a translucent orb plus two orthogonal energy rings, rotating
    // slowly, blinking fast when the protection is nearly out
    const R = C.snake.beadRadius;
    this.shieldMats = [
      new THREE.MeshBasicMaterial({
        color: 0x7fdcff, transparent: true, opacity: 0.22,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }),
      new THREE.MeshBasicMaterial({
        color: 0xbfefff, transparent: true, opacity: 0.85,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }),
    ];
    this.shield = new THREE.Group();
    const orb = new THREE.Mesh(owner.bubbleGeo, this.shieldMats[0]);
    orb.scale.setScalar(R * 2.7);
    const ringA = new THREE.Mesh(owner.shieldRingGeo, this.shieldMats[1]);
    ringA.scale.setScalar(R * 3.0);
    ringA.rotation.x = -Math.PI / 2;
    const ringB = new THREE.Mesh(owner.shieldRingGeo, this.shieldMats[1]);
    ringB.scale.setScalar(R * 3.0);
    this.shield.add(orb, ringA, ringB);
    this.shield.visible = false;
    this.shieldT = 0;
    this.group.add(this.shield);

    // Scan wave for a grafted tail: a glowing orb riding the crest
    this.waveMat = new THREE.MeshBasicMaterial({
      color: 0xbfefff, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.wave = new THREE.Mesh(owner.bubbleGeo, this.waveMat);
    this.wave.visible = false;
    this.group.add(this.wave);
    this.flashT = -1;
    this.flashN = 0;
    this.flash = null;                            // opts of the running wave, see SnakeViews.flash

    this.aura = new Aura(this.group, this.skin, R, C.graphics.auraScale);

    // The name tag is assembled from text nodes; a nickname is never parsed as HTML.
    // badge = crown / medal / nemesis marks, title = the chosen achievement title, streak = 🔥n
    const el = document.createElement('div');
    el.className = 'nameTag' + (data.ai ? ' ai' : '');
    this.badgeEl = document.createElement('em');
    this.titleEl = document.createElement('span');
    this.titleEl.className = 'title';
    this.nameNode = document.createTextNode(data.name);
    this.countEl = document.createElement('i');
    this.streakEl = document.createElement('i');
    this.streakEl.className = 'streak';
    el.append(this.badgeEl, this.titleEl, this.nameNode, this.countEl, this.streakEl);
    this.crown = null;                            // built on first wear
    this.beacon = null;                           // built on first "almost cleared" alert
    this.trailT = 0;
    this.label = new owner.CSS2DObject(el);
    // Anchor the tag's bottom edge (plus a small gap) at the projected point: a screen-space
    // offset that keeps the head bead clear at any zoom, where a world-space lift alone
    // shrinks to nothing once the camera is far out
    this.label.center.set(0.5, 1.4);
    this.labelEl = el;
    this.group.add(this.label);
  }

  hide() { this.group.visible = false; }

  startFlash(n, opts) {
    this.flashT = 0; this.flashN = n;
    this.flash = { scale: 1.55, color: 0xbfefff, orb: 2.0, orbOpacity: 0.5, ...opts };
    this.waveMat.color.set(this.flash.color);
  }

  update(s, anchor, isSelf, dt, labelR2, isNemesis) {
    this.group.visible = true;
    const C = this.o.C;
    const MAP = C.map.size;
    const R = C.snake.beadRadius;
    const n = s.beads.length;

    if (n === 0) {                                  // in the death pause: only the name tag stays
      for (const m of this.meshes) m.visible = false;
      this.arrow.visible = false;
      this.shield.visible = false;
      this.wave.visible = false;
      if (this.crown) this.crown.visible = false;
      if (this.beacon) this.beacon.visible = false;
      this.flashT = -1;
      this.aura.hide();
      if (s.deathPos) {
        const x = anchor.x + toroidalDelta(anchor.x, s.deathPos.x, MAP);
        const y = anchor.y + toroidalDelta(anchor.y, s.deathPos.y, MAP);
        this.label.position.set(x, 1.6, -y);
        this.label.visible = isSelf || this.o.near2(s.deathPos, anchor) < labelR2;
      } else {
        this.label.visible = false;
      }
      this.setLabel(s, '×', isSelf, false, isNemesis);
      return;
    }
    this.arrow.visible = true;
    this.label.visible = isSelf || this.o.near2(s.beads[0], anchor) < labelR2;

    // Scan wave: the crest sweeps from the joint (index flashN-1) to the new head (index 0);
    // with a single bead (eating) it just pops on the head
    let wave = -1, waveU = 0;
    if (this.flashT >= 0) {
      this.flashT += dt;
      waveU = this.flashT / this.flash.dur;
      if (waveU >= 1) this.flashT = -1;
      else wave = (1 - waveU) * (Math.min(this.flashN, n) - 1);
    }

    const flow = FLOW_SKINS.has(this.skin);
    const flowT = this.o.t;

    // Unwrap along the chain: bead 0 lands near the camera focus, every other bead takes
    // the shortest toroidal step from the one before it
    let px = anchor.x + toroidalDelta(anchor.x, s.beads[0].x, MAP);
    let py = anchor.y + toroidalDelta(anchor.y, s.beads[0].y, MAP);

    for (let i = 0; i < n; i++) {
      if (i > 0) {
        px += toroidalDelta(px, s.beads[i].x, MAP);
        py += toroidalDelta(py, s.beads[i].y, MAP);
      }
      const colorHex = this.o.colorOf(s.colors[i]);
      const phase = flow ? flowPhase(i, flowT, C.graphics.flowSpeed, C.graphics.flowSpacing) : -1;
      let m = this.meshes[i];
      if (!m) {
        m = makeBead(this.skin, colorHex, R, C.graphics.shadows, phase);
        this.group.add(m);
        this.meshes[i] = m;
      } else {
        retintBead(m, this.skin, colorHex, phase);
        m.visible = true;
      }
      m.position.set(px, s.beads[i].z, -py);
      let scale = i === 0 ? R * 1.18 : R;
      if (wave >= 0 && i < this.flashN) {
        const k = Math.max(0, 1 - Math.abs(i - wave) / 3);
        const settle = Math.min(1, (1 - waveU) / 0.3);   // ease the bulge out over the last 30%
        scale *= 1 + (this.flash.scale - 1) * k * k * settle;
      }
      m.scale.setScalar(scale);
      if (colorHex === null) m.rotation.y += dt * 1.8;                 // wild beads spin fast, to stand out
      else if (SPINNING_SKINS.has(this.skin)) m.rotation.y += dt * 0.7;
      if (i === 0) this.headPos.copy(m.position);
    }
    for (let i = n; i < this.meshes.length; i++) this.meshes[i].visible = false;

    this.wave.visible = wave >= 0 && this.flash.orb > 0;
    if (this.wave.visible) {
      this.wave.position.copy(this.meshes[Math.max(0, Math.round(wave))].position);
      this.wave.scale.setScalar(R * this.flash.orb * (1 + waveU * 0.9));
      this.waveMat.opacity = this.flash.orbOpacity * (1 - waveU);
    }

    this.aura.update(dt, this.meshes, n);

    this.arrow.position.set(
      this.headPos.x + Math.cos(s.dir) * 1.05,
      -R + 0.06,
      this.headPos.z - Math.sin(s.dir) * 1.05,
    );
    this.arrow.rotation.y = s.dir;
    this.dir = s.dir;
    this.arrow.material.opacity = isSelf ? 0.6 : 0.28;
    this.arrow.material.color.set(isSelf ? 0x9ff0ff : 0xffffff);

    // s.iv is the seconds of invulnerability left: solid while there is time, blinking over
    // the last 0.6s to warn that the protection is about to end
    const iv = s.iv;
    if (iv > 0) {
      this.shieldT += dt;
      this.shield.position.copy(this.headPos);
      this.shield.rotation.y += dt * 1.3;
      this.shield.scale.setScalar(1 + Math.sin(this.shieldT * 6) * 0.07);
      this.shield.visible = iv > 0.6 || Math.sin(this.shieldT * 26) > -0.25;
    } else {
      this.shield.visible = false;
    }

    // Crown: floats and turns above the head of the room's top player
    if (s.crown) {
      if (!this.crown) this.crown = this.buildCrown(R);
      this.crown.visible = true;
      this.crown.position.set(this.headPos.x, this.headPos.y + R * 2.1 + Math.sin(this.o.t * 3) * 0.12, this.headPos.z);
      this.crown.rotation.y += dt * 1.2;
    } else if (this.crown) {
      this.crown.visible = false;
    }

    // Beacon: a snake down to its last beads is lit up so the room can converge on it
    if (s.nearWin) {
      if (!this.beacon) {
        this.beacon = new THREE.Mesh(this.o.beaconGeo, this.o.beaconMat);
        this.group.add(this.beacon);
      }
      this.beacon.visible = true;
      this.beacon.position.set(this.headPos.x, 4.5, this.headPos.z);
    } else if (this.beacon) {
      this.beacon.visible = false;
    }

    // Milestone cosmetic: the tail tip leaves a trail of puffs in its own color
    if (this.o.onTrail && milestones(s.trophies, C).trail && n > 1) {
      this.trailT += dt;
      if (this.trailT >= TRAIL_EVERY) {
        this.trailT = 0;
        this.o.onTrail(this.meshes[n - 1].position, this.o.colorOf(s.colors[n - 1]) ?? 0xffffff);
      }
    }

    this.label.position.set(this.headPos.x, this.headPos.y + R * 1.3, this.headPos.z);
    this.setLabel(s, String(s.colors.length), isSelf, iv > 0, isNemesis);
  }

  buildCrown(R) {
    const g = new THREE.Group();
    const band = new THREE.Mesh(this.o.crownBandGeo, this.o.crownMat);
    band.rotation.x = Math.PI / 2;
    g.add(band);
    for (let i = 0; i < 5; i++) {
      const spike = new THREE.Mesh(this.o.crownSpikeGeo, this.o.crownMat);
      const a = (i / 5) * Math.PI * 2;
      spike.position.set(Math.cos(a), 0.4, Math.sin(a));
      g.add(spike);
    }
    g.scale.setScalar(R * 0.9);
    this.group.add(g);
    return g;
  }

  setLabel(s, count, isSelf, shielded, isNemesis) {
    if (this.nameNode.nodeValue !== s.name) this.nameNode.nodeValue = s.name;
    if (this.countEl.textContent !== count) this.countEl.textContent = count;
    const badge = (s.crown ? '👑' : '') + (s.medal ? MEDALS[s.medal] : '') + (isNemesis ? '⚔' : '');
    if (this.badgeEl.textContent !== badge) this.badgeEl.textContent = badge;
    const title = s.title ? `「${t(`title.${s.title}`)}」` : '';
    if (this.titleEl.textContent !== title) this.titleEl.textContent = title;
    const streak = s.streak ? `🔥${s.streak}` : '';
    if (this.streakEl.textContent !== streak) this.streakEl.textContent = streak;
    const cls = this.labelEl.classList;
    cls.toggle('self', isSelf);
    cls.toggle('shield', shielded);
    cls.toggle('crown', !!s.crown);
    cls.toggle('nemesis', isNemesis);
    cls.toggle('nearWin', !!s.nearWin);
    cls.toggle('gold', milestones(s.trophies, this.o.C).frame);
  }

  dispose() {
    this.label.removeFromParent();
    this.labelEl.remove();
    this.aura.dispose();
    this.o.scene.remove(this.group);
    this.arrow.material.dispose();
    this.waveMat.dispose();
    for (const m of this.shieldMats) m.dispose();
  }
}
