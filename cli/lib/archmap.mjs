// codemap/1 §7.1 — the real import graph CM301 was missing (graph.mjs:108 confesses the gap).
//
// archmap is a sibling tool, vendored independently at `.forge/archmap` the same way codemap
// vendors itself at `.forge/codemap` — never a dependency of this package. A repo that has not
// run `archmap install` gets `null` here, and CM301 falls back to its basename heuristic exactly
// as before: this module only ever ADDS evidence, never a requirement.

import {
  existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, statSync,
} from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirtyFiles } from './registry.mjs';

const VENDOR_BIN = join('.forge', 'archmap', 'archmap');

// cm:guard sibling of `.forge/.codemap-metrics/`, never inside a vendored tree — an
//   `archmap install --upgrade` or `cm install --upgrade` must never clobber a warm cache
const CACHE_DIR = ['.forge', '.codemap-archmap-cache'];
const CACHE_FILE = 'graph.json';
const LOCK_FILE = 'refresh.lock';
// cm:why generous, not tuned — a real scan is ~15s; this only bounds how long a lock outlives
//   a killed worker before the next edit is allowed to try again
const LOCK_MAX_AGE_MS = 5 * 60 * 1000;
// cm:why a fresh finish is not an invitation to rescan — an actively-edited repo would otherwise
//   sit in back-to-back ~15s scans, each superseded before it can even land (ISS-14 review, F2)
const COOLDOWN_MS = 15 * 1000;
// cm:why only these can carry an import; a README/lockfile/JSON edit cannot change the graph, so
//   counting it would invalidate a warm cache for no reason (ISS-14 review, F3)
const SOURCE_EXT = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|go|php|py|pyi|rs)$/i;

// cm:guard undirected on purpose — CM301 asks "is there evidence at either end", never which way
//   an edge points, so a->b and b->a are the same fact and must look up the same way
function link(adjacency, a, b) {
  if (!a || !b || a === b) return;
  for (const [x, y] of [[a, b], [b, a]]) {
    const set = adjacency.get(x) ?? new Set();
    set.add(y);
    adjacency.set(x, set);
  }
}

/**
 * archmap's exported graph document (its SPEC §10.4), reduced to a file-to-file adjacency set.
 * `null` covers every reason the graph is unavailable — not vendored, the command failed, the
 * output did not parse as its own contract — and all of those mean "no evidence", not "no edge".
 * Shared by the synchronous scan below and the detached refresh worker, so the two never drift.
 */
export function parseGraphDoc(json) {
  let doc;
  try { doc = JSON.parse(json); } catch { return null; }
  if (!doc || typeof doc.formatVersion !== 'number' || !Array.isArray(doc.edges)) return null;
  const adjacency = new Map();
  for (const e of doc.edges) {
    if (e.resolved) link(adjacency, e.fromFile, e.toFile);
  }
  return { formatVersion: doc.formatVersion, adjacency };
}

function cacheDir(root) { return join(root, ...CACHE_DIR); }
// cm:edge contract -> cli/lib/archmap-refresh-worker.mjs — the worker clears/finishes THIS lock;
//   both must resolve the same path, so it imports this rather than re-spelling it (ISS-14 review, F6)
export function lockPath(root) { return join(cacheDir(root), LOCK_FILE); }

function freezeGraph(graph) {
  const adjacency = {};
  for (const [file, set] of graph.adjacency) adjacency[file] = [...set];
  return { formatVersion: graph.formatVersion, adjacency };
}

function reviveGraph(cached) {
  if (!cached || typeof cached.formatVersion !== 'number' || !cached.adjacency) return null;
  const adjacency = new Map(Object.entries(cached.adjacency).map(([f, list]) => [f, new Set(list)]));
  return { formatVersion: cached.formatVersion, adjacency };
}

/**
 * Write a graph to the cache, keyed by the fingerprint HASH it was built from — an atomic rename,
 * so a reader never observes a half-written file. Never throws: a write failure leaves the check
 * exactly where it was, evidence-poorer but not broken, per this file's own header.
 */
export function writeGraphCache(root, printHash, graph) {
  try {
    const dir = cacheDir(root);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const tmp = join(dir, `${CACHE_FILE}.${process.pid}.tmp`);
    writeFileSync(tmp, JSON.stringify({ fingerprint: printHash, ...freezeGraph(graph) }));
    renameSync(tmp, join(dir, CACHE_FILE));
  } catch {
    // cm:guard a disk error here must never be the reason an edit itself fails or looks unchecked
  }
}

function readGraphCache(root) {
  try { return JSON.parse(readFileSync(join(cacheDir(root), CACHE_FILE), 'utf8')); } catch { return null; }
}

function headSha(root) {
  try {
    return execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { return null; }
}

/**
 * codemap/1 §7.1 (ISS-14) — the invalidation key: what actually changes an import graph is a
 * file's content changing, not a clock. `HEAD` covers everything committed in one cheap call;
 * `dirtyFiles` (already used by `cm baseline`) names the small set that can differ from it, and
 * only THOSE get stat'd — never the whole tree, so this stays cheap on a 1600+ file repo.
 *
 * Returned as a short hash, never the raw string: a rebase or a huge checkout can dirty
 * thousands of paths, and the raw form once rode argv into the refresh worker (ISS-14 review,
 * F8) — long enough to risk `ARG_MAX` and to bloat the cache file for no reason.
 *
 * `null` means "cannot be determined" (no git, a detached HEAD with no commits, …), and a caller
 * must never treat that as a match: an unfingerprintable repo can only ever miss the cache.
 */
export function fingerprint(root) {
  const head = headSha(root);
  const dirty = dirtyFiles(root);
  if (head === null || dirty === null) return null;
  // cm:guard `.forge/` is this tool's OWN state — metrics.mjs rewrites pending.json on every hook
  //   run, so counting it here would invalidate the cache on every edit, never just a real import
  const parts = [...dirty].filter((f) => !f.startsWith('.forge/') && SOURCE_EXT.test(f)).sort().map((f) => {
    // cm:why a stat that throws is a file gone since HEAD — still a change the graph must see
    try {
      const st = statSync(join(root, f));
      return `${f}:${st.size}:${st.mtimeMs}`;
    } catch { return `${f}:gone`; }
  });
  const raw = [head, ...parts].join('\n');
  return createHash('sha256').update(raw).digest('hex');
}

function readLock(root) {
  try { return JSON.parse(readFileSync(lockPath(root), 'utf8')); } catch { return null; }
}

function refreshInFlight(lock) {
  if (!lock || lock.finishedAt !== undefined) return false;
  // cm:why an old lock is presumed abandoned (a killed worker, a crashed machine), never waited on
  if (Date.now() - lock.startedAt > LOCK_MAX_AGE_MS) return false;
  try { process.kill(lock.pid, 0); return true; } catch { return false; }
}

function recentlyFinished(lock) {
  return lock?.finishedAt !== undefined && Date.now() - lock.finishedAt < COOLDOWN_MS;
}

/**
 * Kick off the ~15s scan OUTSIDE this process — detached and unref'd, so it outlives the hook
 * that triggered it and never holds the edit open. At most one runs per repo at a time: the lock
 * is claimed with an exclusive create (`wx`), so two processes racing here cannot both win it, and
 * a repo mid-edit gets at most one attempt per `COOLDOWN_MS` rather than one per keystroke.
 */
function scheduleRefresh(root, bin, printHash) {
  const dir = cacheDir(root);
  try { if (!existsSync(dir)) mkdirSync(dir, { recursive: true }); } catch { return; }

  const claim = JSON.stringify({ pid: process.pid, startedAt: Date.now() });
  const path = lockPath(root);
  try {
    writeFileSync(path, claim, { flag: 'wx' });
  } catch {
    // cm:guard a lock already exists — only take it over if it is neither live nor on cooldown
    const lock = readLock(root);
    if (refreshInFlight(lock) || recentlyFinished(lock)) return;
    try { writeFileSync(path, claim); } catch { return; }
  }

  const worker = join(dirname(fileURLToPath(import.meta.url)), 'archmap-refresh-worker.mjs');
  let child;
  try {
    child = spawn(process.execPath, [worker, root, bin, printHash],
      { cwd: root, detached: true, stdio: 'ignore' });
  } catch { return; }
  child.unref();
  // cm:why the claim above proved ownership; this replaces the placeholder pid with the real
  //   worker's, which is what staleness (a killed worker) is checked against later
  try { writeFileSync(path, JSON.stringify({ pid: child.pid, startedAt: Date.now() })); } catch {
    // cm:guard a lock we could not update still exists and still blocks a second spawn; fine either way
  }
}

/**
 * The synchronous path: `--tier advisory` (a human asked, and will wait) and `enforce.advisory:
 * true` (a repo opted in, paying the cost it measured). Runs the real scan in this process, exactly
 * as before ISS-14. Also warms the cache — but only if nothing changed the fingerprint WHILE the
 * ~15s scan ran; otherwise the result describes a tree that no longer exists and is discarded
 * rather than cached under the (now wrong) key it started with (ISS-14 review, F1).
 */
export function loadImportGraph(root) {
  const bin = join(root, VENDOR_BIN);
  if (!existsSync(bin)) return null;

  const before = fingerprint(root);
  let out;
  try {
    // cm:guard maxBuffer is explicit and generous — the default 1 MiB truncates a compact export well
    //   under a thousand files (measured: 1.8 MB on a 1905-file repo), and a truncated parse must fail
    out = execFileSync(bin, ['graph', '--json', '--compact'],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 256 * 1024 * 1024 });
  } catch {
    return null;
  }

  const graph = parseGraphDoc(out);
  if (graph && before && fingerprint(root) === before) writeGraphCache(root, before, graph);
  return graph;
}

/**
 * The default-tier path (ISS-14): archmap is vendored and `enforce.advisory` was not explicitly
 * set, so this is the auto-enable case the hook's bare `cm verify` runs on EVERY edit. Never runs
 * the scan itself — a fresh cache is a hit, anything else is `null` (no evidence this edit, exactly
 * as if archmap were absent) with a background refresh scheduled for the next one.
 */
export function loadCachedImportGraph(root) {
  const bin = join(root, VENDOR_BIN);
  if (!existsSync(bin)) return null;

  // cm:guard an unfingerprintable repo can never be trusted to match a cache — always a miss
  const print = fingerprint(root);
  if (print === null) return null;

  const cached = readGraphCache(root);
  if (cached?.fingerprint === print) return reviveGraph(cached);

  scheduleRefresh(root, bin, print);
  return null;
}

/** Is there evidence, in either direction, that `a` and `b` are actually wired together? */
export function connected(graph, a, b) {
  return graph?.adjacency.get(a)?.has(b) ?? false;
}
