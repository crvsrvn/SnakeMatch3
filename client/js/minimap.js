// 小地图：整张地图缩略图，画出所有蛇的位置、万能珠簇与自己的死亡点。
// 逐颗珠画点而不是画折线 —— 蛇跨越边界时折线会横穿整张图，画点则天然正确。

import { WILD } from '/shared/protocol.js';

const REDRAW_HZ = 20;

export class Minimap {
  constructor(canvas, CONFIG) {
    this.C = CONFIG;
    this.cv = canvas;
    const px = CONFIG.minimap.size;
    const dpr = Math.min(devicePixelRatio, 2);
    canvas.width = px * dpr;
    canvas.height = px * dpr;
    canvas.style.width = `${px}px`;
    canvas.style.height = `${px}px`;
    this.g = canvas.getContext('2d');
    this.g.scale(dpr, dpr);
    this.px = px;
    this.acc = 0;
  }

  /** @param deathPos 自己的死亡点(可为 null) */
  draw(snakes, items, myId, deathPos, dt) {
    this.acc += dt;
    if (this.acc < 1 / REDRAW_HZ) return;
    this.acc = 0;

    const { g, px } = this;
    const C = this.C;
    const k = px / C.map.size;
    const dot = C.minimap.dotSize;

    g.clearRect(0, 0, px, px);
    g.fillStyle = 'rgba(10,16,30,.72)';
    g.fillRect(0, 0, px, px);

    // 网格
    g.strokeStyle = 'rgba(120,160,230,.13)';
    g.lineWidth = 1;
    g.beginPath();
    for (let v = 0; v <= C.map.size; v += C.map.gridStep * 4) {
      g.moveTo(v * k, 0); g.lineTo(v * k, px);
      g.moveTo(0, v * k); g.lineTo(px, v * k);
    }
    g.stroke();

    // 万能珠簇
    g.fillStyle = '#ffffff';
    for (const it of items) {
      if (it[3] !== WILD) continue;
      g.globalAlpha = 0.85;
      g.fillRect(it[1] * k - 1, (C.map.size - it[2]) * k - 1, 2.5, 2.5);
    }
    g.globalAlpha = 1;

    // 蛇：身体小点 + 头部大点
    for (const s of snakes) {
      const me = s.id === myId;
      if (s.beads.length === 0) {
        if (!s.deathPos) continue;
        g.strokeStyle = me ? '#ff6a7d' : 'rgba(255,106,125,.45)';
        g.lineWidth = 1.5;
        const x = s.deathPos.x * k, y = (C.map.size - s.deathPos.y) * k;
        g.beginPath();
        g.moveTo(x - 3, y - 3); g.lineTo(x + 3, y + 3);
        g.moveTo(x + 3, y - 3); g.lineTo(x - 3, y + 3);
        g.stroke();
        continue;
      }
      const body = me ? 'rgba(90,210,255,.55)' : (s.ai ? 'rgba(190,205,230,.3)' : 'rgba(255,255,255,.42)');
      g.fillStyle = body;
      for (let i = 1; i < s.beads.length; i++) {
        const b = s.beads[i];
        g.fillRect(b.x * k - 0.8, (C.map.size - b.y) * k - 0.8, 1.6, 1.6);
      }
      const h = s.beads[0];
      g.fillStyle = me ? '#5ad2ff' : (s.ai ? '#9fb0cc' : '#ffffff');
      g.beginPath();
      g.arc(h.x * k, (C.map.size - h.y) * k, me ? dot : dot * 0.8, 0, Math.PI * 2);
      g.fill();
      if (me) {
        g.strokeStyle = '#5ad2ff';
        g.lineWidth = 1.2;
        g.beginPath();
        g.arc(h.x * k, (C.map.size - h.y) * k, dot + 3, 0, Math.PI * 2);
        g.stroke();
      }
    }

    // 自己的死亡点（重生后仍显示一段时间）
    if (deathPos) {
      g.strokeStyle = '#ff6a7d';
      g.lineWidth = 1.6;
      const x = deathPos.x * k, y = (C.map.size - deathPos.y) * k;
      g.beginPath();
      g.arc(x, y, 5, 0, Math.PI * 2);
      g.moveTo(x - 3.5, y - 3.5); g.lineTo(x + 3.5, y + 3.5);
      g.moveTo(x + 3.5, y - 3.5); g.lineTo(x - 3.5, y + 3.5);
      g.stroke();
    }

    g.strokeStyle = 'rgba(120,190,255,.4)';
    g.lineWidth = 1;
    g.strokeRect(0.5, 0.5, px - 1, px - 1);
  }
}
