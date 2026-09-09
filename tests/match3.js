// Unit tests for the match rules, mostly around the WILD bead standing in for any color.
// The trap: the greedy scan has to try every start index. In [blue, wild, red, red] a scan
// from 0 only reaches 2 beads; starting at 1 finds [wild, red, red]. Continuing from where
// the previous window ended misses that case.
// Run with: node tests/match3.js

import { WILD } from '../shared/protocol.js';
import { resolveMatches, randomColors } from '../server/match3.js';

let failed = 0;

function expect(input, leftover, label) {
  const colors = input.slice();
  const groups = resolveMatches(colors, null);
  const ok = JSON.stringify(colors) === JSON.stringify(leftover);
  if (!ok) failed++;
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${label}: ${JSON.stringify(input)} -> left ${JSON.stringify(colors)}`
    + `${ok ? '' : ` (expected ${JSON.stringify(leftover)})`}`
    + `  ${groups.length} group(s) cleared`);
}

console.log('match rules:');
expect([0, 0, 0], [], 'three of a color');
expect([0, 1, 0], [0, 1, 0], 'separated, no match');
expect([0, 0], [0, 0], 'only two, no match');
expect([0, 0, 0, 0, 0], [], 'a run of five clears at once');
expect([1, 0, 0, 0, 1, 1, 1], [], 'chain: the middle clears, then the ends');

console.log('wild beads:');
expect([0, WILD, 0], [], 'wild fills the middle');
expect([WILD, 0, 0], [], 'wild fills the front');
expect([0, 0, WILD, 1], [1], 'wild fills the back');
expect([1, WILD, 0, 0], [1], 'no match from 0, a match from 1');
expect([WILD, WILD, WILD], [], 'three wilds match on their own');
expect([0, WILD, 1], [0, WILD, 1], 'wild in the middle, different colors either side');
expect([2, 2, WILD, 2, 1], [1], 'wild among one color clears the whole run');
expect([WILD, 1], [WILD, 1], 'fewer than three');

console.log('starting colors:');
for (let i = 0; i < 200; i++) {
  const c = randomColors(8, 4);
  if (c.length !== 8) { failed++; console.log('  FAIL wrong length'); break; }
  const g = resolveMatches(c.slice(), null);
  if (g.length) { failed++; console.log(`  FAIL spawned with a clearable run: ${JSON.stringify(c)}`); break; }
}
if (!failed) console.log('  OK   200 random starting sets, none with a run of 3');

if (failed) throw new Error(`${failed} case(s) failed`);
console.log('match rules all pass');
