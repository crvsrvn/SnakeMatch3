// Room events: every few minutes the room is told what is coming, then something changes for
// a while -- a rainbow shower (wild beads spawn much faster), double trophies, or a brawl
// (everyone is cut down to a few beads, so the next minute is a scramble for the win).
// The world reads the active kind to scale its own rules; this class only keeps the clock.

import { CONFIG } from '../config/game.config.js';
import { EV } from '../shared/protocol.js';

const RE = CONFIG.retention.roomEvents;

export class RoomEvents {
  constructor() {
    this.kind = null;
    this.phase = 'idle';           // idle -> warn -> on -> idle
    this.timer = RE.intervalSec;
    this.last = -1;
  }

  /** Is this kind of event running right now? */
  active(kind) { return this.phase === 'on' && this.kind === kind; }

  /** @param onStart (kind) => void, the world's one-off reaction when an event begins */
  tick(dt, events, onStart) {
    this.timer -= dt;
    if (this.timer > 0) return;
    if (this.phase === 'idle') {
      // Walk the list in order from a random start, so every kind shows up in turn
      this.last = (this.last < 0 ? Math.floor(Math.random() * RE.kinds.length) : this.last + 1) % RE.kinds.length;
      this.kind = RE.kinds[this.last];
      this.phase = 'warn';
      this.timer = RE.warnSec;
    } else if (this.phase === 'warn') {
      this.phase = 'on';
      this.timer = RE.durationSec;
      onStart(this.kind);
    } else {
      this.phase = 'idle';
      this.timer = RE.intervalSec;
    }
    events.push({ t: EV.ROOMEVENT, kind: this.kind, phase: this.phase, sec: Math.round(this.timer) });
  }

  /** Frame field for late joiners: [kind, phase, seconds left], or nothing while idle */
  snapshot() {
    return this.phase === 'idle' ? undefined : [this.kind, this.phase, Math.round(this.timer)];
  }
}
