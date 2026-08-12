---
name: forge-test
description: "Merge + QA gate for Forge issues on a CI-on-push deploy model (no Coolify), integration-branch aware. For epic children it merges the child branch into the shared integration branch and marks it merged (no live QA — the integration branch is not deployed). For the epic parent it squash-merges the integration branch to baseBranch (which triggers the CI staging deploy), waits for the staging URL to go healthy, and runs the full acceptance E2E. Triggers on: /forge-test, testing an issue, QA on staging, merging a child into the integration branch."
user_invocable: true
arguments: "documentId"
---

# Forge Test (epic integration-branch profile · CI-on-push)

At `testing` this is the **merge + verify** gate. Deploys are triggered by CI/CD on branch push — this skill pushes and then waits for the staging URL to reflect the new build (no Coolify status API). Behavior splits by epic role — **read `../forge-plan/references/epic-branch-model.md` first** and classify the issue:

- `metadata.integrationParent` set → **integration child** → merge the child into the integration branch, mark it merged, advance. **No live QA** (the integration branch is not deployed; whole-feature QA happens on the parent).
- `metadata.useIntegrationBranch === true` → **epic parent** → squash-merge the integration branch to `<baseBranch>` (CI deploys staging on push), wait for staging readiness, run the full acceptance E2E on staging.
- neither → **plain issue** → base behavior (QA against staging once `<baseBranch>` is deployed).

This is NOT a unit-test runner. For the parent it is a human-style QA pass over live URLs; for a child it is the controlled merge into the shared branch.

## Usage

```
/forge-test <documentId>
```

## Tools

`forge_issues` (incl. `mark_merged`), `forge_comments`, `forge_config`, Browser (`mcp__claude-in-chrome__*`), HTTP (WebFetch / Bash curl — for the staging health poll and API checks), `Bash` (git merge/push for the merge gate).

## Branch resolution

- `effectiveBase` = `issue.metadata.branchConfig.baseBranch` ?? project `<baseBranch>`
- `effectiveTarget` = `issue.metadata.branchConfig.targetBranch` ?? `effectiveBase`

For a **child**, `effectiveTarget` is the integration branch. For the **parent**, `effectiveTarget` is `<baseBranch>`.

## Local-only guard

Read `forge_config → get`. If `previewDeploy` is null/missing with no staging/testing URL → **local-only mode**: there is no deployed environment to QA against. The build + tests already ran in `forge-code`. Post a "QA skipped — local-only mode" comment and stop **without** changing status.

## Child flow (`metadata.integrationParent` set)

The child's code passed review (APPROVE). Land it on the integration branch.

1. Fetch the child issue + comments. Confirm the review verdict was APPROVE (if REQUEST CHANGES, this step should not have fired — stop and comment).
2. Confirm git state clean; `git fetch <remoteName>`.
3. **Diff audit** against the integration branch:
   ```bash
   git checkout <effectiveTarget> && git pull <remoteName> <effectiveTarget>
   git diff <effectiveTarget>...<remoteName>/ISS-<id>-short-title --stat
   ```
   If changed files diverge wildly from the child plan, warn but proceed (code passed review).
4. **Merge the child branch into the integration branch** (normal merge — the parent squashes everything later):
   ```bash
   git merge --no-ff <remoteName>/ISS-<id>-short-title -m "ISS-<id>: <child title>"
   git push <remoteName> <effectiveTarget>
   ```
   On conflict → **stop**, post the conflict detail, set the child to `reopen`. Do not force the merge. (Pushing the integration branch does **not** deploy anything — only `<baseBranch>`/`<productionBranch>` deploy.)
5. **Verify the push landed**, then mark the child merged (this releases the parent's barrier):
   ```
   forge_issues → mark_merged → { issueId: "<child id>", target: "feature", note: "merged ISS-<id> into <effectiveTarget> @<sha>" }
   ```
   If `mark_merged` is unavailable, the state machine stamps `merged_at` when the child leaves the release state — still set the status below.
6. Post a short merge comment (branch, target, sha).
7. Set status (LAST): `released` — the child has no promotion of its own; `forge-release` just closes it.

**No deploy, no browser QA for a child.**

## Parent flow (`useIntegrationBranch === true`)

The integration step (forge-code) already proved the combined branch builds and its integration tests pass. Now promote to `<baseBranch>` (CI deploys staging) and verify.

1. Fetch the parent issue + comments. Read `acceptanceCriteria` / `aiAcceptanceCriteria` and the plan's **Integration test** + any `## QA Scenarios`.
2. Confirm git state clean; `git fetch <remoteName>`.
3. **Squash-merge the integration branch into `<baseBranch>`** — one atomic commit for the whole epic. Pushing `<baseBranch>` triggers the CI staging deploy:
   ```bash
   git checkout <effectiveTarget> && git pull <remoteName> <effectiveTarget>
   git merge --squash <remoteName>/feature/ISS-<id>
   git commit -m "ISS-<id>: <epic title>"
   git push <remoteName> <effectiveTarget>
   ```
   On conflict → stop, comment, set `reopen` (the integration step keeps the branch current; a conflict here means `<baseBranch>` moved — re-run integration). Do not force.
4. **Wait for the staging deploy to go live.** CI deploys `<baseBranch>` on push. Poll the staging URL health endpoint until it reflects the new build:
   ```bash
   curl -fsS <stagingUrl>/health      # or the app root / a known version endpoint
   ```
   Re-check every ~30s, up to ~5 min. If still not healthy, proceed with a **staleness note** in the report ("staging may not yet reflect the merge").
5. **Get test URLs + credentials** from `forge_config → get` (`previewDeploy.testingUrls[].url` → `<stagingUrl>`, the API URL, and `testCredentials`). If no staging URL is configured → comment "no staging URL, cannot verify" and treat verification as ABSTAIN (hand to human), not PASS.
6. **Run the full acceptance E2E** — walk every acceptance criterion as a real end-to-end user flow (backend API + frontend UI), not a smoke test. Multiple roles where AC is role-based. Flag visual corruption as FAIL even if the feature works functionally. Read `references/test-approach.md`, `references/browser-playbook.md`, `references/result-format.md`.
7. **Verify the merge landed**, then mark the parent merged:
   ```
   forge_issues → mark_merged → { issueId: "<parent id>", target: "base", note: "squash-merged feature/ISS-<id> into <effectiveTarget> @<sha>" }
   ```
8. Post the QA report (format below).
9. Set status (LAST):
   - **All pass** → `released` (`forge-release` writes the CHANGELOG, deletes the integration branch, closes the epic + children).
   - **Any fail** → `reopen` with an actionable failure report for `forge-fix`. Do **not** revert the squash commit — fix forward on the integration branch, then re-run this step.

## Report format

```markdown
**QA Test Report** {cycle indicator if reopen}

**Test environment:** {stagingUrl} (staging) — epic ISS-<id> (feature/ISS-<id> → <baseBranch>)

| # | Test Case | Source | Result | Notes |
|---|-----------|--------|--------|-------|
| 1 | Description | AC #1 | PASS/FAIL | Details |

**Children integrated:** <list>
**Summary:** X/Y passed
**Verdict:** PASS / FAIL
```

## Test-specific output reminder

The QA report and merge comments go to `forge_comments.create`, NOT to chat. Don't print twice. (See pipeline preamble for general output rules.)
