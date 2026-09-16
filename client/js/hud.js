// HUD: own status (including the bead color sequence, for planning matches), live
// leaderboard, announcements, network readout, and the death / win pause panels.

import { WILD } from '/shared/protocol.js';
import { t, onLangChange } from './i18n.js';

export class Hud {
  constructor(CONFIG) {
    this.C = CONFIG;
    const $ = (id) => document.getElementById(id);
    this.el = {
      hud: $('hud'), name: $('myName'), trophy: $('myTrophy'), len: $('myLen'),
      beads: $('beads'), board: $('boardList'), toasts: $('toasts'),
      fps: $('fps'), frameMs: $('frameMs'), ping: $('ping'),
      death: $('death'), reason: $('dReason'), count: $('dCount'), dStats: $('dStats'),
      win: $('win'), wTrophy: $('wTrophy'), wCount: $('wCount'), wGain: $('wGain'), wStreak: $('wStreak'),
    };
    this.lastBeads = '';
    this.lastBoard = '';
    this.boardAcc = 9;
    this.online = 0;
    this.boardTitle = $('boardTitle');
    onLangChange(() => this.renderBoardTitle());
  }

  show() { this.el.hud.hidden = false; }

  renderBoardTitle() {
    if (this.boardTitle) this.boardTitle.textContent = t('hud.online', { n: this.online });
  }

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

  /** Only the top maxRows (you are always included), rate limited to board.updateHz --
   *  rebuilding a hundred rows of innerHTML every frame is pure waste with a full server. */
  setBoard(snakes, myId, dt) {
    this.boardAcc += dt;
    if (this.boardAcc < 1 / this.C.board.updateHz) return;
    this.boardAcc = 0;

    const all = [...snakes].sort((a, b) => b.trophies - a.trophies || a.colors.length - b.colors.length);
    const max = this.C.board.maxRows;
    let rows = all.slice(0, max);
    const meRank = all.findIndex((s) => s.id === myId);
    if (meRank >= max) rows = [...all.slice(0, max - 1), all[meRank]];
    if (this.online !== all.length) {
      this.online = all.length;
      this.renderBoardTitle();
    }

    const html = rows.map((s) => {
      const rank = all.indexOf(s) + 1;
      const cls = [s.id === myId ? 'me' : '', s.dead ? 'out' : ''].filter(Boolean).join(' ');
      const len = s.dead ? (s.win ? '🏆' : '💀') : s.colors.length;
      const badge = (s.crown ? '👑 ' : '') + (s.medal ? MEDALS[s.medal] + ' ' : '') + (s.ai ? '🤖 ' : '');
      const streak = s.streak ? `<span class="streak">🔥${s.streak}</span>` : '';
      const weekly = s.weekly ? `<small>+${s.weekly}</small>` : '';
      return `<li class="${cls}"><span><i class="rank">${rank}</i>${badge}${escapeHtml(s.name)}${streak}</span>`
        + `<span><span class="len">${len}</span> <em>🏆${s.trophies}${weekly}</em></span></li>`;
    }).join('');
    if (html === this.lastBoard) return;
    this.lastBoard = html;
    this.el.board.innerHTML = html;
  }

  /**
   * Pause panel: death and win share one countdown. remain === null hides both.
   * @param info { trophies, gain, streak } for a win; { reason, stats } for a death, where
   *   stats is the near-miss line ("down to N beads, ate X, severed Y")
   */
  setPause(remain, won, info) {
    const el = won ? this.el.win : this.el.death;
    const other = won ? this.el.death : this.el.win;
    if (!other.hidden) other.hidden = true;
    if (remain == null) { el.hidden = true; return; }
    el.hidden = false;
    if (won) {
      setText(this.el.wTrophy, String(info.trophies));
      setText(this.el.wGain, String(info.gain || 1));
      setText(this.el.wStreak, info.streak >= 2 ? t('win.streak', { n: info.streak }) : '');
    } else {
      if (info.reason) setText(this.el.reason, info.reason);
      setText(this.el.dStats, info.stats || '');
    }
    const count = won ? this.el.wCount : this.el.count;
    const n = String(Math.max(1, Math.ceil(remain)));
    if (count.textContent !== n) count.textContent = n;
  }

  toast(text, kind = '') {
    const d = document.createElement('div');
    d.className = `toast ${kind}`;
    d.textContent = text;
    this.el.toasts.appendChild(d);
    setTimeout(() => d.remove(), 3000);
    while (this.el.toasts.childElementCount > 5) this.el.toasts.firstChild.remove();
  }

  setStatus(fps, frameMs, ping) {
    this.el.fps.textContent = fps;
    this.el.frameMs.textContent = frameMs;
    this.el.ping.textContent = ping;
  }
}

export const MEDALS = { 1: '🥇', 2: '🥈', 3: '🥉' };

/** Assign textContent only on change: rewriting it every frame would thrash layout for nothing */
function setText(el, s) {
  if (el.textContent !== s) el.textContent = s;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
