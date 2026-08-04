# Field data

Three production repos, measured with the shipped checker. Every number in the **Measured** tables is
printed by `cm` — reproduce them with the commands in [Method](#method). Every number in the
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

**3. The edges were already there, written by hand, in prose.** 134 flagged comments in EpodSystem
name another file in the repo — `(see product_create.go)`, `mirrors audience_helpers.go`,
`see frontend/modules/storefront/lib/liquid/unknown-filters.ts`. Each is a coupling a developer
found, judged worth recording, and had no formal channel for. They are unreachable: nothing indexes
them, nothing validates them when the target moves, and they only reach a reader who is already in
the right file. That is 134 `cm:edge` declarations the repo has already paid for and cannot spend.

---

## Measured

### Scale

| | EpodSystem | Forge |
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

### EpodSystem — flagged lines by language

All codes, so these sum to 27 490 rather than the 27 467 CM001 lines above.

| Language | Lines | Blocks | Source lines | Density |
|---|---|---|---|---|
| Go | 16 726 | 7 395 | 225 015 | 7.4% |
| TS + TSX | 9 357 | — | 259 041 | 3.6% |
| JS + MJS | 1 407 | — | 19 803 | 7.1% |
| SQL (525 files) | — | — | — | enforcement off |

By area: `backend-go/internal` 15 196 · `frontend/modules` 7 661 · `backend-go/cmd` 2 865 ·
`frontend/app` 775.

### EpodSystem — Go flagged blocks by position

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

### EpodSystem — zero-judgement buckets in TS/TSX

Two shapes need no reading at all to classify:

| Shape | Blocks | Lines |
|---|---|---|
| JSX section labels — `{/* Bulk actions */}`, `{/* Redeem Info */}` | 1 122 | 1 126 |
| Banner rules — `// ===== WEBHOOK QUERIES =====`, `// ── compile ──` | 1 081 | ~1 100 |

Together ~16% of every flagged block in the repo. Forge, a repo of comparable maturity, has 294
banners and no JSX labels — the difference is team convention, not tooling, which is precisely why a
checker rather than a style guide is the thing that removes them.

### EpodSystem — latent edges already written in prose

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

### EpodSystem

| Language | Sample | Blocks deleted outright | Lines before → after |
|---|---|---|---|
| Go | n=30 | 30% | 77 → 35 (**−55%**) |
| TS/JS | n=25 | 64% | 44 → 21 (**−52%**) |

Extrapolated to the repo: **27 467 → ~12 800 lines**, i.e. **~14 700 lines removed (−53%)** and
~6 200 of 13 696 blocks (45%) gone entirely. Error bar ±10pp.

One caveat that belongs with the number: the Go sample's mean block size is 2.57 lines against a
population mean of 2.26, because the every-*N*th pick caught a 12-line block. The Go line reduction is
therefore optimistic; −50% is the conservative read.

### Forge

| Scope | Sample | Blocks deleted outright | Lines before → after |
|---|---|---|---|
| Test files | | 71% | 42 → 10 (**−76%**) |
| Source files | | 24% | 71 → 34 (**−52%**) |
| Combined | n=50 | 38% | 113 → 44 (**−61%**) |

Sample mean block size 2.26 against a population mean 2.27.

### What the projections do *not* say

Roughly **45% of the flagged prose in Forge carries rationale worth keeping**. It is not deleted — it
is compressed into `cm:why` / `cm:guard` / `cm:edge`, which is a format change, not a content loss.
Anyone reading "−61%" as "61% of the comments were worthless" has read it wrong, and the split
between the two is the whole claim: a linter that cannot tell narration from rationale has to ban
both or neither.

The split by file kind is the sharpest signal here. Narrating a mock is derivable; narrating a design
decision is not. Forge's test files lose 76% of their comment lines and its source files lose 52%,
from one rule applied uniformly.

---

## Two conversions

Neither of these is a deletion. Both are couplings that a developer had already discovered, written
down in prose, and had no formal way to express.

### A cross-file pointer, hand-written in a comment

`frontend/app/api/storefront/blog-comments/route.ts`

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

Four lines to two, but the saving is not the point. `see <file> for the full rationale` is now data:
`cm impact` returns it, and the `PreToolUse` hook injects it when an agent opens **either** file.
Before, it was prose that only reached a reader who happened to already be in the right file.

### A shared retry contract between two packages

`backend-go/cmd/ccrun/retry.go`

```go
// doWithRetry runs an HTTP request with bounded exponential backoff and returns
// the first response that isn't a transport error or a 5xx (4xx is returned to
// the caller — it won't fix itself on retry). Mirrors the backoff pattern in
// internal/pkg/invalidation/invalidator.go. Use it for the ccrun↔backend control
// calls (authorize, usage) so a transient backend blip doesn't reject a run or
// silently drop usage accounting.
func doWithRetry(...)
```

```go
// cm:edge protocol -> backend-go/internal/pkg/invalidation/invalidator.go — same bounded-backoff
//   contract: transport errors and 5xx retry, 4xx returns to the caller unretried
func doWithRetry(...)
```

`doWithRetry` is unexported, so the whole run is `CM001` today. Most of it restates the signature and
the body. The load-bearing sentence is the one naming the other package — and after the rewrite,
editing `invalidator.go`'s backoff makes `cm impact` surface this file, which prose never could.

---

## A third data point: PHP

A smoke test on a large Laravel monorepo returned **111 findings across every `.php` file** — all
`TODO`/`FIXME`, no docblock touched — against ~73k findings in the same repo's bundled JS/TS assets.
PHPStan, Psalm and Laravel IDE-helper docblocks are load-bearing, so `docPolicy: allowed` leaves them
alone; `vendor/` and `_ide_helper*` are excluded outright.

Three ecosystems, three policies, one checker. That table is `cm help languages`.

---

## Known gaps

Measured while producing this document. Each inflates the flagged count above without being real debt.

| Gap | Measured impact | Status |
|---|---|---|
| Go struct fields and interface methods are not exempt under `required-on-exported`, though godoc renders their docs | 3 036 blocks · 5 925 lines (EpodSystem) | open — ISS-778 |
| A module header after a `"use client"` / `"use strict"` directive prologue is not recognised as a header (§4.1 allowed only a shebang before it) | 23 blocks (EpodSystem), 13 (Forge) | **fixed in 0.4.1** |
| A module header not followed by a blank line is flagged in full — correct per §4.1, but the fix is one blank line and the diagnostic did not say so | 38 blocks · 97 lines (EpodSystem) | **fixed in 0.4.1** |
| `cm:edge` targets must be repo-relative paths that exist (§4, `CM005`/`CM102`), so a coupling to a system outside the tree cannot be declared at all | 58 flagged lines (EpodSystem) | open by design — ISS-779 |

Every measurement above was taken on 0.4.0, before any fix. Re-running the two header gaps on 0.4.1:

| | 0.4.0 | 0.4.1 | Removed |
|---|---|---|---|
| EpodSystem | 27 490 | 27 330 | **160** |
| Forge | 13 990 | 13 822 | **168** |

Both are larger than the pre-fix estimate (97 and 57) because the estimator only looked for a
directive on the file's very first line, while the real rule also clears a header sitting below a
prologue with blank lines around it. Everything else in this document is unaffected: the fix changes
only which comments are *reported*, and no repo that verified clean now fails.

The Go gap is the largest single bucket in the largest repo measured and remains open — it is a
verdict change across 5 925 lines, which is a spec revision (§6) rather than a patch.

The fourth is the most interesting, because the constraint is deliberate. EpodSystem is a Go rewrite
of a Laravel application, and 354 comments across its Go source pin behaviour to the PHP original —
`Mirrors Laravel Quote model`, `matches Laravel OrderCompletionValidatorManager`. That codebase is
not a submodule and not in the tree. So the repo's single most common cross-system contract is the
one class of coupling `codemap/1` cannot carry, and the framework is silent about it rather than
wrong about it. Widening `<target>` to admit an out-of-tree coordinate would trade `CM102`'s
guarantee — a declared edge always points at something real — for coverage of exactly this case. That
is a spec decision, not a bug fix, and it is unresolved.

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

<details>
<summary>EpodSystem — Go sample (n=30), lines before → after</summary>

| Site | |
|---|---|
| `cmd/ccbench/main.go:38` | 3 → 2 |
| `cmd/ccrun/prompt.go:1126` | 6 → 2 |
| `cmd/ccrun/serve.go:878` | 4 → 2 |
| `cmd/server/cdc_health.go:31` | 2 → 2 |
| `internal/aiagent/infrastructure/gqlexec/executor_test.go:13` | 2 → 1 |
| `internal/apikeys/usecase/scope_resolver.go:133` | 1 → 1 |
| `internal/campaigns/infrastructure/postgres/stats_repository.go:65` | 4 → 2 |
| `internal/catalog/usecase/product_indexer.go:52` | 4 → 2 |
| `internal/commercetest/e2e_test.go:295` | 3 → 0 |
| `internal/customer/usecase/loyalty_earn.go:69` | 1 → 0 |
| `internal/email_templates/domain/template.go:64` | 2 → 2 |
| `internal/emailevents/usecase/attribution_service.go:69` | 1 → 0 |
| `internal/finance/usecase/cash_transaction_service.go:81` | 1 → 0 |
| `internal/flows/usecase/executors/registry.go:37` | 2 → 2 |
| `internal/inventory/usecase/inventory_csv_service.go:25` | 3 → 2 |
| `internal/marketingtest/e2e_test.go:563` | 1 → 0 |
| `internal/mcp/tools/screenshot.go:32` | 12 → 3 |
| `internal/organization/domain/sitemap.go:186` | 1 → 0 |
| `internal/payment/infrastructure/vnpay/gateway.go:36` | 2 → 1 |
| `internal/pkg/graphql/resolver/attribute.resolvers.go:518` | 2 → 1 |
| `internal/pkg/graphql/resolver/helpers.go:42` | 1 → 0 |
| `internal/pkg/graphql/resolver/resolver.go:215` | 1 → 1 |
| `internal/pkg/graphql/resolver/storefront_sitemap.go:252` | 4 → 2 |
| `internal/pos/domain/shift.go:58` | 1 → 0 |
| `internal/sales/module.go:15` | 1 → 0 |
| `internal/sales/usecase/order_payment.go:126` | 1 → 1 |
| `internal/tracking/usecase/forwarder.go:78` | 1 → 1 |
| `internal/webstore/domain/themelint/mockup.go:70` | 3 → 2 |
| `internal/webstore/domain/themelint/themelint_test.go:406` | 2 → 1 |
| `internal/webstore/usecase/mockup_skeleton.go:449` | 5 → 2 |
| **Total** | **77 → 35** |

</details>

<details>
<summary>EpodSystem — TS/JS sample (n=25), lines before → after</summary>

| Site | |
|---|---|
| `backend-go/cmd/ccrun/mockup-shot.mjs:1` | 8 → 8 |
| `backend-go/internal/webstore/infrastructure/seeders/tailwind/build.mjs:200` | 1 → 0 |
| `backend-go/internal/webstore/themes/fastionee/assets/theme.js:1816` | 1 → 0 |
| `frontend/app/[locale]/admin/stores/[storeId]/online-store/domains/page.tsx:3` | 6 → 3 |
| `frontend/app/api/storefront/blog-comments/route.ts:82` | 4 → 2 |
| `frontend/e2e/admin/flows-execution.spec.ts:55` | 1 → 0 |
| `frontend/lib/email-context.ts:393` | 1 → 0 |
| `frontend/modules/ai-chat/lib/chat-mapping.ts:72` | 1 → 0 |
| `frontend/modules/ai-chat/useClaudeCodeStream.ts:1024` | 1 → 1 |
| `frontend/modules/attributes/hooks/useAttributes.ts:21` | 1 → 1 |
| `frontend/modules/email-templates/components/TemplateCard.tsx:207` | 1 → 1 |
| `frontend/modules/inventory/graphql/queries.ts:471` | 1 → 0 |
| `frontend/modules/marketing/components/CouponListTable.tsx:177` | 1 → 0 |
| `frontend/modules/organizations/index.ts:8` | 1 → 0 |
| `frontend/modules/page-builder/components/ThemeEditor/ThemeSettingsPanel.tsx:688` | 1 → 0 |
| `frontend/modules/page-builder/lib/css-generator.ts:461` | 1 → 0 |
| `frontend/modules/page-builder/lib/template/hydrate-behaviors.ts:405` | 1 → 0 |
| `frontend/modules/pos/__tests__/ProductCard.test.tsx:218` | 1 → 0 |
| `frontend/modules/pos/components/loyalty/LoyaltyPointsCard.tsx:279` | 1 → 0 |
| `frontend/modules/pos/hooks/useCart.ts:152` | 1 → 0 |
| `frontend/modules/products/components/ProductForm/index.tsx:494` | 1 → 0 |
| `frontend/modules/storefront/editor/ThemeCustomizer.tsx:1243` | 1 → 1 |
| `frontend/modules/storefront/lib/data/fetch-shop.ts:47` | 3 → 2 |
| `frontend/modules/stores/components/BrandingSettings.tsx:86` | 3 → 2 |
| `frontend/modules/webhooks/graphql/queries.ts:3` | 1 → 0 |
| **Total** | **44 → 21** |

</details>

---

Measured 2026-08-04 · `cm` 0.4.0 · `codemap/1`, with the 0.4.1 delta noted under
[Known gaps](#known-gaps). Baseline debt falls as these repos are cleaned; re-run the two commands
above rather than trusting these totals to stay current.
