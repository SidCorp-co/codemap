# Forge Pipeline Skills

Claude Code skill templates for Forge-driven project pipelines. Organized as **one canonical base + per-profile overlays** so the same set of patterns scales across stacks without duplicating prose.

## What's here

- **Base canonical set** — `skills/` — 9 `forge-*` pipeline skills (triage → clarify → plan → code → review → test → staging → release → fix) plus `meta/`. Generic, Coolify-aware, fully placeholder-driven. **One source of truth.**
- **Profiles** — `profiles/<descriptor>/` — per-stack overlays + exclusion lists. Each profile is the **delta** from base for one real-world deployment shape (e.g., TBD without remote deploy, GitFlow-lite with Coolify).
- **Bundles** — `bundles/<descriptor>/` — generated drop-in artefacts: base + overlay − excluded skills. Commit them so consumers can `cp` directly.

## Quick install

```bash
# Pick a profile (see BUNDLES.md for the catalogue):
cp -r bundles/webapp-coolify-gitflow/skills/* /path/to/your-project/.claude/skills/
```

## Layout

```
forge-pipeline-skills/
├── skills/                          # base canonical (Coolify-aware generic)
│   ├── forge-triage/    forge-clarify/    forge-plan/
│   ├── forge-code/      forge-review/     forge-test/
│   ├── forge-staging/   forge-release/    forge-fix/
│   └── meta/forge-memory-builder/
├── profiles/
│   ├── _template/                   # copy this to start a new profile
│   ├── pnpm-monorepo-tbd-local/     # TBD · local-E2E · no remote deploy
│   └── webapp-coolify-gitflow/      # GitFlow-lite · Coolify
├── bundles/                         # generated artefacts (committed for drop-in)
├── conventions/
│   └── placeholders.md              # placeholder catalogue + lint policy
├── tools/
│   ├── build-bundle.sh              # base + overlay − excludes → bundles/<name>
│   ├── lint-skill.sh                # block UUIDs / hosts / project names / secrets
│   └── diff-overlay.sh              # show how an overlay diverges from base
├── BUNDLES.md                       # human-facing catalogue
└── CONTRIBUTING.md
```

## Layering rules

1. **Base** (`skills/`) is the most-complete pattern. Everything starts here.
2. **Overlay** (`profiles/<p>/overlays/<skill>/SKILL.md`) replaces a base file **whole** (no section-patch). A path absent from overlays → base wins.
3. **Exclude** (`profile.json.excludeSkills: ["forge-staging"]`) deletes a skill from the bundle entirely. Use this when a skill is genuinely N/A in the profile's flow — keeps the bundle clean instead of shipping a deprecated stub.

The build is two `rsync` calls + a delete loop. No templating, no macros.

## Contributing a new profile

See `profiles/_template/README.md`. In brief:

1. Copy `_template/` to `profiles/<descriptor>/`. **Use a stack descriptor, never a project name** — e.g., `nextjs-vercel-tbd`, not `myapp`.
2. Fill `profile.json` (4 axes: `stack` × `branching` × `deploy` × `verification`).
3. Put **only the files that diverge from base** under `overlays/`.
4. List **N/A skills** in `excludeSkills`.
5. Run `tools/lint-skill.sh` then `tools/build-bundle.sh <descriptor>`.
6. Add a row to `BUNDLES.md`.

## Hygiene

No real project / user / org / host / credential values may appear in skill bodies. Use the placeholders in `conventions/placeholders.md` or obvious examples. `tools/lint-skill.sh` enforces this and runs in CI.
