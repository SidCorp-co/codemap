#!/usr/bin/env node
// Golden-corpus runner. No test framework — the plugin must run on a bare node (§8 rationale).

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { analyzeFile } from '../cli/lib/analyze.mjs';
import { buildGraph, referentialDiags, structuralDiags, orderFlow, impact, annText } from '../cli/lib/graph.mjs';
import { DEFAULT_REGISTRY } from '../cli/lib/registry.mjs';
import { baselineKey, parseAnnotation } from '../cli/lib/parse.mjs';
import { analyzeCases, baselineCases, codeShapeCases, graphCases, parseCases } from './cases.mjs';
import { wiringCases } from './wiring.mjs';
import { cliCases } from './cli.mjs';
import { installCases } from './install.mjs';
import { helpCases } from './help.mjs';
import { metricsCases } from './metrics.mjs';
import { releaseTagCases } from './release-tag.mjs';
import { mcpCases } from './mcp.mjs';
import { upgradeWorkflowCases } from './upgrade-workflow.mjs';
import { notifyConsumersCases } from './notify-consumers.mjs';
import { prCommentCases } from './prcomment.mjs';
import { proposeCases } from './propose.mjs';
import { massCases } from './mass.mjs';
import { profileCases } from './profiles.mjs';
import { gitEnvCases } from './git-env-cases.mjs';
import { stripGitEnv } from './git-env.mjs';
import { pushCases, pushSourceCases } from './push.mjs';
import { pushAll } from '../cli/lib/push.mjs';

// cm:guard the corpus neutralises its OWN environment, not merely each child's: tiers call cli/lib
//   in process (changedStaged, lockstepCandidates, archmap) and those git calls take no env (ISS-39)
// cm:guard ESM hoists every import above this, so it is NOT ahead of load-time reads — it holds only
//   because no module here touches a GIT_ variable while evaluating; keep it that way (ISS-39)
// cm:edge protocol -> tests/git-env.mjs — this REPLACES the run's git environment for the process,
//   so a tier that wants the ambient one has to capture it before this block (ISS-39)
{
  const scrubbed = stripGitEnv(process.env);
  for (const key of Object.keys(process.env)) if (!(key in scrubbed)) delete process.env[key];
  Object.assign(process.env, scrubbed);
}

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let pass = 0;
const failures = [];

function check(name, ok, detail) {
  if (ok) { pass++; return; }
  failures.push(`${name}\n    ${detail}`);
}

function sortedCodes(diags) {
  return diags.map((d) => d.code).sort();
}

for (const t of analyzeCases) {
  const reg = t.reg
    ? { ...DEFAULT_REGISTRY, ...t.reg, enforce: { ...DEFAULT_REGISTRY.enforce, ...(t.reg.enforce ?? {}) } }
    : DEFAULT_REGISTRY;
  // cm:why a case may declare frozen prose by TEXT — §4's "a frozen line is never a continuation" and
  //   the overflow count that rests on it are otherwise reachable by no case at all (ISS-33)
  // cm:guard a THROW here is a failing case, never a dead run — without this an analyzer crash
  //   terminates the process and the remaining suites report nothing at all (ISS-43)
  let res;
  try {
    res = analyzeFile({ relPath: t.file, src: t.src, reg,
      frozen: t.frozen ? new Set(t.frozen.map(baselineKey)) : undefined });
  } catch (err) {
    check(t.name, false, `analyzeFile threw: ${err?.stack ?? err}`);
    continue;
  }

  if (t.skipped) {
    check(t.name, res.skipped === t.skipped, `expected skipped=${t.skipped}, got ${res.skipped}`);
    continue;
  }

  const got = sortedCodes(res.diags);
  const want = [...(t.codes ?? [])].sort();
  check(t.name, JSON.stringify(got) === JSON.stringify(want), `codes: expected [${want}] got [${got}]`);

  const gotTags = res.annotations.map((a) => a.tag);
  const wantTags = t.annotations ?? [];
  check(`${t.name} (annotations)`, JSON.stringify(gotTags) === JSON.stringify(wantTags),
    `annotations: expected [${wantTags}] got [${gotTags}]`);

  if (t.texts) {
    const got2 = res.annotations.map((a) => annText(a));
    check(`${t.name} (text)`, JSON.stringify(got2) === JSON.stringify(t.texts),
      `annText: expected ${JSON.stringify(t.texts)} got ${JSON.stringify(got2)} — the hook injects this, so a dropped wrap is a truncated invariant`);
  }

  if (t.sited) {
    const got2 = res.diags.filter((d) => d.sited).map((d) => d.line).sort((a, b) => a - b);
    check(`${t.name} (sited)`, JSON.stringify(got2) === JSON.stringify(t.sited),
      `sited lines: expected [${t.sited}] got [${got2}]`);
  }

  if (t.proseKeyCount !== undefined) {
    check(`${t.name} (proseKeys)`, res.proseKeys.length === t.proseKeyCount,
      `proseKeys: expected ${t.proseKeyCount} got ${res.proseKeys.length} — this set is what tells verify/prune a frozen comment is GONE`);
  }

  if (t.fixMatches) {
    const bad = res.diags.filter((d) => !t.fixMatches.test(d.fix));
    check(`${t.name} (fix)`, bad.length === 0,
      `every diagnostic's fix must match ${t.fixMatches}; got: ${bad.map((d) => d.fix).join(' | ')}`);
  }

  if (t.canonical) {
    const fix = res.diags.find((d) => d.code === 'CM009');
    check(`${t.name} (canonical)`, fix?.canonical === t.canonical,
      `canonical: expected "${t.canonical}" got "${fix?.canonical}"`);
  }
}

for (const t of baselineCases) {
  const same = baselineKey(t.a) === baselineKey(t.b);
  check(`baseline: ${t.name}`, same === t.same, `expected same=${t.same}, got ${same}`);
}

for (const t of parseCases) {
  // cm:guard a THROW here is a failing case, never a dead run — the sibling guard in the
  //   analyzeCases loop went unwritten until a case could throw, and cost 638 checks (ISS-43)
  let r;
  try {
    r = parseAnnotation(t.text, 'p.ts', 1);
  } catch (err) {
    check(t.name, false, `parseAnnotation threw: ${err?.stack ?? err}`);
    continue;
  }
  if (t.result === null) {
    check(t.name, r === null,
      `expected null, got ${JSON.stringify(r)} — parseAnnotation may not claim text that never began cm:`);
  } else if (t.codes) {
    const got = sortedCodes(r?.diags ?? []);
    const want = [...t.codes].sort();
    check(t.name, JSON.stringify(got) === JSON.stringify(want), `codes: expected [${want}] got [${got}]`);
  } else if (t.tag) {
    check(t.name, r?.ann?.tag === t.tag, `tag: expected ${t.tag}, got ${r?.ann?.tag}`);
  } else {
    check(t.name, false, 'the case declares no expectation — result, codes or tag');
  }
}

for (const t of codeShapeCases) {
  const shape = (src) => analyzeFile({ relPath: 'shape.ts', src, reg: DEFAULT_REGISTRY }).codeShape;
  // cm:guard a THROW here is a failing case, never a dead run — see the parseCases loop (ISS-45)
  let same;
  try {
    same = shape(t.a) === shape(t.b);
  } catch (err) {
    check(t.name, false, `analyzeFile threw: ${err?.stack ?? err}`);
    continue;
  }
  check(t.name, same === t.same,
    `expected same=${t.same}, got ${same} — CM013 reads this to tell a code edit from a reflow`);
}

for (const t of graphCases) {
  const g = buildGraph(t.files);
  const reg = { ...DEFAULT_REGISTRY, flows: t.flows ?? [], externals: t.externals ?? [] };
  const diags = [...referentialDiags(g, { root: PLUGIN_ROOT, reg }), ...structuralDiags(g)];

  const got = sortedCodes(diags);
  const want = [...(t.codes ?? [])].sort();
  check(t.name, JSON.stringify(got) === JSON.stringify(want), `codes: expected [${want}] got [${got}]`);

  if (t.order) {
    const flow = [...g.flows.values()][0];
    const got2 = orderFlow(flow).ordered.map((s) => s.step);
    check(`${t.name} (order)`, JSON.stringify(got2) === JSON.stringify(t.order),
      `order: expected [${t.order}] got [${got2}]`);
  }

  if (t.impact) {
    const r = impact(g, t.impact.of);
    const nb = r.flows.flatMap((f) => f.neighbours.map((n) => n.step));
    const ok = r.guards.length === t.impact.guards
      && r.incoming.length === t.impact.incoming
      && r.outgoing.length === t.impact.outgoing
      && JSON.stringify(nb) === JSON.stringify(t.impact.flowNeighbours);
    check(`${t.name} (impact)`, ok,
      `impact: guards=${r.guards.length} incoming=${r.incoming.length} outgoing=${r.outgoing.length} neighbours=[${nb}]`);
  }
}

for (const t of pushCases) {
  // cm:guard a THROW here is a failing case, never a dead run — the first case is above the engine's
  //   argument limit, so a restored spread crashes the process rather than failing by name (ISS-45)
  let got;
  try {
    got = pushAll(t.target, t.items);
  } catch (err) {
    check(t.name, false, `pushAll threw: ${err?.stack ?? err}`);
    continue;
  }
  const ok = got === t.target
    && got.length === t.length
    && got[got.length - 1] === t.last
    && (!t.expect || JSON.stringify(got) === JSON.stringify(t.expect));
  check(t.name, ok, `length=${got.length} last=${got[got.length - 1]} returnedTarget=${got === t.target}`);
}

// cm:guard a suite that THROWS is a failing suite, never a dead run — installCases taking the
//   process down lost every suite after it, with no count line to say so had happened (ISS-45)
for (const suite of [pushSourceCases, gitEnvCases, wiringCases, profileCases, cliCases, installCases, helpCases, metricsCases, releaseTagCases, upgradeWorkflowCases, notifyConsumersCases, mcpCases, prCommentCases, proposeCases, massCases]) {
  try {
    suite(PLUGIN_ROOT, check);
  } catch (err) {
    check(suite.name, false, `the suite threw: ${err?.stack ?? err}`);
  }
}

console.log(`codemap golden corpus: ${pass} passed, ${failures.length} failed`);
for (const f of failures) console.error(`  FAIL ${f}`);
process.exit(failures.length ? 1 : 0);
