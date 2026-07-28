#!/usr/bin/env node
// cm — the codemap/1 CLI. Zero dependencies on purpose (see registry.mjs).

import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import {
  findRoot, loadRegistry, saveRegistry, loadBaseline, saveBaseline,
  selects, walk, changedSince, SPEC_VERSION, DEFAULT_REGISTRY,
} from './lib/registry.mjs';
import { analyzeFile } from './lib/analyze.mjs';
import { buildGraph, referentialDiags, structuralDiags, orderFlow, impact, mermaid } from './lib/graph.mjs';
import { canonical, CODE_TABLE, PROSE_CODES, baselineKey } from './lib/parse.mjs';

const COLOR = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (n, s) => (COLOR ? `[${n}m${s}[0m` : s);
const red = (s) => c('31', s);
const yellow = (s) => c('33', s);
const dim = (s) => c('2', s);
const bold = (s) => c('1', s);

const argv = process.argv.slice(2);
const cmd = argv[0] ?? 'help';

// cm:guard every flag that takes a value MUST be listed here — an unlisted one has its value parsed as a
// path, which silently narrowed `cm verify --since <ref>` to zero files and made the CI gate a no-op
const VALUE_FLAGS = new Set(['--since', '--tier', '--limit', '--description']);

const flags = new Set(argv.filter((a) => a.startsWith('--')).map((a) => a.split('=')[0]));
const positional = [];
for (let i = 1; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) {
    if (VALUE_FLAGS.has(a) && !a.includes('=')) i++;
    continue;
  }
  positional.push(a);
}
const flagValue = (name) => {
  const hit = argv.find((a) => a === name || a.startsWith(`${name}=`));
  if (hit === undefined) return null;
  if (hit.includes('=')) return hit.slice(hit.indexOf('=') + 1);
  return argv[argv.indexOf(name) + 1] ?? null;
};

const root = findRoot();

function loadOrDie() {
  try { return loadRegistry(root); } catch (e) { console.error(red(`codemap: ${e.message}`)); process.exit(2); }
}

function fileList(reg) {
  const since = flagValue('--since');
  let files;
  if (positional.length) {
    const all = walk(root, reg);
    files = [];
    for (const p of positional) {
      const rel = (existsSync(p) && !existsSync(join(root, p)) ? relative(root, resolve(p)) : p)
        .split('\\').join('/').replace(/\/$/, '');
      const abs = join(root, rel);
      if (existsSync(abs) && statSync(abs).isDirectory()) files.push(...all.filter((f) => f.startsWith(`${rel}/`)));
      else if (existsSync(abs)) files.push(rel);
    }
  } else if (since) files = changedSince(root, since);
  else files = walk(root, reg);
  return [...new Set(files)].filter((f) => selects(reg, f));
}

function analyzeAll(reg, files) {
  const perFile = [];
  for (const rel of files) {
    let src;
    try { src = readFileSync(join(root, rel), 'utf8'); } catch { continue; }
    const r = analyzeFile({ relPath: rel, src, reg });
    perFile.push({ relPath: rel, ...r });
  }
  return perFile;
}

function printDiag(d) {
  const sev = d.tier === 'structural' ? yellow('warn') : red('error');
  console.log(`${bold(`${d.file}:${d.line}`)} ${sev} ${d.code} ${d.message}`);
  console.log(`  ${dim(`fix: ${d.fix}  (${CODE_TABLE[d.code]?.section ?? ''})`)}`);
}

switch (cmd) {
  case 'verify': {
    const reg = loadOrDie();
    const files = fileList(reg);
    const perFile = analyzeAll(reg, files);
    const baseline = flags.has('--no-baseline') ? {} : loadBaseline(root);

    let diags = [];
    let debt = 0;
    let cleaned = 0;
    for (const f of perFile) {
      const frozen = baseline[f.relPath] ?? new Set();
      // cm:edge lockstep -> plugins/forge-codemap/scripts/hook-post-edit.mjs — same baseline override, or CI and the hook disagree
      const keep = f.diags.filter(
        (d) => !PROSE_CODES.has(d.code) || d.sited || !frozen.has(baselineKey(d.text ?? d.message)),
      );
      diags.push(...keep);

      const present = new Set(f.proseKeys ?? []);
      for (const k of frozen) (present.has(k) ? debt++ : cleaned++);
    }

    const g = buildGraph(perFile);
    const tier = flagValue('--tier') ?? 'all';
    const wantRef = tier === 'all' || tier === 'referential';
    const wantStruct = tier === 'all' || tier === 'structural';
    if (tier !== 'all' && tier !== 'grammar') diags = diags.filter(() => false);
    if (wantRef) diags.push(...referentialDiags(g, { root, reg }));
    if (wantStruct) diags.push(...structuralDiags(g));

    // cm:why a baselined file that no longer exists (or left the scope) has had its comments deleted too,
    // but only a full scan can tell that apart from "not looked at this run"
    const scoped = Boolean(flagValue('--since') || positional.length);
    if (!scoped) {
      const seen = new Set(perFile.map((f) => f.relPath));
      for (const [rel, frozen] of Object.entries(baseline)) {
        if (rel.startsWith('__') || seen.has(rel)) continue;
        cleaned += frozen.size ?? frozen.length ?? 0;
      }
    }

    if (flags.has('--json')) {
      // cm:why process.exit() truncates a piped stdout that has not drained, so only the code is set
      process.exitCode = diags.some((d) => d.tier !== 'structural') ? 1 : 0;
      console.log(JSON.stringify({
        specVersion: SPEC_VERSION, files: files.length, diags,
        legacy: { debt, cleaned, scoped },
      }, null, 2));
      break;
    }

    diags.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
    for (const d of diags) printDiag(d);

    const errors = diags.filter((d) => d.tier !== 'structural').length;
    const warns = diags.length - errors;
    const skipped = perFile.filter((f) => f.skipped).length;
    console.log('');
    console.log(`${bold('codemap')} ${SPEC_VERSION} · ${files.length} files (${skipped} skipped) · ` +
      `${g.flows.size} flows · ${g.edges.length} edges · ${g.guards.length} guards · ${g.hacks.length} hacks`);
    console.log(`${errors ? red(`${errors} errors`) : 'no errors'}, ${warns} warnings`);
    if (debt || cleaned) {
      const share = debt + cleaned ? Math.round((cleaned / (debt + cleaned)) * 100) : 0;
      console.log(`legacy prose: ${bold(String(debt))} distinct still frozen · ${cleaned} cleaned (${share}%)` +
        `${scoped ? dim(' — scoped run, whole-tree figures need a bare `cm verify`') : ''}`);
      if (debt) console.log(dim('frozen comments are debt, not absolution — list them with: cm sweep <path>'));
    }
    if (baseline.__legacyFormat) console.log(yellow('baseline is in the pre-0.2 count format and was ignored — run: cm baseline'));
    if (reg._missing) console.log(dim('no .forge/codemap.json — grammar tier ran with defaults; flow names unvalidated (§8). Run: cm init'));
    process.exitCode = errors ? 1 : 0;
    break;
  }

  case 'fmt': {
    const reg = loadOrDie();
    const files = fileList(reg);
    const perFile = analyzeAll(reg, files);
    let changed = 0;
    for (const f of perFile) {
      const fixes = f.diags.filter((d) => d.code === 'CM009' && d.canonical);
      if (!fixes.length) continue;
      const abs = join(root, f.relPath);
      const lines = readFileSync(abs, 'utf8').split('\n');
      for (const fix of fixes) {
        const i = fix.line - 1;
        lines[i] = lines[i].replace(/(^|\s)(\/\/|#|--)\s*cm:.*$/, (_m, pre, leader) => `${pre}${leader} ${fix.canonical}`);
      }
      writeFileSync(abs, lines.join('\n'));
      changed += fixes.length;
      if (!flags.has('--quiet')) console.log(`${f.relPath} ${dim(`${fixes.length} normalized`)}`);
    }
    if (!flags.has('--quiet')) console.log(`codemap fmt: ${changed} annotation(s) normalized`);
    break;
  }

  case 'impact': {
    const target = positional[0];
    if (!target) { console.error('usage: cm impact <path>'); process.exit(2); }
    const reg = loadOrDie();
    const perFile = analyzeAll(reg, walk(root, reg).filter((f) => selects(reg, f)));
    const g = buildGraph(perFile);
    const rel = target.replace(`${root}/`, '');
    const r = impact(g, rel);
    if (flags.has('--json')) { console.log(JSON.stringify(r, null, 2)); break; }
    const empty = !r.guards.length && !r.outgoing.length && !r.incoming.length && !r.flows.length && !r.hacks.length;
    if (empty) { console.log(`${rel}: no declared couplings. LSP references are still your job (§1).`); break; }
    console.log(bold(`impact of ${rel}`));
    for (const a of r.guards) console.log(`  ${red('guard')}   ${a.text}  ${dim(`(:${a.line})`)}`);
    for (const a of r.hacks) console.log(`  ${yellow('hack')}    ${a.issue} until:${a.until} — ${a.text}  ${dim(`(:${a.line})`)}`);
    for (const e of r.outgoing) console.log(`  edge →   ${e.kind} ${e.target}${e.text ? ` — ${e.text}` : ''}  ${dim(`(:${e.line})`)}`);
    for (const e of r.incoming) console.log(`  edge ←   ${e.kind} from ${e.file}:${e.line}${e.text ? ` — ${e.text}` : ''}`);
    for (const f of r.flows) {
      console.log(`  flow     ${f.name}: ${f.steps.map((s) => s.step).join(', ')}`);
      for (const n of f.neighbours) console.log(`             ${dim(`↔ ${n.step} @ ${n.file}:${n.line}`)}`);
    }
    break;
  }

  case 'flow': {
    const name = positional[0];
    const reg = loadOrDie();
    const perFile = analyzeAll(reg, walk(root, reg).filter((f) => selects(reg, f)));
    const g = buildGraph(perFile);
    if (!name) {
      for (const [n, f] of g.flows) console.log(`${n}  ${dim(`${f.steps.length} steps`)}`);
      break;
    }
    const flow = g.flows.get(name);
    if (!flow) { console.error(`no flow "${name}". Known: ${[...g.flows.keys()].join(', ') || '(none)'}`); process.exit(1); }
    if (flags.has('--mermaid')) { console.log(mermaid(flow)); break; }
    console.log(bold(name));
    for (const s of orderFlow(flow).ordered) {
      const pad = '  '.repeat(s.depth + 1);
      console.log(`${pad}${s.step}${s.detached ? red(' (detached)') : ''}  ${dim(`${s.file}:${s.line}`)}`);
      if (s.text) console.log(`${pad}  ${dim(s.text)}`);
    }
    break;
  }

  case 'ls': {
    const reg = loadOrDie();
    const perFile = analyzeAll(reg, walk(root, reg).filter((f) => selects(reg, f)));
    const g = buildGraph(perFile);
    console.log(bold('flows'));
    for (const [n, f] of g.flows) console.log(`  ${n}  ${dim(`${f.steps.length} steps`)}`);
    console.log(bold('edges'));
    for (const e of g.edges) console.log(`  ${e.kind.padEnd(10)} ${e.file}:${e.line} -> ${e.target}`);
    console.log(bold('guards'));
    for (const a of g.guards) console.log(`  ${a.file}:${a.line}  ${a.text}`);
    console.log(bold('hacks'));
    for (const a of g.hacks) console.log(`  ${a.issue}  ${a.file}:${a.line}  until:${a.until}`);
    break;
  }

  // cm:why the baseline hides legacy prose so CI can be green on day one; without a verb that lists what
  // it hid, "frozen" reads as "resolved" and the debt is invisible forever (§8)
  case 'sweep': {
    const reg = loadOrDie();
    if (reg._missing) {
      console.error(red(`codemap: no .forge/codemap.json at ${root} — nothing is frozen, so nothing to sweep.`));
      process.exit(2);
    }
    const files = fileList(reg);
    const perFile = analyzeAll(reg, files);
    const baseline = loadBaseline(root);
    const scoped = Boolean(flagValue('--since') || positional.length);

    const rows = [];
    const pruned = {};
    let stale = 0;
    for (const f of perFile) {
      const frozen = baseline[f.relPath];
      if (!frozen) continue;
      for (const d of f.diags) {
        if (!PROSE_CODES.has(d.code) || d.sited) continue;
        if (frozen.has(baselineKey(d.text ?? d.message))) {
          rows.push({ file: f.relPath, line: d.line, code: d.code, text: d.text ?? d.message });
        }
      }
      const present = new Set(f.proseKeys ?? []);
      const keep = [...frozen].filter((k) => present.has(k));
      stale += frozen.size - keep.length;
      if (keep.length) pruned[f.relPath] = keep;
    }

    if (flags.has('--prune-baseline')) {
      // cm:guard prune must never run scoped — an unscanned file would be dropped from the baseline entirely,
      // silently absolving every comment in it. cm baseline is the deliberate re-freeze; this is not.
      if (scoped) {
        console.error(red('codemap: --prune-baseline needs a whole-tree run — drop the paths and --since.'));
        process.exit(2);
      }
      saveBaseline(root, pruned);
      console.log(`codemap sweep: dropped ${stale} stale key(s); ${Object.values(pruned).reduce((a, b) => a + b.length, 0)} remain frozen`);
      console.log(dim('bookkeeping only — no source file was touched, and no new comment was absolved'));
      break;
    }

    if (flags.has('--json')) {
      console.log(JSON.stringify({ frozen: rows.length, stale, scoped, comments: rows }, null, 2));
      break;
    }

    const limit = Number(flagValue('--limit') ?? 40);
    rows.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
    for (const r of rows.slice(0, limit)) {
      console.log(`${bold(`${r.file}:${r.line}`)} ${dim(r.code)} ${r.text.length > 88 ? `${r.text.slice(0, 85)}...` : r.text}`);
    }
    if (rows.length > limit) console.log(dim(`… and ${rows.length - limit} more (--limit ${rows.length} to see all)`));
    console.log('');
    // cm:why the baseline is keyed per FILE by text, so the comparable unit is file+key, not key: deduping
    // globally here made this disagree with the debt `cm verify` prints from the same baseline
    const distinct = new Set(rows.map((r) => `${r.file} ${baselineKey(r.text)}`)).size;
    console.log(`${bold('codemap sweep')} · ${rows.length} frozen prose comment(s), ${distinct} distinct, ` +
      `across ${new Set(rows.map((r) => r.file)).size} file(s)${scoped ? dim(' — scoped run') : ''}`);
    if (stale) console.log(dim(`${stale} baseline key(s) no longer match any comment — drop them with: cm sweep --prune-baseline`));
    console.log(dim('deleting these is a reviewable change of its own (principle 7) — cm never edits them for you'));
    break;
  }

  case 'baseline': {
    const reg = loadOrDie();
    // cm:why a baseline without a registry is meaningless and silently pollutes whatever root cwd resolved to
    if (reg._missing) {
      console.error(red(`codemap: no .forge/codemap.json at ${root} — run "cm init" there first.`));
      process.exit(2);
    }
    const perFile = analyzeAll(reg, walk(root, reg).filter((f) => selects(reg, f)));
    const keys = {};
    for (const f of perFile) if (f.proseKeys?.length) keys[f.relPath] = f.proseKeys;
    saveBaseline(root, keys);
    const total = Object.values(keys).reduce((a, b) => a + b.length, 0);
    console.log(`codemap baseline: froze ${total} pre-existing prose comments across ${Object.keys(keys).length} files`);
    console.log(dim('legacy is frozen by CONTENT (§8 / principle 7) — only a comment whose text is new is flagged'));
    break;
  }

  case 'init': {
    const reg = existsSync(join(root, '.forge', 'codemap.json')) ? loadOrDie() : { ...DEFAULT_REGISTRY };
    saveRegistry(root, reg);
    const perFile = analyzeAll(reg, walk(root, reg).filter((f) => selects(reg, f)));
    const keys = {};
    for (const f of perFile) if (f.proseKeys?.length) keys[f.relPath] = f.proseKeys;
    saveBaseline(root, keys);
    const total = Object.values(keys).reduce((a, b) => a + b.length, 0);
    console.log(`codemap ${SPEC_VERSION} initialised at ${root}`);
    console.log(`  .forge/codemap.json`);
    console.log(`  .forge/codemap-baseline.json  ${dim(`${total} legacy comments frozen by content`)}`);
    break;
  }

  case 'new': {
    if (positional[0] !== 'flow' || !positional[1]) { console.error('usage: cm new flow <name> [--description "..."]'); process.exit(2); }
    const name = positional[1];
    const reg = loadOrDie();
    if (reg._missing) { console.error('no .forge/codemap.json — run: cm init'); process.exit(2); }
    if (reg.flows.some((f) => f.name === name)) { console.error(`flow "${name}" already declared`); process.exit(1); }
    reg.flows.push({ name, description: flagValue('--description') ?? '' });
    reg.flows.sort((a, b) => a.name.localeCompare(b.name));
    saveRegistry(root, reg);
    console.log(`declared flow "${name}". Annotate the first step:\n`);
    console.log(`  // cm:flow ${name}/<step> — <what this step does>`);
    console.log(`  // cm:flow ${name}/<next> after:<step> — <...>`);
    break;
  }

  case 'codes': {
    for (const [code, v] of Object.entries(CODE_TABLE)) {
      console.log(`${code}  ${v.tier.padEnd(11)} ${v.section.padEnd(5)} ${v.message}`);
    }
    break;
  }

  case 'migrate':
    console.error(`codemap implements only ${SPEC_VERSION}; there is nothing to migrate yet (§9).`);
    process.exit(2);
    break;

  default:
    console.log(`cm — codemap/${SPEC_VERSION.split('/')[1]}

  cm init                       write .forge/codemap.json + freeze legacy comments
  cm verify [--since <ref>]     grammar + referential + structural tiers  [--tier T] [--json]
  cm fmt [paths...]             normalize annotations to canonical form
  cm impact <path>              declared blast radius of a file  [--json]
  cm flow [name]                ordered trace of a flow  [--mermaid]
  cm ls                         every annotation in the repo
  cm sweep [paths...]           list the prose the baseline is hiding  [--limit N] [--json]
                                  [--prune-baseline] drop keys that match nothing (no source edits)
  cm baseline                   re-freeze legacy prose by content
  cm new flow <name>            declare a flow in the registry
  cm codes                      diagnostic reference

spec: SPEC.md next to this script`);
}
