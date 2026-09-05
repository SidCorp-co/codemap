// `cm pr-comment` tier. VISION §3.4: a PR comment naming a declared coupling the diff crossed is
// both a feature and the only free advertising this idea has — these cases drive the real CLI
// against a real git history, the same way tests/cli.mjs does for verify/fmt/impact.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env, GIT_AUTHOR_NAME: 'cm', GIT_AUTHOR_EMAIL: 'cm@test',
      GIT_COMMITTER_NAME: 'cm', GIT_COMMITTER_EMAIL: 'cm@test',
    },
  }).trim();
}

function cm(pluginRoot, root, ...args) {
  const res = spawnSync(process.execPath, [join(pluginRoot, 'cli', 'cm.mjs'), ...args], {
    cwd: root, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' },
  });
  return { ...res, out: `${res.stdout}${res.stderr}` };
}

function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), 'cm-prcomment-'));
  mkdirSync(join(root, '.forge'));
  writeFileSync(join(root, '.forge', 'codemap.json'), '{}\n');
  writeFileSync(join(root, 'a.ts'),
    '// cm:edge lockstep -> b.json — three version fields must agree\nexport const a = 1;\n');
  writeFileSync(join(root, 'b.json'), '{"version": "1.0.0"}\n');
  writeFileSync(join(root, 'c.ts'),
    '// cm:guard callers must hold the run lock\nexport const c = 1;\nexport const c2 = 2;\n');
  git(root, 'init', '-q');
  git(root, 'add', '.forge', 'a.ts', 'b.json', 'c.ts');
  git(root, 'commit', '-qm', 'seed');
  return root;
}

export function prCommentCases(pluginRoot, check) {
  const roots = [];
  try {
    {
      const root = makeRepo();
      roots.push(root);
      const noBase = cm(pluginRoot, root, 'pr-comment');
      check('pr-comment: --base is required', noBase.status === 2 && /--base <ref>/.test(noBase.out),
        `expected exit 2 naming --base, got ${noBase.status}\n${noBase.out}`);
    }

    {
      const root = makeRepo();
      roots.push(root);
      cm(pluginRoot, root, 'baseline');
      const base = git(root, 'rev-parse', 'HEAD');
      writeFileSync(join(root, 'a.ts'),
        '// cm:edge lockstep -> b.json — three version fields must agree\nexport const a = 2;\n');

      const r = cm(pluginRoot, root, 'pr-comment', '--base', base);
      check('pr-comment: one side of a lockstep edge changed is a finding',
        r.status === 0 && /lockstep.*a\.ts:1/.test(r.out) && /b\.json/.test(r.out),
        `expected a lockstep finding citing a.ts:1, got:\n${r.out}`);
      check('pr-comment: the finding carries the declared MARKER for idempotent lookup',
        r.out.includes('<!-- codemap:pr-comment -->'),
        `a caller must be able to find its own prior comment:\n${r.out}`);
      check('pr-comment: dry run never touches the network — exit 0 with no token',
        r.status === 0, `expected exit 0 (report, never fail the build), got ${r.status}\n${r.out}`);
    }

    {
      const root = makeRepo();
      roots.push(root);
      cm(pluginRoot, root, 'baseline');
      const base = git(root, 'rev-parse', 'HEAD');
      writeFileSync(join(root, 'a.ts'),
        '// cm:edge lockstep -> b.json — three version fields must agree\nexport const a = 2;\n');
      writeFileSync(join(root, 'b.json'), '{"version": "2.0.0"}\n');

      const r = cm(pluginRoot, root, 'pr-comment', '--base', base);
      check('pr-comment: both sides of a lockstep edge changed is silent',
        !/lockstep/.test(r.out), `both sides changing is not this PR's business:\n${r.out}`);
    }

    {
      const root = makeRepo();
      roots.push(root);
      cm(pluginRoot, root, 'baseline');
      const base = git(root, 'rev-parse', 'HEAD');
      writeFileSync(join(root, 'unrelated.ts'), 'export const z = 1;\n');
      git(root, 'add', 'unrelated.ts');
      git(root, 'commit', '-qm', 'unrelated only');

      const r = cm(pluginRoot, root, 'pr-comment', '--base', base);
      check('pr-comment: neither side of a lockstep edge changed is silent, whole run reports nothing',
        r.status === 0 && /nothing to report/.test(r.out) && !r.out.includes('<!--'),
        `an untouched coupling is not this PR's business:\n${r.out}`);
    }

    {
      const root = makeRepo();
      roots.push(root);
      cm(pluginRoot, root, 'baseline');
      const base = git(root, 'rev-parse', 'HEAD');
      writeFileSync(join(root, 'c.ts'),
        '// cm:guard callers must hold the run lock, never per row\nexport const c = 1;\nexport const c2 = 2;\n');

      const r = cm(pluginRoot, root, 'pr-comment', '--base', base);
      check('pr-comment: editing the guarded line itself is a finding',
        r.status === 0 && /guard.*c\.ts:1/.test(r.out) && /run lock/.test(r.out),
        `expected a guard finding citing c.ts:1, got:\n${r.out}`);
    }

    {
      const root = makeRepo();
      roots.push(root);
      cm(pluginRoot, root, 'baseline');
      const base = git(root, 'rev-parse', 'HEAD');
      writeFileSync(join(root, 'c.ts'),
        '// cm:guard callers must hold the run lock\nexport const c = 1;\nexport const c2 = 99;\n');

      const r = cm(pluginRoot, root, 'pr-comment', '--base', base);
      check('pr-comment: a diff that does not touch the guarded line is silent',
        !/guard/.test(r.out),
        `only the diff crossing the DECLARED line is this check's business:\n${r.out}`);
    }

    {
      const root = makeRepo();
      roots.push(root);
      const r = cm(pluginRoot, root, 'pr-comment', '--base', 'no-such-ref');
      check('pr-comment: an unresolvable --base is reported, not silently green',
        r.status === 0 && /nothing to report/.test(r.out) && /cannot resolve/.test(r.out),
        `a diff that could not be computed must never read as "every coupling honoured":\n${r.out}`);
    }
  } finally {
    for (const r of roots) rmSync(r, { recursive: true, force: true });
  }
}
