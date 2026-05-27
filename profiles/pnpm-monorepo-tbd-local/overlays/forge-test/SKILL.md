---
name: forge-test
description: "TBD profile. At status=testing: spin up local core + web dev servers, walk acceptanceCriteria via Playwright MCP when UI changed, auto-advance testing → pass → staging → released so forge-release can take over. "
user_invocable: true
arguments: "documentId"
---

# Forge Test (TBD profile — local E2E + auto-advance)

Verification gate after `forge-review`. Boots `packages/core` (port 8080) + `packages/web` (port 3000) as background processes via [`scripts/boot-servers.sh`](scripts/boot-servers.sh), walks every `acceptanceCriteria` line on `localhost` via Playwright MCP, captures evidence, then advances `testing → pass → staging → released` so `forge-release` takes over.


## Preconditions

- Status = `testing`
- Branch `ISS-XX-short-title` exists on the remote and contains forge-code commits
- For UI changes: Playwright MCP (`mcp__playwright__browser_*`) loaded — otherwise UI walk is skipped, comment marks `e2e-not-verified`

If routed at a non-`testing` status, abort with comment `forge-test invoked at status=<status>; expected testing` and do nothing.

## Workflow

### 1. Fetch issue + classify diff

```bash
REMOTE=$(git remote | head -1)
git fetch "$REMOTE" ISS-XX-short-title 2>&1 | tail -2
BASE=$(git merge-base "$REMOTE/main" "$REMOTE/ISS-XX-short-title")
CHANGED=$(git diff --name-only "$BASE..$REMOTE/ISS-XX-short-title")
```

| `CHANGED` touches | Path | Servers | Verification |
|---|---|---|---|
| `packages/web\|dev\|app\|widget/` | **UI** | core + web | Playwright walk |
| `packages/core/` only | **backend** | core | `npx vitest run` |
| Migrations / docs only | **migration** | none | `npm run db:migrate` |

### 2. Worktree setup

Default to worktree to avoid clobbering main:

```bash
git worktree add .claude/worktrees/iss-XX-short-title -b ISS-XX-short-title-test "$REMOTE/ISS-XX-short-title" 2>/dev/null \
  || (cd .claude/worktrees/iss-XX-short-title && git fetch "$REMOTE" ISS-XX-short-title && git reset --hard "$REMOTE/ISS-XX-short-title")
cd .claude/worktrees/iss-XX-short-title
```

### 3. Install + (backend-only) build

```bash
npm install --prefer-offline --no-audit 2>&1 | tail -5
```

If backend path: also `cd packages/core && npm run build 2>&1 | tail -10`. Build failure → `reopen` + last 20 lines.

### 4. Boot dev servers

```bash
PIDFILE="/tmp/forge-test-pids-$DOCID.txt"
bash .claude/skills/forge-test/scripts/boot-servers.sh "$PIDFILE" $([[ "$UI" -eq 1 ]] && echo --ui)
```

Script writes PIDs to `$PIDFILE`, tails log on failure, exits non-zero on boot timeout. On failure:
- `xargs -r kill < "$PIDFILE" 2>/dev/null; rm -f "$PIDFILE"`
- Transition `testing → reopen` with the failing log excerpt + suggested fix (likely env, port conflict, or missing migration)

Skip this step entirely for the **migration path**.

### 4b. Migration path

```bash
cd packages/core && npm run db:migrate
```

No stderr error → skip to step 7.

### 5. UI walk (UI path + Playwright MCP available)

For each `acceptanceCriteria` line:

1. Identify URL + selector + asserted state from the criterion text
2. `browser_navigate` → `http://localhost:3000/...`
3. `browser_click` / `browser_fill_form` / `browser_evaluate` to drive the flow
4. Assert post-state via `browser_snapshot` or `browser_evaluate` → PASS / FAIL
5. `browser_take_screenshot` → `.playwright-mcp/iss-XX-<n>.png`

**Blocker fail** → stop walk, cleanup servers, transition to `reopen`, post comment with screenshot + diff of expected vs actual + a hint pointing to the file most likely responsible.

**Playwright MCP unavailable** → mark every UI criterion `e2e-not-verified` (soft-pass), continue to step 7. Caller can re-trigger `/forge-test documentId` from a session with Playwright MCP for a stricter gate.

### 6. Backend path verification

After step 4 boots core:

```bash
cd packages/core && npx vitest run 2>&1 | tail -30
```

Test failure → cleanup + `reopen` + failing test output.

### 7. Cleanup

```bash
xargs -r kill < "$PIDFILE" 2>/dev/null; rm -f "$PIDFILE"
```

Leave the worktree in place — `forge-release` cleans it up after the merge.

### 8. Post comment + upload screenshots + auto-advance

Comment format: see [references/comment-format.md](references/comment-format.md). Create the comment FIRST, then upload screenshots from Step 5 to that comment:

```bash
bash scripts/upload-image.sh --comment "$COMMENT_ID" .playwright-mcp/iss-XX-*.png
```

Skip the upload if no screenshots were captured (Playwright unavailable or migration path). Full upload flow (auth, failure modes): [../forge-clarify/references/upload-screenshots.md](../forge-clarify/references/upload-screenshots.md).

On pass / soft-pass:

```
forge_issues → transition testing → pass
forge_issues → transition pass → staging
forge_issues → transition staging → released
```

`staging` is intentionally walked through — `forge-staging` is a deprecated no-op (see `forge-staging/SKILL.md`). The state-machine path stays valid without core changes.

On fail:

```
forge_issues → transition testing → reopen
```

Plus the failing-criterion comment. `forge-fix` picks up `reopen` next.

## Out of scope

- Production deploy — no prod env in v0.1.
- Mobile (`packages/app/`) E2E — no automation; mark `e2e-not-verified` for app-only changes.
- Tauri desktop (`packages/dev/`) GUI E2E — skip Playwright; verify build only via `cd packages/dev && npm run build`.

## References

- [scripts/boot-servers.sh](scripts/boot-servers.sh) — boot core (always) + (optional) web, wait for health, write PIDs.
- [references/comment-format.md](references/comment-format.md) — Local E2E comment template (pass + fail).
- [../forge-clarify/references/upload-screenshots.md](../forge-clarify/references/upload-screenshots.md) — Step 8 screenshot upload via `scripts/upload-image.sh`.
- [../README.md § English-only rule](../README.md) — comments must be in English.
