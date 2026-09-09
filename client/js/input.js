// 键盘输入 -> 方向角/冲刺/跳跃。只在状态变化时发包（WebSocket 走 TCP，无需重复补发）。

const CODES = {
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
};

export class Input {
  constructor(onChange, onJump, onMute) {
    this.keys = new Set();
    this.dir = null;
    this.sprint = false;
    this.onChange = onChange;
    this.enabled = false;

    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (e.code === 'KeyM') { onMute(); return; }
      if (!this.enabled) return;
      if (e.code === 'Space') { e.preventDefault(); onJump(); return; }
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
      this.keys.add(e.code);
      if (e.key === 'Shift') this.sprint = true;
      this.evaluate();
    });

    addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (e.key === 'Shift') this.sprint = false;
      if (this.enabled) this.evaluate();
    });

    addEventListener('blur', () => { this.keys.clear(); this.sprint = false; this.evaluate(); });
  }

  held(group) { return CODES[group].some((c) => this.keys.has(c)); }

  evaluate() {
    const dx = (this.held('right') ? 1 : 0) - (this.held('left') ? 1 : 0);
    const dy = (this.held('up') ? 1 : 0) - (this.held('down') ? 1 : 0);
    let dir = this.dir;
    if (dx !== 0 || dy !== 0) dir = Math.atan2(dy, dx);   // 松开所有方向键时保持当前朝向
    if (dir === this.dir && this.sprint === this.lastSprint) return;
    this.dir = dir;
    this.lastSprint = this.sprint;
    this.onChange(dir, this.sprint);
  }
}
