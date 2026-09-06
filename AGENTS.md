# codemap — router and repository rules

This document **points**; each rule lives where it can be enforced.

- **Where this is going → [`VISION.md`](./VISION.md).** The ceiling, and the three things it may not
  become on the way there.
- **Product goal, whose pain, and what may NOT be built → [`NORTH-STAR.md`](./NORTH-STAR.md).**
  Read §2 (whose pain) and §7 (what this will not do) **before proposing any feature**. A proposal
  that cannot be traced back to a pain in §2 is refused.
- Mechanism and contract → [`spec/SPEC.md`](spec/SPEC.md), then [`README.md`](README.md).
- When to reach for which tag → [`patterns/`](patterns/).
- The four sibling products this one sits in → `~/tools/repo-gates/NORTH-STAR.md`.
- Open work (issue tracker) → Forge, project `codemap`, projectId `c043de63-35a1-424c-b783-2c8052257abe`.
  That is where work state lives; do not write TODOs into the code.

## Language

**This repository is public and English-only.** Every tracked file, every commit message, and every
issue or PR body is written in English — documentation, skill bodies, `cm:` annotations, diagnostic
strings, and anything the CLI prints. Vietnamese belongs in the Forge tracker, in review
conversation, and in chat with the author; it does not belong in anything a stranger clones.
Speaking Vietnamese with the author while writing the repository in English is the normal case, not
a conflict.

## Layout

The repository root **is** the plugin. `cli/` is the source of truth for the checker; `spec/` is the
normative grammar; `patterns/` teaches it; `adapters/` carries the delivery paths that are not
Claude Code — `adapters/ci/` for pipelines, `adapters/mcp/` for any MCP host. `plugins/forge-codemap/scripts/cm.mjs` is a forwarding shim for repos whose upgrade
workflow hardcodes the pre-0.17 path — it carries a `cm:hack` with its exit condition.

## Gates

```bash
node tests/run.mjs   # golden corpus + wiring, install, metrics, upgrade-workflow and release tiers
bin/cm verify        # the repo checks itself with its own checker
```

Both run in CI on every push and pull request (`.github/workflows/ci.yml`).

## Releasing

Consumers pin by tag and the weekly upgrade bot reads that tag stream. Bump `version` in
`.claude-plugin/plugin.json` and push a matching `codemap-v<version>` tag in the same change —
`tests/release-tag.mjs` fails the build if you do not. That tag push also runs
`.github/workflows/notify-consumers.yml`, which fires `workflow_dispatch` on every vendored-tier
consumer's own upgrade workflow so it does not wait for its cron — see NORTH-STAR.md §9.

One line to remember: **redirect comments into data, do not ban comments.**
