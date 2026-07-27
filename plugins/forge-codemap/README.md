# Forge CodeMap

A **declared-edge layer** for source code, plus the comment discipline that keeps it clean.

LSP derives references. The type system derives shapes. Paths derive modules. CodeMap carries only
what none of them can see — and hands it to the agent at the moment it edits the file.

```ts
// cm:guard terminal pipeline_runs.status must route through cascadeCancelChildJobs
// cm:edge  contract -> packages/core/src/pipeline/failure-classifier.ts — bracketed token needs a matching pattern
// cm:flow  job-dispatch/claim-row after:pick-runner — cap gate already passed
```

When an agent is about to edit that file, a `PreToolUse` hook injects:

```
codemap: declared couplings for a.ts that no type-checker or LSP can derive.
GUARD (a.ts:3) — terminal pipeline_runs.status must route through cascadeCancelChildJobs
EDGE contract -> b.ts — bracketed token must have a matching pattern there
FLOW job-dispatch: this file owns claim-row; adjacent steps pick-runner@b.ts:3
```

That inversion is the point: comments stop being **output** (noise) and become **input routing** —
the index that decides what the agent is told, before it changes anything.

Killing comment spam is a side effect. The rule that produces it: **if a tool can derive it, you may
not write it.** `// Load the config` is not ugly, it is invalid — the compiler already knows.

## Install

```bash
claude plugin marketplace add SidCorp-co/forge-pipeline-skills
claude plugin install forge-codemap@forge
```

Enabling the plugin activates its output style automatically (`force-for-plugin`), which **overrides
a personal `outputStyle` choice** while it is enabled. Disable the plugin to get yours back.

Zero dependencies — bare `node` ≥ 18. No `npm install`, so the hooks work the moment the plugin is
enabled.

For the CLI, symlink the wrapper once — it resolves its own location, so it survives plugin updates:

```bash
ln -s "$(ls -td ~/.claude/plugins/cache/*/forge-codemap/*/bin/cm | head -1)" ~/.local/bin/cm
```

In CI, skip the plugin entirely and run the script straight from a shallow clone:

```yaml
- run: git clone --depth 1 https://github.com/SidCorp-co/forge-pipeline-skills /tmp/fps
- run: node /tmp/fps/plugins/forge-codemap/scripts/cm.mjs verify
```

## Onboard a repo

```bash
cm init        # writes .forge/codemap.json and FREEZES existing comments as a baseline
cm verify      # should be green immediately, even in a legacy codebase
```

A file fails only when its prose-comment count *rises*. Legacy is frozen, never migrated — a
mass comment deletion is a separate, reviewable change.

Then annotate **from evidence**: take the couplings that have already caused a manual intervention
or a broken deploy and declare those. A flow nobody has been burned by has not earned its
annotations yet.

## The five annotations

| Tag | Consumer | For |
|---|---|---|
| `cm:flow <flow>/<step> [after:<step>]` | `cm flow` → trace + mermaid | a step of a named runtime flow spanning files/languages/processes |
| `cm:edge <kind> -> <target>` | `cm impact` → blast radius | a coupling nothing links |
| `cm:guard <text>` | `PreToolUse` → injected before an edit | an invariant whoever touches this must obey |
| `cm:hack ISS-<n> until:<cond>` | `cm verify` → stale-workaround check | a live workaround with an exit condition |
| `cm:why <text>` | none — read in place | one-line rationale; keeps the guard channel free of prose |

Edge kinds: `contract` · `ordering` · `lockstep` · `sideeffect` · `naming` · `protocol`.

There is no `cm:todo`. The tracker owns outstanding work; a TODO in code is a stale second copy of
that state.

## Commands

```
cm init                     onboard a repo (registry + baseline)
cm verify [--since <ref>]   grammar + referential + structural   [--tier T] [--json]
cm fmt                      normalize annotations
cm impact <path>            declared blast radius              [--json]
cm flow [name]              ordered trace                      [--mermaid]
cm ls                       every annotation in the repo
cm baseline                 re-freeze legacy comment counts
cm new flow <name>          declare a flow
cm codes                    diagnostic reference
```

CI: `cm verify --since $(git merge-base origin/main HEAD)`.

## Languages

| Language | Ordinary comments |
|---|---|
| TS/JS | banned; `/** */` allowed on exports (IDE hover docs) |
| Go | `//` above the package clause and exported declarations exempt (godoc/revive) |
| PHP | allowed — PHPStan/Psalm/Laravel docblocks are load-bearing |
| Python | allowed; docstrings are strings, so they are out of scope |
| Rust | `///`, `//!` and `// SAFETY:` exempt |
| SQL, shell, YAML | enforcement off; annotations still collected |

Every compiler and linter pragma is exempt in every language. Generated files are skipped.

Real numbers from a smoke test on a large Laravel monorepo: 111 findings across all `.php` files
(TODOs only — no docblock was touched), against ~73k in its bundled JS/TS assets. The per-language
profile is what makes that difference, and it is why the framework survives being installed.

## Adoption tiers

| Tier | What | Payoff |
|---|---|---|
| T0 | grammar + fmt + hook | comment spam stops. Works in any repo with no config |
| T1 | `cm:edge` + `cm:guard` + injection | agents learn couplings no tool can derive |
| T2 | `cm:flow` + registry + `impact`/`flow` | living sequence diagrams, blast radius |
| T3 | sync to Forge knowledge, cross-check `cm:hack` against issue status | self-feeding loop |

T1 is useful without T2. Start at T0 today.

## Contract

[`SPEC.md`](SPEC.md) is `codemap/1` — principles, grammar, language profiles, every diagnostic with
a fix. `tests/run.mjs` is the spec's own test suite (`node tests/run.mjs`); changing the grammar
without updating `tests/cases.mjs` fails it.
