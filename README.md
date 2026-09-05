<div align="center">

# codemap

**Declare the couplings no tool can derive — and hand them to whoever edits the file.**

[![CI](https://github.com/SidCorp-co/codemap/actions/workflows/ci.yml/badge.svg)](https://github.com/SidCorp-co/codemap/actions/workflows/ci.yml)
[![Claude Code Plugin](https://img.shields.io/badge/Claude%20Code-plugin-d97757)](https://docs.claude.com/en/docs/claude-code/plugins)
[![Version](https://img.shields.io/badge/codemap-0.18.0-blue)](.claude-plugin/plugin.json)
[![Zero dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)](cli/lib/registry.mjs)
[![License: MIT](https://img.shields.io/badge/License-MIT-green)](LICENSE)

</div>

> **Where this is going:** [`VISION.md`](./VISION.md) — the ceiling.
> **What it will not do:** [`NORTH-STAR.md`](./NORTH-STAR.md) — read §7 before adding a feature.

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
claude plugin marketplace add SidCorp-co/codemap
claude plugin install forge-codemap@forge
```

Enabling the plugin activates its output style automatically (`force-for-plugin`), which **overrides
a personal `outputStyle` choice** while it is enabled. Disable the plugin to get yours back.

Zero dependencies — bare `node` ≥ 18. No `npm install`, so the hooks work the moment the plugin is
enabled.

The plugin is **not** how a repo gets checked — see [Who enforces](#who-enforces). It carries the
skill, the two hooks and a fallback copy of the CLI, nothing more.

For the CLI on your own machine, symlink the wrapper once — it resolves its own location, so it
survives plugin updates:

```bash
ln -s "$(ls -td "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/plugins/cache/*/forge-codemap/*/bin/cm | head -1)" ~/.local/bin/cm
```

Anything that runs `cm` resolves it in one order, and the repo always wins:

```
.forge/codemap/cm   →   cm on PATH   →   the plugin's bundled copy
```

## Onboard a repo

```bash
cm init        # writes .forge/codemap.json and FREEZES existing comments as a baseline
cm install     # vendors cm into .forge/codemap/ — commit it (see "Who enforces" below)
cm verify      # should be green immediately, even in a legacy codebase
```

Legacy is frozen by CONTENT: only a comment whose text is new gets flagged, so reformatting, moving
code and deleting old comments are all free. Legacy is frozen, never migrated — a mass comment
deletion is a separate, reviewable change.

Two things make the total fall, or annotations only ever accrete on top of legacy comments and
onboarding ends with more comments than it started with:

- **the site.** Prose sharing a comment block with a `cm:` annotation is **not** frozen. Annotating a
  site means you have read it, so the noise there is yours to delete.
- **the file** (`CM013`). On a run with a base revision — `cm verify --since <ref>`, or `--staged` —
  a file whose *code* changed while none of its frozen debt fell is asked why the count is still the
  same. One comment deleted or reworded satisfies it. A reflow, a formatter run and a file move all
  cost nothing; so does a whole-tree run, which has no notion of "edited". Off with
  `enforce.drain: false`.

`cm sweep` shows what the baseline is hiding, and `cm verify` prints the remaining debt on every run.

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
cm onboard                 read THIS repo and print the steps for it
cm install [--upgrade] [--git-hook]   vendor cm into .forge/codemap/ so the rules hold with no plugin
cm doctor                  tool vs committed checker, registry, baseline — in one place
cm verify [--since <ref>]   grammar + referential + structural   [--tier T] [--json]
                              [--staged] gate a commit   [--fix] normalize CM009 first
cm fmt                      normalize annotations
cm impact <path>            declared blast radius              [--json]
cm flow [name]              ordered trace                      [--mermaid]
cm ls                       every annotation in the repo
cm sweep [paths...]         list the prose the baseline hides  [--limit N] [--prune-baseline]
cm baseline                 re-freeze legacy comments (by content hash)
cm new flow <name>          declare a flow
cm metrics show [--json]    local counters: blocks held vs circumvented, annotation trend
cm metrics send [--endpoint <url>] [--yes]   opt-in send of the show payload; no --yes previews only
cm codes                    diagnostic reference
cm help [topic]             the guidebook — see below
cm version                  tool version + spec version
```

`cm help` is the guidebook, and it ships **inside the checker** rather than with this plugin, so an
agent or contributor in a vendored repo can always ask instead of guessing. The verb list, diagnostics,
tags, edge kinds, language policies and registry defaults are rendered from the same constants the code
runs on — help cannot drift from behaviour — and `cm help spec [§N]` slices `SPEC.md` itself.

```
cm help topics          annotations · workflow · codes · baseline · languages · config · ci · principles · spec
cm help workflow        what to run before an edit, and how to answer each diagnostic
cm help annotations     the five tags and their exact form
```

A blocked edit ends with a pointer to `cm help workflow`, so the guide arrives at the moment it is
needed rather than at install time.

Exit codes: `0` clean · `1` violations · `2` **the gate could not run** (bad flag, unresolvable
`--since`, path that matches nothing). Never conflate 1 and 2 in CI — 2 means nothing was checked.

## Reading the layer without the hooks

The hooks are the strongest delivery, and they exist in one product. `adapters/mcp/server.mjs` serves
the same answers to any MCP host — Cursor, Codex CLI, Zed, an SDK agent — as five read-only tools
(`codemap_impact`, `codemap_graph`, `codemap_flow`, `codemap_verify`, `codemap_ls`), resolving the
checker in the same order everything else does, so an agent on MCP and CI cannot reach different
verdicts. See [`adapters/mcp/README.md`](adapters/mcp/README.md); the cheapest integration of all
needs no server, only a line in the repo's agent instructions telling it to run `cm impact <file>`
first.

## Who enforces

The plugin is the guide and the edit-time context. The **repo** is the authority:

```bash
cm install                # commit .forge/codemap/ — 14 files, 124K, zero dependencies
cm install --git-hook     # + .git/hooks/pre-commit → cm verify --staged   (per-clone, not committed)
```

| Enforcement point | Command | Needs the plugin |
|---|---|---|
| CI | `.forge/codemap/cm verify --since $(git merge-base origin/main HEAD)` | no |
| pre-commit | `.forge/codemap/cm verify --staged` | no |
| the agent, mid-edit | the plugin's hooks, which drive the same `cm` | yes — and only here |

### Nothing is installed per device

The checker is committed (`cm install`), so a clone has it. The commit hook is committed too —
`.forge/codemap/hooks/pre-commit` — and one line wires it to whatever the team already runs:

| The repo already runs | Wire it with |
|---|---|
| `npm install` / `pnpm install` | `"prepare": "git config core.hooksPath .forge/codemap/hooks"` in `package.json` |
| the `pre-commit` framework | a `repo: local` hook whose `entry` is `.forge/codemap/cm verify --staged --tier grammar` |
| `make setup` | `git config core.hooksPath .forge/codemap/hooks` |

`.git/hooks/pre-commit` (`cm install --git-hook`) still exists, but it is per-clone: a repo whose
only gate lives there is gated on exactly the machines that remembered to run one command.

CI templates that need no runner-side setup beyond a node image: `adapters/ci/gitlab-ci.yml`,
`adapters/ci/codemap-upgrade.yml`.

**The Claude Code plugin is optional and gates nothing.** It adds one thing: injecting a file's
declared couplings into an agent's context before it edits that file, and holding the grammar tier
after. Every check that can fail a commit or a pipeline runs from the committed copy.

### Three ways a repo can run it, and what each costs

| | How | Cost |
|---|---|---|
| **vendored (recommended)** | `cm install`, commit `.forge/codemap/`, CI runs `.forge/codemap/cm verify` | the gate is deterministic and reviewable; you must bump it (`cm install --upgrade`, or the scheduled PR job in `adapters/ci/codemap-upgrade.yml`) |
| **pinned clone** | `git clone --branch codemap-v<x.y.z> … && node …/cli/cm.mjs verify` in CI | same determinism, nothing committed — but nothing local tells you the tag is old, so pin deliberately and revisit it |
| **plugin only** | `claude plugin install forge-codemap@forge` | hooks for whoever installed it; **CI is not gated at all**, and a contributor without the plugin sees no rules |

There is deliberately **no float-to-latest** mode. A checker that changes under CI turns a PR red with
no code change, which is the property the pin exists to protect. Updates should arrive as a PR — the
same answer the dependency ecosystem settled on — and `cm doctor` tells you when you are behind.

`cm` is plain `node` ≥ 18 with zero dependencies, so none of this needs an install step or a package
manager. `adapters/ci/prompt.md` is a fetchable bootstrap for an agent setting a repo up from nothing;
it is generated by `cm onboard --prompt` and a test fails if the two drift.

Without `cm install` a repo carries a registry, a baseline and annotations that only plugin users can
check — so a contributor without the plugin is unconstrained and the next one with it inherits their
violations. `cm install` is what closes that gap; the plugin then only ever adds convenience.

The vendored copy is also a **pin**: a contributor whose plugin is a version ahead or behind cannot
change the verdict on that repo, because the hooks run the repo's copy, not their own.

## How it works

One checker, three triggers. Neither hook decides what a violation is — each shells out to `cm` and
reads the verdict, so the edit-time gate and the CI gate cannot drift apart.

```
PreToolUse  (Edit|Write|MultiEdit|NotebookEdit)
  └─ cm impact <file> --json ──→ additionalContext: guards, edges both ways, adjacent flow steps
                                 never blocks — it only tells the agent what it cannot derive

PostToolUse (Edit|Write|MultiEdit)
  └─ cm verify --fix --json <file>
       ├─ --fix normalizes CM009 in place first (principle 6: the tool owns the format)
       ├─ grammar violation      → block, with the fix line and its §section
       ├─ prose (CM001/CM010/11) → block only if the repo is onboarded AND the baseline is readable
       ├─ nothing                → silent, exit 0
       └─ cm itself failed       → says so; never blocks, never reads as clean

CI / pre-commit
  └─ cm verify [--since <ref> | --staged]  →  0 clean · 1 violations · 2 the gate could not run
```

What the baseline decides, in one place (`cm verify`), for all three: a prose violation is suppressed
when its **text** is already frozen for that file — unless an annotation shares its comment block, in
which case it is reported regardless. A frozen key is dropped only when its text is gone from the file.

## Languages

| Language | Ordinary comments |
|---|---|
| TS/JS | `//` and `/* */` banned; `/** */` doc blocks allowed anywhere (IDE hover docs) |
| Go | `//` above the package clause and exported declarations exempt (godoc/revive) |
| PHP | allowed — PHPStan/Psalm/Laravel docblocks are load-bearing |
| Python | allowed; docstrings are strings, so they are out of scope |
| Rust | `///`, `//!` and `// SAFETY:` exempt |
| SQL, shell, YAML | enforcement off; annotations still collected |

Every compiler and linter pragma is exempt in every language. Generated files are skipped.

## Field data

Three production repos. Everything in this section is printed by the tool — `cm sweep --json` and the
debt line `cm verify` ends with — not counted by hand.

**EpodSystem**, 503k lines of Go + Next.js + GraphQL + Liquid, 3 182 files:

```
27 467 prose lines flagged across 13 696 comment blocks in 1 689 files
    20 TODO/FIXME · 3 over-long module headers
```

Of the 16 726 flagged lines in 225k lines of Go across 1 121 files, **zero** sit above an exported
top-level declaration. `docPolicy: required-on-exported` leaves every godoc comment Go's own tooling
requires exactly where it is. The framework that flags those gets uninstalled the same day; this is
the measurement that says this one does not.

**Forge**, 261k lines of TypeScript, 2 100 files: 13 941 lines across 6 143 blocks in 1 090 files.

Two unrelated codebases, different teams, 2× apart in size — **5.5% and 5.3% prose density**. That
appears to be the size of the surface, not a property of either team.

**A large Laravel monorepo**: 111 findings across every `.php` file (TODOs only — no docblock
touched), against ~73k in the same repo's bundled JS/TS assets. Three ecosystems, three policies, one
checker.

The number that matters most is smaller than any of those. **134 flagged comments in EpodSystem name
another file in the repo** — `(see product_create.go)`, `mirrors audience_helpers.go`,
`see frontend/.../unknown-filters.ts`. Every one is a coupling a developer found, judged worth
recording, and had no formal channel for: nothing indexes them, nothing notices when the target
moves, and they only reach a reader already in the right file. The declared-edge layer is not a new
thing to write. It is a channel for what people are already writing into the void.

What survives matters more than what goes. On hand-read stratified samples (n=55 and n=50, ±10pp),
roughly half the flagged lines compress away — but **~45% carry rationale worth keeping**, and it is
kept, as one- or two-line `cm:` annotations that the hook then injects at edit time. This is a
format, not a comment remover. Test files skew hard the other way (71% of blocks deletable, against
24% in source) because narrating a mock is derivable and narrating a design decision is not.

Full method, per-language breakdown, sampled verdicts and four known gaps in the spec:
[CASE-STUDY.md](CASE-STUDY.md).

### One block, before and after

`frontend/app/api/storefront/blog-comments/route.ts` — a cross-file coupling a developer had already
found, written down, and had no formal way to express:

```ts
// RELATIVE redirect path — see api/storefront/product-reviews/route.ts for
// the full rationale (Next.js req.url = internal localhost host, not the
// storefront vhost; an absolute Location would kick the browser to
// localhost:3000 and drop the store subdomain).
function buildRedirectPath(path: string, flag: string): string {
```

```ts
// cm:edge protocol -> frontend/app/api/storefront/product-reviews/route.ts — Next.js req.url is the
//   internal host; an absolute Location drops the store subdomain
function buildRedirectPath(path: string, flag: string): string {
```

Four lines to two — but the saving is not the point. `see <file> for the full rationale` is now data:
`cm impact` returns it, and the hook injects it when an agent opens **either** file. Before, it was
prose that only reached a reader already in the right file.

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

## Repository layout

The repository root **is** the plugin: what Claude Code installs is this tree.

```
codemap/
├── spec/            SPEC.md + JSON schema — codemap/1, the normative grammar
├── patterns/        the pattern book: when to reach for which tag, with real examples
├── cli/             the engine — cm.mjs, lib/, and the two hook entrypoints (zero dependencies)
├── bin/cm           stable entrypoint — symlink this
├── hooks/           hooks.json: what fires before and after an edit
├── skills/          the codemap skill an agent loads
├── output-styles/   the comment discipline, as an output style
├── adapters/
│   ├── ci/          CI templates + the weekly upgrade bot
│   └── mcp/         MCP server — the layer, for agents that are not Claude Code
└── tests/           the golden corpus (351 cases) and the wiring tiers
```

`plugins/forge-codemap/scripts/cm.mjs` remains as a forwarding shim: every repo that vendored an
older checker has that path hardcoded in its upgrade workflow. It carries a `cm:hack` with the
condition under which it is deleted.

## History

This repository was previously `forge-pipeline-skills` and also carried nine `forge-*` pipeline
skills. They are superseded by [`SidCorp-co/forge-plugin`](https://github.com/SidCorp-co/forge-plugin)
— its `issue-flow`, `dispatch` and `gate-review` skills replace them — and remain reachable at the
tag [`pipeline-final`](https://github.com/SidCorp-co/codemap/tree/pipeline-final). The marketplace is
still named `forge`, so `forge-codemap@forge` keeps resolving.

## License

[MIT](LICENSE) © SidCorp-co
