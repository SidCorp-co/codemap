# Bundles catalogue

Each profile produces a drop-in bundle = `skills/` base + `profiles/<p>/overlays/` − `profile.json.excludeSkills`. Bundles are committed under `bundles/` so consumers can `cp` directly without running the build.

```bash
tools/build-bundle.sh <profile>      # build one
tools/build-bundle.sh --all          # build every profile
tools/diff-overlay.sh <profile>      # see how a profile diverges from base
```

Install into a project:

```bash
cp -r bundles/<profile>/skills/* /path/to/your-project/.claude/skills/
```

---

## Available

### `pnpm-monorepo-tbd-local`

pnpm workspaces · Trunk-Based Development · local-E2E verification · merge-to-main · no remote deploy.

| Axis | Value |
|---|---|
| Stack | pnpm monorepo (multi-package) |
| Branching | TBD — short-lived `ISS-*` off `<baseBranch>` |
| Deploy | none (build is local; no Coolify / Vercel / cloud) |
| Verification | local Playwright E2E against `pnpm dev` |

- **Overlay**: 5 `SKILL.md` (`forge-code`, `forge-fix`, `forge-release`, `forge-review`, `forge-test`) + 6 reference docs.
- **Excluded**: `forge-staging` — N/A in TBD; the bundle ships **without** it.
- **Bundle size**: 25 skill files across 8 skills.

### `webapp-coolify-gitflow`

Multi-component webapp · GitFlow-lite (baseBranch = staging, productionBranch = main) · Coolify deploy with prod human-confirm gate.

| Axis | Value |
|---|---|
| Stack | multi-component webapp (backend + frontend + auxiliaries) |
| Branching | GitFlow-lite — ISS-* off `<baseBranch>`; release merges to `<productionBranch>` |
| Deploy | Coolify — staging auto-deploys; prod requires human confirm |
| Verification | staging-URL Playwright E2E after deploy completes |

- **Overlay**: none — base is exactly this case (the canonical set is Coolify-aware + `<baseBranch>`/`<productionBranch>` placeholder-driven).
- **Excluded**: none.
- **Bundle size**: 20 skill files across 9 skills.

### `webapp-ci-epic-gitflow`

Multi-component webapp · epic decomposition onto a shared **integration (feature) branch** · GitFlow-lite · **CI-on-push deploy (no Coolify)** · only the parent promotes to `<baseBranch>` (squash); production promotion is a separate gated step.

| Axis | Value |
|---|---|
| Stack | multi-component webapp (backend + frontend + auxiliaries) |
| Branching | epic-integration-branch — large issues decompose into children that branch off and merge back into one `feature/ISS-<n>`; the parent squash-merges that branch to `<baseBranch>` |
| Deploy | CI-on-push — pushing `<baseBranch>` deploys staging, pushing `<productionBranch>` deploys production; no deploy API call |
| Verification | staging-URL Playwright E2E on the parent after the integration branch lands on `<baseBranch>` (readiness = poll `<stagingUrl>` health) |

- **How it differs from `webapp-coolify-gitflow`**: that profile ships each issue (or each `decomposes` child) straight to production. This profile adds an **integration-branch epic model** — children merge into a shared feature branch, the parent runs one integration test over the combined result, and only the parent promotes. The parent waits for children via `child --blocks--> parent` edges (not `kind='decomposes'`). Children run **serially** (cap=1). Deploys are triggered by CI/CD on branch push (no `forge_coolify_deploy` calls); `forge-test`/`forge-promote` poll the staging/production URL health endpoint for readiness, and deployMode is detected purely from whether `previewDeploy` exposes a staging URL.
- **Overlay**: 5 `SKILL.md` (`forge-plan`, `forge-code`, `forge-test`, `forge-release`, and a new `forge-promote`) + 1 reference (`forge-plan/references/epic-branch-model.md`, the deploy-agnostic shared model every overlay reads).
- **Excluded**: none.
- **Bundle size**: 26 skill files across 10 skills.
- **Requires**: the `forge_issues → mark_merged` / `unmark` MCP action for explicit `merged_at` stamping (falls back to the leave-release-state side-effect if absent); a CI/CD pipeline wired to deploy on `<baseBranch>` / `<productionBranch>` push; and a `<stagingUrl>` / `<productionUrl>` health endpoint to poll.

---

## Planned

### `nextjs-vercel-tbd`
Next.js single-repo on TBD. `forge-test` runs Vitest + Playwright against `pnpm dev`. `forge-release` tags a release; Vercel Git integration auto-deploys. Likely `excludeSkills: ["forge-staging"]`.

### `strapi-coolify-singlerepo`
Strapi 5 single-repo on GitFlow-lite. `forge-test` exercises Strapi REST against a docker-composed stack. `forge-release` pushes to productionBranch, Coolify webhook fires.

### `tauri-github-release`
Tauri desktop app on TBD. `forge-test` runs the Tauri integration harness. `forge-release` tags `v*.*.*` → GitHub Actions matrix-builds → GitHub Releases auto-undraft.

### `nestjs-postgres-cloudrun`
NestJS backend on TBD. `forge-test` runs E2E against docker-composed Postgres. `forge-release` pushes a container to Artifact Registry; Cloud Run deploys.

---

## Bundle anatomy

```
bundles/<profile>/
├── profile.json        # axis metadata (copied from profiles/<p>/profile.json)
└── skills/
    ├── forge-{...}/SKILL.md     # base or overlay-replaced
    │   └── references/...
    └── meta/...
```
