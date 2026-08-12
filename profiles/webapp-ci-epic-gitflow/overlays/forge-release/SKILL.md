---
name: forge-release
description: "Finalize a released Forge issue on the integration trunk (baseBranch) on a CI-on-push deploy model (no Coolify) — append the CHANGELOG, clean up branches, and close. Integration-branch aware: epic children just close, the epic parent closes itself plus its children and deletes the feature branch. This profile never promotes to the production branch — that is forge-promote's job. Triggers on: /forge-release, releasing an issue, finalizing on baseBranch, closing an epic."
user_invocable: true
arguments: "documentId"
---

# Forge Release (epic integration-branch profile · CI-on-push)

The final pipeline step: `released → closed`. **In this profile `forge-release` finalizes on `<baseBranch>` (the integration trunk) and never touches `<productionBranch>`.** Promotion `<baseBranch>` → production is handled separately by `forge-promote`, with each epic (one squash commit) as the atomic unit. Deploys are triggered by CI/CD on push — pushing `<baseBranch>` deploys staging; this skill does not call any deploy API.

Classify the issue first — **read `../forge-plan/references/epic-branch-model.md`**:

- `metadata.integrationParent` set → **integration child** → already merged into the integration branch at the test step. Just close it.
- `metadata.useIntegrationBranch === true` → **epic parent** → the squash-merge to `<baseBranch>` already happened at the parent's test step. Write the CHANGELOG, delete the integration branch, close the parent and its children.
- neither → **plain issue** → squash-merge the `ISS-*` branch into `<baseBranch>` (CI deploys staging on push), write the CHANGELOG, delete the branch, close.

## Usage

```
/forge-release <documentId>
```

## Tools

`forge_issues`, `forge_comments`, `forge_config`, `Bash` (git merge/push/branch cleanup).

## Step 0: Local-only mode guard

Read `forge_config → get`. If `previewDeploy` is null/missing with no staging/testing URL → **local-only mode**: the pipeline ends at `developed` for human review. Post a "release skipped — local-only mode" comment and stop (do NOT change status, do NOT merge).

## Step 1: Fetch Issue & Config

```
forge_issues → get → { documentId: "<id>" }
forge_config → get → {}
```

Verify status is `released`. Read `<baseBranch>` from config. Resolve `effectiveTarget` = `issue.metadata.branchConfig.targetBranch` ?? `<baseBranch>`.

## Child flow (`metadata.integrationParent` set)

The child's code is already on the integration branch (merged at the test step) and the child was marked merged. Nothing to merge here.

1. Post a short comment: "Child of epic ISS-<parent> — merged into the integration branch at test; closing."
2. Optionally delete the child's `ISS-*` branch if it still exists:
   ```bash
   git push <remoteName> --delete ISS-<id>-short-title || true
   ```
3. Close it (status LAST):
   ```
   forge_issues → update → { documentId: "<child id>", data: { status: "closed" } }
   ```

Do **not** write a CHANGELOG entry for a child — the epic parent writes one consolidated entry.

## Epic parent flow (`useIntegrationBranch === true`)

The integration branch was squash-merged into `<baseBranch>` at the parent's test step (and CI already deployed staging). Finalize.

1. Confirm git state clean; `git fetch <remoteName>`.
2. **Append the consolidated CHANGELOG entry** from the parent's `releaseNotes` (Step 5) — one entry for the whole epic.
3. **Delete the integration branch** now that it is merged:
   ```bash
   git push <remoteName> --delete feature/ISS-<id>
   ```
4. **Close the parent and any still-open children.** Find children via the decomposition comment / `metadata`; close each not already closed, then close the parent (status LAST):
   ```
   forge_issues → update → { documentId: "<child id>", data: { status: "closed" } }   // each remaining child
   forge_issues → update → { documentId: "<parent id>", data: { status: "closed" } }   // LAST
   ```
5. Post a release comment: "Epic finalized on `<baseBranch>` (squash commit `<sha>`). N children closed. Promote to production with forge-promote."

## Plain issue flow (no epic metadata)

1. Confirm git state clean; `git fetch <remoteName>`.
2. **Diff audit** — compare what will land on `<baseBranch>`:
   ```bash
   git checkout <effectiveTarget> && git pull <remoteName> <effectiveTarget>
   git diff <effectiveTarget>...<remoteName>/ISS-<id>-short-title --stat
   ```
   Flag unexpected files (not in the plan) in a warning comment, then proceed.
3. **Squash-merge into `<baseBranch>`** — one clean commit per issue (the push triggers the CI staging deploy):
   ```bash
   git merge --squash <remoteName>/ISS-<id>-short-title
   git commit -m "ISS-<id>: <issue title>"
   git push <remoteName> <effectiveTarget>
   ```
   On conflict → comment with detail, set `reopen`, stop.
4. **Mark merged** after verifying the push:
   ```
   forge_issues → mark_merged → { issueId: "<id>", target: "base", note: "squash-merged into <effectiveTarget> @<sha>" }
   ```
5. Append the CHANGELOG entry (Step 5), delete the `ISS-*` branch, close.

## Step 5: Append CHANGELOG entry (parent + plain issue)

Read `releaseNotes` from the `forge_issues → get` response. Shape:

```typescript
{ section: 'Added'|'Changed'|'Fixed'|'Removed'|'Security'|'Skip', userFacing: string, technical?: string|null }
```

- `releaseNotes` is `null` → skip. `section === 'Skip'` → skip.
- Otherwise insert a bullet under `### <section>` inside `## [Unreleased]` in `CHANGELOG.md`:
  ```
  - **<userFacing>**
    *Technical: <technical>*    ← only when technical is non-empty
  ```
  Commit the CHANGELOG bump on `<baseBranch>` as part of (or immediately after) the merge — do not leave it dangling. Present-tense, one short sentence, no `ISS-XX` IDs.

## Deploy note

There is no deploy API call here. Pushing `<baseBranch>` is what triggers the CI staging deploy; for the epic parent that push already happened at the test step. **Production deployment is not triggered here** — see `forge-promote`.

(General output rules — see pipeline preamble.)
