// Guidebook tier. `cm help` exists so an agent can ask what the rules are instead of guessing, from
// inside a repo that never installed the plugin — which only works if it ships with the checker and
// cannot go stale. These cases hold both halves: it renders from the live constants (so a new
// diagnostic, tag, edge kind or language shows up without anyone editing prose), and the vendored copy
// answers the same as the plugin's.

import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CODE_TABLE, TAGS, EDGE_KINDS } from '../cli/lib/parse.mjs';
import { PROFILES } from '../cli/lib/languages.mjs';
import { HELP_TOPICS, VERBS, renderHelp } from '../cli/lib/help.mjs';

function run(cmd, cwd, ...args) {
  const res = spawnSync(process.execPath, [cmd, ...args], {
    cwd, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' },
  });
  return { ...res, out: `${res.stdout}${res.stderr}` };
}

export function helpCases(pluginRoot, check) {
  const cm = join(pluginRoot, 'cli', 'cm.mjs');
  const roots = [];
  try {
    const root = mkdtempSync(join(tmpdir(), 'cm-help-'));
    roots.push(root);

    // cm:why reachable with no arguments and no repo — the guidebook must not need onboarding to be read
    for (const args of [[], ['help'], ['--help'], ['-h']]) {
      const r = run(cm, root, ...args);
      check(`help: \`cm ${args.join(' ') || '(no args)'}\` prints the overview`,
        r.status === 0 && /VERBS/.test(r.out) && /TOPICS/.test(r.out),
        `got status=${r.status}\n${r.out.slice(0, 300)}`);
    }

    for (const topic of HELP_TOPICS) {
      const r = run(cm, root, 'help', topic);
      check(`help: topic "${topic}" renders`, r.status === 0 && r.out.trim().length > 120,
        `got status=${r.status}, ${r.out.trim().length} chars`);
    }

    const listed = run(cm, root, 'help', 'topics').out.trim().split('\n').map((s) => s.trim()).sort();
    check('help: `help topics` lists exactly the real topics',
      JSON.stringify(listed) === JSON.stringify([...HELP_TOPICS].sort()),
      `listed [${listed}] vs real [${[...HELP_TOPICS].sort()}]`);

    const bad = run(cm, root, 'help', 'nosuchtopic');
    check('help: an unknown topic is exit 2 with the list',
      bad.status === 2 && /Topics:/.test(bad.out),
      `got status=${bad.status}\n${bad.out}`);

    // cm:why the point of rendering from constants: a new code/tag/kind/language cannot leave help behind
    const codes = renderHelp('codes').text;
    const missingCode = Object.keys(CODE_TABLE).filter((c) => !codes.includes(c));
    check('help: every diagnostic in CODE_TABLE appears in `help codes`',
      missingCode.length === 0, `missing: ${missingCode.join(', ')}`);

    const ann = renderHelp('annotations').text;
    const missingTag = TAGS.filter((t) => !ann.includes(`cm:${t}`));
    const missingKind = EDGE_KINDS.filter((k) => !ann.includes(k));
    check('help: every tag and edge kind appears in `help annotations`',
      missingTag.length === 0 && missingKind.length === 0,
      `tags missing: ${missingTag.join(', ')} · kinds missing: ${missingKind.join(', ')}`);
    check('help: the tag count it claims is the real one',
      ann.includes(`Exactly ${TAGS.length} tags`), 'a hand-typed count is a second source of truth');

    const langs = renderHelp('languages').text;
    const missingLang = Object.keys(PROFILES).filter((id) => !langs.includes(id));
    check('help: every language profile appears in `help languages`',
      missingLang.length === 0, `missing: ${missingLang.join(', ')}`);

    // cm:why the usage text and the dispatcher must agree — an unknown verb lists what really exists
    const unknown = run(cm, root, 'verfiy');
    check('help: a mistyped verb is exit 2, not a usage dump at exit 0',
      unknown.status === 2 && /unknown verb/.test(unknown.out) && /verify/.test(unknown.out),
      `a typo'd verb in CI must not be a green gate; got status=${unknown.status}\n${unknown.out}`);
    for (const [verb] of VERBS) {
      const r = run(cm, root, ...verb.split(' '));
      check(`help: verb "${verb}" is dispatched, not reported unknown`,
        !/unknown verb/.test(r.out), `\`cm ${verb}\` fell through to the default case:\n${r.out}`);
    }

    // cm:why `help spec` must slice the real file, and say something useful when it is not there
    const spec = run(cm, root, 'help', 'spec', '3');
    check('help: `help spec 3` slices §3 out of SPEC.md',
      spec.status === 0 && /^## §3/m.test(spec.out) && !/## §4/.test(spec.out),
      `expected only §3:\n${spec.out.slice(0, 200)}`);
    const noSection = run(cm, root, 'help', 'spec', '99');
    check('help: an unknown § lists the ones that exist',
      /no section §99/.test(noSection.out) && /§8 Registry/.test(noSection.out),
      noSection.out.slice(0, 200));

    // cm:why the whole reason it lives in the CLI: it has to work where the plugin does not exist
    const repo = mkdtempSync(join(tmpdir(), 'cm-help-repo-'));
    roots.push(repo);
    execFileSync('git', ['-C', repo, 'init', '-q']);
    writeFileSync(join(repo, 'a.ts'), 'export const a = 1;\n');
    run(cm, repo, 'install');
    const vendored = join(repo, '.forge', 'codemap', 'cm.mjs');
    const fromVendored = run(vendored, repo, 'help', 'workflow');
    check('help: the vendored copy answers the same guidebook',
      fromVendored.status === 0 && fromVendored.out === run(cm, root, 'help', 'workflow').out,
      `a repo without the plugin must get the identical guide:\n${fromVendored.out.slice(0, 200)}`);
    const vendoredSpec = run(vendored, repo, 'help', 'spec', '8');
    check('help: the vendored copy slices its own vendored SPEC.md',
      vendoredSpec.status === 0 && /^## §8 Registry/m.test(vendoredSpec.out),
      `install ships SPEC.md so this works offline:\n${vendoredSpec.out.slice(0, 200)}`);
  } finally {
    for (const r of roots) rmSync(r, { recursive: true, force: true });
  }
}
