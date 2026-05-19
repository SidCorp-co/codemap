---
name: forge-code
version: 0.1.0
description: "TBD monorepo bundle (Trunk-Based Development). Implements code changes, pushes ISS-* branch, ends at `developed`. forge-release merges to main after review pass."
user_invocable: true
arguments: "documentId1 documentId2 ..."
---

# Forge Code — TBD monorepo bundle

## English-only output (recommended for OSS)

For OSS projects, every byte written into the codebase MUST be in English regardless of what language the issue is written in. Internal projects may relax this — but English is the safe default that works for review tooling, search, and contributor onboarding.

If the issue (`description`, `plan`, `acceptanceCriteria`, comments) is in another language, translate to natural English before embedding:
- All UI strings (toast/flash text, error messages, button labels, placeholders, aria-label, empty-state copy, modal headings, validation messages)
- Variable names, identifiers, file names
- Comments and JSDoc
- Commit messages, branch names, PR titles
- Test assertions on UI strings

Never copy a non-English literal from the plan into a JSX/`flash(...)` call — translate first. If the plan contains non-English UI strings (a `forge-plan` bug worth flagging), translate before implementing — do NOT implement verbatim.

If you are uncertain whether a string is English-only, default to English.

---

Trunk-Based Development override. Single trunk (typically `main`, resolved via `branchConfig.baseBranch`), short branches, feature flags hide incomplete work. See `<repo>/CLAUDE.md` for the project's branching strategy.

## Project-specific defaults

### Resolved branch config (mandatory preamble)

Before running any git command, call `forge_config` with the current issue's `documentId` to resolve which branches to use. This avoids hard-coding `main` so issues that opt into an alternate base (e.g. an integration branch for a decomposed epic) still work:

```ts
const cfg = await forge_config({
  action: 'get',
  projectId: '<projectId>',
  issueId: '<documentId>',
});
const BASE = cfg.config.branchConfig.baseBranch;       // checkout source
const TARGET = cfg.config.branchConfig.targetBranch;   // merge destination (used by forge-release; record here for handoff)
```

If the response lacks `branchConfig` (PR-A not yet rolled out for the project), fall back to `cfg.config.baseBranch` then to the literal `'main'`. Never write the literal `'main'` into a git command in the steps below — always interpolate `$BASE`.

### Git remote
Use `git remote | head -1` rather than hardcoding `origin` — project-specific remote names like `github` or `upstream` are common:
```bash
REMOTE=$(git remote | head -1)
git push -u "$REMOTE" ISS-XX-short-title
```

### Deploy mode — TBD
- No automated deploy from this skill (project's release pipeline handles it)
- Push ISS-* branch only at end of forge-code
- Status ends at `developed` — does NOT merge to main yet
- `forge-release` merges to main after review + test pass

### Feature flag gate (when working on incomplete features)

Code merging to main behind incomplete features should be gated:

```ts
import { isEnabled } from '@/lib/feature-flags';
if (isEnabled('myFeature')) {
  app.route('/api/my-feature', myFeatureRoutes);
}
```

If the project uses feature flags (look for `feature-flags.ts` or similar in the core package), gate new endpoints/UI behind the appropriate flag. Skip if the project doesn't have a flag system.

### Build / test (per-package)

Detect from `git diff --name-only` which packages changed. Build/test only affected packages. Standard pnpm-workspace pattern:

```bash
# For each affected package:
cd packages/<pkg>
pnpm build
pnpm test
```

Common packages in a multi-package monorepo: `core` (backend), `web` (frontend), `dev` (desktop), `widget` (embed), `contracts` (shared types).

**Pre-existing test failures** — check the project's CI baseline for known-flaky tests before treating any failure as a blocker. If the project has a `KNOWN_FLAKY.md` or similar, consult it. Only new failures (not present before your changes) gate the issue.

### Worktree mode (default ON)

This repo runs many parallel ISS-* sessions. **Default to worktree mode** unless main is provably idle:

```bash
git status -s            # any output = main is dirty
git worktree list        # >1 line = parallel session active
```

Either signal → use `.claude/worktrees/iss-XX-short-title/`:

```bash
git fetch "$(git remote | head -1)" "$BASE"
git worktree add .claude/worktrees/iss-XX-short-title -b ISS-XX-short-title "$BASE"
cd .claude/worktrees/iss-XX-short-title
```

All subsequent commands run in the worktree.

### Migration sequence collision

If the project uses sequential migration files (e.g. Drizzle):

```bash
ls packages/core/drizzle/migrations/*.sql | sort | tail -5
```

Pick a number higher than any in-flight branch. If conflict at merge time, renumber the lower one. Skip this step if the project uses non-sequential migrations (Prisma, Knex with timestamps, etc.).

### Commit style

Conventional with package scope: `feat(core):`, `fix(web):`, `refactor(dev):`. Body includes `Resolves ISS-XX`.

## Workflow (TBD)

1. Fetch issue + comments via `forge_issues → get` and `forge_comments → list`.
2. Detect collision (Step 4a in wrapper `references/workflow.md`); pick branch mode (clean) vs worktree mode (collision).
3. Setup workspace:
   - **Branch mode:** `git checkout "$BASE" && git pull "$(git remote | head -1)" "$BASE" && git checkout -b ISS-XX-short-title`
   - **Worktree mode:** `git worktree add .claude/worktrees/iss-XX-short-title -b ISS-XX-short-title "$BASE" && cd .claude/worktrees/iss-XX-short-title`
4. Set status `in_progress`.
5. Implement per plan (gate new features behind a feature flag if the project uses one).
6. Build affected package(s).
7. Run tests on affected package(s).
8. Self-review or launch review agent (per complexity from triage).
9. Fix any review findings; re-build + re-test.
10. Commit with Conventional + scope; reference `Resolves ISS-XX`.
11. Push ISS-* branch:
    ```bash
    git push -u "$(git remote | head -1)" ISS-XX-short-title
    ```
    **Do NOT** merge to main from forge-code — that is `forge-release`'s job after review + test pass.
12. Post comment summarizing the implementation (mention worktree path if applicable, mention the feature flag if gated).
13. Set status: `developed` (LAST action). `forge-release` will merge to main after independent review passes.

## Tools

- `forge_issues`, `forge_comments`
- Read, Edit, Write, Glob, Grep, Bash

## Output rules

Same as wrapper. Zero narration, code-only, one-line status, no recap.
