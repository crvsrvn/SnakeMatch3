// 蛇的可视化：珠体网格池、昵称牌、朝向指示、出生保护罩。
// 服务器给的是"取模到地图内"的坐标，这里沿链条逐颗展开成连续渲染坐标，
// 这样蛇跨越边界时看起来是连成一条、平滑穿出去的。

import * as THREE from 'three';
import { makeBead, retintBead } from './skins.js';
import { toroidalDelta } from '/shared/mathUtil.js';

export class SnakeViews {
  constructor(scene, CONFIG, CSS2DObject) {
    this.scene = scene;
    this.C = CONFIG;
    this.CSS2DObject = CSS2DObject;
    this.views = new Map();
    this.arrowGeo = new THREE.ConeGeometry(0.3, 0.9, 3).rotateZ(-Math.PI / 2);
    this.bubbleGeo = new THREE.SphereGeometry(1, 20, 12);
  }

  /** @param anchor 相机焦点(游戏坐标) —— 所有渲染坐标都展开到它附近 */
  sync(snakes, anchor, myId, dt) {
    const seen = new Set();
    for (const s of snakes) {
      seen.add(s.id);
      let v = this.views.get(s.id);
      if (!v) { v = new SnakeView(this, s); this.views.set(s.id, v); }
      v.update(s, anchor, s.id === myId, dt);
    }
    for (const [id, v] of this.views) {
      if (!seen.has(id)) { v.dispose(); this.views.delete(id); }
    }
  }

  /** 取某条蛇某颗珠的渲染坐标（特效定位用） */
  headOf(id) { return this.views.get(id)?.headPos ?? null; }
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

    const arrowMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 });
    this.arrow = new THREE.Mesh(owner.arrowGeo, arrowMat);
    this.arrow.position.y = -C.snake.beadRadius + 0.06;
    this.group.add(this.arrow);

    this.bubble = new THREE.Mesh(owner.bubbleGeo, new THREE.MeshBasicMaterial({
      color: 0x7fdcff, transparent: true, opacity: 0.16,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.bubble.scale.setScalar(C.snake.beadRadius * 2.4);
    this.bubble.visible = false;
    this.group.add(this.bubble);

    // 名牌用文本节点拼装，绝不把玩家昵称当 HTML 解析
    const el = document.createElement('div');
    el.className = 'nameTag' + (data.ai ? ' ai' : '');
    this.nameNode = document.createTextNode(data.name);
    this.countEl = document.createElement('i');
    el.append(this.nameNode, this.countEl);
    this.label = new owner.CSS2DObject(el);
    this.labelEl = el;
    this.group.add(this.label);
  }

  update(s, anchor, isSelf, dt) {
    const C = this.o.C;
    const MAP = C.map.size;
    const R = C.snake.beadRadius;
    const n = s.beads.length;

    // 沿链条展开：第 0 颗对齐到相机焦点附近，其余相对前一颗取环面最短路
    let px = anchor.x + toroidalDelta(anchor.x, s.beads[0].x, MAP);
    let py = anchor.y + toroidalDelta(anchor.y, s.beads[0].y, MAP);

    for (let i = 0; i < n; i++) {
      if (i > 0) {
        px += toroidalDelta(px, s.beads[i].x, MAP);
        py += toroidalDelta(py, s.beads[i].y, MAP);
      }
      const colorHex = C.colors[s.colors[i]];
      let m = this.meshes[i];
      if (!m) {
        m = makeBead(this.skin, colorHex, R, C.graphics.shadows);
        this.group.add(m);
        this.meshes[i] = m;
      } else {
        retintBead(m, this.skin, colorHex);
        m.visible = true;
      }
      m.position.set(px, s.beads[i].z, -py);
      m.scale.setScalar(i === 0 ? R * 1.18 : R);
      if (this.skin === 'glass') m.rotation.y += dt * 0.7;
      if (i === 0) this.headPos.copy(m.position);
    }
    for (let i = n; i < this.meshes.length; i++) this.meshes[i].visible = false;

    this.arrow.position.set(
      this.headPos.x + Math.cos(s.dir) * 1.05,
      -R + 0.06,
      this.headPos.z - Math.sin(s.dir) * 1.05,
    );
    this.arrow.rotation.y = s.dir;
    this.arrow.material.opacity = isSelf ? 0.6 : 0.28;
    this.arrow.material.color.set(isSelf ? 0x9ff0ff : 0xffffff);

    this.bubble.visible = s.iv;
    if (s.iv) this.bubble.position.copy(this.headPos);

    this.label.position.set(this.headPos.x, this.headPos.y + R * 2.6, this.headPos.z);
    if (this.nameNode.nodeValue !== s.name) this.nameNode.nodeValue = s.name;
    const cnt = String(s.colors.length);
    if (this.countEl.textContent !== cnt) this.countEl.textContent = cnt;
    this.labelEl.classList.toggle('self', isSelf);
  }

  dispose() {
    this.label.removeFromParent();
    this.labelEl.remove();
    this.o.scene.remove(this.group);
    this.arrow.material.dispose();
    this.bubble.material.dispose();
  }
}
