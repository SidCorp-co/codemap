#!/usr/bin/env node
// Mutation harness. Opt-in, never part of the gate: every row is a full corpus run.
//
// cm:edge contract -> tests/run.mjs — parses that runner's stdout count line
//   ("codemap golden corpus: N passed, M failed") and its stderr "  FAIL <name>" lines, which fail
//   two different ways if either shape changes: losing the COUNT line turns every row into CRASH,
//   which is loud, but losing the FAIL line leaves every row still reading `pinned` with an empty
//   names column, which is silent and is the ISS-26 trap restored (ISS-30)

import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CORPUS_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_BUFFER = 64 * 1024 * 1024;
const STDERR_TAIL_LINES = 30;

// cm:guard every `find` must occur EXACTLY once in its file, and is checked before anything is
//   mutated. A line number would rot silently as the code moves; a string that no longer matches is
//   reported as ANCHOR, which is the whole reason a stale point cannot read as a dead mechanism (ISS-30)
// cm:guard a `file` is joined onto the copy's root unchecked, so a point declaring an absolute path
//   or a `..` segment would write outside the throwaway tree. Nothing here takes a path from the
//   command line; keep it that way, or resolve and check it stays inside the copy first (ISS-30)
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

// cm:guard git reads GIT_DIR, GIT_WORK_TREE and GIT_INDEX_FILE in PREFERENCE to `-C`, so with any of
//   them exported every call below would act on that repository instead of the copy: `init` creates
//   nothing and `add`/`commit` land the MUTATION as a commit in the outer checkout. `git bisect run`,
//   `git rebase --exec` and every git hook export them, so this is not hypothetical (ISS-30)
export const GIT_ENV = (() => {
  const env = { ...process.env };
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY',
    'GIT_COMMON_DIR', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_CONFIG', 'GIT_CONFIG_GLOBAL']) {
    delete env[k];
  }
  return env;
})();

function git(cwd, args) {
  return execFileSync('git', ['-C', cwd, ...args],
    { encoding: 'utf8', maxBuffer: MAX_BUFFER, env: GIT_ENV }).trim();
}

function listFiles(...selectors) {
  return git(ROOT, ['ls-files', '-z', ...selectors]).split('\0').filter(Boolean);
}

// cm:why the snapshot is taken from the WORKING TREE, not from `git archive HEAD`: the case this
//   harness exists for is a mechanism somebody has just written and not committed. What that costs is
//   printed instead — the head, and separately whether tracked files are modified or files are merely
//   untracked, which are different claims about reproducing the table (ISS-30)
// cm:guard taken ONCE, before the control, and every row copies from it rather than re-reading the
//   working tree. Re-reading per row made the control and the rows the same table but not the same
//   tree, so an editor saving during the run gave a later row a check name for a mechanism that row
//   never measured — a false `pinned`, which is how this tool can lie into an annotation (ISS-30)
function snapshot() {
  const dir = mkdtempSync(join(tmpdir(), 'cm-mutate-base-'));
  const cached = listFiles('--cached');
  // cm:guard `--others --exclude-standard` is not optional: a mechanism in a file that is written but
  //   not yet `git add`ed is the commonest thing this harness is pointed at, and a cached-only copy
  //   would leave it out of the tree and report ANCHOR for a site that is right there (ISS-30)
  const untracked = listFiles('--others', '--exclude-standard');
  const copied = [];
  for (const rel of [...cached, ...untracked]) {
    const from = join(ROOT, rel);
    if (!existsSync(from)) continue;
    const to = join(dir, rel);
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(from, to);
    copied.push(rel);
  }
  const present = new Set(copied);
  return {
    dir,
    files: copied,
    // cm:edge contract -> tests/install.mjs — that case asks git for this repository's TRACKED set and
    //   holds a guard that it must never read the working tree instead (ISS-29). So the copy stages
    //   exactly what was cached here and leaves the rest untracked: `git add -A` would promote a
    //   scratch file to tracked and fail that case on a file the repository does not own
    staged: cached.filter((rel) => present.has(rel)),
    // cm:edge contract -> tests/release-tag.mjs — that case disables itself when `git tag -l
    //   codemap-v*` comes back empty, so a copy with no tags ran 653 of the checkout's 654 checks and
    //   reported the version/tag coupling ISS-5 exists for as DEAD. The tag NAMES are carried onto the
    //   copy's single commit, because existence under that glob is the whole of what it reads (ISS-30)
    tags: git(ROOT, ['tag', '-l', 'codemap-v*']).split('\n').filter(Boolean),
  };
}

function copyFrom(base, dest) {
  for (const rel of base.files) {
    const to = join(dest, rel);
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(join(base.dir, rel), to);
  }
}

// cm:edge ordering -> tests/upgrade-workflow.mjs — this MUST run after the mutation is written, never
//   before. That case reads the CLONED tree and installs from its HEAD, so committing first would
//   leave it testing unmutated code and report a mechanism dead on evidence that never held it (ISS-30)
// cm:guard an uncommitted NEW file reaches the copy's worktree but not this commit's tree, so the
//   clone-based tiers see a tree without it. Mutating a file that is not yet `git add`ed is measured
//   by every tier except those, which is the other half of what the banner's tree state means (ISS-30)
function initRepo(dest, base) {
  const id = ['-c', 'user.email=mutate@codemap.invalid', '-c', 'user.name=codemap mutation harness',
    '-c', 'commit.gpgsign=false'];
  git(dest, ['init', '-q']);
  for (let i = 0; i < base.staged.length; i += 500) {
    git(dest, ['add', '--', ...base.staged.slice(i, i + 500)]);
  }
  git(dest, [...id, 'commit', '-q', '--allow-empty', '-m', 'mutation harness working copy']);
  for (const tag of base.tags) git(dest, ['tag', tag]);
}

export function parseCorpusOutput(stdout, stderr, spawnError) {
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
      .filter(Boolean).join('\n').split('\n').slice(-STDERR_TAIL_LINES).join('\n'),
  };
}

function runCorpus(dir) {
  const res = spawnSync(process.execPath, [join(dir, 'tests', 'run.mjs')], {
    cwd: dir,
    encoding: 'utf8',
    timeout: CORPUS_TIMEOUT_MS,
    maxBuffer: MAX_BUFFER,
    env: GIT_ENV,
  });
  return parseCorpusOutput(res.stdout, res.stderr, res.error && (res.error.code ?? res.error.message));
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
  if (controlTotal !== null && controlTotal !== undefined && result.total !== controlTotal) return 'INCONCLUSIVE';
  return 'DEAD';
}

export function applyMutation(dir, m) {
  const path = join(dir, m.file);
  if (!existsSync(path)) return `${m.file} is not in the tree`;
  const src = readFileSync(path, 'utf8');
  const hits = src.split(m.find).length - 1;
  if (hits === 0) return `anchor not found in ${m.file}`;
  if (hits > 1) return `anchor matches ${hits}x in ${m.file}, so it names no single site`;
  writeFileSync(path, src.split(m.find).join(m.replace));
  return null;
}

function inCopy(base, mutate) {
  const dir = mkdtempSync(join(tmpdir(), 'cm-mutate-'));
  try {
    copyFrom(base, dir);
    const anchor = mutate ? applyMutation(dir, mutate) : null;
    if (anchor) return { anchor };
    try {
      initRepo(dir, base);
    } catch (e) {
      // cm:guard a git failure in the copy is one unusable ROW, never an uncaught stack that ends the
      //   table: the rows already measured are the evidence somebody is waiting on (ISS-30)
      return { setup: String(e.stderr || e.message || e).trim().split('\n').slice(-3).join(' ') };
    }
    return { result: runCorpus(dir) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function table(rows) {
  const head = ['mutation', 'passed / failed', 'outcome', 'failing checks'];
  const body = rows.map((r) => [r.id, r.counts, r.outcome, r.detail]);
  const widths = head.map((h, i) => Math.max(h.length, ...body.map((b) => b[i].length)));
  const line = (cells) => `| ${cells.map((c, i) => c.padEnd(widths[i])).join(' | ')} |`;
  return [line(head), `|${widths.map((w) => '-'.repeat(w + 2)).join('|')}|`, ...body.map(line)].join('\n');
}

function usage() {
  console.log(`Usage: node tests/mutate.mjs [--only <id>]... [--list]

Removes each declared mechanism in a throwaway copy of the working tree, runs the whole golden
corpus against it, and names the checks that failed — with an unmutated control in the same table.
Opt-in: one full corpus run per point PLUS one for the control, run one at a time.

  --only <id>   run just this point, with the control; repeatable, and what to use for a new point
  --list        print the declared points and run nothing
  --help        this text

Outcomes:
  pinned        checks failed, and they are named — the mechanism is doing work
  DEAD          nothing failed, on the same number of checks: no case pins it
  INCONCLUSIVE  nothing failed but the corpus ran a different number of checks, so it proved nothing
  CRASH         no count line: the runner broke instead of a check failing, which is not proof either way
  ANCHOR        the point no longer names exactly one site in the source

A name in the last column is one of run.mjs's checks, and one golden case can raise several of them,
so the column is not a count of cases.

It answers for \`node tests/run.mjs\` only. A mechanism pinned by \`bin/cm verify\` instead reads DEAD
here; that gate has to be checked by hand.`);
}

function main(argv) {
  const only = [];
  let list = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--help' || argv[i] === '-h') { usage(); return 0; }
    else if (argv[i] === '--list') list = true;
    else if (argv[i] === '--only') {
      const id = argv[++i];
      if (!id) { console.error('--only needs a mutation id'); return 2; }
      only.push(id);
    } else { console.error(`unknown argument: ${argv[i]}`); usage(); return 2; }
  }

  const unknown = only.filter((id) => !MUTATIONS.some((m) => m.id === id));
  if (unknown.length) {
    console.error(`no such mutation point: ${unknown.join(', ')}`);
    console.error(`declared: ${MUTATIONS.map((m) => m.id).join(', ')}`);
    return 2;
  }
  const selected = only.length ? MUTATIONS.filter((m) => only.includes(m.id)) : MUTATIONS;

  if (list) {
    for (const m of selected) console.log(`${m.id}\n  ${m.file} — ${m.mechanism}`);
    return 0;
  }

  const head = git(ROOT, ['rev-parse', '--short', 'HEAD']);
  const modified = git(ROOT, ['status', '--porcelain', '--untracked-files=no']) !== '';
  const untracked = listFiles('--others', '--exclude-standard').length > 0;
  const state = [modified ? 'modified tracked files' : '', untracked ? 'untracked files' : '']
    .filter(Boolean).join(' and ');
  console.log(`measuring ${head}${state ? ` plus ${state}` : ''}`);
  if (modified) {
    console.log('tracked files differ from that commit, so this table is not reproducible from it alone');
  }
  console.log(`up to ${selected.length + 1} corpus runs, one at a time — an ANCHOR row costs none\n`);

  const base = snapshot();
  const rows = [];
  const crashed = [];
  let bad = 0;

  try {
    const control = inCopy(base, null).result;
    const controlClean = control.ran && control.failed === 0;
    rows.push({
      id: 'control, unmutated',
      counts: control.ran ? `${control.passed} / ${control.failed}` : '— / —',
      outcome: controlClean ? 'clean' : 'CONTAMINATED',
      detail: control.ran ? (control.names.join(', ') || '—') : 'no count line',
    });

    // cm:guard the control gates the whole table: with a control that is not clean, a mutation whose
    //   checks fail cannot be told from a tree that was already failing, so no verdict is printed at
    //   all rather than printing rows that read as findings (ISS-30)
    if (!controlClean) {
      console.log(table(rows));
      console.error('\ncontrol did not come back clean, so every mutation row would be unreadable.');
      console.error(control.ran
        ? `already failing without any mutation: ${control.names.join(', ')}`
        : `the control run printed no count line:\n${control.diagnosis}`);
      return 1;
    }

    for (const m of selected) {
      const { anchor, setup, result } = inCopy(base, m);
      if (anchor || setup) {
        rows.push({
          id: m.id,
          counts: '— / —',
          outcome: anchor ? 'ANCHOR' : 'SETUP',
          detail: anchor ?? `preparing the copy failed: ${setup}`,
        });
        bad++;
        continue;
      }
      const outcome = classify(result, control.total);
      if (outcome !== 'pinned') bad++;
      if (outcome === 'CRASH') crashed.push([m.id, result.diagnosis]);
      rows.push({
        id: m.id,
        counts: result.ran ? `${result.passed} / ${result.failed}` : '— / —',
        outcome,
        detail: outcome === 'CRASH' ? 'no count line'
          : outcome === 'INCONCLUSIVE' ? `ran ${result.total} checks, the control ran ${control.total}`
            : (result.names.join(', ') || '—'),
      });
    }
  } finally {
    rmSync(base.dir, { recursive: true, force: true });
  }

  console.log(table(rows));

  // cm:guard a CRASH row's diagnosis is printed here or it is lost with the temp tree, and a row
  //   saying only "no count line" cannot be acted on — the guard promising this evidence outlived the
  //   code that produced it once already (ISS-30)
  for (const [id, diagnosis] of crashed) {
    console.error(`\n${id} — the corpus did not finish:\n${diagnosis}`);
  }

  if (bad) {
    console.error(`\n${bad} of ${selected.length} declared mutation point(s) did not report a pinning check.`);
    console.error('DEAD: remove the mechanism, or add the golden case that pins it.');
    console.error('INCONCLUSIVE: the mutation changed how many checks ran, so it measured nothing — mutate it more narrowly.');
    console.error('CRASH: the mutation broke the runner rather than failing a check — mutate it differently.');
    console.error('ANCHOR: the source moved; re-point it at the site it means.');
    return 1;
  }
  console.error(`\nall ${selected.length} declared mechanism(s) are pinned by a failing check.`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
