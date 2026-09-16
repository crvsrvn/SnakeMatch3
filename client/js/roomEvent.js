// Room event banner at the top of the screen, counting down to the next event and through
// it, plus the toasts when one is announced, begins or ends. The countdown comes from every
// frame (World.frame `re`), so a late joiner sees the right number at once.

import { t, onLangChange } from './i18n.js';

export class RoomEventBanner {
  constructor(CONFIG, hud) {
    this.C = CONFIG;
    this.hud = hud;
    this.el = document.getElementById('banner');
    this.state = null;                      // [kind, phase, sec] as last drawn
    onLangChange(() => this.render(true));
  }

  desc(kind) { return t(`room.desc.${kind}`, { n: this.C.retention.roomEvents.brawlLength }); }

  /** @param re [kind, phase, secondsLeft] from the frame, or null while idle */
  sync(re) {
    const same = (!re && !this.state) || (re && this.state
      && re[0] === this.state[0] && re[1] === this.state[1] && re[2] === this.state[2]);
    if (same) return;
    this.state = re;
    this.render();
  }

  render() {
    const s = this.state;
    if (!s) { this.el.hidden = true; return; }
    const kind = t(`room.${s[0]}`);
    this.el.hidden = false;
    this.el.className = s[1];
    this.el.innerHTML = (s[1] === 'warn' ? t('room.warn', { kind, sec: s[2] }) : t('room.on', { kind, sec: s[2] }))
      + `<small>${this.desc(s[0])}</small>`;
  }

  /** EV.ROOMEVENT: the phase changed */
  onEvent(e) {
    const kind = t(`room.${e.kind}`), desc = this.desc(e.kind);
    if (e.phase === 'warn') this.hud.toast(t('toast.roomWarn', { kind, sec: e.sec, desc }), 'wild');
    else if (e.phase === 'on') this.hud.toast(t('toast.roomOn', { kind, desc }), 'wild');
    else this.hud.toast(t('toast.roomEnd', { kind }));
  }
}
