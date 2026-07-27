#!/usr/bin/env node
// PostToolUse — normalize annotations, then hold the grammar tier (codemap/1 §7).
//
// Normalizing here rather than asking the model to retype it is principle 6: the tool owns the
// format, so model-to-model variation can never break the parser.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative, isAbsolute } from 'node:path';
import { findRoot, loadRegistry, loadBaseline, selects, DEFAULT_REGISTRY } from './lib/registry.mjs';
import { analyzeFile } from './lib/analyze.mjs';
import { PROSE_CODES, baselineKey } from './lib/parse.mjs';

function readStdin() {
  try { return JSON.parse(readFileSync(0, 'utf8')); } catch { return null; }
}

const input = readStdin();
const target = input?.tool_input?.file_path;
if (!input || !target) process.exit(0);

let root;
let reg;
try {
  root = input.cwd ? findRoot(input.cwd) : findRoot();
  reg = loadRegistry(root);
} catch {
  root = input.cwd ?? process.cwd();
  reg = { ...DEFAULT_REGISTRY };
}

const rel = (isAbsolute(target) ? relative(root, target) : target).split('\\').join('/');
if (rel.startsWith('..') || !selects(reg, rel)) process.exit(0);

const abs = join(root, rel);
if (!existsSync(abs)) process.exit(0);

let src = readFileSync(abs, 'utf8');
let res = analyzeFile({ relPath: rel, src, reg });
if (res.skipped) process.exit(0);

const fixes = res.diags.filter((d) => d.code === 'CM009' && d.canonical);
if (fixes.length) {
  const lines = src.split('\n');
  for (const f of fixes) {
    const i = f.line - 1;
    lines[i] = lines[i].replace(/(^|\s)(\/\/|#|--)\s*cm:.*$/, (_m, pre, leader) => `${pre}${leader} ${f.canonical}`);
  }
  src = lines.join('\n');
  writeFileSync(abs, src);
  res = analyzeFile({ relPath: rel, src, reg });
}

// cm:why prose enforcement is opt-in per repo (cm init), so an un-onboarded legacy tree is never blocked
const onboarded = !reg._missing;
const frozen = loadBaseline(root)[rel] ?? new Set();
const prose = res.diags.filter(
  (d) => PROSE_CODES.has(d.code) && !frozen.has(baselineKey(d.text ?? d.message)),
);
const others = res.diags.filter((d) => !PROSE_CODES.has(d.code) && d.code !== 'CM009');
const blocking = [...others, ...(onboarded ? prose : [])];

if (!blocking.length) process.exit(0);

const lines = blocking.slice(0, 12).map((d) => `${rel}:${d.line} ${d.code} ${d.message}\n    fix: ${d.fix}`);
const extra = blocking.length > 12 ? `\n… and ${blocking.length - 12} more` : '';
const baselineNote = frozen.size
  ? `\n${frozen.size} pre-existing comment(s) in this file are frozen by the baseline and are not your problem — only the ones listed above are.`
  : '';

process.stdout.write(JSON.stringify({
  decision: 'block',
  reason:
    `codemap/1 violations in ${rel} — fix them before continuing.\n${lines.join('\n')}${extra}${baselineNote}\n` +
    `Rule: a comment is valid only if it says something the compiler, the types, the path or the LSP cannot derive. ` +
    `Otherwise delete it. Non-derivable facts belong in cm:guard / cm:edge / cm:flow / cm:why (see SPEC.md §3).`,
}));
