// Guidebook tier. `cm help` exists so an agent can ask what the rules are instead of guessing, from
// inside a repo that never installed the plugin — which only works if it ships with the checker and
// cannot go stale. These cases hold both halves: it renders from the live constants (so a new
// diagnostic, tag, edge kind or language shows up without anyone editing prose), and the vendored copy
// answers the same as the plugin's.

import { mkdtempSync, writeFileSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CODE_TABLE, TAGS, EDGE_KINDS } from '../cli/lib/parse.mjs';
import { PROFILES } from '../cli/lib/languages.mjs';
import { HELP_TOPICS, VERBS, renderHelp, tagHelpGaps, annotations, overview } from '../cli/lib/help.mjs';
import { stripGitEnv } from './git-env.mjs';

function run(cmd, cwd, ...args) {
  const res = spawnSync(process.execPath, [cmd, ...args], {
    cwd, encoding: 'utf8', env: { ...stripGitEnv(process.env), NO_COLOR: '1' },
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

    check('help: the topic blurb claims the real tag count too',
      overview().includes(`the ${TAGS.length} tags`),
      'the blurb above the tag table is the one count `help annotations` does not render');

    // cm:why the case that fails when the numeral goes back into the string — the check above
    //   passes on a hand-typed "5" for as long as TAGS has exactly five members (ISS-55)
    const sixthOverview = overview([...TAGS, 'sixth']);
    check('help: a sixth tag moves the blurb count with it',
      sixthOverview.includes('the 6 tags'),
      `the blurb read: ${sixthOverview.split('\n').filter((l) => / tags,/.test(l)).join(' | ') || '(no blurb line)'}`);

    // cm:why the noun is `tags` alone and the number is space-separated: CM204's own fix text says
    //   "two annotations", and "a six-tag overview" names a vocabulary, not this one's size (ISS-55)
    const SPELLED_COUNT = /\b(one|two|three|four|five|six|seven|eight|nine|ten)\s+tags\b/i;
    const filesUnder = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const full = join(dir, e.name);
      return e.isDirectory() ? filesUnder(full) : [full];
    });
    const spelled = filesUnder(join(pluginRoot, 'cli'))
      .filter((f) => SPELLED_COUNT.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(pluginRoot.length + 1));
    check('help: no file under cli/ spells the size of the tag vocabulary as a word',
      spelled.length === 0,
      `a numeral no constant derives, in: ${spelled.join(', ')}`);

    const TOPIC_KEYS = ['annotations', 'baseline', 'ci', 'codes', 'config',
      'languages', 'principles', 'spec', 'verbs', 'workflow'];
    check('help: `help topics` lists exactly these topics',
      JSON.stringify(renderHelp('topics').text.trim().split('\n').map((l) => l.trim())) === JSON.stringify(TOPIC_KEYS),
      `lists [${renderHelp('topics').text.trim().split('\n').map((l) => l.trim())}] against [${TOPIC_KEYS}]`);

    // cm:why `help topics` SORTS, so the golden above pins the key set and cannot see a reorder —
    //   this reads the order out of the rendered table, which is the order a reader chooses from (ISS-55)
    const TOPIC_ORDER = ['annotations', 'codes', 'baseline', 'languages', 'config',
      'ci', 'workflow', 'principles', 'spec', 'verbs'];
    const rendered = overview().slice(overview().indexOf('TOPICS  (cm help <topic>)'))
      .split('\n').map((l) => l.match(/^ {2}([a-z]+) {2,}\S/)).filter(Boolean).map((m) => m[1]);
    check('help: the topic table renders in its declared order, not sorted',
      JSON.stringify(rendered) === JSON.stringify(TOPIC_ORDER),
      `rendered [${rendered}] against [${TOPIC_ORDER}] — a set check passes a reorder of the table`);

    // cm:why the check above passes on the broken row `  cm:sixth  undefined`, so it cannot pin
    //   totality — it asks only whether the string appears somewhere in the text (ISS-53)
    const gaps = tagHelpGaps();
    check('help: the per-tag help table is total over TAGS',
      gaps.missing.length === 0 && gaps.partial.length === 0 && gaps.extra.length === 0,
      `no row: [${gaps.missing}] · incomplete row: [${gaps.partial}] · row for a non-tag: [${gaps.extra}]`);
    check('help: a row whose tag has left TAGS is reported too, not only a missing one',
      tagHelpGaps(TAGS.filter((t) => t !== 'why')).extra.includes('why'),
      'a table that is total in one direction still renders a row for a tag nothing accepts');
    check('help: a row that is present but incomplete is a gap, not a pass',
      tagHelpGaps(['guard'], { guard: { consumer: 'c', syntax: 's' } }).partial.includes('guard'),
      'a row missing one field renders that field as "undefined", which is the defect itself');

    // cm:guard a throw here is a failing case, never a dead run — helpCases taking the process down
    //   loses every suite after it, and this call is the one that renders a table with a gap (ISS-45)
    let sixth = null;
    let sixthErr = null;
    try {
      sixth = annotations([...TAGS, 'sixth']);
    } catch (err) {
      sixthErr = err;
    }
    const threw = (why) => (sixthErr ? `annotations() threw instead of reporting the gap: ${sixthErr.stack}` : why);
    check('help: a TAGS member with no help row does not earn a clean render',
      sixth?.ok === false, threw('ok:true is exit 0, so a broken table ships as a good guide'));
    check('help: that render names the member it has no row for',
      sixth?.text.includes('sixth') === true, threw('a gap a reader cannot name is a gap they cannot close'));
    check('help: that render prints no "undefined" anywhere',
      sixth !== null && !sixth.text.includes('undefined'),
      threw(`the word reached the reader anyway:\n${sixth?.text.split('\n').filter((l) => l.includes('undefined')).join('\n')}`));

    let bare = null;
    let bareErr = null;
    try {
      bare = annotations(['nosuchtag']);
    } catch (err) {
      bareErr = err;
    }
    check('help: a vocabulary with no sound row at all renders the guide rather than crashing',
      bare !== null && bare.text.includes('ANNOTATIONS'),
      bareErr
        ? `zero sound rows threw instead of rendering: ${bareErr.stack}`
        : 'the guidebook has to survive a table with no rows in it');

    // cm:why the order a reader meets the tags in is a decision no constant derives, so it is pinned
    //   here as a golden: a reorder of TAG_HELP has to be deliberate enough to move this line (ISS-53)
    const TEACHING_ORDER = ['guard', 'edge', 'flow', 'hack', 'why'];
    const whichOne = ann.slice(ann.indexOf('WHICH ONE'), ann.indexOf('Multi-line rationale'))
      .split('\n').map((l) => l.match(/\bcm:([a-z]+)\s*$/)).filter(Boolean).map((m) => m[1]);
    check('help: WHICH ONE teaches every tag, in the order it means to',
      JSON.stringify(whichOne) === JSON.stringify(TEACHING_ORDER),
      `rendered [${whichOne}] against [${TEACHING_ORDER}] — a count alone passes a section of identical rows`);
    check('help: that order is a permutation of TAGS, so no tag is missing from it',
      JSON.stringify([...whichOne].sort()) === JSON.stringify([...TAGS].sort()),
      `WHICH ONE teaches [${[...whichOne].sort()}] against TAGS [${[...TAGS].sort()}]`);

    // cm:why the bare word cannot be swept for: `help spec` renders the whole of SPEC.md, so the
    //   first time the grammar writes "undefined" the sweep would name the wrong file (ISS-53)
    const brokenRow = /cm:[a-z]+\s+undefined|^\s*(<leader>.*)?undefined\s*$/m;
    const undefTopics = HELP_TOPICS.filter((t) => brokenRow.test(renderHelp(t).text));
    check('help: no topic renders a row whose text is "undefined"',
      undefTopics.length === 0, `topics rendering one: ${undefTopics.join(', ')}`);

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
    execFileSync('git', ['-C', repo, 'init', '-q'], { env: stripGitEnv(process.env) });
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
