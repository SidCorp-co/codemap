// Appending a whole collection onto another, without making the engine's argument limit decide.
//
// `target.push(...items)` passes one argument per element, so a collection that grows with the
// repository takes `cm` down with a RangeError the moment it crosses the limit — around 125,260
// elements on node 22, and fewer the deeper the stack. ISS-43 hit exactly that in `moduleHeader`,
// where the crash surfaced as exit 1 under a raw stack trace: the same code CI and the pre-commit
// hook read as "violations found", so a repository too big to analyze reported a failing gate
// rather than a broken tool (§9.1).

// cm:edge protocol -> cli/lib/analyze.mjs — the `iterate, never spread` guard there is this
//   function's other half; both exist so no collection sized by the repo reaches an argument list
/**
 * @param {Array<T>} target mutated in place
 * @param {Iterable<T>} items appended in iteration order
 * @returns {Array<T>} the same `target`
 * @template T
 */
export function pushAll(target, items) {
  // cm:guard stays a loop even for an obviously small `items` — every caller here is sized by the
  //   repository being scanned, so "small" is a property of the test tree, never of the input (ISS-45)
  for (const item of items) target.push(item);
  return target;
}
