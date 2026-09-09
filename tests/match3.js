// 三消规则单测，重点是万能珠(WILD)的通配判定。
// 关键陷阱：贪心必须尝试每一个起点 —— [蓝, 万能, 红, 红] 从 0 起只能凑到 2 颗，
// 从 1 起才凑得出 [万能, 红, 红]。只从上一段结尾继续扫会漏掉这种情况。
// 运行： node tests/match3.js

import { WILD } from '../shared/protocol.js';
import { resolveMatches, randomColors } from '../server/match3.js';

let failed = 0;

function expect(input, leftover, label) {
  const colors = input.slice();
  const groups = resolveMatches(colors, null);
  const ok = JSON.stringify(colors) === JSON.stringify(leftover);
  if (!ok) failed++;
  console.log(`  ${ok ? '✔' : '✘'} ${label}: ${JSON.stringify(input)} -> 剩余 ${JSON.stringify(colors)}`
    + `${ok ? '' : `（期望 ${JSON.stringify(leftover)}）`}`
    + `  消除 ${groups.length} 组`);
}

console.log('三消规则:');
expect([0, 0, 0], [], '三颗同色');
expect([0, 1, 0], [0, 1, 0], '被隔开不成立');
expect([0, 0], [0, 0], '只有两颗不成立');
expect([0, 0, 0, 0, 0], [], '五连一次全消');
expect([1, 0, 0, 0, 1, 1, 1], [], '连锁：先消中间再消两端');

console.log('万能珠:');
expect([0, WILD, 0], [], '万能补中间');
expect([WILD, 0, 0], [], '万能补头');
expect([0, 0, WILD, 1], [1], '万能补尾');
expect([1, WILD, 0, 0], [1], '左起不成立、右移一位成立');
expect([WILD, WILD, WILD], [], '三颗万能自己成立');
expect([0, WILD, 1], [0, WILD, 1], '中间万能但两侧不同色');
expect([2, 2, WILD, 2, 1], [1], '万能夹在同色中，整段消掉');
expect([WILD, 1], [WILD, 1], '不足三颗');

console.log('初始颜色:');
for (let i = 0; i < 200; i++) {
  const c = randomColors(8, 4);
  if (c.length !== 8) { failed++; console.log('  ✘ 长度不对'); break; }
  const g = resolveMatches(c.slice(), null);
  if (g.length) { failed++; console.log(`  ✘ 出生就自带可消段: ${JSON.stringify(c)}`); break; }
}
if (!failed) console.log('  ✔ 200 组随机初始颜色都不含 3 连');

if (failed) throw new Error(`${failed} 例失败`);
console.log('三消规则全部通过 ✔');
