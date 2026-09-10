// ISS-63 — the paste-ready templates `cm new` and `cm onboard` print. Pure cases for the repo-wide
// leader tally first, then a CLI tier against throwaway repos in three leader dialects, because the
// defect was never in the tally but in a literal `//` sitting in the printer.

import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { dominantLeader, leaderFor } from '../cli/lib/languages.mjs';
import { stripGitEnv } from './git-env.mjs';

function git(root, ...args) {
  execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    env: { ...stripGitEnv(process.env), GIT_AUTHOR_NAME: 'cm', GIT_AUTHOR_EMAIL: 'cm@test',
      GIT_COMMITTER_NAME: 'cm', GIT_COMMITTER_EMAIL: 'cm@test' },
  });
}

function cm(pluginRoot, root, ...args) {
  const res = spawnSync(process.execPath, [join(pluginRoot, 'cli', 'cm.mjs'), ...args], {
    cwd: root, encoding: 'utf8', env: { ...stripGitEnv(process.env), NO_COLOR: '1' },
  });
  return { ...res, out: `${res.stdout}${res.stderr}` };
}

function tallyCases(check) {
  check('new: the dominant leader of a mostly-# file list is # (ISS-63)',
    dominantLeader(['deploy.sh', 'setup.sh', 'vars.yml', 'app.ts']).leader === '#',
    `got ${JSON.stringify(dominantLeader(['deploy.sh', 'setup.sh', 'vars.yml', 'app.ts']))}`);

  check('new: the dominant leader of a mostly-// file list is // (ISS-63)',
    dominantLeader(['app.ts', 'lib.ts', 'deploy.sh']).leader === '//',
    `got ${JSON.stringify(dominantLeader(['app.ts', 'lib.ts', 'deploy.sh']))}`);

  // cm:guard the counts are what the printed line SAYS out loud, so they are asserted, not merely the winner —
  //   a tally that named the right leader and the wrong count would print a false claim about the repo (ISS-63)
  check('new: the tally reports how many files carry the winner and how many are profiled at all (ISS-63)',
    dominantLeader(['deploy.sh', 'setup.sh', 'app.ts', 'README.md']).files === 2
      && dominantLeader(['deploy.sh', 'setup.sh', 'app.ts', 'README.md']).profiled === 3,
    `README.md has no leader and must be counted in neither; got ${JSON.stringify(dominantLeader(['deploy.sh', 'setup.sh', 'app.ts', 'README.md']))}`);

  check('new: a file list in which nothing has a line leader yields no leader (ISS-63)',
    dominantLeader(['README.md', 'CHANGELOG.md']).leader === null
      && dominantLeader(['README.md']).profiled === 0,
    `got ${JSON.stringify(dominantLeader(['README.md', 'CHANGELOG.md']))}`);

  check('new: an empty file list yields no leader rather than throwing (ISS-63)',
    dominantLeader([]).leader === null && dominantLeader([]).files === 0,
    `got ${JSON.stringify(dominantLeader([]))}`);

  // cm:guard a tie must break on the LEADER STRING and never on iteration order — the file list arrives from a
  //   directory walk, so an order-dependent tie prints a different template for the same repo run to run (ISS-63)
  const tie = ['app.ts', 'deploy.sh'];
  check('new: a tie breaks deterministically, and the same way whichever order the walk hands over (ISS-63)',
    dominantLeader(tie).leader === '#' && dominantLeader([...tie].reverse()).leader === '#',
    `'#' sorts before '//'; got ${JSON.stringify([dominantLeader(tie).leader, dominantLeader([...tie].reverse()).leader])}`);

  // cm:guard the tally must hold NO leader table of its own — leaderFor is the single authority, and a second
  //   extension-keyed list is the drift ISS-32 measured at 5 silently lost extensions (ISS-63)
  check('new: every leader the tally reports is one leaderFor gives for that same path (ISS-63)',
    ['deploy.sh', 'app.ts', 'schema.sql', 'a.rs', 'a.php'].every((f) => dominantLeader([f]).leader === leaderFor(f)),
    'a leader the tally reports that leaderFor does not means a second table is hiding in dominantLeader');
}

function repo(dialect) {
  const root = mkdtempSync(join(tmpdir(), `cm-new-${dialect}-`));
  git(root, 'init', '-q', '.');
  if (dialect === 'hash') {
    writeFileSync(join(root, 'deploy.sh'), 'set -e\necho hi\n');
    writeFileSync(join(root, 'provision.sh'), 'set -e\n');
    writeFileSync(join(root, 'vars.yml'), 'x: 1\n');
    writeFileSync(join(root, 'one_odd.ts'), 'export const t = 1;\n');
  } else if (dialect === 'slash') {
    writeFileSync(join(root, 'app.ts'), 'export const a = 1;\n');
    writeFileSync(join(root, 'lib.ts'), 'export const b = 2;\n');
  } else {
    writeFileSync(join(root, 'README.md'), '# nothing here carries a line comment\n');
  }
  return root;
}

// cm:guard assert the leader LITERALLY, never against dominantLeader(files) — comparing with the same call the
//   printer makes passes just as well when the printer writes a literal, which is the whole defect (ISS-63)
function templateLines(out) {
  return out.split('\n').filter((l) => /cm:(edge|flow)/.test(l) && !/^\s*(only the name|assuming|the leader is|no )/.test(l));
}

function cliCases(pluginRoot, check) {
  const hash = repo('hash');
  const slash = repo('slash');
  const bare = repo('bare');
  try {
    for (const root of [hash, slash, bare]) cm(pluginRoot, root, 'init');

    const ext = cm(pluginRoot, hash, 'new', 'external', 'acme');
    check('new external: a #-leader repo gets a # template, not // (ISS-63)',
      templateLines(ext.out).length === 1 && templateLines(ext.out)[0].trim().startsWith('# cm:edge contract -> external:acme/'),
      `pasting // into a shell tree is a syntax error; got: ${JSON.stringify(templateLines(ext.out))}`);
    check('new external: the output names the leader it assumed (ISS-63)',
      /assuming #, the leader of 3 of this repo's 4 profiled files/.test(ext.out),
      `a guessed leader must say it is a guess, with the count it rests on; got:\n${ext.out}`);
    const registry = () => JSON.parse(readFileSync(join(hash, '.forge', 'codemap.json'), 'utf8'));
    check('new external: the registry entry is written exactly as before (ISS-63)',
      registry().externals.some((x) => x.name === 'acme' && x.description === '')
        && /declared external "acme"/.test(ext.out) && ext.status === 0,
      `got status ${ext.status}, externals ${JSON.stringify(registry().externals)}:\n${ext.out}`);

    const flow = cm(pluginRoot, hash, 'new', 'flow', 'checkout');
    check('new flow: both template lines carry the repo\'s own leader (ISS-63)',
      templateLines(flow.out).length === 2
        && templateLines(flow.out).every((l) => l.trim().startsWith('# cm:flow checkout/')),
      `got: ${JSON.stringify(templateLines(flow.out))}`);
    check('new flow: the registry entry is written exactly as before (ISS-63)',
      registry().flows.some((f) => f.name === 'checkout' && f.description === '')
        && /declared flow "checkout"/.test(flow.out) && flow.status === 0,
      `got status ${flow.status}, flows ${JSON.stringify(registry().flows)}:\n${flow.out}`);

    // cm:guard --in is the exact answer and must beat the tally — in this repo the two disagree on purpose, so a
    //   printer that ignored the flag would still print # and pass a same-leader assertion (ISS-63)
    const inFlag = cm(pluginRoot, slash, 'new', 'flow', 'shipping', '--in', 'setup.sh');
    writeFileSync(join(slash, 'setup.sh'), 'set -e\n');
    const inFlag2 = cm(pluginRoot, slash, 'new', 'flow', 'deploying', '--in', 'setup.sh');
    check('new flow --in: the named host decides the leader, against a repo whose dominant leader differs (ISS-63)',
      templateLines(inFlag2.out).length === 2
        && templateLines(inFlag2.out).every((l) => l.trim().startsWith('# cm:flow deploying/')),
      `the repo is //-dominant and setup.sh is #; got: ${JSON.stringify(templateLines(inFlag2.out))}`);
    check('new flow --in: the output names the file it read the leader off (ISS-63)',
      /the leader is #, taken from setup\.sh/.test(inFlag2.out),
      `got:\n${inFlag2.out}`);
    check('new flow --in: a path that is not in the repo is exit 2, not a guess (ISS-63)',
      inFlag.status === 2 && /--in "setup\.sh" is not a file/.test(inFlag.out),
      `before setup.sh existed this had to refuse; got status ${inFlag.status}:\n${inFlag.out}`);

    // cm:guard the //-dominant repo is the CONTROL — without it every assertion above passes on a printer that
    //   simply always writes '#', which is the same class of bug the other way round (ISS-63)
    const control = cm(pluginRoot, slash, 'new', 'external', 'stripe');
    check('new external: a //-leader repo still gets // (ISS-63)',
      templateLines(control.out).length === 1 && templateLines(control.out)[0].trim().startsWith('// cm:edge contract -> external:stripe/'),
      `got: ${JSON.stringify(templateLines(control.out))}`);

    const none = cm(pluginRoot, bare, 'new', 'flow', 'checkout');
    check('new flow: a repo with no profiled file gets a placeholder, never // (ISS-63)',
      templateLines(none.out).length === 2
        && templateLines(none.out).every((l) => l.trim().startsWith('<leader> cm:flow checkout/')),
      `got: ${JSON.stringify(templateLines(none.out))}`);
    check('new flow: that repo is told plainly that the leader is not known (ISS-63)',
      /no file here has a line comment leader/.test(none.out),
      `got:\n${none.out}`);

    // cm:guard the negative that pins the whole issue: NO arm may print a `//` line in a tree that has no // file
    check('new: no template line in a #-only or leaderless repo carries // (ISS-63)',
      !/^\s*\/\/ cm:/m.test(ext.out) && !/^\s*\/\/ cm:/m.test(flow.out) && !/^\s*\/\/ cm:/m.test(none.out),
      'a literal // survived somewhere in the new arm');
  } finally {
    for (const root of [hash, slash, bare]) rmSync(root, { recursive: true, force: true });
  }
}

function onboardCases(pluginRoot, check) {
  const root = mkdtempSync(join(tmpdir(), 'cm-onboard-leader-'));
  git(root, 'init', '-q', '.');
  try {
    writeFileSync(join(root, 'svc_pay.go'), 'package main\n');
    writeFileSync(join(root, 'note.py'), 'X = 1\n# the retry budget here must match svc_pay.go\n');
    writeFileSync(join(root, 'wire.ts'), 'export const w = 1;\n// the retry budget here must match svc_pay.go\n');
    git(root, 'add', 'svc_pay.go', 'note.py', 'wire.ts');
    git(root, 'commit', '-qm', 'prose naming another file, in two languages');
    cm(pluginRoot, root, 'init');
    // cm:why py's docPolicy is 'allowed', so CM001 — and with it every prose candidate — needs the policy set per
    //   language here; without it the only candidate onboard finds is the ts one and the test proves nothing (ISS-63)
    const regPath = join(root, '.forge', 'codemap.json');
    const reg = JSON.parse(readFileSync(regPath, 'utf8'));
    reg.enforce.grammar = true;
    reg.languages = { py: { enforce: true, docPolicy: 'banned' } };
    writeFileSync(regPath, JSON.stringify(reg, null, 2));
    const out = cm(pluginRoot, root, 'onboard').out;

    // cm:guard each candidate's line must carry ITS OWN host's leader — the summary line this replaced said
    //   `// cm:edge` for every candidate whatever language it was written in (ISS-63)
    const py = out.split('\n').find((l) => /cm:edge <kind> -> svc_pay\.go/.test(l) && /^\s*#/.test(l.trim()));
    const ts = out.split('\n').find((l) => /cm:edge <kind> -> svc_pay\.go/.test(l) && /^\s*\/\//.test(l.trim()));
    check('onboard: the python candidate is offered a # annotation (ISS-63)', Boolean(py),
      `no #-led suggestion in:\n${out}`);
    check('onboard: the typescript candidate is offered a // annotation (ISS-63)', Boolean(ts),
      `no //-led suggestion in:\n${out}`);
    check('onboard: the one-size summary line carrying a hard-coded // is gone (ISS-63)',
      !/each becomes: \/\/ cm:edge/.test(out),
      `got:\n${out}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

export function newTemplateCases(pluginRoot, check) {
  tallyCases(check);
  cliCases(pluginRoot, check);
  onboardCases(pluginRoot, check);
}
