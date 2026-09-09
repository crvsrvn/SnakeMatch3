// 特效：粒子迸溅（一个 Points 池）+ 扩散冲击环（Mesh 池）。全部对象预分配，运行期零 GC。
// 用叠加混合下"颜色乘以剩余寿命"来做淡出，避免为此写自定义 shader。

import * as THREE from 'three';

const MAX_P = 900;
const MAX_RING = 16;

export class Effects {
  constructor(scene) {
    this.pos = new Float32Array(MAX_P * 3);
    this.col = new Float32Array(MAX_P * 3);
    this.base = new Float32Array(MAX_P * 3);   // 粒子原始颜色
    this.vel = new Float32Array(MAX_P * 3);
    this.life = new Float32Array(MAX_P);
    this.life0 = new Float32Array(MAX_P);
    this.cursor = 0;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.geo = geo;

    this.points = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 0.38, map: sprite(), vertexColors: true, transparent: true,
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

    for (let i = 0; i < MAX_P; i++) this.pos[i * 3 + 1] = -9999;
  }

  /** @param {THREE.Vector3} p three 场景坐标 */
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
      vel[i * 3 + 1] -= 14 * dt;                       // 重力
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
  }
}

function sprite() {
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
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
