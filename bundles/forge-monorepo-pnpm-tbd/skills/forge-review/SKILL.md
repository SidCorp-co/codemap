---
name: forge-review
version: 0.1.0
description: "TBD monorepo bundle. Independent code review with fresh context. Posts findings as issue comment. Decides verdict: APPROVE → auto-advance developed → testing (forge-test takes over). REQUEST CHANGES → developed → reopen (forge-fix takes over). ABSTAIN (review couldn't run) → halt at developed for human."
user_invocable: true
arguments: "documentId"
---

# Forge Review — verdict-driven auto-advance

Project-local override. Respects the project's `autoReview=true` toggle: the skill decides per-issue whether the review is clean enough to continue the auto-chain, or whether forge-fix needs to take over, or whether a human gate is really needed.

**Halt is the exception, not the default.** Only abstain (stay at `developed` with no transition) when the review skill itself cannot reach a verdict — diff inscrutable, branch missing, file-read failures, etc. A clean APPROVE means the chain continues to `testing` and forge-test runs local E2E.

## Workflow

1. `forge_issues → get documentId` to load issue + plan + acceptanceCriteria.
2. `forge_comments → list` to check whether a prior review comment exists (idempotency: re-running review on same branch SHA must not duplicate comments).
3. Detect remote name, get the branch SHA:
   ```bash
   REMOTE=$(git remote | head -1)
   git fetch "$REMOTE" ISS-XX-short-title 2>&1 | tail -2
   SHA=$(git rev-parse "$REMOTE/ISS-XX-short-title")
   ```
   If a prior comment in the issue references this exact SHA in its body (e.g. `Reviewed SHA: <sha>`), exit early with "already reviewed at SHA, no diff change" — do not duplicate.

4. Compute review base against `main`:
   ```bash
   BASE=$(git merge-base "$REMOTE/main" "$REMOTE/ISS-XX-short-title")
   git diff --stat "$BASE..$REMOTE/ISS-XX-short-title"
   git diff       "$BASE..$REMOTE/ISS-XX-short-title"
   git log --oneline "$BASE..$REMOTE/ISS-XX-short-title"
   ```

5. Detect tech stack from changed files. Read only what applies:
   - Always read `CLAUDE.md` at repo root + `packages/<pkg>/CLAUDE.md` if the changed package has one.
   - Per-stack skill docs at `.claude/skills/<stack>/SKILL.md` (e.g. `nextjs`, `vue`, `strapi`, `nestjs`) — load only if changed files belong to that stack and the doc exists.
   - Project lessons / past gotchas — common locations: `.forge/lessons.md`, `docs/lessons.md`, `KNOWN_ISSUES.md`. Read only if present.

6. Run the review checklist:
   - **Bugs & logic** — wrong logic, null risks, race conditions, missing error handling, off-by-one.
   - **Security** — injection, credentials in code, missing auth, unsanitized input, broken access control.
   - **Performance** — N+1 queries, unnecessary re-renders, memory leaks, unbounded data, missing indexes.
   - **TypeScript** — unsafe casts, `any` leaks, missing type narrowing.
   - **React** (if web) — wrong useEffect deps, unmounted state updates, unstable keys, hydration risks.
   - **Migration safety** (if SQL files) — NOT NULL on populated table without backfill, missing rollback path, ON DELETE behavior.
   - **English-only** (project rule) — any new UI string, comment, identifier must be English.
   - **Consistency** — matches project patterns, cross-package parity if both changed.

7. If diff touches `web`/`dev`/`app` UI AND Playwright MCP is available (`mcp__playwright__browser_*` tools loaded), walk through each `acceptanceCriteria` line on the running preview deploy:
   - `browser_navigate` to affected page.
   - `browser_click` / `browser_evaluate` to assert post-state.
   - `browser_take_screenshot` for evidence.
   If Playwright MCP not available, note `e2e-not-verified` in the comment.

8. Decide verdict + post review comment via `forge_comments → create`. Severity scale: `blocker` | `major` | `minor` | `nit`. The verdict is mechanical:
   - **APPROVE** — zero `blocker` findings (any number of `major`/`minor`/`nit` is OK; flag them in the comment but do not block).
   - **REQUEST CHANGES** — one or more `blocker` findings.
   - **ABSTAIN** — review skill couldn't run (branch missing on remote, can't read diff, infrastructure failure mid-review). Use sparingly; almost every issue should resolve to APPROVE or REQUEST CHANGES.

   Comment body:
   ```markdown
   ## Code Review — ISS-XX

   Reviewed SHA: `<short-sha>`
   Files changed: <n> files, +<add>/-<del>

   ### Findings

   | # | File:Line | Severity | Finding |
   |---|---|---|---|
   | 1 | path/to/file.ts:123 | blocker | <description + suggested fix> |
   | 2 | path/to/file.ts:200 | nit | <description> |

   (Empty table if clean: "No findings — code is ready to merge.")

   ### Verdict: **<APPROVE | REQUEST CHANGES | ABSTAIN>**

   - APPROVE → auto-advancing to `testing`; `forge-test` will run local E2E next.
   - REQUEST CHANGES → transitioning to `reopen`; `forge-fix` will apply the listed blockers next. Non-blocker findings are recorded but do not gate the chain.
   - ABSTAIN → review could not complete (`<reason>`); status stays at `developed` for human inspection.

   🤖 Generated by forge-review (auto-advance override)
   ```

9. Transition status based on verdict:
   - **APPROVE** → `forge_issues → transition developed → testing`. `forge-test` is dispatched next by the orchestrator.
   - **REQUEST CHANGES** → `forge_issues → transition developed → reopen`. `forge-fix` is dispatched next; it reads the latest review comment and applies the blockers.
   - **ABSTAIN** → do NOT transition. Status stays at `developed`. The comment names the reason so a human can resolve and either re-trigger `/forge-review documentId` or manually advance.

   Make the transition the **last** action after the comment is posted — that ordering guarantees the next worker that picks up the issue sees the verdict comment.

## Idempotency

Re-running `/forge-review documentId` on the same branch SHA produces no new comment (early-exit at step 3). To force re-review, push a new commit (changes SHA) or delete the prior review comment manually.

## Tools

- `forge_issues` (get + transition — verdict-driven: APPROVE → testing, REQUEST CHANGES → reopen, ABSTAIN → no-op)
- `forge_comments` (list + create)
- `mcp__playwright__browser_*` (optional, for UI verification)
- Read, Glob, Grep, Bash

## Output rules

Terse. Zero narration. One-line status updates only. The actual review output lives in the posted comment, not the chat transcript.
