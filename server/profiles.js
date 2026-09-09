// 玩家档案：仅记录昵称与奖杯数，按 "IP::昵称" 绑定。
// 用复合键而非纯 IP，是为了兼容同一台机器/同一 NAT 出口的多开测试；
// 同 IP 再次进入时会自动带出上一次使用的昵称。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const FILE = path.join(DIR, 'players.json');

export class Profiles {
  constructor() {
    this.map = new Map();      // key -> {ip, nickname, trophies}
    this.lastByIp = new Map(); // ip -> nickname
    this.dirty = false;
    this.load();
    setInterval(() => this.flush(), 3000).unref();
  }

  load() {
    try {
      const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
      for (const [k, v] of Object.entries(raw.players || {})) this.map.set(k, v);
      for (const [k, v] of Object.entries(raw.lastByIp || {})) this.lastByIp.set(k, v);
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
        lastByIp: Object.fromEntries(this.lastByIp),
      }, null, 2));
    } catch (e) {
      console.error('[profiles] 写入失败', e.message);
    }
  }

  suggestNickname(ip) { return this.lastByIp.get(ip) || ''; }

  /** 取得（必要时创建）档案 */
  get(ip, nickname) {
    const key = `${ip}::${nickname}`;
    let p = this.map.get(key);
    if (!p) {
      p = { ip, nickname, trophies: 0 };
      this.map.set(key, p);
    }
    this.lastByIp.set(ip, nickname);
    this.dirty = true;
    return p;
  }

  addTrophy(profile) {
    profile.trophies++;
    this.dirty = true;
  }
}
