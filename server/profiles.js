// Player profiles: nickname + trophy count only, keyed by "ip::nickname".
// The composite key (rather than plain IP) lets several people behind one address play
// at the same time under different nicknames and keep separate trophy counts.
// Each IP also keeps a list of previously used nicknames for the login screen.
//
// Writes are immediate and atomic: a trophy is a durable result, so it must survive the
// server being killed at any moment. Writes happen only on join and on winning, so the
// synchronous write costs nothing in practice.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG } from '../config/game.config.js';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'database');
const FILE = path.join(DIR, 'players.json');
const TMP = `${FILE}.tmp`;

export class Profiles {
  constructor() {
    this.map = new Map();          // "ip::nickname" -> {ip, nickname, trophies}
    this.historyByIp = new Map();  // ip -> [nickname], most recent first
    this.load();
  }

  load() {
    try {
      const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
      for (const [k, v] of Object.entries(raw.players || {})) this.map.set(k, v);
      for (const [k, v] of Object.entries(raw.historyByIp || {})) this.historyByIp.set(k, v);
      // Legacy format: only "last nickname used by this IP" was stored
      for (const [k, v] of Object.entries(raw.lastByIp || {})) {
        if (!this.historyByIp.has(k)) this.historyByIp.set(k, [v]);
      }
      console.log(`[profiles] loaded ${this.map.size} record(s)`);
    } catch { /* no file on first run, ignore */ }
  }

  /**
   * Write to a temporary file and rename over the real one. Rename is atomic on both
   * NTFS and POSIX, so a crash can leave the previous version intact but never a
   * half-written file.
   */
  save() {
    try {
      fs.mkdirSync(DIR, { recursive: true });
      const fd = fs.openSync(TMP, 'w');
      fs.writeFileSync(fd, JSON.stringify({
        players: Object.fromEntries(this.map),
        historyByIp: Object.fromEntries(this.historyByIp),
      }, null, 2));
      fs.fsyncSync(fd);            // rename is only safe once the bytes are on disk
      fs.closeSync(fd);
      fs.renameSync(TMP, FILE);
    } catch (e) {
      console.error('[profiles] write failed', e.message);
    }
  }

  /** Nicknames this IP has used, most recent first, offered on the login screen */
  nicknames(ip) { return this.historyByIp.get(ip) || []; }

  /** Fetch (creating if needed) a profile and record the nickname in the IP's history */
  get(ip, nickname) {
    const key = `${ip}::${nickname}`;
    let p = this.map.get(key);
    if (!p) {
      p = { ip, nickname, trophies: 0 };
      this.map.set(key, p);
    }
    const list = this.historyByIp.get(ip) || [];
    const next = [nickname, ...list.filter((n) => n !== nickname)]
      .slice(0, CONFIG.profiles.historyPerIp);
    this.historyByIp.set(ip, next);
    this.save();
    return p;
  }

  addTrophy(profile) {
    profile.trophies++;
    this.save();
  }
}
