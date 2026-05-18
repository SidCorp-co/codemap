---
name: forge-test
description: "PROJECT-LOCAL OVERRIDE for jarvis-agents (TBD). At status=testing: spin up local core + web dev servers, walk acceptanceCriteria via Playwright MCP when UI changed, auto-advance testing → pass → staging → released so forge-release can take over. Replaces the deprecated VPS-deploy verification."
user_invocable: true
arguments: "documentId"
---

# Forge Test — jarvis-agents (local E2E + auto-advance)

Verification gate after `forge-review`. Boots `packages/core` (port 8080) and `packages/web` (port 3000) as background processes, walks every line of `acceptanceCriteria` on `localhost` via Playwright MCP, captures evidence, then advances the status walk so `forge-release` merges to main and closes the issue.

Replaces the legacy VPS staging deploy — `forge-staging` is deprecated.

## Preconditions

- Status = `testing`
- Branch `ISS-XX-short-title` exists on the remote and contains the implementation commits from `forge-code`
- For UI changes: Playwright MCP tools (`mcp__playwright__browser_*`) loaded in the worker — without them, UI E2E is skipped and the comment marks `e2e-not-verified`

If the dispatcher routes to this skill at a non-`testing` status, abort with comment `forge-test invoked at status=<status>; expected testing` and do nothing.

## Workflow

### 1. Fetch issue + diff classification

```bash
REMOTE=$(git remote | head -1)
git fetch "$REMOTE" ISS-XX-short-title 2>&1 | tail -2
BASE=$(git merge-base "$REMOTE/main" "$REMOTE/ISS-XX-short-title")
CHANGED=$(git diff --name-only "$BASE..$REMOTE/ISS-XX-short-title")
```

Classify the change:
- Touches `packages/web/` or `packages/dev/` or `packages/app/` or `packages/widget/` → **UI path** (requires Playwright MCP + web dev server).
- Touches `packages/core/` only → **backend-only path** (still boot core to assert it starts, but skip Playwright walkthrough).
- Touches neither (docs / migrations only) → skip dev server, just verify the migration runs (see step 4b).

### 2. Setup workspace

Default to a worktree to avoid clobbering main:

```bash
git worktree list                          # if a worktree for this issue already exists, reuse it
git worktree add .claude/worktrees/iss-XX-short-title -b ISS-XX-short-title-test "$REMOTE/ISS-XX-short-title" 2>/dev/null \
  || (cd .claude/worktrees/iss-XX-short-title && git fetch "$REMOTE" ISS-XX-short-title && git reset --hard "$REMOTE/ISS-XX-short-title")
cd .claude/worktrees/iss-XX-short-title
```

All subsequent steps run inside the worktree.

### 3. Install + build (only what changed)

```bash
npm install --prefer-offline --no-audit 2>&1 | tail -5
```

If `package-lock.json` changed, run a full `npm install`. Otherwise scoped install is enough.

For the **backend-only path**, also confirm the build doesn't break runtime:

```bash
cd packages/core && npm run build 2>&1 | tail -10
```

A build failure here aborts with `reopen` + the last 20 lines of build output.

### 4. Boot dev servers (background)

For UI path or backend-only path:

```bash
# Backend — Hono on PORT=8080 (per packages/core/.env.example)
cd packages/core
nohup npm run dev >/tmp/forge-test-core-ISS-XX.log 2>&1 &
CORE_PID=$!

# Wait up to 60s for /api/health (or /api/version — whichever exists)
until curl -fsS http://localhost:8080/api/version >/dev/null 2>&1; do
  sleep 2
  if ! kill -0 "$CORE_PID" 2>/dev/null; then
    echo "core dev server exited early"
    tail -30 /tmp/forge-test-core-ISS-XX.log
    exit 1
  fi
done
```

If UI path, also boot web (Next.js on PORT=3000 default):

```bash
cd ../../packages/web
nohup npm run dev >/tmp/forge-test-web-ISS-XX.log 2>&1 &
WEB_PID=$!

until curl -fsS http://localhost:3000 >/dev/null 2>&1; do
  sleep 2
  if ! kill -0 "$WEB_PID" 2>/dev/null; then
    echo "web dev server exited early"
    tail -30 /tmp/forge-test-web-ISS-XX.log
    exit 1
  fi
done
```

Use `run_in_background: true` semantics — these are long-lived processes the next steps interact with.

**On boot failure** (any server fails to come up within 60s):
- Capture the last 30 lines of the failed server's log.
- Cleanup any running PIDs (`kill $CORE_PID $WEB_PID 2>/dev/null`).
- Transition issue to `reopen` with comment `forge-test: dev server failed to boot` + log excerpt + suggested fix (likely env, port conflict, or missing migration).
- Stop.

### 4b. Migration-only path

If `CHANGED` is migrations + docs only, skip the web dev server but still boot core to verify the migration runs cleanly:

- Apply migration via `npm run db:migrate` (or the project's actual migrate script — check `packages/core/package.json`).
- Verify no error in stderr.
- Skip to step 7 (post comment + advance).

### 5. UI walk via Playwright MCP

Only when UI path AND `mcp__playwright__browser_*` tools are available.

For each line in `acceptanceCriteria`:
1. Identify the URL + selector + asserted state from the criterion text.
2. `browser_navigate` to the page (use `http://localhost:3000/...`).
3. `browser_click` / `browser_fill_form` / `browser_evaluate` to drive the user flow described.
4. Assert post-state via `browser_snapshot` or `browser_evaluate`. Mark the criterion **PASS** / **FAIL**.
5. `browser_take_screenshot` — save under `.playwright-mcp/iss-XX-<n>.png`. Note the path.

If a blocker criterion fails:
- Stop the walk early.
- Capture the failing screenshot.
- Cleanup servers, transition to `reopen`, post comment with the failing criterion + screenshot + diff of expected vs actual + a hint pointing to the file most likely responsible.
- Stop.

If Playwright MCP unavailable but UI path:
- Skip the walk. Mark every UI criterion as `e2e-not-verified` in the comment.
- Treat as **soft-pass** — proceed to step 7. Caller can re-trigger `/forge-test documentId` from a session with Playwright MCP for a stricter gate.

### 6. Backend-only path verification

When backend-only path, after step 4 confirms core boots:
- Run package tests as a smoke gate: `cd packages/core && npx vitest run 2>&1 | tail -30`.
- A test failure here → cleanup + `reopen` with the failing test output.

### 7. Cleanup

```bash
kill "$CORE_PID" "$WEB_PID" 2>/dev/null
wait "$CORE_PID" "$WEB_PID" 2>/dev/null
```

Leave the worktree in place — `forge-release` may inspect it. Cleanup of the worktree itself happens in `forge-release` after the merge.

### 8. Post comment via `forge_comments → create`

```markdown
## Local E2E — ISS-XX

Branch: `ISS-XX-short-title` at SHA `<short-sha>`
Servers booted: core (8080) ✅ · web (3000) ✅ (or N/A for backend-only path)

### Acceptance criteria walk

| # | Criterion | Result | Evidence |
|---|---|---|---|
| 1 | <text> | ✅ | .playwright-mcp/iss-XX-1.png |
| 2 | <text> | ✅ | .playwright-mcp/iss-XX-2.png |
| 3 | <text> | ⚠ e2e-not-verified | (Playwright MCP unavailable in this session) |

(or "No UI changes — skipped Playwright walk." for backend-only path)

### Verdict
- **PASS** — auto-advancing through `pass → staging → released`. `forge-release` will merge ISS-* to main and close.

🤖 Generated by forge-test (local E2E override)
```

### 9. Auto-advance status walk

On full pass (or soft-pass with `e2e-not-verified`):

```
forge_issues → transition testing → pass
forge_issues → transition pass → staging
forge_issues → transition staging → released
```

The three transitions are issued in sequence. Each is allowed by the state machine. `released` is the trigger for `forge-release`, which the orchestrator picks up next and runs the merge + close.

Walking through `staging` is intentional: `forge-staging` is deprecated (no-op skill, see `forge-staging/SKILL.md`), so the transition is instant and harmless. The state-machine path stays valid without core changes.

On fail (any blocker criterion):

```
forge_issues → transition testing → reopen
```

Plus the comment from step 8 with the failing criterion + evidence. `forge-fix` picks up `reopen` next.

## Out of scope

- Production deploy: there is no prod env in v0.1.
- VPS staging deploy: deprecated. `forge-staging` is a no-op.
- Mobile (`packages/app/`) E2E: no automation; skip Playwright for app-only changes and mark `e2e-not-verified`.
- Tauri desktop (`packages/dev/`) GUI E2E: skip Playwright; only verify the Tauri build doesn't break (`cd packages/dev && npm run build`).

## Tools

- `forge_issues` (get + transition — chain of 3 transitions on pass)
- `forge_comments` (create the verdict comment)
- `mcp__playwright__browser_*` (UI walkthrough when available)
- `Bash` (background dev servers, curl health probes, kill on cleanup)
- `Read`, `Glob`, `Grep`

## Output rules

Terse. Status updates only. All evidence in the posted comment, not the chat transcript.
