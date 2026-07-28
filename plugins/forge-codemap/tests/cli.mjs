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
  } finally {
    for (const r of roots) rmSync(r, { recursive: true, force: true });
  }
}
