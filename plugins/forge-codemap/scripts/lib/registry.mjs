// codemap/1 §8 — registry, baseline, path selection.
//
// JSON rather than YAML so the whole framework runs on a bare `node` with zero dependencies:
// a plugin that needs `npm install` before its hooks work is a plugin that gets disabled.

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { execFileSync } from 'node:child_process';

export const SPEC_VERSION = 'codemap/1';

const DEFAULT_EXCLUDE = [
  '**/node_modules/**', '**/vendor/**', '**/target/**', '**/dist/**', '**/build/**',
  '**/.next/**', '**/.turbo/**', '**/.git/**', '**/coverage/**', '**/__pycache__/**',
  '**/*.min.js', '**/*.generated.*', '**/_ide_helper*', '**/.venv/**', '**/venv/**',
  // git worktrees hold a second copy of the tree; scanning them double-counts every finding
  '**/.claude/worktrees/**', '**/*-backup-*/**', '**/.next/**', '**/storybook-static/**',
];

export const DEFAULT_REGISTRY = {
  specVersion: SPEC_VERSION,
  flows: [],
  enforce: { grammar: true, include: ['**'], exclude: DEFAULT_EXCLUDE },
  languages: {},
};

export function findRoot(from = process.cwd()) {
  let dir = resolve(from);
  for (;;) {
    if (existsSync(join(dir, '.forge')) || existsSync(join(dir, '.git'))) return dir;
    const up = resolve(dir, '..');
    if (up === dir) return resolve(from);
    dir = up;
  }
}

export function loadRegistry(root) {
  const path = join(root, '.forge', 'codemap.json');
  if (!existsSync(path)) return { ...DEFAULT_REGISTRY, _missing: true, _path: path };
  let raw;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new Error(`.forge/codemap.json is not valid JSON: ${e.message}`);
  }
  if (raw.specVersion && raw.specVersion !== SPEC_VERSION) {
    throw new Error(
      `registry declares ${raw.specVersion} but this tool implements ${SPEC_VERSION}. ` +
      `Upgrade the plugin, or run: cm migrate --to ${SPEC_VERSION.split('/')[1]}`,
    );
  }
  return {
    ...DEFAULT_REGISTRY,
    ...raw,
    enforce: { ...DEFAULT_REGISTRY.enforce, ...(raw.enforce ?? {}) },
    languages: { ...(raw.languages ?? {}) },
    _path: path,
  };
}

export function saveRegistry(root, reg) {
  const dir = join(root, '.forge');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const { _missing, _path, ...clean } = reg;
  writeFileSync(join(dir, 'codemap.json'), `${JSON.stringify(clean, null, 2)}\n`);
}

const BASELINE = ['.forge', 'codemap-baseline.json'];

export function loadBaseline(root) {
  const p = join(root, ...BASELINE);
  if (!existsSync(p)) return {};
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return {}; }
}

export function saveBaseline(root, counts) {
  const dir = join(root, '.forge');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const sorted = Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(join(root, ...BASELINE), `${JSON.stringify(sorted, null, 2)}\n`);
}

function globToRe(g) {
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*' && g[i + 1] === '*') {
      re += '.*';
      i++;
      if (g[i + 1] === '/') i++;
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else if ('.+^${}()|[]\\'.includes(c)) re += `\\${c}`;
    else re += c;
  }
  return new RegExp(`^${re}$`);
}

export function matcher(globs) {
  const res = globs.map(globToRe);
  return (p) => res.some((re) => re.test(p));
}

export function selects(reg, relPath) {
  const inc = matcher(reg.enforce.include ?? ['**']);
  const exc = matcher(reg.enforce.exclude ?? []);
  return inc(relPath) && !exc(relPath);
}

/** Enforcement is per-language: a Go repo enforces differently from a SQL migration tree. */
export function enforcementFor(reg, prof) {
  const perLang = reg.languages?.[prof.id] ?? {};
  const grammar = perLang.enforce ?? prof.enforce ?? reg.enforce.grammar ?? true;
  return { grammar, docPolicy: perLang.docPolicy ?? prof.docPolicy };
}

const SCAN_EXT = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|vue|svelte|go|php|py|pyi|rs|sql|sh|bash|zsh|ya?ml|toml)$/i;

export function walk(root, reg) {
  const out = [];
  const exc = matcher(reg.enforce.exclude ?? DEFAULT_EXCLUDE);
  (function rec(dir) {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const abs = join(dir, e.name);
      const rel = relative(root, abs).split(sep).join('/');
      if (e.isDirectory()) {
        if (e.name === '.git' || e.name === 'node_modules') continue;
        if (exc(`${rel}/x`)) continue;
        rec(abs);
      } else if (SCAN_EXT.test(e.name) && !exc(rel)) {
        out.push(rel);
      }
    }
  })(root);
  return out.sort();
}

export function changedSince(root, ref) {
  const args = ['-C', root, 'diff', '--name-only', '--diff-filter=ACMR', ref];
  const out = execFileSync('git', args, { encoding: 'utf8' });
  return out.split('\n').map((s) => s.trim()).filter((s) => s && SCAN_EXT.test(s));
}

export function isTracked(root, relPath) {
  return existsSync(join(root, relPath));
}
