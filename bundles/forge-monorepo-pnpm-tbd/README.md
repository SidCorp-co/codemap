# forge-monorepo-pnpm-tbd

Forge pipeline skill bundle for a pnpm-workspace monorepo on Trunk-Based Development with local-E2E verification.

## Stack assumptions

- **Package manager**: pnpm with `pnpm-workspace.yaml`
- **Repo layout**: multi-package under `packages/<name>/`
- **Branching**: TBD — short-lived `ISS-*` branches from `main`, merged back the same day, no `develop` / `staging` branches
- **Worktree default**: `.claude/worktrees/iss-<NN>-<slug>/` so parallel issue sessions don't collide
- **Verification**: forge-test boots local dev servers (e.g. Hono on 8080, Next.js on 3000) and walks acceptance criteria via Playwright MCP
- **Release**: forge-release squash-merges `ISS-*` to `main`, pushes, deletes the worktree + branch, auto-closes the issue
- **Remote name**: configurable; defaults to `github` (override per project)

## Skills included

| Stage | Skill | What it does |
|---|---|---|
| `open` | forge-triage | Classify complexity/category; route confirmed or needs_info |
| `needs_info` | forge-clarify | Reproduce bug / verify UX with Playwright; return to confirmed |
| `confirmed` | forge-plan | Write implementation plan into `issue.plan` |
| `approved` | forge-code | Create worktree + branch, implement, build, push |
| `developed` | forge-review | Independent diff review; APPROVE → testing or REQUEST CHANGES → reopen |
| `testing` | forge-test | Spin local servers + Playwright walk; auto-advance through pass → staging → released |
| `reopen` | forge-fix | Apply scoped fix from review/QA feedback |
| `released` | forge-release | Merge to main, push, cleanup, auto-close |
| `staging` | forge-staging | No-op (deprecated; kept for state-machine compatibility) |

## Install into your project

```bash
git clone --depth 1 https://github.com/SidCorp-co/pipeline-skills /tmp/ps
cp -r /tmp/ps/bundles/forge-monorepo-pnpm-tbd/skills/* .claude/skills/
```

Or mount without copying:

```bash
claude code --add-dir /path/to/pipeline-skills/bundles/forge-monorepo-pnpm-tbd
```

## Customization

After installing, you'll likely need to adjust per-project:

1. **Remote name** if not `github` — edit the `REMOTE=$(git remote | head -1)` block in `forge-code`, `forge-fix`, `forge-release`.
2. **Build / test commands** — search for `pnpm --filter` and `npm run` references; adjust per your workspace package names.
3. **Local dev ports** in `forge-test` — search for `:8080`, `:3000` if your services use different ports.
4. **Deploy mechanism** in `forge-release` — current version does merge-to-main only; add your deploy hook (Coolify webhook, Vercel auto-deploy, Tauri release.yml trigger, etc.) at the end of the merge flow.
5. **English-only enforcement** in `forge-review` — keep this on for OSS repos; disable if your project is internal.

## Compatibility

This bundle is built against the [agentskills.io](https://agentskills.io) open standard; skills also work in Cursor, Codex, Gemini CLI, and other clients implementing the standard. Forge-MCP-specific calls (e.g. `forge_issues`, `forge_comments`) require a wired Forge MCP server — without it, the skills still run but skip the Forge integration steps.
