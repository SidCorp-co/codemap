#!/usr/bin/env node
// cm:hack ISS-6 until:every vendored repo runs an upgrade workflow that resolves cli/cm.mjs — forwards the pre-0.17 path
// cm:edge lockstep -> adapters/ci/codemap-upgrade.yml — the template this shim exists to outlive; deleting one without the other strands the repos still on the old path
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const real = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'cli', 'cm.mjs');
process.exit(spawnSync(process.execPath, [real, ...process.argv.slice(2)], { stdio: 'inherit' }).status ?? 1);
