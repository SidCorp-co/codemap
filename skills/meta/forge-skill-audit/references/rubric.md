# Per-stage scoring rubric

The judge's quality ceiling is this rubric. Score each stage that ran for a sampled issue as `PASS` / `CONCERNS` / `FAIL`, attach a failure category, and name the responsible artifact.

General scoring stance:
- **PASS** — stage met its skill's exit contract, output is usable downstream as-is, no avoidable cost.
- **CONCERNS** — stage technically advanced the issue but left a defect a better prompt/skill would have prevented (downstream silently absorbed it).
- **FAIL** — stage produced output that was wrong, missing, or that forced rework / a bounce / a human rescue.

A clean `reopenCount` does NOT cap a stage at PASS. Look for *silent absorption*: a weak upstream artifact that the next stage quietly fixed instead of bouncing. That is a CONCERNS against the **upstream** stage.

---

## triage (`open → confirmed | needs_info`)

- **PASS:** classification (complexity/priority/category) matches the issue's real shape; actionable issues confirmed, genuinely incomplete ones sent to `needs_info` with specific questions.
- **CONCERNS:** confirmed an under-specified issue that plan/clarify then had to interpret; over- or under-sized complexity; generic category.
- **FAIL:** sent an actionable issue to `needs_info` (false block), or confirmed an issue so vague the plan stage had to guess scope.
- **Categories:** `mis-classification`, `false-block`, `scope-ambiguity`, `weak-questions`.
- **Artifact:** `forge-triage` body (its actionability bar + question template), or triage per-state prompt.

## clarify (`needs_info → confirmed`)

- **PASS:** the thing that blocked triage is resolved with captured evidence (repro for bugs, UX expectation for features); release-note seed drafted.
- **CONCERNS:** advanced without real evidence (claimed repro but no artifact), or restated the issue without resolving the ambiguity.
- **FAIL:** looped `needs_info → needs_info` without progress, or confirmed while the core unknown remained.
- **Categories:** `no-evidence`, `unresolved-ambiguity`, `clarify-loop`.
- **Artifact:** `forge-clarify` body (evidence requirements), clarify per-state prompt.

## plan (`confirmed → approved`) — highest-leverage stage to audit

- **PASS:** plan names every affected file with the *specific* change; steps are ordered and concrete; unknowns/risks called out; code could follow it without re-deciding scope.
- **CONCERNS (most common hidden defect):** plan is directionally right but vague — "update the auth module" — and `sessionContext.filesModified` shows code touched files the plan never named. Code *silently diverged* and rescued the plan. This is the signature of a clean-metrics-but-weak-prompt pipeline.
- **FAIL:** plan missed a required file/step that caused a downstream bounce, or planned against the wrong branch/scope.
- **Categories:** `vague-plan`, `silent-divergence`, `missing-file`, `wrong-scope`, `no-risk-callout`.
- **Artifact:** `forge-plan` body (exit-contract specificity), plan per-state prompt. *Most proposed fixes will land here.*
- **Key check:** diff `issue.plan` (files named) against `sessionContext.filesModified` (files touched). A large gap = `silent-divergence`.

## code (`approved → developed`)

- **PASS:** implemented the plan, matched conventions, built + tested affected packages, pushed a clean ISS-* branch.
- **CONCERNS:** built but skipped tests it should have run, or matched the plan while ignoring a convention the codebase clearly follows, or left commented-out / TODO scaffolding.
- **FAIL:** pushed code that didn't build, or implemented something other than the plan without flagging it.
- **Categories:** `skipped-tests`, `convention-drift`, `incomplete-impl`, `unflagged-divergence`.
- **Artifact:** `forge-code` body (build/test gate, convention rules), code per-state prompt, or a missing CLAUDE.md convention the agent couldn't have known.

## review (`developed → testing | reopen`)

- **PASS:** independent review that actually engaged the diff — found real issues or gave a substantive APPROVE citing what it checked.
- **CONCERNS (rubber-stamp signal):** one-line "LGTM"/APPROVE on a non-trivial diff with no specifics, OR review duration so short it could not have read the diff.
- **FAIL:** approved a diff with a defect that QA/live then caught (review missed what it existed to catch), or REQUEST CHANGES on non-issues (false friction).
- **Categories:** `rubber-stamp`, `missed-defect`, `false-friction`, `coverage-gap`.
- **Artifact:** `forge-review` body (what it must check, coverage-before-filtering instruction), review per-state prompt.
- **Key check:** review comment length + specificity vs diff size; review job duration vs project p50.

## test (`testing → pass/released | reopen`)

- **PASS:** walked each acceptance criterion as a real end-to-end flow; evidence captured; verdict matches reality.
- **CONCERNS:** ran a smoke test where the AC demanded a full flow; passed criteria without evidence.
- **FAIL:** passed an issue that was later found broken live, or failed on environment noise it should have distinguished from a real regression.
- **Categories:** `smoke-not-e2e`, `no-evidence`, `false-pass`, `env-noise-misread`.
- **Artifact:** `forge-test` / `forge-verify-live` body (E2E vs smoke bar, evidence requirement), test per-state prompt.

## fix (`reopen → developed`)

- **PASS:** addressed the specific review/QA feedback, scope minimal, reused the existing branch/worktree, re-built + re-tested.
- **CONCERNS:** over-reached beyond the feedback (scope creep on a fix), or fixed the symptom not the cause flagged by review.
- **FAIL:** re-introduced the original defect, or "fixed" without addressing the actual feedback.
- **Categories:** `scope-creep`, `symptom-only`, `feedback-missed`.
- **Artifact:** `forge-fix` body (scope-minimal rule), fix per-state prompt.

## release (`released → closed`)

- **PASS:** the thin final step did exactly its job (notes appended, branch cleaned, closed) and confirmed the merge actually landed.
- **CONCERNS:** closed without confirming the branch merged, or release note missing/low-quality.
- **FAIL:** closed an issue whose branch never landed (orphan), or wrote a misleading changelog entry.
- **Categories:** `unconfirmed-merge`, `weak-release-note`, `premature-close`.
- **Artifact:** `forge-release` body (merge-confirmation gate), release per-state prompt.

---

## Cross-cutting checks (any stage)

- **token-bloat** — a stage's `promptBlocks` est-tokens are large vs peers; a `replace` per-state override that dropped the shared cache-friendly preamble. → Artifact: that per-state prompt. Playbook: prompt-economy.
- **over-aggressive-language** — skill/prompt uses "CRITICAL / YOU MUST / NEVER" so heavily that newer models over-trigger or freeze. → Artifact: the skill/prompt. Playbook: avoid-aggressive-language.
- **scope-ambiguity** — instruction doesn't state whether it applies to the first item or all items; Opus is literal and may do only the first. → Playbook: literal-scope.
- **stale-memory** — agent re-derived a fact that a pgvector memory entry should have supplied, or acted on a memory entry that current code contradicts. → Artifact: the memory entry (propose write/correct), defer pure staleness to `forge-memory-builder`.
- **lossy-handoff** — `forge_step_handoff_get` shows the next stage re-derived context the previous stage already had. → Artifact: the upstream skill's handoff section.
