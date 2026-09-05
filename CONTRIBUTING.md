# Contributing

This repo carries one thing: the `forge-codemap` plugin under [`plugins/forge-codemap/`](plugins/forge-codemap).

## Before proposing a feature

Read [`NORTH-STAR.md`](plugins/forge-codemap/NORTH-STAR.md) first — it states what codemap is for and,
more usefully, what may **not** be built. A feature that lets an annotation say something a tool can
already derive is out of scope by construction.

## Feedback that is always in scope

Open an issue from one of the four forms in [`.github/ISSUE_TEMPLATE/`](.github/ISSUE_TEMPLATE):

| Form | When |
|---|---|
| blocked wrongly | the checker refused a comment it should have allowed |
| slop got through | derivable prose passed the gate |
| cannot express | a real coupling that none of the five annotations can carry |
| friction | the tool made you work around it |

## Changing the plugin

```bash
node plugins/forge-codemap/tests/run.mjs     # the golden corpus — must stay green
plugins/forge-codemap/bin/cm verify          # this repo checks itself
```

The corpus is the contract: a behaviour change without a case in `plugins/forge-codemap/tests/cases.mjs`
is not a change anyone can rely on.

## Releasing

Consumers pin by tag, and the weekly upgrade bot reads that tag stream — see
`plugins/forge-codemap/agent-setup/codemap-upgrade.yml`. Bump the `version` in
`plugins/forge-codemap/.claude-plugin/plugin.json` and push a matching `codemap-v<version>` tag in
the same change, or the bot goes quiet with nothing to report.

## Language

This repository is public and **English-only**: documentation, code, comments, commit messages, and
issue or PR bodies. The rule and its rationale live in [`AGENTS.md`](AGENTS.md).
