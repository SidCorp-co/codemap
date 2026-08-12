---
name: forge-code
description: "Implement code changes for Forge issues, including integration-branch epics, on a CI-on-push deploy model (no Coolify). Creates a branch, follows the plan, builds, reviews, commits, pushes. For epic children it branches off the shared integration branch; for the epic parent it runs the integration step over all merged children. Triggers on: /forge-code, coding issues, implementing approved issues, building features from a plan, running epic integration."
user_invocable: true
arguments: "documentId1 documentId2 ..."
---

# Forge Code (epic integration-branch profile · CI-on-push)

The coding step in the issue pipeline: `approved → developed`. Implements code, validates it locally (build + test), then pushes. An independent review step follows. **Deploys are triggered by CI/CD on branch push** — this skill never calls a deploy API; it just pushes branches.

This profile branches behavior by the issue's epic role. **Read `../forge-plan/references/epic-branch-model.md` first** and classify the issue:

- `metadata.useIntegrationBranch === true` → **epic parent** → run the **Integration** flow (this skill's special path).
- `metadata.integrationParent` set → **integration child** → run the normal flow below, but resolve the branch from the issue's `branchConfig` (base = the integration branch).
- neither → **plain issue** → normal flow below, branch off `<baseBranch>`.

When a plan exists, this skill should be fast and focused — follow the plan, edit, test, commit. Don't re-explore.

## Usage

```
/forge-code <documentId>
```

## Tools

`forge_issues`, `forge_comments`, `forge_config`, plus codebase tools (Read, Edit, Write, Glob, Grep, Bash).

## Deploy model (no Coolify)

Deployment is owned by CI/CD wired to the git host: pushing `<baseBranch>` deploys staging, pushing `<productionBranch>` deploys production. This skill only pushes branches; it does **not** deploy anything itself. The child/integration branches are never auto-deployed (only `<baseBranch>` and `<productionBranch>` are), so coding never waits on a deployment.

**deployMode detection** (affects only how `forge-test` verifies, not this skill): read `forge_config → get`. If `previewDeploy` exposes a staging/testing URL → **deploy mode** (CI maintains a staging URL). If `previewDeploy` is null/missing with no URL → **local-only mode** (verification is local; the pipeline ends at `developed` for human review).

## Branch resolution (do this FIRST, once per run)

Fetch the issue, then resolve the effective branches — **issue override wins over project default**:

- `effectiveBase` = `issue.metadata.branchConfig.baseBranch` ?? project `<baseBranch>`
- `effectiveTarget` = `issue.metadata.branchConfig.targetBranch` ?? `effectiveBase`

For a **child**, `effectiveBase` is the integration branch `feature/ISS-<n>`. For a **plain issue**, `effectiveBase` is `<baseBranch>`.

## Quick Start (Pipeline Mode — plain issue / child)

1. Fetch issue + comments → extract plan and complexity from triage. Resolve `effectiveBase`/`effectiveTarget` + deployMode.
2. **Confirm branch:** `git branch --show-current` and `git status`; stash/clean if dirty.
3. `git fetch <remoteName> && git checkout <effectiveBase> && git pull <remoteName> <effectiveBase> && git checkout -b ISS-<id>-short-title`
4. Set `in_progress`.
5. Follow the plan step-by-step — read each file as you reach it, edit, move on.
6. Run the build — catch compile/type errors.
7. Test API (if the plan has an API Test Plan) — curl affected endpoints. Skip for frontend-only.
8. Review (tiered — see below) — catch logic bugs.
9. Fix findings, re-build, re-test.
10. Commit.
11. **Push the `ISS-*` branch only.** Do NOT merge into `effectiveBase` here — the merge into the integration branch (child) or `<baseBranch>` (plain issue) happens at the test step, after review APPROVE, so code is reviewed before it lands on a shared branch. No deploy call.
12. Post comment.
13. Set status (LAST): `developed` (deploy mode). In **local-only mode**, also set `developed` — the pipeline ends there for human review.

**Do NOT:** re-read knowledge.json, re-explore, second-guess the plan, read files not in the plan.

Read `references/workflow.md` for the full step-by-step including standalone mode.

## Integration flow (epic parent — `useIntegrationBranch === true`)

Runs only after the gate clears, i.e. **every child is marked merged** into the integration branch. The parent proves the combined feature works on one branch before promotion.

1. Fetch the parent issue + comments. Read the `plan` (child index + **Integration test** section).
2. **Confirm all children landed.** For each child (via the decomposition comment / `metadata`), `forge_issues → get` and confirm it is closed/merged. If a child is missing from the integration branch, stop and comment — the gate should have prevented this.
3. **Checkout the integration branch** (`metadata.integrationBranch`, e.g. `feature/ISS-<id>`):
   ```bash
   git fetch <remoteName>
   git checkout feature/ISS-<id> && git pull <remoteName> feature/ISS-<id>
   ```
4. **Refresh against `<baseBranch>`** so the integration test reflects what will actually merge (merge, do not rebase a shared branch):
   ```bash
   git merge <remoteName>/<baseBranch>
   ```
   Resolve conflicts here, on the integration branch.
5. **Set `in_progress`.**
6. **Full cross-component build + integration tests** over the combined result — build every affected package, run the integration/contract tests the parent plan calls out. This is where cross-child breakage surfaces.
7. **Fix integration breakage** directly on the integration branch (small glue/fix commits). If a fault is large and belongs to a child's scope, reopen that child instead — note it in the comment.
8. Commit the integration fixes and push the integration branch (no deploy — staging deploys only when `<baseBranch>` updates at the test step):
   ```bash
   git commit -am "ISS-<id>: integration fixes"
   git push <remoteName> feature/ISS-<id>
   ```
9. Post an **integration report** comment: children included, build/test results, fixes applied, any reopened children.
10. Set status (LAST): `developed`. Whole-feature review follows; the squash-merge to `<baseBranch>` (which triggers the staging deploy) happens at the parent's test step.

If a child had to be reopened, set the parent back to a holding state and stop until that child re-lands — do not promote a known-broken integration.

## Tiered Review

| Complexity | Review | Simplifier |
|-----------|--------|------------|
| **Simple** | Self-review: read your diff | Skip |
| **Medium** | Quick review agent: Bug-severity only | Skip |
| **Complex** | Full review agent: Bug + Minor findings | Run simplifier |

The epic parent's integration step is always treated as **Complex** — the combined diff is the riskiest moment in the flow.

## Relation Awareness

After fetching the issue, check `relations`:

- **`blocked_by` / `depends_on`** — if the blocker isn't `developed` or beyond, stop, comment, set back to `confirmed`. (A gated epic parent simply won't dispatch here until children land.)
- **`related_to`** — check overlapping files; prefer additive changes.
- **`caused_by`** — address the root cause.

## Code-specific rules

1. **Plan = source of truth** — don't re-explore or re-plan.
2. **Build + review before push** — never push unvalidated code.
3. **Children never merge to `<baseBranch>`** — only into the integration branch (and that merge is the test step's job).
4. **Post a comment** — see `references/comments.md`.

(Status discipline, branch rules, output rules, sessionContext schema — see pipeline preamble.)

## Session Context fields code should populate

Beyond the standard `currentState / decisions / filesModified / errorsResolved`, the code step also reads `reviewFeedback` from a prior review (when resuming from `reopen`) and appends entries describing how each finding was addressed. The integration flow additionally records `integratedChildren` (the child IDs combined) and `integrationFixes`. Skip fields with no meaningful content.
