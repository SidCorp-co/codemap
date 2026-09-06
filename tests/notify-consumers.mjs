// cm:why runs the shipped step script itself (not a paraphrase), under the same shell Actions uses
//   (`bash --noprofile --norc -eo pipefail <file>`), with env vars set to '' rather than deleted —
//   Actions never leaves an env: entry unset, an empty expression resolves to '' — so a regression
//   here fails for the same reason a real workflow run would (ISS-21).

import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function extractRunBlock(pluginRoot) {
  const path = join(pluginRoot, '.github', 'workflows', 'notify-consumers.yml');
  const lines = readFileSync(path, 'utf8').split('\n');
  const at = lines.findIndex((l) => l.includes('notify-consumers: ${ok} dispatched'));
  if (at < 0) throw new Error('notify-consumers.yml: no line containing the summary echo — did the step get renamed?');

  let start = at;
  while (start > 0 && !/^\s*(-\s*)?run:\s*\|\s*$/.test(lines[start])) start--;
  if (start === 0) throw new Error('notify-consumers.yml: could not find the enclosing "run: |" block');
  const indent = lines[start + 1].match(/^\s*/)[0];
  let end = start + 1;
  while (end < lines.length && (lines[end].startsWith(indent) || lines[end].trim() === '')) end++;
  return lines.slice(start + 1, end).map((l) => l.slice(indent.length)).join('\n');
}

function runScript(script, env) {
  const dir = mkdtempSync(join(tmpdir(), 'cm-notify-run-'));
  const scriptFile = join(dir, 'step.sh');
  writeFileSync(scriptFile, script);
  try {
    // cm:why the exact invocation Actions uses for a `run: |` block, flags and all — `-e` means a
    //   failing `curl` must be handled inside the if/else, not left to propagate
    return spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', scriptFile], { env, encoding: 'utf8' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function fakeCurlBin(exitCode) {
  const binDir = mkdtempSync(join(tmpdir(), 'cm-notify-bin-'));
  const logFile = join(binDir, 'curl.log');
  writeFileSync(logFile, '');
  const fakeCurl = join(binDir, 'curl');
  writeFileSync(fakeCurl, `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> "${logFile}"\nexit ${exitCode}\n`);
  chmodSync(fakeCurl, 0o755);
  return { binDir, logFile };
}

export function notifyConsumersCases(pluginRoot, check) {
  let script;
  try {
    script = extractRunBlock(pluginRoot);
  } catch (e) {
    check('notify-consumers: step script is extractable', false, e.message);
    return;
  }

  const { binDir, logFile } = fakeCurlBin(0);
  const base = { PATH: `${binDir}:${process.env.PATH}`, HOME: process.env.HOME };

  try {
    // 1. unset (Actions supplies '' for an env: expression with nothing to interpolate) -> no calls, exit 0
    let res = runScript(script, { ...base, RAW: '', TOKEN: '' });
    check('notify-consumers: empty RAW exits clean with nothing dispatched',
      res.status === 0 && res.stdout.includes('0 dispatched, 0 failed/skipped'),
      `status=${res.status}\nstdout: ${res.stdout}\nstderr: ${res.stderr}`);

    // 2. malformed JSON -> treated as empty, still exits clean
    res = runScript(script, { ...base, RAW: 'not json', TOKEN: 't0k3n' });
    check('notify-consumers: malformed RAW exits clean with nothing dispatched',
      res.status === 0 && res.stdout.includes('0 dispatched, 0 failed/skipped'),
      `status=${res.status}\nstdout: ${res.stdout}\nstderr: ${res.stderr}`);

    // 3. valid JSON but not an array -> must not reach fromJson-style iteration; treated as empty
    res = runScript(script, { ...base, RAW: '{"repo":"a/b"}', TOKEN: 't0k3n' });
    check('notify-consumers: non-array RAW exits clean with nothing dispatched',
      res.status === 0 && res.stdout.includes('0 dispatched, 0 failed/skipped'),
      `status=${res.status}\nstdout: ${res.stdout}\nstderr: ${res.stderr}`);

    // 4. one consumer, defaults for ref/workflow_file, curl succeeds
    writeFileSync(logFile, '');
    res = runScript(script, { ...base, RAW: '[{"repo":"acme/widgets"}]', TOKEN: 't0k3n' });
    check('notify-consumers: single consumer with defaults exits clean and dispatches',
      res.status === 0 && res.stdout.includes('1 dispatched, 0 failed/skipped'),
      `status=${res.status}\nstdout: ${res.stdout}\nstderr: ${res.stderr}`);
    let call = readFileSync(logFile, 'utf8').trim();
    check('notify-consumers: defaults to codemap-upgrade.yml and ref main',
      call.includes('acme/widgets/actions/workflows/codemap-upgrade.yml/dispatches') && call.includes('"ref":"main"'),
      `curl call: ${call}`);
    check('notify-consumers: carries the token as a bearer header',
      call.includes('Bearer t0k3n'), `curl call: ${call}`);
    check('notify-consumers: never echoes the repo name or token into the run log',
      !res.stdout.includes('acme/widgets') && !res.stdout.includes('t0k3n'),
      `stdout leaked a name or token: ${res.stdout}`);

    // 5. explicit ref + workflow_file override the defaults
    writeFileSync(logFile, '');
    res = runScript(script,
      { ...base, RAW: '[{"repo":"acme/widgets","ref":"release","workflow_file":"upgrade.yml"}]', TOKEN: 't0k3n' });
    check('notify-consumers: explicit ref+workflow_file exits clean and dispatches',
      res.status === 0 && res.stdout.includes('1 dispatched, 0 failed/skipped'),
      `status=${res.status}\nstdout: ${res.stdout}\nstderr: ${res.stderr}`);
    call = readFileSync(logFile, 'utf8').trim();
    check('notify-consumers: honours an explicit ref and workflow_file',
      call.includes('acme/widgets/actions/workflows/upgrade.yml/dispatches') && call.includes('"ref":"release"'),
      `curl call: ${call}`);

    // 6. two consumers, one missing `repo` entirely -> counted as failed, other still dispatches, exit 0
    writeFileSync(logFile, '');
    res = runScript(script,
      { ...base, RAW: '[{"ref":"main"},{"repo":"acme/widgets"}]', TOKEN: 't0k3n' });
    check('notify-consumers: an entry missing repo is skipped, not fatal',
      res.status === 0 && res.stdout.includes('1 dispatched, 1 failed/skipped'),
      `status=${res.status}\nstdout: ${res.stdout}\nstderr: ${res.stderr}`);
  } finally {
    rmSync(binDir, { recursive: true, force: true });
  }

  // 7. a real dispatch failure (curl exits nonzero) must not fail the step or stop other consumers
  const failing = fakeCurlBin(22);
  const failBase = { PATH: `${failing.binDir}:${process.env.PATH}`, HOME: process.env.HOME };
  try {
    const res = runScript(script,
      { ...failBase, RAW: '[{"repo":"acme/widgets"},{"repo":"acme/other"}]', TOKEN: 't0k3n' });
    check('notify-consumers: a failing dispatch (curl exits nonzero) does not fail the step',
      res.status === 0 && res.stdout.includes('0 dispatched, 2 failed/skipped'),
      `status=${res.status}\nstdout: ${res.stdout}\nstderr: ${res.stderr}`);
  } finally {
    rmSync(failing.binDir, { recursive: true, force: true });
  }
}
