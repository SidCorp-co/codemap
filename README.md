<div align="center">

# 🔥 Forge Pipeline Skills

**Claude Code skill templates for Forge-driven project pipelines.**

One canonical base + per-profile overlays — the same patterns scale across stacks without duplicating prose.

[![Claude Code Plugin](https://img.shields.io/badge/Claude%20Code-Plugin-d97757)](https://docs.claude.com/en/docs/claude-code/plugins)
[![Version](https://img.shields.io/badge/version-0.2.0-blue)](.claude-plugin/plugin.json)
[![License: MIT](https://img.shields.io/badge/License-MIT-green)](LICENSE)

</div>

---

## The pipeline

An issue flows through nine `forge-*` skills, from intake to shipped and back:

```
triage → clarify → plan → code → review → test → staging → release
   ↑                                                            │
   └──────────────────────── fix ◄─────────────────────────────┘
```

Every skill is generic, Coolify-aware, and fully placeholder-driven — **one source of truth**.

## Install

### As a Claude Code plugin — recommended

```
/plugin marketplace add SidCorp-co/forge-pipeline-skills
/plugin install forge-pipeline-skills@forge
```

Loads the full **base** skill set. Skills become available immediately, e.g. `/forge-triage`, `/forge-plan`.

> [!NOTE]
> The plugin loader always ships the base `skills/` set. Profiles/bundles (below) are a repo-specific convention for producing trimmed, stack-specific drop-ins — the loader does **not** apply profile overlays or exclusions.

### As a drop-in bundle — per stack

Pick a profile from the [catalogue](BUNDLES.md) and copy its bundle into your project:

```bash
cp -r bundles/webapp-coolify-gitflow/skills/* /path/to/your-project/.claude/skills/
```

## Skills

### Pipeline

| Skill | Stage | What it does |
|---|---|---|
| `forge-triage` | Intake | Validate & classify new issues before they enter development |
| `forge-clarify` | Intake | Reproduce bugs, verify UX, resolve ambiguity before planning |
| `forge-plan` | Design | Write the implementation plan for a confirmed issue |
| `forge-code` | Build | Implement the approved change on a feature branch |
| `forge-review` | Verify | Independent code review with fresh eyes |
| `forge-test` | Verify | QA against the preview deployment, like a human tester |
| `forge-staging` | Ship | Merge to `baseBranch` for staging deployment |
| `forge-release` | Ship | Merge to production branch and trigger deploy |
| `forge-fix` | Loop | Address review / QA feedback on a rejected issue |

### Meta

| Skill | What it does |
|---|---|
| `meta/forge-guidebook` | Generate friendly, task-oriented end-user docs from source |
| `meta/forge-memory-builder` | Self-driving memory-health agent for Claude Code auto-memory |

### Utility

| Skill | What it does |
|---|---|
| `ui-discover` | Discover & verify live external UI/UX resources (styles, libraries, chart types) and return a filtered shortlist |

## Concepts

- **Base** — `skills/` — the most-complete, canonical pattern. Everything starts here.
- **Profiles** — `profiles/<descriptor>/` — the **delta** from base for one real-world shape (e.g. TBD without remote deploy, GitFlow-lite with Coolify). Defined by 4 axes: `stack` × `branching` × `deploy` × `verification`.
- **Bundles** — `bundles/<descriptor>/` — generated drop-in artefacts (base + overlay − excluded skills), committed so consumers can `cp` directly without running the build.

### Layering rules

1. **Base** (`skills/`) always wins unless overridden.
2. **Overlay** (`profiles/<p>/overlays/<skill>/SKILL.md`) replaces a base file **whole** — no section-patch. A path absent from overlays → base wins.
3. **Exclude** (`profile.json.excludeSkills`) removes a skill from the bundle entirely — use when a skill is genuinely N/A in the profile's flow.

The build is two `rsync` calls + a delete loop. No templating, no macros.

## Layout

```
forge-pipeline-skills/
├── .claude-plugin/
│   ├── plugin.json                 # plugin manifest
│   └── marketplace.json            # marketplace entry (enables /plugin install)
├── skills/                         # base canonical (Coolify-aware generic)
│   ├── forge-triage/   forge-clarify/   forge-plan/
│   ├── forge-code/     forge-review/    forge-test/
│   ├── forge-staging/  forge-release/   forge-fix/
│   └── meta/           forge-guidebook/ forge-memory-builder/
├── profiles/
│   ├── _template/                  # copy this to start a new profile
│   ├── pnpm-monorepo-tbd-local/    # TBD · local-E2E · no remote deploy
│   └── webapp-coolify-gitflow/     # GitFlow-lite · Coolify
├── bundles/                        # generated artefacts (committed for drop-in)
├── conventions/
│   └── placeholders.md             # placeholder catalogue + lint policy
├── tools/
│   ├── build-bundle.sh             # base + overlay − excludes → bundles/<name>
│   ├── lint-skill.sh               # block UUIDs / hosts / project names / secrets
│   └── diff-overlay.sh             # show how an overlay diverges from base
├── BUNDLES.md                      # human-facing catalogue
└── CONTRIBUTING.md
```

## Contributing a new profile

See `profiles/_template/README.md`. In brief:

1. Copy `_template/` to `profiles/<descriptor>/`. **Use a stack descriptor, never a project name** — e.g. `nextjs-vercel-tbd`, not `myapp`.
2. Fill `profile.json` (4 axes: `stack` × `branching` × `deploy` × `verification`).
3. Put **only the files that diverge from base** under `overlays/`.
4. List **N/A skills** in `excludeSkills`.
5. Run `tools/lint-skill.sh`, then `tools/build-bundle.sh <descriptor>`.
6. Add a row to `BUNDLES.md`.

## Hygiene

No real project / user / org / host / credential values may appear in skill bodies. Use the placeholders in `conventions/placeholders.md` or obvious examples. `tools/lint-skill.sh` enforces this and runs in CI.

## License

[MIT](LICENSE) © SidCorp-co
