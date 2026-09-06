// ISS-17 prototype — NOT shipped grammar, NOT wired into `cm verify` or `graph.mjs`.
//
// Proves the one mechanism the federated-edge design (spec/FEDERATION.md) depends on: that a
// `cm:edge` target on the far side of a repository boundary can be checked against the far
// repo's CURRENT content using nothing but git itself — no daemon, no API token, no package.
//
// A federated edge is four values: a git remote, a ref, a repo-relative path, and (optionally)
// a symbol on the CM106 anchor grammar. This script takes exactly those four and answers the
// question a federated `cm:edge` would need answered: does the target still exist, and does the
// symbol still appear in it — checked against the CURRENT tip of <ref>, fetched fresh, never a
// stale checkout.
//
// Usage:
//   node federation-check.mjs <remote> <ref> <path> [symbol]
//
// Exit codes (mirrors SPEC §9.1's 0/1/2, adapted to what a federated check can conclude):
//   0  verified — content fetched, target (and symbol, if given) present
//      OR unreachable — the far side could not be fetched (network, auth, no such ref).
//         Unreachable is deliberately NOT a failure: the whole point of the out-of-tree
//         precedent (ISS-16, CM107) is that a check with no way to reach the far side
//         degrades to "not verified this run", never to "broken". A CI runner with no
//         credentials for a sibling repo must not turn every build red because of that.
//   1  confirmed break — the far side WAS reached, and the path or symbol is genuinely gone.
//   2  bad invocation (missing args) — same meaning as SPEC §9.1's code 2: the check could
//      not run at all, never conflated with "ran and found nothing wrong".

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Same semantics as graph.mjs's anchorPresent (CM106): a word-boundary match on the anchor's
// first dot-segment. Not resolution — no parse, no LSP — just "does this name still appear",
// which is exactly as much as CM106 asks of an in-tree target.
function anchorPresent(src, anchor) {
  const sym = anchor.split('.')[0];
  if (!sym) return true;
  const esc = sym.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^\\w$])${esc}(?:[^\\w$]|$)`).test(src);
}

function run(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function main() {
  const [remote, ref, path, symbol] = process.argv.slice(2);
  if (!remote || !ref || !path) {
    console.error('usage: federation-check.mjs <remote> <ref> <path> [symbol]');
    process.exit(2);
  }

  const scratch = mkdtempSync(join(tmpdir(), 'cm-federate-'));
  try {
    run(['init', '-q', '--bare', scratch], undefined);

    const target = `federated:${remote}/${path}${symbol ? `#${symbol}` : ''}`;
    let sha;
    try {
      run(['fetch', '--depth', '1', remote, ref], scratch);
      sha = run(['rev-parse', 'FETCH_HEAD'], scratch).trim();
    } catch (err) {
      console.log(`UNVERIFIED (unreachable) ${target}`);
      console.log(`  ${String(err.message).trim().split('\n').pop()}`);
      process.exit(0);
    }

    let content;
    try {
      content = run(['show', `${sha}:${path}`], scratch);
    } catch {
      console.log(`BROKEN ${target}`);
      console.log(`  fetched ${remote}@${sha} — ${path} no longer exists there`);
      process.exit(1);
    }

    if (symbol && !anchorPresent(content, symbol)) {
      console.log(`BROKEN ${target}`);
      console.log(`  fetched ${remote}@${sha} — ${path} exists but "${symbol}" is gone`);
      process.exit(1);
    }

    console.log(`VERIFIED ${target}`);
    console.log(`  fetched ${remote}@${sha}`);
    process.exit(0);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

main();
