// cm:edge lockstep -> tests/mutate.mjs — the harness's own classification and parsing are pinned
//   here, because a mutation harness whose logic no case pins is the thing it exists to refuse. A
//   new outcome or a changed parse belongs in the same change as its case here (ISS-30)

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyMutation, classify, GIT_ENV, parseCorpusOutput, MUTATIONS } from './mutate.mjs';

const COUNT = (p, f) => `codemap golden corpus: ${p} passed, ${f} failed\n`;

export function mutateCases(pluginRoot, check) {
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

  check('mutate: a run with no count line is CRASH',
    classify(parseCorpusOutput('', 'ReferenceError: x is not defined'), 653) === 'CRASH',
    'a corpus that never printed its count line must not be classified from its exit status');

  // cm:guard a crash exits non-zero with nothing failing, so CRASH must outrank the count comparison
  //   or a throw would read as INCONCLUSIVE and lose its diagnosis (ISS-30)
  check('mutate: CRASH outranks a total mismatch',
    classify(parseCorpusOutput('', 'boom'), 654) === 'CRASH',
    'a run with no count line is a crash whatever the control ran');

  check('mutate: the count line is read off stdout',
    ran(651, 2).passed === 651 && ran(651, 2).failed === 2 && ran(651, 2).total === 653,
    `got passed=${ran(651, 2).passed} failed=${ran(651, 2).failed} total=${ran(651, 2).total}`);

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

  const dir = mkdtempSync(join(tmpdir(), 'cm-mutate-cases-'));
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

    check('mutate: a file outside the tree is refused',
      /is not in the tree/.test(applyMutation(dir, { file: 'lib/absent.mjs', find: 'x', replace: 'y' })),
      'a point naming a file the copy does not hold must say so');

    check('mutate: a unique anchor is substituted, and nothing else is',
      applyMutation(dir, { file: rel, find: 'const b = 2;', replace: 'const b = 99;' }) === null
      && readFileSync(join(dir, rel), 'utf8') === 'const a = 1;\nconst b = 99;\nconst a = 3;\n',
      `after substitution the file read: ${JSON.stringify(readFileSync(join(dir, rel), 'utf8'))}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  // cm:guard git prefers GIT_DIR, GIT_WORK_TREE and GIT_INDEX_FILE over `-C`, so the harness strips
  //   them before every child call. Without that, running under `git bisect run`, `git rebase --exec`
  //   or any git hook commits the MUTATION into the outer checkout instead of the copy (ISS-30)
  const victim = mkdtempSync(join(tmpdir(), 'cm-mutate-victim-'));
  const copy = mkdtempSync(join(tmpdir(), 'cm-mutate-under-gitdir-'));
  try {
    const id = ['-c', 'user.email=t@t.invalid', '-c', 'user.name=t', '-c', 'commit.gpgsign=false'];
    const run = (cwd, args, env) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env });
    run(victim, ['init', '-q'], GIT_ENV);
    writeFileSync(join(victim, 'canary.txt'), 'original\n');
    run(victim, ['add', 'canary.txt'], GIT_ENV);
    run(victim, [...id, 'commit', '-q', '-m', 'victim base'], GIT_ENV);
    const before = run(victim, ['rev-parse', 'HEAD'], GIT_ENV).trim();

    writeFileSync(join(copy, 'canary.txt'), 'MUTATED\n');
    // cm:guard GIT_DIR alone is the sharp shape, with GIT_WORK_TREE left unset: git then takes the
    //   WORKING TREE from the cwd, which is the copy, so the mutated file is what gets staged into the
    //   other repository. Setting both instead points the worktree away and defuses it (ISS-30)
    const poisoned = { ...process.env, GIT_DIR: join(victim, '.git') };
    delete poisoned.GIT_WORK_TREE;

    // cm:guard the positive control for the guard above: with the variables left in place these very
    //   calls DO land the mutated content in the victim, so a stripping regression fails this (ISS-30)
    let leaked = false;
    try {
      run(copy, ['init', '-q'], poisoned);
      run(copy, ['add', '--', 'canary.txt'], poisoned);
      run(copy, [...id, 'commit', '-q', '-m', 'poisoned'], poisoned);
      leaked = run(victim, ['rev-parse', 'HEAD'], GIT_ENV).trim() !== before;
    } catch { leaked = false; }
    check('mutate: an inherited GIT_DIR really can reach another repository',
      leaked, 'the positive control did not leak, so the next case proves nothing about the fix');

    run(victim, [...id, 'reset', '-q', '--hard', before], GIT_ENV);
    const guarded = { ...GIT_ENV };
    const copy2 = mkdtempSync(join(tmpdir(), 'cm-mutate-guarded-'));
    try {
      writeFileSync(join(copy2, 'canary.txt'), 'MUTATED\n');
      run(copy2, ['init', '-q'], guarded);
      run(copy2, ['add', '--', 'canary.txt'], guarded);
      run(copy2, [...id, 'commit', '-q', '-m', 'guarded'], guarded);
      const after = run(victim, ['rev-parse', 'HEAD'], GIT_ENV).trim();
      const canary = run(victim, ['show', 'HEAD:canary.txt'], GIT_ENV);
      check('mutate: GIT_ENV keeps the copy\'s commits out of the outer repository',
        after === before && canary.trim() === 'original',
        `victim HEAD ${before} -> ${after}, canary ${JSON.stringify(canary)} — the harness must never commit into the checkout it is measuring`);
      check('mutate: GIT_ENV strips every git location variable',
        ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_COMMON_DIR']
          .every((k) => !(k in GIT_ENV)),
        `still present: ${['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_COMMON_DIR'].filter((k) => k in GIT_ENV).join(', ')}`);
    } finally {
      rmSync(copy2, { recursive: true, force: true });
    }
  } finally {
    rmSync(victim, { recursive: true, force: true });
    rmSync(copy, { recursive: true, force: true });
  }

  // cm:guard every child git call in the harness has to carry GIT_ENV, not the ambient environment:
  //   one that forgets it reopens the whole class the case above pins (ISS-30)
  const harness = readFileSync(join(pluginRoot, 'tests', 'mutate.mjs'), 'utf8');
  const bareGit = [...harness.matchAll(/execFileSync\('git'[\s\S]{0,200}?\}\)/g)]
    .filter((m) => !m[0].includes('GIT_ENV'));
  check('mutate: no git call in the harness runs on the ambient environment',
    bareGit.length === 0,
    `these omit env: GIT_ENV — ${bareGit.map((m) => m[0].slice(0, 60)).join(' | ')}`);

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
}
