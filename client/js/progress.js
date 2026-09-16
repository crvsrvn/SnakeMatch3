// Your own progression: the daily task panel under the status card, and the toasts when a
// task, the daily first win or an achievement lands. Fed by the server's PROGRESS message,
// which only ever concerns you.

import { t, onLangChange } from './i18n.js';

const TASK_LABEL = { eat: 'hud.taskEat', sever: 'hud.taskSever', chain: 'hud.taskChain' };

export class Progress {
  constructor(CONFIG, hud) {
    this.C = CONFIG;
    this.hud = hud;
    this.list = document.getElementById('dailyList');
    this.last = null;                       // last PROGRESS payload, re-rendered on a language switch
    onLangChange(() => this.render());
  }

  onMessage(m) {
    this.last = m;
    this.render();
    for (const task of m.tasks || []) this.hud.toast(t('toast.taskDone', { task: t(TASK_LABEL[task]) }), 'win');
    if (m.bonus) this.hud.toast(t('toast.firstWin', { n: m.bonus }), 'win');
    for (const id of m.unlocked || []) {
      this.hud.toast(t('toast.unlock', { name: achievementName(id, this.C), title: t(`title.${id}`) }), 'win');
    }
  }

  render() {
    const m = this.last;
    if (!m) return;
    const rows = Object.entries(this.C.retention.dailyTasks).map(([task, need]) => {
      const done = !!m.daily.done[task];
      const n = Math.min(m.daily[task] || 0, need);
      return `<div class="task${done ? ' done' : ''}"><span>${done ? '✓ ' : ''}${t(TASK_LABEL[task])}</span><b>${n}/${need}</b></div>`;
    });
    rows.push(`<div class="task${m.daily.firstWin ? ' done' : ''}"><span>${t(m.daily.firstWin ? 'hud.firstWinDone' : 'hud.firstWin')}</span></div>`);
    this.list.innerHTML = rows.join('');
  }
}

export function achievementName(id, CONFIG) {
  return t(`ach.${id}`, { n: CONFIG.retention.bigGraft });
}

/** The next cosmetic milestone above this trophy count: { what: label, n: trophies still missing }, or null */
export function nextMilestone(trophies, CONFIG) {
  let best = null;
  for (const [key, need] of Object.entries(CONFIG.retention.milestones)) {
    if (need > trophies && (!best || need < best.need)) best = { key, need };
  }
  return best ? { what: t(`ms.${best.key}`), n: best.need - trophies } : null;
}

/** Which milestone cosmetics a trophy count has earned */
export function milestones(trophies, CONFIG) {
  const M = CONFIG.retention.milestones;
  return { trail: trophies >= M.trail, frame: trophies >= M.frame, burst: trophies >= M.burst, spawn: trophies >= M.spawn };
}
