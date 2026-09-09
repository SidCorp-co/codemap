// The mutation harness's pure half: the declared list, the environment scrub, the parse and the
// classification. Nothing here spawns a process or touches a repository.
//
// cm:edge protocol -> tests/mutate.mjs — the CLI half imports this; this must never import that.
//   tests/run.mjs reaches this file through tests/mutate-cases.mjs, so an import in this direction
//   would put `main` on the corpus's import graph, and main spawns a corpus run per point: the
//   corpus would spawn itself, each level bounded only by CORPUS_TIMEOUT_MS (ISS-30)

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';

// cm:guard every `find` must occur EXACTLY once in its file, and is checked before anything is
//   mutated. A line number would rot silently as the code moves; a string that no longer matches is
//   reported as ANCHOR, which is the whole reason a stale point cannot read as a dead mechanism (ISS-30)
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

// cm:guard config travels to child gits in the ENVIRONMENT, not only in files: `git -c k=v` exports
//   GIT_CONFIG_PARAMETERS to everything it runs, and GIT_CONFIG_COUNT/KEY_n/VALUE_n are read from the
//   environment too. Stripping only the location variables left `git -c core.hooksPath=… bisect run`
//   reaching the throwaway copy's commit (ISS-30)
const GIT_CONFIG_VARS = ['GIT_CONFIG', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_COUNT'];

// cm:guard GIT_CONFIG_GLOBAL and GIT_CONFIG_SYSTEM are SET to an empty file, never deleted: an
//   environment that had pointed them at /dev/null was deliberately suppressing the user's config,
//   and deleting them re-enables it — the isolation runs backwards (ISS-30)
export function stripGitEnv(env) {
  const out = { ...env };
  for (const k of [...GIT_LOCATION_VARS, ...GIT_CONFIG_VARS]) delete out[k];
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

export function parseCorpusOutput(stdout, stderr, spawnError, tailLines = 30) {
  const count = /^codemap golden corpus: (\d+) passed, (\d+) failed$/m.exec(stdout ?? '');
  // cm:guard anchored on the runner's exact two-space leader, never `^\s*`: a failure detail carries
  //   another process's output verbatim (tests/install.mjs, tests/upgrade-workflow.mjs), so a loose
  //   leader harvests any embedded "FAIL ..." line as a phantom check name (ISS-30)
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

// cm:guard a run that printed no count line is CRASH, never `pinned`. A mutation that makes the
//   runner throw exits non-zero with no failing check, so anything keying off the exit status alone
//   reads a crash as proof the mechanism is load-bearing — the trap that hid a case in ISS-26 (ISS-30)
// cm:guard a run whose CHECK TOTAL differs from the control's is INCONCLUSIVE, never DEAD. A mutation
//   that makes a whole tier disable itself rather than fail runs fewer checks and still reports 0
//   failed, which reads as a dead mechanism and tells the author to delete working code (ISS-30)
export function classify(result, controlTotal) {
  if (!result.ran) return 'CRASH';
  if (result.failed > 0) return 'pinned';
  if (result.total !== controlTotal) return 'INCONCLUSIVE';
  return 'DEAD';
}

// cm:guard the resolved path has to stay INSIDE the copy: a declared point whose `file` carries a
//   `..` segment would otherwise have the harness overwrite a file in the real tree it is measuring,
//   which is the one thing this whole design exists to make impossible (ISS-30)
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
