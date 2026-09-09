// 珠体雾气：每条蛇挂一层粒子，粒子随机附着到某颗珠子上再上浮淡出。
// 粒子数与蛇长无关（长蛇不会更贵），颜色取自它附着的那颗珠子，所以雾气跟着蛇身颜色走。
// 只有"绚丽向"皮肤有雾气；哑光陶土故意留白，用来和其他皮肤拉开对比。

import * as THREE from 'three';
import { pointSprite } from './effects.js';

// n 基准粒子数 / color 皮肤主色 / tint 与珠子本色的混合比例
// size 粒子大小 / rise 上浮速度 / life 寿命(秒) / spread 附着点的随机半径(相对珠半径)
const AURA = {
  glass: { n: 8, color: 0xcfeaff, tint: 0.45, size: 0.20, rise: 0.6, life: 1.1, spread: 1.0 },
  matte: null,
  metal: { n: 8, color: 0xffffff, tint: 0.25, size: 0.16, rise: 0.5, life: 0.8, spread: 0.8 },
  neon: { n: 20, color: 0xffffff, tint: 0.85, size: 0.30, rise: 0.8, life: 1.0, spread: 1.1 },
  candy: { n: 12, color: 0xffe8f6, tint: 0.6, size: 0.22, rise: 0.7, life: 1.0, spread: 1.0 },
  aurora: { n: 20, color: 0x9fffe8, tint: 0.55, size: 0.30, rise: 0.9, life: 1.2, spread: 1.2 },
  galaxy: { n: 20, color: 0xbfc8ff, tint: 0.5, size: 0.24, rise: 0.45, life: 1.5, spread: 1.4 },
  magma: { n: 24, color: 0xff7a1e, tint: 0.4, size: 0.30, rise: 1.7, life: 0.9, spread: 0.9 },
};

const tmpColor = new THREE.Color();

export class Aura {
  /** @param parent 蛇的渲染 Group —— 挂在它下面，蛇被整体剔除时雾气自然跟着隐藏 */
  constructor(parent, skin, beadRadius, scale) {
    const cfg = AURA[skin];
    this.n = 0;
    if (!cfg || scale <= 0) return;

    this.cfg = cfg;
    this.R = beadRadius;
    this.skinColor = new THREE.Color(cfg.color);
    const n = Math.max(1, Math.round(cfg.n * scale));
    this.n = n;
    this.pos = new Float32Array(n * 3);
    this.col = new Float32Array(n * 3);
    this.base = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.life0 = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      this.pos[i * 3 + 1] = -9999;                 // 出生前藏到地下，避免第一帧闪一下
      this.life0[i] = cfg.life;
      this.life[i] = Math.random() * cfg.life;     // 错开寿命，不然会一起生一起灭
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.geo = geo;
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({
      size: cfg.size, map: pointSprite(), vertexColors: true, transparent: true,
      depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
    }));
    this.points.frustumCulled = false;
    parent.add(this.points);
  }

  hide() { if (this.n) this.points.visible = false; }

  /**
   * @param meshes 珠子网格池（位置已是展开后的渲染坐标）
   * @param count  本帧实际用到的珠子数
   */
  update(dt, meshes, count) {
    if (!this.n) return;
    if (count === 0) { this.points.visible = false; return; }
    this.points.visible = true;

    const { pos, vel, col, base, life, life0, cfg, R } = this;
    for (let i = 0; i < this.n; i++) {
      life[i] -= dt;
      if (life[i] <= 0) {
        const m = meshes[(Math.random() * count) | 0];
        const hex = m.userData.color;
        tmpColor.set(hex === null ? 0xffffff : hex).lerp(this.skinColor, 1 - cfg.tint);
        base[i * 3] = tmpColor.r; base[i * 3 + 1] = tmpColor.g; base[i * 3 + 2] = tmpColor.b;
        const s = R * cfg.spread;
        pos[i * 3] = m.position.x + (Math.random() - 0.5) * 2 * s;
        pos[i * 3 + 1] = m.position.y + (Math.random() - 0.5) * s;
        pos[i * 3 + 2] = m.position.z + (Math.random() - 0.5) * 2 * s;
        vel[i * 3] = (Math.random() - 0.5) * 0.5;
        vel[i * 3 + 1] = cfg.rise * (0.6 + Math.random() * 0.8);
        vel[i * 3 + 2] = (Math.random() - 0.5) * 0.5;
        life0[i] = cfg.life * (0.6 + Math.random() * 0.8);
        life[i] = life0[i];
      } else {
        pos[i * 3] += vel[i * 3] * dt;
        pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
        pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      }
      // 一进一出地淡：正弦包络比线性淡出更像烟气，也不会一冒出来就是最亮
      const a = Math.sin(Math.PI * (1 - life[i] / life0[i]));
      col[i * 3] = base[i * 3] * a;
      col[i * 3 + 1] = base[i * 3 + 1] * a;
      col[i * 3 + 2] = base[i * 3 + 2] * a;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }

  dispose() {
    if (!this.n) return;
    this.points.removeFromParent();
    this.geo.dispose();
    this.points.material.dispose();
  }
}
