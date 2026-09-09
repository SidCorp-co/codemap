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
