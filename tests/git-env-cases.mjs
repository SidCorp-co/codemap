// ISS-39 — the corpus run from a git hook. A tier names its throwaway repository by path, but git
// reads the environment first, so an inherited GIT_DIR silently redirected every one of them: the
// gate committed into the repository it was run to protect. These cases pin the scrub, and the
// CONTROL pins that the leak is still reachable without it — a case that can no longer fail here
// is a case that has stopped measuring anything.

import { mkdtempSync, writeFileSync, readdirSync, rmSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {
  stripGitEnv, GIT_LOCATION_VAR_NAMES, GIT_CONFIG_VAR_NAMES, GIT_BEHAVIOUR_VAR_NAMES,
  GIT_IDENTITY_VAR_NAMES,
} from './git-env.mjs';

// cm:guard these four literals are this tier's OWN copy, never derived from the exported lists:
//   iterating the export lets a name deleted there silently delete its own case (ISS-39)
const EXPECTED_LOCATION = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY',
  'GIT_COMMON_DIR', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_TEMPLATE_DIR', 'GIT_NAMESPACE',
  'GIT_CEILING_DIRECTORIES', 'GIT_PREFIX', 'GIT_DISCOVERY_ACROSS_FILESYSTEM'];
const EXPECTED_CONFIG = ['GIT_CONFIG', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_COUNT'];
const EXPECTED_BEHAVIOUR = ['GIT_EXEC_PATH', 'GIT_EDITOR', 'GIT_DEFAULT_HASH',
  'GIT_DEFAULT_REF_FORMAT', 'GIT_INDEX_VERSION', 'GIT_LITERAL_PATHSPECS', 'GIT_GLOB_PATHSPECS',
  'GIT_NOGLOB_PATHSPECS', 'GIT_ICASE_PATHSPECS', 'GIT_REPLACE_REF_BASE', 'GIT_NO_REPLACE_OBJECTS',
  'GIT_ATTR_SOURCE', 'GIT_SSH', 'GIT_SSH_COMMAND', 'GIT_ASKPASS', 'GIT_TERMINAL_PROMPT'];
const EXPECTED_IDENTITY = ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_AUTHOR_DATE',
  'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL', 'GIT_COMMITTER_DATE'];

// cm:guard built from a literal, never from stripGitEnv: the canary has to stand up under AC9's own
//   mutation, where stripGitEnv is the identity and would take makeCanary down with it (ISS-39)
const CLEAN_ENV = { PATH: process.env.PATH, HOME: process.env.HOME,
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };

function makeCanary(roots) {
  const root = mkdtempSync(join(tmpdir(), 'cm-canary-'));
  roots.push(root);
  writeFileSync(join(root, 'canary.txt'), 'canary\n');
  const run = (...args) => execFileSync('git', ['-C', root, ...args],
    { encoding: 'utf8', env: CLEAN_ENV });
  run('init', '-q');
  run('add', 'canary.txt');
  run('-c', 'user.email=c@c', '-c', 'user.name=c', 'commit', '-qm', 'seed');
  return root;
}

function head(root) {
  return execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'],
    { encoding: 'utf8', env: CLEAN_ENV }).trim();
}

function status(root) {
  return execFileSync('git', ['-C', root, 'status', '--porcelain'],
    { encoding: 'utf8', env: CLEAN_ENV });
}

// cm:guard a real pre-commit hook exports the identity too, so the hook shape has to carry it or
//   the ordering case below has no inherited author to beat and passes unconditionally (ISS-39)
function hookEnvAt(canary) {
  return {
    ...process.env,
    GIT_DIR: join(canary, '.git'),
    GIT_WORK_TREE: canary,
    GIT_INDEX_FILE: join(canary, '.git', 'index'),
    GIT_CONFIG_PARAMETERS: "'core.hooksPath=/dev/null'",
    GIT_AUTHOR_NAME: 'inherited', GIT_AUTHOR_EMAIL: 'inherited@example.com',
    GIT_COMMITTER_NAME: 'inherited', GIT_COMMITTER_EMAIL: 'inherited@example.com',
  };
}

// cm:why the shape a tier's helper has: a temporary repository named by path, seeded and
//   committed — the smallest thing reproducing what tests/profiles.mjs does at :18 (ISS-39)
// cm:guard it SWALLOWS the git failure and reports the repository instead of throwing: a throw
//   would make the control below an error rather than a measurement (ISS-39)
function seedRepoWith(env, roots) {
  const root = mkdtempSync(join(tmpdir(), 'cm-genv-'));
  roots.push(root);
  writeFileSync(join(root, 'app.ts'), 'export const a = 1;\n');
  const run = (...args) => execFileSync('git', ['-C', root, ...args],
    { encoding: 'utf8', stdio: 'pipe', env });
  try {
    run('init', '-q');
    run('add', 'app.ts');
    // cm:guard this `-c` identity is deliberately NOT the GIT_AUTHOR_* one the identity case
    //   passes: making the two differ is what leaves that case able to tell which won (ISS-39)
    run('-c', 'user.name=fallback', '-c', 'user.email=fallback@test', 'commit', '-qm', 'seed');
  } catch { /* the leak's own symptom; actedOnItsOwnRepo below is what reads it */ }
  return root;
}

// cm:guard it compares the RESOLVED git dir against this root, never whether rev-parse merely
//   succeeded: with GIT_CEILING_DIRECTORIES stripped, any repository above tmpdir() answers (ISS-39)
function actedOnItsOwnRepo(root) {
  try {
    const dir = execFileSync('git', ['-C', root, 'rev-parse', '--absolute-git-dir'],
      { encoding: 'utf8', stdio: 'pipe', env: CLEAN_ENV }).trim();
    if (resolve(dir) !== resolve(join(root, '.git'))) return false;
    execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'],
      { encoding: 'utf8', stdio: 'pipe', env: CLEAN_ENV });
    return true;
  } catch { return false; }
}

function sameSet(a, b) {
  return a.length === b.length && [...a].sort().join(',') === [...b].sort().join(',');
}

// cm:guard the source sweep is what pins the per-call-site scrubs: tests/run.mjs replaces the run's
//   own environment, so every call site's scrub is unobservable at runtime and only this reads it
// cm:guard it matches the TEXT of a call, so an invocation spelled any other way than
//   execFileSync or spawnSync is invisible to this sweep and has to be added by hand (ISS-39)
// cm:guard the text of a call is read to its own closing paren by depth, never to the first `);`:
//   a nested call closes first and truncates the slice, which hid an `env:` that was there (ISS-39)
function callText(src, from) {
  let depth = 0;
  for (let i = src.indexOf('(', from); i < src.length; i += 1) {
    if (src[i] === '(') depth += 1;
    else if (src[i] === ')') { depth -= 1; if (depth === 0) return src.slice(from, i + 1); }
  }
  return src.slice(from);
}

function sourceCases(check) {
  const dir = new URL('.', import.meta.url).pathname;
  const inherits = [];
  const ambient = [];
  let scanned = 0;
  for (const name of readdirSync(dir).filter((f) => f.endsWith('.mjs')).sort()) {
    const src = readFileSync(join(dir, name), 'utf8');
    for (const m of src.matchAll(/(?:execFileSync|spawnSync)\(\s*(?:'git'|"git"|process\.execPath|'sh'|'bash')/g)) {
      const call = callText(src, m.index);
      const at = `${name}:${src.slice(0, m.index).split('\n').length}`;
      // cm:guard a match inside a COMMENT is skipped: this tier's own cm:edge names the pattern it
      //   greps for, and matching that made the sweep report itself as an offender (ISS-39)
      if (src.slice(src.lastIndexOf('\n', m.index) + 1, m.index).includes('//')) continue;
      if (/'sleep'/.test(call)) continue;
      scanned += 1;
      if (!/\benv\b/.test(call)) { inherits.push(at); continue; }
      if (/process\.env/.test(call) && !/stripGitEnv/.test(call)) ambient.push(at);
    }
  }
  check('git-env source: the sweep found calls to judge at all',
    scanned > 20, `only ${scanned} git/child invocations matched — the pattern has gone stale`);
  check('git-env source: no git or child invocation in tests/ inherits the environment implicitly',
    inherits.length === 0, `these pass no env at all: ${inherits.join(', ')}`);
  check('git-env source: no invocation in tests/ hands a child the ambient process.env',
    ambient.length === 0,
    `these spread process.env without stripGitEnv: ${ambient.join(', ')}`);
}

export function gitEnvCases(pluginRoot, check) {
  const roots = [];
  try {
    check('git-env: the location list is exactly what this tier pins',
      sameSet(GIT_LOCATION_VAR_NAMES, EXPECTED_LOCATION),
      `exported ${JSON.stringify(GIT_LOCATION_VAR_NAMES)} vs pinned ${JSON.stringify(EXPECTED_LOCATION)}`);
    check('git-env: the config list is exactly what this tier pins',
      sameSet(GIT_CONFIG_VAR_NAMES, EXPECTED_CONFIG),
      `exported ${JSON.stringify(GIT_CONFIG_VAR_NAMES)} vs pinned ${JSON.stringify(EXPECTED_CONFIG)}`);
    check('git-env: the behaviour list is exactly what this tier pins',
      sameSet(GIT_BEHAVIOUR_VAR_NAMES, EXPECTED_BEHAVIOUR),
      `exported ${JSON.stringify(GIT_BEHAVIOUR_VAR_NAMES)} vs pinned ${JSON.stringify(EXPECTED_BEHAVIOUR)}`);
    check('git-env: the identity list is exactly what this tier pins',
      sameSet(GIT_IDENTITY_VAR_NAMES, EXPECTED_IDENTITY),
      `exported ${JSON.stringify(GIT_IDENTITY_VAR_NAMES)} vs pinned ${JSON.stringify(EXPECTED_IDENTITY)}`);

    // cm:guard poisoned from the PINNED literals so every name is exercised: a fixture poisoning
    //   only the names it thought of left ten of them with no case at all (ISS-39)
    const poisoned = { ...process.env, CM_UNRELATED: 'kept' };
    const all = [...EXPECTED_LOCATION, ...EXPECTED_CONFIG, ...EXPECTED_BEHAVIOUR,
      ...EXPECTED_IDENTITY];
    for (const name of all) poisoned[name] = `poisoned-${name}`;
    poisoned.GIT_CONFIG_KEY_0 = 'core.editor';
    poisoned.GIT_CONFIG_VALUE_0 = 'false';
    const scrubbed = stripGitEnv(poisoned);

    for (const name of all) {
      const kept = name === 'GIT_CONFIG_COUNT';
      check(`git-env: ${name} does not survive the scrub`,
        scrubbed[name] !== `poisoned-${name}`,
        `${name} survived as ${JSON.stringify(scrubbed[name])}`);
      if (kept) continue;
      check(`git-env: ${name} is removed outright`, !(name in scrubbed),
        `${name} is still present as ${JSON.stringify(scrubbed[name])}`);
    }
    check('git-env: an inherited numbered GIT_CONFIG pair does not survive',
      scrubbed.GIT_CONFIG_KEY_0 !== 'core.editor' && scrubbed.GIT_CONFIG_VALUE_0 !== 'false',
      `survived: ${JSON.stringify({ k: scrubbed.GIT_CONFIG_KEY_0, v: scrubbed.GIT_CONFIG_VALUE_0 })}`);
    check('git-env: user and system config are suppressed rather than unset',
      scrubbed.GIT_CONFIG_GLOBAL === '/dev/null' && scrubbed.GIT_CONFIG_SYSTEM === '/dev/null',
      `got ${JSON.stringify({ g: scrubbed.GIT_CONFIG_GLOBAL, s: scrubbed.GIT_CONFIG_SYSTEM })}`);
    check('git-env: safe.directory is re-injected so a real checkout stays readable',
      scrubbed.GIT_CONFIG_KEY_0 === 'safe.directory' && scrubbed.GIT_CONFIG_VALUE_0 === '*'
        && scrubbed.GIT_CONFIG_COUNT === '1',
      `got ${JSON.stringify({ c: scrubbed.GIT_CONFIG_COUNT, k: scrubbed.GIT_CONFIG_KEY_0, v: scrubbed.GIT_CONFIG_VALUE_0 })}`);
    check('git-env: an unrelated variable is left alone',
      scrubbed.CM_UNRELATED === 'kept', `CM_UNRELATED is ${JSON.stringify(scrubbed.CM_UNRELATED)}`);
    check('git-env: the caller\'s own environment is not mutated',
      poisoned.GIT_DIR === 'poisoned-GIT_DIR', 'stripGitEnv wrote through to its argument');

    // cm:guard the control must keep reaching the canary: once it stops, the scrubbed cases below
    //   prove nothing, because the leak they claim to close is already shut elsewhere (ISS-39)
    const control = makeCanary(roots);
    const controlRepo = seedRepoWith(hookEnvAt(control), roots);
    check('git-env: CONTROL — an unscrubbed helper does NOT act on the repository it named',
      !actedOnItsOwnRepo(controlRepo),
      `${controlRepo} has a git dir of its own, so an inherited GIT_DIR no longer diverts this `
      + 'helper and every scrubbed case below is unfalsifiable — the leak has to stay reachable');

    const guarded = makeCanary(roots);
    const guardedHead = head(guarded);
    const guardedStatus = status(guarded);
    const guardedRepo = seedRepoWith(stripGitEnv(hookEnvAt(guarded)), roots);
    check('git-env: a scrubbed helper acts on the repository it named',
      actedOnItsOwnRepo(guardedRepo),
      `${guardedRepo} never got a commit of its own under a scrubbed hook environment`);
    check('git-env: a scrubbed helper leaves the ambient repository\'s HEAD where it was',
      head(guarded) === guardedHead,
      `HEAD moved ${guardedHead} -> ${head(guarded)}: the tier committed into the wrong repository`);
    check('git-env: a scrubbed helper leaves the ambient repository\'s worktree clean',
      status(guarded) === guardedStatus,
      `status changed:\n${JSON.stringify(guardedStatus)}\n->\n${JSON.stringify(status(guarded))}`);

    // cm:why the two ORDERS are run against each other, because that is the only thing that can
    //   tell them apart: scrubbing last deletes the fixture identity it was meant to keep (ISS-39)
    const FIXTURE = { GIT_AUTHOR_NAME: 'cm', GIT_AUTHOR_EMAIL: 'cm@test',
      GIT_COMMITTER_NAME: 'cm', GIT_COMMITTER_EMAIL: 'cm@test' };
    // cm:guard it reports the missing commit instead of throwing: when the scrub is broken the
    //   repository has none, and a throw here loses every case below it in this tier (ISS-39)
    const authorOf = (root) => {
      try {
        return execFileSync('git', ['-C', root, 'log', '-1', '--format=%an <%ae>'],
          { encoding: 'utf8', stdio: 'pipe', env: CLEAN_ENV }).trim();
      } catch { return '(no commit)'; }
    };

    const rightOrder = seedRepoWith(
      { ...stripGitEnv(hookEnvAt(makeCanary(roots))), ...FIXTURE }, roots);
    check('git-env: the fixture identity applied AFTER the scrub is the one that commits',
      authorOf(rightOrder) === 'cm <cm@test>',
      `committed as ${authorOf(rightOrder)}, not the fixture's cm <cm@test>`);

    // cm:guard the wrong order must keep producing a DIFFERENT author: once the two agree this
    //   pair stops discriminating and the ordering rule above is pinned by nothing (ISS-39)
    const wrongOrder = seedRepoWith(
      stripGitEnv({ ...hookEnvAt(makeCanary(roots)), ...FIXTURE }), roots);
    check('git-env: scrubbing AFTER the fixture identity loses it, which is why the order is fixed',
      authorOf(wrongOrder) === 'fallback <fallback@test>',
      `scrubbing last committed as ${authorOf(wrongOrder)}; it should have lost the fixture `
      + 'identity and fallen back to the -c one, so this pair no longer tells the orders apart');

    sourceCases(check);
  } finally {
    for (const r of roots) rmSync(r, { recursive: true, force: true });
  }
}
