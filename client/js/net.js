// 网络层：WebSocket 收发 + 快照缓冲 + 时间插值采样。
// 服务器 30Hz 广播全量快照，客户端把渲染时钟落后 interpDelayMs，在相邻两帧之间插值。

import { C2S, S2C } from '/shared/protocol.js';
import { toroidalDelta, wrap, clamp } from '/shared/mathUtil.js';

export class Net {
  constructor(handlers) {
    this.h = handlers;
    this.buf = [];
    this.renderT = null;
    this.ping = 0;
    this.mapSize = 0;
    this.interpDelay = 0.07;
    this.ws = null;
    this.myId = null;
  }

  connect() {
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onmessage = (e) => this.onMessage(JSON.parse(e.data));
    ws.onopen = () => { this.pingTimer = setInterval(() => this.send({ t: C2S.PING, c: performance.now() }), 1000); };
    ws.onclose = () => { clearInterval(this.pingTimer); this.h.onClose?.(); };
    ws.onerror = () => this.h.onError?.();
  }

  send(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
  }

  join(nickname, skin) { this.send({ t: C2S.JOIN, nickname, skin }); }
  sendInput(dir, sprint) { this.send({ t: C2S.INPUT, dir, sprint }); }
  sendJump() { this.send({ t: C2S.JUMP }); }

  onMessage(m) {
    switch (m.t) {
      case S2C.WELCOME:
        this.mapSize = m.config.map.size;
        this.interpDelay = m.config.net.interpDelayMs / 1000;
        this.h.onWelcome?.(m);
        break;
      case S2C.JOINED:
        this.myId = m.id;
        this.h.onJoined?.(m);
        break;
      case S2C.STATE: {
        this.buf.push(m);
        if (this.buf.length > 24) this.buf.shift();
        const target = m.st - this.interpDelay;
        if (this.renderT === null || Math.abs(target - this.renderT) > 0.6) this.renderT = target;
        else this.renderT += (target - this.renderT) * 0.1;   // 软同步，避免抖动
        if (m.ev.length) this.h.onEvents?.(m.ev);
        break;
      }
      case S2C.PONG:
        this.ping = Math.round(performance.now() - m.c);
        break;
    }
  }

  update(dt) { if (this.renderT !== null) this.renderT += dt; }

  /** 取出插值后的世界状态（游戏坐标，已取模到地图内） */
  sample() {
    const buf = this.buf;
    if (buf.length === 0 || this.renderT === null) return null;
    let i = buf.length - 1;
    while (i > 0 && buf[i].st > this.renderT) i--;
    const a = buf[i];
    const b = buf[Math.min(i + 1, buf.length - 1)];
    const alpha = b !== a && b.st > a.st ? clamp((this.renderT - a.st) / (b.st - a.st), 0, 1) : 1;
    const prev = new Map(a.snakes.map((s) => [s.id, s]));
    const size = this.mapSize;

    const snakes = b.snakes.map((s) => {
      const p = prev.get(s.id);
      const n = s.c.length;
      const beads = new Array(n);
      const canLerp = p && p.c.length === n && alpha < 1;
      for (let k = 0; k < n; k++) {
        const bx = s.b[k * 3], by = s.b[k * 3 + 1], bz = s.b[k * 3 + 2];
        if (!canLerp) { beads[k] = { x: bx, y: by, z: bz }; continue; }
        const ax = p.b[k * 3], ay = p.b[k * 3 + 1], az = p.b[k * 3 + 2];
        // 跨越地图边界时必须走环面最短路，否则会横穿整张地图
        beads[k] = {
          x: wrap(ax + toroidalDelta(ax, bx, size) * alpha, size),
          y: wrap(ay + toroidalDelta(ay, by, size) * alpha, size),
          z: az + (bz - az) * alpha,
        };
      }
      return { id: s.id, name: s.n, skin: s.sk, ai: !!s.ai, trophies: s.tr, dir: s.d, iv: !!s.iv, colors: s.c, beads };
    });

    return { snakes, items: b.items };
  }
}
