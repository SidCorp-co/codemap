// Profile-resolution tier. `profileFor` keyed on a trailing extension only, so every Dockerfile
// name returned null and analyzeFile skipped it — while a second, hand-kept SCAN_EXT regex in
// registry.mjs gated walk() and gitFiles() independently. The corpus could not see either: it calls
// analyzeFile with a relPath it chooses itself, and never asks which paths the scanner reaches.
// These cases assert the resolution table and drive the real walk and the real argv (ISS-25).

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { profileFor } from '../cli/lib/languages.mjs';
import { walk, changedStaged, DEFAULT_REGISTRY } from '../cli/lib/registry.mjs';

const GUARD_TEXT = 'the build stage and the runtime stage must install the same lockfile';

function git(root, ...args) {
  execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_NAME: 'cm', GIT_AUTHOR_EMAIL: 'cm@test',
      GIT_COMMITTER_NAME: 'cm', GIT_COMMITTER_EMAIL: 'cm@test' },
  });
}

function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), 'cm-profiles-'));
  mkdirSync(join(root, '.forge'));
  writeFileSync(join(root, '.forge', 'codemap.json'), '{}\n');
  writeFileSync(join(root, 'app.ts'), 'export const a = 1;\n');
  writeFileSync(join(root, 'Dockerfile'), `# syntax=docker/dockerfile:1\n# cm:guard ${GUARD_TEXT}\nFROM node:22\n`);
  writeFileSync(join(root, 'Dockerfile.md'), `# How to build\n\n    # cm:guard ${GUARD_TEXT}\n`);
  git(root, 'init', '-q');
  git(root, 'add', '-A');
  git(root, 'commit', '-qm', 'seed');
  return root;
}

function cm(pluginRoot, root, ...args) {
  const res = spawnSync(process.execPath, [join(pluginRoot, 'cli', 'cm.mjs'), ...args], {
    cwd: root, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' },
  });
  return { ...res, out: `${res.stdout}${res.stderr}` };
}

function fileCount(out) {
  return Number(/·\s+(\d+)\s+files/.exec(out)?.[1] ?? -1);
}

export function profileCases(pluginRoot, check) {
  const resolves = [
    ['Dockerfile', 'docker'],
    ['Dockerfile.preview', 'docker'],
    ['prod.Dockerfile', 'docker'],
    ['Containerfile', 'docker'],
    ['dockerfile', 'docker'],
    ['docker/Dockerfile.prod', 'docker'],
    ['Containerfile.preview', 'docker'],
    ['Dockerfile.prod.local', 'docker'],
    ['Dockerfile.j2', 'docker'],
    ['Dockerfile.example', 'docker'],
    ['Dockerfile.tmpl', 'docker'],
    ['Dockerfile.wiki', 'docker'],
    ['Dockerfile.tex', 'docker'],
    ['Dockerfile.org', 'docker'],
    ['Dockerfile.pod', 'docker'],
    ['dockerfile.go', 'go'],
    ['Dockerfile.sh', 'sh'],
    ['Dockerfile.yml', 'yaml'],
    ['app.ts', 'ts'],
    ['config.yml', 'yaml'],
    ['config.yaml', 'yaml'],
    ['deploy.sh', 'sh'],
    ['Widget.vue', 'sfc'],
    ['Widget.svelte', 'sfc'],
    ['app.jsx', 'ts'],
  ];
  for (const [path, id] of resolves) {
    check(`profiles: ${path} resolves to ${id}`, profileFor(path)?.id === id,
      `expected ${id}, got ${profileFor(path)?.id ?? 'null'}`);
  }

  // cm:guard .vue and .svelte must resolve to the SAME profile object — the two are required to agree,
  //   and two profiles with equal fields would drift the moment one of them is edited (ISS-28)
  check('profiles: .vue and .svelte resolve to one shared profile',
    profileFor('a.vue') === profileFor('a.svelte'),
    'expected one object; got two distinct profiles');

  // cm:why every one of these resolved to `docker` when the deny-list read only the trailing
  //   extension, so a fenced ```dockerfile example in a docs page became a real annotation and a
  //   stale target in one failed a consumer's CI with CM102 (ISS-25)
  const unresolved = ['Dockerfile.md', 'Dockerfile.markdown', 'Dockerfile.txt', 'Dockerfile.rst',
    'Dockerfile.adoc', 'Dockerfile.asciidoc', 'Dockerfile.prod.md', 'README.md', 'LICENSE',
    'Makefile', 'Jenkinsfile', '.gitignore',
    'docs/dockerfile.mdx', 'Dockerfile.mdx', 'Dockerfile.mkd', 'Dockerfile.mdown',
    'Dockerfile.text', 'Dockerfile.textile',
    'Dockerfile.md~', 'Dockerfile.md.bak', 'Dockerfile.md.orig', 'Dockerfile.md.save',
    'Dockerfile.markdown.old', 'Dockerfile.md.j2', 'Dockerfile.MD', 'md.dockerfile',
    'Dockerfile.asc', 'Dockerfile.mdwn', 'Dockerfile.mmd', 'Dockerfile.mdtxt', 'Dockerfile.markdn',
    'Dockerfile.qmd', 'Dockerfile.rmd', 'docs/dockerfile.html', 'Dockerfile.htm',
    'Dockerfile.orig', 'Dockerfile.rej', 'Dockerfile.bak', 'Dockerfile.swp', 'Dockerfile.old',
    'Dockerfile~', 'Dockerfile.prod.bak', 'Dockerfile.md.bak~'];
  for (const path of unresolved) {
    check(`profiles: ${path} resolves to no profile`, profileFor(path) === null,
      `expected null, got ${profileFor(path)?.id}`);
  }

  const src = readFileSync(join(pluginRoot, 'cli', 'lib', 'registry.mjs'), 'utf8');
  check('profiles: registry.mjs keeps no second extension list',
    !src.includes('SCAN_EXT'),
    'SCAN_EXT is back — two lists that must agree, with nothing checking that they do');
  check('profiles: registry.mjs decides scannability by asking profileFor',
    (src.match(/profileFor\(/g) ?? []).length >= 2,
    'walk() and gitFiles() must each ask profileFor');

  const roots = [];
  try {
    const root = makeRepo();
    roots.push(root);

    const walked = walk(root, DEFAULT_REGISTRY);
    check('profiles: walk() reaches a Dockerfile', walked.includes('Dockerfile'),
      `whole-tree verify scans what walk() returns: ${JSON.stringify(walked)}`);
    check('profiles: walk() still skips a Dockerfile.md', !walked.includes('Dockerfile.md'),
      `a fenced example annotation would enter the graph as a real one: ${JSON.stringify(walked)}`);

    const ls = cm(pluginRoot, root, 'ls');
    check('profiles: cm ls lists a Dockerfile guard',
      ls.status === 0 && ls.out.includes(GUARD_TEXT) && /Dockerfile/.test(ls.out),
      `exit ${ls.status}\n${ls.out}`);

    const verify = cm(pluginRoot, root, 'verify');
    check('profiles: whole-tree verify counts the Dockerfile among its files',
      fileCount(verify.out) === 2,
      `expected 2 files (app.ts + Dockerfile), got ${fileCount(verify.out)}\n${verify.out}`);
    check('profiles: a Dockerfile raises nothing — readable, not newly policed',
      verify.status === 0 && !/CM0/.test(verify.out),
      `exit ${verify.status}\n${verify.out}`);

    // cm:guard --staged must be asserted against a REAL staged edit: over an empty index every
    //   scope reports 0 files and exit 0, which passed before the fix too (ISS-25)
    writeFileSync(join(root, 'Dockerfile'),
      `# syntax=docker/dockerfile:1\n# cm:guard ${GUARD_TEXT}\n# cm:guard the runtime stage installs no build toolchain\nFROM node:22\n`);
    execFileSync('git', ['-C', root, 'add', 'Dockerfile'], { encoding: 'utf8' });

    check('profiles: changedStaged() reaches a staged Dockerfile',
      changedStaged(root).includes('Dockerfile'),
      `the pre-commit hook gates on this: ${JSON.stringify(changedStaged(root))}`);

    const staged = cm(pluginRoot, root, 'verify', '--staged');
    check('profiles: verify --staged scans the staged Dockerfile and its two guards',
      staged.status === 0 && fileCount(staged.out) === 1 && /·\s+2\s+guards/.test(staged.out),
      `expected 1 file and 2 guards, got ${fileCount(staged.out)}\n${staged.out}`);

    const since = cm(pluginRoot, root, 'verify', '--since', 'HEAD');
    check('profiles: verify --since reaches the Dockerfile too',
      since.status === 0 && fileCount(since.out) === 1,
      `expected 1 file, got ${fileCount(since.out)}\n${since.out}`);
  } finally {
    for (const r of roots) rmSync(r, { recursive: true, force: true });
  }
}
