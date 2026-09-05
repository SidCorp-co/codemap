// codemap/1 — candidate discovery for `cm propose` (ISS-12).
//
// Every function here answers "where might a coupling be hiding", never "what is the coupling". A
// candidate carries its evidence and nothing else: no kind is asserted unless the source itself
// defines the kind (lockstep, contract), no `— why` text is ever written (patterns/finding-candidates.md
// §4: history can propose the pair, but the reason it is bound is what a human's annotation carries),
// and nothing here touches the baseline or writes to a file. `cm propose` only ever prints.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { PROSE_CODES } from './parse.mjs';
import { profileFor } from './languages.mjs';
import { connected } from './archmap.mjs';

const PATH_RE = /[\w./-]+\.(?:ts|tsx|js|jsx|mjs|cjs|go|php|py|rs|sql|prisma|graphql)\b/g;

/**
 * Confidence 1 — prose that already names a file which resolves to exactly one other file in the
 * tree. The single cheapest source there is (README "Field data"): a comment somebody already wrote,
 * judged worth recording, with no channel to put it in. Shared with `cm onboard`, which surfaced this
 * same evidence as prose before this verb existed to turn it into a proposal.
 */
export function proseCandidates(perFile, files) {
  const prose = perFile.flatMap((f) => f.diags.filter((d) => PROSE_CODES.has(d.code))
    .map((d) => ({ file: f.relPath, line: d.line, text: d.text ?? d.message })));

  const seen = new Set();
  const out = [];
  for (const p of prose) {
    const matches = String(p.text).match(PATH_RE) ?? [];
    for (const cand of matches) {
      const hit = files.find((f) => f === cand || f.endsWith(`/${cand.replace(/^\.\//, '')}`));
      const key = `${p.file}:${p.line}:${hit}`;
      if (!hit || hit === p.file || seen.has(key)) continue;
      seen.add(key);
      // cm:why kind is NOT guessed — which of the six it is depends on what breaks without it, and
      //   that is exactly the judgement the issue this source came from says a tool cannot make
      out.push({ source: 'prose', file: p.file, line: p.line, target: hit, evidence: p.text });
    }
  }
  return out;
}

const stem = (p) => p.split('/').pop().replace(/\.\w+$/, '');
// cm:guard blanks a comment LINE rather than dropping it — a dropped line shifts every line number
//   after it, and contractCandidates reports the line it found a literal on
const codeOnly = (src) => src.split('\n').map((l) => (/^\s*(\/\/|#|--|\*|\/\*)/.test(l) ? '' : l)).join('\n');

const readCache = (root, cache) => (rel) => {
  if (cache.has(rel)) return cache.get(rel);
  let src;
  try { src = codeOnly(readFileSync(join(root, rel), 'utf8')); } catch { src = null; }
  cache.set(rel, src);
  return src;
};

/**
 * Best-effort "these two are not already wired together": archmap's real import graph when the repo
 * has vendored it (`connected`), and — always, since most repos have not — a basename mention in
 * either file's own code. Neither is proof; both are only ever used to DROP a pair, never to add one,
 * so a miss here costs a false positive we would rather not risk, never a false negative that just
 * stays unproposed (§ precision over recall, this issue's own business rule).
 */
function looksWired(root, a, b, importGraph, cache) {
  if (importGraph && connected(importGraph, a, b)) return true;
  const read = readCache(root, cache);
  const [srcA, srcB] = [read(a), read(b)];
  const [stemA, stemB] = [stem(a), stem(b)];
  const mentions = (src, name) => src != null && name.length >= 3
    && new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(src);
  return mentions(srcA, stemB) || mentions(srcB, stemA);
}

// cm:why a mass-reformat or vendor-bump commit touches everything and every pair in it "co-changes"
//   once — counting it would make the busiest commit in the repo's history the strongest signal
const MAX_COMMIT_FILES = 24;
const MAX_COMMITS = 3000;

/**
 * Co-change counts per unordered file pair, and per-file commit counts, over the selected scope —
 * `git log --name-only`, one call, capped so a monorepo's full history stays bounded (§ MAX_COMMITS).
 */
function coChangeCounts(root, inScope) {
  let out;
  try {
    out = execFileSync('git', ['-C', root, 'log', '--no-merges', `--max-count=${MAX_COMMITS}`,
      '--name-only', '--pretty=format:%x00'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 256 * 1024 * 1024 });
  } catch { return null; }

  const commitCount = new Map();
  const coChange = new Map();
  // cm:why JSON.stringify, not a joined string — a delimiter character can legally appear inside a
  //   path, and a colliding key would silently merge two distinct pairs' counts
  const pairKey = (a, b) => (a < b ? JSON.stringify([a, b]) : JSON.stringify([b, a]));
  let commits = 0;
  const NUL = String.fromCharCode(0);
  for (const block of out.split(NUL)) {
    const files = [...new Set(block.split('\n').map((l) => l.trim()).filter((f) => f && inScope.has(f)))];
    if (!files.length) continue;
    commits++;
    if (files.length > MAX_COMMIT_FILES) continue;
    for (const f of files) commitCount.set(f, (commitCount.get(f) ?? 0) + 1);
    for (let i = 0; i < files.length; i++) {
      for (let j = i + 1; j < files.length; j++) {
        const k = pairKey(files[i], files[j]);
        coChange.set(k, (coChange.get(k) ?? 0) + 1);
      }
    }
  }
  return { commitCount, coChange, commits };
}

/**
 * Confidence 2 — files that change together far more often than chance, with no import between
 * them (patterns/lockstep.md). "Far more often than chance" is `lift`: co-change divided by what
 * independence would predict from each file's own commit frequency. Both thresholds are conservative
 * on purpose — a coincidence proposed as a coupling is the volume-without-value failure this whole
 * verb exists to avoid (issue business rules: precision over recall, no bulk apply).
 */
export function lockstepCandidates(root, files, { importGraph, minCoChanges = 3, minLift = 4 } = {}) {
  const inScope = new Set(files);
  const counts = coChangeCounts(root, inScope);
  if (!counts || counts.commits === 0) return [];
  const { commitCount, coChange, commits } = counts;

  const cache = new Map();
  const out = [];
  for (const [key, n] of coChange) {
    if (n < minCoChanges) continue;
    const [a, b] = JSON.parse(key);
    const ca = commitCount.get(a) ?? 0;
    const cb = commitCount.get(b) ?? 0;
    const expected = (ca * cb) / commits;
    const lift = expected > 0 ? n / expected : Infinity;
    if (lift < minLift) continue;
    if (looksWired(root, a, b, importGraph, cache)) continue;
    out.push({ source: 'lockstep', files: [a, b], coChanges: n, commitsA: ca, commitsB: cb, totalCommits: commits, lift });
  }
  out.sort((x, y) => y.coChanges - x.coChanges || x.files[0].localeCompare(y.files[0]));
  return out;
}

/**
 * A separator is required — "true", "index", "database" are common words that would otherwise pass
 * "exactly two files, two languages" on pure coincidence; an error code, an event name, a header and
 * a serialized enum all carry one (patterns/contract.md), and a plain English word never does.
 */
const TOKEN_RE = /^[A-Za-z][A-Za-z0-9]*(?:[_.:-][A-Za-z0-9]+)+$/;
const LITERAL_RE = /"([^"\n]{4,80})"|'([^'\n]{4,80})'|`([^`\n]{4,80})`/g;
// cm:why this tool's own tag vocabulary is quoted all over its help text, tests and docs — excluded,
//   or a shared "cm:why" would look like a contract between two callers that share nothing (ISS-12)
const RESERVED = /^cm:(edge|guard|flow|hack|why|ignore)/;

/**
 * Confidence 3 — a string literal that appears in exactly two files, in two different languages
 * (patterns/contract.md: "the comment that already says 'must match the pattern in…' is the single
 * most common prose form of a latent contract edge" — this is that same shape, found in code instead
 * of in a comment, which is why it ranks below source 1's already-written prose).
 */
export function contractCandidates(root, files) {
  const byLiteral = new Map();
  for (const rel of files) {
    const prof = profileFor(rel);
    if (!prof) continue;
    let raw;
    try { raw = readFileSync(join(root, rel), 'utf8'); } catch { continue; }
    const src = codeOnly(raw);
    const seenInFile = new Set();
    const lines = src.split('\n');
    // cm:why line number is the literal's FIRST line in the CODE-only text — good enough to point a
    //   reviewer at it; a literal can recur, and this source is evidence to check, not an anchor
    for (let i = 0; i < lines.length; i++) {
      LITERAL_RE.lastIndex = 0;
      let m;
      while ((m = LITERAL_RE.exec(lines[i]))) {
        const lit = m[1] ?? m[2] ?? m[3];
        if (!TOKEN_RE.test(lit) || RESERVED.test(lit) || seenInFile.has(lit)) continue;
        seenInFile.add(lit);
        const entry = byLiteral.get(lit) ?? new Map();
        if (!entry.has(rel)) entry.set(rel, { file: rel, line: i + 1, lang: prof.id });
        byLiteral.set(lit, entry);
      }
    }
  }

  const out = [];
  for (const [lit, entry] of byLiteral) {
    if (entry.size !== 2) continue;
    const [a, b] = [...entry.values()];
    if (a.lang === b.lang) continue;
    out.push({ source: 'contract', literal: lit, files: [a, b] });
  }
  out.sort((x, y) => x.files[0].localeCompare(y.files[0]) || x.literal.localeCompare(y.literal));
  return out;
}
