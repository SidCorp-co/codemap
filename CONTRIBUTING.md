# Contributing

Thanks for considering a contribution. This repo collects Claude Code skill templates for common project stacks; the goal is small, high-quality, opinionated bundles — not exhaustive coverage.

## What's in scope

- **New bundle for a stack we don't cover** — e.g. Django, Rails, Flutter, Go monorepo.
- **New skill variant** for an existing stage — e.g. `forge-test/playwright-mocked-network.md`.
- **Snippet** that several skills reference — e.g. a React performance checklist for `forge-review`.
- **CI / validator improvements** in `tools/`.
- **README / BUNDLES docs** — anything that helps newcomers pick the right bundle.

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
- Body contains non-English content (placeholder names like `<project>` are fine).
- File contains hardcoded credentials (gitleaks scan).

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
- [ ] Frontmatter valid (run `npx skill-validator` locally)
- [ ] English-only
- [ ] No hardcoded credentials
- [ ] README/BUNDLES updated if adding a bundle
```

## Code of conduct

Be kind, be specific, be willing to be wrong. Maintainers reserve the right to close PRs that don't engage with the review feedback after a reasonable window.
