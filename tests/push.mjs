import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// pushAll tier. The mechanism is only load-bearing above the engine's argument limit, so the case
// that pins it has to carry a collection that large — see the guard on the first case.

export const pushCases = [
  {
    // cm:guard keep the length ABOVE the engine's argument limit (~125,260 on node 22, less the
    //   deeper the stack) — trim it and this case passes with `target.push(...items)` restored
    name: 'pushAll: a collection larger than the argument limit is appended, not thrown on (ISS-45)',
    target: [],
    items: Array.from({ length: 200000 }, (_, i) => i),
    length: 200000,
    last: 199999,
  },
  {
    // cm:guard the unmutated control for the case above — it passes either way BY DESIGN, so a
    //   contaminated tree cannot be read as a pinned mechanism (mutation-proves-a-mechanism)
    name: 'pushAll: appends in order onto a non-empty target (control)',
    target: ['a', 'b'],
    items: ['c', 'd'],
    length: 4,
    last: 'd',
    expect: ['a', 'b', 'c', 'd'],
  },
  {
    name: 'pushAll: an empty collection leaves the target alone',
    target: ['a'],
    items: [],
    length: 1,
    last: 'a',
    expect: ['a'],
  },
  {
    name: 'pushAll: takes any iterable, not only an array',
    target: [],
    items: new Set([1, 2, 3]),
    length: 3,
    last: 3,
    expect: [1, 2, 3],
  },
];

// cm:guard the two allowed spreads are `done.push(...applied.map(…))` in fixCanonical and
//   migrateTargets — anything else spreading into push() in cm.mjs is sized by the repo (ISS-45)
const ALLOWED = 2;

export function pushSourceCases(pluginRoot, check) {
  const src = readFileSync(join(pluginRoot, 'cli', 'cm.mjs'), 'utf8');
  const spreads = src.match(/\bpush\(\.\.\./g) ?? [];
  check('push: cm.mjs spreads into push() only where the collection is one file\'s annotations',
    spreads.length === ALLOWED,
    `expected ${ALLOWED} push(... spreads, found ${spreads.length} — a collection sized by the `
    + 'repository reaching an argument list is the ISS-43 crash, so it appends through pushAll');

  const allowed = src.match(/done\.push\(\.\.\.applied\.map\(/g) ?? [];
  check('push: the two spreads cm.mjs keeps are the per-file ones, not something else that grew',
    allowed.length === ALLOWED,
    `expected ${ALLOWED} done.push(...applied.map(, found ${allowed.length}`);

  check('push: cm.mjs appends the whole-tree collections through pushAll',
    (src.match(/pushAll\(/g) ?? []).length >= 6,
    'the file list, the drain and the three graph tiers must each append by iteration');
}
