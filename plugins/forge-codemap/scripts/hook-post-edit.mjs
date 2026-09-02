#!/usr/bin/env node
// PostToolUse — normalize annotations, then hold the grammar tier (codemap/1 §7).
//
// Normalizing here rather than asking the model to retype it is principle 6: the tool owns the
// format, so model-to-model variation can never break the parser.
//
// This hook decides nothing about WHAT is a violation: it drives `cm verify --fix --json` and reads
// the verdict. Earlier it re-implemented the baseline override, which meant the rule that legacy prose
// is spared unless an annotation sits in its block lived in two places at once, held together by a
// lockstep edge. One copy is not a coupling. It also runs the repo's OWN cm when one is installed
// (`cm install`), so the plugin can never enforce something the project's CI does not.
//
// What blocks, and what only gets said out loud:
//   - grammar violations block, always (CM009 excepted — it was just fixed in place)
//   - prose blocks only in an onboarded repo (§8), so a legacy tree is never held to it
//   - prose does NOT block while the baseline is unreadable: nothing can then tell new prose from
//     legacy, and blocking an author for a comment they did not write is the wrong half of the trade
//   - a checker that cannot run at all blocks nothing, and says so rather than reading as clean

import { readFileSync, existsSync } from 'node:fs';
import { join, relative, isAbsolute } from 'node:path';
import { spawnSync } from 'node:child_process';
import { findRoot } from './lib/registry.mjs';
import { resolveCm } from './lib/locate.mjs';
import { blockingDiags } from './lib/blocking.mjs';
import { reconcile } from './lib/metrics.mjs';

const MAX_LISTED = 12;

function readStdin() {
  try { return JSON.parse(readFileSync(0, 'utf8')); } catch { return null; }
}

const input = readStdin();
const target = input?.tool_input?.file_path;
if (!input || !target) process.exit(0);

const root = input.cwd ? findRoot(input.cwd) : findRoot();
const rel = (isAbsolute(target) ? relative(root, target) : target).split('\\').join('/');
// cm:why a path cm cannot see is not a violation — and `cm verify <missing path>` is exit 2 by design
if (rel.startsWith('..') || !existsSync(join(root, rel))) process.exit(0);

// cm:guard --changed-lines is what makes the "frozen and not your problem" line below TRUE — a whole-file
//   run blocked an edit on 44 legacy comments it never touched, with a repo-wide re-freeze as the only way out
const cm = resolveCm(root);
const res = spawnSync(process.execPath, [cm.path, 'verify', '--fix', '--json', '--changed-lines', rel], {
  cwd: root, encoding: 'utf8', timeout: 12_000,
});

// cm:guard a checker that cannot run must never look like a clean file — but it must not block the edit
// either, or a broken install wedges every session. Exit 2 is cm's "the gate could not run" (see cm.mjs).
if (res.status === 2 || res.status === null || !res.stdout) {
  const why = (res.stderr || res.error?.message || `cm exited ${res.status}`).trim().split('\n')[0];
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: `codemap could not check ${rel}: ${why}\nComment rules are unverified for this edit.`,
    },
  }));
  process.exit(0);
}

let report;
try { report = JSON.parse(res.stdout); } catch { process.exit(0); }

const diags = report.diags ?? [];

// cm:edge lockstep -> plugins/forge-codemap/scripts/lib/blocking.mjs — metrics.mjs reconciles against
//   this same predicate, so a block it records is one the hook itself actually enforced
const blocking = blockingDiags(report);
const nonBlocking = diags.filter((d) => d.tier !== 'grammar');
reconcile(root, rel, blocking.map((d) => ({ code: d.code, line: d.line })));

const notes = [];
if (report.baselineUnreadable) {
  notes.push('This repo\'s .forge/codemap-baseline.json is in the pre-0.2 count format, so legacy prose cannot be told from new prose — comment rules are NOT being enforced here. Run `cm baseline` to re-freeze by content.');
}
if (nonBlocking.length) {
  notes.push(`${nonBlocking.length} non-grammar diagnostic(s) here are for CI, not for this edit: `
    + `${[...new Set(nonBlocking.map((d) => d.code))].join(', ')}.`);
}
if (report.normalized?.length) {
  notes.push(`${report.normalized.length} annotation(s) were normalized for you (cm owns the format).`);
}

if (!blocking.length) {
  if (!notes.length) process.exit(0);
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: `codemap: ${notes.join('\n')}` },
  }));
  process.exit(0);
}

const lines = blocking.slice(0, MAX_LISTED).map((d) => `${d.file}:${d.line} ${d.code} ${d.message}\n    fix: ${d.fix}`);
const extra = blocking.length > MAX_LISTED ? `\n… and ${blocking.length - MAX_LISTED} more` : '';
const debt = report.legacy?.debt
  ? `\n${report.legacy.debt} pre-existing comment(s) here are frozen by the baseline and are not your problem — only the ones listed above are.`
  : '';
const untouched = report.outsideDiff
  ? `\n${report.outsideDiff} further violation(s) sit on lines this edit did not touch and are not being held against you.`
  : '';

// cm:why the pointer goes in the block reason because that is the moment the rules are actually needed,
// and `cm help` works from inside a repo that never installed this plugin (lib/help.mjs)
const guide = cm.source === 'project' ? '.forge/codemap/cm' : 'cm';

process.stdout.write(JSON.stringify({
  decision: 'block',
  reason:
    `codemap/1 violations in ${rel} — fix them before continuing.\n${lines.join('\n')}${extra}${debt}${untouched}\n` +
    `${notes.join('\n')}${notes.length ? '\n' : ''}` +
    `Rule: a comment is valid only if it says something the compiler, the types, the path or the LSP cannot derive. ` +
    `Otherwise delete it. Non-derivable facts belong in cm:guard / cm:edge / cm:flow / cm:why.\n` +
    `Unsure how to resolve one of these? Run: ${guide} help workflow  (also: help annotations, help codes, help spec)`,
}));
