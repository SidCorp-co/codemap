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
import { baselineKey, CM_IGNORE_RE } from '../cli/lib/parse.mjs';
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

  // cm:guard the SET is pinned, not only the channel it feeds — mass.mjs bills the annotation's own
  //   line and its wrap from `annLines` first, so a member added there moves no figure and fails nothing
  {
    const memSrc = [
      '// cm:guard callers must hold the run lock',
      '// and release it on every path out',
      '// and a third line is the first orphan',
      '// and a fourth line is the second orphan',
      'export function f() {}',
      '',
      '// plain narration under no annotation at all',
      'export const x = 1;',
    ].join('\n');
    const reg = { ...DEFAULT_REGISTRY, enforce: { ...DEFAULT_REGISTRY.enforce, grammar: false } };
    const res = analyzeFile({ relPath: 'mem.ts', src: memSrc, reg });
    check('mass: overflowLines holds every line past the wrap and nothing else',
      [...res.overflowLines].sort((a, b) => a - b).join(',') === '3,4',
      `overflowLines=[${[...res.overflowLines]}], expected [3,4] — line 1 is the annotation, line 2 its `
      + 'adopted wrap, line 7 prose under no annotation, and none of the three is an overflow line');

    // cm:guard the run stands ALONE in this fixture — the sum is the two orphans, so a prose line under
    //   no annotation sharing it would move channel under ISS-40 and fail this on a false cause
    const runSrc = memSrc.split('\n').slice(0, 5).join('\n');
    const runRes = analyzeFile({ relPath: 'run.ts', src: runSrc, reg });
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
  }

  const rolled = massOf([m, { ...m, relPath: 'other.ts', narrative: 10 }]);
  check('mass: the total is every channel summed',
    rolled.total.comment === (m.annotation + m.frozen + m.live + m.doc + m.header) * 2,
    `comment=${rolled.total.comment}`);
  check('mass: the ranking names only the files carrying story',
    rolled.byNarrative.length === 1 && rolled.byNarrative[0].relPath === 'other.ts',
    `ranked: ${rolled.byNarrative.map((r) => r.relPath).join(', ')}`);
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
    cliCases(pluginRoot, check, roots);
  } finally {
    for (const r of roots) rmSync(r, { recursive: true, force: true });
  }
}
