# codemap — repository rules

This repository carries one product: the `forge-codemap` plugin under `plugins/forge-codemap/`.
Its router, goal and non-goals live in [`plugins/forge-codemap/AGENTS.md`](plugins/forge-codemap/AGENTS.md)
and [`NORTH-STAR.md`](plugins/forge-codemap/NORTH-STAR.md). Read those before proposing a feature.

## Language

**This repository is public and English-only.** Every tracked file, every commit message, and every
issue or PR body is written in English — documentation, skill bodies, `cm:` annotations, diagnostic
strings, and anything the CLI prints. Vietnamese belongs in the Forge tracker, in review
conversation, and in chat with the author; it does not belong in anything a stranger clones.
Speaking Vietnamese with the author while writing the repository in English is the normal case, not
a conflict.

## Gates

```bash
node plugins/forge-codemap/tests/run.mjs   # golden corpus — must stay green
plugins/forge-codemap/bin/cm verify        # the repo checks itself with its own checker
```

Both run in CI on every push and pull request (`.github/workflows/ci.yml`).

## Releasing

Consumers pin by tag and the weekly upgrade bot reads that tag stream. Bump `version` in
`plugins/forge-codemap/.claude-plugin/plugin.json` and push a matching `codemap-v<version>` tag in
the same change — `tests/release-tag.mjs` fails the build if you do not.
