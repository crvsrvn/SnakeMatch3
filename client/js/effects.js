// Effects: a particle burst (one pooled Points), expanding shock rings, "ghost" beads for
// matches, and the death marker.
// Everything is preallocated, so nothing is garbage collected while playing.
// Fading is done by multiplying color by remaining lifetime under additive blending, which
// avoids writing a custom shader for it.

import * as THREE from 'three';
import { ghostGeometry, makeGhostMaterial } from './skins.js';

const MAX_P = 900;
const MAX_RING = 16;
const MAX_GHOST = 30;
const GHOST_DUR = 0.75;

export class Effects {
  constructor(scene, CONFIG) {
    this.C = CONFIG;
    this.pos = new Float32Array(MAX_P * 3);
    this.col = new Float32Array(MAX_P * 3);
    this.base = new Float32Array(MAX_P * 3);   // original particle color
    this.vel = new Float32Array(MAX_P * 3);
    this.life = new Float32Array(MAX_P);
    this.life0 = new Float32Array(MAX_P);
    this.cursor = 0;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.geo = geo;

    this.points = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 0.38, map: pointSprite(), vertexColors: true, transparent: true,
      depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
    }));
    this.points.frustumCulled = false;
    scene.add(this.points);

    const ringGeo = new THREE.RingGeometry(0.62, 0.8, 40);
    this.rings = [];
    for (let i = 0; i < MAX_RING; i++) {
      const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0, side: THREE.DoubleSide,
        depthWrite: false, blending: THREE.AdditiveBlending,
      }));
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      scene.add(m);
      this.rings.push({ mesh: m, t: 0, dur: 1, scale: 1 });
    }
    this.ringCursor = 0;

    // Ghost beads: a cleared bead blinks in place for a moment, so the player sees which
    // ones went
    this.ghosts = [];
    for (let i = 0; i < MAX_GHOST; i++) {
      const m = new THREE.Mesh(ghostGeometry(), makeGhostMaterial());
      m.visible = false;
      scene.add(m);
      this.ghosts.push({ mesh: m, t: -1, y0: 0 });
    }
    this.ghostCursor = 0;

    this.marker = makeDeathMarker();
    this.marker.visible = false;
    scene.add(this.marker);
    this.markerT = 0;

    for (let i = 0; i < MAX_P; i++) this.pos[i * 3 + 1] = -9999;
  }

  /** @param {THREE.Vector3} p position in three.js scene coordinates */
  burst(p, colorHex, count, speed, spread = 1) {
    const c = new THREE.Color(colorHex);
    for (let i = 0; i < count; i++) {
      const k = this.cursor;
      this.cursor = (this.cursor + 1) % MAX_P;
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(1 - Math.random() * 1.4);
      const s = speed * (0.45 + Math.random() * 0.9);
      this.pos[k * 3] = p.x + (Math.random() - 0.5) * spread;
      this.pos[k * 3 + 1] = p.y + (Math.random() - 0.5) * spread * 0.4;
      this.pos[k * 3 + 2] = p.z + (Math.random() - 0.5) * spread;
      this.vel[k * 3] = Math.sin(ph) * Math.cos(th) * s;
      this.vel[k * 3 + 1] = Math.abs(Math.cos(ph)) * s * 0.85 + 1.4;
      this.vel[k * 3 + 2] = Math.sin(ph) * Math.sin(th) * s;
      this.base[k * 3] = c.r; this.base[k * 3 + 1] = c.g; this.base[k * 3 + 2] = c.b;
      this.life0[k] = this.life[k] = 0.5 + Math.random() * 0.5;
    }
  }

  ring(p, colorHex, scale = 5, dur = 0.5) {
    const r = this.rings[this.ringCursor];
    this.ringCursor = (this.ringCursor + 1) % MAX_RING;
    r.mesh.position.copy(p);
    r.mesh.position.y += 0.06;
    r.mesh.material.color.set(colorHex);
    r.mesh.scale.setScalar(1);
    r.mesh.visible = true;
    r.t = 0; r.dur = dur; r.scale = scale;
  }

  /** Ghost bead: floats up, blinks a few times, disappears */
  ghost(p, colorHex) {
    const g = this.ghosts[this.ghostCursor];
    this.ghostCursor = (this.ghostCursor + 1) % MAX_GHOST;
    g.mesh.position.copy(p);
    g.mesh.material.color.set(colorHex);
    g.mesh.material.opacity = 0.9;
    g.mesh.scale.setScalar(this.C.snake.beadRadius);
    g.mesh.visible = true;
    g.t = 0;
    g.y0 = p.y;
  }

  markerOn() { this.marker.visible = true; this.markerT = 0; }
  markerOff() { this.marker.visible = false; }
  get markerVisible() { return this.marker.visible; }

  update(dt) {
    const { pos, vel, life, life0, col, base } = this;
    for (let i = 0; i < MAX_P; i++) {
      if (life[i] <= 0) continue;
      life[i] -= dt;
      if (life[i] <= 0) {
        pos[i * 3 + 1] = -9999;
        col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = 0;
        continue;
      }
      vel[i * 3 + 1] -= 14 * dt;                       // gravity
      pos[i * 3] += vel[i * 3] * dt;
      pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
      pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      if (pos[i * 3 + 1] < -0.45) { pos[i * 3 + 1] = -0.45; vel[i * 3 + 1] *= -0.35; }
      const a = life[i] / life0[i];
      col[i * 3] = base[i * 3] * a;
      col[i * 3 + 1] = base[i * 3 + 1] * a;
      col[i * 3 + 2] = base[i * 3 + 2] * a;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;

    for (const r of this.rings) {
      if (!r.mesh.visible) continue;
      r.t += dt;
      const u = r.t / r.dur;
      if (u >= 1) { r.mesh.visible = false; continue; }
      r.mesh.scale.setScalar(1 + u * r.scale);
      r.mesh.material.opacity = (1 - u) * 0.85;
    }

    for (const g of this.ghosts) {
      if (g.t < 0) continue;
      g.t += dt;
      const u = g.t / GHOST_DUR;
      if (u >= 1) { g.t = -1; g.mesh.visible = false; continue; }
      g.mesh.position.y = g.y0 + u * 1.5;
      g.mesh.scale.setScalar(this.C.snake.beadRadius * (1 + u * 0.55));
      // Blink three times over the first 70%, then fade out
      const blink = 0.55 + 0.45 * Math.cos(g.t * 40);
      g.mesh.material.opacity = u < 0.7 ? 0.95 * blink : 0.95 * blink * (1 - (u - 0.7) / 0.3);
    }

    if (this.marker.visible) {
      this.markerT += dt;
      const pulse = 1 + Math.sin(this.markerT * 5) * 0.12;
      this.marker.children[0].scale.setScalar(pulse);
      this.marker.children[1].material.opacity = 0.22 + Math.sin(this.markerT * 5) * 0.08;
    }
  }
}

/** Death marker: a pulsing ring on the ground plus a vertical beam */
function makeDeathMarker() {
  const g = new THREE.Group();

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(1.5, 1.9, 48),
    new THREE.MeshBasicMaterial({
      color: 0xff6a7d, transparent: true, opacity: 0.75, side: THREE.DoubleSide,
      depthWrite: false, blending: THREE.AdditiveBlending,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.05;
  g.add(ring);

  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.42, 0.42, 9, 16, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xff6a7d, transparent: true, opacity: 0.25, side: THREE.DoubleSide,
      depthWrite: false, blending: THREE.AdditiveBlending,
    }),
  );
  beam.position.y = 4.5;
  g.add(beam);

  return g;
}

/** Soft round particle sprite, shared by the effects and the bead aura */
export function pointSprite() {
  if (spriteTex) return spriteTex;
  const N = 64;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.35, 'rgba(255,255,255,.7)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, N, N);
  spriteTex = new THREE.CanvasTexture(c);
  spriteTex.colorSpace = THREE.SRGBColorSpace;
  return spriteTex;
}
let spriteTex = null;
