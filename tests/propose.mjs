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
import { proseCandidates, lockstepCandidates, contractCandidates } from '../cli/lib/propose.mjs';

function git(root, ...args) {
  execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_NAME: 'cm', GIT_AUTHOR_EMAIL: 'cm@test',
      GIT_COMMITTER_NAME: 'cm', GIT_COMMITTER_EMAIL: 'cm@test' },
  });
}

function cm(pluginRoot, root, ...args) {
  const res = spawnSync(process.execPath, [join(pluginRoot, 'cli', 'cm.mjs'), ...args], {
    cwd: root, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' },
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

    const noSep = contractCandidates(root, ['emit.go', 'noisy.ts']);
    check('propose: contract ignores a plain word with no separator (no coincidental "hello")',
      !noSep.some((c) => c.literal === 'hello'), `"hello" should not qualify: ${JSON.stringify(noSep)}`);

    writeFileSync(join(root, 'tag.ts'), '// cm:why this mirrors emit.go\nexport const x = 1;\n');
    writeFileSync(join(root, 'tag.go'), 'const y = "cm:why"\n');
    const reserved = contractCandidates(root, ['tag.ts', 'tag.go']);
    check('propose: contract excludes this tool\'s own reserved tag vocabulary',
      reserved.length === 0, `cm:why should be excluded, got ${JSON.stringify(reserved)}`);
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
    git(root, 'init', '-q');
    git(root, 'add', '-A');
    git(root, 'commit', '-qm', 'seed');

    const r = cm(pluginRoot, root, 'propose');
    check('cli: propose exits 0 — a proposal never gates', r.status === 0, `status ${r.status}\n${r.out}`);
    check('cli: propose surfaces the prose candidate', /product_create\.go/.test(r.out), r.out);
    check('cli: propose never writes a fabricated — why', !/—\s*why they/.test(r.out) || /add\s*—\s*why/.test(r.out),
      'a suggestion line must not assert a why it did not derive');
    check('cli: propose says a candidate is not a fact', /not a fact/.test(r.out), r.out);

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
