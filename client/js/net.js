// 网络层：WebSocket 收发 + 快照缓冲 + 时间插值采样。
// 服务器每个包携带 framesPerPacket 帧位置；客户端把渲染时钟落后 interpDelayMs，
// 始终在两帧真实的服务器位置之间做**内插**，不做任何预测或外推。

import { C2S, S2C } from '/shared/protocol.js';
import { toroidalDelta, wrap, clamp } from '/shared/mathUtil.js';

export class Net {
  constructor(handlers) {
    this.h = handlers;
    this.buf = [];           // 帧队列，元素 {st, snakes}
    this.items = [];
    this.renderT = null;
    this.latestSt = 0;
    this.ping = 0;
    this.mapSize = 0;
    this.interpDelay = 0.08;
    this.maxStep = 3;        // 两帧之间蛇头位移超过它就判定为瞬移(重生/断尾接管)，直接吸附
    this.bufCap = 40;
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
      case S2C.WELCOME: {
        const c = m.config;
        this.mapSize = c.map.size;
        this.interpDelay = c.net.interpDelayMs / 1000;
        this.maxStep = c.snake.beadSpacing * 3;
        this.bufCap = Math.ceil(c.net.tickRate * 0.6);
        this.h.onWelcome?.(m);
        break;
      }
      case S2C.JOINED:
        this.myId = m.id;
        this.h.onJoined?.(m);
        break;
      case S2C.STATE: {
        for (const f of m.f) {
          this.buf.push(f);
          this.latestSt = f.st;
        }
        while (this.buf.length > this.bufCap) this.buf.shift();
        this.items = m.items;
        if (this.renderT === null) this.renderT = this.latestSt - this.interpDelay;
        if (m.ev.length) this.h.onEvents?.(m.ev);
        break;
      }
      case S2C.PONG:
        this.ping = Math.round(performance.now() - m.c);
        break;
    }
  }

  /**
   * 推进渲染时钟。纠偏靠**微调播放速率**而不是直接拨表：
   * 收包间隔本身有抖动，每收一包就把 renderT 拉向目标会让它非单调，画面就是一顿一顿的。
   */
  update(dt) {
    if (this.renderT === null) return;
    const err = (this.latestSt - this.interpDelay) - this.renderT;
    if (Math.abs(err) > 0.4) {           // 卡顿/长时间无包后直接对齐，不慢慢爬
      this.renderT += err;
      return;
    }
    this.renderT += dt * clamp(1 + err * 2, 0.9, 1.1);
  }

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

      // 瞬移判定：重生/断尾接管会让头部一步跨很远，这种帧不能插值，只能吸附
      let teleported = false;
      if (p && a !== b) {
        if ((p.c.length === 0) !== (n === 0)) teleported = true;      // 死/生切换
        else if (n > 0) {
          const dx = toroidalDelta(p.b[0], s.b[0], size);
          const dy = toroidalDelta(p.b[1], s.b[1], size);
          teleported = Math.hypot(dx, dy) >= this.maxStep;
        }
      }

      // 第 i 颗珠恒在"头后 i×间距"处，所以同下标 = 同一个槽位：
      // 吃/三消只改变槽位的数量与颜色，不改变槽位几何，因此长度变了也照样能插值，
      // 只是多出来的槽位没有前一帧的对应物，直接取新帧。
      const shared = (p && alpha < 1 && !teleported) ? Math.min(n, p.c.length) : 0;
      for (let k = 0; k < n; k++) {
        const bx = s.b[k * 3], by = s.b[k * 3 + 1], bz = s.b[k * 3 + 2];
        if (k >= shared) { beads[k] = { x: bx, y: by, z: bz }; continue; }
        const ax = p.b[k * 3], ay = p.b[k * 3 + 1], az = p.b[k * 3 + 2];
        // 跨越地图边界时必须走环面最短路，否则会横穿整张地图
        beads[k] = {
          x: wrap(ax + toroidalDelta(ax, bx, size) * alpha, size),
          y: wrap(ay + toroidalDelta(ay, by, size) * alpha, size),
          z: az + (bz - az) * alpha,
        };
      }

      return {
        id: s.id, name: s.n, skin: s.sk, ai: !!s.ai, trophies: s.tr,
        dir: s.d, iv: !!s.iv, colors: s.c, beads,
        dead: s.dead || 0,
        deathPos: s.dp ? { x: s.dp[0], y: s.dp[1] } : null,
        tp: teleported,
      };
    });

    return { snakes, items: this.items };
  }
}
