#!/usr/bin/env node
// PreToolUse — inject the declared blast radius of the file about to be edited.
//
// This is the whole point of the framework: an invariant written in a prose file 500 lines away
// is not reliably read, but a guard declared at the call site can be handed to the agent at the
// exact moment it matters. Never blocks; it only adds context.

import { readFileSync } from 'node:fs';
import { join, relative, isAbsolute } from 'node:path';
import { findRoot, loadRegistry, DEFAULT_REGISTRY } from './lib/registry.mjs';
import { candidateFiles } from './lib/candidates.mjs';
import { analyzeFile } from './lib/analyze.mjs';
import { buildGraph, impact } from './lib/graph.mjs';

const MAX = 1800;

function readStdin() {
  try { return JSON.parse(readFileSync(0, 'utf8')); } catch { return null; }
}

const input = readStdin();
const target = input?.tool_input?.file_path ?? input?.tool_input?.notebook_path;
if (!input || !target) process.exit(0);

let root;
let reg;
try {
  root = input.cwd ? findRoot(input.cwd) : findRoot();
  reg = loadRegistry(root);
} catch {
  reg = { ...DEFAULT_REGISTRY };
  root = input.cwd ?? process.cwd();
}

const rel = isAbsolute(target) ? relative(root, target) : target;
if (rel.startsWith('..')) process.exit(0);

const perFile = [];
for (const f of candidateFiles(root, reg)) {
  let src;
  try { src = readFileSync(join(root, f), 'utf8'); } catch { continue; }
  const { annotations } = analyzeFile({ relPath: f, src, reg });
  if (annotations.length) perFile.push({ relPath: f, annotations });
}

const g = buildGraph(perFile);
const r = impact(g, rel.split('\\').join('/'));

const parts = [];
for (const a of r.guards) parts.push(`GUARD (${rel}:${a.line}) — ${a.text}`);
for (const a of r.hacks) parts.push(`HACK ${a.issue} (:${a.line}) — workaround stays until ${a.until}`);
for (const e of r.outgoing) parts.push(`EDGE ${e.kind} -> ${e.target}${e.text ? ` — ${e.text}` : ''}`);
for (const e of r.incoming) parts.push(`EDGE ${e.kind} <- declared by ${e.file}:${e.line}${e.text ? ` — ${e.text}` : ''}`);
for (const f of r.flows) {
  const nb = f.neighbours.map((n) => `${n.step}@${n.file}:${n.line}`).join(', ');
  parts.push(`FLOW ${f.name}: this file owns ${f.steps.map((s) => s.step).join(', ')}${nb ? `; adjacent steps ${nb}` : ''}`);
}

if (!parts.length) process.exit(0);

let body = parts.join('\n');
if (body.length > MAX) body = `${body.slice(0, MAX)}\n… (run: cm impact ${rel})`;

const context =
  `codemap: declared couplings for ${rel} that no type-checker or LSP can derive.\n${body}\n` +
  `Honour the guards, and if an edge's other side needs the same change, make it in this task.`;

process.stdout.write(JSON.stringify({
  hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: context },
}));
