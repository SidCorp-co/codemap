# codemap — north star

> A **principled** comment system for the facts no tool can derive — plus a checker that reads them,
> and a hook that hands them to the agent **before** it edits the file.

**This document exists to stop goal drift.** The ceiling this serves is [`VISION.md`](./VISION.md);
where the two disagree, this one wins.

**Read §2 and §7 before adding any feature.** A proposal that cannot be traced back to a pain in §2
is a proposal that gets refused.

Updated 2026-09-08. Siblings: [`VISION.md`](./VISION.md) (the ceiling) · `spec/SPEC.md` (mechanism) ·
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

Maturity: **465 tests green** · 20 verbs · 8 language profiles (ts/go/php/py/rust/sql/sh/yaml) ·
`tests/cli.mjs` is 687 lines of end-to-end tests · 1 self-declared stub (`cm migrate`, exit 2) ·
installed in **15 internal repos**, a floor (re-measured 2026-09-08 — see §10) ·
carries **both `PreToolUse` and `PostToolUse`** — the only one of the four products at tier 1.

CM301/CM302/CM303 (advisory) are still **off by default** — `enforce.advisory` in the registry, or an
explicit `--tier advisory`, remains the only gate; the presence of archmap does not switch the tier
on by itself (`archmap graph` costs ~15s on a 1600+ file repo, and the hook runs `cm verify`
tier=all on EVERY file edit — auto-enabling on archmap was measured to stall the edit by seconds
each time, and was reverted). When the tier is enabled by hand, it reads `archmap graph --json` as
real evidence instead of comparing filenames. Re-measured against a real archmap (repo `forge`,
1905 files): 6 pre-existing CM301 hits, **0** additionally eliminated by the real graph — matching
the hand analysis already in SPEC §7.1 (all 6 are couplings with no real reference). Not promoted to
`error` yet — per the roadmap in §8. **Updated 2026-09-06 (ISS-14):** the presence of archmap now
DOES switch the tier on, once its graph is cached — see §5 leading indicator 4 and §8 Phase 2.

**Updated 2026-09-08 (ISS-8):** the tier gains `CM303` — an annotation that cites its incident and
then retells it — and `cm mass` gives the volume axis its first number: comment characters by channel,
whole tree, no base revision, so the tail no verb could reach is measurable without anyone editing it.
Measured on repo `forge`: 77 KB of story across 314 annotations, 6% of a 1,332 KB annotation channel;
its false-positive rate is 17-31%, measured by hand on two trees, which is why it only warns.
`CM303` enters at `advisory` on that measurement and the audit behind it — SPEC §7.1, §11.

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
1. Internal repos carrying codemap: **5 → 15 — done 2026-09-02** (ISS-4). Re-measured 2026-09-08
   (ISS-23), the split is **10 vendored (own baseline + a blocking gate) / 3 committed but ungated /
   2 plugins-advisory**, against the 6 / 9 recorded on 2026-09-02. Most of that move is real growth
   rather than a correction: four repositories wired a blocking gate after the first measurement. The
   6 itself was arithmetically right; what was wrong was its *membership*, by two errors that happened
   to cancel — one repo counted vendored that has never run a gate, and one gated since 2026-08-04
   filed under advisory. The total did not move, so the reach figure here did not move either: it was
   already a floor and still is, because only the fleet's local checkouts are counted. The count
   measures reach, not effect — §5 still measures effect separately, by annotations outsiders write.
   "Every repo has its own baseline" (ISS-4's intended outcome) now holds for **13 of 15**: the three
   ungated repositories froze a baseline and vendored a checker, and only the CI gate is
   outstanding — see §10, and the knowledge entry for the tracking issues on the remaining 5.
2. The weekly upgrade bot demonstrably running, with logs, **4 weeks in a row** (it died silently for
   an unknown stretch — see the decision log).
3. Legacy prose falling while `cm:` annotations rise — measurable: `cm metrics show` (SPEC.md §10,
   ISS-3).
4. CM301 reading a real archmap graph when the tier is enabled — **done** (§8 Phase 2). The cache
   layer `archmap graph` (~15s a call) was waiting on — **done 2026-09-06 (ISS-14)**: a fingerprint-
   keyed cache plus a detached background refresh means a bare `cm verify` (what the hook runs on
   every edit) now auto-enables the tier once archmap is vendored, reading the cache in ~50ms
   (measured on the `forge` repo, 2345 files) instead of running the ~15s scan inline. Promoting the
   tier itself from advisory to `warn` was decided **2026-09-06 (ISS-15): stays at advisory** — the
   measured false-positive rate does not clear the entry bar; see §9 decision log.
5. How often the hook blocks, on which check, and whether that block held or was circumvented —
   measured locally, sending is opt-in: `cm metrics show` / `cm metrics send` (SPEC.md §10). Before
   ISS-3 there was no way to count this at all; every piece of evidence in §4 is reach, not effect.
   **Done 2026-09-06 (ISS-13):** that measure was still per-code, never per-annotation — "every
   number rising while the value is zero" (VISION §3.3) applied just as much to `cm:` annotations
   themselves as to file/annotation/test counts. `cm metrics annotations` now joins a held/
   circumvented event back onto the declared annotation at its exact `(file, line)`, off data the
   gate already collected — no new event stream.

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

**Phase 2 — the joint worth making** *(graph reading, FP measurement, the cache and the
`warn`-by-default decision all done — §9)*
- `graph.mjs` used to confess: *"Evidence is a basename match, not an import graph"* — CM301 guessed
  whether a coupling was real **by comparing filenames**. Fixed: `cli/lib/archmap.mjs` reads
  `archmap graph --json` when the advisory tier is enabled; the real graph is asked BEFORE the
  basename, and the check still runs unchanged where archmap is absent.
- Measured against a real archmap instead of guessed: 0 of the 6 re-measured hits on the `forge` repo
  were eliminated by the real graph — all 6 really are couplings without a reference (SPEC §7.1).
- **Auto-enabling on presence, done 2026-09-06 (ISS-14).** Auto-enabling it when archmap is present
  (bypassing `enforce.advisory`) was measured to stall EVERY file edit by ~15s, because the hook
  calls `cm verify` tier=all with no `--tier`, and `archmap graph` is a whole-repo scan — reverted at
  the time to the original gate (`enforce.advisory`, or an explicit `--tier advisory`), leaving
  auto-enabling for once a cache layer existed. It now does: a fingerprint keyed off `HEAD` plus the
  small dirty-file set (never a timer, never the whole tree) gates a `.forge/.codemap-archmap-cache/`
  read; a miss returns no evidence for that edit and schedules the ~15s scan on a detached,
  unref'd child so the edit itself never waits on it. Measured on the `forge` repo (2345 files): the
  hot path (fingerprint + cache read) is ~50ms, against the ~15s the inline scan cost — the bare
  `cm verify` the hook runs now auto-enables CM301 wherever archmap is vendored, `enforce.advisory`
  unset. An explicit `enforce.advisory: false` still opts a repo out. **Decided 2026-09-06 (ISS-15):
  stays at advisory, not promoted to `warn`** — see §9. `error` needs findings at zero first and
  stays out of scope.
- Lower priority, still open: de-duplicate the shared layer (`globToRe` ×2, `findRoot` ×2,
  install/vendor ~270 lines ×2) between codemap and archmap — pure cleanup, blocking nothing above.

**Phase 3 — federation** *(VISION rung 3, ISS-17)*
- Design drafted and prototyped, not shipped: `spec/FEDERATION.md`. A federated edge is `external:`
  (ISS-16) with a stronger far side — the target is another git repository, not an opaque name, so
  it can be checked against real, current content (shallow `git fetch` + `git show`, no daemon, no
  new dependency) instead of trusted blind. Prototyped against the real coupling this repo already
  has on `archmap` (`cli/lib/archmap.mjs` depends on `archmap graph --json`'s shape) and against
  archmap's own real repository — not a fixture. Still open: the grammar, the registry, the
  `federated` tier and `cm federate check` itself, and the harder "B is told the moment B breaks it"
  direction, which needs its own measurement before it is decided. See the design for what a
  follow-up implementation issue should scope first.

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
  template from here (9 repositories at the advisory tier when this was written; §10 carries the
  current split) would hit the very bug `forge` had already
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
- **2026-09-06 (ISS-15)** — CM301's promotion decided: **stays at `advisory`, does not enter at
  `warn` by default.** Measured on two repos in different language mixes — `EpodSystem` (Go +
  TS/JS): 137 contract/lockstep-with-symbol edges, 64 anchored, 36 raw `CM301` hits, 2 after the
  two structural corrections already live in `cli/lib/graph.mjs` (the same-language-family guard
  and the Go directory-name evidence), 0 actionable; `Forge` (TS/JS): 67 edges, 5 anchored, 4 raw,
  3 after corrections, 1 "actionable" whose real kind is `naming` not `contract` (§5), so not a
  genuine `CM301` finding either. Re-measured with a real archmap import graph on a third repo
  (`forge`, 1905 files): 6 pre-existing hits, **0** suppressed by the real graph — confirming the
  remaining hits are not an evidence-quality bug. Across every measurement to date, **0** genuine
  actionable findings: every surviving hit is the same shape, two sides that must implement the
  same rule with nothing linking them, where absence of a reference is the normal state, not
  drift (SPEC §7.1). That shape did not shrink when evidence quality went up (basename match →
  real graph), so it is not measurement noise the cache or a better graph will fix — entering at
  `warn` would fire on a legitimate pattern, not on drift. No code changed: the existing
  auto-enable-when-archmap-vendored mechanism (ISS-14) and `enforce.advisory` opt-out are
  unaffected. Re-open only with a new measurement that finds a genuine missing-reference case
  `CM301` caught, not with renewed confidence in this same data.
- **2026-09-06 (ISS-21)** — Consumers are now told, not just polled.
  `.github/workflows/notify-consumers.yml` fires on every `codemap-v*` tag push and calls
  `workflow_dispatch` on each vendored-tier consumer's own `codemap-upgrade.yml`, cutting the
  worst-case ~7 day wait (§0, measured the same day) down to minutes for any consumer it can reach.
  **How far that reaches, re-measured 2026-09-08 (ISS-23): one repository.** Of the 10 now at the
  vendored tier, exactly one has a `codemap-upgrade.yml` to dispatch — the same finding ISS-6
  landed on from the other direction (§10 below). The mechanism is right and costs nothing idle,
  but until consumers take the upgrade workflow it is a fast path for one repository, not ten.
  `workflow_dispatch` was chosen over `repository_dispatch`: the shipped template
  already listens for `workflow_dispatch`, so this needs no change inside any consumer, unlike
  `repository_dispatch`, which every consumer's own workflow would first have to opt into. The
  credential this needed, as flagged when the issue was filed: one PAT, stored here as
  `CONSUMER_DISPATCH_TOKEN`, scoped to `actions: write` on every listed consumer. The consumer
  list itself lives in a second secret, `VENDORED_CONSUMERS` (JSON), not in tracked source — the
  same reason §10 keeps other teams' repository names in the internal knowledge store rather than
  in this public file. **One job, one step, on purpose:** an earlier draft split parsing the
  secret into its own job and passed the result to a second job's matrix as a job *output* — but
  the runner treats a job output that matches a registered secret as unmaskable and drops it
  entirely rather than redacting it, so the moment the secret held a real value the second job
  received an empty string and failed at matrix setup, breaking exactly the "must not fail the tag
  push" rule this issue exists to satisfy. Collapsing to one script that reads the secret and loops
  in bash keeps the parsed value inside the one step that has it. The same collapse also drops the
  per-consumer job/step name a matrix would have templated from `matrix.consumer.repo` — this
  repo's Actions log is public, and a step titled with another team's repository name would have
  handed out exactly what §10 already keeps out of this tree; the log now reports only a
  dispatched/failed count. A consumer that 404s (private, archived, not yet in the secret, or
  simply missing its `repo` field) is caught per-entry in that loop and never aborts the script or
  fails the tag push that triggered it; it just stays on its Monday cron, same as before this
  issue. Both secrets start unset, by design: a not-yet-configured secret parses to an empty
  consumer list rather than failing the workflow, so shipping the mechanism cannot itself break a
  release.
- **2026-09-08 (ISS-23)** — The rollout tiers re-measured, and the method changed so the next reader
  does not have to trust the number. Thirteen repositories carry a committed checker, 10 of them
  behind a blocking gate, against the 6 / 9 recorded on 2026-09-02. **Most of that is growth, not a
  correction** — four repositories wired a gate after the measurement, and six of the thirteen first
  committed a checker the day after it. The recorded 6 was arithmetically right; its membership was
  wrong by two errors that cancelled, one repo counted vendored that has never run a gate and one
  gated repo filed as advisory. The total, 15, did not move — so §5's reach figure did not move
  either; it was already a floor and is now labelled one. **The durable change is not the count but
  the command beside it** (§10): a denominator nobody can re-derive goes stale in silence, and every
  claim resting on it inherits the staleness. ISS-6 came within one re-verification of shipping on
  it. Three things the measurement taught about measuring: a repository's gate may reach the checker
  through a build script one indirection away, so grepping CI files alone under-counts it; a grep
  finds a mention, never a *blocking* step, so whether a gate can actually fail the build is still
  read by hand; and a repository can mention the checker without gating on it at all — a local
  pre-commit hook is not a gate. Deliberately not done here: no consumer's pinned version or CI was
  touched, though most were found pinned well behind — each is that repository's own issue, as
  ISS-4 and ISS-6 both concluded.

## 10. Rollout log (ISS-4, re-measured 2026-09-08 by ISS-23)

**Aggregate, because the detail is not this file's to publish.** The per-repository table — which
internal repositories carry codemap, which checks each has switched off and why, and the tracking
issue opened in each — lives in the project's own knowledge store under
`codemap-rollout-log-internal`. Naming other teams' repositories and the gates they have disabled is
not evidence of anything a reader here needs, and it is not this project's information to hand out.

| Tier | Count | What it means |
|---|---|---|
| vendored | **10** | `.forge/codemap/` committed + a blocking gate in CI; legacy prose frozen into that repo's own baseline |
| committed, ungated | **3** | `.forge/codemap/` committed, but no CI gate runs it — one has a single unrelated workflow, two have no CI configuration at all |
| plugins (advisory) | **2** | designated through `forge_config.plugins` only — the hooks run, but with no `cm init` there is no baseline, so the block-on-prose branch disables itself and only `cm impact` plus annotation-syntax blocking remain |
| **total** | **15** | the 5 → 15 figure in §5 — a floor, not a ceiling: it counts the fleet's local checkouts |

**The command, so the number is re-runnable rather than hand-counted.** From the directory holding
the fleet's checkouts:

```bash
for r in */; do r=${r%/}
  git -C "$r" ls-files --error-unmatch .forge/codemap/cm >/dev/null 2>&1 || continue
  if git -C "$r" grep -qlE 'codemap|cm\.mjs' -- '.github/workflows' '.gitlab-ci.yml' \
       'scripts' 'package.json' 'Makefile' 2>/dev/null \
     && [ -n "$(git -C "$r" ls-files '.github/workflows' '.gitlab-ci.yml')" ]
  then echo "vendored  $r"; else echo "ungated   $r"; fi
done | sort
```

It printed 10 vendored and 3 ungated on 2026-09-08; the 2 advisory repos carry no committed checker
and so do not appear. **It is a screen, not the verdict** — the gate column in the knowledge entry was
read by hand, file and line, and that is the authority. Three cautions for whoever re-runs it.

It searches `scripts`, `package.json` and `Makefile`, not only the CI files, because one repository's
gate reaches the checker through a build script one indirection away, and a workflow-file grep alone
records it as ungated. Its blocking step was confirmed by reading that script, not a CI file.

It screens for a *mention*, so it cannot tell a blocking step from one marked `continue-on-error` or
`allow_failure`, nor a gate from a mention that is not one: a repository that installs the pre-commit
hook from `package.json` and happens to carry any unrelated workflow satisfies both halves of the
predicate and prints as vendored. Every one of the 10 was confirmed against its actual configuration
by hand; the screen only decides who is worth reading.

It probes one fixed path, `.forge/codemap/cm`. If a future release stops shipping that path in the
vendored payload the loop skips every repository and prints **nothing** — which is a broken probe, not
a rollout of zero. An empty result means read the probe first.

Each of the 5 repositories not at the vendored tier has a tracking issue **inside its own project**,
asking for the same three things: `cm init` to freeze a baseline, `cm install` to vendor and pin the
checker, then wiring `cm verify` into that repo's CI gate. For the 3 that already carry a committed
checker only the third is outstanding. Three of the five are open; two are still at draft, awaiting
their own project's triage. That split is deliberate: ISS-4 had no worktree in
those repositories, and pushing to another project's main branch from an issue owned by `codemap`
crosses an ownership boundary.

Seven of the repositories ISS-4 recorded as advisory had vendored a checker by the 2026-09-08
re-measurement and **five** of those reached the full vendored tier, most through their own tracking
issue — which is why the count moved without this project pushing to
anyone. The re-measurement also found most committed checkers pinned well
behind the current release; whether that drift is worth acting on is each repository's own issue, not
this file's.

Six repositories were excluded from every batch with a recorded reason rather than skipped silently:
one is a repo-less storefront with no module boundary to annotate, three have no real repository path
on their project yet, one is a subdirectory of a tree already installed at its root, and one lives
outside the fleet whose hook reviewers can be identified. Those six are counted against the
tracker's project list, not the checkouts the command above walks — four of them have no checkout
at all, which is why that set cannot be reconciled against the command's population. Eight more
are valid candidates deferred only because the 5 → 15 mark was already met.

**The caveat that must travel with these numbers.** "Every repository has its own baseline" — ISS-4's
own brief — holds for **13 of 15**. The tier split above keys on the *gate*, not the baseline: the 3
ungated repositories did run `cm init` and committed the frozen baseline, and only the CI wiring is
outstanding. The 2 at the advisory tier have no baseline, exactly as "measure first, install second"
intends: nothing is unlocked before it is measured. That is a designed gap with issues against it,
not a hidden one. And the count itself is **reach, not effect** — §5 measures effect separately, by
annotations that people outside this project write.

**ISS-6 (2026-09-08): the forwarding shim is deleted, and the premise it rested on was false.**
The shim was kept because every repository that vendored a checker before 0.17.0 was believed to
hardcode the pre-0.17 checker path in its own upgrade workflow. Measured rather than assumed, that
held for **one repository out of the thirteen that carry a committed checker** — and that one had
already migrated to `cli/cm.mjs`. It is the only consumer with a codemap upgrade workflow at all:
of the other twelve, ten run CI that never clones this repository and two have no CI configuration
on any ref. So no bot anywhere resolved the old path, the ISS-5 silent-bot-failure class was
unreachable, and the `cm:hack` had no exit condition left to wait for.

Two facts made the deletion safe beyond that count. The residual old-path strings still sitting in
consumers' vendored copies appear inside a snippet that **instructs pinning a tag** —
`--branch codemap-v<x.y.z>`, annotated "pin a TAG, never a branch" — and every pre-0.17 tag still
carries that path, so following those instructions works. Where a concrete tag is hardcoded rather
than left as a placeholder it is a pre-0.17 one. Breaking it therefore takes keeping the old path
*and* swapping in a post-0.17 tag, which fails loudly at authoring time rather than silently on a
cron. And a sweep across the local and remote refs of all thirteen consumers found no workflow,
Dockerfile, Makefile, package script or cron that resolves the path — with the caveat that two of
the thirteen have never been re-fetched, so their remote refs are only as fresh as the original clone.

**What the stale denominator cost, since the table above is the correction.** ISS-6 reasoned about
"the six" while thirteen repositories carried a committed checker, and its conclusion survived only
because it was re-verified against all thirteen. A count nobody can re-derive goes stale silently and
takes every claim resting on it along; that is why the command now sits beside the number. The
per-repository detail and the tracking issues' outcomes are in the knowledge entry — read it before
re-filing anything against this.

The lesson §10 keeps from this: a `cm:hack` whose `until:` names a condition in *other* repositories
has to be measured there, not inferred from the change that created it. Written as "until every repo
runs an upgrade workflow that resolves the new path", the condition could never become true for a
repository that runs no upgrade workflow — the wording would have kept a temporary shim forever.
