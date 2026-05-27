# Contributing

Thanks for considering a contribution. This repo collects Claude Code skill templates for common project stacks; the goal is small, high-quality, opinionated bundles — not exhaustive coverage.

## Repo model (read this first)

This repo follows a **base + per-profile overlay** model, not "one bundle per stack copies everything":

- `skills/` is the **canonical base** — one source of truth for the pattern.
- `profiles/<descriptor>/overlays/` carries **only the files that diverge** from base for that profile's stack/branching/deploy/verification.
- `profile.json.excludeSkills` removes skills that are genuinely N/A in the profile (no stub files).
- `bundles/<descriptor>/` is the generated drop-in artefact (`tools/build-bundle.sh`).

See `README.md` and `profiles/_template/README.md` for the contract.

## What's in scope

- **New profile** for a stack/flow we don't cover — descriptor name only (e.g., `django-coolify-tbd`), not project name.
- **Improvements to base** — when a change benefits every profile (placeholder fix, prose clarity, new MCP tool reference).
- **New snippet** that several skills reference — `snippets/` is fine.
- **Tooling** improvements in `tools/` (lint rules, build options).
- **Docs** — README / BUNDLES / placeholders catalogue / contributing.

## What's out of scope

- Skills tightly coupled to a closed-source product (e.g. proprietary deploy platform with no OSS path).
- Skills that hardcode credentials, internal hostnames, or company-specific paths. Use placeholders.
- Skills duplicating an existing bundle's content with cosmetic changes.

## Skill spec compliance

Every `SKILL.md` must conform to the [agentskills.io](https://agentskills.io) open standard (also documented in [Claude Code docs](https://code.claude.com/docs/en/skills)):

```yaml
---
name: forge-code               # short kebab-case, must match parent dir
description: "One-line summary used by the model to decide when to invoke."
user_invocable: true           # optional; default false
arguments: "documentId"        # optional; only if user_invocable
---
```

Body structure depends on intent. For workflow skills (forge-*), follow:

```markdown
# Skill name — one-line intent

Short paragraph framing the skill's job.

## Workflow

1. Numbered steps.
2. Each step has a clear input → action → output.

## Output rules / constraints
```

CI rejects PRs where:
- Frontmatter has invalid YAML or missing required fields.
- `name` doesn't match parent dir.
- `description` is empty or > 250 chars.
- Body contains non-English content (placeholder names like `<baseBranch>` are fine).
- `tools/lint-skill.sh` finds denied tokens — real UUIDs, hostnames, project names, bearers, or secrets. See `conventions/placeholders.md` for the policy and the allowed placeholder catalogue.

## English-only

All skill content (frontmatter description, body, code examples, comments) must be English. User-facing strings in code examples should also be English. We accept localized examples in `snippets/i18n/` only if they document an i18n pattern, not as primary skill content.

## PR template

```
## What
<one-line summary>

## Bundle / skill affected
<paths>

## Tested against
<project name + commit, or "synthetic example">

## Checklist
- [ ] Skill name matches parent dir
- [ ] Frontmatter valid; `tools/lint-skill.sh` clean
- [ ] English-only
- [ ] No real project names, UUIDs, hostnames, or credentials — placeholders / examples only
- [ ] README/BUNDLES updated if adding a bundle
```

## Code of conduct

Be kind, be specific, be willing to be wrong. Maintainers reserve the right to close PRs that don't engage with the review feedback after a reasonable window.
