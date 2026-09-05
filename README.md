<div align="center">

# codemap

**The declared-edge layer for source code — as a Claude Code plugin.**

[![Claude Code Plugin](https://img.shields.io/badge/Claude%20Code-Plugin-d97757)](https://docs.claude.com/en/docs/claude-code/plugins)
[![Version](https://img.shields.io/badge/codemap-0.16.1-blue)](plugins/forge-codemap/.claude-plugin/plugin.json)
[![License: MIT](https://img.shields.io/badge/License-MIT-green)](LICENSE)

</div>

---

LSP derives references. The type system derives shapes. Paths derive modules. git derives history.
CodeMap carries the complement — cross-language contracts, cross-process flows, edit-time
invariants — as one-line `cm:` annotations, and hands them to whoever edits the file.

```bash
claude plugin marketplace add SidCorp-co/codemap
claude plugin install forge-codemap@forge
```

**The plugin, its CLI, the rules and the whole guidebook live in
[`plugins/forge-codemap/`](plugins/forge-codemap/README.md).** Start there.

- [`README.md`](plugins/forge-codemap/README.md) — install, onboard a repo, who enforces
- [`NORTH-STAR.md`](plugins/forge-codemap/NORTH-STAR.md) — what this is for, and what may not be built
- [`SPEC.md`](plugins/forge-codemap/SPEC.md) — codemap/1, the annotation grammar
- [`CASE-STUDY.md`](plugins/forge-codemap/CASE-STUDY.md) — what it caught in a real repo

## What used to be here

This repo also carried `forge-pipeline-skills` — a base + overlay + bundle set of nine `forge-*`
pipeline skills. It is **superseded by [`SidCorp-co/forge-plugin`](https://github.com/SidCorp-co/forge-plugin)**,
whose `issue-flow`, `dispatch` and `gate-review` skills replace it. The old set is reachable at the
tag [`pipeline-final`](https://github.com/SidCorp-co/codemap/tree/pipeline-final); nothing consumes it any more.

The marketplace is still named `forge`, so `forge-codemap@forge` keeps resolving for every repo
already installed.

## License

[MIT](LICENSE) © SidCorp-co
