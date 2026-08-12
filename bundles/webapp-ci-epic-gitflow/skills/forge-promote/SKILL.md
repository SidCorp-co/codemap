---
name: forge-promote
description: "Promote the integration trunk to production for the epic integration-branch profile on a CI-on-push deploy model (no Coolify). baseBranch auto-deploys to staging on push; this skill promotes baseBranch to productionBranch behind a human-confirm gate — full train or selective cherry-pick of epic squash commits — pushes (CI deploys production), polls the production URL health, and marks the promoted issues merged-to-prod. Triggers on: /forge-promote, promote to production, release to prod, ship the trunk."
user_invocable: true
arguments: "[mode] [documentId ...]"
---

# Forge Promote (epic integration-branch profile · CI-on-push)

In this profile the environments map to branches like this:

- `<baseBranch>` — the integration trunk. Epics (and plain issues) land here as **one squash commit each**. CI deploys `<baseBranch>` to **staging** on push.
- `<productionBranch>` — production. CI deploys it on push. Reached only by promoting `<baseBranch>`.

`forge-release` finalizes work on `<baseBranch>`; it never touches production. **This skill is the only path to production.** Because every epic is one squash commit, promotion and rollback operate on whole units: `cherry-pick <commit>` to ship one epic, `revert <commit>` to roll one back.

This skill is **standalone / user-invocable** — it is not a pipeline stage. Run it manually or on a schedule (e.g. a daily/weekly promotion window). There is no deploy API: promotion = pushing `<productionBranch>`, after which CI deploys.

## Usage

```
/forge-promote                       # train: promote everything on baseBranch not yet on productionBranch
/forge-promote train
/forge-promote select <id> <id> ...  # selective: cherry-pick only these epics' squash commits
```

If no mode is given, default to **train**.

## Tools

`forge_issues` (get + `mark_merged` + `unmark`), `forge_comments`, `forge_config`, `Bash` (git), HTTP (WebFetch / Bash curl — production health poll + smoke), Browser (`mcp__claude-in-chrome__*`) for the production smoke.

## Workflow

### Step 1: Config + git state

```
forge_config → get → {}
```

Read `<baseBranch>` and `<productionBranch>`. If they are equal, there is nothing to promote — stop. Confirm a clean working tree; `git fetch <remoteName>`.

### Step 2: Compute the promotion set

```bash
git checkout <productionBranch> && git pull <remoteName> <productionBranch>
git log --oneline <productionBranch>..<remoteName>/<baseBranch>
```

Each line is one issue/epic (`ISS-<id>: <title>`). Map each commit back to its issue via the `ISS-<id>` prefix.

- **train mode** → the set is every such commit.
- **select mode** → the set is only the commits whose `ISS-<id>` is in the argument list. If a requested id has no commit on the trunk, stop and report it (not released to the trunk yet).

If the set is empty, post "nothing to promote" and stop.

### Step 3: Human-confirm gate (required for production)

Production promotion always requires explicit human confirmation. Post a promotion preview listing: mode, the exact commits + issue ids, and the file-level `--stat`. Then **stop and ask for confirmation** unless the invocation already carries an explicit "confirmed" signal. Never promote to production on inference alone.

### Step 4: Apply to the production branch

**Train** — fast-forward the trunk:
```bash
git checkout <productionBranch>
git merge --ff-only <remoteName>/<baseBranch>   # if not fast-forwardable: git merge --no-ff
git push <remoteName> <productionBranch>
```

**Select** — cherry-pick the chosen squash commits, oldest first:
```bash
git checkout <productionBranch>
git cherry-pick <commit-oldest> ... <commit-newest>
git push <remoteName> <productionBranch>
```
On a cherry-pick conflict → stop, post the detail, leave production unchanged (`git cherry-pick --abort`). Selective promotion across dependent epics can conflict — promote dependencies together or use train mode.

Pushing `<productionBranch>` is what triggers the CI production deploy.

### Step 5: Wait for the production deploy

CI deploys `<productionBranch>` on push. Poll the production URL health endpoint until it reflects the new build:
```bash
curl -fsS <productionUrl>/health      # or the app root / a known version endpoint
```
`<productionUrl>` comes from `forge_projects → get` (the project's production URL field) — the same place `<stagingUrl>` comes from; `forge_config` carries pipeline config, not URLs. Re-check every ~30s, up to ~5 min; if still not healthy, note it in the report and continue to smoke cautiously.

### Step 6: Production smoke

Hit the production URL and run a brief smoke of the promoted features (not the full E2E — that already passed on staging at each epic's test step). If smoke fails, **do not roll back automatically** — post the failure and recommend `git revert <commit>` + `forge_issues → unmark` for the affected epic; let a human decide.

### Step 7: Mark promoted issues merged-to-prod

For each promoted parent/issue:
```
forge_issues → mark_merged → { issueId: "<id>", target: "prod", note: "promoted to <productionBranch> @<sha>" }
```

### Step 8: Post the promotion report

```markdown
**Promotion** — <baseBranch> → <productionBranch> ({train|select})

| ISS | Title | Commit |
|-----|-------|--------|
| <id> | <title> | <sha> |

**Production deploy:** <healthy/stale note>
**Smoke:** <pass/fail summary>
```

## Rollback

To roll a single epic back out of production:
```bash
git checkout <productionBranch> && git revert <epic-squash-commit> && git push <remoteName> <productionBranch>
```
CI redeploys production on the push. Then `forge_issues → unmark → { issueId: "<parent id>" }` to clear its `merged_at`, keeping the barrier and analytics consistent.

## Output reminder

Reports and previews go to `forge_comments.create` (or chat for the confirm gate), not duplicated to chat output.
