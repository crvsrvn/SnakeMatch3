// Item rendering: meshes are reused by index, rotating slowly and bobbing.
// A WILD bead gets the rainbow texture, is bigger and brighter and spins faster, so it is
// obvious on the field.

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

  sync(items, anchor, dt, cullRadius) {
    const MAP = this.C.map.size;
    const r2 = cullRadius * cullRadius;
    this.time += dt;
    let n = 0;
    for (let i = 0; i < items.length; i++) {
      const [, ix, iy, ci] = items[i];
      const ddx = toroidalDelta(anchor.x, ix, MAP), ddy = toroidalDelta(anchor.y, iy, MAP);
      if (ddx * ddx + ddy * ddy > r2) continue;      // items out of view never enter the render queue
      const wild = ci === WILD;
      let m = this.pool[n];
      if (!m) {
        m = new THREE.Mesh(this.geo, this.mats[0]);
        m.castShadow = this.C.graphics.shadows;
        this.scene.add(m);
        this.pool[n] = m;
      }
      if (m.geometry !== (wild ? this.wildGeo : this.geo)) m.geometry = wild ? this.wildGeo : this.geo;
      m.material = this.matFor(ci);
      m.visible = true;
      const spin = wild ? 2.2 : 0.6;
      m.position.set(anchor.x + ddx, Math.sin(this.time * 2 + i) * (wild ? 0.3 : 0.16) + (wild ? 0.35 : 0.1), -(anchor.y + ddy));
      m.rotation.set(this.time * spin + i, this.time * spin * 1.4 + i, 0);
      n++;
    }
    for (let i = n; i < this.pool.length; i++) this.pool[i].visible = false;
  }
}
