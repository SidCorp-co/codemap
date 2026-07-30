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
  } finally {
    for (const r of roots) rmSync(r, { recursive: true, force: true });
  }
}
