// cm:why every consumer repo's weekly upgrade bot resolves "latest" via `git tag -l codemap-v* |
//   sort -V | tail -1` (agent-setup/codemap-upgrade.yml), never plugin.json
// cm:guard a version bump landed on main without its tag is INVISIBLE to that bot, and reads to
//   every consumer as "already up to date" rather than "stale" (ISS-5)
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compareVersions } from '../scripts/lib/registry.mjs';

function git(repoRoot, args) {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();
}

export function releaseTagCases(pluginRoot, check) {
  const repoRoot = join(pluginRoot, '..', '..');
  const manifest = JSON.parse(readFileSync(join(pluginRoot, '.claude-plugin', 'plugin.json'), 'utf8'));
  const version = manifest.version;
  const tag = `codemap-v${version}`;

  let existingTags;
  try {
    existingTags = git(repoRoot, ['tag', '-l', 'codemap-v*']).split('\n').filter(Boolean);
  } catch {
    // cm:why no git, or not a git checkout — there is nothing here to verify a tag against
    return;
  }
  // cm:why a shallow clone that never fetched tags has nothing to compare, and saying "no tag" there
  //   would fail every consumer's CI on the one thing this check is not about
  if (existingTags.length === 0) return;

  const newest = existingTags
    .map((t) => t.slice('codemap-v'.length))
    .sort(compareVersions)
    .slice(-3);
  check(`release: ${tag} exists`, existingTags.includes(tag),
    `plugin.json says ${version}, but no git tag "${tag}" was found — newest tagged: [${newest.join(', ')}]. `
    + `Every consumer repo's weekly upgrade bot reads tags, not commit messages or plugin.json — `
    + `run: git tag ${tag} <this version-bump commit> && git push origin ${tag}`);
}
