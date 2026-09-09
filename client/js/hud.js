// HUD：自身状态（含珠子颜色序列，用来规划三消）、在线排行、公告、网络指示。

export class Hud {
  constructor(CONFIG) {
    this.C = CONFIG;
    this.el = {
      hud: document.getElementById('hud'),
      name: document.getElementById('myName'),
      trophy: document.getElementById('myTrophy'),
      len: document.getElementById('myLen'),
      beads: document.getElementById('beads'),
      board: document.getElementById('boardList'),
      toasts: document.getElementById('toasts'),
      fps: document.getElementById('fps'),
      ping: document.getElementById('ping'),
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
    this.el.beads.innerHTML = s.colors
      .map((c, i) => `<i class="${i === 0 ? 'head' : ''}" style="color:${this.C.colors[c]}"></i>`)
      .join('');
  }

  setBoard(snakes, myId) {
    const rows = [...snakes].sort((a, b) => b.trophies - a.trophies || a.colors.length - b.colors.length);
    const html = rows.map((s) => `<li class="${s.id === myId ? 'me' : ''}">`
      + `<span>${s.ai ? '🤖 ' : ''}${escapeHtml(s.name)}</span>`
      + `<span><span class="len">${s.colors.length}</span> <em>🏆${s.trophies}</em></span></li>`).join('');
    if (html === this.lastBoard) return;
    this.lastBoard = html;
    this.el.board.innerHTML = html;
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
