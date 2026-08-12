#!/usr/bin/env node
// forge-memory-curator validator — lints memory ENTRIES against the storage rule.
// Mechanical + secret checks only (semantic dedupe / recall accuracy stay agent-driven).
//
// Usage:
//   node validate.mjs --json rows.json     # array of {source,sourceRef,textContent,metadata}
//                                           #   (dump from forge_memory_get — the CANONICAL cloud store)
//   node validate.mjs --dir <memory-dir>   # local-cache *.md files (frontmatter: name/description/metadata + body)
// Exit 1 if any ERROR. Prints ERROR/WARN per entry + a summary.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// ---- Rule constants (see SKILL.md "Entry contract") ----
// kebab segments joined by - / or : — namespaced slugs are an accepted convention (forge-test/…, core/…, web:…)
const SLUG_RE = /^[a-z0-9]+(?:[-/:][a-z0-9]+)*$/;
const SLUG_MAX = 96;          // descriptive namespaced slugs run long; over this = WARN not ERROR
const LEAD_MAX = 160;          // first line = search-key summary
const TEXT_MIN = 40;
const TEXT_WARN = 800;         // dense-for-LLM target; beyond = likely prose, tighten
const TEXT_HARD = 4000;        // beyond this → split or promote to docs
const AGENT_SOURCES = new Set(['policy', 'knowledge', 'decision', 'note']);
const ALL_SOURCES = new Set(['issue', 'comment', 'job', 'note', 'knowledge', 'decision', 'policy']);

// Secret signatures → ERROR (a real leak). Pointers ("in testCredentials", "via forge_projects_get") are fine.
const SECRET_ERR = [
  [/postgres(?:ql)?:\/\/[^\s/@]+:[^\s/@]+@/i, 'postgres connection string with inline credentials'],
  [/mysql:\/\/[^\s/@]+:[^\s/@]+@/i, 'mysql connection string with inline credentials'],
  [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, 'private key block'],
  [/\bsk-[A-Za-z0-9]{16,}\b/, 'sk- API key'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'AWS access key id'],
  [/\bghp_[A-Za-z0-9]{30,}\b/, 'GitHub PAT'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, 'Slack token'],
  [/\bey[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/, 'JWT'],
];
// Soft signals → WARN (might be a real secret, or a harmless pointer/word). Human/agent confirms.
const SECRET_WARN = [
  [/\b(?:password|passwd|pwd)\b\s*[:=]\s*\S+/i, 'inline password=… (use a pointer instead?)'],
  [/\b(?:api[_-]?key|secret|bearer|token)\b\s*[:=]\s*[A-Za-z0-9._-]{8,}/i, 'inline key/token value (pointer instead?)'],
];

function lint(entry, label, errs, warns) {
  const e = (m) => errs.push(`  ✗ ${label}: ${m}`);
  const w = (m) => warns.push(`  ⚠ ${label}: ${m}`);
  const { source, sourceRef, textContent, metadata } = entry;

  if (!ALL_SOURCES.has(source)) e(`invalid source '${source}'`);
  else if (!AGENT_SOURCES.has(source)) e(`source '${source}' is auto-indexed — never hand-write`);

  if (!sourceRef) e('missing sourceRef (slug)');
  else {
    if (!SLUG_RE.test(sourceRef)) e(`sourceRef '${sourceRef}' is not kebab (segments [a-z0-9] joined by - / :)`);
    if (sourceRef.length > SLUG_MAX) w(`sourceRef >${SLUG_MAX} chars — consider shortening`);
  }

  const text = (textContent || '').trim();
  if (text.length < TEXT_MIN) e(`textContent too short (<${TEXT_MIN} chars) — trivial/empty?`);
  if (text.length > TEXT_HARD) e(`textContent ${text.length} chars > ${TEXT_HARD} hard cap — split or promote to docs + pointer`);
  else if (text.length > TEXT_WARN) w(`textContent ${text.length} chars > ${TEXT_WARN} — tighten for recall (one topic)`);
  const lead = text.split('\n', 1)[0] || '';
  if (lead.length > LEAD_MAX) w(`first line ${lead.length} chars > ${LEAD_MAX} — keep the lead a tight search-key summary`);

  for (const [re, why] of SECRET_ERR) if (re.test(text)) e(`SECRET LEAK: ${why} — store a pointer, never the value`);
  for (const [re, why] of SECRET_WARN) if (re.test(text)) w(`possible secret: ${why}`);

  const md = metadata || {};
  if (md.type == null) w('metadata.type missing');
  if (md.updatedAt == null) w('metadata.updatedAt missing (use absolute ISO date)');
  else if (!/^\d{4}-\d{2}-\d{2}/.test(String(md.updatedAt))) w(`metadata.updatedAt '${md.updatedAt}' not ISO yyyy-mm-dd`);
}

function parseFrontmatter(md) {
  const m = md.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { source: 'knowledge', sourceRef: null, textContent: md.trim(), metadata: {} };
  const fm = m[1], body = m[2].trim();
  const name = (fm.match(/^name:\s*(.+)$/m) || [])[1]?.trim();
  const type = (fm.match(/type:\s*(.+)$/m) || [])[1]?.trim();
  const srcMap = { feedback: 'policy', user: 'policy', project: 'knowledge', reference: 'knowledge' };
  return { source: srcMap[type] || 'knowledge', sourceRef: name, textContent: body, metadata: { type } };
}

// ---- load ----
const args = process.argv.slice(2);
const jsonIdx = args.indexOf('--json'), dirIdx = args.indexOf('--dir');
let entries = [];
if (jsonIdx >= 0) {
  entries = JSON.parse(readFileSync(args[jsonIdx + 1], 'utf8'));
  if (!Array.isArray(entries)) entries = entries.rows || entries.memories || [];
} else if (dirIdx >= 0) {
  const dir = args[dirIdx + 1];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.md') || f === 'MEMORY.md') continue;
    entries.push(parseFrontmatter(readFileSync(join(dir, f), 'utf8')));
  }
} else {
  console.error('usage: validate.mjs --json rows.json | --dir <memory-dir>');
  process.exit(2);
}

// ---- lint + dup-slug check ----
const errs = [], warns = [];
const seen = new Map();
for (const en of entries) {
  const label = `${en.source}:${en.sourceRef}`;
  const key = `${en.source}|${en.sourceRef}`;
  if (seen.has(key)) errs.push(`  ✗ duplicate (source,sourceRef) key: ${label}`);
  seen.set(key, true);
  lint(en, label, errs, warns);
}

console.log(`forge-memory-curator validate: ${entries.length} entries`);
if (warns.length) { console.log(`\nWARN (${warns.length}):`); console.log(warns.join('\n')); }
if (errs.length) { console.log(`\nERROR (${errs.length}):`); console.log(errs.join('\n')); }
console.log(`\n${errs.length ? '✗ FAIL' : '✓ PASS'} — ${errs.length} error(s), ${warns.length} warning(s)`);
process.exit(errs.length ? 1 : 0);
