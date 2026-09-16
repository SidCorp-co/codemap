// CM108 tier (ISS-71). Two halves, because the code has two halves that fail differently.
//
// The unit half drives candidateSymbols and resolveNames directly: what counts as an identifier is a
// declared shape, and a shape is only provable by the tokens it admits and the ones it refuses.
// The CLI half spawns the real argv against real temp repos, because everything that makes this code
// safe to gate on — the baseline declaring it, the edit hook not paying for it, the drain — lives in
// cm.mjs and not in the checker.

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync } from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { candidateSymbols, resolveNames, symbolKey, formsFor, unknownForms, DEFAULT_SYMBOL_FORMS } from '../cli/lib/symbols.mjs';
import { CODE_TABLE } from '../cli/lib/parse.mjs';
import { DEFAULT_REGISTRY } from '../cli/lib/registry.mjs';
import { stripGitEnv } from './git-env.mjs';

const GHOST = 'claimRunnerSlot';

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

function makeRepo(files, { git: asGit = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'cm-sym-'));
  mkdirSync(join(root, '.forge'));
  writeFileSync(join(root, '.forge', 'codemap.json'), '{}\n');
  for (const [name, src] of Object.entries(files)) writeFileSync(join(root, name), src);
  if (asGit) {
    git(root, 'init', '-q');
    git(root, 'add', '-A');
    git(root, 'commit', '-qm', 'seed');
  }
  return root;
}

const guard = (text, wrap) => `// cm:guard ${text}\n${wrap ? `//   ${wrap}\n` : ''}export const a = 1;\n`;
const baselineOf = (root) => JSON.parse(readFileSync(join(root, '.forge', 'codemap-baseline.json'), 'utf8'));
const symKeysOf = (bl, file) => (bl[file]?.keys ?? []).filter((k) => k.startsWith('sym:'));

// cm:why a lone repo with the code declared is what almost every case below needs, and building it by
//   hand in each one is how two cases end up testing different repositories under one name
function adopted(pluginRoot, files) {
  const root = makeRepo(files);
  cm(pluginRoot, root, 'baseline');
  const bl = baselineOf(root);
  bl.__codes = ['CM108'];
  for (const k of Object.keys(bl)) if (!k.startsWith('__')) bl[k].keys = bl[k].keys.filter((x) => !x.startsWith('sym:'));
  writeFileSync(join(root, '.forge', 'codemap-baseline.json'), `${JSON.stringify(bl, null, 2)}\n`);
  return root;
}

function tableCases(check) {
  check('symbols: CM108 is referential', CODE_TABLE.CM108.tier === 'referential',
    `tier was ${CODE_TABLE.CM108.tier} — the grammar tier blocks mid-keystroke, which is the one place this may not run`);
  check('symbols: CM108 carries a section pointer', /^§/.test(CODE_TABLE.CM108.section),
    `section was ${CODE_TABLE.CM108.section}`);
  const fix = CODE_TABLE.CM108.fix;
  check('symbols: the fix names all three outcomes, not one',
    /RENAMED/.test(fix) && /DELETED along with the claim/.test(fix) && /replace the example/.test(fix),
    `a fix reading "delete it" throws away the coupling codemap exists to carry; got: ${fix}`);
}

// cm:guard the published schema says additionalProperties:false, so a key `cm init` writes and the
//   schema does not declare makes every fresh registry invalid against its own contract (ISS-71)
function schemaCases(pluginRoot, check) {
  const schema = JSON.parse(readFileSync(join(pluginRoot, 'spec', 'schema', 'codemap.schema.json'), 'utf8'));
  const declared = Object.keys(schema.properties?.enforce?.properties ?? {});
  const missing = Object.keys(DEFAULT_REGISTRY.enforce).filter((k) => !declared.includes(k));
  check('symbols: every enforce key cm init writes is declared in the schema',
    missing.length === 0,
    `undeclared: ${missing.join(', ')} — enforce is additionalProperties:false, so cm init would write a registry its own schema refuses`);
}

function formCases(check) {
  const forms = DEFAULT_SYMBOL_FORMS;
  const names = (text, wrap, f = forms) => candidateSymbols({ raw: `cm:guard ${text}`, text, wrap }, f);

  check('symbols: a lowerCamelCase name is a candidate',
    JSON.stringify(names(`the lock is taken by \`${GHOST}\``)) === JSON.stringify([GHOST]),
    `got ${JSON.stringify(names(`the lock is taken by \`${GHOST}\``))}`);

  check('symbols: a name on the wrap line is a candidate',
    JSON.stringify(names('the lock is taken', 'by `claimRunnerSlot`')) === JSON.stringify([GHOST]),
    `a wrap is half the annotation, and the half a truncating reader loses; got ${JSON.stringify(names('x', 'by `claimRunnerSlot`'))}`);

  // cm:guard the classes ISS-71 names as must-not-report, each in an annotation of its own — one case
  //   over the set would go green on the first refusal and say nothing about the other four
  for (const tok of ['Referer', 'ENAMETOOLONG', 'RefCell', 'Dockerfile', 'Message_MaxAllowedSize']) {
    check(`symbols: \`${tok}\` is not a candidate under the default forms`,
      names(`the proxy strips \`${tok}\``).length === 0,
      `got ${JSON.stringify(names(`the proxy strips \`${tok}\``))} — this is a header, an error code, a stdlib type, a filename or a vendor setting, not a symbol here`);
  }
  for (const tok of ['api_tokens', 'needs_info']) {
    check(`symbols: \`${tok}\` is not a candidate under the default forms`,
      names(`the row lands in \`${tok}\``).length === 0,
      `got ${JSON.stringify(names(`the row lands in \`${tok}\``))} — a table and a status literal have the shape of a function name, which is why snake is opt-in`);
  }

  check('symbols: a backticked span holding whitespace is not a candidate',
    names('it reads `two words` here').length === 0,
    `got ${JSON.stringify(names('it reads `two words` here'))}`);
  check('symbols: a dotted token is judged on its first segment, as a CM106 anchor is',
    JSON.stringify(names('it calls `blockKeys.some(x)`')) === JSON.stringify(['blockKeys']),
    `got ${JSON.stringify(names('it calls `blockKeys.some(x)`'))}`);

  for (const [shape, span] of [['()', 'runCheck()'], ['(arg)', 'runCheck(arg)'], ['(a, b)', 'runCheck(a, b)']]) {
    check(`symbols: a trailing ${shape} is removed before the token is judged`,
      JSON.stringify(names(`it calls \`${span}\``)) === JSON.stringify(['runCheck']),
      `got ${JSON.stringify(names(`it calls \`${span}\``))}`);
  }
  // cm:guard removing a suffix is normalisation, never admission — admitting anything written with
  //   parens pulled in `creat()` and `getcwd()`, which are syscalls and not this repo's symbols
  check('symbols: a call suffix does not admit a token whose bare form is refused',
    names('it calls `getcwd()`').length === 0,
    `got ${JSON.stringify(names('it calls `getcwd()`'))}`);

  check('symbols: the const form admits SCREAMING_SNAKE only when opted into',
    names('it reads `STATUS_TO_JOB_TYPE`').length === 0
      && JSON.stringify(names('it reads `STATUS_TO_JOB_TYPE`', null, ['camel', 'const'])) === JSON.stringify(['STATUS_TO_JOB_TYPE']),
    'the const form is off by default because ERR_INVALID_ARG_TYPE has the same shape');
  check('symbols: the const form refuses a single word with no underscore',
    names('it throws `ENAMETOOLONG`', null, ['camel', 'const']).length === 0,
    `an errno name is one word; got ${JSON.stringify(names('it throws `ENAMETOOLONG`', null, ['camel', 'const']))}`);
  check('symbols: the snake form admits lower_snake only when opted into',
    names('it reads `requires_preflight`').length === 0
      && JSON.stringify(names('it reads `requires_preflight`', null, ['camel', 'snake'])) === JSON.stringify(['requires_preflight']),
    'the snake form is off by default because api_tokens has the same shape');

  check('symbols: formsFor falls back to the default when the registry declares nothing',
    JSON.stringify(formsFor({})) === JSON.stringify(DEFAULT_SYMBOL_FORMS),
    `got ${JSON.stringify(formsFor({}))}`);
  check('symbols: an unknown form name is named, not quietly dropped',
    JSON.stringify(unknownForms({ enforce: { symbolForms: ['const', 'nosuchform'] } })) === JSON.stringify(['nosuchform'])
      && unknownForms({}).length === 0,
    'a typo in the registry must not silently widen or narrow the rule');
}

function resolverCases(check, roots) {
  const mk = (files, opts) => { const r = makeRepo(files, opts); roots.push(r); return r; };

  const live = mk({ 'def.ts': `export function ${GHOST}() { return 1; }\n` });
  check('symbols: a name on a non-comment line resolves',
    resolveNames(live, [GHOST]).found.has(GHOST), 'the definition is right there');

  const commented = mk({ 'def.ts': `// ${GHOST} used to live here\nexport const a = 1;\n` });
  check('symbols: a name only inside a comment does not resolve',
    !resolveNames(commented, [GHOST]).found.has(GHOST),
    'a name that exists only in comments is the whole subject of this code');

  // cm:guard an unterminated block is left unmasked by codeOnly (ISS-59), so a name under one reads as
  //   code and this stays SILENT — every case the resolver cannot decide errs that way, never the other
  const unterminated = mk({ 'def.ts': `/* a block nobody closed\n${GHOST}\nexport const a = 1;\n` });
  check('symbols: a name below an unterminated block-comment opener resolves',
    resolveNames(unterminated, [GHOST]).found.has(GHOST),
    'CM203 already reports the opener; calling a name missing here would be an accusation the scanner cannot support');

  // cm:guard the name sits in a COMMENT of a profiled file over the cap, so only the over-cap branch
  //   can resolve it — under the cap, or unprofiled, the case goes green on a branch it is not about
  const big = mk({ 'huge.ts': `// ${GHOST} is named here\n${'const pad = 1;\n'.repeat(140_000)}` });
  check('symbols: a name in a file too large to mask resolves on its raw tokens',
    resolveNames(big, [GHOST]).found.has(GHOST),
    'dropping an oversized file from the universe would call a name missing that is there');

  // cm:guard likewise a PROFILED file, so the NUL branch is the only one that can resolve it — in an
  //   unprofiled file the no-profile branch answers and the case says nothing about NUL (ISS-71)
  const nul = mk({ 'blob.ts': `\0\0\n// ${GHOST} is named here\nexport const a = 1;\n` });
  check('symbols: a name in a file holding a NUL byte resolves on its raw tokens',
    resolveNames(nul, [GHOST]).found.has(GHOST),
    'a malformed or binary file is not a reason to accuse');

  // cm:guard a file the resolver could not OPEN could hold any of the names, so all of them resolve —
  //   accusing on evidence nobody read is the one error this tier may not make (ISS-71)
  const denied = mk({ 'locked.ts': 'export const pad = 1;\n' });
  chmodSync(join(denied, 'locked.ts'), 0o000);
  const stoodDown = resolveNames(denied, [GHOST]);
  chmodSync(join(denied, 'locked.ts'), 0o644);
  check('symbols: an unreadable file stands the code down and says which file',
    stoodDown.found.has(GHOST) && stoodDown.unreadable.includes('locked.ts'),
    `found=${[...stoodDown.found]} unreadable=${JSON.stringify(stoodDown.unreadable)}`);

  // cm:guard `git ls-files -z` separates on NUL, so a path is taken byte for byte — trimming it
  //   renamed a file whose name begins with a space and the read then missed it (ISS-71)
  const spaced = mk({ ' spaced.ts': `export const ${GHOST} = 1;\n` });
  const spacedRes = resolveNames(spaced, [GHOST]);
  // cm:guard `found` alone cannot see this — a trimmed path fails statSync, lands in `unreadable` and
  //   resolves everything anyway, so the case would go green on the stand-down instead (ISS-71)
  check('symbols: a filename with leading whitespace is read, not renamed',
    spacedRes.found.has(GHOST) && spacedRes.unreadable.length === 0,
    `found=${[...spacedRes.found]} unreadable=${JSON.stringify(spacedRes.unreadable)}`);

  const noProfile = mk({ 'data.unknown': `{ "handler": "${GHOST}" }\n` });
  check('symbols: a name in a file codemap has no profile for resolves',
    resolveNames(noProfile, [GHOST]).found.has(GHOST),
    'codemap cannot say what a comment is in that file, so all of it counts');

  const noGit = mk({ 'data.unknown': `{ "handler": "${GHOST}" }\n` }, { git: false });
  check('symbols: outside a git tree the fallback walk still reaches an unprofiled file',
    resolveNames(noGit, [GHOST]).found.has(GHOST),
    "registry.mjs's walk keeps only files that resolve to a profile, which is exactly the file that answers here");

  for (const [shape, src] of [
    ['a longer name holding it', `export const ${GHOST}Extra = 1;\n`],
    ['a longer name ending in it', `export const old${GHOST} = 1;\n`],
    ['a $ glued in front', `export const $${GHOST} = 1;\n`],
    ['a $ glued behind', `export const ${GHOST}$ = 1;\n`],
  ]) {
    const near = mk({ 'def.ts': src });
    check(`symbols: ${shape} does not resolve the candidate`,
      !resolveNames(near, [GHOST]).found.has(GHOST),
      `a substring match would silence a real ghost; got the name resolved from: ${src.trim()}`);
  }

  check('symbols: with no candidate the resolver reads no file',
    resolveNames(live, []).scanned === 0, 'a repo that names nothing must pay nothing');

  // cm:guard the early stop is what keeps the cost proportional — without it the resolver reads the
  //   whole tree to answer a question the first file already answered
  const many = {};
  for (let i = 0; i < 40; i++) many[`f${i}.ts`] = 'export const pad = 1;\n';
  many['aaa.ts'] = `export const ${GHOST} = 1;\n`;
  const wide = mk(many);
  const stopped = resolveNames(wide, [GHOST]);
  check('symbols: the resolver stops once every candidate has resolved',
    stopped.found.has(GHOST) && stopped.scanned < 41,
    `read ${stopped.scanned} of 41 files to answer one question`);

  check('symbols: the key is the name, so one file freezes one key per name',
    symbolKey(GHOST) === symbolKey(GHOST) && symbolKey(GHOST) !== symbolKey('other'),
    'a key per annotation would let one frozen site absolve a second name written into it later');
}

function verifyCases(pluginRoot, check, roots) {
  const mk = (files) => { const r = adopted(pluginRoot, files); roots.push(r); return r; };

  const ghostRepo = mk({ 'guard.ts': guard(`the lock is taken by \`${GHOST}\``) });
  const bare = cm(pluginRoot, ghostRepo, 'verify');
  check('symbols: a cm:guard naming a ghost is CM108 at the annotation\'s line',
    bare.status === 1 && /guard\.ts:1 .*CM108/.test(bare.out),
    `expected exit 1 with CM108 at guard.ts:1:\n${bare.out}`);

  const whyRepo = mk({ 'why.ts': `// cm:why the default stays cautious because \`${GHOST}\` reads it\nexport const a = 1;\n` });
  check('symbols: a cm:why naming a ghost is reported the same way',
    cm(pluginRoot, whyRepo, 'verify').status === 1,
    'cm:why carries prose exactly as cm:guard does, and rots the same way');

  const wrapRepo = mk({ 'guard.ts': guard('the lock is taken', `by \`${GHOST}\``) });
  check('symbols: a ghost named on the wrap line is reported',
    /CM108/.test(cm(pluginRoot, wrapRepo, 'verify').out),
    'the wrap is the half that carries the consequence');

  const liveRepo = mk({
    'guard.ts': guard(`the lock is taken by \`${GHOST}\``),
    'def.ts': `export function ${GHOST}() { return 1; }\n`,
  });
  const green = cm(pluginRoot, liveRepo, 'verify');
  check('symbols: a name that is in the code draws nothing',
    green.status === 0 && !/CM108/.test(green.out), `expected a green tree:\n${green.out}`);

  const tiers = mk({ 'guard.ts': guard(`the lock is taken by \`${GHOST}\``) });
  check('symbols: --tier grammar does not report CM108',
    !/CM108/.test(cm(pluginRoot, tiers, 'verify', '--tier', 'grammar').out),
    'the grammar tier is the one that blocks an edit, and mid-keystroke is the wrong moment to ask whether a name exists');
  check('symbols: --tier referential reports CM108',
    /CM108/.test(cm(pluginRoot, tiers, 'verify', '--tier', 'referential').out),
    'this is the tier the code declares');

  const hushed = mk({
    'guard.ts': `// cm:ignore CM108 — the runner lives in the other repo\n// cm:guard the lock is taken by \`${GHOST}\`\nexport const a = 1;\n`,
  });
  check('symbols: cm:ignore CM108 on the line above silences it',
    cm(pluginRoot, hushed, 'verify').status === 0,
    'the escape hatch is the one every other code already has');
  const wrongCode = mk({
    'guard.ts': `// cm:ignore CM102 — nothing to do with this\n// cm:guard the lock is taken by \`${GHOST}\`\nexport const a = 1;\n`,
  });
  check('symbols: an ignore naming another code does not silence CM108',
    /CM108/.test(cm(pluginRoot, wrongCode, 'verify').out),
    'an ignore is per code, and one that silenced every code would be a comment nobody could review');

  // cm:guard the token set is whole-tree even on a scoped run — narrowing it with the report would
  //   refuse a PR for a symbol living in a file the diff never opened (ISS-71)
  const scoped = mk({
    'guard.ts': 'export const seed = 1;\n',
    'def.ts': `export function ${GHOST}() { return 1; }\n`,
  });
  git(scoped, 'add', '-A');
  git(scoped, 'commit', '-qm', 'base');
  writeFileSync(join(scoped, 'guard.ts'), guard(`the lock is taken by \`${GHOST}\``));
  const sinceLive = cm(pluginRoot, scoped, 'verify', '--since', 'HEAD');
  check('symbols: --since resolves against the whole tree, not the diff',
    !/CM108/.test(sinceLive.out),
    `the definition is in a file the diff did not touch, and it still answers:\n${sinceLive.out}`);
  writeFileSync(join(scoped, 'def.ts'), 'export const nothing = 1;\n');
  git(scoped, 'add', '-A');
  git(scoped, 'commit', '-qm', 'both');
  writeFileSync(join(scoped, 'guard.ts'), guard(`the lock is still taken by \`${GHOST}\``));
  check('symbols: --since reports a ghost in a file the diff touched',
    /CM108/.test(cm(pluginRoot, scoped, 'verify', '--since', 'HEAD').out),
    'the annotation is in the diff and the name is in no code');

  const untouched = mk({
    'guard.ts': guard(`the lock is taken by \`${GHOST}\``),
    'other.ts': 'export const b = 2;\n',
  });
  writeFileSync(join(untouched, 'other.ts'), 'export const b = 3;\n');
  git(untouched, 'add', '-A');
  git(untouched, 'commit', '-qm', 'touch other');
  check('symbols: a scoped run scopes CM108 to its own files, exactly as it scopes CM102',
    !/CM108/.test(cm(pluginRoot, untouched, 'verify', '--since', 'HEAD~1').out),
    'a commit gate that refused on a file the commit never touched would block work that is not the committer\'s');
}

function adoptionCases(pluginRoot, check, roots) {
  const mk = (files, opts) => { const r = makeRepo(files, opts); roots.push(r); return r; };
  const ghostSrc = { 'guard.ts': guard(`the lock is taken by \`${GHOST}\``) };

  // cm:guard an adopted repo whose baseline predates the code must stay GREEN on upgrade — a new
  //   gating code that turns a repo red the day it ships teaches the upgrade to be deferred (ISS-71)
  const undeclared = mk(ghostSrc);
  const quiet = cm(pluginRoot, undeclared, 'verify');
  check('symbols: a baseline that does not declare CM108 draws none of it',
    quiet.status === 0 && !/guard\.ts:1/.test(quiet.out), `expected a green tree:\n${quiet.out}`);
  check('symbols: an undeclared repo is told which command adopts the code',
    /CM108/.test(quiet.out) && /cm baseline/.test(quiet.out),
    `silence about an unadopted code is how it never gets adopted:\n${quiet.out}`);
  check('symbols: --no-baseline reports CM108 in a repo that has not declared it',
    /CM108/.test(cm(pluginRoot, undeclared, 'verify', '--no-baseline').out),
    '--no-baseline means "show me everything the baseline hides", never "hide one more thing"');

  const froze = mk(ghostSrc);
  cm(pluginRoot, froze, 'baseline');
  const bl = baselineOf(froze);
  check('symbols: a whole-tree cm baseline declares the code',
    (bl.__codes ?? []).includes('CM108'), `__codes was ${JSON.stringify(bl.__codes)}`);
  check('symbols: a whole-tree cm baseline freezes the sites that are there',
    symKeysOf(bl, 'guard.ts').length === 1, `keys were ${JSON.stringify(bl['guard.ts'])}`);
  check('symbols: cm verify reports none of the frozen sites',
    cm(pluginRoot, froze, 'verify').status === 0, 'a freeze that did not silence would not be a freeze');

  writeFileSync(join(froze, 'guard.ts'),
    `${guard(`the lock is taken by \`${GHOST}\``).trimEnd()}\n// cm:guard and released by \`releaseRunnerSlot\`\nexport const b = 2;\n`);
  const afterNew = cm(pluginRoot, froze, 'verify');
  check('symbols: a name the freeze did not cover is reported in an already-frozen file',
    afterNew.status === 1 && /releaseRunnerSlot/.test(afterNew.out),
    `the key is per file and NAME, so a second name is a key nothing holds:\n${afterNew.out}`);
  check('symbols: the name the freeze covered stays silent beside it',
    !new RegExp(`${GHOST}\\b`).test(afterNew.out.replace(/releaseRunnerSlot/g, '')),
    `freezing one name may not un-freeze it when a second appears:\n${afterNew.out}`);

  const repeated = mk(ghostSrc);
  cm(pluginRoot, repeated, 'baseline');
  writeFileSync(join(repeated, 'guard.ts'),
    `${guard(`the lock is taken by \`${GHOST}\``).trimEnd()}\n// cm:guard and so is the tail, by \`${GHOST}\`\nexport const b = 2;\n`);
  check('symbols: a second annotation naming an already-frozen name is covered by that key',
    cm(pluginRoot, repeated, 'verify').status === 0,
    'the key is per file and name, so the same name twice in one file is one debt');

  const dirty = mk({ 'seed.ts': 'export const a = 1;\n' });
  cm(pluginRoot, dirty, 'baseline');
  writeFileSync(join(dirty, 'guard.ts'), guard(`the lock is taken by \`${GHOST}\``));
  cm(pluginRoot, dirty, 'baseline');
  check('symbols: cm baseline does not freeze a site whose annotation is not in HEAD',
    symKeysOf(baselineOf(dirty), 'guard.ts').length === 0,
    'cm baseline is the cheapest escape from a blocking code, and it may not absolve one written since the commit');
  cm(pluginRoot, dirty, 'baseline', '--include-new');
  check('symbols: cm baseline --include-new freezes it',
    symKeysOf(baselineOf(dirty), 'guard.ts').length === 1,
    'that is an operator decision about debt, and it is the one already on the command');

  const scopedFreeze = mk({
    'a.ts': guard(`the lock is taken by \`${GHOST}\``),
    'b.ts': `// cm:guard and released by \`releaseRunnerSlot\`\nexport const b = 2;\n`,
  });
  cm(pluginRoot, scopedFreeze, 'baseline', 'a.ts');
  const scopedBl = baselineOf(scopedFreeze);
  check('symbols: a scoped cm baseline does not declare the code',
    !(scopedBl.__codes ?? []).includes('CM108'),
    'a scoped run cannot see the sites in the files it never scanned, so declaring from one gates the repo on legacy it could not freeze');

  const merged = mk({
    'a.ts': guard(`the lock is taken by \`${GHOST}\``),
    'b.ts': `// cm:guard and released by \`releaseRunnerSlot\`\nexport const b = 2;\n`,
  });
  cm(pluginRoot, merged, 'baseline');
  cm(pluginRoot, merged, 'baseline', 'b.ts');
  const mergedBl = baselineOf(merged);
  check('symbols: a scoped re-freeze keeps the declaration',
    (mergedBl.__codes ?? []).includes('CM108'), `__codes was ${JSON.stringify(mergedBl.__codes)}`);
  check('symbols: a scoped re-freeze freezes its own path\'s sites',
    symKeysOf(mergedBl, 'b.ts').length === 1, `b.ts held ${JSON.stringify(mergedBl['b.ts'])}`);
  check('symbols: a scoped re-freeze leaves another file\'s key alone',
    symKeysOf(mergedBl, 'a.ts').length === 1, `a.ts held ${JSON.stringify(mergedBl['a.ts'])}`);

  const fresh = mk(ghostSrc, { git: false });
  rmSync(join(fresh, '.forge', 'codemap.json'));
  cm(pluginRoot, fresh, 'init');
  const freshBl = baselineOf(fresh);
  check('symbols: cm init declares the code',
    (freshBl.__codes ?? []).includes('CM108'), `__codes was ${JSON.stringify(freshBl.__codes)}`);
  // cm:guard init takes the tree AS IT STANDS, with no HEAD rule — a repo being onboarded may have no
  //   commit at all, and a declaration without the freeze beside it is red on the first run (ISS-71)
  check('symbols: cm init freezes a site that is in no commit',
    symKeysOf(freshBl, 'guard.ts').length === 1, `keys were ${JSON.stringify(freshBl['guard.ts'])}`);
  check('symbols: the verify after cm init is green',
    cm(pluginRoot, fresh, 'verify').status === 0, 'onboarding that leaves a repo red is onboarding nobody completes');
}

function accountingCases(pluginRoot, check, roots) {
  const mk = (files) => { const r = makeRepo(files); roots.push(r); return r; };
  const both = mk({
    'mixed.ts': `// a legacy sentence nobody owns\n// cm:guard the lock is taken by \`${GHOST}\`\nexport const a = 1;\n`,
  });

  // cm:guard a CM108 key is frozen but never COUNTED as a comment — the debt line is what the case
  //   study quotes as ground truth, and four commands must not print four totals for one file (ISS-71)
  const froze = cm(pluginRoot, both, 'baseline');
  check('symbols: cm baseline counts the prose key and not the CM108 key',
    /froze 1 pre-existing prose comments across 1 files/.test(froze.out), `got: ${froze.out}`);
  check('symbols: the file really holds both kinds of key',
    symKeysOf(baselineOf(both), 'mixed.ts').length === 1
      && baselineOf(both)['mixed.ts'].keys.length > 1,
    `keys were ${JSON.stringify(baselineOf(both)['mixed.ts'])}`);
  const ver = cm(pluginRoot, both, 'verify');
  check('symbols: the legacy debt line counts the prose key and not the CM108 key',
    /legacy prose: 1 distinct still frozen/.test(ver.out), `got: ${ver.out}`);
  check('symbols: cm doctor counts the prose key and not the CM108 key',
    /1 comments frozen/.test(cm(pluginRoot, both, 'doctor').out),
    `got: ${cm(pluginRoot, both, 'doctor').out}`);

  const init = mk({ 'mixed.ts': `// a legacy sentence nobody owns\n// cm:guard the lock is taken by \`${GHOST}\`\nexport const a = 1;\n` });
  rmSync(join(init, '.forge', 'codemap.json'));
  const initOut = cm(pluginRoot, init, 'init', '--prose').out;
  check('symbols: cm init counts the prose key and not the CM108 key',
    /1 legacy comments frozen by content/.test(initOut), `got: ${initOut}`);
  check('symbols: cm init froze the CM108 key beside it',
    symKeysOf(baselineOf(init), 'mixed.ts').length === 1,
    `keys were ${JSON.stringify(baselineOf(init)['mixed.ts'])}`);

  // cm:guard frozen is not forever — freeze-and-drain is the mechanism ISS-71 names, so a site whose
  //   symbol came back or whose annotation went away is a key sweep must DROP, and count as stale
  const drain = mk({ 'guard.ts': guard(`the lock is taken by \`${GHOST}\``) });
  cm(pluginRoot, drain, 'baseline');
  const kept = cm(pluginRoot, drain, 'sweep', '--prune-baseline');
  check('symbols: a prune keeps a CM108 key whose site still raises the code',
    symKeysOf(baselineOf(drain), 'guard.ts').length === 1, `after the prune: ${kept.out}`);
  check('symbols: a prune keeps the declaration',
    (baselineOf(drain).__codes ?? []).includes('CM108'),
    'dropping the code a repo has adopted would un-gate it with nothing said');
  writeFileSync(join(drain, 'def.ts'), `export function ${GHOST}() { return 1; }\n`);
  const dropped = cm(pluginRoot, drain, 'sweep', '--prune-baseline');
  check('symbols: a prune drops a CM108 key whose site no longer raises the code',
    symKeysOf(baselineOf(drain), 'guard.ts').length === 0, `after the prune: ${dropped.out}`);
  check('symbols: the dropped key is counted stale',
    /dropped 1 stale key/.test(dropped.out), `got: ${dropped.out}`);
}

// cm:guard a typo'd form name must be exit 2 and not a green run with the code off — that is this
//   CLI's own recurring fail-open shape, a scope nobody could compute reported as a clean one
function badFormCases(pluginRoot, check, roots) {
  const root = adopted(pluginRoot, { 'guard.ts': guard(`the lock is taken by \`${GHOST}\``) });
  roots.push(root);
  writeFileSync(join(root, '.forge', 'codemap.json'), '{ "enforce": { "symbolForms": ["camle"] } }\n');
  const r = cm(pluginRoot, root, 'verify');
  check('symbols: a mistyped enforce.symbolForms is exit 2, not a green gate with CM108 off',
    r.status === 2 && /unknown enforce\.symbolForms: camle/.test(r.out),
    `expected exit 2 naming the typo, got ${r.status}:\n${r.out}`);
}

function hookCases(pluginRoot, check, roots) {
  const root = adopted(pluginRoot, { 'guard.ts': guard(`the lock is taken by \`${GHOST}\``) });
  roots.push(root);

  // cm:guard --changed-lines is the edit hook's own invocation, and this code walks the repository —
  //   2.1s on a 3061-file tree measured at fc2003c, which is not a cost to pay per keystroke (ISS-71)
  const hook = cm(pluginRoot, root, 'verify', '--fix', '--json', '--changed-lines', 'guard.ts');
  check('symbols: the edit hook\'s run reports no CM108',
    !/CM108/.test(hook.out), `got:\n${hook.out}`);
  let report = null;
  try { report = JSON.parse(hook.stdout); } catch { report = null; }
  check('symbols: the edit hook\'s run reads no file for CM108',
    report?.symbolsScanned === 0,
    `symbolsScanned was ${report?.symbolsScanned} — a run that scans and throws the answer away still pays for it`);

  const quiet = adopted(pluginRoot, { 'plain.ts': '// cm:guard the lock is taken whole, never row by row\nexport const a = 1;\n' });
  roots.push(quiet);
  let plain = null;
  try { plain = JSON.parse(cm(pluginRoot, quiet, 'verify', '--json').stdout); } catch { plain = null; }
  check('symbols: a repo naming no candidate reads no file for CM108',
    plain?.symbolsScanned === 0,
    `symbolsScanned was ${plain?.symbolsScanned} — a repo that names nothing must pay nothing`);
}

export function symbolCases(pluginRoot, check) {
  const roots = [];
  try {
    tableCases(check);
    schemaCases(pluginRoot, check);
    formCases(check);
    resolverCases(check, roots);
    verifyCases(pluginRoot, check, roots);
    adoptionCases(pluginRoot, check, roots);
    accountingCases(pluginRoot, check, roots);
    badFormCases(pluginRoot, check, roots);
    hookCases(pluginRoot, check, roots);
  } finally {
    for (const r of roots) rmSync(r, { recursive: true, force: true });
  }
}
