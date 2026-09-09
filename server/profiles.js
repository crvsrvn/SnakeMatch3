// 玩家档案：仅记录昵称与奖杯数，按 "IP::昵称" 绑定。
// 用复合键而非纯 IP，是为了让同一台机器/同一出口 IP 上开多个网页、用不同昵称的人
// 各自算作独立玩家，可以同时游玩、各自计奖杯。
// 每个 IP 另外保留一份历史昵称列表，登录时可以直接点选。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG } from '../config/game.config.js';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'database');
const FILE = path.join(DIR, 'players.json');

export class Profiles {
  constructor() {
    this.map = new Map();          // "ip::昵称" -> {ip, nickname, trophies}
    this.historyByIp = new Map();  // ip -> [昵称]，最近使用的在前
    this.dirty = false;
    this.load();
    setInterval(() => this.flush(), 3000).unref();
  }

  load() {
    try {
      const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
      for (const [k, v] of Object.entries(raw.players || {})) this.map.set(k, v);
      for (const [k, v] of Object.entries(raw.historyByIp || {})) this.historyByIp.set(k, v);
      // 兼容旧格式：只存了"每个 IP 最后一次用的昵称"
      for (const [k, v] of Object.entries(raw.lastByIp || {})) {
        if (!this.historyByIp.has(k)) this.historyByIp.set(k, [v]);
      }
      console.log(`[profiles] 载入 ${this.map.size} 条记录`);
    } catch { /* 首次运行没有文件，忽略 */ }
  }

  flush() {
    if (!this.dirty) return;
    this.dirty = false;
    try {
      fs.mkdirSync(DIR, { recursive: true });
      fs.writeFileSync(FILE, JSON.stringify({
        players: Object.fromEntries(this.map),
        historyByIp: Object.fromEntries(this.historyByIp),
      }, null, 2));
    } catch (e) {
      console.error('[profiles] 写入失败', e.message);
    }
  }

  /** 该 IP 用过的昵称，最近的在前，供登录界面快捷选择 */
  nicknames(ip) { return this.historyByIp.get(ip) || []; }

  /** 取得（必要时创建）档案，并把昵称记入该 IP 的历史 */
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
    this.dirty = true;
    return p;
  }

  addTrophy(profile) {
    profile.trophies++;
    this.dirty = true;
  }
}
