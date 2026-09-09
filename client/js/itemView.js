// 道具渲染：按 id 复用网格，缓慢自转 + 上下浮动。

import * as THREE from 'three';
import { toroidalDelta } from '/shared/mathUtil.js';

export class ItemViews {
  constructor(scene, CONFIG) {
    this.scene = scene;
    this.C = CONFIG;
    this.geo = new THREE.IcosahedronGeometry(CONFIG.items.radius, 0);
    this.mats = CONFIG.colors.map((hex) => new THREE.MeshStandardMaterial({
      color: hex, emissive: new THREE.Color(hex), emissiveIntensity: 0.65,
      roughness: 0.25, metalness: 0.15,
    }));
    this.pool = [];
    this.time = 0;
  }

  sync(items, anchor, dt) {
    const MAP = this.C.map.size;
    this.time += dt;
    for (let i = 0; i < items.length; i++) {
      const [, ix, iy, ci] = items[i];
      let m = this.pool[i];
      if (!m) {
        m = new THREE.Mesh(this.geo, this.mats[ci]);
        m.castShadow = this.C.graphics.shadows;
        this.scene.add(m);
        this.pool[i] = m;
      }
      m.material = this.mats[ci];
      m.visible = true;
      const x = anchor.x + toroidalDelta(anchor.x, ix, MAP);
      const y = anchor.y + toroidalDelta(anchor.y, iy, MAP);
      m.position.set(x, Math.sin(this.time * 2 + i) * 0.16 + 0.1, -y);
      m.rotation.set(this.time * 0.6 + i, this.time * 0.9 + i, 0);
    }
    for (let i = items.length; i < this.pool.length; i++) this.pool[i].visible = false;
  }
}
