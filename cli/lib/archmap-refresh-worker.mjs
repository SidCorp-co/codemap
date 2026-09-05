#!/usr/bin/env node
// codemap/1 §7.1 (ISS-14) — the ~15s `archmap graph` scan, run detached from the edit that asked
// for it. `archmap.mjs`'s cache-only path spawns this and does not wait; this process outlives it,
// does the whole-repo scan on its own clock, and writes the cache for the NEXT edit to find warm.

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { parseGraphDoc, writeGraphCache, fingerprint, lockPath } from './archmap.mjs';

const [, , root, bin, printHash] = process.argv;

function finishLock() {
  try { writeFileSync(lockPath(root), JSON.stringify({ pid: process.pid, finishedAt: Date.now() })); } catch {
    // cm:guard the lock is a hint, not state anyone reads back from this process — nothing to fix
  }
}

try {
  const out = execFileSync(bin, ['graph', '--json', '--compact'],
    { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 256 * 1024 * 1024 });
  const graph = parseGraphDoc(out);
  // cm:guard the tree may change WHILE this ~15s scan runs — cache only a fingerprint that still
  //   matches now, or a later checkout back to it reads a stale result as fresh (ISS-14 review, F1)
  if (graph && fingerprint(root) === printHash) writeGraphCache(root, printHash, graph);
} catch {
  // cm:guard a failed scan just leaves the cache as it was; the next edit's fingerprint retries it
} finally {
  finishLock();
}
