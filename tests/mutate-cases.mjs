// cm:edge lockstep -> tests/mutate-lib.mjs — the harness's own classification, parsing, path
//   containment and environment scrub are pinned here, because a mutation harness whose logic no
//   case pins is the thing it exists to refuse. A new outcome or a changed parse belongs in the same
//   change as its case here (ISS-30)

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import {
  applyMutation, classify, GIT_CONFIG_VAR_NAMES, GIT_LOCATION_VAR_NAMES, MUTATIONS,
  parseCorpusOutput, stripGitEnv,
} from './mutate-lib.mjs';

const COUNT = (p, f) => `codemap golden corpus: ${p} passed, ${f} failed\n`;

function classifyCases(check) {
  const ran = (p, f) => parseCorpusOutput(COUNT(p, f), '');

  check('mutate: a failing check is pinned',
    classify(ran(650, 3), 653) === 'pinned',
    `expected pinned, got ${classify(ran(650, 3), 653)}`);

  check('mutate: nothing failing on the same total is DEAD',
    classify(ran(653, 0), 653) === 'DEAD',
    `expected DEAD, got ${classify(ran(653, 0), 653)}`);

  // cm:guard this is the false-DEAD case: a tier that disables itself rather than fail reports 0
  //   failed on FEWER checks, and calling that DEAD tells the author to delete working code (ISS-30)
  check('mutate: nothing failing on a smaller total is INCONCLUSIVE, not DEAD',
    classify(ran(653, 0), 654) === 'INCONCLUSIVE',
    `expected INCONCLUSIVE, got ${classify(ran(653, 0), 654)} — a shrunken corpus must never read as a dead mechanism`);

  check('mutate: nothing failing on a larger total is INCONCLUSIVE too',
    classify(ran(655, 0), 654) === 'INCONCLUSIVE',
    'a corpus that grew under mutation has not measured the mechanism either');

  check('mutate: a run with no count line is CRASH',
    classify(parseCorpusOutput('', 'ReferenceError: x is not defined'), 653) === 'CRASH',
    'a corpus that never printed its count line must not be classified from its exit status');

  // cm:guard a crash exits non-zero with nothing failing, so CRASH must outrank the count comparison
  //   or a throw would read as INCONCLUSIVE and lose its diagnosis (ISS-30)
  check('mutate: CRASH outranks a total mismatch',
    classify(parseCorpusOutput('', 'boom'), 654) === 'CRASH',
    'a run with no count line is a crash whatever the control ran');
}

function parseCases(check) {
  const one = parseCorpusOutput(COUNT(651, 2), '');
  check('mutate: the count line is read off stdout',
    one.passed === 651 && one.failed === 2 && one.total === 653,
    `got passed=${one.passed} failed=${one.failed} total=${one.total}`);

  const named = parseCorpusOutput(COUNT(1, 2), '  FAIL first check\n    detail\n  FAIL second check\n');
  check('mutate: every FAIL line is named, not counted',
    JSON.stringify(named.names) === JSON.stringify(['first check', 'second check']),
    `expected both names, got ${JSON.stringify(named.names)} — the count alone is what hid a case in ISS-26`);

  // cm:guard a failure detail carries another process's stdout verbatim (tests/install.mjs,
  //   tests/upgrade-workflow.mjs), so the leader is exactly two spaces: a looser one invents a check
  //   name that no case raised, and can push a real one out of the report (ISS-30)
  const phantom = parseCorpusOutput(COUNT(1, 1),
    '  FAIL install: vendors it\n    install said:\n      FAIL not-a-real-check\n');
  check('mutate: an embedded FAIL line in a failure detail is not harvested',
    JSON.stringify(phantom.names) === JSON.stringify(['install: vendors it']),
    `expected only the real check, got ${JSON.stringify(phantom.names)}`);

  check('mutate: a spawn error reaches the diagnosis',
    parseCorpusOutput('', '', 'ETIMEDOUT').diagnosis.includes('ETIMEDOUT'),
    'a timed-out run must say so rather than reporting an empty crash');
}

function anchorCases(check) {
  const dir = mkdtempSync(join(tmpdir(), 'cm-mutate-anchors-'));
  const outside = mkdtempSync(join(tmpdir(), 'cm-mutate-outside-'));
  try {
    const rel = join('lib', 'sample.mjs');
    mkdirSync(join(dir, 'lib'), { recursive: true });
    writeFileSync(join(dir, rel), 'const a = 1;\nconst b = 2;\nconst a = 3;\n');

    check('mutate: an anchor that is absent is refused',
      /anchor not found/.test(applyMutation(dir, { file: rel, find: 'nowhere in this file', replace: 'x' })),
      'a point whose source moved must say the anchor is gone, not mutate something else');

    // cm:guard the whole point of naming a site by a string instead of a line number: an anchor that
    //   matches twice names no single site, and mutating both would report a mechanism that no single
    //   edit corresponds to (ISS-30)
    check('mutate: an anchor matching more than once is refused',
      /matches 2x/.test(applyMutation(dir, { file: rel, find: 'const a', replace: 'const c' })),
      'an ambiguous anchor must be refused rather than replaced everywhere');

    check('mutate: a file the copy does not hold is refused',
      /is not in the tree/.test(applyMutation(dir, { file: 'lib/absent.mjs', find: 'x', replace: 'y' })),
      'a point naming a file the copy does not hold must say so');

    // cm:guard the containment check is pinned against a file that really EXISTS outside the copy:
    //   the first version of this case used a missing path, so it passed on "is not in the tree" and
    //   left a `..` point free to overwrite the very tree being measured (ISS-30)
    const victim = join(outside, 'victim.txt');
    writeFileSync(victim, 'untouched\n');
    const escape = applyMutation(dir, {
      file: join('..', basename(outside), 'victim.txt'),
      find: 'untouched',
      replace: 'OVERWRITTEN',
    });
    check('mutate: a point resolving outside the copy is refused',
      /resolves outside the copy/.test(String(escape)),
      `expected a containment refusal, got ${JSON.stringify(escape)}`);
    check('mutate: a refused escape wrote nothing',
      readFileSync(victim, 'utf8') === 'untouched\n',
      `the file outside the copy now reads ${JSON.stringify(readFileSync(victim, 'utf8'))}`);

    check('mutate: a unique anchor is substituted, and nothing else is',
      applyMutation(dir, { file: rel, find: 'const b = 2;', replace: 'const b = 99;' }) === null
      && readFileSync(join(dir, rel), 'utf8') === 'const a = 1;\nconst b = 99;\nconst a = 3;\n',
      `after substitution the file read: ${JSON.stringify(readFileSync(join(dir, rel), 'utf8'))}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
}

// cm:guard the scrub is pinned by putting a poisoned environment THROUGH stripGitEnv, never by
//   passing an already-clean one: the first version asserted on a snapshot of a clean process.env, so
//   neutering the strip loop entirely still passed every case — the mechanism was credited by a test
//   that could not fail, which is the defect ISS-30 exists to catch (ISS-30)
// cm:guard the poisoned environment is built from stripGitEnv(process.env) and given back ONLY
//   GIT_DIR. Building it from process.env kept the inherited GIT_INDEX_FILE, and under any git hook
//   this case then staged its fixture into the developer's real index — the gate corrupting the
//   repository it was run to protect (ISS-30)
function gitEnvCases(check) {
  const victim = mkdtempSync(join(tmpdir(), 'cm-mutate-victim-'));
  const poisonedCopy = mkdtempSync(join(tmpdir(), 'cm-mutate-poisoned-'));
  const guardedCopy = mkdtempSync(join(tmpdir(), 'cm-mutate-guarded-'));
  try {
    const clean = stripGitEnv(process.env);
    const id = ['-c', 'user.email=t@t.invalid', '-c', 'user.name=t', '-c', 'commit.gpgsign=false'];
    const run = (cwd, args, env) => execFileSync('git', ['-C', cwd, ...args],
      { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] });

    run(victim, ['init', '-q'], clean);
    writeFileSync(join(victim, 'canary.txt'), 'original\n');
    run(victim, ['add', 'canary.txt'], clean);
    run(victim, [...id, 'commit', '-q', '-m', 'victim base'], clean);
    const before = run(victim, ['rev-parse', 'HEAD'], clean).trim();

    const poisoned = { ...clean, GIT_DIR: join(victim, '.git') };

    let leaked = false;
    try {
      writeFileSync(join(poisonedCopy, 'canary.txt'), 'MUTATED\n');
      run(poisonedCopy, ['init', '-q'], poisoned);
      run(poisonedCopy, ['add', '--', 'canary.txt'], poisoned);
      run(poisonedCopy, [...id, 'commit', '-q', '-m', 'poisoned'], poisoned);
      leaked = run(victim, ['rev-parse', 'HEAD'], clean).trim() !== before;
    } catch { leaked = false; }
    check('mutate: an inherited GIT_DIR really can reach another repository',
      leaked,
      'the positive control did not leak, so the case below proves nothing about the scrub');

    run(victim, [...id, 'reset', '-q', '--hard', before], clean);
    const restored = run(victim, ['rev-parse', 'HEAD'], clean).trim();

    let leakedAfterStrip = false;
    try {
      writeFileSync(join(guardedCopy, 'canary.txt'), 'MUTATED\n');
      const scrubbed = stripGitEnv(poisoned);
      run(guardedCopy, ['init', '-q'], scrubbed);
      run(guardedCopy, ['add', '--', 'canary.txt'], scrubbed);
      run(guardedCopy, [...id, 'commit', '-q', '-m', 'guarded'], scrubbed);
      leakedAfterStrip = run(victim, ['rev-parse', 'HEAD'], clean).trim() !== restored;
    } catch { leakedAfterStrip = true; }
    const canary = run(victim, ['show', 'HEAD:canary.txt'], clean).trim();
    check('mutate: stripGitEnv defuses the leak the control just demonstrated',
      !leakedAfterStrip && canary === 'original',
      `the same environment through stripGitEnv still reached the other repository: canary reads ${JSON.stringify(canary)}`);

    const poisonedConfig = {
      ...clean,
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'core.hooksPath',
      GIT_CONFIG_VALUE_0: '/nonexistent',
      GIT_CONFIG_PARAMETERS: "'core.hooksPath'='/nonexistent'",
    };
    const scrubbedConfig = stripGitEnv(poisonedConfig);
    const configSurvivors = Object.keys(scrubbedConfig)
      .filter((k) => /^GIT_CONFIG_(COUNT|KEY_\d+|VALUE_\d+|PARAMETERS)$/.test(k));
    check('mutate: stripGitEnv removes the environment config channel',
      configSurvivors.length === 0,
      `git honours these from the environment, so they reach the copy: ${configSurvivors.join(', ')}`);

    const everything = { ...process.env };
    for (const k of [...GIT_LOCATION_VAR_NAMES, ...GIT_CONFIG_VAR_NAMES]) everything[k] = '/poison';
    const scrubbedAll = stripGitEnv(everything);
    const survivors = [...GIT_LOCATION_VAR_NAMES, ...GIT_CONFIG_VAR_NAMES]
      .filter((k) => k in scrubbedAll);
    check('mutate: stripGitEnv removes every location and config variable it names',
      survivors.length === 0, `still present after the scrub: ${survivors.join(', ')}`);

    // cm:guard suppressing the user's own config is done by POINTING it at an empty file, not by
    //   unsetting it: an environment that had already set GIT_CONFIG_GLOBAL=/dev/null was suppressing
    //   ~/.gitconfig deliberately, and deleting the variable hands that config back (ISS-30)
    check('mutate: stripGitEnv suppresses user and system config rather than unsetting it',
      scrubbedAll.GIT_CONFIG_GLOBAL === '/dev/null'
      && scrubbedAll.GIT_CONFIG_SYSTEM === '/dev/null'
      && scrubbedAll.GIT_CONFIG_NOSYSTEM === '1',
      `got GLOBAL=${scrubbedAll.GIT_CONFIG_GLOBAL} SYSTEM=${scrubbedAll.GIT_CONFIG_SYSTEM} NOSYSTEM=${scrubbedAll.GIT_CONFIG_NOSYSTEM}`);

    check('mutate: stripGitEnv leaves the rest of the environment alone',
      scrubbedAll.PATH === process.env.PATH,
      'the copy still has to be able to find git and node');
  } finally {
    for (const d of [victim, poisonedCopy, guardedCopy]) rmSync(d, { recursive: true, force: true });
  }
}

// cm:guard the CLI half is read as TEXT here on purpose, and only for invariants running it cannot
//   show: that every git call goes through the one scrubbed wrapper, and that importing the module
//   cannot start a run. A regex over the call site itself was gameable — the same call rewritten
//   with spawnSync, or its options hoisted to a const, passed it (ISS-30)
function wiringCases(pluginRoot, check) {
  const cli = readFileSync(join(pluginRoot, 'tests', 'mutate.mjs'), 'utf8');

  const execGit = (cli.match(/execFileSync\(\s*['"]git['"]/g) ?? []).length;
  const spawnGit = (cli.match(/spawnSync\(\s*['"]git['"]/g) ?? []).length;
  check('mutate: the harness invokes git from exactly one place',
    execGit === 1 && spawnGit === 0,
    `found ${execGit} execFileSync and ${spawnGit} spawnSync git call sites — every one has to go `
    + 'through the single wrapper that passes the scrubbed environment, or the scrub is bypassable');

  // cm:guard tests/run.mjs reaches the pure half through this file. If it ever reaches the CLI half
  //   instead, `main` joins the corpus's import graph and the corpus spawns a corpus run per declared
  //   point, each level bounded only by the ten-minute timeout (ISS-30)
  const lib = readFileSync(join(pluginRoot, 'tests', 'mutate-lib.mjs'), 'utf8');
  check('mutate: the pure half does not import the half that spawns',
    !/from\s+['"]\.\/mutate\.mjs['"]/.test(lib),
    'tests/mutate-lib.mjs must not import tests/mutate.mjs, or importing the list runs the harness');

  const cases = readFileSync(join(pluginRoot, 'tests', 'mutate-cases.mjs'), 'utf8');
  check('mutate: the corpus cases do not import the half that spawns',
    !/from\s+['"]\.\/mutate\.mjs['"]/.test(cases),
    'these cases must import tests/mutate-lib.mjs only — importing the CLI puts main on the corpus import graph');

  const runner = readFileSync(join(pluginRoot, 'tests', 'run.mjs'), 'utf8');
  check('mutate: the runner does not reach the half that spawns',
    !/['"]\.\/mutate\.mjs['"]/.test(runner),
    'tests/run.mjs must not import tests/mutate.mjs — the harness is opt-in and spends a corpus run per point');
}

function declaredListCases(check) {
  // cm:guard the declared list is the reviewed artefact, so its shape is checked rather than its
  //   contents: a point with no id or no anchor is a row that cannot be read (ISS-30)
  const shapeless = MUTATIONS.filter((m) => !m.id || !m.file || !m.find || m.replace === undefined
    || !m.mechanism);
  check('mutate: every declared point carries an id, a file, an anchor, a replacement and a mechanism',
    shapeless.length === 0, `incomplete: ${shapeless.map((m) => m.id ?? '(no id)').join(', ')}`);

  const ids = MUTATIONS.map((m) => m.id);
  check('mutate: declared ids are unique',
    new Set(ids).size === ids.length,
    `--only takes an id, so a duplicate makes one point unreachable: [${ids.join(', ')}]`);

  const sameText = MUTATIONS.filter((m) => m.find === m.replace);
  check('mutate: no declared point replaces its anchor with itself',
    sameText.length === 0,
    `a no-op mutation always reads DEAD: ${sameText.map((m) => m.id).join(', ')}`);

  const escaping = MUTATIONS.filter((m) => m.file.split('/').includes('..') || m.file.startsWith('/'));
  check('mutate: no declared point names a path outside the tree',
    escaping.length === 0,
    `these would be refused at run time, so they are dead rows: ${escaping.map((m) => m.id).join(', ')}`);
}

export function mutateCases(pluginRoot, check) {
  classifyCases(check);
  parseCases(check);
  anchorCases(check);
  gitEnvCases(check);
  wiringCases(pluginRoot, check);
  declaredListCases(check);
}
