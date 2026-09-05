<div align="center">

# codemap

**Declare the couplings no tool can derive — and hand them to whoever edits the file.**

[![CI](https://github.com/SidCorp-co/codemap/actions/workflows/ci.yml/badge.svg)](https://github.com/SidCorp-co/codemap/actions/workflows/ci.yml)
[![Claude Code Plugin](https://img.shields.io/badge/Claude%20Code-plugin-d97757)](https://docs.claude.com/en/docs/claude-code/plugins)
[![Version](https://img.shields.io/badge/codemap-0.16.1-blue)](plugins/forge-codemap/.claude-plugin/plugin.json)
[![Zero dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)](plugins/forge-codemap/scripts/lib/registry.mjs)
[![License: MIT](https://img.shields.io/badge/License-MIT-green)](LICENSE)

</div>

---

## The problem

An agent edits a file and breaks a condition nobody ever wrote down: *these two files must change
together*, *this call replaces rather than merges*, *break this and the state corrupts*. None of it
is in the types, the tests, or the names — so no tool can warn about it, and an agent has no memory
between sessions.

Banning comments does not help. It creates a vacuum: the noise disappears and the real information
still never shows up.

## What codemap does

LSP derives references. The type system derives shapes. Paths derive modules. git derives history.
**codemap carries the complement, and nothing else** — as one-line `cm:` annotations:

```ts
// cm:guard terminal pipeline_runs.status must route through cascadeCancelChildJobs
// cm:edge  contract -> packages/core/src/pipeline/failure-classifier.ts — bracketed token needs a matching pattern
// cm:flow  job-dispatch/claim-row after:pick-runner — cap gate already passed
```

When an agent is about to edit that file, a `PreToolUse` hook injects what was declared about it:

```
codemap: declared couplings for a.ts that no type-checker or LSP can derive.
GUARD (a.ts:3) — terminal pipeline_runs.status must route through cascadeCancelChildJobs
EDGE contract -> b.ts — bracketed token must have a matching pattern there
FLOW job-dispatch: this file owns claim-row; adjacent steps pick-runner@b.ts:3
```

That inversion is the point: comments stop being **output** (noise) and become **input routing** —
the index that decides what the agent is told before it changes anything. Comment spam stops as a
side effect, from one rule: **if a tool can derive it, you may not write it.**

## Install

```bash
claude plugin marketplace add SidCorp-co/codemap
claude plugin install forge-codemap@forge
```

Zero dependencies — bare `node` ≥ 18, no `npm install`, so the hooks work the moment the plugin is
enabled. Onboarding an existing repository freezes its current comments as a baseline, so `cm verify`
is green on a legacy codebase from the first run:

```bash
cm init      # write .forge/codemap.json and freeze existing comments
cm install   # vendor the checker into .forge/codemap/ — commit it
cm verify    # green immediately, even in a legacy codebase
```

**Full documentation lives in [`plugins/forge-codemap/`](plugins/forge-codemap/README.md).**

| Document | What it covers |
|---|---|
| [`README.md`](plugins/forge-codemap/README.md) | install, onboarding, who enforces, how the baseline drains |
| [`SPEC.md`](plugins/forge-codemap/SPEC.md) | codemap/1 — the annotation grammar and every diagnostic |
| [`NORTH-STAR.md`](plugins/forge-codemap/NORTH-STAR.md) | what this is for, and what may **not** be built |
| [`CASE-STUDY.md`](plugins/forge-codemap/CASE-STUDY.md) | what it caught in a real repository |

## Repository layout

```
codemap/
├── plugins/forge-codemap/       the plugin: CLI, hooks, skill, output style, tests
│   ├── bin/cm                   stable entrypoint — symlink this
│   ├── scripts/                 the checker and the two hooks
│   ├── schema/                  .forge/codemap.json schema
│   ├── agent-setup/             CI templates + the weekly upgrade bot
│   └── tests/                   golden corpus (351 cases)
├── .github/
│   ├── ISSUE_TEMPLATE/          the four feedback forms
│   └── workflows/ci.yml         corpus + self-verify on every push
└── AGENTS.md                    repository rules, including English-only
```

## Feedback

The four forms under [`.github/ISSUE_TEMPLATE/`](.github/ISSUE_TEMPLATE) are the front door: the hook
blocked a valid edit, slop got through, the five annotations cannot express a real constraint, or it
would not install. A wrongly-blocking hook is the most valuable report there is — one that blocks
wrongly gets switched off, and after that it guards nothing.

Read [`NORTH-STAR.md`](plugins/forge-codemap/NORTH-STAR.md) §7 before proposing a feature; it lists
what codemap deliberately will not do.

## History

This repository was previously `forge-pipeline-skills` and also carried a set of nine `forge-*`
pipeline skills. Those are superseded by
[`SidCorp-co/forge-plugin`](https://github.com/SidCorp-co/forge-plugin), whose `issue-flow`,
`dispatch` and `gate-review` skills replace them; the old set remains reachable at the tag
[`pipeline-final`](https://github.com/SidCorp-co/codemap/tree/pipeline-final). The marketplace is
still named `forge`, so `forge-codemap@forge` keeps resolving for every repository that already
installed it.

## License

[MIT](LICENSE) © SidCorp-co
