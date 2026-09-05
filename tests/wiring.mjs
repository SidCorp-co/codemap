// Hook WIRING tier. The golden corpus calls analyzeFile directly, so it stayed green through three
// consecutive releases whose hooks never fired: ${CLAUDE_PLUGIN_ROOT} placed in args (0.2.2), a
// literal-quote command path (0.2.3), a config dir resolved from ~/.claude (0.2.4). These cases
// spawn the command line hooks.json actually declares, against a throwaway repo on disk.

import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, statSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { baselineKey } from '../cli/lib/parse.mjs';
import { tmpdir } from 'node:os';

const GUARD_TEXT = 'wiring probe — this line must reach injected context';
const PLACEHOLDER = '${CLAUDE_PLUGIN_ROOT}';

function hookEntries(pluginRoot) {
  const cfg = JSON.parse(readFileSync(join(pluginRoot, 'hooks', 'hooks.json'), 'utf8'));
  const out = [];
  for (const [event, groups] of Object.entries(cfg.hooks ?? {})) {
    for (const group of groups) {
      for (const h of group.hooks ?? []) {
        const raw = h.command ?? '';
        out.push({
          event,
          matcher: group.matcher ?? '',
          raw,
          args: h.args ?? [],
          command: raw.split(PLACEHOLDER).join(pluginRoot),
        });
      }
    }
  }
  return out;
}

function entryFor(entries, event) {
  return entries.find((e) => e.event === event);
}

function makeRepo({ onboarded }) {
  const root = mkdtempSync(join(tmpdir(), 'cm-wiring-'));
  if (onboarded) {
    mkdirSync(join(root, '.forge'));
    writeFileSync(join(root, '.forge', 'codemap.json'), '{}\n');
  }
  return root;
}

function writeFixture(root, name, src) {
  const abs = join(root, name);
  writeFileSync(abs, src);
  return abs;
}

function runHook(entry, { root, file }) {
  const payload = { cwd: root, tool_name: 'Edit', tool_input: { file_path: file } };
  const res = spawnSync(process.execPath, [entry.command, ...entry.args], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
  });
  let json = null;
  try { json = JSON.parse(res.stdout); } catch { json = null; }
  return { ...res, json };
}

export function wiringCases(pluginRoot, check) {
  const entries = hookEntries(pluginRoot);

  check('wiring: hooks.json declares both events',
    Boolean(entryFor(entries, 'PreToolUse') && entryFor(entries, 'PostToolUse')),
    `events found: [${entries.map((e) => e.event)}]`);

  for (const e of entries) {
    check(`wiring: ${e.event} command is unquoted`, !/["']/.test(e.raw),
      `a quote in the command is taken literally, not dequoted: ${e.raw}`);

    check(`wiring: ${e.event} args carry no placeholder`,
      !e.args.some((a) => a.includes('${')),
      `${PLACEHOLDER} is only expanded in command, never in args: [${e.args}]`);

    check(`wiring: ${e.event} command fully expands`, !e.command.includes('${'),
      `unexpanded placeholder remains: ${e.command}`);

    const ok = existsSync(e.command) && Boolean(statSync(e.command).mode & 0o111);
    check(`wiring: ${e.event} command is an executable file`, ok, `not executable: ${e.command}`);

    const covers = ['Edit', 'Write'].every((t) => new RegExp(e.matcher).test(t));
    check(`wiring: ${e.event} matcher covers Edit and Write`, covers, `matcher: ${e.matcher}`);
  }

  const pre = entryFor(entries, 'PreToolUse');
  const post = entryFor(entries, 'PostToolUse');
  const roots = [];

  try {
    if (pre) {
      const root = makeRepo({ onboarded: true });
      roots.push(root);

      const guarded = writeFixture(root, 'guarded.ts',
        `// cm:guard ${GUARD_TEXT}\nexport const a = 1;\n`);
      const res = runHook(pre, { root, file: guarded });
      const ctx = res.json?.hookSpecificOutput?.additionalContext ?? '';
      check('wiring: PreToolUse injects a declared guard',
        res.json?.hookSpecificOutput?.hookEventName === 'PreToolUse' && ctx.includes(GUARD_TEXT),
        `stdout was: ${res.stdout || '(empty)'}${res.stderr ? ` stderr: ${res.stderr}` : ''}`);

      const bare = writeFixture(root, 'bare.ts', 'export const b = 2;\n');
      const quiet = runHook(pre, { root, file: bare });
      check('wiring: PreToolUse stays silent with nothing declared',
        quiet.stdout.trim() === '' && quiet.status === 0,
        `expected no output, got status=${quiet.status} stdout: ${quiet.stdout}`);
    }

    if (post) {
      const root = makeRepo({ onboarded: true });
      roots.push(root);

      const prose = writeFixture(root, 'prose.ts', '// Load the config\nexport const c = 3;\n');
      const blocked = runHook(post, { root, file: prose });
      check('wiring: PostToolUse blocks a derivable comment',
        blocked.json?.decision === 'block' && blocked.json.reason.includes('CM001'),
        `stdout was: ${blocked.stdout || '(empty)'}${blocked.stderr ? ` stderr: ${blocked.stderr}` : ''}`);

      const clean = writeFixture(root, 'clean.ts', 'export const d = 4;\n');
      const passed = runHook(post, { root, file: clean });
      check('wiring: PostToolUse passes a clean file',
        passed.stdout.trim() === '' && passed.status === 0,
        `expected no output, got status=${passed.status} stdout: ${passed.stdout}`);

      // cm:why the hook drives `cm verify` now, so siting cannot drift between it and CI — this case is
      // what proves the hook consults the baseline at all
      const frozenText = 'legacy narration frozen at init';
      const sitedFile = writeFixture(root, 'sited.ts',
        `// ${frozenText}\n// cm:guard callers must hold the run lock\nexport const s = 1;\n`);
      writeFileSync(join(root, '.forge', 'codemap-baseline.json'),
        `${JSON.stringify({ 'sited.ts': [baselineKey(frozenText)] })}\n`);
      const stillBlocked = runHook(post, { root, file: sitedFile });
      check('wiring: PostToolUse blocks frozen prose that an annotation now sits in',
        stillBlocked.json?.decision === 'block' && stillBlocked.json.reason.includes('CM001'),
        `the baseline must not spare a block the author just annotated; got: ${stillBlocked.stdout || '(empty)'}`);

      const legacy = makeRepo({ onboarded: false });
      roots.push(legacy);
      const legacyFile = writeFixture(legacy, 'prose.ts', '// Load the config\nexport const e = 5;\n');
      const spared = runHook(post, { root: legacy, file: legacyFile });
      check('wiring: PostToolUse spares an un-onboarded tree',
        spared.stdout.trim() === '',
        `prose enforcement is opt-in per repo (cm init); got: ${spared.stdout}`);
    }
  } finally {
    for (const r of roots) rmSync(r, { recursive: true, force: true });
  }
}
