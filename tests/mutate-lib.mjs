// The mutation harness's pure half: the declared list, the environment scrub, the parse and the
// classification. Nothing here spawns a process or touches a repository.
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
];

const GIT_LOCATION_VARS = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY',
  'GIT_COMMON_DIR', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_TEMPLATE_DIR', 'GIT_NAMESPACE',
  'GIT_CEILING_DIRECTORIES', 'GIT_PREFIX'];

// cm:guard these outrank the `-c user.email` the copy's commit passes, so leaving them gives the
//   throwaway commit whatever identity invoked the harness (ISS-30)
const GIT_IDENTITY_VARS = ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_AUTHOR_DATE',
  'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL', 'GIT_COMMITTER_DATE'];

// cm:guard config reaches a child git through the ENVIRONMENT, not only through files, so the
//   location variables alone are not enough: `git -c core.hooksPath=…` would reach the copy (ISS-30)
const GIT_CONFIG_VARS = ['GIT_CONFIG', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_COUNT'];

// cm:guard GIT_CONFIG_GLOBAL and GIT_CONFIG_SYSTEM are SET to an empty file, never deleted:
//   deleting them hands back a user config the caller may be suppressing on purpose (ISS-30)
export function stripGitEnv(env) {
  const out = { ...env };
  for (const k of [...GIT_LOCATION_VARS, ...GIT_CONFIG_VARS, ...GIT_IDENTITY_VARS]) delete out[k];
  for (const k of Object.keys(out)) {
    if (/^GIT_CONFIG_(KEY|VALUE)_\d+$/.test(k)) delete out[k];
  }
  out.GIT_CONFIG_GLOBAL = '/dev/null';
  out.GIT_CONFIG_SYSTEM = '/dev/null';
  out.GIT_CONFIG_NOSYSTEM = '1';
  return out;
}

export const GIT_LOCATION_VAR_NAMES = GIT_LOCATION_VARS;
export const GIT_CONFIG_VAR_NAMES = GIT_CONFIG_VARS;
export const GIT_IDENTITY_VAR_NAMES = GIT_IDENTITY_VARS;

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
