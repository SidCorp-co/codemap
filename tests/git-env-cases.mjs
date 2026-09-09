// ISS-39 — the corpus run from a git hook. A tier names its throwaway repository by path, but git
// reads the environment first, so an inherited GIT_DIR silently redirected every one of them: the
// gate committed into the repository it was run to protect. These cases pin the scrub, and the
// CONTROL pins that the leak is still reachable without it — a case that can no longer fail here
// is a case that has stopped measuring anything.

import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  stripGitEnv, GIT_LOCATION_VAR_NAMES, GIT_CONFIG_VAR_NAMES, GIT_IDENTITY_VAR_NAMES,
} from './git-env.mjs';

function makeCanary(roots) {
  const root = mkdtempSync(join(tmpdir(), 'cm-canary-'));
  roots.push(root);
  writeFileSync(join(root, 'canary.txt'), 'canary\n');
  const env = stripGitEnv(process.env);
  execFileSync('git', ['-C', root, 'init', '-q'], { env });
  execFileSync('git', ['-C', root, 'add', 'canary.txt'], { env });
  execFileSync('git', ['-C', root, '-c', 'user.email=c@c', '-c', 'user.name=c',
    'commit', '-qm', 'seed'], { env });
  return root;
}

function head(root) {
  return execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'],
    { encoding: 'utf8', env: stripGitEnv(process.env) }).trim();
}

function status(root) {
  return execFileSync('git', ['-C', root, 'status', '--porcelain'],
    { encoding: 'utf8', env: stripGitEnv(process.env) });
}

function hookEnvAt(canary) {
  return {
    ...process.env,
    GIT_DIR: join(canary, '.git'),
    GIT_WORK_TREE: canary,
    GIT_INDEX_FILE: join(canary, '.git', 'index'),
    GIT_CONFIG_PARAMETERS: "'core.hooksPath=/dev/null'",
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

// cm:why the one observable that holds however the leak manifests — a throw, a commit landing
//   elsewhere, or a silent no-op: did the call act on the repository it was NAMED (ISS-39)
function actedOnItsOwnRepo(root) {
  try {
    execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'],
      { encoding: 'utf8', stdio: 'pipe', env: stripGitEnv(process.env) });
    return true;
  } catch { return false; }
}

export function gitEnvCases(pluginRoot, check) {
  const roots = [];
  try {
    const poisoned = { ...process.env, GIT_DIR: '/nowhere/.git', GIT_WORK_TREE: '/nowhere',
      GIT_INDEX_FILE: '/nowhere/index', GIT_OBJECT_DIRECTORY: '/nowhere/objects',
      GIT_CONFIG: '/nowhere/config', GIT_CONFIG_PARAMETERS: "'core.hooksPath=/nowhere'",
      GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.editor', GIT_CONFIG_VALUE_0: 'false',
      GIT_AUTHOR_NAME: 'inherited', GIT_COMMITTER_EMAIL: 'inherited@example.com',
      CM_UNRELATED: 'kept' };
    const scrubbed = stripGitEnv(poisoned);

    for (const name of GIT_LOCATION_VAR_NAMES) {
      if (poisoned[name] === undefined) continue;
      check(`git-env: ${name} is removed`, !(name in scrubbed),
        `${name} survived as ${JSON.stringify(scrubbed[name])}`);
    }
    for (const name of [...GIT_CONFIG_VAR_NAMES, ...GIT_IDENTITY_VAR_NAMES]) {
      if (poisoned[name] === undefined) continue;
      check(`git-env: ${name} is removed`, !(name in scrubbed),
        `${name} survived as ${JSON.stringify(scrubbed[name])}`);
    }
    check('git-env: a numbered GIT_CONFIG_KEY/VALUE pair is removed',
      !('GIT_CONFIG_KEY_0' in scrubbed) && !('GIT_CONFIG_VALUE_0' in scrubbed),
      `survived: ${JSON.stringify({ k: scrubbed.GIT_CONFIG_KEY_0, v: scrubbed.GIT_CONFIG_VALUE_0 })}`);
    check('git-env: user and system config are suppressed rather than unset',
      scrubbed.GIT_CONFIG_GLOBAL === '/dev/null' && scrubbed.GIT_CONFIG_SYSTEM === '/dev/null',
      `got ${JSON.stringify({ g: scrubbed.GIT_CONFIG_GLOBAL, s: scrubbed.GIT_CONFIG_SYSTEM })}`);
    check('git-env: an unrelated variable is left alone',
      scrubbed.CM_UNRELATED === 'kept', `CM_UNRELATED is ${JSON.stringify(scrubbed.CM_UNRELATED)}`);
    check('git-env: the caller\'s own environment is not mutated',
      poisoned.GIT_DIR === '/nowhere/.git', 'stripGitEnv wrote through to its argument');

    // cm:guard the control must keep reaching the canary: once it stops, the scrubbed cases below
    //   prove nothing, because the leak they claim to close is already shut elsewhere (ISS-39)
    const control = makeCanary(roots);
    const controlRepo = seedRepoWith(hookEnvAt(control), roots);
    check('git-env: CONTROL — an unscrubbed helper does NOT act on the repository it named',
      !actedOnItsOwnRepo(controlRepo),
      `${controlRepo} has a HEAD of its own, so an inherited GIT_DIR no longer diverts this helper `
      + 'and every scrubbed case below is unfalsifiable — the leak has to stay reachable here');

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

    // cm:why the identity channel outranks `-c user.name`, so a tier that strips AFTER applying its
    //   own author would still commit as whoever invoked the corpus (ISS-39)
    const identity = seedRepoWith(
      { ...stripGitEnv(hookEnvAt(makeCanary(roots))), GIT_AUTHOR_NAME: 'cm',
        GIT_AUTHOR_EMAIL: 'cm@test', GIT_COMMITTER_NAME: 'cm', GIT_COMMITTER_EMAIL: 'cm@test' },
      roots);
    check('git-env: the fixture identity applied after the scrub is the one that commits',
      execFileSync('git', ['-C', identity, 'log', '-1', '--format=%an <%ae>'],
        { encoding: 'utf8', env: stripGitEnv(process.env) }).trim() === 'cm <cm@test>',
      execFileSync('git', ['-C', identity, 'log', '-1', '--format=%an <%ae>'],
        { encoding: 'utf8', env: stripGitEnv(process.env) }).trim());
  } finally {
    for (const r of roots) rmSync(r, { recursive: true, force: true });
  }
}
