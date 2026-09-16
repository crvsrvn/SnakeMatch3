// Per-player progression on top of the profile: daily tasks and the daily first-win bonus,
// one-off achievements (each unlocks a title), best win streak, and the nemesis tally.
//
// Every hook takes the profile, updates it, and returns how many trophies the world should
// award for it (task rewards, first-win bonus). What changed is queued as a notice per
// address; the server drains the queue once per tick and sends each player a PROGRESS
// message, so the HUD only hears about its own progress and only when it moved.

import { CONFIG } from '../config/game.config.js';
import { dayKey } from './profiles.js';

const R = CONFIG.retention;

/** Achievement ids; each one carries a title of the same id (client/js/i18n.js title.*) */
export const ACHIEVEMENTS = ['firstWin', 'streak5', 'tie', 'wildMatch', 'bigGraft', 'chain3', 'regicide3', 'revenge'];

export class Progress {
  constructor(profiles) {
    this.profiles = profiles;
    this.notices = new Map();      // ip -> { unlocked: [], tasks: [], bonus: 0 }
  }

  note(p) {
    let n = this.notices.get(p.ip);
    if (!n) { n = { unlocked: [], tasks: [], bonus: 0 }; this.notices.set(p.ip, n); }
    return n;
  }

  /** Reset the daily block on the first touch of a new day */
  rollDaily(p) {
    const today = dayKey();
    if (p.daily.date === today) return;
    p.daily = { date: today, firstWin: false, eat: 0, sever: 0, chain: 0, done: {} };
  }

  /** Award every task whose threshold was just crossed; returns the trophies earned */
  checkTasks(p) {
    let trophies = 0;
    for (const [task, need] of Object.entries(R.dailyTasks)) {
      if (p.daily.done[task] || p.daily[task] < need) continue;
      p.daily.done[task] = true;
      this.note(p).tasks.push(task);
      trophies++;
    }
    return trophies;
  }

  unlock(p, id) {
    if (p.achievements[id]) return;
    p.achievements[id] = Date.now();
    this.note(p).unlocked.push(id);
  }

  // ---------- Hooks, called by the world ----------

  onEat(p) {
    this.rollDaily(p);
    p.daily.eat++;
    this.note(p);                  // the counter moved: the HUD wants the new number
    return this.checkTasks(p);
  }

  /** @param n beads actually grafted */
  onSever(p, n) {
    this.rollDaily(p);
    p.daily.sever++;
    if (n >= R.bigGraft) this.unlock(p, 'bigGraft');
    this.note(p);
    return this.checkTasks(p);
  }

  /** @param groups the clears of one resolve, in chain order; wild = a rainbow bead took part */
  onMatch(p, groups) {
    this.rollDaily(p);
    if (groups.length >= 2) p.daily.chain++;
    if (groups.length >= 3) this.unlock(p, 'chain3');
    if (groups.some((g) => g.wild)) this.unlock(p, 'wildMatch');
    return this.checkTasks(p);
  }

  /** @param streak the win streak including this win; returns the bonus trophies */
  onWin(p, streak) {
    this.rollDaily(p);
    let bonus = 0;
    if (!p.daily.firstWin) {
      p.daily.firstWin = true;
      bonus += R.firstWinBonus;
      this.note(p).bonus = R.firstWinBonus;
    }
    if (streak > p.bestStreak) p.bestStreak = streak;
    this.unlock(p, 'firstWin');
    if (streak >= 5) this.unlock(p, 'streak5');
    return bonus;
  }

  onDeath(p, cause, killer) {
    if (cause === 'headTie') this.unlock(p, 'tie');
    if (killer) {
      p.nemeses[killer.ip] = (p.nemeses[killer.ip] || 0) + 1;
      this.profiles.saveSoon();
    }
    return 0;
  }

  onRegicide(p) {
    p.counters.regicide = (p.counters.regicide || 0) + 1;
    if (p.counters.regicide >= 3) this.unlock(p, 'regicide3');
    return 0;
  }

  onRevenge(p) {
    this.unlock(p, 'revenge');
    return 0;
  }

  // ---------- Client snapshot ----------

  snapshot(p) {
    this.rollDaily(p);
    return {
      daily: p.daily,
      bestStreak: p.bestStreak,
      weekly: this.profiles.weeklyTrophies(p),
      medal: p.medal,
      achievements: Object.keys(p.achievements),
      title: p.title,
    };
  }

  /** Pending notices as PROGRESS payloads, one per address; clears the queue */
  drain() {
    if (this.notices.size === 0) return [];
    const out = [];
    for (const [ip, n] of this.notices) {
      const p = this.profiles.byIp(ip);
      if (p) out.push({ ip, ...this.snapshot(p), unlocked: n.unlocked, tasks: n.tasks, bonus: n.bonus });
    }
    this.notices.clear();
    this.profiles.saveSoon();
    return out;
  }
}
