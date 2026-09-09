// Networking: WebSocket transport, snapshot buffer, and interpolated sampling.
// Each server packet carries framesPerPacket frames of positions. The client runs its render
// clock interpDelayMs behind and always interpolates *between* two real server frames --
// there is no prediction and no extrapolation.

import { C2S, S2C } from '/shared/protocol.js';
import { toroidalDelta, wrap, clamp } from '/shared/mathUtil.js';

export class Net {
  constructor(handlers) {
    this.h = handlers;
    this.buf = [];           // frame queue of {st, snakes}
    this.items = [];
    this.renderT = null;
    this.latestSt = 0;
    this.ping = 0;
    this.mapSize = 0;
    this.interpDelay = 0.08;
    this.maxStep = 3;        // a head moving further than this between frames is a teleport
                             // (respawn or tail graft) and snaps instead of interpolating
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
      case S2C.REJECT:
        this.h.onReject?.(m);
        break;
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
   * Advance the render clock. Corrections nudge the playback *rate* rather than setting the
   * clock: packet arrival is jittery, and pulling renderT to the target on every packet makes
   * it non-monotonic, which is exactly what stutter looks like.
   */
  update(dt) {
    if (this.renderT === null) return;
    const err = (this.latestSt - this.interpDelay) - this.renderT;
    if (Math.abs(err) > 0.4) {           // after a hitch or a long gap, snap rather than crawl
      this.renderT += err;
      return;
    }
    this.renderT += dt * clamp(1 + err * 2, 0.9, 1.1);
  }

  /** The interpolated world state, in game coordinates wrapped into the map */
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

      // Teleport test: respawn and tail grafting move the head a long way in one step, and
      // such a frame cannot be interpolated, only snapped to
      let teleported = false;
      if (p && a !== b) {
        if ((p.c.length === 0) !== (n === 0)) teleported = true;      // alive/dead flip
        else if (n > 0) {
          const dx = toroidalDelta(p.b[0], s.b[0], size);
          const dy = toroidalDelta(p.b[1], s.b[1], size);
          teleported = Math.hypot(dx, dy) >= this.maxStep;
        }
      }

      // Bead i always sits i spacings behind the head, so the same index is the same slot:
      // eating and matching change how many slots there are and what color they carry, never
      // the geometry of a slot. Length changes therefore still interpolate; only the slots
      // that did not exist last frame are taken straight from the new frame.
      const shared = (p && alpha < 1 && !teleported) ? Math.min(n, p.c.length) : 0;
      for (let k = 0; k < n; k++) {
        const bx = s.b[k * 3], by = s.b[k * 3 + 1], bz = s.b[k * 3 + 2];
        if (k >= shared) { beads[k] = { x: bx, y: by, z: bz }; continue; }
        const ax = p.b[k * 3], ay = p.b[k * 3 + 1], az = p.b[k * 3 + 2];
        // Crossing an edge has to take the shortest toroidal path, or the bead flies across
        // the whole map
        beads[k] = {
          x: wrap(ax + toroidalDelta(ax, bx, size) * alpha, size),
          y: wrap(ay + toroidalDelta(ay, by, size) * alpha, size),
          z: az + (bz - az) * alpha,
        };
      }

      return {
        id: s.id, name: s.n, skin: s.sk, ai: !!s.ai, trophies: s.tr,
        dir: s.d, iv: s.iv || 0, colors: s.c, beads,   // iv = seconds of invulnerability left
        dead: s.dead || 0,
        win: !!s.win,
        deathPos: s.dp ? { x: s.dp[0], y: s.dp[1] } : null,
        tp: teleported,
      };
    });

    return { snakes, items: this.items };
  }
}
