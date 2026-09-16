// Player profiles, one per IP address: the nickname (renamable a limited number of times),
// the trophy count, and everything the retention features remember between sessions --
// weekly trophies and medals, daily task progress, achievements and the chosen title,
// who killed you most, and when you were last seen.
//
// Trophies are written immediately and atomically: a trophy is a durable result, so it must
// survive the server being killed at any moment. Counters that change on every eaten bead
// go through saveSoon() instead, which coalesces them into one write every couple of seconds.
//
// The file (database/db.json) may be edited by hand while the server runs; run/6-reload.cmd
// then asks the server to re-read it (see reload()).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG } from '../config/game.config.js';
import { syncInPlace } from '../shared/sync.js';

// SM3_DB points the tests at a scratch file instead of the real database
const DB_FILE = process.env.SM3_DB || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'database', 'db.json');
const DIR = path.dirname(DB_FILE);
const TMP = `${DB_FILE}.tmp`;
const VERSION = 2;
const SAVE_SOON_MS = 2000;

/** ISO week key of the current moment, cached: it is read for every player on every frame */
let cachedWeek = '', cachedAt = 0;
export function weekKey() {
  const now = Date.now();
  if (now - cachedAt > 10000) { cachedWeek = weekKeyOf(new Date(now)); cachedAt = now; }
  return cachedWeek;
}

/** ISO week key in server local time, e.g. 2026-W38 */
export function weekKeyOf(d) {
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = (t.getDay() + 6) % 7;            // Monday = 0
  t.setDate(t.getDate() - day + 3);            // the Thursday of this week decides the year
  const year = t.getFullYear();
  const jan4 = new Date(year, 0, 4);
  const week = 1 + Math.round(((t - jan4) / 86400000 - 3 + ((jan4.getDay() + 6) % 7)) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/** Local calendar date, e.g. 2026-09-16 */
export function dayKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function blankProfile(ip, nickname) {
  return {
    ip, nickname, trophies: 0, renames: 0,
    bestStreak: 0, lastSeen: 0, lastRank: 0, lastTrophyAt: 0,
    weekly: { key: weekKey(), trophies: 0 }, medal: 0,
    daily: { date: dayKey(), firstWin: false, eat: 0, sever: 0, chain: 0, done: {} },
    achievements: {}, counters: {}, title: null,
    nemeses: {},
  };
}

/** Fill in fields a hand-edited or older record lacks, so the rest of the code never checks */
function normalize(p) {
  const base = blankProfile(p.ip, p.nickname);
  for (const [k, v] of Object.entries(base)) {
    if (p[k] === undefined || p[k] === null) p[k] = v;
    else if (typeof v === 'object' && !Array.isArray(v) && typeof p[k] === 'object') {
      for (const [kk, vv] of Object.entries(v)) if (p[k][kk] === undefined) p[k][kk] = vv;
    }
  }
  return p;
}

export class Profiles {
  constructor() {
    this.map = new Map();          // ip -> profile
    this.hall = [];                // [{ week, top: [{ nickname, trophies }] }], newest first
    this.settledWeek = '';         // the week whose medals are currently worn
    this.saveTimer = null;
    this.load();
  }

  load() {
    let raw;
    try { raw = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch { return; }   // no file on first run
    this.apply(raw);
    console.log(`[profiles] loaded ${this.map.size} record(s)`);
    if (raw.version !== VERSION) this.save();   // migrated: write the new layout right away
  }

  /** Read a parsed file into the maps, migrating the v1 "ip::nickname" layout on the way */
  apply(raw) {
    const players = raw.version === VERSION ? (raw.players || {}) : migrateV1(raw);
    for (const k of this.map.keys()) if (!(k in players)) this.map.delete(k);
    for (const [ip, v] of Object.entries(players)) {
      const cur = this.map.get(ip);
      if (cur) syncInPlace(cur, normalize(v)); else this.map.set(ip, normalize(v));
    }
    this.hall = raw.hall || [];
    this.settledWeek = raw.settledWeek || '';
    this.settleWeek();
  }

  /**
   * Re-read the file after the admin edited it by hand. Existing records are updated in
   * place rather than replaced: a snake on the map holds a reference to its profile, and a
   * trophy won after the reload must land in the object that gets saved.
   * Throws on unreadable JSON so the caller can report it; the old data stays in force.
   */
  reload() {
    this.apply(JSON.parse(fs.readFileSync(DB_FILE, 'utf8')));
    console.log(`[profiles] reloaded ${this.map.size} record(s)`);
    return this.map.size;
  }

  /**
   * Write to a temporary file and rename over the real one. Rename is atomic on both
   * NTFS and POSIX, so a crash can leave the previous version intact but never a
   * half-written file.
   */
  save() {
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    try {
      fs.mkdirSync(DIR, { recursive: true });
      const fd = fs.openSync(TMP, 'w');
      fs.writeFileSync(fd, JSON.stringify({
        version: VERSION,
        settledWeek: this.settledWeek,
        hall: this.hall,
        players: Object.fromEntries(this.map),
      }, null, 2));
      fs.fsyncSync(fd);            // rename is only safe once the bytes are on disk
      fs.closeSync(fd);
      fs.renameSync(TMP, DB_FILE);
    } catch (e) {
      console.error('[profiles] write failed', e.message);
    }
  }

  /** Coalesced write for counters that change many times a second */
  saveSoon() {
    if (!this.saveTimer) this.saveTimer = setTimeout(() => this.save(), SAVE_SOON_MS);
  }

  // ---------- Identity ----------

  byIp(ip) { return this.map.get(ip) || null; }

  /** The profile (any IP) using this nickname, or null */
  byNickname(nickname) {
    for (const p of this.map.values()) if (p.nickname === nickname) return p;
    return null;
  }

  /** Nicknames every other address owns, so the login screen can warn early */
  takenNicknames(exceptIp) {
    return [...this.map.values()].filter((p) => p.ip !== exceptIp).map((p) => p.nickname);
  }

  create(ip, nickname) {
    const p = blankProfile(ip, nickname);
    this.map.set(ip, p);
    this.save();
    return p;
  }

  canRename(p) { return p.renames < CONFIG.profiles.maxRenames; }

  rename(p, nickname) {
    p.nickname = nickname;
    p.renames++;
    this.save();
  }

  // ---------- Trophies and weekly board ----------

  /** @param n trophies to add; every source (win, regicide, revenge, bonuses) goes through here */
  addTrophy(p, n = 1) {
    this.settleWeek();
    p.trophies += n;
    p.lastTrophyAt = Date.now();
    if (p.weekly.key !== weekKey()) p.weekly = { key: weekKey(), trophies: 0 };
    p.weekly.trophies += n;
    this.save();
  }

  /** Trophies won this week, 0 if the record is from an older week */
  weeklyTrophies(p) { return p.weekly.key === weekKey() ? p.weekly.trophies : 0; }

  /**
   * Lazy weekly settlement: the first access in a new week takes the latest finished week
   * that anyone scored in, records its top three in the hall of fame, and hands those
   * players a medal to wear until the next settlement. No timer: a server that was off over
   * the weekend settles on the first join afterwards.
   */
  settleWeek() {
    const now = weekKey();
    if (this.settledWeek === now) return;
    let last = '';
    for (const p of this.map.values()) {
      if (p.weekly.key !== now && p.weekly.trophies > 0 && p.weekly.key > last) last = p.weekly.key;
    }
    for (const p of this.map.values()) p.medal = 0;
    if (last && !this.hall.some((h) => h.week === last)) {
      const top = [...this.map.values()]
        .filter((p) => p.weekly.key === last && p.weekly.trophies > 0)
        .sort((a, b) => b.weekly.trophies - a.weekly.trophies || a.nickname.localeCompare(b.nickname))
        .slice(0, 3);
      top.forEach((p, i) => { p.medal = i + 1; });
      this.hall.unshift({ week: last, top: top.map((p) => ({ nickname: p.nickname, trophies: p.weekly.trophies })) });
      this.hall.length = Math.min(this.hall.length, CONFIG.retention.hallWeeks);
    }
    this.settledWeek = now;
    this.saveSoon();
  }

  // ---------- Ranking (for the "you were overtaken" note) ----------

  /** 1-based rank by total trophies */
  rank(p) {
    let r = 1;
    for (const q of this.map.values()) if (q !== p && q.trophies > p.trophies) r++;
    return r;
  }

  /** Players now above p who won a trophy after p was last seen -- only if p's rank actually slipped */
  overtakenBy(p) {
    if (!p.lastSeen || this.rank(p) <= p.lastRank) return [];
    return [...this.map.values()]
      .filter((q) => q !== p && q.trophies > p.trophies && q.lastTrophyAt > p.lastSeen)
      .sort((a, b) => b.trophies - a.trophies)
      .map((q) => q.nickname);
  }

  /** Who killed p the most, resolved to their current nickname */
  topNemesis(p) {
    let best = null;
    for (const [ip, n] of Object.entries(p.nemeses)) {
      const q = this.map.get(ip);
      if (q && (!best || n > best.n)) best = { nickname: q.nickname, n };
    }
    return best;
  }

  /** On leaving: remember when, and where p stood, for the "while you were away" note */
  touchSeen(p) {
    p.lastSeen = Date.now();
    p.lastRank = this.rank(p);
    this.saveSoon();
  }
}

/** v1 kept one record per "ip::nickname"; keep the best record per address, unique names */
function migrateV1(raw) {
  const byIp = {};
  const history = raw.historyByIp || {};
  for (const v of Object.values(raw.players || {})) {
    const cur = byIp[v.ip];
    const recent = (history[v.ip] || []).indexOf(v.nickname);
    const better = !cur || v.trophies > cur.trophies
      || (v.trophies === cur.trophies && recent >= 0 && recent < (history[v.ip] || []).indexOf(cur.nickname));
    if (better) byIp[v.ip] = { ip: v.ip, nickname: v.nickname, trophies: v.trophies || 0 };
  }
  const used = new Set();
  for (const p of Object.values(byIp)) {
    let n = p.nickname, i = 2;
    while (used.has(n)) n = `${p.nickname.slice(0, 12 - String(i).length)}${i++}`;
    p.nickname = n;
    used.add(n);
  }
  return byIp;
}
