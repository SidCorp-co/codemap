// The mutation harness's pure half: the declared list, the parse and the classification. Nothing
// here spawns a process or touches a repository. The environment scrub is tests/git-env.mjs's.
//
// cm:guard this half must never import tests/mutate.mjs: the corpus reaches this file, so that
//   import would leave only an entry-point check between the corpus and spawning itself (ISS-30)

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';

// cm:guard every `find` must match its file EXACTLY once, checked before any write: a line number
//   would rot silently, where a stale string is reported ANCHOR instead of reading DEAD (ISS-30)
export const MUTATIONS = [
  {
    id: 'head-slice',
    file: 'cli/lib/languages.mjs',
    mechanism: 'the GENERATED_HEAD_LINES head slice in isGenerated',
    find: String.raw`const head = src.split('\n', GENERATED_HEAD_LINES).join('\n');`,
    replace: 'const head = src;',
  },
  {
    id: 'head-join',
    file: 'cli/lib/languages.mjs',
    mechanism: 'rejoining the sliced head with newlines rather than with nothing',
    find: String.raw`const head = src.split('\n', GENERATED_HEAD_LINES).join('\n');`,
    replace: String.raw`const head = src.split('\n', GENERATED_HEAD_LINES).join('');`,
  },
  {
    id: 'flushopen-arg',
    file: 'cli/lib/languages.mjs',
    mechanism: 'isGenerated asking scanComments to flush a block still open at the cut',
    find: 'scanComments(head, prof, { flushOpen: true })',
    replace: 'scanComments(head, prof)',
  },
  {
    id: 'flushopen-block',
    file: 'cli/lib/scan.mjs',
    mechanism: 'the flush of a block still open at EOF, for the truncated head isGenerated hands in',
    find: 'if (block && flushOpen) {',
    replace: 'if (false) {',
  },
  {
    id: 'unaccounted-report',
    file: 'cli/lib/mass.mjs',
    mechanism: 'fileMass reporting a file whose block comment is never closed as unaccounted for',
    find: 'out.unaccounted = unaccountedFor(src, scan.unterminated);',
    replace: '',
  },
  {
    id: 'unaccounted-verdict',
    file: 'cli/lib/mass.mjs',
    mechanism: "the report taking its verdict from analyze's CM203 rather than from the scanner's signal alone",
    find: "if (scan.unterminated && (res.diags ?? []).some((d) => d.code === 'CM203')) {",
    replace: 'if (scan.unterminated) {',
  },
  {
    id: 'unaccounted-size',
    file: 'cli/lib/mass.mjs',
    mechanism: 'the size of the unread region being COMPUTED rather than any constant standing in for it',
    find: 'return { line: unterminated.line, leader: unterminated.leader, chars: src.length - before - unterminated.col };',
    replace: 'return { line: unterminated.line, leader: unterminated.leader, chars: 1 };',
  },
  {
    id: 'unaccounted-column',
    file: 'cli/lib/mass.mjs',
    mechanism: "the region running from the opener's COLUMN, not from the start of the opener's line",
    find: 'chars: src.length - before - unterminated.col };',
    replace: 'chars: src.length - before };',
  },
  {
    id: 'unaccounted-list',
    file: 'cli/lib/mass.mjs',
    mechanism: 'massOf collecting the unaccounted rows, which is what the verb and --json report',
    find: 'const unaccounted = rows.filter((r) => r.unaccounted)',
    replace: 'const unaccounted = [].filter((r) => r.unaccounted)',
  },
];

// cm:guard the corpus a copy runs carries this marker and main refuses when it is set: without it a
//   copy that reaches main from its own corpus spawns a harness at every level, unbounded (ISS-30)
// cm:why falsifying the entry-point check means running a copy that DOES reach main, so that
//   falsification cannot be performed at all until this marker bounds it (ISS-30)
export const NESTED_MARKER = 'CM_MUTATE_IN_COPY';

export function parseCorpusOutput(stdout, stderr, spawnError, tailLines = 30) {
  const count = /^codemap golden corpus: (\d+) passed, (\d+) failed$/m.exec(stdout ?? '');
  // cm:guard anchored on the runner's exact two-space leader, never `^\s*`: a failure detail quotes
  //   another process verbatim, so a loose leader invents a check name nothing raised (ISS-30)
  const names = [...(stderr ?? '').matchAll(/^ {2}FAIL (.+)$/gm)].map((m) => m[1].trim());
  return {
    ran: Boolean(count),
    passed: count ? Number(count[1]) : null,
    failed: count ? Number(count[2]) : null,
    total: count ? Number(count[1]) + Number(count[2]) : null,
    names,
    diagnosis: [spawnError ? `spawn: ${spawnError}` : '', (stderr ?? '').trim()]
      .filter(Boolean).join('\n').split('\n').slice(-tailLines).join('\n'),
  };
}

// cm:guard a run with no count line is CRASH, never `pinned`: a throw also exits non-zero with
//   nothing failing, so an exit status alone reads a crash as proof of a live mechanism (ISS-30)
// cm:guard a run whose CHECK TOTAL differs from the control's is INCONCLUSIVE, never DEAD: a tier
//   that disables itself reports 0 failed, and DEAD would tell the author to delete live code (ISS-30)
export function classify(result, controlTotal) {
  if (!result.ran) return 'CRASH';
  if (result.failed > 0) return 'pinned';
  if (result.total !== controlTotal) return 'INCONCLUSIVE';
  return 'DEAD';
}

// cm:guard the resolved path must stay INSIDE the copy: a `..` in a declared point would otherwise
//   overwrite the real tree being measured, the one thing this design exists to prevent (ISS-30)
export function applyMutation(dir, m) {
  const root = resolve(dir);
  const path = resolve(root, m.file);
  if (path !== root && !path.startsWith(root + sep)) {
    return `${m.file} resolves outside the copy, so it names a file this harness must not write`;
  }
  if (!existsSync(path)) return `${m.file} is not in the tree`;
  const src = readFileSync(path, 'utf8');
  const hits = src.split(m.find).length - 1;
  if (hits === 0) return `anchor not found in ${m.file}`;
  if (hits > 1) return `anchor matches ${hits}x in ${m.file}, so it names no single site`;
  writeFileSync(path, src.split(m.find).join(m.replace));
  return null;
}
