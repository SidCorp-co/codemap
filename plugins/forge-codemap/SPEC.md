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

- **One line. One annotation.** No continuation lines.
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

The **module header** is the first contiguous comment run of the file — after an optional shebang —
**followed by a blank line**, before any code. It is exempt from `CM001`, up to
`enforce.headerMaxLines` (default 20) lines; beyond that it is `CM011`.

The trailing blank line is the whole test. A comment glued to the first statement is narration, not
a header, and is still `CM001`.

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
| TS/JS/TSX | `//` | `banned`, `/** */` allowed on exports (§4.2) | pragma allowlist covers `@ts-*`, eslint/biome, bundler hints |
| Go | `//` | **`required-on-exported`** | a comment block directly above an exported declaration is exempt — godoc/revive require it |
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

A pre-0.2 count-format baseline is detected, ignored, and reported — never silently trusted.

## §9 Stability

- `specVersion` is checked by every command; a tool older than the registry refuses to run.
- A grammar change ships with a codemod (`cm migrate --to <n>`). Annotations are structured
  single lines, which is what makes codemods cheap.
- `tests/fixtures/` is the golden corpus: source snippet → expected graph and diagnostics.
  Changing the grammar without updating fixtures fails CI. This is the spec's own test suite.
- Deprecation: a removed form warns for one minor with a codemod available before it errors.
- Escape hatch: `cm:ignore <CODE> — <reason>` on the line above. The code and the reason are both
  mandatory; a bare ignore is itself an error.
