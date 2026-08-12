---
name: forge-skill-audit
version: 0.1.0
description: "Self-driving pipeline-quality auditor. Samples recently-resolved Forge issues, reconstructs how each pipeline stage actually handled them (comments, sessionContext, handoffs, job sequence, durations, cost), scores every stage against a rubric with adversarial multi-vote verification, traces each confirmed weakness back to the responsible artifact (a registered skill body, a per-state system-prompt override, project memory, or CLAUDE.md), and drafts ONE consolidated improvement issue for human review. Built to surface problems hidden behind clean metrics — vague plans the coder silently rescued, rubber-stamp reviews, token-bloated prompts, lossy stage handoffs. Use to optimize pipeline skills and system prompts from real run evidence. Triggers on: /forge-skill-audit, audit pipeline quality, review how skills handled issues, optimize system prompt from runs, find skill/prompt weaknesses."
user_invocable: true
arguments: "[window=24h] [run|dry-run|audit]"
---

# forge-skill-audit

Evidence-driven. The skill does NOT trust surface metrics. A pipeline where every issue closed with `reopenCount: 0` can still be unhealthy — the plan was vague but the coder silently compensated, the review rubber-stamped, the prompt burned tokens, the handoff dropped context. This skill reconstructs what each stage *actually produced* from real run artifacts, judges it against what the stage's skill/prompt *told it to do*, and proposes concrete prompt/skill edits — never editing them itself.

Output is a **single draft issue** per run. Humans review the draft before any change lands.

## Modes

- `run` (default): full sweep — baseline + select + deep-read + score + adversarial-verify + cluster + **create one draft issue**.
- `dry-run`: everything except issue creation — print the draft body to the conversation instead.
- `audit`: read-only. Score the sampled issues and print the verdict table; skip clustering and the draft. Use for a quick health pulse.

Single batch output per run. No drip-feeding intermediate state.

## Inputs

- `window` — lookback for issue selection. Accepts `24h`, `48h`, `7d`. Default `24h` (daily cadence).
- Target project — resolved from invocation context. If a `projectId` is supplied in the prompt, use it. Otherwise `forge_projects_list` and pick the project whose `repoPath` matches the current working directory; if ambiguous, ask once.

## Phase 0 — Build the "intent" baseline

Before judging any run, snapshot what the prompts/skills *say* each stage should do. This is the yardstick.

1. `forge_projects_get` → `repoPath`, `baseBranch`, `productionBranch`, `defaultDeviceId`.
2. `forge_skills_list_registrations` → the stage→skill binding (which skill version is live for triage / clarify / plan / code / review / test / fix / release) plus each state's `mode`/`enabled`.
3. `forge_skills_get` for each registered skill → read the body. Extract per stage: its stated **exit contract**, its **must-do checklist**, its **explicit constraints**. This is what "good" looks like for that stage.
4. Per-state **system-prompt overrides**: note which states carry an `append`/`replace` override (from the registrations payload / project agentConfig hint). A `replace` override means the static PIPELINE_RULES preamble is gone for that state — flag-worthy on its own.
5. Read `CLAUDE.md` (project + sub-project) and `.forge/knowledge.json` if present → the standing facts agents are supposed to already know.

Cap this to a compact mental model. Every later finding must point at one of these artifacts as the thing to change.

See `references/rubric.md` for the per-stage scoring rubric and the responsible-artifact map.

## Phase 1 — Select issues (do NOT filter by metric)

1. `forge_issues.list` with `status: closed` (and `released`) updated within `<window>`.
2. **Do not** rank by `reopenCount` — a clean pipeline hides its prompt/skill defects behind zero reopens. Instead build a representative sample:
   - Include **all** issues with `reopenCount ≥ 1` (rare, high-signal) up to the cap.
   - Fill the rest with a **spread across complexity** (xs…xl) and **across category**, so the sample exercises every stage, not just the easy path.
3. Cap the sample at a sane batch (default ≤ 8 issues / run; daily windows are small). If the window yields more, sample; if it yields zero, report "no issues in window" and exit.
4. Record the sampled issue IDs — every finding will cite at least one.

## Phase 2 — Per-issue deep read (reconstruct what happened)

For each sampled issue, assemble the evidence trail. Read, don't skim:

1. `forge_pipeline_runs_get` (or `forge_project_pipeline_runs`) → the run + its ordered job sequence. Note retries, stage bounces, abnormal step order.
2. `forge_jobs_list` / `forge_jobs_get` → per stage: status, `started_at`/`finished_at` (duration), `promptBlocks` (token breakdown per block). A stage whose prompt blocks are huge, or whose duration is a wild outlier, is a finding candidate.
3. `forge_comments` → the review verdict, QA notes, any back-and-forth. A one-line "LGTM" review on a large diff is a rubber-stamp signal.
4. `issue.sessionContext` → decisions, filesModified, errorsResolved the agent recorded. Compare against `issue.plan`: did code stay on the plan, or silently diverge (a plan-quality signal)?
5. `forge_step_handoff_get` between consecutive stages → did the handoff carry what the next stage needed, or did the next stage re-derive context (a lossy-handoff signal)?
6. `forge_metrics_project_step_durations` → per-stage p95 / cost outliers for this project, to contextualize this issue's durations.

Reconstruct, per stage that ran: **what the stage produced** vs **what its skill/prompt told it to produce** (Phase 0 baseline).

## Phase 3 — Score each stage (rubric + verdict)

For each stage of each issue, apply the rubric in `references/rubric.md`. Emit:

- **verdict** ∈ `PASS` | `CONCERNS` | `FAIL` (four-level gate, never binary).
- **failure category** when not PASS — e.g. `vague-plan`, `silent-divergence`, `rubber-stamp-review`, `token-bloat`, `lossy-handoff`, `missing-constraint`, `over-aggressive-language`, `scope-ambiguity`, `stale-memory`. Categorize the *failure mode*, not just pass/fail (this is what makes the downstream fix actionable).
- **responsible artifact** — the exact skill name + version, the per-state prompt, the memory entry, or the CLAUDE.md/knowledge line that, if changed, would prevent this class of miss.
- **evidence** — the issue ID + the concrete observation (a quote from the comment, the duration number, the plan-vs-code gap).

A finding with no responsible artifact is not a finding — it's an observation; drop it.

## Phase 4 — Adversarial verify (multi-vote, refute-by-default)

Every `CONCERNS`/`FAIL` finding must survive skepticism before it can ship. For each one, run **independent skeptic passes** (≥ 3) — each instructed to *refute*:

> "Here is a claimed pipeline-quality weakness, its evidence, and the artifact blamed. Argue whether it is a REAL, recurring skill/prompt defect — or whether the agent actually handled it fine, it's a one-off, or the blame is misattributed. Default to REFUTED if uncertain."

Keep a finding only if a **majority** of votes uphold it (real + recurring + correctly attributed). Discard the rest. Prefer perspective-diverse skeptics where the finding could fail in more than one way (is-it-real? is-it-recurring? is-the-fix-right?). Log how many findings were discarded — silent suppression and silent inflation are both failures.

If you have the Agent/subagent tool, spawn the skeptics as parallel subagents for genuine independence; otherwise run them as sequential fresh-context reasoning passes.

## Phase 5 — Cluster & propose concrete fixes

1. Group surviving findings by **responsible artifact + failure category**. Three issues all showing `vague-plan` against `forge-plan` are ONE cluster, not three.
2. For each cluster, write a **concrete proposed change**: the exact skill-body edit, per-state-prompt edit, memory write, or CLAUDE.md line — not "improve the plan skill" but "add to forge-plan exit contract: list each affected file with the specific change, so code can't silently diverge."
3. Cross-reference each proposed change to a principle in `references/improvement-playbook.md` (e.g. Anthropic literal-scope rule, verdict-4-level pattern, progressive-disclosure, behavior-changing-memory-only) so the human reviewer sees the rationale, not just the edit.
4. Rank clusters by impact = (frequency across sampled issues) × (stage criticality) × (verdict severity).

## Phase 6 — Draft ONE consolidated issue

`run` mode: `forge_issues.create` with `status: draft` (the human-review channel). The body:

- **Summary** — window, issues sampled, findings confirmed vs discarded by adversarial verify.
- **Findings table** — one row per cluster: `artifact | failure category | severity | frequency | evidence (issue IDs) | proposed change`.
- **Proposed diffs** — per cluster, the concrete before→after for the skill/prompt/memory/CLAUDE.md edit, each tagged with its playbook rationale.
- **Verdict matrix** (collapsible) — per sampled issue × stage, the PASS/CONCERNS/FAIL grid, so the reviewer can audit the audit.

`dry-run`/`audit` mode: print the same body to the conversation; create nothing.

Title pattern: `Pipeline skill/prompt audit — <window> — <N> findings`.

## Output format (single batch)

```
## Baseline
<compact: live skill versions per stage, any replace-override flags, CLAUDE.md/knowledge coverage>

## Sample
<N issues, the spread (complexity/category), why each was picked>

## Verdict matrix
<issue × stage → PASS/CONCERNS/FAIL>

## Adversarial verify
<X findings raised → Y survived, Z discarded (and why a notable one was discarded)>

## Clusters → proposed changes (ranked)
<table: artifact | category | severity | freq | evidence | proposed change | playbook ref>

## Output
Draft issue created: ISS-### (run mode)  |  Draft NOT created (dry-run/audit)
```

## Constraints

- **Propose-only.** NEVER edit a skill body, system prompt, memory entry, or CLAUDE.md directly. Every change goes through the draft issue for human review. This skill optimizes by *proposing*, not by *applying*.
- **Evidence-bound.** Every shipped finding cites ≥ 1 real sampled issue and names exactly one responsible artifact. No artifact, no finding.
- **Adversarial-gated.** No `CONCERNS`/`FAIL` finding reaches the draft without surviving the majority refute vote. Report the discard count.
- **One draft per run.** Consolidate. Never spam the board with one issue per finding.
- **Metrics are a starting point, never a filter.** Clean `reopenCount` does not mean "skip" — it means "look harder at the qualitative trail."
- **Literal-scope yourself.** When you propose a prompt edit, state the scope explicitly ("apply to every affected file, not just the first") — the same discipline you're auditing for.
- **No silent caps.** If the window had more issues than the batch cap, say how many were dropped and on what basis the sample was drawn.
- **Atomic.** A run either produces one coherent draft (or printed body) or reports why it could not. No half-written drafts.
- **Conversation matches the user's language; the draft issue body is English** (it feeds back into prompts/skills, which are English).

## Boundary with related skills

- `forge-memory-builder` audits Claude Code **auto-memory** health (frontmatter, staleness, duplication) cross-session per-cwd. This skill audits **pipeline skills + system prompts + Forge pgvector memory** from run evidence. If a finding is purely "this memo is stale," that's memory-builder's job — defer.
- The `forge-*` pipeline skills (triage…release) are the *subject* of this audit, not collaborators. This skill never runs them.
- `update-config` manages `settings.json`. Different artifact.

Defer when the request is closer to another skill's scope.
