# Field data

Three production repos, measured with the shipped checker. They are private, so they appear here as
**Repo A** (Go + Next.js + GraphQL + Liquid, 503k lines), **Repo B** (TypeScript on Hono + Next.js +
Drizzle, 261k lines) and **Repo C** (a large PHP monorepo). Stack and size are what the numbers rest
on; the names are not, and naming other teams' repositories and their file layouts is not this
document's to do.

Every number in the **Measured** tables is printed by `cm` — reproduce them on your own repo with the
commands in [Method](#method). Every number in the
**Projected** tables comes from a hand-read sample and is labelled with its size and error bar.

The distinction is load-bearing. A projected number published as a measured one is how a case study
stops being evidence.

---

## The three headline findings

**1. Comment density is stable across unrelated codebases.** Two repos, different teams, different
languages, 2× apart in size: 5.3% and 5.5% of all source lines are prose comments. That is the size
of the surface this framework governs, and it does not appear to be a property of any one team.

**2. Per-language policy is what makes it survivable.** In 225k lines of Go across 1 121 files,
**zero** comments above exported top-level declarations were flagged. Go's own tooling requires those
and `docPolicy: required-on-exported` leaves every one of them alone. A framework that flagged them
would have been uninstalled the same day.

**3. The edges were already there, written by hand, in prose.** 134 flagged comments in Repo A
name another file in the repo — `(see <other>.go)`, `mirrors <helpers>.go`, `see <module>/lib/…​.ts`
in the original prose. Each is a coupling a developer
found, judged worth recording, and had no formal channel for. They are unreachable: nothing indexes
them, nothing validates them when the target moves, and they only reach a reader who is already in
the right file. That is 134 `cm:edge` declarations the repo has already paid for and cannot spend.

---

## Measured

### Scale

| | Repo A | Repo B |
|---|---|---|
| Stack | Go + Next.js + GraphQL + Liquid | Hono + Next.js + Drizzle |
| Source lines | **503 859** | 261 513 |
| Files enforced | 3 182 | 2 100 |
| Prose lines flagged (CM001) | **27 467** | 13 941 |
| Comment blocks | **13 696** | 6 143 |
| Files affected | 1 689 (53%) | 1 090 (52%) |
| `TODO`/`FIXME` (CM010) | 20 | 14 |
| Over-long module headers (CM011) | 3 | 35 |
| **Prose density** | **5.5%** | **5.3%** |
| Annotations already declared | 71 edges · 102 guards · 3 hacks | 26 edges · 20 guards |

Both repos were onboarded before this measurement, so these are baseline debt figures — what
`cm init` froze and `cm verify` reports on every run.

### Repo A — flagged lines by language

All codes, so these sum to 27 490 rather than the 27 467 CM001 lines above.

| Language | Lines | Blocks | Source lines | Density |
|---|---|---|---|---|
| Go | 16 726 | 7 395 | 225 015 | 7.4% |
| TS + TSX | 9 357 | — | 259 041 | 3.6% |
| JS + MJS | 1 407 | — | 19 803 | 7.1% |
| SQL (525 files) | — | — | — | enforcement off |

By area: backend internals 15 196 · frontend feature modules 7 661 · backend commands 2 865 ·
frontend routes 775.

### Repo A — Go flagged blocks by position

Classified structurally, not by judgement: for each block, the next non-blank line decides the bucket.

| Position of the block | Blocks | Lines | Reading |
|---|---|---|---|
| Above an **exported top-level** declaration | **0** | **0** | ✅ `required-on-exported` is exact — no godoc touched |
| Struct field / interface method | 3 036 | 5 925 | ⚠️ godoc renders these too — see [Known gaps](#known-gaps) |
| Godoc form above an **unexported** declaration | 1 486 | 4 347 | ⚠️ idiomatic Go, flagged by policy |
| Other prose above an unexported declaration | 1 245 | 3 607 | mixed |
| **Narration inside a function body** | 1 628 | 2 833 | 🎯 the spam the framework exists to kill |

The first row is the result worth quoting. The third and fourth rows are the policy question a Go
team has to answer for itself; the framework only forces it to be answered once, in
`.forge/codemap.json`, instead of per pull request.

### Repo A — zero-judgement buckets in TS/TSX

Two shapes need no reading at all to classify:

| Shape | Blocks | Lines |
|---|---|---|
| JSX section labels — `{/* Bulk actions */}`, `{/* Redeem Info */}` | 1 122 | 1 126 |
| Banner rules — `// ===== WEBHOOK QUERIES =====`, `// ── compile ──` | 1 081 | ~1 100 |

Together ~16% of every flagged block in the repo. Repo B, of comparable maturity, has 294
banners and no JSX labels — the difference is team convention, not tooling, which is precisely why a
checker rather than a style guide is the thing that removes them.

### Repo A — latent edges already written in prose

Counted by extracting every filename-shaped token from the flagged text and resolving it against
`git ls-files`. **Strict** requires the reference to resolve to exactly one repo file and not be the
containing file, so a self-referential usage line or an ambiguous `theme.js` does not count.

| | Count |
|---|---|
| Flagged comments naming a source file | 376 |
| **Strictly resolvable, cross-file — latent `cm:edge`** | **134** |
| Naming a Laravel file or the Laravel migration | 58 |

The 58 are a different case and cannot be declared at all — see [Known gaps](#known-gaps).

---

## Projected

Both figures below come from reading sampled comment blocks against their surrounding code and
deciding, per block: delete it, compress it into a one- or two-line `cm:` annotation, or keep it.
Samples are stratified (every *N*th block of a path-sorted list) and were checked against the
population for representativeness before use.

### Repo A

| Language | Sample | Blocks deleted outright | Lines before → after |
|---|---|---|---|
| Go | n=30 | 30% | 77 → 35 (**−55%**) |
| TS/JS | n=25 | 64% | 44 → 21 (**−52%**) |

Extrapolated to the repo: **27 467 → ~12 800 lines**, i.e. **~14 700 lines removed (−53%)** and
~6 200 of 13 696 blocks (45%) gone entirely. Error bar ±10pp.

One caveat that belongs with the number: the Go sample's mean block size is 2.57 lines against a
population mean of 2.26, because the every-*N*th pick caught a 12-line block. The Go line reduction is
therefore optimistic; −50% is the conservative read.

### Repo B

| Scope | Sample | Blocks deleted outright | Lines before → after |
|---|---|---|---|
| Test files | | 71% | 42 → 10 (**−76%**) |
| Source files | | 24% | 71 → 34 (**−52%**) |
| Combined | n=50 | 38% | 113 → 44 (**−61%**) |

Sample mean block size 2.26 against a population mean 2.27.

### What the projections do *not* say

Roughly **45% of the flagged prose in Repo B carries rationale worth keeping**. It is not deleted — it
is compressed into `cm:why` / `cm:guard` / `cm:edge`, which is a format change, not a content loss.
Anyone reading "−61%" as "61% of the comments were worthless" has read it wrong, and the split
between the two is the whole claim: a linter that cannot tell narration from rationale has to ban
both or neither.

The split by file kind is the sharpest signal here. Narrating a mock is derivable; narrating a design
decision is not. Repo B's test files lose 76% of their comment lines and its source files lose 52%,
from one rule applied uniformly.

---

## Two conversions

Neither of these is a deletion. Both are couplings that a developer had already discovered, written
down in prose, and had no formal way to express.

### A cross-file pointer, hand-written in a comment

A Next.js route handler, one of a pair of sibling storefront endpoints

```ts
// RELATIVE redirect path — see the sibling endpoint's route.ts for
// the full rationale (Next.js req.url = internal localhost host, not the
// storefront vhost; an absolute Location would kick the browser to
// localhost:3000 and drop the store subdomain).
function buildRedirectPath(path: string, flag: string): string {
```

```ts
// cm:edge protocol -> app/api/<sibling-endpoint>/route.ts — Next.js req.url is the
//   internal host; an absolute Location drops the store subdomain
function buildRedirectPath(path: string, flag: string): string {
```

Four lines to two, but the saving is not the point. `see <file> for the full rationale` is now data:
`cm impact` returns it, and the `PreToolUse` hook injects it when an agent opens **either** file.
Before, it was prose that only reached a reader who happened to already be in the right file.

### A shared retry contract between two packages

A retry helper in a Go command package

```go
// doWithRetry runs an HTTP request with bounded exponential backoff and returns
// the first response that isn't a transport error or a 5xx (4xx is returned to
// the caller — it won't fix itself on retry). Mirrors the backoff pattern in
// the invalidation package. Use it for the command↔backend control
// calls (authorize, usage) so a transient backend blip doesn't reject a run or
// silently drop usage accounting.
func doWithRetry(...)
```

```go
// cm:edge protocol -> internal/pkg/invalidation/invalidator.go — same bounded-backoff
//   contract: transport errors and 5xx retry, 4xx returns to the caller unretried
func doWithRetry(...)
```

`doWithRetry` is unexported, so the whole run is `CM001` today. Most of it restates the signature and
the body. The load-bearing sentence is the one naming the other package — and after the rewrite,
editing the invalidation package's backoff makes `cm impact` surface this file, which prose never could.

---

## A third data point: PHP

A smoke test on a large PHP (Laravel) monorepo returned **111 findings across every `.php` file** — all
`TODO`/`FIXME`, no docblock touched — against ~73k findings in the same repo's bundled JS/TS assets.
PHPStan, Psalm and Laravel IDE-helper docblocks are load-bearing, so `docPolicy: allowed` leaves them
alone; `vendor/` and `_ide_helper*` are excluded outright.

Three ecosystems, three policies, one checker. That table is `cm help languages`.

---

## Known gaps

Measured while producing this document. Each inflates the flagged count above without being real debt.

| Gap | Measured impact | Status |
|---|---|---|
| Go struct fields and interface methods are not exempt under `required-on-exported`, though godoc renders their docs | 3 036 blocks · 5 925 lines (Repo A) | open — ISS-778 |
| A module header after a `"use client"` / `"use strict"` directive prologue is not recognised as a header (§4.1 allowed only a shebang before it) | 23 blocks (Repo A), 13 (Repo B) | **fixed in 0.4.1** |
| A module header not followed by a blank line is flagged in full — correct per §4.1, but the fix is one blank line and the diagnostic did not say so | 38 blocks · 97 lines (Repo A) | **fixed in 0.4.1** |
| `cm:edge` targets must be repo-relative paths that exist (§4, `CM005`/`CM102`), so a coupling to a system outside the tree cannot be declared at all | 58 flagged lines (Repo A) | open by design — ISS-779 |

Every measurement above was taken on 0.4.0, before any fix. Re-running the two header gaps on 0.4.1:

| | 0.4.0 | 0.4.1 | Removed |
|---|---|---|---|
| Repo A | 27 490 | 27 330 | **160** |
| Repo B | 13 990 | 13 822 | **168** |

Both are larger than the pre-fix estimate (97 and 57) because the estimator only looked for a
directive on the file's very first line, while the real rule also clears a header sitting below a
prologue with blank lines around it. Everything else in this document is unaffected: the fix changes
only which comments are *reported*, and no repo that verified clean now fails.

The Go gap is the largest single bucket in the largest repo measured and remains open — it is a
verdict change across 5 925 lines, which is a spec revision (§6) rather than a patch.

The fourth is the most interesting, because the constraint is deliberate. Repo A is a Go rewrite
of a PHP application, and 354 comments across its Go source pin behaviour to the original —
`Mirrors <PHP model>`, `matches <PHP validator>`. That codebase is not a submodule and not in the
tree. So the repo's single most common cross-system contract is the
one class of coupling `codemap/1` cannot carry, and the framework is silent about it rather than
wrong about it. Widening `<target>` to admit an out-of-tree coordinate would trade `CM102`'s
guarantee — a declared edge always points at something real — for coverage of exactly this case. That
is a spec decision, not a bug fix, and it is unresolved.

---

## The advisory tier, measured (CM301)

`CM301` (§7.1) asks whether a declared coupling has any evidence at the other end. Run on both repos at
`0.9.0`, then again after two structural corrections:

| | Edges | Anchored | CM301 raw | After corrections | Actionable |
|---|---|---|---|---|---|
| Repo B | 67 | 5 | 4 | 3 | 1 |
| Repo A | 137 | 64 | 36 | 2 | 0 |

The corrections were bugs, not thresholds — both fire where evidence *cannot* exist:

- **cross-language pairs**: 26 of Repo A's 36 hits. Go cannot import a `.ts` file, and a `.js` client
  cannot import a `.graphql` schema.
- **Go's import model**: 10 of 10 of its same-language hits. Go names the imported package *directory*, never the file, so a filename-only evidence test warns on every correctly
  wired Go edge.

The one actionable hit is an edge whose anchor is a slug string (`<registry>.ts#<slug-key>`)
— by §5 that coupling is `naming`, not `contract`.

The four remaining false positives are one shape, and it is the interesting result: two sides that must
implement the SAME RULE with nothing linking them — a frontend selectability predicate and the backend
selector it must agree with, the same SQL ordering in two loaders. Those edges carry the most information
in the repo precisely because no type or import connects them. For them, absence of a reference is the
normal state, not drift, which inverts the check's premise. Hence the tier ships off by default.

---

## Method

Everything above is reproducible on any onboarded repo:

```bash
cm verify                      # the debt line: "N distinct still frozen · M cleaned"
cm sweep --json > sweep.json   # every frozen comment: file, line, code, text
```

`sweep.json` gives one record per **line**. Contiguous standalone lines in the same file were folded
into blocks (the unit a human actually deletes) before sampling — the same rule §8 uses for siting.

Source-line denominators come from `git ls-files '<globs>' | xargs wc -l`, excluding `node_modules`
and generated GraphQL output, matching each repo's `enforce.exclude`.

Structural buckets (Go position, JSX labels, banners, header shapes) are computed from the sweep plus
the source line following each block — no judgement involved, so they are reported as measured.

Latent edges are counted by matching filename-shaped tokens in the flagged text against `git ls-files`
and keeping only those that resolve to exactly one file other than the containing one. The loose
count (any basename match) is 376; the strict count reported above is 134.

Sample verdicts are not reproducible by a command; they are one engineer's reading. The sampled
sites, with before → after line counts, are listed below so the reading can be checked.

The sampled sites — file, line, and before → after count for each — are recorded in the project's
own knowledge store rather than here: they are a directory listing of two private codebases, and a
reader outside those repositories cannot check them against anything. What is checkable is the
method above, on your own repo.


---

Measured 2026-08-04 · `cm` 0.4.0 · `codemap/1`, with the 0.4.1 delta noted under
[Known gaps](#known-gaps). Baseline debt falls as these repos are cleaned; re-run the two commands
above rather than trusting these totals to stay current.
