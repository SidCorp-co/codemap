// cm:why the shipped install step used to `cd /tmp/codemap` then run `cm.mjs install` in the same
//   script — cm.mjs has no --root, so it vendors into $(pwd), and the `cd` leaked forward and
//   pointed that at the throwaway CLONE instead of the checked-out consumer repo. The PR came out
//   empty, silently, every run (ISS-5). This runs the shipped script text itself — not a paraphrase
//   of it — so a regression here fails for the same reason a real workflow run would silently not.

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { install } from '../scripts/lib/install.mjs';
import { vendoredVersion } from '../scripts/lib/registry.mjs';

function installStepScript(pluginRoot) {
  const lines = readFileSync(join(pluginRoot, 'agent-setup', 'codemap-upgrade.yml'), 'utf8').split('\n');
  const at = lines.findIndex((l) => l.includes('cm.mjs install --upgrade'));
  if (at < 0) throw new Error('codemap-upgrade.yml no longer has an install --upgrade step');

  let start = at;
  while (start > 0 && !/^\s*(-\s*)?run:\s*\|\s*$/.test(lines[start])) start--;
  const indent = lines[start + 1].match(/^\s*/)[0];
  let end = start + 1;
  while (end < lines.length && (lines[end].startsWith(indent) || lines[end].trim() === '')) end++;
  return lines.slice(start + 1, end).map((l) => l.slice(indent.length)).join('\n');
}

export function upgradeWorkflowCases(pluginRoot, check) {
  let script;
  try {
    script = installStepScript(pluginRoot);
  } catch (e) {
    check('upgrade-workflow: install step is extractable', false, e.message);
    return;
  }

  const clone = mkdtempSync(join(tmpdir(), 'cm-upgrade-clone-'));
  const consumer = mkdtempSync(join(tmpdir(), 'cm-upgrade-consumer-'));
  try {
    execFileSync('git', ['clone', '-q', join(pluginRoot, '..', '..'), clone]);
    // cm:why any real tag stands in for "${{ steps.latest.outputs.tag }}" — what this asserts is
    //   the *cwd* the install runs with, not tag resolution (release-tag.mjs owns that)
    const tag = execFileSync('git', ['tag', '-l', 'codemap-v*'], { cwd: clone, encoding: 'utf8' })
      .split('\n').filter(Boolean).sort().at(-1);

    // cm:why 0.1.0 stands in for "vendored a long time ago", so the upgrade has somewhere to move
    install({ root: consumer, version: '0.1.0' });
    const before = vendoredVersion(consumer);

    const rendered = script
      .split('/tmp/codemap').join(clone)
      .split('${{ steps.latest.outputs.tag }}').join(tag);
    const res = spawnSync('bash', ['-c', rendered], { cwd: consumer, encoding: 'utf8' });

    check('upgrade-workflow: install step exits clean',
      res.status === 0, `status=${res.status}\nstdout: ${res.stdout}\nstderr: ${res.stderr}`);

    const after = vendoredVersion(consumer);
    check('upgrade-workflow: install step vendors into the checked-out repo, not the throwaway clone',
      after !== null && after !== before,
      `consumer's .forge/codemap/VERSION was "${before}" before, "${after}" after — a bug here means `
      + `every consumer repo's PR comes out empty, silently, and reads as "already up to date"`);
  } finally {
    rmSync(clone, { recursive: true, force: true });
    rmSync(consumer, { recursive: true, force: true });
  }
}
