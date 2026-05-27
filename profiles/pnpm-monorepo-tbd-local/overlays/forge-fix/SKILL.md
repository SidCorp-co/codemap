---
name: forge-fix
description: "TBD profile. Applies scoped fixes from review/QA feedback on an existing ISS-* branch, ends at `developed`. Reuses the worktree forge-code created. forge-release merges to main after re-review pass."
user_invocable: true
arguments: "documentId"
---

# Forge Fix (TBD profile)

Project-local override. Applies scoped fixes; same TBD discipline as `forge-code` (no Coolify, no merge to main, end at `developed`). The key difference: `forge-fix` reuses the existing ISS-* branch + worktree that `forge-code` created — it does NOT create new ones.

> **English-only** — all code, comments, commit messages must be English. See [`../README.md` § English-only rule](../README.md).

## Project-specific defaults

### Git remote

```bash
REMOTE=$(git remote | head -1)    # 'github' in this repo, not 'origin'
```

### Worktree mode (preferred)

Reuse the ISS-XX worktree from `forge-code` if it exists. Detection + reuse + fallback creation: [`../forge-code/references/worktree-mode.md`](../forge-code/references/worktree-mode.md) → "Reuse (forge-fix scenario)".

### Build / test

Same per-package table as `forge-code` (see [`../forge-code/SKILL.md`](../forge-code/SKILL.md) → "Build / test"). Same pre-existing flakies (`db/schema.test.ts`, 2 route mocks) — don't block fixes on them.

## Workflow

1. `forge_issues → get` + `forge_comments → list`. Verify status = `reopen`.
2. Find the latest rejection comment (Code Review or QA Test Report). If unclear → set `needs_info`, post comment, stop.
3. Parse findings: handle **blocker + major** only; ignore **minor / nit** unless the fix is trivial.
4. Switch to the ISS-* worktree (reuse — see worktree-mode reference).
5. Apply scoped fixes — one finding at a time, no scope creep. Translate any non-English wording in the review feedback to English before adding code.
6. Build + test on affected package(s).
7. Commit `fix: address review feedback — <summary>` (separate commit, no amend).
8. Push: `git push "$REMOTE" ISS-XX-short-title`. No merge to main. No Coolify.
9. Post a comment summarizing what was fixed (per finding, what changed).
10. Set status `developed` (LAST). Re-review picks it up.

## What forge-fix does NOT do

- ❌ Open new ISS-* branches — fix lands on the existing one.
- ❌ Rebase / amend / squash existing forge-code commits — separate `fix:` commit preserves the audit trail review needs.
- ❌ Fix `nit` findings that require significant work — leave them as TODOs in the comment, ship the blockers.
- ❌ Merge to main — `forge-release` does that after re-review passes.

## References

- [../forge-code/references/worktree-mode.md](../forge-code/references/worktree-mode.md) — worktree reuse pattern.
- [../README.md § English-only rule](../README.md) — non-negotiable.
