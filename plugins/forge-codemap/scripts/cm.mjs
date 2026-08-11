#!/usr/bin/env node
// cm — the codemap/1 CLI. Zero dependencies on purpose (see registry.mjs).
//
// A positional path resolves against the CWD first, which is what a shell user means, and falls back to
// root-relative only when that finds nothing. Preferring root the other way round made `.` inside a
// subdirectory scope to the whole repo, and a literal "." matched no walked path at all — a clean 0-file
// report. Every fail-open bug this CLI has shipped is that shape: a scope nobody could compute, reported
// as a scope with nothing wrong in it. Hence exit 2 (§9.1) for anything that cannot be resolved.

import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, relative, resolve, dirname, normalize } from 'node:path';
import {
  findRoot, loadRegistry, saveRegistry, loadBaseline, saveBaseline,
  selects, walk, changedSince, changedStaged, toolVersion, SPEC_VERSION, DEFAULT_REGISTRY,
} from './lib/registry.mjs';
import { analyzeFile } from './lib/analyze.mjs';
import { buildGraph, referentialDiags, structuralDiags, orderFlow, impact, mermaid, annText } from './lib/graph.mjs';
import { canonical, CODE_TABLE, PROSE_CODES, baselineKey } from './lib/parse.mjs';
import { applyFmt } from './lib/rewrite.mjs';
import { candidateFiles } from './lib/candidates.mjs';
import { install } from './lib/install.mjs';
import { renderHelp, VERBS } from './lib/help.mjs';

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
const TIERS = new Set(['all', 'grammar', 'referential', 'structural']);

// cm:guard exit 2 is "the gate could not run", exit 1 is "the gate ran and failed" — CI must be able to
// tell a missing ref or a mistyped flag from a real violation, or a broken invocation reads as a lint error
function die(msg, hint) {
  console.error(red(`codemap: ${msg}`));
  if (hint) console.error(dim(`  ${hint}`));
  process.exit(2);
}

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
  // cm:why `cm verify --since --json` used to take "--json" as the ref and die in git with a stack trace
  const next = argv[argv.indexOf(name) + 1];
  if (next === undefined || next.startsWith('--')) die(`${name} needs a value`);
  return next;
};

const numericFlag = (name, fallback) => {
  const raw = flagValue(name);
  if (raw === null) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) die(`${name} needs a number, got "${raw}"`);
  return n;
};

const root = findRoot();

function loadOrDie() {
  try { return loadRegistry(root); } catch (e) { die(e.message); }
}

/** Positional paths, resolved against the repo root. A path that resolves to nothing is fatal (exit 2). */
function scopeFromPositional(reg) {
  const files = [];
  const unresolved = [];
  let all = null;
  for (const p of positional) {
    // cm:guard resolve against the CWD first — root-relative is only the fallback (see the header)
    const fromCwd = resolve(p);
    const rel = (existsSync(fromCwd) ? relative(root, fromCwd) : p)
      .split('\\').join('/').replace(/\/+$/, '').replace(/^\.\//, '').replace(/^\.$/, '');
    if (rel.startsWith('..')) {
      die(`${p} is outside the repo root ${root}`, 'cm only reasons about paths inside the tree it onboarded');
    }
    const abs = rel === '' ? root : join(root, rel);
    if (!existsSync(abs)) { unresolved.push(p); continue; }
    if (statSync(abs).isDirectory()) {
      // cm:why walk() is only needed to expand a directory — doing it for a single file made the
      // PostToolUse hook walk an entire monorepo on every edit
      all ??= walk(root, reg);
      files.push(...all.filter((f) => rel === '' || f.startsWith(`${rel}/`)));
    } else files.push(rel);
  }
  if (unresolved.length) {
    die(`no such path: ${unresolved.join(', ')}`,
      'a path that matches nothing used to scan 0 files and exit 0 — a typo cannot be a green gate');
  }
  return files;
}

function fileList(reg) {
  const since = flagValue('--since');
  if (since && flags.has('--staged')) die('--since and --staged are mutually exclusive');
  let files;
  try {
    if (positional.length) files = scopeFromPositional(reg);
    else if (flags.has('--staged')) files = changedStaged(root);
    else if (since) files = changedSince(root, since);
    else files = walk(root, reg);
  } catch (e) {
    die(e.message, 'in a shallow CI clone the ref often is not fetched — try: git fetch --deepen 50');
  }
  return [...new Set(files)].filter((f) => selects(reg, f));
}

/** Every selected file — the scope for anything that reasons about prose (verify, baseline, init). */
function allFiles(reg) {
  return walk(root, reg).filter((f) => selects(reg, f));
}

/**
 * The shortlist that carries annotations, via `git grep`. Enough for impact/flow/ls, which read the
 * graph and never prose — and it is what keeps `cm impact` fast enough to run from a PreToolUse hook
 * on a monorepo.
 */
function annotatedFiles(reg) {
  return candidateFiles(root, reg);
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

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Normalize every CM009 in `perFile`, in place on disk. Shared by `cm fmt` and `cm verify --fix` so
 * the hook and CI cannot normalize differently.
 *
 * @returns {Array<{file: string, line: number}>} only what was really rewritten — a fix that did not
 *   apply is reported, never counted. Claiming a rewrite that did not happen left CM009 permanently
 *   unfixable behind a "fix: run cm fmt" hint (see lib/rewrite.mjs).
 */
function fixCanonical(perFile) {
  const done = [];
  for (const f of perFile) {
    const fixes = f.diags.filter((d) => d.code === 'CM009' && d.canonical);
    if (!fixes.length) continue;
    const abs = join(root, f.relPath);
    const before = readFileSync(abs, 'utf8');
    const { src, applied, failed } = applyFmt(before, fixes);
    if (applied.length) writeFileSync(abs, src);
    done.push(...applied.map((d) => ({ file: f.relPath, line: d.line })));
    for (const d of failed) {
      console.error(yellow(`${f.relPath}:${d.line} CM009 could not be normalized automatically`));
      console.error(dim(`  rewrite by hand to: ${d.leader ?? '//'} ${d.canonical}`));
    }
  }
  return done;
}

// cm:guard cm fmt owns this and `verify --fix` must NOT: the post-edit hook runs --fix, and a target is
//   CONTENT, so it is only ever rewritten to a path that resolves — never guessed at (ISS-5)
function migrateTargets(perFile) {
  const done = [];
  for (const f of perFile) {
    const fixes = [];
    for (const d of f.diags) {
      if (!d.relative || d.col === undefined) continue;
      // cm:guard split the #symbol off BEFORE resolving — 110 of 186 edges in the field carry an anchor,
      //   and resolving it as part of the path made every one of them fail existsSync and stay unmigrated
      const [rel, anchor] = d.relative.target.split('#');
      const resolved = normalize(join(dirname(f.relPath), rel)).split('\\').join('/');
      if (resolved.startsWith('..') || !existsSync(join(root, resolved))) continue;
      fixes.push({
        line: d.line, col: d.col, leader: d.leader,
        canonical: canonical({
          tag: 'edge', kind: d.relative.kind, text: d.relative.text,
          target: anchor ? `${resolved}#${anchor}` : resolved,
        }),
      });
    }
    if (!fixes.length) continue;
    const abs = join(root, f.relPath);
    const { src, applied } = applyFmt(readFileSync(abs, 'utf8'), fixes);
    if (applied.length) writeFileSync(abs, src);
    done.push(...applied.map((d) => ({ file: f.relPath, line: d.line })));
  }
  return done;
}

function printDiag(d) {
  const sev = d.tier === 'structural' ? yellow('warn') : red('error');
  console.log(`${bold(`${d.file}:${d.line}`)} ${sev} ${d.code} ${d.message}`);
  console.log(`  ${dim(`fix: ${d.fix}  (${CODE_TABLE[d.code]?.section ?? ''})`)}`);
}

switch (cmd) {
  case 'verify': {
    const reg = loadOrDie();
    const tier = flagValue('--tier') ?? 'all';
    // cm:guard an unknown --tier used to wipe every diagnostic and exit 0 — `--tier=grammer` was a green
    // CI gate over a broken tree, which is the same fail-open shape as an unlisted VALUE_FLAG above
    if (!TIERS.has(tier)) die(`unknown --tier "${tier}"`, `one of: ${[...TIERS].join(', ')}`);

    const files = fileList(reg);
    let perFile = analyzeAll(reg, files);
    const normalized = flags.has('--fix') ? fixCanonical(perFile) : [];
    if (normalized.length) perFile = analyzeAll(reg, files);
    const baseline = flags.has('--no-baseline') ? {} : loadBaseline(root);

    let diags = [];
    let debt = 0;
    let cleaned = 0;
    for (const f of perFile) {
      const frozen = baseline[f.relPath] ?? new Set();
      const keep = f.diags.filter(
        (d) => !PROSE_CODES.has(d.code) || d.sited || !frozen.has(baselineKey(d.text ?? d.message)),
      );
      diags.push(...keep);

      const present = new Set(f.proseKeys ?? []);
      for (const k of frozen) (present.has(k) ? debt++ : cleaned++);
    }

    const g = buildGraph(perFile);
    if (tier !== 'all' && tier !== 'grammar') diags = [];
    if (tier === 'all' || tier === 'referential') diags.push(...referentialDiags(g, { root, reg }));
    if (tier === 'all' || tier === 'structural') diags.push(...structuralDiags(g));

    // cm:why a baselined file that no longer exists (or left the scope) has had its comments deleted too,
    // but only a full scan can tell that apart from "not looked at this run"
    const scoped = Boolean(flagValue('--since') || flags.has('--staged') || positional.length);
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
        specVersion: SPEC_VERSION, toolVersion: toolVersion(), files: files.length, diags,
        // cm:edge contract -> plugins/forge-codemap/scripts/hook-post-edit.mjs — the hook decides what blocks
        // from these three: prose is enforced only when onboarded, and never while the baseline is unreadable
        onboarded: !reg._missing,
        baselineUnreadable: Boolean(baseline.__legacyFormat),
        normalized,
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
    console.log(`${errors ? red(plural(errors, 'error')) : 'no errors'}, ${plural(warns, 'warning')}`);
    if (normalized.length) console.log(dim(`${plural(normalized.length, 'annotation')} normalized by --fix`));
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
    let perFile = analyzeAll(reg, files);
    const migrated = migrateTargets(perFile);
    if (migrated.length) perFile = analyzeAll(reg, files);
    const done = fixCanonical(perFile);
    if (!flags.has('--quiet')) {
      const byFile = new Map();
      for (const d of [...migrated, ...done]) byFile.set(d.file, (byFile.get(d.file) ?? 0) + 1);
      for (const [file, n] of byFile) console.log(`${file} ${dim(`${n} rewritten`)}`);
      console.log(`codemap fmt: ${plural(done.length, 'annotation')} normalized`
        + (migrated.length ? `, ${plural(migrated.length, 'relative target')} resolved` : ''));
    }
    break;
  }

  case 'impact': {
    const target = positional[0];
    if (!target) { console.error('usage: cm impact <path>'); process.exit(2); }
    const reg = loadOrDie();
    const perFile = analyzeAll(reg, annotatedFiles(reg));
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
    const perFile = analyzeAll(reg, annotatedFiles(reg));
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
      if (annText(s)) console.log(`${pad}  ${dim(annText(s))}`);
    }
    break;
  }

  case 'ls': {
    const reg = loadOrDie();
    const perFile = analyzeAll(reg, annotatedFiles(reg));
    const g = buildGraph(perFile);
    console.log(bold('flows'));
    for (const [n, f] of g.flows) console.log(`  ${n}  ${dim(`${f.steps.length} steps`)}`);
    console.log(bold('edges'));
    for (const e of g.edges) console.log(`  ${e.kind.padEnd(10)} ${e.file}:${e.line} -> ${e.target}`);
    console.log(bold('guards'));
    for (const a of g.guards) console.log(`  ${a.file}:${a.line}  ${annText(a)}`);
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

    const limit = numericFlag('--limit', 40);
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
    // cm:guard the baseline must see EVERY selected file, never the git-grep shortlist — a file with no
    // annotation is exactly the one whose legacy prose needs freezing
    const perFile = analyzeAll(reg, allFiles(reg));
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
    const perFile = analyzeAll(reg, allFiles(reg));
    const keys = {};
    for (const f of perFile) if (f.proseKeys?.length) keys[f.relPath] = f.proseKeys;
    saveBaseline(root, keys);
    const total = Object.values(keys).reduce((a, b) => a + b.length, 0);
    console.log(`codemap ${SPEC_VERSION} initialised at ${root}`);
    console.log(`  .forge/codemap.json`);
    console.log(`  .forge/codemap-baseline.json  ${dim(`${total} legacy comments frozen by content`)}`);
    break;
  }

  // cm:why enforcement that only exists inside the plugin is enforcement half the contributors never
  // see; this puts the checker in the repo so the registry's rules hold with no plugin installed
  case 'install': {
    const version = toolVersion();
    const r = install({
      root, version, gitHook: flags.has('--git-hook'), force: flags.has('--force'),
    });
    if (!existsSync(join(root, '.forge', 'codemap.json'))) {
      saveRegistry(root, { ...DEFAULT_REGISTRY });
      console.log(`wrote .forge/codemap.json ${dim('(no baseline yet — run: .forge/codemap/cm baseline)')}`);
    }
    console.log(`codemap ${version} installed into ${bold('.forge/codemap/')} ${dim(`${r.files.length} files`)}`);
    if (r.hook) console.log(`  ${r.hook} ${dim('runs: cm verify --staged --tier grammar')}`);
    for (const n of r.notes) console.log(dim(`  note: ${n}`));
    console.log('');
    console.log('Commit .forge/codemap/ — it is what makes the rules hold without the plugin:');
    console.log(dim('  CI:        .forge/codemap/cm verify --since $(git merge-base origin/main HEAD)'));
    console.log(dim('  local:     .forge/codemap/cm verify --staged'));
    console.log(dim('  agents:    the plugin hooks prefer this copy over their own bundle'));
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

  case 'codes':
    console.log(renderHelp('codes').text);
    break;

  // cm:why an agent has to be able to ask what the rules are from inside a repo that never installed the
  // plugin — the guidebook ships with the checker, not with the plugin's skill (lib/help.mjs)
  case 'help':
  case '--help':
  case '-h': {
    const r = renderHelp(positional[0], positional[1]);
    console.log(r.text);
    if (!r.ok) process.exitCode = 2;
    break;
  }

  case 'migrate':
    console.error(`codemap implements only ${SPEC_VERSION}; there is nothing to migrate yet (§9).`);
    process.exit(2);
    break;

  case '--version':
  case 'version':
    console.log(`${toolVersion()} (${SPEC_VERSION})`);
    break;

  // cm:guard an unknown verb is exit 2, not a usage dump at exit 0 — `cm verfiy` in a CI step was a
  // green gate that checked nothing, the same fail-open shape as a mistyped flag value (§9.1)
  default:
    console.error(red(`codemap: unknown verb "${cmd}"`));
    console.error(dim(`  verbs: ${VERBS.map(([v]) => v).join(', ')}`));
    console.error(dim('  guidebook: cm help  ·  cm help topics'));
    process.exit(2);
}
