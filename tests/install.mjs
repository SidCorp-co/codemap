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
import { isGenerated, profileFor, GENERATED_HEAD_LINES } from '../cli/lib/languages.mjs';
import { walk, DEFAULT_REGISTRY } from '../cli/lib/registry.mjs';
import { scanComments } from '../cli/lib/scan.mjs';

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

  // cm:guard the marker is built by concatenation, never written whole — a verbatim one anywhere in
  //   this file's first GENERATED_HEAD_LINES lines would make THIS file skip itself, which is the
  //   defect being pinned rather than a way to pin it (ISS-29)
  const MARKER = `@${'generated'}`;
  {
    const rel = join('cli', 'lib', 'install.mjs');
    const src = readFileSync(join(pluginRoot, rel), 'utf8');
    const prof = profileFor(rel);

    // cm:guard install.mjs states the vendored-copy constraint that stamp() can break, so it has to be
    //   READABLE — a skipped file delivers no annotation to cm ls and nothing to the PreToolUse hook,
    //   which leaves the editor of stamp() with no sight of the rule they are about to break (ISS-29)
    check('install: the file stating the vendored-copy constraint is not skipped as generated',
      isGenerated(src, prof) === false,
      'cli/lib/install.mjs is skipped, so every cm: annotation in it — including the guard on the '
      + 'marker stamp() writes — reaches nobody');

    const head = src.split('\n', GENERATED_HEAD_LINES).join('\n');
    const { comments } = scanComments(head, prof, { flushOpen: true });
    check('install: no comment in that head window names the marker verbatim',
      comments.every((c) => !c.text.includes(MARKER)),
      `a comment in the first ${GENERATED_HEAD_LINES} lines contains "${MARKER}", which is what makes `
      + 'that comment a header marker; point at the marker in the code instead of repeating it');

    // cm:guard the property is REPO-WIDE, not one file's — install.mjs was only the first file to
    //   name a marker in its own head, and the next one skips itself just as silently (ISS-29)
    // cm:guard scoped to the TRACKED set, never the working tree — an untracked scratch file with a
    //   marker head would otherwise fail this on something the repository does not own (ISS-29)
    const tracked = new Set(execFileSync('git', ['-C', pluginRoot, 'ls-files'], { encoding: 'utf8' })
      .split('\n').filter(Boolean));
    const skipped = walk(pluginRoot, DEFAULT_REGISTRY).filter((rel) => tracked.has(rel)).filter((rel) => {
      const p = profileFor(rel);
      return p && isGenerated(readFileSync(join(pluginRoot, rel), 'utf8'), p);
    });
    check('install: no file in this repository skips itself as generated',
      skipped.length === 0,
      `these files are skipped and deliver no annotation: ${skipped.join(', ')} — a cm: comment in a `
      + 'head window must not name a generated-marker verbatim');

    // cm:guard the constraint itself must not move: stamp() keeps writing a marker the skip rule
    //   matches, or the vendored copy's annotations start being read as the project's own (ISS-29)
    check('install: stamp() still writes a marker the generated rule matches',
      new RegExp(`const marker = \`//\\s*${MARKER}\\b`).test(src),
      'the guard is about the marker stamp() writes; if stamp() stopped writing one, the vendored '
      + 'copies stop being skipped and the guard describes nothing');
  }

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
    check('install: adapters/ci/prompt.md matches `cm onboard --prompt`', gen === onDisk,
      'regenerate it: node cli/cm.mjs onboard --prompt > adapters/ci/prompt.md');
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

  // cm:guard these cases run the hook, never grep it — the defect they pin was a template that read
  //   correctly and reported nothing, so a substring assertion is what missed it in the first place (ISS-35)
  {
    const root = makeRepo();
    run(pluginCm, root, 'install', '--git-hook');

    const runStagedHook = (name, body) => {
      writeFileSync(join(root, name), body);
      git(root, 'add', name);
      const res = spawnSync('sh', [join(root, '.git', 'hooks', 'pre-commit')], {
        cwd: root, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' },
      });
      const out = `${res.stdout}${res.stderr}`;
      git(root, 'rm', '-q', '--cached', name);
      rmSync(join(root, name), { force: true });
      return { out, status: res.status };
    };

    const unclosed = runStagedHook('iss35-unclosed.ts',
      '/* this block comment is never closed\nexport const a = 1;\n// cm:why a why nothing will read\n');
    check('install: the commit hook reports a file whose annotations have stopped being read',
      /CM203/.test(unclosed.out),
      `the hook is the one gate a trial repo installs; it must not be silent about CM203:\n${unclosed.out}`);
    check('install: CM203 alone does not block the commit',
      unclosed.status === 0,
      `CM203 is structural and cannot set an exit code, so the hook must still pass:\n${unclosed.out}`);

    const malformed = runStagedHook('iss35-grammar.ts',
      'export const b = 2;\n// cm:hack no-key until:whenever — a malformed hack line\n');
    check('install: the commit hook still blocks a grammar error',
      malformed.status !== 0 && /CM007/.test(malformed.out),
      `the grammar tier must keep gating exactly what it gated before:\n${malformed.out}`);

    const dangling = runStagedHook('iss35-edge.ts',
      'export const c = 3;\n// cm:edge contract -> does/not/exist.ts — a target that is not there\n');
    check('install: the commit hook does not gate on a referential diagnostic',
      dangling.status === 0 && !/CM102/.test(dangling.out),
      `a dangling edge goes red on files the committer never touched; CI catches it, not the hook:\n${dangling.out}`);

    rmSync(root, { recursive: true, force: true });
  }

  // cm:edge lockstep -> cli/lib/install.mjs — the committed hook and the per-clone one are one template,
  //   and a change that reaches only one leaves half the repos on the old coverage (ISS-35)
  {
    const root = makeRepo();
    run(pluginCm, root, 'install');
    git(root, 'config', 'core.hooksPath', '.forge/codemap/hooks');
    writeFileSync(join(root, 'iss35-team.ts'),
      '/* never closed\nexport const a = 1;\n// cm:why a why nothing will read\n');
    git(root, 'add', 'iss35-team.ts');
    const teamHook = spawnSync('sh', [join(root, '.forge', 'codemap', 'hooks', 'pre-commit')], {
      cwd: root, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' },
    });
    const teamOut = `${teamHook.stdout}${teamHook.stderr}`;
    check('install: the committed hook reports CM203 too, not just the per-clone one',
      /CM203/.test(teamOut) && teamHook.status === 0,
      `the hook that gates a team must report what the per-clone one reports:\n${teamOut}`);
    rmSync(root, { recursive: true, force: true });
  }
}
