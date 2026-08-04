# codemap/1 — specification

The contract. Every validator message cites a section here.

## §1 Purpose

Carry the **complement of what tools can derive**. LSP derives references; the type system
derives shapes; paths derive modules; git derives history. CodeMap carries only what none of
them can see: cross-language contracts, cross-process flows, and edit-time invariants.

Corollary (§1.1): **if a tool can derive it, you may not write it.** `// Load the config` is not
ugly — it is *invalid*, because the compiler already knows.

## §2 Principles

| # | Principle | Failure mode it kills |
|---|---|---|
| 1 | An annotation kind exists only if a tool consumes it and the payoff lands in the same session | conventions rotting into noise |
| 2 | Derivable ⇒ forbidden (§1.1) | comment spam, duplicating the compiler |
| 3 | Closed vocabulary; unknown value is an error, never a warning | typos, silent graph drift |
| 4 | One obvious place per annotation (§4) | bikeshedding, duplicates |
| 5 | Never load-bearing — delete every annotation and the program is unchanged | comments becoming untested code |
| 6 | The tool owns the format (`cm fmt`), not the author | model output drift breaking the parser |
| 7 | Adoption is incremental; legacy is baselined, not migrated | big-bang rollout abandoned |
| 8 | Every diagnostic has a code, a cause, a fix, and a §pointer | validator gets switched off |

## §3 Vocabulary

Exactly five tags. The set is the size of the set of distinct consumers.

| Tag | Consumer | Purpose |
|---|---|---|
| `cm:flow` | `cm flow` → ordered trace + mermaid | membership in a named runtime flow that spans files/languages/processes |
| `cm:edge` | `cm impact` → blast radius | a coupling no analyzer links |
| `cm:guard` | `PreToolUse` → injected before an edit | invariant or edit rule whoever touches this must know |
| `cm:hack` | `cm verify` → stale-workaround check | temporary workaround with an exit condition |
| `cm:why` | none (read in place) | non-obvious rationale; exists to keep the `cm:guard` channel free of prose |

`cm:invariant` and `cm:gotcha` do **not** exist: their consumer is identical to `cm:guard`'s
(tell whoever touches this), so principle 4 merges them.

`cm:todo` does **not** exist: the issue tracker is the authority on outstanding work, and a
tracked TODO in code is a second, non-authoritative copy of that state. Introducing a new
`TODO`/`FIXME` is `CM010`; file an issue at `draft` instead.

## §4 Syntax

```
<leader> cm:flow  <flow>/<step> [after:<step>] [— <text>]
<leader> cm:edge  <kind> -> <target> [— <text>]
<leader> cm:guard <text>
<leader> cm:hack  ISS-<n> until:<condition> — <text>
<leader> cm:why   <text>
```

- **One line. One annotation.** The machine-parsed part — tag, kind, target, `after:`, `until:` —
  must fit on the annotation's own line; nothing after it is parsed.
- **A wrap is one line, not a paragraph.** The single standalone line comment directly below an
  annotation, under the same leader, is its continuation: exempt from prose enforcement, and not
  merged into the annotation's text (so `canonical` and `cm fmt` never rewrite across lines). A
  second such line is prose again — and, sharing the block, is sited (§8), so it cannot be frozen.
  Without this, every wrapped annotation in the wild is a hidden `CM001` that the baseline freezes
  forever, which is how an annotation layer ends up *adding* comments.
- **Line comments only.** Never inside a block or doc comment (`/* */`, `/** */`, `///`, `//!`,
  `{{-- --}}`) — that is `CM003`. Rationale: block/doc comments are parsed by TSDoc, PHPStan,
  Psalm, and rustdoc; staying out of them means no other toolchain ever sees a `cm:` line.
- `<leader>` is the language's line-comment leader: `//`, `#`, or `--` (§6).
- `<flow>/<step>` is the step's durable id. Ordering comes from `after:`, never from numbers, so
  inserting a step never renumbers the flow.
- `<kind>` ∈ `contract | ordering | lockstep | sideeffect | naming | protocol` (§5).
- `<target>` is a repo-relative path, optionally `path#symbol`. Absolute paths and URLs are `CM005`.
- `->` is ASCII (it sits in the machine-parsed position). `—` separates prose; `-` and `--` are
  accepted on input and normalized to `—` by `cm fmt`.
- Prefix is `cm:` — deliberately **not** `@`-prefixed. The `@`-in-comment namespace belongs to
  compilers and doc parsers (`@ts-expect-error`, `@param`, `@flow` is Flow's own file pragma).

Single recognizer:

```
^\s*(//|#|--)\s*cm:(flow|edge|guard|hack|why)\b
```

Because the recognizer keys on a line *starting* with `cm:`, prose that happens to wrap onto a line
beginning with `cm:` parses as a malformed annotation. Reword such a line; do not escape it.

### §4.1 The module header

Orientation prose about a whole file is not derivable, and every ecosystem gives it a home (Go's
package doc, Rust's `//!`, Python's module docstring). TypeScript has no idiom, which is exactly why
agents scatter narration through function bodies instead. So there is **one** legal place for it:

The **module header** is the first contiguous comment run of the file — after an optional shebang and
an optional directive prologue — **followed by a blank line**, before any code. It is exempt from
`CM001`, up to `enforce.headerMaxLines` (default 20) lines; beyond that it is `CM011`.

The **directive prologue** is `"use client"`, `"use server"` or `"use strict"` in TS/JS: constructs
the language itself requires above everything else, so a header cannot get above them. Measured on a
Next.js App Router codebase, treating them as code cost 23 legitimate headers. The vocabulary is
closed (principle 3) — a general "leading string literal" rule would swallow an expression statement.

The trailing blank line is the whole test. A comment glued to the first statement is narration, not
a header, and is still `CM001` — but when that run sits at the top of the file it is one blank line
away from being legal, so the diagnostic's fix line says so instead of only offering deletion.

Multi-line rationale belongs in the header. One-line rationale at a call site belongs in `cm:why`.

### §4.2 Doc comments

A `/** … */` block is documentation **by form** — the IDE surfaces it on hover, a consumer with an
immediate payoff — so it is exempt wherever it appears. A `/* … */` block is not a doc comment and is
prose. Narration inside a function body, the spam this framework exists to kill, is always a line
comment.

The first cut of this rule exempted doc blocks only directly above an `export`, and it flagged JSDoc
on interface members within the hour. Deciding which declarations *deserve* documentation is not the
framework's business; distinguishing documentation from narration is.

Go is the exception, via `docPolicy: required-on-exported`: it has no block-doc form, so the same
distinction has to be made positionally on `//` runs.

## §5 Edge kinds

| Kind | Means | Example |
|---|---|---|
| `contract` | two sides must agree on a value/format neither type-checks | Rust emits `[USAGE_LIMIT]`, a TS regex must match it |
| `ordering` | A must happen before B, and nothing enforces it | deploy core before runner |
| `lockstep` | these files must change in the same commit | three desktop version files |
| `sideeffect` | effect happens outside this language | DB trigger, cron, queue worker |
| `naming` | coupling is a *name*, not a reference | config map keys ↔ skill names ↔ enum values |
| `protocol` | call semantics not visible in the signature | PATCH replaces the whole map, not a deep merge |

## §6 Language profiles

`docPolicy` decides what happens to ordinary doc comments; it is what makes the framework
survive contact with ecosystems whose convention is the opposite of "few comments".

| Language | Leaders | docPolicy | Notes |
|---|---|---|---|
| TS/JS/TSX | `//` | `banned` for `//` and `/* */`; `/** */` doc blocks allowed (§4.2) | pragma allowlist covers `@ts-*`, eslint/biome, bundler hints |
| Go | `//` | **`required-on-exported`** | only a comment run directly above the package clause or an EXPORTED declaration is exempt — godoc/revive require it there |
| PHP | `//` `#` | `allowed` | PHPStan/Psalm/Laravel IDE-helper docblocks are load-bearing; `_ide_helper*` and `vendor/` are excluded outright |
| Python | `#` | `allowed` | docstrings are strings, not comments, so they are out of scope by construction |
| Rust | `//` | `allowed` for `///`/`//!` | `// SAFETY:` is exempt (clippy requires it) |
| SQL | `--` | `allowed`, enforcement off | annotations still parsed, so `sideeffect` edges can live next to a trigger |
| Shell/YAML/TOML | `#` | `allowed`, enforcement off | annotations parsed for CI/compose edges |

A file whose first lines mark it generated (`Code generated ... DO NOT EDIT`, `@generated`,
drizzle/`_ide_helper` markers) is skipped entirely.

## §7 Diagnostics

Tier decides where it runs: **grammar** in `PostToolUse` (blocking), **referential** and
**structural** in CI.

| Code | Tier | Meaning |
|---|---|---|
| `CM001` | grammar | prose comment where `docPolicy: banned` — delete it, or convert to `cm:why`/`cm:guard` if it records something non-derivable |
| `CM002` | grammar | unknown `cm:` tag (§3) |
| `CM003` | grammar | `cm:` annotation inside a block/doc comment (§4) |
| `CM004` | grammar | `cm:edge` missing or unknown `<kind>` (§5) |
| `CM005` | grammar | `cm:edge` target missing, absolute, or a URL (§4) |
| `CM006` | grammar | `cm:flow` needs `<flow>/<step>` (§4) |
| `CM007` | grammar | `cm:hack` needs `ISS-<n>` and `until:<condition>` (§4) |
| `CM008` | grammar | annotation body empty |
| `CM009` | grammar | non-normalized form — `cm fmt` fixes it |
| `CM010` | grammar | new `TODO`/`FIXME` introduced (§3). Marker-shaped only — at the start of a comment, or followed by `:`/`(` — so identifiers like `TC-XXX` are not flagged |
| `CM011` | grammar | module header longer than `headerMaxLines` (§4.1) |
| `CM101` | referential | flow not declared in the registry (§8) |
| `CM102` | referential | `cm:edge` target does not exist |
| `CM103` | referential | `after:` names a step that does not exist |
| `CM105` | referential | duplicate `<flow>/<step>` id |
| `CM201` | structural | flow has a single step — either it is not a flow, or steps are missing |
| `CM202` | structural | `after:` chain is cyclic or the flow has several roots |
| `CM104` | reserved | stale `cm:hack` (issue closed) — requires the Forge integration, tier 3 |

## §8 Registry

`.forge/codemap.json`, JSON so it parses with zero dependencies and validates against
`schema/codemap.schema.json`.

```json
{
  "specVersion": "codemap/1",
  "flows": [{ "name": "job-dispatch", "description": "issue → dispatched job" }],
  "enforce": { "grammar": true, "include": ["**"], "exclude": ["**/*.test.ts"] },
  "languages": { "sql": { "enforce": false } }
}
```

Steps are **not** declared — they are derived from the code (§1.1). The registry only closes the
vocabulary of flow *names*.

### §8.1 Where the checker lives

The registry is the repo's contract, so the repo must be able to check it. `cm install` vendors the CLI
into `.forge/codemap/` — a `cm` shim, `cm.mjs`, `lib/`, `SPEC.md` and a `VERSION` stamp — and that
directory is committed. From then on:

| Enforcement point | Runs | Needs the plugin |
|---|---|---|
| CI | `.forge/codemap/cm verify --since <base>` | no |
| pre-commit | `.forge/codemap/cm verify --staged` (`cm install --git-hook`) | no |
| the agent, mid-edit | plugin hooks, which **prefer** `.forge/codemap/cm.mjs` | yes, and only for this |

The plugin is therefore the guide and the edit-time UX, never the authority. A repo pinned to an older
vendored copy keeps that copy's verdicts, and a contributor without the plugin is held to exactly what
CI holds them to — the asymmetry that used to leave one contributor unconstrained and hand the next one
their violations.

`.forge/codemap/**` is excluded from scanning unconditionally, not via the registry's `exclude` list: a
project onboarded by an older `cm init` carries that list frozen in its file.

**No registry ⇒ prose enforcement is off.** The `cm verify` CLI still reports `CM001`/`CM010` so an
operator can size the problem before onboarding, but the edit hook blocks only on malformed
annotations (`CM002`–`CM008`). Prose enforcement begins at `cm init`, which also writes the baseline.

That asymmetry is deliberate: the plugin can be installed once, machine-wide, across every repo, and
no un-onboarded legacy tree is ever blocked. Onboarding is a per-repo decision, not a side effect of
installing.

`.forge/codemap-baseline.json` freezes pre-existing prose **by content**: per file, the set of
hashes of the normalized comment texts. A violation is suppressed when its text is already in that
set, so legacy code is frozen rather than migrated (principle 7). Regenerate with `cm baseline`.

The first design counted comments per file and failed on contact: adding three lines to a file with
eighty frozen comments surfaced all eighty, because a count cannot say *which* comment is new. The
content hash can. It is also line-independent, so reformatting, moving code, and deleting legacy
comments are all free.

A pre-0.2 count-format baseline is detected, ignored, and reported — never silently trusted. While it is
unreadable, prose is **not** enforced at all: nothing can tell new prose from legacy, so blocking an
author for a comment they did not write is the wrong half of the trade. The edit hook says so instead.

A frozen key is dropped only when its text is **gone from the file**. Sited prose (below) is still in the
file, so it stays frozen: it is reported anyway, and the annotation that sited it may be removed later.

**Sited prose is never frozen.** A `CM001`/`CM010` violation sharing a comment block with a `cm:`
annotation is reported regardless of the baseline. Contiguous standalone comment lines form one
block; a trailing comment on a code line is not part of one. `CM011` is excluded — it measures a
header's length, not one comment's text, so no site can own it.

Without this exception the baseline has no path that ever reduces: legacy prose is spared forever,
annotations only accrete, and a repo ends with more comments than before onboarding. The rule is
narrow on purpose — an author who annotates a site has just read it, so the noise there is theirs;
prose they never touched stays frozen. `cm sweep` lists what the baseline is hiding, and
`cm sweep --prune-baseline` drops keys matching nothing, so paid-off debt stops being counted.

## §9 Stability

### §9.1 Exit codes

| Code | Means |
|---|---|
| 0 | the gate ran; nothing but structural warnings |
| 1 | the gate ran and found violations |
| 2 | **the gate could not run** — bad flag, unknown `--tier`, unresolvable `--since`, path that matches nothing |

The 1/2 split is load-bearing. Every fail-open bug this tool has shipped had the same shape: a broken
invocation that produced an empty scope and a green summary — a mistyped `--tier` value silently dropping
every diagnostic, an unresolvable ref exiting 1 from a raw stack trace so CI could not tell it from a lint
failure, a mistyped path scanning zero files. A scope that cannot be computed is never an empty scope.

A diagnostic must also be *fixable by its own fix line*. `CM009`'s fix is `cm fmt`, so `cm fmt` may never
report a rewrite it did not perform (it once could not rewrite a CRLF line at all, and said it had).

- `specVersion` is checked by every command; a tool older than the registry refuses to run.
- A grammar change ships with a codemod (`cm migrate --to <n>`). Annotations are structured
  single lines, which is what makes codemods cheap.
- `tests/fixtures/` is the golden corpus: source snippet → expected graph and diagnostics.
  Changing the grammar without updating fixtures fails CI. This is the spec's own test suite.
- Deprecation: a removed form warns for one minor with a codemod available before it errors.
- Escape hatch: `cm:ignore <CODE> — <reason>` on the line above. The code and the reason are both
  mandatory; a bare ignore is itself an error.
