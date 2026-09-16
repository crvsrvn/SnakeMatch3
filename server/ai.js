// Bot snakes: a random walk that avoids its own body. No sprinting, no jumping.

import { CONFIG } from '../config/game.config.js';
import { randRange, toroidalDelta } from '../shared/mathUtil.js';

const A = CONFIG.ai;
const S = CONFIG.snake;

export class AIBrain {
  constructor() { this.timer = randRange(A.turnIntervalMin, A.turnIntervalMax); }

  update(snake, dt, mapSize) {
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = randRange(A.turnIntervalMin, A.turnIntervalMax);
      snake.targetDir = snake.dir + randRange(-A.maxTurnDelta, A.maxTurnDelta);
    }
    this.avoidSelf(snake, mapSize);
  }

  /** If the point lookAhead units ahead lands on our own body, turn hard to the emptier side */
  avoidSelf(snake, mapSize) {
    const beads = snake.beads;
    if (beads.length <= S.selfCollisionMinIndex) return;
    const hitR = S.beadRadius * 2;
    const probe = (angle) => {
      const px = beads[0].x + Math.cos(angle) * A.lookAhead;
      const py = beads[0].y + Math.sin(angle) * A.lookAhead;
      let worst = Infinity;
      for (let i = S.selfCollisionMinIndex; i < beads.length; i++) {
        const dx = toroidalDelta(px, beads[i].x, mapSize);
        const dy = toroidalDelta(py, beads[i].y, mapSize);
        worst = Math.min(worst, Math.hypot(dx, dy));
      }
      return worst;
    };
    if (probe(snake.dir) > hitR) return;
    const left = probe(snake.dir + 1.0);
    const right = probe(snake.dir - 1.0);
    snake.targetDir = snake.dir + (left >= right ? 1.4 : -1.4);
  }
}
