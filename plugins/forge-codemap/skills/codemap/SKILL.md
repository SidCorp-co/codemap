---
name: codemap
description: Query and maintain the codemap/1 declared-edge layer — impact analysis beyond LSP, flow traces, annotation validation. Use when asked what a change affects, what a flow touches, to declare a coupling or flow, to validate/normalize cm: annotations, to onboard a repo onto codemap, or when a CM0xx/CM1xx/CM2xx diagnostic needs resolving. Triggers: impact of this change, what does this touch, blast radius, trace the flow, cm:edge, cm:guard, cm:flow, codemap, comment convention.
---

# CodeMap

`cm:` annotations carry the couplings **no tool can derive** — cross-language contracts,
cross-process flows, edit-time invariants. LSP keeps its job (references, symbols); this layer is
strictly the complement.

**The tool carries its own guidebook — ask it, do not guess.** It is rendered from the constants the
checker actually runs on, so it cannot be out of date, and it works in a repo that never installed
this plugin:

```bash
cm help                 # what it is, where it runs, every verb, the topic list
cm help workflow        # what to run before an edit, and how to answer each diagnostic
cm help annotations     # the five tags and their exact form
cm help codes           # every diagnostic: tier, section, cause, fix
cm help baseline        # how legacy prose is frozen, and how the total falls
cm help config          # .forge/codemap.json knobs and the three adoption modes
cm help ci              # exit codes (0/1/2), scoping, pre-commit
cm help spec [§N]       # the contract itself, sliced out of SPEC.md
```

Read `cm help workflow` before resolving a CM0xx you have not seen before, and `cm help annotations`
before writing one. Everything below is the short version of those two.

## Running the CLI

Resolve it once per session, then reuse `$CM`. **The repo's own copy wins** — a project that ran
`cm install` is pinned to that copy, and its CI, its pre-commit hook and the edit hooks all use it, so
anything you check with a different one can disagree with the gate the change has to pass.

```bash
CM=""
[ -x .forge/codemap/cm ] && CM=./.forge/codemap/cm                       # the repo's own, pinned copy
[ -z "$CM" ] && command -v cm >/dev/null 2>&1 && CM=cm
# last resort: this session's plugin cache. A Forge runner sets CLAUDE_CONFIG_DIR to an isolated
# directory, so globbing ~/.claude finds either nothing or a different install than the loaded one.
[ -z "$CM" ] && CM="node $(ls -td "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/plugins/cache/*/forge-codemap/*/scripts/cm.mjs 2>/dev/null | head -1)"
$CM verify
```

If that resolves to nothing, the plugin is not installed for this user — say so rather than
guessing a path. A one-time `ln -s <plugin>/bin/cm ~/.local/bin/cm` makes `cm` available directly.

Exit codes matter when you script it: `0` clean, `1` violations, `2` the gate could not run at all
(bad flag, unresolvable `--since`, path matching nothing). Never report a 2 as a pass.

| Verb | Use |
|---|---|
| `cm impact <path>` | before changing a file: guards, edges both directions, flow steps and their neighbours |
| `cm flow [name] [--mermaid]` | ordered trace across languages; mermaid for a living sequence diagram |
| `cm verify [--since <ref>]` | all three tiers; `--since HEAD~1` in CI, `--staged` for a commit |
| `cm fmt` | normalize annotations (the tool owns the format) |
| `cm ls` | every annotation in the repo |
| `cm init` / `cm baseline` | onboard a repo; freeze its legacy comments |
| `cm install [--git-hook]` | vendor cm into `.forge/codemap/` so the rules hold with no plugin |
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

`cm init` writes the registry and freezes existing prose comments as a baseline **by content hash**, so
a legacy codebase starts green and only a comment whose *text* is new gets flagged — reformatting,
moving code and deleting legacy comments are all free. Do not mass-delete legacy comments; that is a
separate, reviewable change.

Then `cm install`, and commit `.forge/codemap/`. Without it the repo's rules only exist for people who
have this plugin: CI cannot check them, and a contributor without the plugin leaves violations for the
next one who has it. Offer `--git-hook` for a local `pre-commit` gate (per-clone, never committed).

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

## What is not a fix for CM001

Three moves look like resolutions and are not, and each now reports itself:

- **prefixing prose with a tag.** `cm:why Load the config` is the same non-fact wearing a label, and the
  words still count as debt. `cm verify --tier advisory` names it (`CM302`). Delete the sentence, or
  rewrite it to say the thing that is not derivable.
- **`cm baseline`.** It is an operator decision about inherited debt, not a step in resolving a
  diagnostic. It refuses to freeze a comment that is not in `git HEAD`.
- **`cm sweep --prune-baseline`.** Bookkeeping only; it never absolves a comment that is still in the file.

The two real resolutions are deleting the comment and converting it into an annotation whose text says
something the compiler, the types, the path and the LSP cannot state.

`CM013` is the rule that makes those two happen on inherited debt rather than only on new prose: on a
run with a base revision, a file whose code changed while none of its frozen debt fell is asked why.
It is the only grammar code the edit hook does not raise — the unit is a change, so it holds at the
commit (`--staged`) and the PR (`--since <ref>`). Reflow, formatter runs and file moves cost nothing.
See `cm help baseline`.
