---
name: codemap
description: Query and maintain the codemap/1 declared-edge layer — impact analysis beyond LSP, flow traces, annotation validation. Use when asked what a change affects, what a flow touches, to declare a coupling or flow, to validate/normalize cm: annotations, to onboard a repo onto codemap, or when a CM0xx/CM1xx/CM2xx diagnostic needs resolving. Triggers: impact of this change, what does this touch, blast radius, trace the flow, cm:edge, cm:guard, cm:flow, codemap, comment convention.
---

# CodeMap

`cm:` annotations carry the couplings **no tool can derive** — cross-language contracts,
cross-process flows, edit-time invariants. LSP keeps its job (references, symbols); this layer is
strictly the complement. The full contract is `SPEC.md` beside this skill's plugin root.

## Running the CLI

Resolve it once per session, then reuse `$CM`. A `cm` on `PATH` wins; otherwise take the
newest installed plugin copy (the cache keeps one directory per version, so never hardcode one).

```bash
CM=cm
command -v cm >/dev/null 2>&1 || \
  CM="node $(ls -td "$HOME"/.claude/plugins/cache/*/forge-codemap/*/scripts/cm.mjs 2>/dev/null | head -1)"
$CM verify
```

If that resolves to nothing, the plugin is not installed for this user — say so rather than
guessing a path. A one-time `ln -s <plugin>/bin/cm ~/.local/bin/cm` makes `cm` available directly.

| Verb | Use |
|---|---|
| `cm impact <path>` | before changing a file: guards, edges both directions, flow steps and their neighbours |
| `cm flow [name] [--mermaid]` | ordered trace across languages; mermaid for a living sequence diagram |
| `cm verify [--since <ref>]` | all three tiers; `--since HEAD~1` in CI |
| `cm fmt` | normalize annotations (the tool owns the format) |
| `cm ls` | every annotation in the repo |
| `cm init` / `cm baseline` | onboard a repo; freeze its legacy comments |
| `cm new flow <name>` | declare a flow before annotating its steps |
| `cm codes` | diagnostic reference |

## Answering "what does this change affect?"

1. `cm impact <path>` — the declared couplings.
2. LSP references for the symbols involved — the derivable half.
3. Report the union. Say explicitly which came from declarations and which from the LSP; a reader
   needs to know which half is a human promise and which is compiler truth.

## Adding an annotation

Only when a tool cannot derive it. Pick by consumer, not by taste:

| You know | Annotation |
|---|---|
| whoever edits this must obey a condition | `cm:guard <text>` |
| a coupling nothing links | `cm:edge <kind> -> <path> — <why>` |
| this code is a step of a named runtime flow | `cm:flow <flow>/<step> [after:<step>] — <text>` |
| a live workaround with an exit condition | `cm:hack ISS-<n> until:<cond> — <text>` |
| non-obvious rationale, no tool consumes it | `cm:why <text>` |

`cm:flow` requires the flow to exist in `.forge/codemap.json` first (`cm new flow`). Steps are
never declared in the registry — they are derived from the code.

## Onboarding a repo

`cm init` writes the registry and freezes existing prose comments as a baseline, so a legacy
codebase starts green and only fails when a file's comment count *rises*. Do not mass-delete legacy
comments; that is a separate, reviewable change.

Then annotate from evidence, not from a sweep: take the couplings that have already caused a manual
intervention or a broken deploy, and declare those. A flow nobody has been burned by does not earn
its annotations yet.

## Fixing diagnostics

Every code has a fix line and a `SPEC.md` section — `cm codes` lists them. Two that get argued with:

- **CM001** — the answer is almost always to delete the comment. Convert it only if it records
  something genuinely non-derivable.
- **CM010** — do not convert a `TODO` into `cm:hack` to silence it. If the work is outstanding but
  not yet done, file an issue at `draft`. `cm:hack` is for a workaround that is in the code now.

Last resort: `cm:ignore <CODE> — <reason>` on the line above. Both the code and the reason are
mandatory.
