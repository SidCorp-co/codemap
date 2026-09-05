// ISS-3 — the north-star counter. Pure-function cases for the predicate and the reconcile/aggregate
// logic, then a wiring-style tier that runs the real PostToolUse hook and `cm metrics` against a
// throwaway git repo, the same shape as tests/wiring.mjs and tests/install.mjs.

import {
  mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, mkdirSync,
} from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { blockingDiags } from '../cli/lib/blocking.mjs';
import { reconcile, eventCounts, buildPayload, metricsPaths, registryFlips } from '../cli/lib/metrics.mjs';

function git(root, ...args) {
  execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_NAME: 'cm', GIT_AUTHOR_EMAIL: 'cm@test',
      GIT_COMMITTER_NAME: 'cm', GIT_COMMITTER_EMAIL: 'cm@test' },
  });
}

function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), 'cm-metrics-'));
  mkdirSync(join(root, '.forge'));
  writeFileSync(join(root, '.forge', 'codemap.json'), '{}\n');
  writeFileSync(join(root, 'a.ts'), '// Load the config\nexport const a = 1;\n');
  git(root, 'init', '-q');
  git(root, 'add', '-A');
  git(root, 'commit', '-qm', 'seed');
  return root;
}

function events(root) {
  try {
    return readFileSync(metricsPaths(root).events, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch { return []; }
}

function runHook(pluginRoot, root, file) {
  const res = spawnSync(process.execPath, [join(pluginRoot, 'cli', 'hooks', 'hook-post-edit.mjs')], {
    input: JSON.stringify({ cwd: root, tool_name: 'Edit', tool_input: { file_path: file } }),
    encoding: 'utf8',
  });
  let json = null;
  try { json = JSON.parse(res.stdout); } catch { json = null; }
  return { ...res, json };
}

function runCm(pluginRoot, root, ...args) {
  const res = spawnSync(process.execPath, [join(pluginRoot, 'cli', 'cm.mjs'), ...args],
    { cwd: root, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
  return { ...res, out: `${res.stdout}${res.stderr}` };
}

export function metricsCases(pluginRoot, check) {
  check('metrics: blockingDiags blocks CM001 in an onboarded, readable-baseline repo',
    blockingDiags({ onboarded: true, baselineUnreadable: false, diags: [{ code: 'CM001', tier: 'grammar' }] }).length === 1,
    'the hook and the reconciler must agree on what counts as blocked');
  check('metrics: blockingDiags spares prose in an un-onboarded repo',
    blockingDiags({ onboarded: false, baselineUnreadable: false, diags: [{ code: 'CM001', tier: 'grammar' }] }).length === 0,
    'prose enforcement is opt-in per repo');
  check('metrics: blockingDiags never counts CM009 (auto-fixed already)',
    blockingDiags({ onboarded: true, baselineUnreadable: false, diags: [{ code: 'CM009', tier: 'grammar' }] }).length === 0,
    'CM009 is normalized before the report is read, never blocked on');
  check('metrics: blockingDiags ignores structural/advisory tiers',
    blockingDiags({ onboarded: true, baselineUnreadable: false, diags: [{ code: 'CM301', tier: 'advisory' }, { code: 'CM201', tier: 'structural' }] }).length === 0,
    'only grammar blocks (§7)');

  const agg = eventCounts([
    { event: 'block', codes: ['CM001'] },
    { event: 'block', codes: ['CM001'] },
    { event: 'held', codes: ['CM001'] },
    { event: 'circumvented', codes: ['CM010'] },
    { event: 'annotation-snapshot', data: { total: 5 } },
  ]);
  check('metrics: eventCounts tallies block/held/circumvented per code',
    agg.CM001.block === 2 && agg.CM001.held === 1 && agg.CM010.circumvented === 1,
    `got ${JSON.stringify(agg)}`);
  check('metrics: eventCounts ignores snapshot events',
    !('undefined' in agg) && Object.keys(agg).length === 2,
    `snapshot events carry no code and must not pollute the tally: ${JSON.stringify(agg)}`);

  check('metrics: registryFlips counts on/off transitions, not just the current state',
    registryFlips([
      { grammarEnabled: true, advisoryEnabled: false },
      { grammarEnabled: false, advisoryEnabled: false },
      { grammarEnabled: false, advisoryEnabled: true },
    ]) === 2,
    'required outcome 3 (ISS-3): the rate a check gets turned off, not just today\'s state');

  {
    const root = mkdtempSync(join(tmpdir(), 'cm-metrics-pure-'));
    mkdirSync(join(root, '.forge'));
    git(root, 'init', '-q');
    writeFileSync(join(root, 'x.ts'), 'x\n');
    git(root, 'add', '-A');
    git(root, 'commit', '-qm', 'seed');
    try {
      reconcile(root, 'x.ts', [{ code: 'CM001', line: 1 }]);
      check('metrics: reconcile records a block event', events(root).some((e) => e.event === 'block' && e.codes.includes('CM001')),
        `events: ${JSON.stringify(events(root))}`);

      reconcile(root, 'x.ts', []);
      const held = events(root).filter((e) => e.event === 'held');
      check('metrics: reconcile marks a code held once it stops blocking', held.length === 1 && held[0].codes.includes('CM001'),
        `events: ${JSON.stringify(events(root))}`);
      check('metrics: a held event never carries the diagnostic text, only code/tier/file/heldMs',
        Object.keys(held[0]).sort().join(',') === 'codes,event,file,heldMs,tier,ts',
        `held event shape was: ${JSON.stringify(held[0])}`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  {
    const root = mkdtempSync(join(tmpdir(), 'cm-metrics-sameline-'));
    mkdirSync(join(root, '.forge'));
    git(root, 'init', '-q');
    writeFileSync(join(root, 'y.ts'), 'y\n');
    git(root, 'add', '-A');
    git(root, 'commit', '-qm', 'seed');
    try {
      reconcile(root, 'y.ts', [{ code: 'CM001', line: 1 }, { code: 'CM001', line: 40 }]);
      reconcile(root, 'y.ts', [{ code: 'CM001', line: 40 }]);
      const held = events(root).filter((e) => e.event === 'held');
      check('metrics: fixing ONE instance of a repeated code is held, even while another instance of the same code remains',
        held.length === 1, `events: ${JSON.stringify(events(root))}`);
      check('metrics: the still-blocking instance stays pending, not silently dropped',
        JSON.parse(readFileSync(metricsPaths(root).pending, 'utf8'))['y.ts']?.at['CM001@40'] !== undefined,
        `pending.json: ${readFileSync(metricsPaths(root).pending, 'utf8')}`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  {
    const root = mkdtempSync(join(tmpdir(), 'cm-metrics-order-'));
    mkdirSync(join(root, '.forge'));
    git(root, 'init', '-q');
    writeFileSync(join(root, 'z.ts'), 'z\n');
    git(root, 'add', '-A');
    git(root, 'commit', '-qm', 'seed');
    try {
      reconcile(root, 'z.ts', [{ code: 'CM001', line: 1 }]);
      spawnSync('sleep', ['2']);
      writeFileSync(join(root, 'z.ts'), 'fixed\n');
      git(root, 'commit', '-qam', 'fix it, then commit — the ordinary flow');
      reconcile(root, 'z.ts', []);
      check('metrics: a genuine fix committed afterward is held, never circumvented',
        events(root).some((e) => e.event === 'held') && !events(root).some((e) => e.event === 'circumvented'),
        `a commit landing AFTER a real fix must not read as evasion: ${JSON.stringify(events(root))}`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  {
    const root = mkdtempSync(join(tmpdir(), 'cm-metrics-payload-'));
    mkdirSync(join(root, '.forge'));
    try {
      reconcile(root, 'secret-customer-file.ts', [{ code: 'CM001', line: 1 }]);
      const payload = buildPayload(root, { reg: { specVersion: 'codemap/1' }, g: { guards: [], edges: [], hacks: [], whys: [], flows: new Map(), byFile: new Map() } });
      const flat = JSON.stringify(payload);
      check('metrics: the send/show payload never names a file', !flat.includes('secret-customer-file'),
        `payload leaked a filename: ${flat}`);
      check('metrics: the payload has exactly the documented top-level keys',
        Object.keys(payload).sort().join(',') === 'annotations,blocks,generatedAt,pendingUnresolved,registry,specVersion',
        `payload keys: ${Object.keys(payload).sort().join(',')}`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  const roots = [];
  try {
    const root = makeRepo();
    roots.push(root);

    const blocked = runHook(pluginRoot, root, join(root, 'a.ts'));
    check('metrics: the hook still blocks exactly as before (no behaviour change)',
      blocked.json?.decision === 'block' && /CM001/.test(blocked.json.reason),
      `hook said: ${blocked.stdout || '(empty)'}`);
    check('metrics: the hook records the block as a local event',
      events(root).some((e) => e.event === 'block' && e.codes.includes('CM001') && e.file === 'a.ts'),
      `events: ${JSON.stringify(events(root))}`);

    writeFileSync(join(root, 'a.ts'), 'export const a = 1;\n');
    const clean = runHook(pluginRoot, root, join(root, 'a.ts'));
    check('metrics: fixing the file and re-editing records a held event',
      clean.stdout.trim() === '' && events(root).some((e) => e.event === 'held' && e.file === 'a.ts'),
      `events: ${JSON.stringify(events(root))}`);

    const show = runCm(pluginRoot, root, 'metrics', 'show', '--json');
    const payload = JSON.parse(show.stdout);
    check('metrics: cm metrics show --json reports the held block',
      payload.blocks.CM001?.block === 1 && payload.blocks.CM001?.held === 1,
      `show --json said: ${show.out}`);

    const sendNoEndpoint = runCm(pluginRoot, root, 'metrics', 'send', '--yes');
    const previewedNoEndpoint = JSON.parse(sendNoEndpoint.out.split('\n\n')[0]);
    check('metrics: send refuses without --endpoint even with --yes',
      /no --endpoint given/.test(sendNoEndpoint.out) && JSON.stringify(previewedNoEndpoint.blocks) === JSON.stringify(payload.blocks),
      `send said: ${sendNoEndpoint.out}`);

    const sendDryRun = runCm(pluginRoot, root, 'metrics', 'send', '--endpoint', 'https://example.invalid/collect');
    const previewedDryRun = JSON.parse(sendDryRun.out.split('\n\n')[0]);
    check('metrics: send without --yes only previews — the preview IS the payload it would send',
      /nothing sent/.test(sendDryRun.out) && JSON.stringify(previewedDryRun.blocks) === JSON.stringify(payload.blocks),
      `send said: ${sendDryRun.out}`);

    check('metrics: nothing here ever touches the repo\'s .gitignore',
      !existsSync(join(root, '.gitignore')),
      'the local sink must never silently rewrite a file it did not create');

    writeFileSync(join(root, 'b.ts'), '// Load the config\nexport const b = 1;\n');
    git(root, 'add', '-A');
    git(root, 'commit', '-qm', 'add b.ts');
    runHook(pluginRoot, root, join(root, 'b.ts'));
    // cm:why commitsSince requires a commit at least 1s past the block's ts (see its own cm:why) — this
    //   sleep is what actually puts the "shipped anyway" commit on the other side of that line
    spawnSync('sleep', ['2']);
    writeFileSync(join(root, 'b.ts'), '// Load the config\nexport const b = 1;\nexport const c = 2;\n');
    git(root, 'commit', '-qam', 'shipped b.ts anyway, still has the prose');
    const rec = runCm(pluginRoot, root, 'metrics', 'reconcile');
    check('metrics: reconcile runs over the whole pending set', /pending file\(s\) checked/.test(rec.out), rec.out);
    check('metrics: a block shipped anyway (past the hook, into a commit) is counted circumvented, not held',
      events(root).some((e) => e.event === 'circumvented' && e.file === 'b.ts'),
      `a block that made it into a commit unresolved must never read as a success: ${JSON.stringify(events(root))}`);
  } finally {
    for (const r of roots) rmSync(r, { recursive: true, force: true });
  }
}
