# forge-pipeline-skills

Open-source Claude Code skill templates organized by **project stack × pipeline stage**. Drop-in `.claude/skills/` bundles for Forge pipeline (and generic Claude Code workflows) so a new project can adopt a battle-tested skill chain in minutes instead of hand-writing each `SKILL.md`.

Compatible with the [agentskills.io](https://agentskills.io) open standard — skills here also work in Cursor, Codex, Gemini CLI, and any other client that reads the standard.

## What's here

```
skills/                            ← atomic skills, organized by category
├── forge/                         ← Forge pipeline stages × stacks (planned)
└── meta/                          ← memory / skill management
    └── forge-memory-builder/

bundles/                           ← curated install-ready combinations
└── forge-monorepo-pnpm-tbd/       ← MVP: TBD + pnpm workspaces + local-E2E
    └── skills/
        ├── forge-triage/
        ├── forge-plan/
        ├── forge-clarify/
        ├── forge-code/
        ├── forge-review/
        ├── forge-test/
        ├── forge-fix/
        ├── forge-release/
        └── forge-staging/         ← deprecated no-op, kept for legacy state hits

tools/                             ← validator + bootstrap CLI (planned)
snippets/                          ← reusable review/test checklists (planned)
```

## Install

### A. Copy a bundle into your project

```bash
git clone --depth 1 https://github.com/SidCorp-co/forge-pipeline-skills /tmp/forge-pipeline-skills
cp -r /tmp/forge-pipeline-skills/bundles/forge-monorepo-pnpm-tbd/skills/* .claude/skills/
```

### B. Mount via `--add-dir` (no copy)

```bash
claude code --add-dir /path/to/forge-pipeline-skills/bundles/forge-monorepo-pnpm-tbd
```

### C. (Future) `npx skill-bootstrap`

Detects your stack and copies the right bundle. Not yet shipped.

## Bundle matrix

| Bundle | Stack | Branching | Release target | Status |
|---|---|---|---|---|
| `forge-monorepo-pnpm-tbd` | pnpm workspaces, multi-package | Trunk-Based | merge to `main` + local-E2E | ✅ MVP |
| `forge-nextjs-tbd-vercel` | Next.js single repo | Trunk-Based | Vercel | 📅 planned |
| `forge-strapi-coolify` | Strapi 5 single repo | GitFlow-lite | Coolify | 📅 planned |
| `forge-tauri-github-release` | Tauri desktop | Trunk-Based | tag-driven release.yml | 📅 planned |

## What each Forge stage skill does

| Stage | Skill | Responsibility |
|---|---|---|
| `open` | `forge-triage` | Classify complexity/category, sanity-check AC |
| `needs_info` | `forge-clarify` | Reproduce bug / verify UX expectations |
| `confirmed` | `forge-plan` | Write implementation plan referencing code |
| `approved` | `forge-code` | Branch, implement, build, test, push |
| `developed` | `forge-review` | Independent diff review, verdict-driven advance |
| `testing` | `forge-test` | Boot servers, walk AC via Playwright |
| `reopen` | `forge-fix` | Apply scoped fix from review/QA feedback |
| `released` | `forge-release` | Merge to main, push, cleanup, auto-close |
| `staging` | `forge-staging` | DEPRECATED no-op (kept for state-machine compat) |

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). Short version: new stack? Add a `bundles/forge-<stack>-<flow>-<deploy>/` directory. New skill variant? Add under `skills/<category>/<name>/<variant>/SKILL.md`. CI validates frontmatter + structure.

## License

MIT — see [LICENSE](./LICENSE).
