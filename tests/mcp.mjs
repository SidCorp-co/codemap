// MCP adapter tier. The hooks have their own wiring tests because a hook that never fires looks
// exactly like a clean repo; this adapter has the same failure shape — a host that gets a malformed
// initialize result drops the server silently and the agent simply never sees the layer.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function talk(server, root, messages) {
  const res = spawnSync(process.execPath, [server, '--root', root], {
    input: messages.map((m) => JSON.stringify(m)).join('\n') + '\n',
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
  const lines = `${res.stdout}`.split('\n').filter(Boolean);
  return { frames: lines.map((l) => JSON.parse(l)), stderr: res.stderr, status: res.status };
}

function fixtureRepo() {
  const root = mkdtempSync(join(tmpdir(), 'cm-mcp-'));
  mkdirSync(join(root, '.forge'));
  writeFileSync(join(root, '.forge', 'codemap.json'), '{}\n');
  writeFileSync(join(root, 'a.ts'),
    '// cm:guard the lock is held by the caller, never taken here\n'
    + '// cm:edge contract -> b.ts — the token emitted here must have a matching pattern there\n'
    + 'export const a = 1;\n');
  writeFileSync(join(root, 'b.ts'), 'export const b = 2;\n');
  return root;
}

export function mcpCases(pluginRoot, check) {
  const server = join(pluginRoot, 'adapters', 'mcp', 'server.mjs');
  const root = fixtureRepo();
  try {
    const { frames, stderr } = talk(server, root, [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'codemap_impact', arguments: { path: 'a.ts' } } },
      { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'codemap_nope', arguments: {} } },
    ]);

    const init = frames.find((f) => f.id === 1);
    check('mcp: initialize answers with a protocol version and tool capability',
      init?.result?.protocolVersion === '2024-11-05' && !!init?.result?.capabilities?.tools,
      `got ${JSON.stringify(init)} · stderr: ${stderr}`);

    check('mcp: initialize carries the instruction that makes an agent call impact first',
      /impact/i.test(init?.result?.instructions ?? ''),
      'a host that surfaces no instruction leaves the agent no reason to ask before editing');

    const list = frames.find((f) => f.id === 2)?.result?.tools ?? [];
    const names = list.map((t) => t.name).sort();
    check('mcp: tools/list advertises the five read verbs',
      names.join(',') === 'codemap_flow,codemap_graph,codemap_impact,codemap_ls,codemap_verify',
      `got ${names.join(',')}`);

    check('mcp: every advertised tool carries an input schema',
      list.every((t) => t.inputSchema?.type === 'object'),
      'a tool without a schema is one a host will refuse to call');

    const impact = frames.find((f) => f.id === 3)?.result;
    let payload = null;
    try {
      payload = JSON.parse(impact?.content?.[0]?.text ?? 'null');
    } catch { payload = null; }
    check('mcp: codemap_impact returns the declared guards and edges of the file',
      payload?.guards?.length === 1 && payload?.outgoing?.length === 1,
      `got ${JSON.stringify(payload)?.slice(0, 200)}`);

    // cm:why the checker the REPO committed must win over the adapter's own copy, or an agent on MCP would get a different verdict from CI on the same file
    //   — which is the one thing `cm install` exists to prevent (README "Who enforces")
    check('mcp: the answer names which checker produced it',
      impact?._meta?.checker === 'project' || impact?._meta?.checker === 'plugin',
      `got ${JSON.stringify(impact?._meta)}`);

    const bad = frames.find((f) => f.id === 4);
    check('mcp: an unknown tool is a JSON-RPC error, not a crash',
      bad?.error?.code === -32602,
      `got ${JSON.stringify(bad)}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
