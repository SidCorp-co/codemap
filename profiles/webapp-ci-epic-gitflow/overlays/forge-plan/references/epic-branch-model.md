# Epic integration-branch model

This profile adds an **epic / integration-branch** flow on top of the canonical
GitFlow-lite pipeline. It is a *different* decomposition model from the base
`forge-plan` Step 5.5 (`kind='decomposes'` + atomic per-child release). Use
**this** model — never mix the two on the same epic.

Every overlay skill in this profile reads this file to decide how to behave.
The router key is the issue's metadata, stamped at decompose time.

## The two roles + the default role

Each skill first classifies the issue it was handed:

| Role | Detection (on the fetched issue) | Branch it works on | Where it merges |
|---|---|---|---|
| **epic parent** | `metadata.useIntegrationBranch === true` | the integration branch `metadata.integrationBranch` | squash → `<baseBranch>` (the project integration target, e.g. the develop branch) |
| **integration child** | `metadata.integrationParent` is set | a short-lived `ISS-*` branch off the integration branch | → the integration branch (`metadata.branchConfig.targetBranch`) |
| **plain issue** | neither flag set | normal `ISS-*` off `<baseBranch>` | base behavior (unchanged) |

If neither flag is present, **fall through to the base skill behavior verbatim**
— this profile only diverges for the two epic roles.

## Branch topology

```
<productionBranch> ◀── <baseBranch> ◀── feature/ISS-<n>  (integration branch, one per epic)
                                            ├── ISS-<n+1>  child branch
                                            ├── ISS-<n+2>  child branch
                                            └── ISS-<n+3>  child branch
```

- The integration branch `feature/ISS-<n>` is created from `<baseBranch>` HEAD at
  decompose time and lives until the epic closes.
- Each child branches off the integration branch and merges back into it.
- Only the **parent** squash-merges the integration branch into `<baseBranch>`.
  Children never touch `<baseBranch>` or `<productionBranch>`.

## merged_at semantics (the barrier)

The dispatch gate `blockedBy` holds a job while any edge `from --blocks--> issue`
has `from.merged_at IS NULL`. We use this to make the **parent wait for every
child**:

- Edge direction is **`child --blocks--> parent`** (child is `from`, parent is
  `to`). Set one such edge per child at decompose time.
- A child's `merged_at` is stamped when its branch lands on the integration
  branch (the test step calls `forge_issues → mark_merged` with
  `target: 'feature'`). Once all children are stamped, the parent's gated job
  dispatches automatically — no human action, no watcher.
- **Do NOT use `kind='decomposes'`** for this profile. `decomposes` triggers the
  base atomic-release lifecycle and the `releaseDecomposePending` gate (child
  release waits on parent `merged_at`), which would deadlock against
  `child --blocks--> parent`. Use `blocks` only.

If the `mark_merged` action is unavailable on a deployment, the child still gets
`merged_at` stamped by the state machine when it leaves the release state — but
prefer the explicit `mark_merged` call: it is idempotent and decoupled from the
exact status path.

## Serial execution (cap = 1)

The runner dispatches one issue at a time per project. Children therefore run
**serially**, not in parallel — child N lands on the integration branch before
child N+1 starts coding. This is expected: it removes most child-vs-child merge
conflicts, and the parent integration step is the single place cross-child
issues are caught. If true parallelism is required, split the children into a
separate project; do not relax the cap.

## Lifecycle (happy path)

1. **Parent triage/clarify/plan** run normally (no edges yet, so nothing gates).
2. **Parent forge-plan (epic)** decomposes: creates the integration branch,
   creates children at `approved` with their per-child plan + `branchConfig`,
   sets `child --blocks--> parent` edges, stamps parent metadata, sets the parent
   to `approved`. The parent's `forge-code` job enqueues but is **gated**.
3. **Children** run serially: code on a child branch off the integration branch
   → review → test (merge child → integration branch + `mark_merged`) →
   release (close child; no `<baseBranch>`/prod merge).
4. When the **last child** is marked merged, the parent's gate clears and its
   `forge-code` (integration) dispatches: checkout the integration branch with
   all children present, run a full cross-component build + integration tests,
   resolve any cross-child breakage, push the integration branch.
5. **Parent review** reviews the whole feature diff (integration branch vs
   `<baseBranch>`).
6. **Parent test** squash-merges the integration branch → `<baseBranch>`, deploys,
   and runs the full acceptance E2E on staging. `mark_merged` with
   `target: 'base'`.
7. **Parent release** appends the CHANGELOG entry, deletes the integration
   branch, and closes the parent (and any still-open children).
8. **Promotion** of `<baseBranch>` → staging → `<productionBranch>` is handled by
   `forge-promote`, with the epic (one squash commit) as the atomic unit.

## Rollback

Because each epic is one squash commit on `<baseBranch>`, rollback is
`git revert <epic-commit>` plus `forge_issues → unmark` on the parent to clear
its `merged_at` (keeps the barrier/analytics consistent).
