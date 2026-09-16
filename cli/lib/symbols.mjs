// codemap/1 §7.2 — CM108, the identifier an annotation body names.
//
// CM102 asks whether a cm:edge target exists and CM106 whether its #symbol is still in that file.
// Neither looks at the half of an annotation that has no shape: a name a person put in backticks
// inside a cm:guard or cm:why. Measured on one consumer repo (3 061 files), 37 of 2 052 such names
// appear on no line outside a comment — a claim kept alive by a sentence naming something that is
// not there. This asks the one question that is derivable about them: is the name in the code.
//
// Two rules keep it honest, and both are stated rather than tuned. What counts as an identifier is a
// DECLARED set of forms, because the names that must be caught and the names that must not are not
// separable by shape — `requires_preflight` has the shape of `api_tokens`. And every case the
// resolver cannot decide errs toward silence, because the one error a gating tier may not make is
// calling a name missing that is there.

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { diag, baselineKey } from './parse.mjs';
import { profileFor } from './languages.mjs';
// cm:edge contract -> cli/lib/propose.mjs#codeOnly — ONE answer to what a comment is, so a name
//   this reads as code is a name analyzeFile reads as code too (ISS-60, ISS-71)
import { codeOnly } from './propose.mjs';

/**
 * The forms a backticked token may take to be a candidate, and what each was measured to cost.
 *
 * `camel` alone is the default. On `SidCorp-co/forge` (3 061 files, 2026-09-16) it reported 37 sites
 * over 31 names with one clear false positive, `findLast`, an Array method. `const` adds 12 sites
 * there and `ERR_INVALID_ARG_TYPE` is among them; `snake` adds 17 and `api_tokens`, `pg_stat_file`
 * and `sockaddr_un` are among them — both are exactly the classes ISS-71 says must not be reported,
 * so both are opt-in and a repo turns them on having seen its own number.
 */
export const SYMBOL_FORMS = {
  camel: /^[a-z][a-z0-9]*(?:[A-Z][A-Za-z0-9]*)+$/,
  const: /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/,
  snake: /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/,
};

export const DEFAULT_SYMBOL_FORMS = ['camel'];

// cm:guard a token is a WHOLE run of these characters and is compared by equality, never by
//   substring — a longer name holding a candidate must not answer for it (ISS-71)
// cm:why `$` is a word character on both sides, the same boundary `anchorPresent` draws for a CM106
//   anchor, so `db.$connect` matches and a name with a `$` glued to it does not
const TOKEN_RE = /[A-Za-z_$][A-Za-z0-9_$]*/g;
const BACKTICKED = /`([^`]+)`/g;
const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

// cm:guard masking is what stops an annotation resolving its own name, so a file too big to mask is
//   resolved RAW rather than skipped — dropping it would call a name missing that is there (ISS-71)
const MASK_CAP = 2 * 1024 * 1024;

// cm:guard the vendored checker is this tool's own source sitting inside a consumer tree, so its
//   identifiers are not that repo's — registry.mjs holds the same three in HARD_EXCLUDE
const SKIP_DIR = /(?:^|\/)(?:\.git|node_modules)\/|^\.forge\/codemap\//;

export function formsFor(reg) {
  const declared = reg?.enforce?.symbolForms;
  if (!Array.isArray(declared)) return DEFAULT_SYMBOL_FORMS;
  return declared.filter((f) => Object.hasOwn(SYMBOL_FORMS, f));
}

/**
 * The identifiers one annotation's body names, in order and without repeats.
 *
 * A span is read whole and then narrowed, in this order: the trailing call suffix goes first, so
 * `runCheck(a, b)` is the token `runCheck`; what is left is discarded if it still holds whitespace,
 * so `two words` is nothing; and the token is reduced to its first dot-segment, the rule §4 already
 * states for a CM106 anchor. Removing a suffix is normalisation and never admission — `getcwd()`
 * leaves `getcwd`, which no form accepts.
 */
export function candidateSymbols(ann, forms = DEFAULT_SYMBOL_FORMS) {
  const seen = new Set();
  for (const carrier of carriersOf(ann)) {
    for (const name of symbolNamesIn(carrier, forms)) seen.add(name);
  }
  return [...seen];
}

/** The identifiers one piece of annotation text names, in order and without repeats. */
export function symbolNamesIn(text, forms = DEFAULT_SYMBOL_FORMS) {
  const out = [];
  const seen = new Set();
  for (const m of String(text ?? '').matchAll(BACKTICKED)) {
    const bare = m[1].trim().replace(/\(.*\)$/, '').trim();
    if (!bare || /\s/.test(bare)) continue;
    const head = bare.split('.')[0];
    if (!IDENT_RE.test(head) || seen.has(head)) continue;
    if (!forms.some((f) => SYMBOL_FORMS[f]?.test(head))) continue;
    seen.add(head);
    out.push(head);
  }
  return out;
}

// cm:guard the annotation's own line and its wrap are kept APART, never joined — `cm baseline` asks
//   whether the text carrying a name is in HEAD, and a joined pair is in no blob at all (ISS-71)
// cm:why `raw` is the line as the file holds it and `text` is what canonical() renders, so the raw
//   form is what a HEAD blob can be searched for
const carriersOf = (ann) => [ann.raw ?? ann.text, ann.wrap].filter(Boolean);

/** The baseline key one CM108 site freezes under, in the file the annotation is in. */
export function symbolKey(name) {
  return `sym:${baselineKey(name)}`;
}

// cm:why git is asked first for the same reason candidates.mjs asks it: it knows what is ignored,
//   and a fallback walk that guessed would read a build directory the repo never wrote
function repoFiles(root) {
  try {
    const out = execFileSync('git', ['-C', root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'],
      { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
    const list = out.split('\0').map((s) => s.trim()).filter(Boolean);
    if (list.length) return list;
  } catch { /* not a git tree, or git is not there */ }
  return walkAll(root);
}

// cm:guard NOT registry.mjs's walk — that one keeps only files profileFor resolves, and the file
//   answering for a name codemap cannot parse is exactly the one it would drop (ISS-71)
function walkAll(root) {
  const out = [];
  (function rec(dir) {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const abs = join(dir, e.name);
      const rel = relative(root, abs).split(sep).join('/');
      if (e.isDirectory()) {
        if (e.name === '.git' || e.name === 'node_modules') continue;
        rec(abs);
      } else if (e.isFile()) out.push(rel);
    }
  })(root);
  return out;
}

/**
 * Which of `names` appear as a whole token outside a comment, anywhere in the repository.
 *
 * Each file is tokenised RAW first and masked only if it holds a name still wanted, so the comment
 * state machine runs on the few files that can change an answer rather than on the tree. A file with
 * no profile has no comment syntax codemap can identify and counts whole; one too large to mask, or
 * holding a NUL byte, resolves on its raw tokens. Every one of those is a silence, never an
 * accusation. The walk stops the moment nothing is still wanted.
 */
export function resolveNames(root, names) {
  const want = new Set(names);
  const found = new Set();
  if (!want.size) return { found, scanned: 0 };

  let scanned = 0;
  for (const rel of repoFiles(root)) {
    if (found.size === want.size) break;
    if (SKIP_DIR.test(rel)) continue;
    let st;
    try { st = statSync(join(root, rel)); } catch { continue; }
    if (!st.isFile()) continue;
    let src;
    try { src = readFileSync(join(root, rel), 'utf8'); } catch { continue; }
    scanned++;

    const hits = [];
    for (const tok of src.match(TOKEN_RE) ?? []) {
      if (want.has(tok) && !found.has(tok)) hits.push(tok);
    }
    if (!hits.length) continue;

    const prof = profileFor(rel);
    if (!prof || st.size > MASK_CAP || src.includes('\0')) {
      for (const h of hits) found.add(h);
      continue;
    }
    let code;
    try { code = codeOnly(src, prof); } catch { code = src; }
    const inCode = new Set(code.match(TOKEN_RE) ?? []);
    for (const h of hits) if (inCode.has(h)) found.add(h);
  }
  return { found, scanned };
}

/**
 * codemap/1 §7.2 — every cm:guard / cm:why naming an identifier that is in no code.
 *
 * The baseline is deliberately NOT consulted here: `cm verify` spares a frozen site and `cm baseline`
 * re-freezes from scratch, and a function that had already dropped the frozen ones could serve only
 * the first. Each site carries the key it freezes under, the `carrier` text a HEAD-eligibility check
 * searches a blob for, and its own diagnostic, so both callers read one list.
 *
 * @returns {{ sites, scanned }} `scanned` is how many files the resolver opened, 0 where it did not run.
 */
export function symbolDiags({ root, reg, graph }) {
  const forms = formsFor(reg);
  const named = [];
  for (const a of [...graph.guards, ...graph.whys]) {
    const seen = new Set();
    for (const carrier of carriersOf(a)) {
      for (const name of symbolNamesIn(carrier, forms)) {
        if (seen.has(name)) continue;
        seen.add(name);
        named.push({ file: a.file, line: a.line, name, key: symbolKey(name), carrier });
      }
    }
  }
  if (!named.length) return { sites: [], scanned: 0 };

  const { found, scanned } = resolveNames(root, [...new Set(named.map((s) => s.name))]);
  const sites = named.filter((s) => !found.has(s.name))
    .map((s) => ({ ...s, diag: diag('CM108', s.file, s.line, s.name) }));
  return { sites, scanned };
}
