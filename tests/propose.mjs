// ISS-12 — `cm propose`: candidate discovery from evidence already in the repo. Pure-function cases
// for each source first (cheap, no git needed for prose/contract), then a CLI tier against a
// throwaway repo for the one source that needs real commit history (lockstep) and for the verb's
// wiring (exit code, --json shape, --source filter).

import {
  mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync,
} from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { proseCandidates, lockstepCandidates, contractCandidates, RESERVED, makeReserved, codeOnly } from '../cli/lib/propose.mjs';
import { profileFor } from '../cli/lib/languages.mjs';
import { stripGitEnv } from './git-env.mjs';
import { TAGS, CM_IGNORE_RE } from '../cli/lib/parse.mjs';

function git(root, ...args) {
  execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    env: { ...stripGitEnv(process.env), GIT_AUTHOR_NAME: 'cm', GIT_AUTHOR_EMAIL: 'cm@test',
      GIT_COMMITTER_NAME: 'cm', GIT_COMMITTER_EMAIL: 'cm@test' },
  });
}

function cm(pluginRoot, root, ...args) {
  const res = spawnSync(process.execPath, [join(pluginRoot, 'cli', 'cm.mjs'), ...args], {
    cwd: root, encoding: 'utf8', env: { ...stripGitEnv(process.env), NO_COLOR: '1' },
  });
  return { ...res, out: `${res.stdout}${res.stderr}` };
}

function pureCases(check) {
  const files = ['a.ts', 'product_create.go', 'unrelated.ts'];
  const perFile = [{
    relPath: 'a.ts',
    diags: [{ code: 'CM001', line: 3, text: 'see product_create.go for the matching validation rules' }],
  }];
  const prose = proseCandidates(perFile, files);
  check('propose: prose finds a comment naming a file that resolves', prose.length === 1,
    `expected 1, got ${JSON.stringify(prose)}`);
  check('propose: prose candidate names no kind — that judgement is not this source\'s to make',
    prose[0]?.kind === undefined, `unexpected kind: ${JSON.stringify(prose[0])}`);
  check('propose: prose candidate never writes a — why (only the original comment, as evidence)',
    prose[0]?.evidence === 'see product_create.go for the matching validation rules',
    `evidence: ${JSON.stringify(prose[0])}`);

  const selfRef = proseCandidates(
    [{ relPath: 'a.ts', diags: [{ code: 'CM001', line: 1, text: 'see a.ts above' }] }],
    ['a.ts'],
  );
  check('propose: prose does not propose a file pointing at itself', selfRef.length === 0,
    `expected 0, got ${JSON.stringify(selfRef)}`);

  const noHit = proseCandidates(
    [{ relPath: 'a.ts', diags: [{ code: 'CM001', line: 1, text: 'see nope.ts' }] }],
    ['a.ts'],
  );
  check('propose: prose drops a path that does not resolve to a real file', noHit.length === 0,
    `expected 0, got ${JSON.stringify(noHit)}`);

  // cm:guard the .ts control must stay beside it — PATH_RE recognising a path SHAPE is only correct
  //   because the registry's file list decides what exists, and a case for .vue alone cannot see that (ISS-59)
  const sfcProse = proseCandidates(
    [{ relPath: 'notes.ts', diags: [{ code: 'CM001', line: 3, text: 'see src/Widget.vue for the pair' }] }],
    ['notes.ts', 'src/Widget.vue'],
  );
  check('propose: prose naming a .vue resolves to a prose candidate (ISS-59)',
    sfcProse.length === 1 && sfcProse[0].target === 'src/Widget.vue',
    `.vue has a profile, so the proposer must be able to see it named: ${JSON.stringify(sfcProse)}`);

  const sveProse = proseCandidates(
    [{ relPath: 'notes.ts', diags: [{ code: 'CM001', line: 3, text: 'see src/App.svelte for the pair' }] }],
    ['notes.ts', 'src/App.svelte'],
  );
  check('propose: prose naming a .svelte resolves to a prose candidate (ISS-59)',
    sveProse.length === 1 && sveProse[0].target === 'src/App.svelte',
    `.svelte resolves to the same profile as .vue: ${JSON.stringify(sveProse)}`);

  const unscannable = proseCandidates(
    [{ relPath: 'notes.ts', diags: [{ code: 'CM001', line: 3, text: 'see docs/guide.md for the pair' }] }],
    ['notes.ts'],
  );
  check('propose: prose naming a file the registry does not carry yields nothing (ISS-59)',
    unscannable.length === 0,
    `the registry's file list is what decides, not the path shape: ${JSON.stringify(unscannable)}`);

  const goSrc = 'const code = "ERR_PAYMENT_DECLINED"\n';
  const tsSrc = 'if (c === "ERR_PAYMENT_DECLINED") throw e;\n';
  const root = mkdtempSync(join(tmpdir(), 'cm-propose-pure-'));
  writeFileSync(join(root, 'emit.go'), goSrc);
  writeFileSync(join(root, 'parse.ts'), tsSrc);
  writeFileSync(join(root, 'also.ts'), tsSrc);
  writeFileSync(join(root, 'noisy.ts'), 'export const hello = "hello";\n');
  try {
    const contract2 = contractCandidates(root, ['emit.go', 'parse.ts']);
    check('propose: contract finds a literal shared by exactly two files in two languages',
      contract2.length === 1 && contract2[0].literal === 'ERR_PAYMENT_DECLINED',
      `expected 1 ERR_PAYMENT_DECLINED hit, got ${JSON.stringify(contract2)}`);

    const contract3 = contractCandidates(root, ['emit.go', 'parse.ts', 'also.ts']);
    check('propose: contract drops a literal that appears in a third file',
      contract3.length === 0, `expected 0 (three files share it), got ${JSON.stringify(contract3)}`);

    const sameLang = contractCandidates(root, ['parse.ts', 'also.ts']);
    check('propose: contract drops a literal shared by files in the SAME language',
      sameLang.length === 0, `expected 0, got ${JSON.stringify(sameLang)}`);

    // cm:guard an SFC and a .ts are the SAME ecosystem — §7.1 reads "different languages" as "cannot
    //   import each other", and a .vue imports .ts freely, so a shared literal is not a contract (ISS-28)
    writeFileSync(join(root, 'Widget.vue'), '<script setup lang="ts">\nconst e = "user:updated";\n</script>\n');
    writeFileSync(join(root, 'bus.ts'), 'export const E = "user:updated";\n');
    const sfcPair = contractCandidates(root, ['Widget.vue', 'bus.ts']);
    check('propose: contract drops a literal shared by an SFC and a .ts (ISS-28)',
      sfcPair.length === 0,
      `an SFC/.ts pair is one ecosystem, not two languages; got ${JSON.stringify(sfcPair)}`);

    // cm:guard every arm below pairs its SFC or TS side against a `.go` side, so only the comment
    //   question can decide it — an sfc/.ts pair ISS-28 drops would pass with the fix removed (ISS-59)
    writeFileSync(join(root, 'Tpl.vue'), '<template>\n  <!-- "ONLY_IN_TEMPLATE" handled elsewhere -->\n  <div/>\n</template>\n');
    writeFileSync(join(root, 'tpl.go'), 'const c = "ONLY_IN_TEMPLATE"\n');
    check('propose: a literal only inside an SFC template comment is not a contract candidate (ISS-59)',
      contractCandidates(root, ['Tpl.vue', 'tpl.go']).length === 0,
      `the template comment is a comment form of the sfc profile, so propose must not read it as code: ${JSON.stringify(contractCandidates(root, ['Tpl.vue', 'tpl.go']))}`);

    writeFileSync(join(root, 'inner.ts'), '/*\n "ONLY_BLOCK_INTERIOR" only here\n*/\nexport const y = 2;\n');
    writeFileSync(join(root, 'inner.go'), 'const c = "ONLY_BLOCK_INTERIOR"\n');
    check('propose: a literal on a block comment INTERIOR line is not a contract candidate (ISS-59)',
      contractCandidates(root, ['inner.ts', 'inner.go']).length === 0,
      `an interior line opens with no leader, and this is the plain ts profile, not sfc: ${JSON.stringify(contractCandidates(root, ['inner.ts', 'inner.go']))}`);

    writeFileSync(join(root, 'trail.ts'), 'export const z = 3; // "ONLY_TRAILING_LINE" not real\n');
    writeFileSync(join(root, 'trail.go'), 'const c = "ONLY_TRAILING_LINE"\n');
    check('propose: a literal in a TRAILING line comment is not a contract candidate (ISS-59)',
      contractCandidates(root, ['trail.ts', 'trail.go']).length === 0,
      `a trailing comment does not open its line, which is all the old leader test asked: ${JSON.stringify(contractCandidates(root, ['trail.ts', 'trail.go']))}`);

    writeFileSync(join(root, 'tblock.ts'), 'export const q = 4; /* "ONLY_TRAILING_BLOCK" nope */\n');
    writeFileSync(join(root, 'tblock.go'), 'const c = "ONLY_TRAILING_BLOCK"\n');
    check('propose: a literal in a TRAILING block comment is not a contract candidate (ISS-59)',
      contractCandidates(root, ['tblock.ts', 'tblock.go']).length === 0,
      `this is the one shape analyze.mjs's codeShape leaves whole, so spans are what decide it: ${JSON.stringify(contractCandidates(root, ['tblock.ts', 'tblock.go']))}`);

    // cm:guard the pin is the SURVIVING literal, not the count — a codeOnly that blanked the whole line
    //   would drop KEEP_ON_LINE too and every "is not a candidate" case above would still pass (ISS-59)
    // cm:guard TWO comments on ONE line is the whole point — spans are keyed on a coordinate, so a mask
    //   that dropped characters would leave the second span's offsets pointing at the wrong text (ISS-59)
    writeFileSync(join(root, 'two.ts'), 'const a = "KEEP.ONE"; /* "DROP.A" */ const b = "KEEP.TWO"; /* "DROP.B" */\n');
    writeFileSync(join(root, 'two.go'), 'const a = "KEEP.ONE"\nconst b = "KEEP.TWO"\nconst c = "DROP.A"\nconst d = "DROP.B"\n');
    const two = contractCandidates(root, ['two.ts', 'two.go']).map((c) => c.literal).sort();
    check('propose: two comments on one line are both masked, in place (ISS-59)',
      two.join(',') === 'KEEP.ONE,KEEP.TWO',
      `both KEEP literals and neither DROP literal, which needs offsets into the UNSHIFTED line: ${JSON.stringify(two)}`);

    // cm:guard the masked text carries no delimiter either — the span covers them, and a consumer
    //   reading this as code must not meet a stray opener (ISS-59, and ISS-60 will read it)
    const delim = codeOnly('const a = 1; /* x */\n<!-- y -->\n', profileFor('W.vue'));
    check('propose: masking covers the comment delimiters themselves (ISS-59)',
      !/\/\*|\*\/|<!--|-->/.test(delim) && delim.includes('const a = 1;'),
      `no delimiter may survive the mask: ${JSON.stringify(delim)}`);

    // cm:guard the opener must SHARE its line with the code literal — on a line of its own, masking the
    //   opener line whole loses nothing and this case cannot see the difference (ISS-59)
    writeFileSync(join(root, 'unterm.ts'), 'const y = "KEEP.UNTERM"; /* never closed\n"ERR_UNTERM.X" here\n');
    writeFileSync(join(root, 'unterm.go'), 'const a = "KEEP.UNTERM"\nconst b = "ERR_UNTERM.X"\n');
    const unterm = contractCandidates(root, ['unterm.ts', 'unterm.go']);
    check('propose: an unterminated block masks to EOF and keeps the code on its opener line (ISS-59)',
      unterm.length === 1 && unterm[0].literal === 'KEEP.UNTERM',
      `exactly KEEP.UNTERM; the block swallows the file to EOF per lib/scan.mjs: ${JSON.stringify(unterm)}`);

    // cm:guard the literal must be SHORT and start at column 0 — the opener sits at column 13, and a
    //   literal reaching past it is merely truncated, which matches nothing either way (ISS-59)
    writeFileSync(join(root, 'eol.ts'), 'const x = 1; /*\n"ERR.X" text\n*/\n');
    writeFileSync(join(root, 'eol.go'), 'const c = "ERR.X"\n');
    check('propose: a block opening at end of line masks the next line from its own column 0 (ISS-59)',
      contractCandidates(root, ['eol.ts', 'eol.go']).length === 0,
      `the opener's column belongs to its own line only: ${JSON.stringify(contractCandidates(root, ['eol.ts', 'eol.go']))}`);

    writeFileSync(join(root, 'mixed.ts'), 'export const A = "KEEP_ON_LINE"; // "DROP_ON_LINE" no\n');
    writeFileSync(join(root, 'mixed.go'), 'const a = "KEEP_ON_LINE"\nconst b = "DROP_ON_LINE"\n');
    const mixed = contractCandidates(root, ['mixed.ts', 'mixed.go']);
    check('propose: code on a line survives while that line\'s trailing comment is masked (ISS-59)',
      mixed.length === 1 && mixed[0].literal === 'KEEP_ON_LINE',
      `exactly KEEP_ON_LINE, masked in place rather than by blanking the line: ${JSON.stringify(mixed)}`);

    // cm:guard the reported line must be the literal's line in the ORIGINAL file — masking that dropped
    //   or shifted lines would report 1 here and no "not a candidate" case above could see it (ISS-59)
    writeFileSync(join(root, 'num.ts'), '// header\n/* block\n   spanning */\nexport const E = "ON_LINE_FOUR";\n');
    writeFileSync(join(root, 'num.go'), 'const c = "ON_LINE_FOUR"\n');
    const num = contractCandidates(root, ['num.ts', 'num.go']);
    check('propose: masking a comment moves no line number under the literal (ISS-59)',
      num.length === 1 && num[0].files[0].line === 4,
      `ON_LINE_FOUR sits on line 4 after three comment lines: ${JSON.stringify(num)}`);

    // cm:guard reaches a comment form NO profile carries today, so no hard-coded list — however long —
    //   can pass it; only reading the resolved profile's own forms does (ISS-59)
    const invented = { ...profileFor('x.ts'), id: 'invented', blockOpens: [['(*', '*)']], docBlockOpens: [] };
    const masked = codeOnly('const a = 1; (* "INVENTED_FORM" *)\n', invented);
    check('propose: a comment form a profile gains later is honoured with no second edit (ISS-59)',
      !masked.includes('INVENTED_FORM') && masked.includes('const a = 1;'),
      `the profile is the only authority on the form; masked text was ${JSON.stringify(masked)}`);

    const noSep = contractCandidates(root, ['emit.go', 'noisy.ts']);
    check('propose: contract ignores a plain word with no separator (no coincidental "hello")',
      !noSep.some((c) => c.literal === 'hello'), `"hello" should not qualify: ${JSON.stringify(noSep)}`);

    // cm:guard the literal must sit in CODE on BOTH sides or this proves nothing — a cm: token in a
    //   comment is cut by codeOnly, leaving one file, which "exactly two files" already fails (ISS-50)
    const vocabulary = [...TAGS.map((t) => `cm:${t}`), 'cm:ignore'];
    const notExcluded = vocabulary.filter((lit) => {
      writeFileSync(join(root, 'tag.ts'), `export const t = "${lit}";\n`);
      writeFileSync(join(root, 'tag.go'), `const t = "${lit}"\n`);
      return contractCandidates(root, ['tag.ts', 'tag.go']).length !== 0;
    });
    check('propose: contract excludes every tag in TAGS, plus cm:ignore (ISS-50)',
      notExcluded.length === 0,
      `derived from TAGS + CM_IGNORE_RE, so a new tag is covered on arrival; proposed anyway: ${JSON.stringify(notExcluded)}`);

    // cm:guard the oracle above pins BEHAVIOUR over the tags that exist, which a hand-restated
    //   list satisfies too — this is the only case that reaches a tag TAGS does not carry yet (ISS-50)
    const future = makeReserved([...TAGS, 'owner'], CM_IGNORE_RE);
    check('propose: a tag added to TAGS is excluded on arrival, with no second edit (ISS-50)',
      future.test('cm:owner') && TAGS.every((t) => future.test(`cm:${t}`)) && future.test('cm:ignore'),
      `${future.source} must exclude a new tag and keep the old set and cm:ignore`);
    check('propose: the shipped RESERVED is what the factory builds from TAGS and CM_IGNORE_RE (ISS-50)',
      RESERVED.source === makeReserved(TAGS, CM_IGNORE_RE).source,
      `RESERVED.source is ${RESERVED.source}, the factory builds ${makeReserved(TAGS, CM_IGNORE_RE).source}`);

    writeFileSync(join(root, 'tag.ts'), 'export const t = "ERR_TOKEN_SPENT";\n');
    writeFileSync(join(root, 'tag.go'), 'const t = "ERR_TOKEN_SPENT"\n');
    const control = contractCandidates(root, ['tag.ts', 'tag.go']);
    check('propose: the vocabulary exclusion does not swallow an ordinary shared token (ISS-50)',
      control.length === 1 && control[0].literal === 'ERR_TOKEN_SPENT',
      `the control must still be proposed, or the case above passes by excluding everything: ${JSON.stringify(control)}`);

    writeFileSync(join(root, 'z_first.ts'), 'const q = "ALPHA_TWO";\nconst p = "ALPHA_ONE";\n');
    writeFileSync(join(root, 'a_second.go'), 'const q = "ALPHA_TWO"\nconst p = "ALPHA_ONE"\n');
    writeFileSync(join(root, 'm_first.ts'), 'const r = "BETA_CODE";\n');
    writeFileSync(join(root, 'n_second.go'), 'const r = "BETA_CODE"\n');
    // cm:guard z_first.ts is scanned first yet must sort AFTER m_first.ts, while a_second.go sorts
    //   before both — only that makes the path key, not discovery order or the pair's smaller side, decide (ISS-52)
    // cm:guard ALPHA_TWO stays written ABOVE ALPHA_ONE and BETA_CODE stays sorting after both, or
    //   the literal key alone reproduces the expected order (ISS-52)
    const many = contractCandidates(root, ['z_first.ts', 'a_second.go', 'm_first.ts', 'n_second.go']);
    check('propose: contract returns every candidate when a repo has more than one (ISS-52)',
      many.length === 3, `expected 3 candidates, got ${JSON.stringify(many)}`);
    check('propose: contract orders candidates by first side\'s path, then literal (ISS-52)',
      many.map((c) => c.literal).join(',') === 'BETA_CODE,ALPHA_ONE,ALPHA_TWO',
      `order was ${JSON.stringify(many.map((c) => [c.files[0]?.file, c.literal]))}`);
    check('propose: both sides of a contract candidate carry the record the printer reads (ISS-52)',
      many.every((c) => c.files.length === 2 && c.files.every((f) => typeof f?.file === 'string' && typeof f?.line === 'number')),
      `both sides must hold {file,line,lang,eco}: ${JSON.stringify(many[0])}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function lockstepCases(check) {
  const root = mkdtempSync(join(tmpdir(), 'cm-propose-lockstep-'));
  try {
    git(root, 'init', '-q');
    writeFileSync(join(root, 'lock_a.ts'), 'export const a = 1;\n');
    writeFileSync(join(root, 'lock_b.ts'), 'export const b = 1;\n');
    git(root, 'add', 'lock_a.ts', 'lock_b.ts');
    git(root, 'commit', '-qm', 'seed');
    for (let i = 0; i < 6; i++) {
      writeFileSync(join(root, 'lock_a.ts'), `export const a = ${i};\n`);
      writeFileSync(join(root, 'lock_b.ts'), `export const b = ${i};\n`);
      git(root, 'add', 'lock_a.ts', 'lock_b.ts');
      git(root, 'commit', '-qm', `co-change ${i}`);
    }
    // cm:why enough noise commits that lock_a/lock_b's co-change rate is a genuine surprise — with too
    //   little history two files touched in most commits are not "surprising", just generically active
    const NOISE = 30;
    for (let i = 0; i < NOISE; i++) {
      writeFileSync(join(root, `noise${i}.ts`), `export const n = ${i};\n`);
      git(root, 'add', `noise${i}.ts`);
      git(root, 'commit', '-qm', `noise ${i}`);
    }

    const files = ['lock_a.ts', 'lock_b.ts', ...Array.from({ length: NOISE }, (_, i) => `noise${i}.ts`)];
    const found = lockstepCandidates(root, files);
    check('propose: lockstep finds files that co-change far more than chance predicts',
      found.length === 1 && found[0].files.includes('lock_a.ts') && found[0].files.includes('lock_b.ts'),
      `expected the lock_a/lock_b pair, got ${JSON.stringify(found)}`);

    writeFileSync(join(root, 'lock_a.ts'), "import { b } from './lock_b';\nexport const a = 1;\n");
    git(root, 'add', 'lock_a.ts');
    git(root, 'commit', '-qm', 'lock_a now imports lock_b');
    const afterImport = lockstepCandidates(root, files);
    check('propose: lockstep drops a pair once one side visibly imports the other',
      afterImport.length === 0, `import evidence should exclude the pair, got ${JSON.stringify(afterImport)}`);

    const strict = lockstepCandidates(root, files, { minCoChanges: 1000 });
    check('propose: lockstep respects a caller-supplied minCoChanges', strict.length === 0,
      'an unreachable threshold must return nothing');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function cliCases(pluginRoot, check) {
  const root = mkdtempSync(join(tmpdir(), 'cm-propose-cli-'));
  try {
    mkdirSync(join(root, '.forge'));
    writeFileSync(join(root, '.forge', 'codemap.json'), '{}\n');
    writeFileSync(join(root, 'a.ts'), '// see product_create.go for the matching validation rules\nexport const a = 1;\n');
    writeFileSync(join(root, 'product_create.go'), 'package main\nfunc create() {}\n');
    writeFileSync(join(root, 'pair_one.ts'), 'const p = "GAMMA_ONE";\nconst q = "GAMMA_TWO";\n');
    writeFileSync(join(root, 'pair_two.go'), 'const p = "GAMMA_ONE"\nconst q = "GAMMA_TWO"\n');
    git(root, 'init', '-q');
    git(root, 'add', '-A');
    git(root, 'commit', '-qm', 'seed');

    const r = cm(pluginRoot, root, 'propose');
    check('cli: propose exits 0 — a proposal never gates', r.status === 0, `status ${r.status}\n${r.out}`);
    check('cli: propose surfaces the prose candidate', /product_create\.go/.test(r.out), r.out);
    check('cli: propose never writes a fabricated — why', !/—\s*why they/.test(r.out) || /add\s*—\s*why/.test(r.out),
      'a suggestion line must not assert a why it did not derive');
    check('cli: propose says a candidate is not a fact', /not a fact/.test(r.out), r.out);

    const two = cm(pluginRoot, root, 'propose', '--source', 'contract');
    check('cli: propose exits 0 where source 3 finds two candidates (ISS-52)', two.status === 0,
      `status ${two.status}\n${two.out}`);
    check('cli: propose prints both contract candidates rather than dying on the second (ISS-52)',
      /GAMMA_ONE/.test(two.out) && /GAMMA_TWO/.test(two.out), two.out);

    const asJson = cm(pluginRoot, root, 'propose', '--json');
    let parsed;
    try { parsed = JSON.parse(asJson.stdout); } catch { parsed = null; }
    check('cli: propose --json is valid JSON with all three source keys', Boolean(parsed)
      && ['prose', 'lockstep', 'contract'].every((k) => Array.isArray(parsed.candidates[k])),
      `--json output:\n${asJson.out}`);
    check('cli: propose --json prose matches the text-mode finding',
      parsed?.candidates.prose.some((c) => c.target === 'product_create.go'), JSON.stringify(parsed));

    const filtered = cm(pluginRoot, root, 'propose', '--source', 'prose', '--json');
    let onlyProse;
    try { onlyProse = JSON.parse(filtered.stdout); } catch { onlyProse = null; }
    check('cli: --source prose omits the other two sources', Boolean(onlyProse)
      && Object.keys(onlyProse.candidates).length === 1 && 'prose' in onlyProse.candidates,
      `--source prose output:\n${filtered.out}`);

    const bad = cm(pluginRoot, root, 'propose', '--source', 'bogus');
    check('cli: an unknown --source is exit 2, not a silent empty result', bad.status === 2 && /unknown --source/.test(bad.out),
      `expected exit 2, got ${bad.status}\n${bad.out}`);

    check('cli: propose never touches the baseline file', !existsSync(join(root, '.forge', 'codemap-baseline.json')),
      'propose must be read-only with respect to the baseline (issue: out of scope)');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

export function proposeCases(pluginRoot, check) {
  pureCases(check);
  lockstepCases(check);
  cliCases(pluginRoot, check);
}
