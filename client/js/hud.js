// HUD：自身状态（含珠子颜色序列，用来规划三消）、在线排行、公告、网络指示、死亡面板。

import { WILD } from '/shared/protocol.js';

export class Hud {
  constructor(CONFIG) {
    this.C = CONFIG;
    const $ = (id) => document.getElementById(id);
    this.el = {
      hud: $('hud'), name: $('myName'), trophy: $('myTrophy'), len: $('myLen'),
      beads: $('beads'), board: $('boardList'), toasts: $('toasts'),
      fps: $('fps'), ping: $('ping'),
      death: $('death'), killer: $('dKiller'), count: $('dCount'),
    };
    this.lastBeads = '';
    this.lastBoard = '';
  }

  show() { this.el.hud.hidden = false; }

  setSelf(s) {
    this.el.name.textContent = s.name;
    this.el.trophy.textContent = `🏆 ${s.trophies}`;
    this.el.len.textContent = s.colors.length;
    const key = s.colors.join(',');
    if (key === this.lastBeads) return;
    this.lastBeads = key;
    this.el.beads.innerHTML = s.colors.map((c, i) => {
      const cls = `${i === 0 ? 'head ' : ''}${c === WILD ? 'wild' : ''}`.trim();
      const style = c === WILD ? '' : ` style="color:${this.C.colors[c]}"`;
      return `<i class="${cls}"${style}></i>`;
    }).join('');
  }

  setBoard(snakes, myId) {
    const rows = [...snakes].sort((a, b) => b.trophies - a.trophies || a.colors.length - b.colors.length);
    const html = rows.map((s) => {
      const cls = [s.id === myId ? 'me' : '', s.dead ? 'out' : ''].filter(Boolean).join(' ');
      const len = s.dead ? '💀' : s.colors.length;
      return `<li class="${cls}"><span>${s.ai ? '🤖 ' : ''}${escapeHtml(s.name)}</span>`
        + `<span><span class="len">${len}</span> <em>🏆${s.trophies}</em></span></li>`;
    }).join('');
    if (html === this.lastBoard) return;
    this.lastBoard = html;
    this.el.board.innerHTML = html;
  }

  /** 死亡面板：remain 为剩余秒数，null 表示隐藏 */
  setDeath(remain, killer) {
    if (remain == null) { this.el.death.hidden = true; return; }
    this.el.death.hidden = false;
    if (killer && this.el.killer.textContent !== killer) this.el.killer.textContent = killer;
    const n = String(Math.max(1, Math.ceil(remain)));
    if (this.el.count.textContent !== n) this.el.count.textContent = n;
  }

  toast(text, kind = '') {
    const d = document.createElement('div');
    d.className = `toast ${kind}`;
    d.textContent = text;
    this.el.toasts.appendChild(d);
    setTimeout(() => d.remove(), 3000);
    while (this.el.toasts.childElementCount > 5) this.el.toasts.firstChild.remove();
  }

  setStatus(fps, ping) {
    this.el.fps.textContent = fps;
    this.el.ping.textContent = ping;
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
