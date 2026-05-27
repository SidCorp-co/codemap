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
