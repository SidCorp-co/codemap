# The MCP adapter

The declared layer, reachable by an agent that knows nothing about Claude Code hooks.

Zero dependencies, stdio, newline-delimited JSON-RPC. It **answers**; it does not enforce.
Enforcement stays with the checker the repository committed — the adapter resolves `cm` in the same
order everything else does (`.forge/codemap/cm` wins), and every answer names which copy produced it.

## Why it exists

A `PreToolUse` hook is the strongest possible delivery: it needs no cooperation from the agent. It
also exists in exactly one product. [`NORTH-STAR.md`](../../NORTH-STAR.md) §5 counts annotations
written in repositories this author does not own, and an agent that cannot read the layer will never
write into it. The hook's reach is therefore the ceiling on that number — until something else can
serve the same answers. This is that something else ([`VISION.md`](../../VISION.md) §3.1).

## Tools

| Tool | Answers |
|---|---|
| `codemap_impact` | one file's declared blast radius — guards, edges both ways, flow neighbours |
| `codemap_graph` | the whole declared graph, as data |
| `codemap_flow` | ordered trace of one named flow across files and languages |
| `codemap_verify` | run the repo's own checker over paths or the tree (read-only) |
| `codemap_ls` | every annotation, with file and line |

## Wiring it up

**Claude Code** — `.mcp.json` in the project (the hooks already cover this host; use the adapter when
you want the same answers as callable tools):

```json
{
  "mcpServers": {
    "codemap": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/adapters/mcp/server.mjs", "--root", "."]
    }
  }
}
```

**Any other MCP host** (Cursor, Codex CLI, Zed, an SDK agent) — point it at the file. The server
takes `--root <dir>`; without it, it walks up from the working directory to the nearest `.forge` or
`.git`.

```json
{
  "mcpServers": {
    "codemap": { "command": "node", "args": ["/path/to/codemap/adapters/mcp/server.mjs"] }
  }
}
```

**No MCP host at all.** The cheapest integration is a line in the repository's agent instructions —
`AGENTS.md`, `CLAUDE.md`, a system prompt:

> Before editing a file, run `cm impact <file>` and obey what it prints. A GUARD is a rule the edit
> must not break. An EDGE means the other side may need the same change in the same commit.

That path has no protocol and no server, and it is worth measuring against this one.

## The experiment this is for

The open question is not whether the server works — `tests/mcp.mjs` answers that. It is **whether an
agent that is merely offered the layer actually consults it before editing**, and which framing gets
it to: the tool description, the `initialize` instructions, or a plain sentence in the repo's
instructions file.

Run it in a repo you do not own the agent for, and record what happened in the tracker. A "yes" turns
rungs 2–5 of the vision from speculation into a distribution problem; a "no" is the most valuable
falsification available to this product right now, and it should be recorded as such rather than
worked around.
