#!/usr/bin/env node
// PreToolUse — inject the declared blast radius of the file about to be edited.
//
// This is the whole point of the framework: an invariant written in a prose file 500 lines away
// is not reliably read, but a guard declared at the call site can be handed to the agent at the
// exact moment it matters. Never blocks; it only adds context.
//
// Like the post-edit hook, it asks the repo's own cm (`cm install`) when there is one, so the couplings
// injected are the ones that repo's CI will hold the agent to.

import { readFileSync } from 'node:fs';
import { relative, isAbsolute } from 'node:path';
import { spawnSync } from 'node:child_process';
import { findRoot } from './lib/registry.mjs';
import { resolveCm } from './lib/locate.mjs';

const MAX = 1800;

function readStdin() {
  try { return JSON.parse(readFileSync(0, 'utf8')); } catch { return null; }
}

const input = readStdin();
const target = input?.tool_input?.file_path ?? input?.tool_input?.notebook_path;
if (!input || !target) process.exit(0);

const root = input.cwd ? findRoot(input.cwd) : findRoot();
const rel = (isAbsolute(target) ? relative(root, target) : target).split('\\').join('/');
if (rel.startsWith('..')) process.exit(0);

// cm:why a Write to a new path has nothing declared ON it yet, but an INCOMING edge can already name it,
// so the query still runs — `cm impact` takes a path, not a file it has to open
const cm = resolveCm(root);
const res = spawnSync(process.execPath, [cm.path, 'impact', rel, '--json'], {
  cwd: root, encoding: 'utf8', timeout: 12_000,
});
if (res.status !== 0 || !res.stdout) process.exit(0);

let r;
try { r = JSON.parse(res.stdout); } catch { process.exit(0); }

const parts = [];
for (const a of r.guards ?? []) parts.push(`GUARD (${rel}:${a.line}) — ${a.text}`);
for (const a of r.hacks ?? []) parts.push(`HACK ${a.issue} (:${a.line}) — workaround stays until ${a.until}`);
for (const e of r.outgoing ?? []) parts.push(`EDGE ${e.kind} -> ${e.target}${e.text ? ` — ${e.text}` : ''}`);
for (const e of r.incoming ?? []) parts.push(`EDGE ${e.kind} <- declared by ${e.file}:${e.line}${e.text ? ` — ${e.text}` : ''}`);
for (const f of r.flows ?? []) {
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
