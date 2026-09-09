// §11 tier. The measure and the rule are one verdict, so these cases pin both at once: what counts as
// story, what the channels add up to, and that a repo can read the total without editing a file.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { analyzeFile } from '../cli/lib/analyze.mjs';
import { scanComments } from '../cli/lib/scan.mjs';
import { profileFor } from '../cli/lib/languages.mjs';
import { buildGraph, advisoryDiags } from '../cli/lib/graph.mjs';
import { DEFAULT_REGISTRY } from '../cli/lib/registry.mjs';
import { baselineKey, CM_IGNORE_RE, PROSE_CODES } from '../cli/lib/parse.mjs';
import { narrativeOf, retells, fileMass, massOf, narrativeMass, NARRATIVE_MIN } from '../cli/lib/mass.mjs';
import { stripGitEnv } from './git-env.mjs';

const STORY = 'the pool and the registry must stay in step (ISS-9). It was one lock per caller until'
  + ' 2026-08-30, which let a second writer take the row out from under a live reader, and the six'
  + ' suites that failed on it were all green on a serial re-run.';

const RULE = 'the pool and the registry must stay in step (ISS-9) — a caller that reads one without the'
  + ' other sees a device that no longer exists, and the retry engine hands it work it cannot claim.';

const NO_CITATION = 'this was one lock per caller and it let a second writer take the row out from under'
  + ' a live reader, and the six suites that failed on it were all green on a serial re-run, every time.';

const cases = [
  { name: 'a citation followed by the incident retold is story', text: STORY, retells: true },
  { name: 'a citation with the rule and its consequence keeps its characters', text: RULE, retells: false },
  { name: 'narrative with no citation is not billed, however long', text: NO_CITATION, retells: false },
  { name: 'a citation with nothing after it is silent', text: 'callers must hold the run lock (ISS-9)', retells: false },
  { name: 'a short clause past the citation is under the floor', text: 'callers must hold the run lock (ISS-9). It was not always so.', retells: false },
  { name: 'a bare measured citation is the evidence the doctrine asks for', text: 'the budget is per run. Measured 2026-08-14 on pipeline-preserve.test.tsx.', retells: false },
];

function unitCases(check) {
  for (const t of cases) {
    check(`mass: ${t.name}`, Boolean(retells(t.text)) === t.retells,
      `retells=${Boolean(retells(t.text))} chars=${narrativeOf(t.text).chars} floor=${NARRATIVE_MIN}: ${t.text.slice(0, 70)}`);
  }

  check('mass: the story is counted per sentence, not per annotation',
    narrativeOf(STORY).chars > 0 && narrativeOf(STORY).chars < STORY.length,
    `a whole-annotation count would bill the rule too: ${narrativeOf(STORY).chars} of ${STORY.length}`);

  // cm:guard CM303 must read `retells` and nothing of its own — the number a repo is asked to make fall
  //   is worthless if the rule flags a different set than the total counts
  const src = [
    `// cm:guard ${STORY}`,
    'export function f() { return 1; }',
    '',
    `// cm:why ${RULE}`,
    'export function g() { return 2; }',
  ].join('\n');
  const res = analyzeFile({ relPath: 'pool.ts', src, reg: DEFAULT_REGISTRY });
  const diags = advisoryDiags(buildGraph([{ relPath: 'pool.ts', ...res }]), { root: '/nonexistent' });
  const codes = diags.map((d) => d.code);
  check('mass: CM303 fires once, on the annotation that retells',
    codes.filter((c) => c === 'CM303').length === 1,
    `expected exactly one CM303 over one story and one rule, got [${codes}]`);
  check('mass: CM303 is advisory, so it cannot gate',
    diags.every((d) => d.tier === 'advisory'),
    `tiers: ${diags.map((d) => d.tier).join(', ')}`);
  check('mass: the footer total counts the annotations CM303 names',
    narrativeMass([res]).retelling === codes.filter((c) => c === 'CM303').length,
    `narrativeMass says ${narrativeMass([res]).retelling}, CM303 fired ${codes.filter((c) => c === 'CM303').length} time(s)`);
}

// cm:guard the fixture must carry EVERY tag and both escape hatches — one guard and one why is a
//   fixture that passes whether or not the rule and the number agree, which is the thing under test
function agreementCases(check) {
  const src = [
    `// cm:guard ${STORY}`,
    'export function f() { return 1; }',
    '',
    `// cm:why ${RULE}`,
    'export function g() { return 2; }',
    '',
    `// cm:flow intake/receive — ${STORY}`,
    'export function h() { return 3; }',
    '',
    `// cm:hack ISS-9 until:the lock moves into the writer — ${STORY.replace('(ISS-9)', '').replace('2026-08-30', 'the rewrite')}`,
    'export function i() { return 4; }',
    '',
    '// cm:ignore CM303 — the past tense IS the invariant here',
    `// cm:guard ${STORY}`,
    'export function j() { return 5; }',
  ].join('\n');
  const res = analyzeFile({ relPath: 'every-tag.ts', src, reg: DEFAULT_REGISTRY });
  const g = buildGraph([{ relPath: 'every-tag.ts', ...res }]);
  // cm:edge protocol -> cli/cm.mjs — the graph tiers raise their diagnostics
  //   long after analyzeFile's own ignore pass, so the CLI filters them there and this mirrors it
  const raised = advisoryDiags(g, { root: '/nonexistent' }).filter((d) => d.code === 'CM303');
  const fired = raised.filter((d) => !(res.ignores?.get(d.line)?.has('CM303') || res.ignores?.get(d.line - 1)?.has('CM303')));
  const counted = fileMass({ relPath: 'every-tag.ts', src, res });

  check('mass: CM303 reaches a cm:flow, which cm mass also counts',
    fired.some((d) => d.line === 7),
    `a flow step's story is billed by cm mass, so the rule must reach it; fired at [${fired.map((d) => d.line)}]`);
  check('mass: a cm:hack whose citation is in its required head is billed and named',
    fired.some((d) => d.line === 10),
    `parseAnnotation keeps only the prose in .text, so the ISS- reaches the gate only through .raw; fired at [${fired.map((d) => d.line)}]`);
  check('mass: cm:ignore CM303 clears the diagnostic and the number together',
    raised.some((d) => d.line === 14) && !fired.some((d) => d.line === 14) && counted.retelling === fired.length,
    `ignored at line 14; counted ${counted.retelling} retelling(s) against ${fired.length} reported of ${raised.length} raised at [${raised.map((d) => d.line)}]`);
  // cm:guard assert the EXACT total, never `not billed as prose` — the bug this replaces billed the
  //   directive to the annotation channel, which a check on the other channels passes over in silence
  check('mass: an ignore directive is billed to no channel at all',
    counted.annotation === 1233 && counted.doc === 0 && counted.live === 0,
    `the escape hatch must not add to the total it clears: annotation=${counted.annotation} (want 1233,`
      + ` the five annotations without the 54-char directive) doc=${counted.doc} live=${counted.live}`);
}

// cm:guard conservation is the property a channel bug breaks — every comment carrying text is billed
//   once, so the channels plus the ignore directives must equal the file's whole comment text
function conservationCases(check) {
  const src = [
    '#!/usr/bin/env node',
    '// A module header orients a reader.',
    '// It may run to several lines.',
    '',
    '/**',
    ' * A doc block the tooling parses.',
    ' * @param a the first one',
    ' */',
    'export function doc(a) { return a; }',
    '',
    '/* cm:guard misplaced in a block, which is CM003',
    '   and this line rides along with it */',
    'export const misplaced = 1;',
    '',
    '// cm:guard callers must hold the run lock',
    '// and release it on every path out',
    'export function locked() {}',
    '',
    '// cm:edge bogus -> nowhere.ts — a malformed kind forfeits its wrap',
    '// so this line is prose again',
    'export const broken = 2;',
    '',
    '// cm:ignore CM001 — inherited, and nobody owns this file',
    '// silenced narration nobody froze',
    'export const silenced = 3;',
    '',
    'export const trailing = 4; // a comment sharing a line with code',
    '',
    '// plain narration nobody froze',
    'export const narrated = 5;',
  ].join('\n');
  const res = analyzeFile({ relPath: 'torture.ts', src, reg: DEFAULT_REGISTRY });
  const m = fileMass({ relPath: 'torture.ts', src, res });

  const { comments } = scanComments(src, profileFor('torture.ts'));
  const whole = comments.filter((c) => c.text).reduce((n, c) => n + c.text.length, 0);
  const directives = comments.filter((c) => CM_IGNORE_RE.test(c.text ?? '')).reduce((n, c) => n + c.text.length, 0);
  const billed = m.annotation + m.frozen + m.live + m.doc + m.header;

  check('mass: the channels plus the ignore directives are the file\'s whole comment text',
    billed + directives === whole,
    `billed ${billed} + directives ${directives} != ${whole} of comment text — ${whole - billed - directives} char(s) counted twice or lost`);

  // cm:guard the count above reads CM_IGNORE_RE on BOTH sides, so it holds for any predicate and
  //   cannot see one that widened — this literal is the only oracle left for what a directive is
  // cm:guard this 54 is the DIRECTIVE's length and the 54 in `want` below is the doc block's — two
  //   unrelated quantities that happen to match, so reconciling one against the other kills an oracle
  check('mass: the fixture\'s one ignore directive is 54 chars, and they are billed to no channel',
    directives === 54,
    `directives ${directives} != 54 — a widened CM_IGNORE_RE swallows prose the channels should bill`);

  const adjacent = [
    '// cm:ignore CM001 — one',
    '// cm:ignore CM301 — two',
    'export const pair = 6;',
  ].join('\n');
  const adjRes = analyzeFile({ relPath: 'adjacent.ts', src: adjacent, reg: DEFAULT_REGISTRY });
  const adj = fileMass({ relPath: 'adjacent.ts', src: adjacent, res: adjRes });
  const adjBilled = adj.annotation + adj.frozen + adj.live + adj.doc + adj.header;
  const adjWhole = scanComments(adjacent, profileFor('adjacent.ts')).comments
    .filter((c) => c.text).reduce((n, c) => n + c.text.length, 0);
  check('mass: the adjacent-directive fixture really carries two directives, 42 chars of them',
    adjWhole === 42,
    `adjacent fixture holds ${adjWhole} chars of comment text, not 42 — the check below passes`
      + ' vacuously if this fixture ever stops producing comments');
  check('mass: two ignore directives on consecutive lines are both billed to no channel',
    adjBilled === 0,
    `adjacent directives billed ${adjBilled} char(s) — a stateful CM_IGNORE_RE leaves lastIndex past`
      + ' the first, so the second stops matching its own anchor and lands in a prose channel');
  // cm:guard every channel is pinned EXACTLY — the fixture carries unsilenced prose too, so `live > 0`
  //   passes with the ignored CM001 mis-billed as a doc comment and conservation still holding
  // cm:guard doc is exactly the ONE `/** */` block, 54 chars — §4.2 makes only that form
  //   documentation, so the 79-char `/* */` block is prose and anything else in doc is ISS-40 again
  const want = { annotation: 71, frozen: 0, live: 263, doc: 54, header: 61 };
  const got = Object.fromEntries(Object.keys(want).map((k) => [k, m[k]]));
  check('mass: each channel bills exactly what belongs to it, silenced prose included',
    JSON.stringify(got) === JSON.stringify(want),
    `channels: ${JSON.stringify(got)} != ${JSON.stringify(want)} — the 31 silenced chars belong to live,`
      + ' and a channel that moved them keeps conservation while getting the attribution wrong');
}

function channelCases(check) {
  const src = [
    '// A module header orients a reader.',
    '// It may run to several lines.',
    '',
    '/** A doc comment the tooling parses. */',
    'export type Row = { id: number };',
    '',
    '// cm:guard callers must hold the run lock',
    '// and release it on every path out',
    'export function f() {',
    '  // plain narration nobody froze',
    '  return 1;',
    '}',
  ].join('\n');
  const res = analyzeFile({ relPath: 'row.ts', src, reg: DEFAULT_REGISTRY });
  const m = fileMass({ relPath: 'row.ts', src, res });

  check('mass: the header is its own channel', m.header > 0, `header=${m.header}`);
  check('mass: a doc comment is its own channel', m.doc > 0, `doc=${m.doc}`);
  check('mass: an annotation and the line it wraps onto are one annotation',
    m.annotations === 1 && m.annotation > 60, `annotations=${m.annotations} chars=${m.annotation}`);
  check('mass: unfrozen prose is live, not frozen',
    m.live > 0 && m.frozen === 0, `live=${m.live} frozen=${m.frozen}`);

  // cm:guard template narration is PROSE, never machine-consumed (ISS-28). `<!--` is `kind: block`, so
  //   §4.2's rule now bills it to live and this pins the outcome rather than the branch above (ISS-48)
  {
    const sfcSrc = [
      '<template>',
      '  <!-- the sidebar collapses below the medium breakpoint -->',
      '  <div/>',
      '</template>',
    ].join('\n');
    const sfcRes = analyzeFile({ relPath: 'mass.vue', src: sfcSrc, reg: DEFAULT_REGISTRY });
    const sm = fileMass({ relPath: 'mass.vue', src: sfcSrc, res: sfcRes });
    check('mass: an SFC template comment is live prose, not a doc comment',
      sm.live > 0 && sm.doc === 0,
      `live=${sm.live} doc=${sm.doc} — a template comment is exempt from CM001 but is still prose, `
      + 'and billing it as doc reports it as machine-consumed');
  }

  // cm:guard the orphan is pinned under BOTH tiers — CM001 carries it to prose when `grammar` is on,
  //   so a case run only at the default would pass with the fallback still billing it as doc (ISS-36)
  {
    const orphan = 'and a third line is the orphan no channel loads';
    const overSrc = [
      '/** A doc comment the tooling parses. */',
      'export type Row = { id: number };',
      '',
      '// cm:guard callers must hold the run lock',
      '// and release it on every path out',
      `// ${orphan}`,
      'export function f() {}',
    ].join('\n');
    for (const grammar of [false, true]) {
      const reg = { ...DEFAULT_REGISTRY, enforce: { ...DEFAULT_REGISTRY.enforce, grammar } };
      const res = analyzeFile({ relPath: 'over.ts', src: overSrc, reg });
      const om = fileMass({ relPath: 'over.ts', src: overSrc, res });
      check(`mass: an annotation's orphaned continuation line is live prose (grammar: ${grammar})`,
        om.live === orphan.length,
        `live=${om.live} doc=${om.doc}, expected live=${orphan.length} — the line past the one adopted `
        + 'wrap is narration, and CM204 neither is prose-family nor sits on the orphan\'s own line');
      check(`mass: the orphaned continuation line is not a doc comment (grammar: ${grammar})`,
        om.doc === 33,
        `doc=${om.doc}, expected the 33 chars of the real doc comment alone — a doc figure carrying the `
        + 'orphan reports narration as machine-consumed and hides it from the §11 number');

      const { comments } = scanComments(overSrc, profileFor('over.ts'));
      const whole = comments.filter((c) => c.text).reduce((n, c) => n + c.text.length, 0);
      check(`mass: an overflowing annotation keeps conservation (grammar: ${grammar})`,
        om.annotation + om.frozen + om.live + om.doc + om.header === whole,
        `billed ${om.annotation + om.frozen + om.live + om.doc + om.header} != ${whole} of comment text`);
    }
  }

  // cm:guard the orphan is claimed by its own FORM, never by its line number — a line-keyed rescue
  //   passes every case above and bills a doc block sharing the orphan's line to prose (ISS-48)
  {
    const shSrc = [
      '// cm:guard callers must hold the run lock',
      '// and release it on every path out',
      '/** a doc block the tooling parses */ // the orphan text',
      'export function f() {}',
    ].join('\n');
    const shReg = { ...DEFAULT_REGISTRY, enforce: { ...DEFAULT_REGISTRY.enforce, grammar: false } };
    const shRes = analyzeFile({ relPath: 'shared.ts', src: shSrc, reg: shReg });
    const sm = fileMass({ relPath: 'shared.ts', src: shSrc, res: shRes });
    // cm:guard the PREMISE is asserted, not only the split — the two figures below also hold for a
    //   fixture that is merely a doc block and a trailing comment, so a scanner change empties them
    check('mass: line 3 of the shared-line fixture really is an orphan of the run',
      shRes.diags.some((d) => d.code === 'CM204' && d.line === 1),
      `diags=${JSON.stringify(shRes.diags.map((d) => `${d.code}@${d.line}`))}, expected CM204 at line 1 — `
      + 'without it the annotation never overflowed and the two cases below test a different shape');
    check('mass: a doc block sharing the orphan\'s line keeps its own doc channel',
      sm.doc === 30,
      `doc=${sm.doc} live=${sm.live}, expected the 30 chars of the doc block alone — the orphan and the `
      + 'doc block share line 3, so a rescue keyed on the line claims the block with it');
    check('mass: the orphan sharing a doc block\'s line is still live prose',
      sm.live === 15,
      `live=${sm.live} doc=${sm.doc}, expected the 15 chars of the orphan alone — §4.2's form rule bills `
      + 'it, so removing the line-keyed rescue must not take the orphan out of prose with it');

    // cm:guard the SAME fixture is pinned at `grammar: true`, where the orphan raises the line's only
    //   CM001 and the split therefore holds only while that diagnostic is matched by TEXT (ISS-51)
    const onRes = analyzeFile({ relPath: 'shared.ts', src: shSrc, reg: DEFAULT_REGISTRY });
    const on = fileMass({ relPath: 'shared.ts', src: shSrc, res: onRes });
    // cm:guard the PREMISE again — one CM001, carrying the ORPHAN's text. Two, or one carrying the doc
    //   block's, and the two cases below would pass on a shape that cannot show the bug (ISS-51)
    const shOn = onRes.diags.filter((d) => d.code === 'CM001' && d.line === 3);
    check('mass: at the prose tier the shared line raises one CM001, and it is the orphan\'s',
      shOn.length === 1 && shOn[0].text === 'the orphan text',
      `CM001 at line 3: ${JSON.stringify(shOn.map((d) => d.text))}, expected exactly ["the orphan text"] — `
      + 'the doc block is hover documentation and raises none of its own');
    check('mass: at the prose tier the orphan\'s CM001 does not reach the doc block sharing its line',
      on.doc === 30,
      `doc=${on.doc} live=${on.live}, expected the 30 chars of the doc block — a diagnostic keyed on the `
      + 'LINE bills the doc block from the orphan\'s CM001 too, which was live=45 doc=0 (ISS-51)');
    check('mass: at the prose tier the orphan is billed from its own CM001',
      on.live === 15,
      `live=${on.live} doc=${on.doc}, expected the 15 chars of the orphan alone`);

    // cm:guard two prose comments of DIFFERENT text on one physical line, one of them frozen — the only
    //   shape that can see `proseAt` billing both from one diagnostic, which was last-wins (ISS-51)
    const twoSrc = [
      'export const a = 1;',
      '',
      '/* the first narration */ // the second narration',
      'export const b = 2;',
    ].join('\n');
    const twoFrozen = new Set([baselineKey('the first narration')]);
    const twoRes = analyzeFile({ relPath: 'two.ts', src: twoSrc, reg: DEFAULT_REGISTRY, frozen: twoFrozen });
    const two = fileMass({ relPath: 'two.ts', src: twoSrc, res: twoRes, frozen: twoFrozen });
    const twoDiags = twoRes.diags.filter((d) => d.code === 'CM001' && d.line === 3);
    check('mass: the two-comment line really raises one CM001 per comment',
      twoDiags.length === 2 && twoDiags[0].text === 'the first narration' && twoDiags[1].text === 'the second narration',
      `CM001 at line 3: ${JSON.stringify(twoDiags.map((d) => d.text))}, expected both texts in scan order — `
      + 'one diagnostic, or either text missing, and the split below proves nothing about the keying');
    check('mass: the frozen comment sharing a line with an unfrozen one is billed frozen',
      two.frozen === 19,
      `frozen=${two.frozen} live=${two.live}, expected the 19 chars of the frozen block alone — a Map keyed `
      + 'on the line kept the LAST diagnostic written, so the unfrozen one decided both (ISS-51)');
    check('mass: the unfrozen comment sharing that line is billed live',
      two.live === 20,
      `live=${two.live} frozen=${two.frozen}, expected the 20 chars of the unfrozen comment alone`);
    const twoWhole = scanComments(twoSrc, profileFor('two.ts')).comments
      .filter((c) => c.text).reduce((n, c) => n + c.text.length, 0);
    check('mass: two prose comments on one line keep conservation',
      two.annotation + two.frozen + two.live + two.doc + two.header === twoWhole,
      `billed ${two.annotation + two.frozen + two.live + two.doc + two.header} != ${twoWhole} of comment text`);

    // cm:guard the run stands ALONE in this fixture — the sum is the two orphans, so a prose line under
    //   no annotation sharing it would move channel under ISS-40 and fail this on a false cause
    const runSrc = [
      '// cm:guard callers must hold the run lock',
      '// and release it on every path out',
      '// and a third line is the first orphan',
      '// and a fourth line is the second orphan',
      'export function f() {}',
    ].join('\n');
    const runRes = analyzeFile({ relPath: 'run.ts', src: runSrc, reg: shReg });
    const mm = fileMass({ relPath: 'run.ts', src: runSrc, res: runRes });
    check('mass: every line past the wrap reaches prose, not just the first',
      mm.live === 36 + 38,
      `live=${mm.live} doc=${mm.doc}, expected the 36 + 38 chars of both orphans — a rescue that stopped `
      + 'at the first would leave the rest of the run billed as machine-consumed');
  }

  // cm:guard a profile whose OWN `enforce: false` turns the tier off is covered — registry.mjs reads
  //   `prof.enforce` ahead of the registry key, so sh/sql/yaml/docker carry this bug unconfigured (ISS-36)
  {
    const shSrc = [
      '# cm:guard callers must hold the run lock',
      '# and release it on every path out',
      '# and a third line is the orphan no channel loads',
      'run_it',
    ].join('\n');
    const res = analyzeFile({ relPath: 'deploy.sh', src: shSrc, reg: DEFAULT_REGISTRY });
    const sm = fileMass({ relPath: 'deploy.sh', src: shSrc, res });
    check('mass: an orphan in a profile with grammar off by profile is live prose',
      sm.live === 47 && sm.doc === 0,
      `live=${sm.live} doc=${sm.doc} — the default registry leaves sh's own enforce: false in force, `
      + 'so this shape needs no registry key at all');
  }

  // cm:guard the header claims the orphan BEFORE prose does — §4.1 is CM204's own advice for this
  //   shape, so a header channel that shed the line would bill orientation prose as narration (ISS-36)
  {
    const hdrSrc = [
      '// cm:guard callers must hold the run lock',
      '// and release it on every path out',
      '// and a third line still inside the module header',
      '',
      'export function f() {}',
    ].join('\n');
    const reg = { ...DEFAULT_REGISTRY, enforce: { ...DEFAULT_REGISTRY.enforce, grammar: false } };
    const res = analyzeFile({ relPath: 'hdr.ts', src: hdrSrc, reg });
    const hm = fileMass({ relPath: 'hdr.ts', src: hdrSrc, res });
    check('mass: an annotation overflowing inside the module header is billed to the header',
      hm.header > 0 && hm.live === 0,
      `header=${hm.header} live=${hm.live} doc=${hm.doc}`);
  }

  const frozen = new Set([baselineKey('plain narration nobody froze')]);
  const res2 = analyzeFile({ relPath: 'row.ts', src, reg: DEFAULT_REGISTRY, frozen });
  const m2 = fileMass({ relPath: 'row.ts', src, res: res2, frozen });
  check('mass: a baselined line moves to the frozen channel, and the total does not move',
    m2.frozen > 0 && m2.live === 0 && m2.frozen === m.live,
    `frozen=${m2.frozen} live=${m2.live} vs live=${m.live}`);

  // cm:guard a SITED prose line is never frozen — cli/cm.mjs bypasses the baseline on `d.sited`, so a
  //   frozen channel that captured it would read as paid while `cm verify` still errored on it (ISS-41)
  {
    const sitedSrc = [
      'export const x = 1;',
      '',
      '// cm:guard callers must hold the run lock',
      '// and release it on every path out',
      '// the orphan that somebody froze back when grammar was on',
      'export function f() {}',
    ].join('\n');
    const bare = analyzeFile({ relPath: 'sited.ts', src: sitedSrc, reg: DEFAULT_REGISTRY });
    const orphan = bare.diags.find((d) => d.code === 'CM001' && d.sited);
    // cm:guard dereferencing the orphan aborts the SUITE — ISS-45's catch keeps the count line but
    //   loses the 21 checks below, so this is a case of its own and they still run (ISS-43, ISS-45)
    check('mass: the sited fixture raises a sited CM001 to freeze in the first place',
      Boolean(orphan?.blockKey),
      `diags=${JSON.stringify(bare.diags.map((d) => `${d.code}${d.sited ? ' sited' : ''}`))} — the two `
      + 'cases below cannot run without a sited CM001 carrying a block key');
    if (orphan?.blockKey) {
      const byBlock = new Set([orphan.blockKey]);
      const sres = analyzeFile({ relPath: 'sited.ts', src: sitedSrc, reg: DEFAULT_REGISTRY, frozen: byBlock });
      const sm = fileMass({ relPath: 'sited.ts', src: sitedSrc, res: sres, frozen: byBlock });
      check('mass: a sited prose line stays live even when its block key is frozen',
        sm.frozen === 0 && sm.live > 0,
        `frozen=${sm.frozen} live=${sm.live} — the block key froze a line §4 says cannot be frozen`);

      const byOwnKey = new Set([baselineKey(orphan.text ?? orphan.message)]);
      const ores = analyzeFile({ relPath: 'sited.ts', src: sitedSrc, reg: DEFAULT_REGISTRY, frozen: byOwnKey });
      const om2 = fileMass({ relPath: 'sited.ts', src: sitedSrc, res: ores, frozen: byOwnKey });
      check('mass: a sited prose line stays live even when its OWN key is frozen',
        om2.frozen === 0 && om2.live > 0,
        `frozen=${om2.frozen} live=${om2.live}`);
    }
  }

  // cm:guard the live figure may not move with the prose TIER — the tier decides what is reported,
  //   never what a comment IS, and a repo at `grammar: false` still has to read its narration (ISS-40)
  {
    const plainSrc = ['export const x = 1;', '', '// plain narration with no annotation anywhere near it', 'export const y = 2;'].join('\n');
    const off = { ...DEFAULT_REGISTRY, enforce: { ...DEFAULT_REGISTRY.enforce, grammar: false } };
    const mOff = fileMass({ relPath: 'plain.ts', src: plainSrc, res: analyzeFile({ relPath: 'plain.ts', src: plainSrc, reg: off }) });
    const mOn = fileMass({ relPath: 'plain.ts', src: plainSrc, res: analyzeFile({ relPath: 'plain.ts', src: plainSrc, reg: DEFAULT_REGISTRY }) });
    check('mass: a line comment bills the same live prose at either prose tier',
      mOff.live === mOn.live && mOff.live > 0,
      `grammar:false live=${mOff.live} vs grammar:true live=${mOn.live}`);
    check('mass: a line comment reaches no doc channel with the prose tier off',
      mOff.doc === 0, `doc=${mOff.doc} — narration billed as machine-consumed documentation`);
  }

  // cm:guard a `/* */` BLOCK inverts on the tier exactly as a line comment did — §4.2 makes only
  //   `/** */` documentation, so billing a bare block to doc is ISS-40 surviving by another form
  {
    const blkSrc = ['export const x = 1;', '', '/* plain narration in a block, nobody parses this */', 'export const y = 2;'].join('\n');
    const off = { ...DEFAULT_REGISTRY, enforce: { ...DEFAULT_REGISTRY.enforce, grammar: false } };
    const bOff = fileMass({ relPath: 'blk.ts', src: blkSrc, res: analyzeFile({ relPath: 'blk.ts', src: blkSrc, reg: off }) });
    const bOn = fileMass({ relPath: 'blk.ts', src: blkSrc, res: analyzeFile({ relPath: 'blk.ts', src: blkSrc, reg: DEFAULT_REGISTRY }) });
    check('mass: a bare block comment bills the same live prose at either prose tier',
      bOff.live === bOn.live && bOff.live > 0,
      `grammar:false live=${bOff.live} doc=${bOff.doc} vs grammar:true live=${bOn.live} doc=${bOn.doc}`);
    check('mass: a bare block comment reaches no doc channel at either tier',
      bOff.doc === 0 && bOn.doc === 0, `doc off=${bOff.doc} on=${bOn.doc}`);
  }

  // cm:guard a `/** */` DOC block is the one form that stays documentation — §4.2 exempts it by form,
  //   so a change that swept every block into prose would pass the case above and break this one
  {
    const docSrc = ['export const x = 1;', '', '/** a doc block the tooling parses */', 'export type Row = { id: number };'].join('\n');
    const off = { ...DEFAULT_REGISTRY, enforce: { ...DEFAULT_REGISTRY.enforce, grammar: false } };
    const dOff = fileMass({ relPath: 'doc.ts', src: docSrc, res: analyzeFile({ relPath: 'doc.ts', src: docSrc, reg: off }) });
    check('mass: a doc block is billed to doc, not swept into prose',
      dOff.doc > 0 && dOff.live === 0, `doc=${dOff.doc} live=${dOff.live}`);
  }

  // cm:guard a MALFORMED annotation is prose too — CM002 is not prose-family and the comment is not in
  //   `res.annotations`, so nothing above the fallback claims it and only its form does (ISS-40)
  for (const [name, line] of [['untagged', '// cm: prose that wrapped onto a cm: line'], ['unknown-tag', '// cm:note prose with a readable but unknown tag']]) {
    const src2 = ['export const x = 1;', '', line, 'export const y = 2;'].join('\n');
    const mm = fileMass({ relPath: `${name}.ts`, src: src2, res: analyzeFile({ relPath: `${name}.ts`, src: src2, reg: DEFAULT_REGISTRY }) });
    check(`mass: a ${name} cm: comment is billed to live, not doc`,
      mm.live > 0 && mm.doc === 0, `live=${mm.live} doc=${mm.doc}`);
  }

  // cm:guard a `#` profile sets `enforce: false` in the profile itself, so this is the DEFAULT reading
  //   for every shell and yaml file in every repo — not a tier somebody chose to turn off (ISS-40)
  {
    const shSrc = ['#!/usr/bin/env bash', 'set -e', '', '# the retry count matches the gateway timeout', 'echo hi'].join('\n');
    const sm2 = fileMass({ relPath: 'deploy.sh', src: shSrc, res: analyzeFile({ relPath: 'deploy.sh', src: shSrc, reg: DEFAULT_REGISTRY }) });
    check('mass: a shell comment is live prose with no registry override written',
      sm2.live > 0 && sm2.doc === 0, `live=${sm2.live} doc=${sm2.doc}`);
  }

  // cm:guard this pins the OUTCOME, not the branch — §4.2's rule bills a silenced block to live by
  //   itself, so deleting `ignoredProse` leaves this green; its own case is a `doc` form (ISS-48)
  {
    const ignSrc = [
      'export const x = 1;',
      '',
      '// cm:ignore CM001 — inherited, and nobody owns this file',
      '/* silenced narration in a block comment */',
      'export const y = 2;',
    ].join('\n');
    const im = fileMass({ relPath: 'ign.ts', src: ignSrc, res: analyzeFile({ relPath: 'ign.ts', src: ignSrc, reg: DEFAULT_REGISTRY }) });
    check('mass: a silenced block comment is live prose, not a doc comment',
      im.live > 0 && im.doc === 0, `live=${im.live} doc=${im.doc}`);

    // cm:guard the case above passes with a line-keyed rescue reinstated, because its comment is the only
    //   one on the line — this one shares the line with a `doc` block, which is what saw it (ISS-51)
    const igDocSrc = [
      'export const x = 1;',
      '',
      '// cm:ignore CM001 — inherited, and nobody owns this file',
      '/** a doc block the tooling parses */ // silenced narration',
      'export const y = 2;',
    ].join('\n');
    const igDocRes = analyzeFile({ relPath: 'igndoc.ts', src: igDocSrc, reg: DEFAULT_REGISTRY });
    const igDoc = fileMass({ relPath: 'igndoc.ts', src: igDocSrc, res: igDocRes });
    // cm:guard the PREMISE: the directive really silences the line, so the two figures below are the
    //   silenced reading and not merely a doc block beside an unremarkable comment (ISS-51)
    check('mass: the ignore directive really silences CM001 on the shared line',
      igDocRes.diags.length === 0 && !!igDocRes.ignores?.get(3)?.has('CM001'),
      `diags=${JSON.stringify(igDocRes.diags.map((d) => `${d.code}@${d.line}`))} `
      + `ignores=${JSON.stringify([...(igDocRes.ignores ?? new Map())].map(([l, c]) => `${l}:${[...c]}`))}`);
    check('mass: a doc block sharing a silenced line keeps its own doc channel',
      igDoc.doc === 30,
      `doc=${igDoc.doc} live=${igDoc.live}, expected the 30 chars of the doc block — a channel keyed on the `
      + 'silenced LINE took the doc block with it, which was live=48 doc=0 (ISS-51)');
    check('mass: the silenced narration sharing that line is still live prose',
      igDoc.live === 18,
      `live=${igDoc.live} doc=${igDoc.doc}, expected the 18 chars of the silenced comment alone — §4.2's `
      + 'form rule bills it, so dropping the line-keyed branch must not take it out of prose');
  }

  // cm:guard a profile with no `docBlocksAllowed` raises CM001 on its OWN doc form, so that form is
  //   prose there — billing a silenced one to doc makes cm:ignore an escape from the MEASURE (ISS-51)
  {
    const phpReg = { ...DEFAULT_REGISTRY, languages: { ...(DEFAULT_REGISTRY.languages ?? {}), php: { docPolicy: 'banned' } } };
    const body = ['<?php', '$x = 1;', '', '/** narration in a php docblock */', '$y = 2;'];
    const loud = body.join('\n');
    const hushed = [...body.slice(0, 3), '// cm:ignore CM001 — inherited, and nobody owns this file', ...body.slice(3)].join('\n');
    const massOfPhp = (src) => fileMass({ relPath: 'a.php', src, res: analyzeFile({ relPath: 'a.php', src, reg: phpReg }) });
    const loudM = massOfPhp(loud);
    const hushedM = massOfPhp(hushed);
    // cm:guard the PREMISE: unsilenced, the php doc form really does raise CM001, which is the profile
    //   calling it prose — without that the two figures below say nothing about silencing (ISS-51)
    check('mass: a php doc form under docPolicy banned really raises CM001 of its own',
      analyzeFile({ relPath: 'a.php', src: loud, reg: phpReg }).diags.some((d) => d.code === 'CM001'),
      `diags=${JSON.stringify(analyzeFile({ relPath: 'a.php', src: loud, reg: phpReg }).diags.map((d) => d.code))}`);
    check('mass: a silenced doc form in a profile that allows no doc blocks is still live prose',
      hushedM.live === 27 && hushedM.doc === 0,
      `live=${hushedM.live} doc=${hushedM.doc}, expected live=27 doc=0 — the profile raises CM001 on this `
      + 'form, so §4.2 may not exempt it and a silenced one must not land in doc (ISS-51)');
    check('mass: the ignore directive moves no characters between channels',
      hushedM.live === loudM.live && hushedM.doc === loudM.doc,
      `silenced live=${hushedM.live} doc=${hushedM.doc} vs unsilenced live=${loudM.live} doc=${loudM.doc} — `
      + 'a directive that moves prose into the machine-consumed figure is an escape from the measure');
    // cm:guard the PREMISE of the pair above: the silenced verdict really reaches mass, keyed on the
    //   comment — without it the two figures agree because NEITHER is prose (ISS-51)
    check('mass: a silenced prose verdict reaches mass carrying the comment that raised it',
      analyzeFile({ relPath: 'a.php', src: hushed, reg: phpReg }).silencedProse
        ?.some((d) => d.code === 'CM001' && d.text === 'narration in a php docblock'),
      `silencedProse=${JSON.stringify(analyzeFile({ relPath: 'a.php', src: hushed, reg: phpReg }).silencedProse?.map((d) => `${d.code}:${d.text}`))}`);

    // cm:guard a doc form analyze does NOT call prose stays documentation, silenced or not — a profile
    //   constant billed this to live, where analyze exempts it as structured (ISS-51)
    const structured = ['<?php', '$x = 1;', '', '/** @param int $a phpdoc the tooling parses */', '$y = 2;'];
    const structuredHushed = [...structured.slice(0, 3), '// cm:ignore CM001 — inherited, and nobody owns this file', ...structured.slice(3)].join('\n');
    const stM = fileMass({ relPath: 'a.php', src: structuredHushed, res: analyzeFile({ relPath: 'a.php', src: structuredHushed, reg: phpReg }) });
    check('mass: a structured phpdoc block under a banned policy is documentation, not silenced prose',
      stM.doc === 39 && stM.live === 0,
      `doc=${stM.doc} live=${stM.live}, expected doc=39 live=0 — analyze exempts a STRUCTURED_DOC block, `
      + 'so nothing silenced it and no channel may read a profile field instead (ISS-51)');
  }

  // cm:guard a doc FORM in a profile that never asked about doc blocks is still documentation at
  //   default settings — reading `docBlocksAllowed` here billed every rustdoc line as prose (ISS-51)
  {
    for (const [rel, comment, chars] of [
      ['x.rs', '/// a rustdoc line the tooling parses', 33],
      ['x.php', '/** @param int $a phpdoc the tooling parses */', 39],
    ]) {
      const src = ['let a = 1;', '', comment, 'let b = 2;'].join('\n');
      const res = analyzeFile({ relPath: rel, src, reg: DEFAULT_REGISTRY });
      const dm = fileMass({ relPath: rel, src, res });
      // cm:guard the PREMISE: nothing is raised and nothing silenced, so the form rule alone decides —
      //   a fixture that raised CM001 here would pass on live for the wrong reason (ISS-51)
      check(`mass: ${rel} raises no prose of its own at default settings`,
        res.diags.length === 0 && (res.silencedProse ?? []).length === 0,
        `diags=${JSON.stringify(res.diags.map((d) => d.code))} silenced=${JSON.stringify((res.silencedProse ?? []).map((d) => d.code))}`);
      check(`mass: a doc form is documentation where no policy calls it prose (${rel})`,
        dm.doc === chars && dm.live === 0,
        `doc=${dm.doc} live=${dm.live}, expected doc=${chars} live=0 — the profile leaves `
        + '`docBlocksAllowed` unset because nothing asks, not because the form is prose (ISS-51)');
    }
  }

  // cm:guard the annotation channel is keyed on the COMMENT — a prose comment sharing an annotation's
  //   physical line was billed as annotation, which is the §11 headline figure (ISS-51)
  {
    const anSrc = [
      'export const x = 1;',
      '',
      '/* narration nobody froze */ // cm:why callers must hold the run lock',
      'export const y = 2;',
    ].join('\n');
    const anRes = analyzeFile({ relPath: 'an.ts', src: anSrc, reg: DEFAULT_REGISTRY });
    const an = fileMass({ relPath: 'an.ts', src: anSrc, res: anRes });
    // cm:guard the PREMISE: the annotation parsed AND the block raised its own CM001, or the split
    //   below holds for a file with no annotation on that line at all (ISS-51)
    check('mass: the annotation-sharing line really carries both an annotation and its own CM001',
      anRes.annotations.length === 1 && anRes.diags.some((d) => d.code === 'CM001' && d.line === 3 && d.text === 'narration nobody froze'),
      `annotations=${anRes.annotations.length} diags=${JSON.stringify(anRes.diags.map((d) => `${d.code}@${d.line}`))}`);
    check('mass: a prose comment sharing an annotation\'s line is billed prose, not annotation',
      an.live === 22,
      `live=${an.live} annotation=${an.annotation}, expected the 22 chars of the block — a Set of LINE `
      + 'numbers billed it to the annotation channel, which was annotation=59 live=0 (ISS-51)');
    check('mass: the annotation sharing that line is still billed to the annotation channel',
      an.annotation === 37,
      `annotation=${an.annotation} live=${an.live}, expected the 37 chars of the annotation alone`);
    const anWhole = scanComments(anSrc, profileFor('an.ts')).comments
      .filter((c) => c.text).reduce((n, c) => n + c.text.length, 0);
    check('mass: an annotation sharing a line with prose keeps conservation',
      an.annotation + an.frozen + an.live + an.doc + an.header === anWhole,
      `billed ${an.annotation + an.frozen + an.live + an.doc + an.header} != ${anWhole}`);
  }

  // cm:guard CM010 is a PROSE_CODES member too, so the text match is exercised on both codes — on
  //   CM001 alone half of what the match reaches is dead to the corpus (ISS-51)
  {
    const tdSrc = [
      'export const x = 1;',
      '',
      '/** a doc block the tooling parses */ // TODO: fix the retry',
      'export const y = 2;',
    ].join('\n');
    const tdRes = analyzeFile({ relPath: 'todo.ts', src: tdSrc, reg: DEFAULT_REGISTRY });
    const td = fileMass({ relPath: 'todo.ts', src: tdSrc, res: tdRes });
    check('mass: the TODO fixture really raises CM010 and not CM001',
      tdRes.diags.some((d) => d.code === 'CM010' && d.line === 3 && d.text === 'TODO: fix the retry'),
      `diags=${JSON.stringify(tdRes.diags.map((d) => `${d.code}@${d.line}`))}`);
    check('mass: a CM010 comment sharing a doc block\'s line is billed from its own diagnostic',
      td.doc === 30 && td.live === 19,
      `doc=${td.doc} live=${td.live}, expected doc=30 live=19 — a diagnostic keyed on the LINE bills the `
      + 'doc block from the TODO comment too, which was live=49 doc=0 (ISS-51)');

    // cm:guard the case above passes with the match narrowed to CM001, because one diagnostic on the
    //   line routes both comments right by fall-through — a FROZEN CM010 needs its own to be found
    const tdFrozen = new Set([baselineKey('TODO: fix the retry')]);
    const tdfRes = analyzeFile({ relPath: 'todo.ts', src: tdSrc, reg: DEFAULT_REGISTRY, frozen: tdFrozen });
    const tdf = fileMass({ relPath: 'todo.ts', src: tdSrc, res: tdfRes, frozen: tdFrozen });
    check('mass: a frozen CM010 sharing a doc block\'s line reaches the frozen channel',
      tdf.frozen === 19,
      `frozen=${tdf.frozen} live=${tdf.live} doc=${tdf.doc}, expected frozen=19 — the TODO can only be `
      + 'frozen through its OWN CM010, so a match that reads CM001 alone bills it live instead');
    check('mass: the doc block beside a frozen CM010 keeps its doc channel',
      tdf.doc === 30,
      `doc=${tdf.doc} frozen=${tdf.frozen} live=${tdf.live}, expected the 30 chars of the doc block`);

    // cm:guard the text match is TOTAL over what fileMass bills: a prose code arriving without its
    //   comment's text would fall through to the form rule and change channel in silence (ISS-51)
    const totality = [
      ['shared', ['// cm:guard callers must hold the run lock', '// and release it on every path out',
        '/** a doc block the tooling parses */ // the orphan text', 'export function f() {}'].join('\n'), 'shared.ts'],
      ['two', ['export const a = 1;', '', '/* the first narration */ // the second narration',
        'export const b = 2;'].join('\n'), 'two.ts'],
      ['todo', tdSrc, 'todo.ts'],
      ['annotation', ['export const x = 1;', '', '/* narration nobody froze */ // cm:why callers must hold the run lock',
        'export const y = 2;'].join('\n'), 'an.ts'],
    ];
    for (const [name, src, rel] of totality) {
      const r = analyzeFile({ relPath: rel, src, reg: DEFAULT_REGISTRY });
      const texts = new Set(scanComments(src, profileFor(rel)).comments.map((c) => c.text));
      const orphans = r.diags.filter((d) => PROSE_CODES.has(d.code) && d.code !== 'CM011' && !texts.has(d.text));
      check(`mass: every prose diagnostic fileMass bills carries its comment's text (${name})`,
        orphans.length === 0,
        `orphans=${JSON.stringify(orphans.map((d) => `${d.code}@${d.line}:${JSON.stringify(d.text)}`))} — a `
        + 'prose code reaching fileMass without its comment\'s text is matched by nothing and changes channel');
    }
  }

  const rolled = massOf([m, { ...m, relPath: 'other.ts', narrative: 10 }]);
  check('mass: the total is every channel summed',
    rolled.total.comment === (m.annotation + m.frozen + m.live + m.doc + m.header) * 2,
    `comment=${rolled.total.comment}`);
  check('mass: the ranking names only the files carrying story',
    rolled.byNarrative.length === 1 && rolled.byNarrative[0].relPath === 'other.ts',
    `ranked: ${rolled.byNarrative.map((r) => r.relPath).join(', ')}`);
}

// cm:guard fileMass takes its source from the ANALYSIS, never from a parameter beside it — the mass
//   path read every path twice, and a file changing between the reads billed frozen 0 in silence (ISS-56)
function singleReadCases(check) {
  const analyzed = [
    'export const a = 1;',
    '',
    '// plain narration somebody froze',
    'export const b = 2;',
  ].join('\n');
  const decoy = [
    'export const a = 1;',
    '',
    '// a decoy narration nobody froze, of quite another length than the one analyzed',
    'export const b = 2;',
  ].join('\n');
  const frozen = new Set([baselineKey('plain narration somebody froze')]);
  const res = analyzeFile({ relPath: 'read.ts', src: analyzed, reg: DEFAULT_REGISTRY, frozen });

  check('mass: the analysis carries the source it was taken from',
    res.src === analyzed,
    `res.src is ${res.src === undefined ? 'absent' : JSON.stringify(res.src).slice(0, 40)} — without it `
    + 'fileMass has no source but the one a caller hands it, which is the second read this closed');

  const m = fileMass({ relPath: 'read.ts', res, frozen });
  check('mass: the frozen comment of the analyzed source is billed to frozen',
    m.frozen === 30 && m.live === 0,
    `frozen=${m.frozen} live=${m.live}, expected the 30 chars of the analyzed comment`);

  // cm:guard the PREMISE: the decoy must bill DIFFERENT figures, or the case below passes on two
  //   sources that agree and pins nothing at all (ISS-48's constant-right-for-the-wrong-fixture trap)
  const decoyRes = analyzeFile({ relPath: 'read.ts', src: decoy, reg: DEFAULT_REGISTRY, frozen });
  const dm = fileMass({ relPath: 'read.ts', res: decoyRes, frozen });
  check('mass: the decoy source bills figures of its own, so the case below can tell which was read',
    dm.frozen !== m.frozen && dm.live !== m.live,
    `decoy frozen=${dm.frozen} live=${dm.live} vs analyzed frozen=${m.frozen} live=${m.live} — the two `
    + 'sources must disagree for the decoy to be a decoy');

  // cm:guard this is the pin: a source handed in beside the analysis is IGNORED. A fileMass that reads
  //   one — the shape before ISS-56 — bills the decoy here and fails this case by name
  const withDecoy = fileMass({ relPath: 'read.ts', src: decoy, res, frozen });
  check('mass: a source handed in beside the analysis cannot change what fileMass bills',
    withDecoy.frozen === m.frozen && withDecoy.live === m.live && withDecoy.doc === m.doc,
    `with a decoy src: frozen=${withDecoy.frozen} live=${withDecoy.live} doc=${withDecoy.doc}, expected `
    + `frozen=${m.frozen} live=${m.live} doc=${m.doc} — the analysis's own source decides every channel`);
}

// cm:guard the annotation channel bills the comment the annotation was READ FROM, identified by its
//   scan index — a text key billed a misplaced block whose text equalled the annotation's beside it (ISS-58)
function annotationIdentityCases(check) {
  const ann = 'cm:why callers must hold the run lock';
  const pairSrc = [`/* ${ann} */ // ${ann}`, 'export function f() {}'].join('\n');
  const pairRes = analyzeFile({ relPath: 'pair.ts', src: pairSrc, reg: DEFAULT_REGISTRY });
  const pm = fileMass({ relPath: 'pair.ts', res: pairRes });

  // cm:guard the PREMISE: the block must be a MISPLACED annotation — earning CM003 and absent from
  //   res.annotations — or the fixture is two annotations and the split below is right for the wrong reason
  check('mass: the block of the byte-identical pair is a misplaced annotation, not a second one',
    pairRes.diags.some((d) => d.code === 'CM003') && (pairRes.annotations ?? []).length === 1,
    `CM003=${pairRes.diags.some((d) => d.code === 'CM003')} annotations=${(pairRes.annotations ?? []).length}`
    + ' — expected one annotation and a CM003 for the block, which §4.2 bills to live by its form');

  check('mass: a block whose text is byte-identical to the annotation beside it is not billed as annotation',
    pm.annotation === 37,
    `annotation=${pm.annotation} live=${pm.live}, expected the 37 chars of the line comment alone — a `
    + 'channel keyed on `line \0 text` cannot tell the two apart and billed both, 74 and live 0 (ISS-58)');
  check('mass: the misplaced block of the byte-identical pair is billed to live by its form',
    pm.live === 37,
    `live=${pm.live} annotation=${pm.annotation}, expected the 37 chars of the block`);

  // cm:guard the CONTROL: one word changed makes the texts differ, which the text key already got
  //   right — so this arm must be unmoved by the fix, or the fix is billing on something else
  const ctlSrc = [`/* cm:why callers must hold the RUN lock */ // ${ann}`, 'export function f() {}'].join('\n');
  const cm2 = fileMass({ relPath: 'pair.ts', res: analyzeFile({ relPath: 'pair.ts', src: ctlSrc, reg: DEFAULT_REGISTRY }) });
  check('mass: the one-word-changed control keeps the split the text key already reached',
    cm2.annotation === 37 && cm2.live === 37,
    `annotation=${cm2.annotation} live=${cm2.live}, expected 37 / 37 unchanged by ISS-58`);

  // cm:guard the wrap is billed by its OWN index too — dropping that leaves the continuation line to
  //   §4.2's form rule, which bills it live and takes 32 characters out of the annotation channel
  const wrapSrc = [`// ${ann}`, '// and release it on every path out', 'export function f() {}'].join('\n');
  const wrapRes = analyzeFile({ relPath: 'wrap.ts', src: wrapSrc, reg: DEFAULT_REGISTRY });
  check('mass: an annotation\'s adopted wrap line is billed to the annotation channel',
    wrapRes.annotations?.[0]?.wrap === 'and release it on every path out',
    `wrap=${JSON.stringify(wrapRes.annotations?.[0]?.wrap)} — without an adopted wrap the case below `
    + 'tests a bare annotation and says nothing about the wrap');
  const wm = fileMass({ relPath: 'wrap.ts', res: wrapRes });
  check('mass: the annotation channel holds the annotation and its wrap, and nothing reaches live',
    wm.annotation === 69 && wm.live === 0,
    `annotation=${wm.annotation} live=${wm.live}, expected 69 — the 37 of the annotation and the 32 of its wrap`);
}

function cliCases(pluginRoot, check, roots) {
  const root = mkdtempSync(join(tmpdir(), 'cm-mass-'));
  roots.push(root);
  mkdirSync(join(root, '.forge'));
  writeFileSync(join(root, '.forge', 'codemap.json'), '{}\n');
  writeFileSync(join(root, 'told.ts'), `// cm:guard ${STORY}\nexport const a = 1;\n`);
  writeFileSync(join(root, 'clean.ts'), `// cm:guard ${RULE}\nexport const b = 2;\n`);
  writeFileSync(join(root, 'ignored.ts'),
    `// cm:ignore CM303 — the past tense IS the invariant here\n// cm:guard ${STORY}\nexport const c = 3;\n`);
  execFileSync('git', ['-C', root, 'init', '-q'], { env: stripGitEnv(process.env) });

  const cm = (...args) => {
    const r = spawnSync(process.execPath, [join(pluginRoot, 'cli', 'cm.mjs'), ...args], {
      cwd: root, encoding: 'utf8', env: { ...stripGitEnv(process.env), NO_COLOR: '1' },
    });
    return { ...r, out: `${r.stdout}${r.stderr}` };
  };

  // cm:guard no base revision anywhere in this path — a tail nobody has edited is exactly what this
  //   verb exists to reach, so a git-scoped run would put the debt back out of reach (§11)
  const plain = cm('mass');
  check('mass cli: `cm mass` reports every channel with no ref, no path and no staged set',
    plain.status === 0 && /annotation/.test(plain.out) && /doc comment/.test(plain.out)
      && /module header/.test(plain.out) && /frozen prose/.test(plain.out) && /live prose/.test(plain.out),
    `got status=${plain.status}\n${plain.out}`);
  check('mass cli: the file carrying story is named and the one carrying a rule is not',
    /told\.ts/.test(plain.out) && !/clean\.ts/.test(plain.out),
    `expected only told.ts in the ranking:\n${plain.out}`);
  check('mass cli: the head share of the story is reported',
    /holds? \d+% of it/.test(plain.out), plain.out);

  const json = cm('mass', '--json');
  let parsed = null;
  try { parsed = JSON.parse(json.stdout); } catch { parsed = null; }
  check('mass cli: --json is a diffable payload',
    parsed && parsed.total.narrative > 0 && parsed.total.comment > 0 && parsed.narrativeMin === NARRATIVE_MIN,
    `expected totals in JSON:\n${json.out.slice(0, 300)}`);

  for (const flag of ['--since', '--staged']) {
    const scoped = cm('mass', flag, 'HEAD');
    check(`mass cli: \`cm mass ${flag}\` is refused rather than silently scoped`,
      scoped.status === 2 && /takes no/.test(scoped.out),
      `a base revision would put the tail back out of reach; got status=${scoped.status}\n${scoped.out}`);
  }

  const advisory = cm('verify', '--tier', 'advisory');
  check('mass cli: CM303 warns and never changes the exit code',
    advisory.status === 0 && /CM303/.test(advisory.out) && /no errors/.test(advisory.out),
    `got status=${advisory.status}\n${advisory.out}`);

  const ignored = cm('verify', '--tier', 'advisory', 'ignored.ts');
  check('mass cli: an annotation under cm:ignore CM303 is neither reported nor counted',
    !/CM303/.test(ignored.out) && /0 annotations carrying story/.test(cm('mass', 'ignored.ts').out),
    `verify said:\n${ignored.out}\nmass said:\n${cm('mass', 'ignored.ts').out}`);

  const bare = cm('verify');
  check('mass cli: a whole-tree verify prints the story total',
    /comment mass: .* incident story/.test(bare.out), bare.out);
  const scoped = cm('verify', 'told.ts');
  check('mass cli: a scoped verify does not, because it cannot total the tree',
    !/comment mass:/.test(scoped.out), scoped.out);
}

export function massCases(pluginRoot, check) {
  const roots = [];
  try {
    unitCases(check);
    agreementCases(check);
    conservationCases(check);
    channelCases(check);
    singleReadCases(check);
    annotationIdentityCases(check);
    cliCases(pluginRoot, check, roots);
  } finally {
    for (const r of roots) rmSync(r, { recursive: true, force: true });
  }
}
