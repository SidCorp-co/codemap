// CLI tier. Every flag that takes a value used to have that value parsed as a positional path, so
// `cm verify --since <ref>` and `--tier grammar` narrowed the scan to zero files and reported a clean
// tree — the exact shape the README tells CI to run. Nothing in the corpus could see it: these cases
// drive the real argv through a real temp repo instead.

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const FROZEN = 'this legacy line is frozen by the baseline';
const GONE = 'this legacy line will be deleted';

function git(root, ...args) {
  execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_NAME: 'cm', GIT_AUTHOR_EMAIL: 'cm@test',
      GIT_COMMITTER_NAME: 'cm', GIT_COMMITTER_EMAIL: 'cm@test' },
  });
}

function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), 'cm-cli-'));
  mkdirSync(join(root, '.forge'));
  writeFileSync(join(root, '.forge', 'codemap.json'), '{}\n');
  writeFileSync(join(root, 'legacy.ts'), `// ${FROZEN}\n// ${GONE}\nexport const a = 1;\n`);
  writeFileSync(join(root, 'other.ts'), 'export const b = 2;\n');
  git(root, 'init', '-q');
  git(root, 'add', '-A');
  git(root, 'commit', '-qm', 'seed');
  return root;
}

function cm(pluginRoot, root, ...args) {
  const res = spawnSync(process.execPath, [join(pluginRoot, 'scripts', 'cm.mjs'), ...args], {
    cwd: root, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' },
  });
  return { ...res, out: `${res.stdout}${res.stderr}` };
}

function fileCount(out) {
  return Number(/·\s+(\d+)\s+files/.exec(out)?.[1] ?? -1);
}

// cm:why exit 2 is "could not run", exit 1 is "ran and failed" — every case below used to be exit 0 over an
// empty scope, or a stack trace under exit 1, which is four ways for CI to pass over a tree nobody checked
function failOpenCases(pluginRoot, check, roots) {
  const root = makeRepo();
  roots.push(root);
  writeFileSync(join(root, 'broken.ts'), '// cm:edge bogus -> nope.ts — unknown kind\nexport const x = 1;\n');
  cm(pluginRoot, root, 'baseline');

  const real = cm(pluginRoot, root, 'verify');
  check('cli: a real violation is exit 1', real.status === 1 && /CM004/.test(real.out),
    `expected exit 1 with CM004, got ${real.status}\n${real.out}`);

  const cases = [
    { name: 'a mistyped --tier cannot be a green gate', args: ['verify', '--tier=grammer'], want: /unknown --tier/ },
    { name: 'an unresolvable --since ref is not an empty scope', args: ['verify', '--since', 'no-such-ref'], want: /cannot resolve --since/ },
    { name: 'a path that matches nothing is not a clean tree', args: ['verify', 'src/nope.ts'], want: /no such path/ },
    { name: 'a value flag swallowing the next flag is caught', args: ['verify', '--since', '--json'], want: /--since needs a value/ },
    { name: 'a non-numeric --limit is caught', args: ['sweep', '--limit', 'abc'], want: /--limit needs a number/ },
    { name: '--since and --staged cannot combine', args: ['verify', '--since', 'HEAD', '--staged'], want: /mutually exclusive/ },
  ];
  for (const c of cases) {
    const r = cm(pluginRoot, root, ...c.args);
    check(`cli: ${c.name}`, r.status === 2 && c.want.test(r.out),
      `expected exit 2 matching ${c.want}, got ${r.status}\n${r.out}`);
    check(`cli: ${c.name} (no stack trace)`, !/\bat \w+ \(/.test(r.out) && !/node:internal/.test(r.out),
      `a raw stack trace is not a diagnostic:\n${r.out}`);
  }

  for (const tier of ['all', 'grammar', 'referential', 'structural']) {
    const r = cm(pluginRoot, root, 'verify', '--tier', tier);
    check(`cli: --tier ${tier} is accepted`, r.status !== 2, `exit 2 for a valid tier:\n${r.out}`);
  }

  const all = fileCount(cm(pluginRoot, root, 'verify').out);
  for (const p of ['.', './']) {
    const r = cm(pluginRoot, root, 'verify', p);
    check(`cli: "${p}" means the whole tree, not an empty scope`, fileCount(r.out) === all,
      `expected ${all} files, got ${fileCount(r.out)} — an unnormalized prefix matched nothing\n${r.out}`);
  }
  const sub = cm(pluginRoot, root, 'verify', './broken.ts');
  check('cli: a ./-prefixed file still scopes to that file', fileCount(sub.out) === 1 && sub.status === 1,
    `expected 1 file and exit 1, got ${fileCount(sub.out)}/${sub.status}\n${sub.out}`);

  const staged = cm(pluginRoot, root, 'verify', '--staged');
  check('cli: --staged gates only what is staged', staged.status === 0 && fileCount(staged.out) === 0,
    `nothing is staged, so the scope is empty and clean; got ${staged.status}\n${staged.out}`);
  git(root, 'add', 'broken.ts');
  const stagedDirty = cm(pluginRoot, root, 'verify', '--staged');
  check('cli: --staged sees a staged violation', stagedDirty.status === 1 && /CM004/.test(stagedDirty.out),
    `expected exit 1 with CM004, got ${stagedDirty.status}\n${stagedDirty.out}`);
}

// cm:why fmt re-found the annotation by regex and counted the fix either way, so on a CRLF file it claimed
// a rewrite, wrote the file back unchanged, and left a CM009 whose own fix line was "run cm fmt"
function rewriteCases(pluginRoot, check, roots) {
  const root = makeRepo();
  roots.push(root);
  const crlf = join(root, 'crlf.ts');
  writeFileSync(crlf, '// cm:edge contract->b.ts - two spaces and a dash\r\nexport const b = 2;\r\n');
  writeFileSync(join(root, 'b.ts'), 'export const b2 = 2;\r\n');
  cm(pluginRoot, root, 'baseline');

  const fmt = cm(pluginRoot, root, 'fmt', 'crlf.ts');
  const after = readFileSync(crlf, 'utf8');
  check('cli: fmt normalizes an annotation on a CRLF line',
    after.startsWith('// cm:edge contract -> b.ts — two spaces and a dash'),
    `fmt said "${fmt.out.trim()}" and the line is now: ${JSON.stringify(after.split('\n')[0])}`);
  check('cli: fmt preserves the CRLF ending it rewrote',
    after.split('\n').slice(0, 2).every((l) => l.endsWith('\r')),
    `the file's line endings must not become mixed: ${JSON.stringify(after)}`);
  const reverify = cm(pluginRoot, root, 'verify', 'crlf.ts');
  check('cli: CM009 is gone after fmt, not reported as fixed while surviving',
    reverify.status === 0 && !/CM009/.test(reverify.out),
    `verify after fmt:\n${reverify.out}`);

  writeFileSync(crlf, '// cm:edge contract->b.ts - again\r\nexport const b = 2;\r\n');
  const fixed = cm(pluginRoot, root, 'verify', '--fix', 'crlf.ts');
  check('cli: verify --fix normalizes and then reports clean in one pass',
    fixed.status === 0 && /1 annotation normalized/.test(fixed.out),
    `verify --fix said:\n${fixed.out}`);
}

// cm:why the baseline is content-addressed, so "not in the file's prose keys" means "gone" — and counting
// sited prose as gone quietly unfroze the untouched neighbours of every block anyone annotated
function baselineLifecycleCases(pluginRoot, check, roots) {
  const root = makeRepo();
  roots.push(root);
  const file = join(root, 'legacy.ts');
  const both = `// ${FROZEN}\n// ${GONE}\n`;
  writeFileSync(file, `${both}export const a = 1;\n`);
  cm(pluginRoot, root, 'baseline');

  writeFileSync(file, `${both}// cm:guard callers must hold the run lock\nexport const a = 1;\n`);
  const annotated = cm(pluginRoot, root, 'verify');
  check('cli: annotating a block reports its prose without calling the debt paid',
    annotated.status === 1 && /legacy prose: 2 distinct still frozen · 0 cleaned/.test(annotated.out),
    `sited prose is reported AND still frozen debt; got:\n${annotated.out}`);

  const prune = cm(pluginRoot, root, 'sweep', '--prune-baseline');
  check('cli: prune keeps a key whose comment is only sited, not gone',
    /dropped 0 stale key\(s\); 2 remain frozen/.test(prune.out),
    `prune must not absolve prose that is still in the file:\n${prune.out}`);

  writeFileSync(file, `${both}export const a = 1;\n`);
  const unannotated = cm(pluginRoot, root, 'verify');
  check('cli: removing the annotation leaves the legacy prose frozen again',
    unannotated.status === 0 && !/CM001/.test(unannotated.out),
    `prose nobody edited must not become a permanent violation:\n${unannotated.out}`);

  writeFileSync(file, `// ${FROZEN}\nexport const a = 1;\n`);
  const deleted = cm(pluginRoot, root, 'verify');
  check('cli: a genuinely deleted comment still counts as cleaned',
    /1 distinct still frozen · 1 cleaned/.test(deleted.out),
    `deleting legacy prose is what pays the debt down:\n${deleted.out}`);
}

// cm:why the fix for ISS-3 attached the wrap positionally, so a legacy comment sitting under a newly added
//   annotation was adopted into it and injected as part of a guard — with no diagnostic (ISS-22)
function adoptionCases(pluginRoot, check, roots) {
  const root = makeRepo();
  roots.push(root);
  const legacy = '// Build the payload for the downstream call';
  const file = join(root, 'adopt.ts');
  writeFileSync(file, `export function f() {\n  ${legacy}\n  return 1;\n}\n`);
  cm(pluginRoot, root, 'baseline');

  writeFileSync(file,
    'export function f() {\n'
    + '  // cm:guard the payload shape must match the downstream validator\n'
    + `  ${legacy}\n`
    + '  return 1;\n}\n');

  const json = cm(pluginRoot, root, 'impact', 'adopt.ts', '--json');
  let guard = null;
  try { guard = JSON.parse(json.out).guards?.[0]; } catch { guard = null; }
  check('cli: a FROZEN line under an annotation is not adopted as its wrap',
    Boolean(guard) && guard.text === 'the payload shape must match the downstream validator',
    `the hook must not be handed a fused invariant; got: ${JSON.stringify(guard?.text)}`);

  const verify = cm(pluginRoot, root, 'verify', 'adopt.ts');
  check('cli: the rejected line is reported as sited prose, not silently swallowed',
    verify.status === 1 && /CM001/.test(verify.out) && /Build the payload/.test(verify.out),
    `the author must be told the prose is still there:\n${verify.out}`);

  writeFileSync(file,
    'export function f() {\n'
    + '  // cm:guard the payload shape must match the downstream validator, since the\n'
    + '  // validator rejects an unknown key rather than ignoring it\n'
    + '  return 1;\n}\n');
  const real = cm(pluginRoot, root, 'impact', 'adopt.ts', '--json');
  let ok = null;
  try { ok = JSON.parse(real.out).guards?.[0]; } catch { ok = null; }
  check('cli: a wrap the author actually wrote is still carried whole',
    Boolean(ok) && ok.text.includes('rejects an unknown key'),
    `ISS-3 must not regress while fixing ISS-22; got: ${JSON.stringify(ok?.text)}`);
}

// cm:why the wrap is the hook's payload, and the hook reads `impact --json` from whatever cm the repo has
// installed — so the join has to be asserted through the real CLI, not just through analyzeFile (ISS-3)
function wrapCases(pluginRoot, check, roots) {
  const root = makeRepo();
  roots.push(root);
  const src = '// cm:guard the run lock is held for the whole batch, never per row —\n'
    + '// releasing between rows lets a second dispatcher claim the tail of this one\n'
    + 'export const f = 1;\n';
  writeFileSync(join(root, 'wrapped.ts'), src);
  cm(pluginRoot, root, 'baseline');

  const clean = cm(pluginRoot, root, 'verify', 'wrapped.ts');
  check('cli: a wrapped annotation is not CM009 and not CM001',
    clean.status === 0 && !/CM0/.test(clean.out),
    `a wrapped annotation must verify clean:\n${clean.out}`);

  const fmt = cm(pluginRoot, root, 'fmt');
  check('cli: cm fmt leaves a wrapped annotation byte-identical',
    readFileSync(join(root, 'wrapped.ts'), 'utf8') === src,
    `cm fmt rewrote across lines — the wrap was joined before canonical():\n${fmt.out}`);

  const tail = 'releasing between rows lets a second dispatcher claim the tail of this one';
  const text = cm(pluginRoot, root, 'impact', 'wrapped.ts');
  check('cli: cm impact prints the wrap, not half a guard', text.out.includes(tail),
    `impact dropped the second half:\n${text.out}`);

  const json = cm(pluginRoot, root, 'impact', 'wrapped.ts', '--json');
  let guard = null;
  try { guard = JSON.parse(json.out).guards?.[0]; } catch { guard = null; }
  check('cli: impact --json carries the whole sentence in text',
    Boolean(guard) && guard.text.includes(tail) && guard.wrap === undefined,
    `the hook reads this payload; got: ${JSON.stringify(guard)}`);

  writeFileSync(join(root, 'malformed.ts'),
    '// cm:edge lockstep -> wrapped.ts writes these refs; the\n'
    + '// provenance gate allows them through via this predicate\n'
    + 'export const g = 1;\n');
  const one = cm(pluginRoot, root, 'verify', 'malformed.ts');
  check('cli: a forgotten em-dash is one diagnostic, and it names the em-dash',
    one.status === 1 && /CM012/.test(one.out) && !/CM001/.test(one.out) && /1 error,/.test(one.out),
    `expected a single CM012 naming " — ", got:\n${one.out}`);
}

// cm:guard the migration is cm fmt's and the hook must never inherit it — `verify --fix` is what the
//   post-edit hook runs, and a target rewritten under an agent is content changed behind its back (ISS-5)
function targetCases(pluginRoot, check, roots) {
  const root = makeRepo();
  roots.push(root);
  mkdirSync(join(root, 'apps', 'web', 'src'), { recursive: true });
  mkdirSync(join(root, 'apps', 'api', 'src'), { recursive: true });
  writeFileSync(join(root, 'apps', 'api', 'src', 'thing.ts'), 'export function saveThing() { return 1; }\n');
  const page = join(root, 'apps', 'web', 'src', 'page.ts');
  const rel = '// cm:edge contract -> ../../api/src/thing.ts — the sibling app owns the write path\n'
    + 'export const p = 1;\n';
  writeFileSync(page, rel);
  cm(pluginRoot, root, 'baseline');

  const grammar = cm(pluginRoot, root, 'verify', '--tier', 'grammar');
  check('cli: a source-relative target fails the GRAMMAR tier, where the hook runs',
    grammar.status === 1 && /CM005/.test(grammar.out) && !/CM102/.test(grammar.out),
    `expected CM005 at grammar tier, got:\n${grammar.out}`);

  const hookPass = cm(pluginRoot, root, 'verify', '--fix', 'apps/web/src/page.ts');
  check('cli: verify --fix leaves the target alone — it normalizes form, not content',
    readFileSync(page, 'utf8') === rel && /CM005/.test(hookPass.out),
    `verify --fix rewrote a target; the hook must never do that:\n${hookPass.out}`);

  const fmt = cm(pluginRoot, root, 'fmt');
  check('cli: cm fmt resolves a ../ target that exists',
    readFileSync(page, 'utf8').includes('-> apps/api/src/thing.ts —')
    && /1 relative target resolved/.test(fmt.out),
    `cm fmt said:\n${fmt.out}\nfile:\n${readFileSync(page, 'utf8')}`);

  const after = cm(pluginRoot, root, 'verify');
  check('cli: the migrated edge verifies clean', after.status === 0 && !/CM00|CM10/.test(after.out),
    `after fmt:\n${after.out}`);

  // cm:why an anchored ../ target is the COMMON case in the field, and resolving the #symbol as part of
  // the path made existsSync fail on every one of them — the migration silently did nothing (ISS-5)
  writeFileSync(join(root, 'apps', 'web', 'src', 'anchored.ts'),
    '// cm:edge contract -> ../../api/src/thing.ts#saveThing — the sibling app owns the writer\n'
    + 'export const r = 1;\n');
  const fmtAnchor = cm(pluginRoot, root, 'fmt');
  check('cli: cm fmt resolves a ../ target that carries a #symbol, anchor intact',
    readFileSync(join(root, 'apps', 'web', 'src', 'anchored.ts'), 'utf8')
      .includes('-> apps/api/src/thing.ts#saveThing —'),
    `the anchor must survive the rewrite:\n${fmtAnchor.out}\n${readFileSync(join(root, 'apps', 'web', 'src', 'anchored.ts'), 'utf8')}`);
  const anchorClean = cm(pluginRoot, root, 'verify', 'apps/web/src/anchored.ts');
  check('cli: the migrated anchored edge passes both tiers',
    anchorClean.status === 0 && !/CM005|CM106/.test(anchorClean.out),
    `after fmt:\n${anchorClean.out}`);

  const bogus = '// cm:edge contract -> ../nope/gone.ts — nothing resolves here\nexport const q = 1;\n';
  writeFileSync(join(root, 'apps', 'web', 'src', 'bogus.ts'), bogus);
  const fmt2 = cm(pluginRoot, root, 'fmt');
  check('cli: cm fmt does not invent a path for a ../ target that resolves to nothing',
    readFileSync(join(root, 'apps', 'web', 'src', 'bogus.ts'), 'utf8') === bogus
    && !/relative target resolved/.test(fmt2.out),
    `cm fmt must leave an unresolvable target for the author:\n${fmt2.out}`);

  writeFileSync(join(root, 'anchor.ts'),
    '// cm:edge contract -> apps/api/src/thing.ts#saveThing — the canonical writer\n'
    + '// cm:edge contract -> apps/api/src/thing.ts#saveThingRenamed — this one moved\n'
    + 'export const a2 = 1;\n');
  const anchors = cm(pluginRoot, root, 'verify', '--tier', 'referential');
  check('cli: a live anchor is green and a moved one is CM106',
    anchors.status === 1 && (anchors.out.match(/CM106/g) ?? []).length === 1
    && /saveThingRenamed/.test(anchors.out),
    `expected exactly one CM106, got:\n${anchors.out}`);
}

// cm:why a wall of output is a gating mechanism: 677 diagnostics at two lines each trains people to run
//   this under `| tail`, which is how 38 standing CM102 stayed invisible long enough to matter (ISS-9)
function outputCases(pluginRoot, check, roots) {
  const root = makeRepo();
  roots.push(root);
  const noisy = Array.from({ length: 25 }, (_, i) => `// narration number ${i} that says nothing new\nexport const n${i} = ${i};`);
  writeFileSync(join(root, 'noisy.ts'), `${noisy.join('\n')}\n`);

  const grouped = cm(pluginRoot, root, 'verify');
  const fixLines = (out) => (out.match(/^ {2}fix: /gm) ?? []).length;
  // cm:why 27 diagnostics carry two distinct fixes here — the plain CM001 and the near-header variant — so
  // "printed once per code" has to mean once per ADVICE, or most of a group is told the wrong thing
  check('cli: a big run groups by code and prints each distinct fix once',
    /CM001\s+grammar\s+24 in 1 file/.test(grouped.out) && fixLines(grouped.out) === 2
    && /grouped by code/.test(grouped.out),
    `expected two fix lines for 27 diagnostics, got ${fixLines(grouped.out)}:\n${grouped.out}`);
  check('cli: the grouped run still reports its counts and its debt line',
    /27 errors, 0 warnings/.test(grouped.out) && /2 files/.test(grouped.out),
    `the summary must survive grouping:\n${grouped.out}`);

  const verbose = cm(pluginRoot, root, 'verify', '--verbose');
  check('cli: --verbose restores every line', fixLines(verbose.out) === 27 && /noisy\.ts:1 error/.test(verbose.out),
    `expected 27 per-line fixes, got ${fixLines(verbose.out)}`);

  const scoped = cm(pluginRoot, root, 'verify', 'noisy.ts');
  check('cli: an explicit path stays per-line however many there are',
    fixLines(scoped.out) === 25 && !/grouped by code/.test(scoped.out),
    `a single-file run is where the line number is the point, got ${fixLines(scoped.out)}:\n${scoped.out}`);

  const json = cm(pluginRoot, root, 'verify', '--json');
  let n = -1;
  try { n = JSON.parse(json.out).diags.length; } catch { n = -1; }
  check('cli: --json is never grouped — tools consume it', n === 27,
    `expected 27 diags in the JSON payload, got ${n}`);
}

// cm:why #7 and #12 are one defect seen twice: cm had no idea what the author actually touched, so a
//   five-hunk change reported 24 errors from zero of them, and the only remedy was a repo-wide re-freeze
function diffScopeCases(pluginRoot, check, roots) {
  const root = makeRepo();
  roots.push(root);
  const lines = ['export const a0 = 0;'];
  for (let i = 1; i < 40; i++) {
    if (i % 10 === 0) lines.push(`// legacy narration number ${i} that nobody froze`);
    lines.push(`export const a${i} = ${i};`);
  }
  const file = join(root, 'since.ts');
  writeFileSync(file, `${lines.join('\n')}\n`);
  git(root, 'add', '-A');
  git(root, 'commit', '-qm', 'since');

  const whole = cm(pluginRoot, root, 'verify', 'since.ts');
  check('cli: an explicit path still reports the whole file',
    (whole.out.match(/CM001/g) ?? []).length === 3,
    `a path is not a diff — every line still counts:\n${whole.out}`);

  lines[1] = 'export const a1 = 100;';
  writeFileSync(file, `${lines.join('\n')}\n`);
  const since = cm(pluginRoot, root, 'verify', '--since', 'HEAD');
  check('cli: --since reports nothing from lines the diff never touched',
    since.status === 0 && !/CM001/.test(since.out) && /3 grammar diagnostic\(s\) on lines this diff did not touch/.test(since.out),
    `expected a clean scoped run that says what it withheld:\n${since.out}`);

  const allLines = cm(pluginRoot, root, 'verify', '--since', 'HEAD', '--all-lines');
  check('cli: --all-lines restores the whole changed file',
    allLines.status === 1 && (allLines.out.match(/CM001/g) ?? []).length === 3,
    `a deliberate cleanup pass must still see everything:\n${allLines.out}`);

  writeFileSync(file, `${lines.join('\n')}\n// a comment written INSIDE the diff\nexport const z = 1;\n`);
  const mine = cm(pluginRoot, root, 'verify', '--since', 'HEAD');
  check('cli: --since still reports prose the author actually added',
    mine.status === 1 && /written INSIDE the diff/.test(mine.out),
    `line filtering must not become an amnesty:\n${mine.out}`);

  // cm:guard an untracked file has NO diff, so "no ranges" must mean "do not filter" — the other way
  //   round lets an agent create a whole file of prose and have the hook call it clean (ISS-7)
  writeFileSync(join(root, 'brandnew.ts'), '// narration in a file git has never seen\nexport const n = 1;\n');
  const untracked = cm(pluginRoot, root, 'verify', '--changed-lines', 'brandnew.ts');
  check('cli: an untracked file is not filtered to nothing',
    untracked.status === 1 && /CM001/.test(untracked.out),
    `a new file must be fully checked, not treated as unchanged:\n${untracked.out}`);

  const scopedBaseline = cm(pluginRoot, root, 'baseline', 'since.ts');
  const bl = JSON.parse(readFileSync(join(root, '.forge', 'codemap-baseline.json'), 'utf8'));
  check('cli: cm baseline <path> freezes that file and MERGES, leaving others alone',
    /re-froze 1 file/.test(scopedBaseline.out) && bl['since.ts']?.length === 4
    && bl['legacy.ts'] === undefined && bl['brandnew.ts'] === undefined,
    `a scoped re-freeze must not touch, or absolve, any other file:\n${scopedBaseline.out}\n${JSON.stringify(bl)}`);

  cm(pluginRoot, root, 'baseline');
  const afterFull = JSON.parse(readFileSync(join(root, '.forge', 'codemap-baseline.json'), 'utf8'));
  const scoped2 = cm(pluginRoot, root, 'baseline', 'brandnew.ts');
  const bl2 = JSON.parse(readFileSync(join(root, '.forge', 'codemap-baseline.json'), 'utf8'));
  check('cli: a scoped re-freeze keeps every pre-existing entry byte for byte',
    Object.keys(afterFull).every((k) => JSON.stringify(bl2[k]) === JSON.stringify(afterFull[k])),
    `entries changed outside the scope:\n${scoped2.out}\n${JSON.stringify(bl2)}`);
}

// cm:why an edge is one-sided: nothing checked that the coupling it claims exists at the other end, so a
//   function could declare a contract its target had never called and cm reported green (ISS-8)
function advisoryCases(pluginRoot, check, roots) {
  const root = makeRepo();
  roots.push(root);
  writeFileSync(join(root, 'engine.ts'), 'export function unrelated() { return 1; }\n');
  writeFileSync(join(root, 'caller.ts'),
    '// cm:edge contract -> engine.ts#unrelated — the engine must consume this\n'
    + 'export function listThings() { return []; }\n');
  writeFileSync(join(root, 'named.ts'),
    '// cm:edge naming -> engine.ts#unrelated — the coupling IS the string, by definition no reference\n'
    + 'export const key = "unrelated";\n');
  cm(pluginRoot, root, 'baseline');

  const off = cm(pluginRoot, root, 'verify');
  check('cli: the advisory tier is silent unless asked for',
    off.status === 0 && !/CM301/.test(off.out),
    `a heuristic must not fire in a default run:\n${off.out}`);

  const on = cm(pluginRoot, root, 'verify', '--tier', 'advisory');
  check('cli: --tier advisory warns on an edge with no evidence at the other end',
    /CM301/.test(on.out) && /caller\.ts:1/.test(on.out),
    `expected CM301 for the unwired contract:\n${on.out}`);
  check('cli: CM301 never gates — it cannot change the exit code',
    on.status === 0 && /1 warning/.test(on.out),
    `advisory is warning-only; got exit ${on.status}\n${on.out}`);
  check('cli: a naming edge is never judged — the coupling IS the string',
    !/named\.ts/.test(on.out),
    `reference-free kinds must be skipped:\n${on.out}`);

  writeFileSync(join(root, 'caller.ts'),
    '// cm:ignore CM301 — the engine reaches this over HTTP, so no reference exists either way\n'
    + '// cm:edge contract -> engine.ts#unrelated — the engine must consume this\n'
    + 'export function listThings() { return []; }\n');
  const silenced = cm(pluginRoot, root, 'verify', '--tier', 'advisory');
  check('cli: CM301 is silenced by cm:ignore, which demands a written reason',
    !/CM301/.test(silenced.out),
    `the existing escape hatch must work here:\n${silenced.out}`);

  writeFileSync(join(root, 'engine.ts'),
    'import { listThings } from "./caller";\nexport function unrelated() { return listThings(); }\n');
  const wired = cm(pluginRoot, root, 'verify', '--tier', 'advisory');
  check('cli: once the other side names this file, the warning goes away',
    !/CM301/.test(wired.out),
    `evidence at either end is enough:\n${wired.out}`);

  // cm:guard measured on two production repos: 26 of 36 hits in one were cross-language pairs, where a
  //   reference CANNOT exist — firing there is a bug in the check, not a threshold to tune (§7.1)
  mkdirSync(join(root, 'api'), { recursive: true });
  writeFileSync(join(root, 'api', 'handler.go'),
    '// cm:edge contract -> engine.ts#unrelated — the Go side must return the same shape\npackage api\n');
  const crossLang = cm(pluginRoot, root, 'verify', '--tier', 'advisory');
  check('cli: a cross-language pair is never judged — no reference is possible either way',
    !/handler\.go/.test(crossLang.out),
    `Go cannot import a .ts file:\n${crossLang.out}`);

  // cm:why Go names the imported DIRECTORY, never the file, so a filename-only test warned on every
  //   correctly-wired Go edge — 10 of 10 same-language hits in the measured repo (§7.1)
  mkdirSync(join(root, 'pkg', 'search'), { recursive: true });
  writeFileSync(join(root, 'pkg', 'search', 'loader.go'), 'package search\n\nfunc publicFlagsSQL() string { return "" }\n');
  writeFileSync(join(root, 'api', 'repo.go'),
    '// cm:edge contract -> pkg/search/loader.go#publicFlagsSQL — the same predicate must gate both paths\n'
    + 'package api\n\nimport "example.com/pkg/search"\n\nvar _ = search.Anything\n');
  const goDir = cm(pluginRoot, root, 'verify', '--tier', 'advisory');
  check('cli: an imported package DIRECTORY counts as evidence, which is all Go ever names',
    !/repo\.go/.test(goDir.out),
    `Go's import model must not read as missing evidence:\n${goDir.out}`);
}

export function cliCases(pluginRoot, check) {
  const roots = [];
  try {
    const root = makeRepo();
    roots.push(root);

    cm(pluginRoot, root, 'baseline');
    const clean = cm(pluginRoot, root, 'verify');
    check('cli: a freshly baselined tree verifies clean', clean.status === 0 && fileCount(clean.out) === 2,
      `status=${clean.status} files=${fileCount(clean.out)}\n${clean.out}`);

    const all = fileCount(clean.out);

    for (const args of [['--tier', 'grammar'], ['--tier=grammar']]) {
      const r = cm(pluginRoot, root, 'verify', ...args);
      check(`cli: verify ${args.join(' ')} keeps the whole tree in scope`, fileCount(r.out) === all,
        `expected ${all} files, got ${fileCount(r.out)} — the flag value was parsed as a path\n${r.out}`);
    }

    writeFileSync(join(root, 'other.ts'), 'export const b = 3;\n');
    const since = cm(pluginRoot, root, 'verify', '--since', 'HEAD');
    check('cli: verify --since scopes to changed files, not to zero',
      fileCount(since.out) === 1,
      `expected 1 changed file, got ${fileCount(since.out)}\n${since.out}`);

    const scopedPath = cm(pluginRoot, root, 'verify', 'legacy.ts');
    check('cli: an explicit path still scopes', fileCount(scopedPath.out) === 1,
      `expected 1, got ${fileCount(scopedPath.out)}\n${scopedPath.out}`);

    check('cli: verify reports the frozen debt', /legacy prose: 2 distinct still frozen/.test(clean.out),
      `summary was:\n${clean.out}`);

    const sweep = cm(pluginRoot, root, 'sweep');
    check('cli: sweep lists what the baseline hides',
      sweep.out.includes(FROZEN) && sweep.out.includes(GONE) && /2 frozen prose comment\(s\), 2 distinct/.test(sweep.out),
      `sweep said:\n${sweep.out}`);

    const limited = cm(pluginRoot, root, 'sweep', '--limit', '1');
    check('cli: sweep --limit truncates without going scoped',
      /and 1 more/.test(limited.out) && !/scoped run/.test(limited.out),
      `sweep --limit said:\n${limited.out}`);

    writeFileSync(join(root, 'legacy.ts'), `// ${FROZEN}\nexport const a = 1;\n`);

    const refused = cm(pluginRoot, root, 'sweep', '--prune-baseline', 'legacy.ts');
    check('cli: --prune-baseline refuses a scoped run',
      refused.status === 2 && /whole-tree/.test(refused.out),
      `expected exit 2, got ${refused.status}\n${refused.out}`);

    const before = readFileSync(join(root, 'legacy.ts'), 'utf8');
    const prune = cm(pluginRoot, root, 'sweep', '--prune-baseline');
    const after = readFileSync(join(root, 'legacy.ts'), 'utf8');
    check('cli: --prune-baseline drops only the stale key',
      /dropped 1 stale key\(s\); 1 remain frozen/.test(prune.out),
      `prune said:\n${prune.out}`);
    check('cli: --prune-baseline edits no source file', before === after,
      'legacy.ts changed — prune is bookkeeping only');

    const after2 = cm(pluginRoot, root, 'verify');
    check('cli: the surviving comment stays frozen after a prune',
      after2.status === 0 && /legacy prose: 1 distinct still frozen/.test(after2.out),
      `verify after prune:\n${after2.out}`);

    writeFileSync(join(root, 'legacy.ts'),
      `// ${FROZEN}\n// cm:guard callers must hold the run lock\nexport const a = 1;\n`);
    const sited = cm(pluginRoot, root, 'verify');
    check('cli: verify flags frozen prose once it shares a block with an annotation',
      sited.status === 1 && /CM001/.test(sited.out),
      `expected exit 1 with CM001, got ${sited.status}\n${sited.out}`);

    const sweptSited = cm(pluginRoot, root, 'sweep');
    check('cli: sweep excludes sited prose — it is no longer hidden',
      /0 frozen prose comment\(s\)/.test(sweptSited.out),
      `sweep said:\n${sweptSited.out}`);

    failOpenCases(pluginRoot, check, roots);
    rewriteCases(pluginRoot, check, roots);
    baselineLifecycleCases(pluginRoot, check, roots);
    wrapCases(pluginRoot, check, roots);
    adoptionCases(pluginRoot, check, roots);
    targetCases(pluginRoot, check, roots);
    outputCases(pluginRoot, check, roots);
    diffScopeCases(pluginRoot, check, roots);
    advisoryCases(pluginRoot, check, roots);
  } finally {
    for (const r of roots) rmSync(r, { recursive: true, force: true });
  }
}
