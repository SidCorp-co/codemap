# Bundles

Curated install-ready combinations. Each bundle ships every `SKILL.md` needed to wire up a project end-to-end for its stack profile. Pick the bundle closest to your project; tweak the individual skills as needed (they're plain markdown).

## Available

### `forge-monorepo-pnpm-tbd`

For a pnpm-workspace monorepo on Trunk-Based Development with local-E2E verification before merging to `main`.

- **Stack**: pnpm workspaces, multi-package (`packages/core`, `packages/web`, ...)
- **Branching**: TBD — short-lived `ISS-*` branches from `main`, merged back same-day
- **Verification**: forge-test boots local dev servers + walks acceptance criteria via Playwright MCP
- **Release**: forge-release squash-merges to `main`, pushes, auto-closes the issue
- **Worktree default**: yes (`.claude/worktrees/iss-XX-<slug>/`)
- **Remote name**: `github` (configurable)

Skills included:
1. `forge-triage` — open → confirmed/needs_info
2. `forge-clarify` — needs_info → confirmed (reproduce + verify)
3. `forge-plan` — confirmed → approved
4. `forge-code` — approved → developed (TBD branch + push)
5. `forge-review` — developed → testing (APPROVE) or reopen (REQUEST CHANGES)
6. `forge-test` — testing → pass → staging → released (local E2E)
7. `forge-fix` — reopen → developed (scoped fix from feedback)
8. `forge-release` — released → closed (merge main + cleanup)
9. `forge-staging` — no-op (deprecated; kept so state machine doesn't error)

Install: `cp -r bundles/forge-monorepo-pnpm-tbd/skills/* .claude/skills/`

## Planned

### `forge-nextjs-tbd-vercel`
Next.js single-repo on TBD, deploys via Vercel Git integration. forge-test runs Vitest + Playwright against `pnpm dev`. forge-release tags a release; Vercel auto-deploys.

### `forge-strapi-coolify`
Strapi 5 single-repo on GitFlow-lite (`develop` + `main`). forge-test hits the Strapi REST API on a Docker-composed stack. forge-release pushes to `main`, Coolify webhook fires.

### `forge-tauri-github-release`
Tauri desktop app, TBD. forge-test runs Tauri integration test harness. forge-release tags `v*.*.*` → `release.yml` matrix-builds → GitHub Releases auto-undraft.

### `forge-nestjs-postgres-cloud-run`
NestJS backend on TBD. forge-test runs e2e against a Docker-composed Postgres. forge-release pushes a container to Artifact Registry, Cloud Run deploys.

## Bundle anatomy

Every bundle ships:

```
bundles/<bundle-name>/
├── .claude-plugin/plugin.json     ← plugin marketplace metadata
├── README.md                       ← stack assumptions, install steps
└── skills/                         ← all skills the bundle owns
    └── <skill-name>/SKILL.md
```

## Contributing a new bundle

1. Pick a name: `forge-<stack>-<flow>-<deploy>` (e.g. `forge-django-gitflow-fly`).
2. Copy the closest existing bundle as a starting point.
3. Adjust every `SKILL.md` body to reflect your stack's:
   - build/test/lint commands
   - branch strategy
   - deploy mechanism
   - code conventions
4. Write `bundles/<your-bundle>/README.md` explaining assumptions.
5. Add a row to the "Available" table above + the matrix in root README.
6. Open a PR — CI validates frontmatter + body structure per Claude Code spec.
