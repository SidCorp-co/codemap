// Independence tier. Every enforcement path used to run out of the plugin: the hooks are plugin hooks,
// and the CI recipe needed a `cm` that exists only once the plugin is installed for that user. A repo
// could therefore carry a registry, a baseline and annotations it had no way to check — so a contributor
// without the plugin was unconstrained while the next one with it inherited the diagnostics.
//
// These cases hold the line the other way round: the repo owns the rules, the plugin is a convenience.

import { mkdtempSync, writeFileSync, readFileSync, readdirSync, existsSync, statSync, rmSync } from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function git(root, ...args) {
  execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_NAME: 'cm', GIT_AUTHOR_EMAIL: 'cm@test',
      GIT_COMMITTER_NAME: 'cm', GIT_COMMITTER_EMAIL: 'cm@test' },
  });
}

function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), 'cm-install-'));
  writeFileSync(join(root, 'app.ts'), 'export const a = 1;\n');
  git(root, 'init', '-q');
  git(root, 'add', '-A');
  git(root, 'commit', '-qm', 'seed');
  return root;
}

function run(cmd, root, ...args) {
  const res = spawnSync(process.execPath, [cmd, ...args], {
    cwd: root, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' },
  });
  return { ...res, out: `${res.stdout}${res.stderr}` };
}

function hookCommand(pluginRoot, name) {
  return join(pluginRoot, 'cli', 'hooks', name);
}

function runHook(pluginRoot, name, { root, file }) {
  const res = spawnSync(process.execPath, [hookCommand(pluginRoot, name)], {
    input: JSON.stringify({ cwd: root, tool_name: 'Edit', tool_input: { file_path: file } }),
    encoding: 'utf8',
  });
  let json = null;
  try { json = JSON.parse(res.stdout); } catch { json = null; }
  return { ...res, json };
}

export function installCases(pluginRoot, check) {
  const pluginCm = join(pluginRoot, 'cli', 'cm.mjs');
  const roots = [];
  try {
    const root = makeRepo();
    roots.push(root);

    const out = run(pluginCm, root, 'install', '--git-hook');
    const vendored = join(root, '.forge', 'codemap', 'cm.mjs');
    const shim = join(root, '.forge', 'codemap', 'cm');

    check('install: vendors a runnable copy into the repo',
      out.status === 0 && existsSync(vendored) && existsSync(shim) && existsSync(join(root, '.forge', 'codemap', 'lib', 'analyze.mjs')),
      `install said:\n${out.out}`);
    check('install: the shim is executable',
      existsSync(shim) && Boolean(statSync(shim).mode & 0o111), 'a non-executable shim cannot be a CI entrypoint');
    // cm:why the lib list is read off disk, not hand-kept — a module missing from the copy is a vendored
    // cm that crashes on import, and this is the case that would have caught adding lib/help.mjs
    const src = readdirSync(join(pluginRoot, 'cli', 'lib')).filter((f) => f.endsWith('.mjs')).sort();
    const copied = readdirSync(join(root, '.forge', 'codemap', 'lib')).filter((f) => f.endsWith('.mjs')).sort();
    check('install: vendors every lib module, with none left behind',
      JSON.stringify(src) === JSON.stringify(copied),
      `plugin has [${src}], vendored copy has [${copied}]`);

    check('install: ships the spec the diagnostics cite',
      existsSync(join(root, '.forge', 'codemap', 'SPEC.md')),
      'every code cites a §section; without the plugin there is nowhere else to read it');
    check('install: writes a registry when the repo has none',
      existsSync(join(root, '.forge', 'codemap.json')),
      'prose enforcement is registry-gated (§8), so install must leave one behind');

    // cm:why the point of the whole tier: enforcement with no plugin in the picture
    writeFileSync(join(root, 'app.ts'), '// narration a compiler already knows\nexport const a = 1;\n');
    const standalone = run(vendored, root, 'verify');
    check('install: the vendored copy enforces on its own',
      standalone.status === 1 && /CM001/.test(standalone.out),
      `the repo's own cm must fail a violating tree:\n${standalone.out}`);

    const version = run(vendored, root, 'version');
    const stamped = readFileSync(join(root, '.forge', 'codemap', 'VERSION'), 'utf8').trim();
    check('install: the vendored copy reports its own pinned version',
      version.out.trim().startsWith(stamped) && stamped !== 'unknown',
      `VERSION says "${stamped}", cm version says "${version.out.trim()}" — a project pinned to an older copy must not claim the plugin's version`);

    check('install: the vendored source is never scanned as project code',
      !/\.forge\/codemap\//.test(standalone.out),
      `cm must not report its own annotations as the project's:\n${standalone.out}`);

    const marker = readFileSync(vendored, 'utf8').split('\n').slice(0, 2).join('\n');
    check('install: vendored files are marked generated with a shebang still first',
      marker.startsWith('#!') && /@generated codemap/.test(marker),
      `head of the vendored cm.mjs was:\n${marker}`);

    // cm:why hooks must defer to the repo's copy, or the plugin enforces what the project's CI does not
    writeFileSync(join(root, 'app.ts'), '// narration a compiler already knows\nexport const a = 1;\n');
    const blocked = runHook(pluginRoot, 'hook-post-edit.mjs', { root, file: join(root, 'app.ts') });
    check('install: the post-edit hook blocks through the vendored copy',
      blocked.json?.decision === 'block' && /CM001/.test(blocked.json.reason),
      `hook said: ${blocked.stdout || '(empty)'}`);

    writeFileSync(vendored, 'process.exit(2)\n');
    const broken = runHook(pluginRoot, 'hook-post-edit.mjs', { root, file: join(root, 'app.ts') });
    const ctx = broken.json?.hookSpecificOutput?.additionalContext ?? '';
    check('install: a checker that cannot run says so instead of passing',
      broken.status === 0 && /could not check/.test(ctx) && broken.json?.decision !== 'block',
      `a broken install must neither wedge the session nor look clean; got: ${broken.stdout || '(empty)'}`);

    // cm:why --git-hook is local enforcement, and must never silently replace someone else's hook
    const preCommit = join(root, '.git', 'hooks', 'pre-commit');
    check('install: --git-hook installs an executable pre-commit',
      existsSync(preCommit) && Boolean(statSync(preCommit).mode & 0o111) && /verify --staged/.test(readFileSync(preCommit, 'utf8')),
      'the local gate is a staged-scope verify');

    writeFileSync(preCommit, '#!/bin/sh\nexit 0\n');
    const second = run(pluginCm, root, 'install', '--git-hook');
    check('install: --git-hook leaves an existing hook alone',
      readFileSync(preCommit, 'utf8').includes('exit 0') && /exists — left alone/.test(second.out),
      `install must not clobber another tool's pre-commit:\n${second.out}`);

    const forced = run(pluginCm, root, 'install', '--git-hook', '--force');
    check('install: --force is what replaces it',
      /verify --staged/.test(readFileSync(preCommit, 'utf8')) && forced.status === 0,
      `--force did not take:\n${forced.out}`);
  } finally {
    for (const r of roots) rmSync(r, { recursive: true, force: true });
  }

  // cm:guard the shipped prompt.md is generated, never hand-written — a setup document that drifts from
  //   the checker it sets up is the exact artifact class this project keeps finding rotted elsewhere
  {
    const gen = spawnSync(process.execPath, [join(pluginRoot, 'cli', 'cm.mjs'), 'onboard', '--prompt'],
      { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } }).stdout;
    const onDisk = readFileSync(join(pluginRoot, 'adapters', 'ci', 'prompt.md'), 'utf8');
    check('install: agent-setup/prompt.md matches `cm onboard --prompt`', gen === onDisk,
      'regenerate it: node scripts/cm.mjs onboard --prompt > agent-setup/prompt.md');
  }

  // cm:guard the hook a TEAM is gated by must be COMMITTED — .git/hooks is per-clone, so a repo relying
  //   on it is gated only on the machines that ran a setup command, which is what does not scale
  {
    const root = mkdtempSync(join(tmpdir(), 'cm-hooks-'));
    spawnSync(process.execPath, [join(pluginRoot, 'cli', 'cm.mjs'), 'install'], { cwd: root, encoding: 'utf8' });
    const hook = join(root, '.forge', 'codemap', 'hooks', 'pre-commit');
    check('install: writes a committed pre-commit hook, executable', existsSync(hook)
      && (statSync(hook).mode & 0o111) !== 0 && /verify --staged/.test(readFileSync(hook, 'utf8')),
      'a per-clone hook cannot gate a team');
    rmSync(root, { recursive: true, force: true });
  }
}
