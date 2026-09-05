# codemap — north star

> A **principled** comment system for the facts no tool can derive — plus a checker that reads them,
> and a hook that hands them to the agent **before** it edits the file.

**This document exists to stop goal drift.** The ceiling this serves is [`VISION.md`](./VISION.md);
where the two disagree, this one wins.

**Read §2 and §7 before adding any feature.** A proposal that cannot be traced back to a pain in §2
is a proposal that gets refused.

Updated 2026-09-06. Siblings: [`VISION.md`](./VISION.md) (the ceiling) · `spec/SPEC.md` (mechanism) ·
`README.md` (usage) · `patterns/` (which tag, and when) ·
`~/tools/repo-gates/NORTH-STAR.md` (index of the four products).

---

## 1. The question it answers

The same question archmap, apiflow and KineTrak answer — on different material:

> **"If I change this, what else is affected?"** — answered **before the edit**, not after the break.

codemap's material: **the constraints that live only in someone's head.**

## 2. Whose pain, and what the pain is

**Who:** the person who has to review agent-written code, and keeps meeting the same class of bug.

**The pain is NOT** "missing documentation", and it is not "the code is hard to read".

**The pain is:** an agent edits a file and breaks a condition **nobody ever wrote down** — of the
kind *"these two files must change together"*, *"break this condition and state corrupts"*, *"this
call replaces rather than merges"*, *"this call order is mandatory"*. None of that is in the types,
in the tests, or in the function names. Before codemap it lived in one person's head — and an agent
has no memory between sessions.

**The second pain, rarely named:** agents write redundant comments. Using a linter to **ban** them
only produces a vacuum — the energy disappears and the real information still never shows up.

## 3. What makes it different from what already exists

| What exists | Why it cannot replace this |
|---|---|
| type system / compiler | states the *shape of data*, never *these two files must change together* |
| linter (eslint, biome…) | works inside **one file's** AST; has no cross-file edge |
| LSP / go-to-definition | sees real references, blind to coupling that **is not a reference** (strings, names, SQL, cron) |
| doc / ADR / wiki | nobody reads it at the moment they are about to edit that file |
| a lint rule banning comments | creates a vacuum, not information |

**Its correct position in one sentence:** it is not a stricter linter — it **redirects** the agent's
urge to write comments into a **data layer** that can be read, checked, queried, and injected back
into the next agent. It turns the cost of comments into an asset.

Five places are allowed: `cm:guard` · `cm:edge` · `cm:flow` · `cm:hack` · `cm:why`. Everything else
is an ordinary comment, and an ordinary comment may not restate what a tool already derives.

## 4. The evidence today (measured 2026-08-19)

On the forge repo (`cm verify --tier referential`, exit 0):
```
2350 files scanned
 494 cm:guard
 408 cm:why
 181 cm:edge   (21 anchored)
   2 cm:flow
   1 cm:hack
13410 legacy prose frozen · 3 cleared (0%)
```

**The 13,410 / 1,086 ratio is the progress measure for the redirection** — it measures comment
*quality*, not volume, and it is measurable today without anyone outside.

Maturity: **290 tests green** · 18 verbs · 8 language profiles (ts/go/php/py/rust/sql/sh/yaml) ·
`tests/cli.mjs` is 687 lines of end-to-end tests · 1 self-declared stub (`cm migrate`, exit 2) ·
installed in **15 internal repos** (re-measured 2026-09-02 — see §10) ·
carries **both `PreToolUse` and `PostToolUse`** — the only one of the four products at tier 1.

CM301/CM302 (advisory) are still **off by default** — `enforce.advisory` in the registry, or an
explicit `--tier advisory`, remains the only gate; the presence of archmap does not switch the tier
on by itself (`archmap graph` costs ~15s on a 1600+ file repo, and the hook runs `cm verify`
tier=all on EVERY file edit — auto-enabling on archmap was measured to stall the edit by seconds
each time, and was reverted). When the tier is enabled by hand, it reads `archmap graph --json` as
real evidence instead of comparing filenames. Re-measured against a real archmap (repo `forge`,
1905 files): 6 pre-existing CM301 hits, **0** additionally eliminated by the real graph — matching
the hand analysis already in SPEC §7.1 (all 6 are couplings with no real reference). Not promoted to
`error` yet — per the roadmap in §8.

## 5. North star

> **The number of repos NOT owned by the author in which somebody wrote a `cm:` annotation by hand.**

It cannot be gamed: writing more code does not make a stranger adopt a new vocabulary. It is the only
test of the real question — *is this primitive right, or is it only right for the person who thought
of it.*

| Horizon | Target |
|---|---|
| 30 days | not counted — this phase measures leading indicators only |
| 90 days | **1 outside repo**, ≥1 annotation written by somebody else |
| 12 months | **10 outside repos**, each with ≥5 annotations written by somebody else |

**Leading indicators (achievable alone):**
1. Internal repos carrying codemap: **5 → 15 — done 2026-09-02** (ISS-4), though the honest split is
   **6 vendored (own baseline) / 9 plugins-advisory (no baseline yet)** — one of the nine was already
   at the plugins tier BEFORE ISS-4, not vendored, so "7 pre-existing" was the old count and has been
   corrected. The count measures reach, not effect — §5 still measures effect separately, by
   annotations outsiders write. "Every repo has its own baseline" (ISS-4's intended outcome) holds
   for only 6/15 — see §10 and the tracking issues there for the remaining 9.
2. The weekly upgrade bot demonstrably running, with logs, **4 weeks in a row** (it died silently for
   an unknown stretch — see the decision log).
3. Legacy prose falling while `cm:` annotations rise — measurable: `cm metrics show` (SPEC.md §10,
   ISS-3).
4. CM301 reading a real archmap graph when the tier is enabled — **done** (§8 Phase 2); defaulting it
   to `warn` still waits on a cache layer for `archmap graph` (~15s a call), because the hook invokes
   `cm verify` on every file edit.
5. How often the hook blocks, on which check, and whether that block held or was circumvented —
   measured locally, sending is opt-in: `cm metrics show` / `cm metrics send` (SPEC.md §10). Before
   ISS-3 there was no way to count this at all; every piece of evidence in §4 is reach, not effect.

## 6. Kill criteria

12 months with **0 annotations written by outsiders** → this is one person's internal convention, not
a product. Keep using it internally, withdraw it from the public list, stop investing in
distribution. **Do not defend it by writing more documentation.**

## 7. What this will not do

- **Not become a general-purpose linter.** A rule expressible as a linter rule belongs to the linter
  (tiers 2–3), not to `cm:`. See the tier ladder in `~/tools/repo-gates/PLAYBOOK.md` §B2.
- **Not break the zero-dependency constraint.** `cli/lib/registry.mjs:3-4` states the reason:
  *"a plugin that needs `npm install` before its hooks work is a plugin that gets disabled."* This is
  a condition of existence, not a preference.
- **Not merge with eslint-plugin-code-quality.** That one needs a peer dependency on `eslint` —
  merging breaks the rule above. The two stand side by side; they do not fuse.
- **Not build a unified layer over codemap + archmap.** That is gatemap: dead twice (v1 on 2026-08-13,
  rejected by four independent reviews; v2 on 2026-08-19, killed by PLAYBOOK §D after two hours).
- **Not enable the advisory tier before the FP rate is measured.** Criterion borrowed from
  Google/Tricorder: enter at `warn`, promote to `error` when FP is under threshold **and** the
  findings are back to zero.
- **Not write more README.** 311 lines is already more than enough for the current user count.

## 8. Roadmap for this repo

**Phase 0 — stop the bleeding**
- Confirm the weekly upgrade bot really runs once, with a log — **done 2026-09-03 (ISS-5)**, but not
  the way the brief assumed: the bot was not dead, **the tag stream it reads had stopped flowing**.
  Details in §9. The rest of the brief — "4 weeks in a row" (§5 leading indicator #2) — could not be
  measured from that session, since it requires observing 4 real runs in consumer repos, outside that
  issue's write scope.

**Phase 1 — distribution** *(codemap goes first among the four products)*
- **Its own repo — done 2026-09-06.** `SidCorp-co/codemap` now carries codemap and nothing else: the
  pipeline skill set (86 bundle files, 32 skills, 26 profiles) was deleted because
  `SidCorp-co/forge-plugin` supersedes it, and it remains reachable at the tag `pipeline-final`. Both
  consequences that used to block Phase 1 are now open:
  1. The four feedback forms moved up to `.github/ISSUE_TEMPLATE/` at the repo root — the only place
     GitHub reads them.
  2. The inbox now holds codemap alone, so *"1 issue from a stranger"* is attributable to codemap and
     can serve as a gate.
- Rollout 5 → 15 internal repos via `forge_config` → `plugin_sync.rs:89` — **done 2026-09-02** (ISS-4,
  details in §10). The `plugins` tier only opens visibility (advisory, no blocking); the
  vendored/gated tier — `cm init` freezing a baseline, then committing `.forge/codemap/` — is left to
  a dedicated issue in each repo, and was not done from ISS-4.
- Public. Unlock archmap when **1 issue/PR from a stranger** arrives.

**Phase 2 — the joint worth making** *(graph reading and FP measurement done; `warn` by default still
waits on a cache)*
- `graph.mjs` used to confess: *"Evidence is a basename match, not an import graph"* — CM301 guessed
  whether a coupling was real **by comparing filenames**. Fixed: `cli/lib/archmap.mjs` reads
  `archmap graph --json` when the advisory tier is enabled; the real graph is asked BEFORE the
  basename, and the check still runs unchanged where archmap is absent.
- Measured against a real archmap instead of guessed: 0 of the 6 re-measured hits on the `forge` repo
  were eliminated by the real graph — all 6 really are couplings without a reference (SPEC §7.1).
- **Still not enabled by default.** Auto-enabling it when archmap is present (bypassing
  `enforce.advisory`) was measured to stall EVERY file edit by ~15s, because the hook calls
  `cm verify` tier=all with no `--tier`, and `archmap graph` is a whole-repo scan. Reverted to the
  original gate (`enforce.advisory`, or an explicit `--tier advisory`); auto-enabling needs a cache
  layer for archmap first, left for later. Not promoted to `error`.
- Lower priority, still open: de-duplicate the shared layer (`globToRe` ×2, `findRoot` ×2,
  install/vendor ~270 lines ×2) between codemap and archmap — pure cleanup, blocking nothing above.

## 9. Decision log

- **2026-08-19** — Positioning settled: *redirect* comments rather than *ban* them. This is the most
  misread point; every product description must lead with this before mentioning the checker.
- **2026-08-19** — Going public settled. Order: codemap first, because it is the most complete and its
  distribution channel already runs for real.
- **2026-08-19** — gatemap v2 killed; the gap between codemap and archmap is **deliberate**.
- **~2026-08** — Discovered the weekly upgrade bot had died silently (`node20` forced off). Fixed,
  **not yet confirmed running again**.
- **2026-09-03 (ISS-5)** — Confirmed, and the cause differed from the initial hypothesis. The `forge`
  repo (vendored, measured directly on that project's checkout) sat at `0.13.0` while `plugin.json`
  here already said `0.14.0` and then `0.15.0` — those two bumps (253d315, ba42a5f) **shipped without
  a matching `codemap-v*` tag**, unlike every bump before them (each of which always had a tag on the
  exact commit). The bot resolves "latest" with `git tag -l codemap-v* | sort -V | tail -1` — with no
  tag it has nothing to fetch, and that silence is indistinguishable from "already up to date". Three
  fixes: (1) cut `codemap-v0.14.0` / `codemap-v0.15.0` on the two bump commits and pushed them to
  origin; (2) re-ran the exact command sequence of `adapters/ci/codemap-upgrade.yml` (public clone →
  fetch tags → resolve latest → checkout → `cm install --upgrade`) against a simulated vendored repo
  at `0.13.0` — real result: `codemap 0.13.0 -> 0.15.0 in .forge/codemap/ 19 files`, which is the
  "one observable run" the brief demanded; (3) added `tests/release-tag.mjs` — `node tests/run.mjs`
  now fails if `plugin.json` bumps its version while the matching tag does not exist, so this hole
  cannot reopen silently.
  **The independent review round caught a second, heavier real defect:** the install step of
  `adapters/ci/codemap-upgrade.yml` itself wrote `cd /tmp/codemap && git checkout ...` followed by
  `cm.mjs install --upgrade` on the next line of the **same `run:` block** — that `cd` leaks into the
  next line, so `cm install` (which has no `--root` flag and always vendors into `$(pwd)`) vendored
  into the throwaway clone instead of the checked-out consumer repo. The PR came out empty, silently,
  on EVERY run — regardless of whether a newer tag existed. The `forge` repo had found and patched
  exactly this in its own copy (switching to `git -C`, and recording it in a comment in that file),
  but the patch **was never carried back to the template here** — meaning every repo that copies the
  template from here (the 9 `plugins`-tier repos in §10) would hit the very bug `forge` had already
  fixed. Fixed: both steps switched to `git -C /tmp/codemap` (matching `forge`'s patch), plus
  `tests/upgrade-workflow.mjs` — which runs **that exact `run:` block**, cut straight from the yml
  file, against a simulated repo, to confirm it vendors into the right place; the test went red when
  the `cd` version was temporarily restored to verify it catches the real bug, then green after the
  patch.
  **Still open, outside this issue's scope:** the `forge` repo itself needs to re-run its own workflow
  (or wait for next Monday's cron) for its vendored copy to actually reach `0.15.0` — this issue could
  only fix the tag source and the template, with no write access to the `forge` repo.
- **2026-09-02** (ISS-4) — Re-measured before installing: the "5" in §4 was stale; the reality was
  6 vendored + 1 plugins-advisory (installed outside this issue) = 7 repos carrying codemap in some
  form, not 7 vendored as the first draft of this log wrongly recorded. The rollout of
  8 new repos in ISS-4 reached only the `forge_config.plugins` tier (advisory) — the vendored/gated
  tier (which requires `cm init` to freeze a baseline inside each repo) was not done from that
  session, because ISS-4 had no worktree in those repos, and pushing code to another project's main
  branch from an issue owned by `codemap` crosses an ownership boundary. Instead: one tracking issue
  was opened IN each owning project at the plugins tier (9 issues: the 8 new repos plus the one that
  predated ISS-4) so that `cm init` / `cm install` / wiring the gate happen inside the owning
  project, with that project's review.

## 10. Rollout log (ISS-4, measured 2026-09-02)

**Aggregate, because the detail is not this file's to publish.** The per-repository table — which
internal repositories carry codemap, which checks each has switched off and why, and the tracking
issue opened in each — lives in the project's own knowledge store under
`codemap-rollout-log-internal`. Naming other teams' repositories and the gates they have disabled is
not evidence of anything a reader here needs, and it is not this project's information to hand out.

| Tier | Count | What it means |
|---|---|---|
| vendored | **6** | `.forge/codemap/` committed + a blocking gate in CI; legacy prose frozen into that repo's own baseline |
| plugins (advisory) | **9** | designated through `forge_config.plugins` only — the hooks run, but with no `cm init` there is no baseline, so the block-on-prose branch disables itself and only `cm impact` plus annotation-syntax blocking remain |
| **total** | **15** | the 5 → 15 figure in §5, measured 2026-09-02 |

Of the 9 at the plugins tier, 8 were added by ISS-4 and 1 predates it. Every one of them has a
tracking issue open **inside its owning project**, each asking for the same three things: `cm init`
to freeze a baseline, `cm install` to vendor and pin the checker, then wiring `cm verify` into that
repo's CI gate. That split is deliberate: ISS-4 had no worktree in those repositories, and pushing to
another project's main branch from an issue owned by `codemap` crosses an ownership boundary.

Four repositories were excluded from every batch with a recorded reason rather than skipped silently:
one is a repo-less storefront with no module boundary to annotate, three have no real repository path
on their project yet, one is a subdirectory of a tree already installed at its root, and one lives
outside the fleet whose hook reviewers can be identified. Eight more are valid candidates deferred
only because the 5 → 15 mark was already met.

**The caveat that must travel with these numbers.** "Every repository has its own baseline" — ISS-4's
own brief — holds for **6 of 15**, the vendored tier. The 9 at the plugins tier have no baseline yet,
exactly as "measure first, install second" intends: nothing is unlocked before it is measured. That
is a designed gap with issues against it, not a hidden one. And the count itself is **reach, not
effect** — §5 measures effect separately, by annotations that people outside this project write.

**ISS-6 status (picked up 2026-09-06, not closed).** The 0.17.0 path move landed the same day the
issue was picked up, so none of the six vendored-tier repositories could have migrated their upgrade
workflow to `cli/cm.mjs` yet, and deleting the forwarding shim now would strand all six on a
hardcoded path with nothing behind it — the ISS-5 failure class exactly. One tracking issue was
opened in each of the six instead; they are listed, by repository, in the same knowledge entry as the
rest of the detail. The shim at `plugins/forge-codemap/scripts/cm.mjs` and its `cm:hack` stay until
all six land. Before re-opening this work, read those six issues' status — do not file duplicates.
