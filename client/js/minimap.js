// Minimap: the whole map in miniature, showing every snake, the wild bead clusters, and
// your own death spot.
// Beads are drawn as dots rather than a polyline: a polyline would cut straight across the
// map whenever a snake wraps, while dots are correct for free.

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
    this.t = 0;
  }

  /** @param deathPos your own death spot, or null */
  draw(snakes, items, myId, deathPos, dt) {
    this.t += dt;
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

    // Grid
    g.strokeStyle = 'rgba(120,160,230,.13)';
    g.lineWidth = 1;
    g.beginPath();
    for (let v = 0; v <= C.map.size; v += C.map.gridStep * 4) {
      g.moveTo(v * k, 0); g.lineTo(v * k, px);
      g.moveTo(0, v * k); g.lineTo(px, v * k);
    }
    g.stroke();

    // Wild beads: a haloed dot cycling slowly through the hues. Rainbow rather than a white
    // square, so it is unmistakable among the other markers and still findable on a busy map.
    for (const it of items) {
      if (it[3] !== WILD) continue;
      const x = it[1] * k, y = (C.map.size - it[2]) * k;
      const hue = Math.floor(this.t * 70 + x * 4 + y * 4) % 360;
      g.fillStyle = `hsla(${hue},100%,65%,.3)`;
      g.beginPath(); g.arc(x, y, 5.5, 0, Math.PI * 2); g.fill();
      g.fillStyle = `hsl(${hue},100%,72%)`;
      g.beginPath(); g.arc(x, y, 2.4, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(255,255,255,.9)';
      g.lineWidth = 1;
      g.beginPath(); g.arc(x, y, 2.4, 0, Math.PI * 2); g.stroke();
    }

    // Snakes: small dots for the body, a larger one for the head
    for (const s of snakes) {
      const me = s.id === myId;
      if (s.beads.length === 0) {
        if (!s.deathPos || s.win) continue;      // a win pause is not a death, so no cross
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

    // Your own death spot, still shown for a while after respawning
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
