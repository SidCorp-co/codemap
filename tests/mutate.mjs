#!/usr/bin/env node
// Mutation harness. Opt-in, never part of the gate: each row is a full corpus run (~42 s here).
//
// cm:edge contract -> tests/run.mjs — this parses that runner's stdout count line
//   ("codemap golden corpus: N passed, M failed") and its stderr "  FAIL <case>" lines. Change either
//   shape and every row here turns into CRASH rather than reporting the mechanism (ISS-30)

import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CORPUS_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_BUFFER = 64 * 1024 * 1024;
const CASES_SHOWN = 6;
// cm:guard deep enough to carry a node stack trace: a CRASH row is useless without the throw that
//   caused it, and a four-line tail printed only the trailing brace of the error object (ISS-30)
const STDERR_TAIL_LINES = 30;

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

function git(args) {
  return execFileSync('git', ['-C', ROOT, ...args], { encoding: 'utf8', maxBuffer: MAX_BUFFER }).trim();
}

function listFiles(...selectors) {
  return execFileSync('git', ['-C', ROOT, 'ls-files', '-z', ...selectors],
    { encoding: 'utf8', maxBuffer: MAX_BUFFER })
    .split('\0')
    .filter(Boolean);
}

// cm:why the copy is taken from the WORKING TREE, not from `git archive HEAD`: the case this harness
//   exists for is a mechanism somebody just wrote and has not committed. The head and the dirty flag
//   are printed instead, so a table whose control cannot be reproduced from a commit says so (ISS-30)
// cm:edge contract -> tests/install.mjs — that case asks git for this repository's TRACKED set and
//   holds a guard that it must never read the working tree instead (ISS-29). So the copy re-stages
//   exactly what was cached here and leaves the rest untracked: `git add -A` in the copy would
//   promote a scratch file to tracked and make that case fail on a file the repo does not own
function copyTree(dest) {
  // cm:guard `--others --exclude-standard` is not optional: a mechanism in a file that is written but
  //   not yet `git add`ed is the commonest thing this harness is pointed at, and a cached-only copy
  //   would leave it out of the tree and report ANCHOR for a site that is right there (ISS-30)
  const cached = listFiles('--cached');
  const untracked = listFiles('--others', '--exclude-standard');
  const copied = [];
  for (const rel of [...cached, ...untracked]) {
    const from = join(ROOT, rel);
    if (!existsSync(from)) continue;
    const to = join(dest, rel);
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(from, to);
    copied.push(rel);
  }

  const copiedSet = new Set(copied);
  return cached.filter((rel) => copiedSet.has(rel));
}

// cm:guard the copy has to be a real repository, not just files, and it needs one COMMIT: tests/
//   install.mjs runs `git ls-files` against the root with no fallback, and tests/upgrade-workflow.mjs
//   does `git clone` of it and installs from HEAD. Without an index the corpus throws and every row
//   reads CRASH; without a commit those two clone cases fail and void the control (ISS-30)
// cm:edge ordering -> tests/upgrade-workflow.mjs — this MUST run after the mutation is written, never
//   before. That case reads the CLONED tree, so committing first would leave it testing unmutated
//   code and report a mechanism as dead on evidence that never contained the mutation (ISS-30)
function initRepo(dest, staged) {
  const id = ['-c', 'user.email=mutate@codemap.invalid', '-c', 'user.name=codemap mutation harness'];
  execFileSync('git', ['-C', dest, 'init', '-q'], { encoding: 'utf8' });
  for (let i = 0; i < staged.length; i += 500) {
    execFileSync('git', ['-C', dest, 'add', '--', ...staged.slice(i, i + 500)], { encoding: 'utf8' });
  }
  execFileSync('git', ['-C', dest, ...id, 'commit', '-q', '--allow-empty', '-m', 'mutation harness working copy'],
    { encoding: 'utf8' });
}

function runCorpus(dir) {
  const res = spawnSync(process.execPath, [join(dir, 'tests', 'run.mjs')], {
    cwd: dir,
    encoding: 'utf8',
    timeout: CORPUS_TIMEOUT_MS,
    maxBuffer: MAX_BUFFER,
  });
  const count = /^codemap golden corpus: (\d+) passed, (\d+) failed$/m.exec(res.stdout ?? '');
  const cases = [...(res.stderr ?? '').matchAll(/^\s*FAIL (.+)$/gm)].map((m) => m[1].trim());
  return {
    ran: Boolean(count),
    passed: count ? Number(count[1]) : null,
    failed: count ? Number(count[2]) : null,
    cases,
    status: res.status,
    stderrTail: [res.error ? `spawn: ${res.error.code ?? res.error.message}` : '',
      (res.stderr ?? '').trim()].filter(Boolean).join('\n').split('\n').slice(-STDERR_TAIL_LINES).join('\n'),
  };
}

// cm:guard a corpus run that printed no count line is CRASH, never `pinned`. A mutation that makes the
//   runner throw exits non-zero with no failing case, so anything keying off the exit status alone
//   reads a crash as proof the mechanism is load-bearing — the trap that hid a case in ISS-26 (ISS-30)
export function classify(result) {
  if (!result.ran) return 'CRASH';
  return result.failed > 0 ? 'pinned' : 'DEAD';
}

function inCopy(mutate) {
  const dir = mkdtempSync(join(tmpdir(), 'cm-mutate-'));
  try {
    const staged = copyTree(dir);
    const anchor = mutate ? applyMutation(dir, mutate) : null;
    if (anchor) return { anchor };
    initRepo(dir, staged);
    return { result: runCorpus(dir) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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

function caseList(cases) {
  if (cases.length === 0) return '—';
  const shown = cases.slice(0, CASES_SHOWN).join(', ');
  return cases.length > CASES_SHOWN ? `${shown}, +${cases.length - CASES_SHOWN} more` : shown;
}

function table(rows) {
  const head = ['mutation', 'passed / failed', 'outcome', 'cases'];
  const body = rows.map((r) => [r.id, r.counts, r.outcome, r.cases]);
  const widths = head.map((h, i) => Math.max(h.length, ...body.map((b) => b[i].length)));
  const line = (cells) => `| ${cells.map((c, i) => c.padEnd(widths[i])).join(' | ')} |`;
  return [line(head), `|${widths.map((w) => '-'.repeat(w + 2)).join('|')}|`, ...body.map(line)].join('\n');
}

function usage() {
  console.log(`Usage: node tests/mutate.mjs [--only <id>]... [--list]

Runs the golden corpus once per declared mutation point, plus one unmutated control, and prints
which golden cases pin each mechanism. Opt-in: about ${MUTATIONS.length + 1} full corpus runs.

  --only <id>   run just this mutation point; repeatable
  --list        print the declared points and run nothing
  --help        this text

Outcomes: pinned (cases failed, and they are named) · DEAD (nothing failed — the mechanism is not
pinned) · CRASH (no count line; the runner broke, which is not proof) · ANCHOR (the point no longer
names one site in the source).`);
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

  const head = git(['rev-parse', '--short', 'HEAD']);
  const dirty = git(['status', '--porcelain']) !== '';
  console.log(`measuring ${head}${dirty ? ' plus uncommitted changes — this control is NOT reproducible from that commit alone' : ''}`);
  console.log(`up to ${selected.length + 1} corpus runs, one at a time — an ANCHOR row costs none\n`);

  const rows = [];
  let bad = 0;

  const control = inCopy(null).result;
  const controlClean = control.ran && control.failed === 0;
  rows.push({
    id: 'control, unmutated',
    counts: control.ran ? `${control.passed} / ${control.failed}` : '— / —',
    outcome: controlClean ? 'clean' : 'CONTAMINATED',
    cases: control.ran ? caseList(control.cases) : 'no count line',
  });

  // cm:guard the control gates the whole table: with a control that is not clean, a mutation whose
  //   cases fail cannot be told from a tree that was already failing, so no verdict is printed at all
  //   rather than printing rows that read as findings (ISS-30)
  if (!controlClean) {
    console.log(table(rows));
    console.error('\ncontrol did not come back clean, so every mutation row would be unreadable.');
    if (!control.ran) console.error(`the control run printed no count line:\n${control.stderrTail}`);
    else console.error(`already failing without any mutation: ${caseList(control.cases)}`);
    return 1;
  }

  for (const m of selected) {
    const { anchor, result } = inCopy(m);
    if (anchor) {
      rows.push({ id: m.id, counts: '— / —', outcome: 'ANCHOR', cases: anchor });
      bad++;
      continue;
    }
    const outcome = classify(result);
    if (outcome !== 'pinned') bad++;
    rows.push({
      id: m.id,
      counts: result.ran ? `${result.passed} / ${result.failed}` : '— / —',
      outcome,
      cases: outcome === 'CRASH' ? 'no count line' : caseList(result.cases),
    });
  }

  console.log(table(rows));

  if (bad) {
    console.error(`\n${bad} of ${selected.length} declared mutation point(s) did not report a pinning case.`);
    console.error('DEAD: remove the mechanism, or add the golden case that pins it.');
    console.error('CRASH: the mutation broke the runner rather than failing a case — mutate it differently.');
    console.error('ANCHOR: the source moved; re-point it at the site it means.');
    return 1;
  }
  console.error(`\nall ${selected.length} declared mechanism(s) are pinned by a golden case.`);
  return 0;
}

// cm:guard the entry point stays behind this check so the declared list can be imported without
//   running the whole corpus once per point as a side effect of the import (ISS-30)
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
