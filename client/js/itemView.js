// 道具渲染：按序号复用网格，缓慢自转 + 上下浮动。
// 万能珠(WILD)用彩虹贴图、更大更亮、转得更快，便于在场上一眼认出来。

import * as THREE from 'three';
import { toroidalDelta } from '/shared/mathUtil.js';
import { WILD } from '/shared/protocol.js';
import { rainbowTexture } from './skins.js';

export class ItemViews {
  constructor(scene, CONFIG) {
    this.scene = scene;
    this.C = CONFIG;
    this.geo = new THREE.IcosahedronGeometry(CONFIG.items.radius, 0);
    this.wildGeo = new THREE.IcosahedronGeometry(CONFIG.items.radius * 1.25, 1);
    this.mats = CONFIG.colors.map((hex) => new THREE.MeshStandardMaterial({
      color: hex, emissive: new THREE.Color(hex), emissiveIntensity: 0.65,
      roughness: 0.25, metalness: 0.15,
    }));
    this.wildMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, map: rainbowTexture(), emissiveMap: rainbowTexture(),
      emissive: new THREE.Color(0xffffff), emissiveIntensity: 0.9,
      roughness: 0.2, metalness: 0.1,
    });
    this.pool = [];
    this.time = 0;
  }

  matFor(c) { return c === WILD ? this.wildMat : this.mats[c]; }

  sync(items, anchor, dt) {
    const MAP = this.C.map.size;
    this.time += dt;
    for (let i = 0; i < items.length; i++) {
      const [, ix, iy, ci] = items[i];
      const wild = ci === WILD;
      let m = this.pool[i];
      if (!m) {
        m = new THREE.Mesh(this.geo, this.mats[0]);
        m.castShadow = this.C.graphics.shadows;
        this.scene.add(m);
        this.pool[i] = m;
      }
      if (m.geometry !== (wild ? this.wildGeo : this.geo)) m.geometry = wild ? this.wildGeo : this.geo;
      m.material = this.matFor(ci);
      m.visible = true;
      const x = anchor.x + toroidalDelta(anchor.x, ix, MAP);
      const y = anchor.y + toroidalDelta(anchor.y, iy, MAP);
      const spin = wild ? 2.2 : 0.6;
      m.position.set(x, Math.sin(this.time * 2 + i) * (wild ? 0.3 : 0.16) + (wild ? 0.35 : 0.1), -y);
      m.rotation.set(this.time * spin + i, this.time * spin * 1.4 + i, 0);
    }
    for (let i = items.length; i < this.pool.length; i++) this.pool[i].visible = false;
  }
}
