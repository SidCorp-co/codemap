#!/usr/bin/env node
// The declared layer, reachable by an agent that has no idea what a Claude Code hook is.
//
// The hooks are the strongest delivery — injection needs no cooperation from the agent — but they
// exist in exactly one product, and NORTH-STAR §5 counts annotations written in repos this author
// does not own. An agent that cannot read the layer will not write into it, so the reach of the
// hooks is the ceiling on that number until something else can serve the same answers. This is that
// something else: MCP over stdio, newline-delimited JSON-RPC, zero dependencies like the rest.
//
// It answers, it does not enforce. Enforcement stays with the checker the repo committed.

import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { findRoot } from '../../cli/lib/registry.mjs';
import { resolveCm } from '../../cli/lib/locate.mjs';

const PROTOCOL = '2024-11-05';

const ROOT = (() => {
  const flag = process.argv.indexOf('--root');
  return findRoot(flag > -1 ? process.argv[flag + 1] : process.cwd());
})();

// cm:guard the tool list and TOOLS must stay one object — an entry advertised in tools/list that
// tools/call cannot dispatch is a tool an agent will call once, fail, and never trust again
const TOOLS = {
  codemap_impact: {
    description:
      'Declared blast radius of one file: the guards whoever edits it must obey, the edges in both '
      + 'directions, and its neighbours in any flow. Call this BEFORE editing a file — it carries the '
      + 'couplings no type-checker, LSP or grep can derive.',
    schema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'repo-relative path of the file about to change' } },
      required: ['path'],
    },
    argv: (a) => ['impact', a.path, '--json'],
  },
  codemap_graph: {
    description:
      'The whole declared graph of the repository — every guard, edge and flow step, as data. Use it '
      + 'to answer "what does this change touch" across files, languages and processes.',
    schema: { type: 'object', properties: {} },
    argv: () => ['graph', '--json'],
  },
  codemap_flow: {
    description:
      'Ordered trace of one named runtime flow across files and languages, or the list of flows when '
      + 'no name is given.',
    schema: { type: 'object', properties: { name: { type: 'string' } } },
    argv: (a) => (a.name ? ['flow', a.name] : ['flow']),
  },
  codemap_verify: {
    description:
      'Run the repository\'s own checker over the given paths (or the whole tree). Reports annotations '
      + 'that point at something gone, malformed annotations, and derivable prose. Read-only.',
    schema: {
      type: 'object',
      properties: {
        paths: { type: 'array', items: { type: 'string' } },
        tier: { type: 'string', enum: ['grammar', 'referential', 'structural', 'advisory', 'all'] },
      },
    },
    argv: (a) => ['verify', ...(a.paths ?? []), ...(a.tier ? ['--tier', a.tier] : []), '--json'],
  },
  codemap_ls: {
    description: 'Every annotation in the repository, with its file and line.',
    schema: { type: 'object', properties: {} },
    argv: () => ['ls'],
  },
};

function runCm(argv) {
  const { path, source } = resolveCm(ROOT);
  const res = spawnSync(process.execPath, [path, ...argv], {
    cwd: ROOT, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' },
  });
  const out = `${res.stdout ?? ''}${res.stderr ?? ''}`.trim();
  // cm:why a non-zero exit is the checker's verdict, not a transport failure — `cm verify` exits 1
  //   on findings, and swallowing that into an MCP error would hide the answer the caller asked for
  return { out: out || '(no output)', source, status: res.status ?? 1 };
}

// cm:guard a client that closes the pipe mid-answer must not crash the server — an MCP host that
// disconnects is ordinary, and an unhandled EPIPE here reads to the user as "the tool is broken"
process.stdout.on('error', (e) => {
  if (e.code !== 'EPIPE') throw e;
});

function reply(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
}

function fail(id, code, message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } })}\n`);
}

function handle(msg) {
  const { id, method, params } = msg;
  if (method === 'initialize') {
    return reply(id, {
      protocolVersion: PROTOCOL,
      capabilities: { tools: {} },
      serverInfo: { name: 'codemap', version: process.env.CODEMAP_VERSION ?? 'dev' },
      instructions:
        'Before editing a file, call codemap_impact on it and obey what comes back: a GUARD is a rule '
        + 'the edit must not break, and an EDGE means the other side may need the same change in the '
        + 'same commit.',
    });
  }
  if (method === 'tools/list') {
    return reply(id, {
      tools: Object.entries(TOOLS).map(([name, t]) => ({
        name, description: t.description, inputSchema: t.schema,
      })),
    });
  }
  if (method === 'tools/call') {
    const tool = TOOLS[params?.name];
    if (!tool) return fail(id, -32602, `unknown tool: ${params?.name}`);
    const { out, source, status } = runCm(tool.argv(params.arguments ?? {}));
    return reply(id, {
      content: [{ type: 'text', text: out }],
      isError: false,
      _meta: { checker: source, exitCode: status },
    });
  }
  if (method === 'ping') return reply(id, {});
  if (id !== undefined) fail(id, -32601, `unknown method: ${method}`);
}

createInterface({ input: process.stdin }).on('line', (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return fail(null, -32700, 'parse error');
  }
  try {
    handle(msg);
  } catch (e) {
    if (msg.id !== undefined) fail(msg.id, -32603, e.message);
  }
});
