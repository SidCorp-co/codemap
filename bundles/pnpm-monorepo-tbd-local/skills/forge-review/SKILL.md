---
name: forge-review
description: "TBD profile. Independent code review with fresh context. Posts findings as issue comment. Decides verdict: APPROVE → auto-advance developed → testing (forge-test takes over). REQUEST CHANGES → developed → reopen (forge-fix takes over). ABSTAIN (review couldn't run) → halt at developed for human."
user_invocable: true
arguments: "documentId"
---

# Forge Review (TBD profile — verdict-driven auto-advance)

Project-local override. Respects the project's `autoReview=true` toggle: this skill decides per-issue whether the review is clean enough to continue the auto-chain, whether `forge-fix` needs to take over, or whether a human gate is really needed.

**Halt is the exception, not the default.** Only ABSTAIN (stay at `developed` with no transition) when the review skill itself cannot reach a verdict — diff inscrutable, branch missing, file-read failures. A clean APPROVE means the chain continues to `testing` and `forge-test` runs local E2E.

## Workflow

### 1. Load issue + prior review comments

```
forge_issues → get documentId
forge_comments → list                # check for prior review on same SHA
```

### 2. Fetch the branch + extract SHA

```bash
REMOTE=$(git remote | head -1)
git fetch "$REMOTE" ISS-XX-short-title 2>&1 | tail -2
SHA=$(git rev-parse "$REMOTE/ISS-XX-short-title")
```

### 3. Idempotency check

If a prior comment references this exact SHA in its body (e.g. `Reviewed SHA: <sha>`), exit early with "already reviewed at SHA, no diff change" — do not duplicate the comment.

### 4. Compute review base + diff

```bash
BASE=$(git merge-base "$REMOTE/main" "$REMOTE/ISS-XX-short-title")
git diff --stat "$BASE..$REMOTE/ISS-XX-short-title"
git diff       "$BASE..$REMOTE/ISS-XX-short-title"
git log --oneline "$BASE..$REMOTE/ISS-XX-short-title"
```

### 5. Detect tech stack + load skills

From the changed files:

- `packages/core/` → load `packages/core/skills/strapi/SKILL.md` if present, and `forge/.forge/lessons.md` for past gotchas.
- `packages/web/` → load `.claude/skills/nextjs/SKILL.md` if present.
- Always read `CLAUDE.md` at repo root + `packages/<pkg>/CLAUDE.md` if the changed package has one.

### 6. Run the review checklist

Categories: Bugs & logic, Security, Performance, TypeScript, React (if web), Migration safety, English-only, Consistency. Full checklist + severity guide: [references/review-checklist.md](references/review-checklist.md).

### 7. UI verification (if applicable)

If diff touches `web` / `dev` / `app` UI AND Playwright MCP is available (`mcp__playwright__browser_*` loaded), walk through each `acceptanceCriteria` line on the running preview deploy:

- `browser_navigate` to affected page.
- `browser_click` / `browser_evaluate` to assert post-state.
- `browser_take_screenshot` for evidence.

If Playwright MCP not available, note `e2e-not-verified` in the comment. This is a soft signal — `forge-test` will run a stricter local E2E gate after APPROVE.

### 8. Decide verdict + post comment

Verdict is mechanical:

- **APPROVE** — zero `blocker` findings.
- **REQUEST CHANGES** — one or more `blocker` findings.
- **ABSTAIN** — review couldn't run.

Comment template + verdict decision + idempotency-marker rules: [references/comment-format.md](references/comment-format.md).

### 9. Transition status (LAST)

After the comment is posted:

| Verdict | Transition |
|---|---|
| APPROVE | `developed → testing` (forge-test picks up next) |
| REQUEST CHANGES | `developed → reopen` (forge-fix picks up next) |
| ABSTAIN | (no transition — stays at `developed` for human) |

The transition is the **last** action — that ordering guarantees the next worker that picks up the issue sees the verdict comment.

## Idempotency

Re-running `/forge-review documentId` on the same branch SHA produces no new comment (early-exit at Step 3). To force re-review, push a new commit (changes SHA) or delete the prior review comment manually.

## References

- [references/review-checklist.md](references/review-checklist.md) — full Step 6 checklist + severity definitions.
- [references/comment-format.md](references/comment-format.md) — Step 8 comment template + verdict decision rules + SHA marker.
- [../forge-clarify/references/upload-screenshots.md](../forge-clarify/references/upload-screenshots.md) — Step 8 screenshot upload via `scripts/upload-image.sh`.
- [../README.md § English-only rule](../README.md) — non-English UI text = `blocker`.
