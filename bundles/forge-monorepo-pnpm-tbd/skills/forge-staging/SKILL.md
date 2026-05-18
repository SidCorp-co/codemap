---
name: forge-staging
description: "DEPRECATED. VPS staging deploy was removed from the jarvis-agents workflow on 2026-05-12. forge-test now performs local-server verification (Playwright E2E on localhost) and forge-release auto-closes after merging to main. This skill is a no-op kept only so the dispatcher doesn't error on legacy `staging` status transitions."
user_invocable: false
---

# Forge Staging — DEPRECATED no-op

VPS deploy on `staging` status was retired on 2026-05-12.

The replacement flow is:

```
developed  →  forge-review   (halt-at-developed, post review comment)
              [human transitions developed → testing]
testing    →  forge-test     (boot local core+web, Playwright E2E, auto-advance through pass/staging/released)
released   →  forge-release  (merge ISS-* to main, push, close)
closed
```

`forge-test` auto-walks the status chain `testing → pass → staging → released` so the issue passes through the `staging` status without any side effect. This file exists only to satisfy the dispatcher when it routes a job with `payload.skillName=forge-staging` — without it, the worker would log a skill-not-found error and the run could stall on a transient orchestrator quirk.

## Workflow (no-op)

If invoked:

1. Fetch issue.
2. Post comment via `forge_comments → create`:
   ```
   **forge-staging skipped** — VPS deploy retired on 2026-05-12.
   The auto-chain walks through `staging` status without side effects;
   `forge-release` handles merge + close. No action required here.
   ```
3. Do NOT change status. The orchestrator will fire `forge-release` next when status hits `released` (which `forge-test` advances to).

## Why keep the file at all

- The dispatcher's `STATUS_TO_SKILL` map currently has no entry for `staging`, so this skill is only spawned via direct `/forge-staging` invocation. Keeping a no-op SKILL.md prevents skill-not-found surprises if any legacy code path or runner manual still references it.
- Once the codebase is confirmed free of `forge-staging` references (search `grep -rn "forge-staging" packages/`), this directory can be deleted. Removal is a low-priority cleanup; the no-op causes no harm in the meantime.

## What replaced this skill

| Concern | Old (forge-staging) | New |
|---|---|---|
| Verify the change works | SSH VPS, deploy, curl /health | `forge-test` boots local core+web + Playwright E2E |
| Promote to a shared environment | Push to VPS staging | `forge-release` merges to `main` |
| QA gate before merge | Manual smoke on VPS | Local Playwright walk per acceptanceCriteria |
| Production deploy | (no prod in v0.1) | (unchanged — no prod in v0.1) |

## Tools

None — no-op.
