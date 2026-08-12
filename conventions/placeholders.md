# Placeholders & content hygiene

Skill markdown in this repo is **stack-pattern code**, not a per-project artefact. Two rules:

1. **No real project-, user-, or org-specific values.** Anything that varies per deployment must be a placeholder the agent resolves at runtime from project config / MCP tools.
2. **Examples are fine, real values are not.** If you need a concrete illustration in prose, use the obviously-fake markers in [Allowed example markers](#allowed-example-markers).

`tools/lint-skill.sh` enforces this on `skills/` and every `profiles/*/overlays/` and runs in CI.

## Allowed placeholders

Write the placeholder literally in skill text. The agent resolves it from the named source at runtime.

| Placeholder | Source (MCP / context) | Example value |
|---|---|---|
| `<baseBranch>` | `forge_projects → get .baseBranch` | `release/stg`, `develop` |
| `<productionBranch>` | `forge_projects → get .productionBranch` | `main`, `master` |
| `<repoPath>` | `forge_projects → get .repoPath` | filesystem path on the runner |
| `<remoteName>` | `forge_config → get .remoteName` (default `origin`) | `origin`, `github` |
| `<documentId>` | current issue context | issue's documentId UUID — required by `forge_coolify_deploy → deploy` |
| `<id>` | short ISS number for a specific issue | `42` |
| `<stagingUrl>` | `forge_projects → get .previewDeploy.testingUrls[].url` | the project's staging URL |
| `<productionUrl>` | `forge_projects → get` (project's production URL field) | the project's production URL — used by CI-on-push profiles for the post-deploy health poll |
| `<testCredentials>` | `forge_projects → get .previewDeploy.testCredentials` | username/password for staging |
| `<agentName>` | profile / project config | `release-agent`, `qa-agent`, … (avoid character names) |
| `<resourceUuid>` | `forge_coolify_deploy → list[].resourceUuid` | Coolify resource — never hardcode |
| `<integrationId>` | `forge_coolify_deploy → list[].id` | Coolify integration row id |

Naming convention: angle-brackets, lowercase camelCase inside, matching the source field name where possible (`<baseBranch>` mirrors `project.baseBranch`).

## Allowed example markers

When prose absolutely needs an illustrative value, use one of these — `lint-skill.sh` will not flag them:

- `00000000-0000-0000-0000-000000000000` — zero UUID (placeholder UUID)
- `ffffffff-ffff-ffff-ffff-ffffffffffff` — sentinel UUID
- `example.com`, `example.org`, `your-domain.com` — example hosts

## Banned (lint will reject)

- Real UUIDs (v1–v5). Use `<documentId>` / `<resourceUuid>` / `<integrationId>` instead.
- Coolify-style 20+ char lowercase-alnum mixed-letter-digit tokens.
- `Bearer <token>` literals.
- `password|api_key|secret|access_token = …` literals.
- Specific company hosts: `*.sidcorp.co`, `*.anhome.app`, `*.musetools.com`, `*.grytt.co`, `*.canawan.com`, `*.ts.net`.
- Project codenames: `anhome`, `jarvis`, `forge-dev`, `musetools`, `sidcorp` (case-insensitive whole-word). Generic words `forge`, `coolify`, `vercel` are fine.
- IPv4 literals.

If you genuinely need to mention one of these in skill content (e.g., a documentation URL), use the equivalent example or rephrase.

## Why this matters

A skill imported into a fresh project must work without leaking the maintainer's other projects' identifiers, and without baking in values the agent should look up live. Treat the repo as if it will be public — because it will.
