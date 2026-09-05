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
import { relative, isAbsolute, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { findRoot } from '../lib/registry.mjs';
import { resolveCm } from '../lib/locate.mjs';

const MAX = 1800;

function readStdin() {
  try { return JSON.parse(readFileSync(0, 'utf8')); } catch { return null; }
}

/** Line the edit targets, from the text it replaces — the only locality signal a PreToolUse hook has. */
function anchorLine(inp, relPath, rootDir) {
  const needle = inp?.tool_input?.old_string ?? inp?.tool_input?.edits?.[0]?.old_string;
  if (!needle) return null;
  try {
    const src = readFileSync(join(rootDir, relPath), 'utf8');
    const at = src.indexOf(String(needle).split('\n')[0]);
    return at < 0 ? null : src.slice(0, at).split('\n').length;
  } catch { return null; }
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

// cm:why the edit's own text gives the line being worked on, so the annotations NEAREST it go first — a
//   positional slice kept whichever sorted first, which has nothing to do with what is being edited
const anchor = anchorLine(input, rel, root);
const near = (line) => (anchor && line ? Math.abs(line - anchor) : Number.MAX_SAFE_INTEGER);

const parts = [];
for (const a of r.guards ?? []) parts.push({ d: near(a.line), t: `GUARD (${rel}:${a.line}) — ${a.text}` });
for (const a of r.hacks ?? []) parts.push({ d: near(a.line), t: `HACK ${a.issue} (:${a.line}) — workaround stays until ${a.until}` });
// cm:why external is verified against the registry's name, never against a file — an agent reading
//   this line plainly must not have to notice the target's own external: prefix to know that
for (const e of r.outgoing ?? []) parts.push({ d: near(e.line), t: `EDGE ${e.kind} -> ${e.target}${e.text ? ` — ${e.text}` : ''}${e.external ? ' [external: name verified, path not]' : ''}` });
for (const e of r.incoming ?? []) parts.push({ d: Number.MAX_SAFE_INTEGER - 1, t: `EDGE ${e.kind} <- declared by ${e.file}:${e.line}${e.text ? ` — ${e.text}` : ''}` });
// cm:guard whys are injected too — impact() has carried them since 0.10.0 and this hook did not read them,
//   so the most numerous annotation kind in both measured repos reached nobody (ISS-C)
for (const a of r.whys ?? []) parts.push({ d: near(a.line), t: `WHY (${rel}:${a.line}) — ${a.text}` });
for (const f of r.flows ?? []) {
  const nb = f.neighbours.map((n) => `${n.step}@${n.file}:${n.line}`).join(', ');
  parts.push({ d: near(f.steps[0]?.line), t: `FLOW ${f.name}: this file owns ${f.steps.map((s) => s.step).join(', ')}${nb ? `; adjacent steps ${nb}` : ''}` });
}

if (!parts.length) process.exit(0);

parts.sort((a, b) => a.d - b.d);
const kept = [];
let used = 0;
for (const p of parts) {
  if (used + p.t.length > MAX) break;
  kept.push(p.t);
  used += p.t.length + 1;
}
// cm:guard say WHAT was dropped, never a bare ellipsis — a slice that silently ends mid-list reads as
//   "that is all there is", which is the failure this whole channel exists to avoid
const dropped = parts.length - kept.length;
let body = kept.join('\n');
if (dropped) {
  const kinds = [...new Set(parts.slice(kept.length).map((p) => p.t.split(' ')[0]))].join(', ');
  body += `\n… ${dropped} further declaration(s) not shown (${kinds}) — run: cm impact ${rel}`;
}

const context =
  `codemap: declared couplings for ${rel} that no type-checker or LSP can derive.\n${body}\n` +
  `Honour the guards, and if an edge's other side needs the same change, make it in this task.`;

process.stdout.write(JSON.stringify({
  hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: context },
}));
