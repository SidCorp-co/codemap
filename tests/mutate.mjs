#!/usr/bin/env node
// Mutation harness, the half that runs things. Opt-in, never part of the gate.
//
// cm:edge contract -> tests/run.mjs — parses its count line and its "  FAIL <name>" lines. Changing
//   the count line makes every row CRASH loudly; changing the FAIL line empties the names (ISS-30)
// cm:edge protocol -> tests/mutate-lib.mjs — the pure half lives there so the corpus can pin it
//   without importing `main`; nothing under tests/ may import THIS file (ISS-30)

import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyMutation, classify, MUTATIONS, NESTED_MARKER, parseCorpusOutput, stripGitEnv,
} from './mutate-lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CORPUS_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_BUFFER = 64 * 1024 * 1024;
const STDERR_TAIL_LINES = 30;

// cm:guard git prefers GIT_DIR and friends to `-C`, so an inherited environment lands the MUTATION
//   as a commit in the outer checkout — `bisect run` and every hook export them (ISS-30)
const GIT_ENV = stripGitEnv(process.env);

// cm:guard the ONLY child git invocation here, so no call can forget the scrub; a second call site
//   is how that defence would quietly come undone, and the corpus asserts the count (ISS-30)
function git(cwd, args) {
  return execFileSync('git', ['-C', cwd, ...args],
    { encoding: 'utf8', maxBuffer: MAX_BUFFER, env: GIT_ENV, stdio: ['ignore', 'pipe', 'pipe'] })
    .trim();
}

function listFiles(...selectors) {
  return git(ROOT, ['ls-files', '-z', ...selectors]).split('\0').filter(Boolean);
}

// cm:why the snapshot comes from the WORKING TREE, not `git archive HEAD`: the mechanism this is
//   pointed at is usually uncommitted, so the banner names the tree state instead (ISS-30)
// cm:guard taken ONCE, before the control, and every row copies from it: re-reading per row let a
//   save mid-run give a later row a false `pinned` the control could not catch (ISS-30)
function snapshot() {
  const dir = mkdtempSync(join(tmpdir(), 'cm-mutate-base-'));
  const cached = listFiles('--cached');
  // cm:guard `--others --exclude-standard` is not optional: a mechanism written but not yet added is
  //   the commonest case here, and a cached-only copy reports ANCHOR for a site that exists (ISS-30)
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
    // cm:edge contract -> tests/install.mjs — that case reads the TRACKED set and is guarded against
    //   reading the working tree (ISS-29), so `git add -A` here would fail it on a scratch file
    staged: cached.filter((rel) => present.has(rel)),
    // cm:edge contract -> tests/release-tag.mjs — that case disables itself with no `codemap-v*` tag,
    //   so a copy without the tag names runs fewer checks and reads the coupling as DEAD (ISS-30)
    // cm:why the tag NAMES alone are carried onto the copy's own commit, not real history, because
    //   existence under that glob is the whole of what the case reads (ISS-30)
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

// cm:edge ordering -> tests/upgrade-workflow.mjs — must run AFTER the mutation is written: that case
//   clones the copy and installs from HEAD, so committing first measures unmutated code (ISS-30)
// cm:guard an uncommitted NEW file reaches the copy's worktree but not this commit, so the
//   clone-based tiers alone do not measure a mutation to a file that is not yet added (ISS-30)
function initRepo(dest, base) {
  const id = ['-c', 'user.email=mutate@codemap.invalid', '-c', 'user.name=codemap mutation harness',
    '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=', '-c', 'init.templateDir='];
  git(dest, ['init', '-q']);
  for (let i = 0; i < base.staged.length; i += 500) {
    git(dest, ['add', '--', ...base.staged.slice(i, i + 500)]);
  }
  git(dest, [...id, 'commit', '-q', '--allow-empty', '-m', 'mutation harness working copy']);
  for (const tag of base.tags) git(dest, ['tag', tag]);
}

function runCorpus(dir) {
  const res = spawnSync(process.execPath, [join(dir, 'tests', 'run.mjs')], {
    cwd: dir,
    encoding: 'utf8',
    timeout: CORPUS_TIMEOUT_MS,
    maxBuffer: MAX_BUFFER,
    // cm:edge protocol -> tests/mutate-lib.mjs — the marker main refuses on, so a copy that reaches
    //   main from its own corpus stops at one refusal instead of a harness per run (ISS-30)
    env: { ...GIT_ENV, [NESTED_MARKER]: '1' },
  });
  return parseCorpusOutput(res.stdout, res.stderr,
    res.error && (res.error.code ?? res.error.message), STDERR_TAIL_LINES);
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
      // cm:guard a git failure in the copy is one unusable ROW, never an uncaught stack: the rows
      //   already measured are the evidence, and the control hits this first of all (ISS-30)
      // cm:guard the FIRST lines of git's stderr, not the last: git prints `error: …` first and a
      //   usage dump after it, so a tail kept the flag list and threw away the reason (ISS-30)
      return { setup: String(e.stderr || e.message || e).trim().split('\n').slice(0, 3).join(' ') };
    }
    return { result: runCorpus(dir) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function table(rows) {
  const head = ['mutation', 'passed / failed', 'outcome'];
  const body = rows.map((r) => [r.id, r.counts, r.outcome]);
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
  SETUP         the copy could not be prepared, so the row measured nothing

The names printed under the table are run.mjs CHECKS, and one golden case usually raises several of
them, so their number is not a number of cases.

It answers for \`node tests/run.mjs\` only. A mechanism pinned by \`bin/cm verify\` instead reads DEAD
here; that gate has to be checked by hand.`);
}

function main(argv) {
  // cm:guard refuse INSIDE a copy's corpus, before any argument is read: this is the only bound on
  //   a copy that reaches main from the corpus it runs, and the recursion is unbounded (ISS-30)
  if (process.env[NESTED_MARKER]) {
    console.error(`${NESTED_MARKER} is set, so this is a corpus run inside a mutation copy`);
    console.error('the harness refuses to measure from inside itself: each level spawns another');
    return 2;
  }
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
  // cm:guard `--no-optional-locks` so reading the tree state writes NOTHING here: a plain `git
  //   status` rewrites .git/index with a stat-cache refresh, the one write this would make (ISS-30)
  // cm:guard modified tracked files and merely untracked ones are reported SEPARATELY: only the
  //   first makes the table irreproducible from the named commit, so only it warns (ISS-30)
  const modified = git(ROOT, ['--no-optional-locks', 'status', '--porcelain', '--untracked-files=no']) !== '';
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
  const notes = [];
  let bad = 0;

  try {
    const control = inCopy(base, null);
    // cm:guard the control's own setup failure is a first-class outcome: reading `.result` off it
    //   unconditionally turned a refusing pre-commit hook into a TypeError (ISS-30)
    if (control.setup) {
      console.error(`the control's copy could not be prepared, so nothing could be measured:\n  ${control.setup}`);
      return 1;
    }
    const c = control.result;
    const controlClean = c.ran && c.failed === 0;
    rows.push({
      id: 'control, unmutated',
      counts: c.ran ? `${c.passed} / ${c.failed}` : '— / —',
      outcome: controlClean ? 'clean' : 'CONTAMINATED',
    });

    // cm:guard the control gates the whole table: against an unclean control a failing row cannot be
    //   told from a tree already failing, so no verdict is printed rather than a false finding (ISS-30)
    if (!controlClean) {
      console.log(table(rows));
      console.error('\ncontrol did not come back clean, so every mutation row would be unreadable.');
      console.error(c.ran
        ? `already failing without any mutation: ${c.names.join(', ')}`
        : `the control run printed no count line:\n${c.diagnosis}`);
      return 1;
    }

    // cm:guard the control's CHECK TOTAL is printed because nothing here knows the checkout's own: a
    //   copy quietly running fewer checks makes every DEAD meaningless, and this is the signal (ISS-30)
    console.log(`control ran ${c.total} checks — compare it against \`node tests/run.mjs\` before trusting a DEAD row\n`);

    for (const m of selected) {
      const { anchor, setup, result } = inCopy(base, m);
      if (anchor || setup) {
        rows.push({ id: m.id, counts: '— / —', outcome: anchor ? 'ANCHOR' : 'SETUP' });
        notes.push([m.id, anchor ?? `preparing the copy failed: ${setup}`]);
        bad++;
        continue;
      }
      const outcome = classify(result, c.total);
      if (outcome !== 'pinned') bad++;
      rows.push({
        id: m.id,
        counts: result.ran ? `${result.passed} / ${result.failed}` : '— / —',
        outcome,
      });
      if (outcome === 'CRASH') notes.push([m.id, `the corpus did not finish:\n${result.diagnosis}`]);
      else if (outcome === 'INCONCLUSIVE') {
        notes.push([m.id, `ran ${result.total} checks where the control ran ${c.total}, so it measured nothing`]);
      } else if (result.names.length) notes.push([m.id, result.names.join('\n  ')]);
    }
  } finally {
    rmSync(base.dir, { recursive: true, force: true });
  }

  console.log(table(rows));

  // cm:guard printed under the table, never in a cell: this list is what a contributor copies into
  //   an annotation, so it must be complete, and one long row padded every other row (ISS-30)
  for (const [id, note] of notes) console.log(`\n${id}:\n  ${note}`);

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
