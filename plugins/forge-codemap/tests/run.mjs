#!/usr/bin/env node
// Golden-corpus runner. No test framework — the plugin must run on a bare node (§8 rationale).

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { analyzeFile } from '../scripts/lib/analyze.mjs';
import { buildGraph, referentialDiags, structuralDiags, orderFlow, impact } from '../scripts/lib/graph.mjs';
import { DEFAULT_REGISTRY } from '../scripts/lib/registry.mjs';
import { baselineKey } from '../scripts/lib/parse.mjs';
import { analyzeCases, baselineCases, graphCases } from './cases.mjs';

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
  const res = analyzeFile({ relPath: t.file, src: t.src, reg: DEFAULT_REGISTRY });

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

for (const t of graphCases) {
  const g = buildGraph(t.files);
  const reg = { ...DEFAULT_REGISTRY, flows: t.flows ?? [] };
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

console.log(`codemap golden corpus: ${pass} passed, ${failures.length} failed`);
for (const f of failures) console.error(`  FAIL ${f}`);
process.exit(failures.length ? 1 : 0);
