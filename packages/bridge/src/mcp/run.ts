import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import path from 'node:path';
import type { Io } from '../run';
import { createMcpServer } from './server';

export function mcpHelp(): string {
  return [
    'Usage: prismbox mcp [--root <dir>] [--print-config]',
    '',
    'Runs the Prismbox MCP server on stdio for a coding agent (Claude Code, Cursor, Windsurf, Codex).',
    'stdout carries only MCP messages; logs go to stderr. It never modifies any config or project file.',
    '',
    '  --root <dir>     Project folder (default: the current directory)',
    '  --print-config   Print copy-paste setup for your agent and exit',
    '',
  ].join('\n');
}

/** Setup snippets only: nothing is written anywhere. */
export function printConfig(root: string, cliPath: string): string {
  const abs = path.resolve(root);
  const q = (s: string) => (/[\s"]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s);
  const args = [cliPath, 'mcp', '--root', abs];
  const json = JSON.stringify({ mcpServers: { prismbox: { command: 'node', args } } }, null, 2);
  return [
    '# Claude Code (run this once):',
    `claude mcp add prismbox -- node ${args.map(q).join(' ')}`,
    '',
    '# Cursor (.cursor/mcp.json) or Windsurf (mcp_config.json): add this entry',
    json,
    '',
    '# Once prismbox is published you can use npx instead:',
    `#   claude mcp add prismbox -- npx -y prismbox mcp --root ${q(abs)}`,
    '',
    'Then start prismbox in that project (`npx prismbox`), open your page, click an object, and tell the agent to edit "this".',
    '',
  ].join('\n');
}

/**
 * `prismbox mcp`. Strict stdio hygiene: from here on, anything that would print to stdout is routed to stderr, so the only
 * bytes on stdout are MCP JSON-RPC frames written by the transport.
 */
export async function runMcp(argv: readonly string[], io: Io, version: string): Promise<number> {
  let root = process.cwd();
  let print = false;
  const rest = [...argv];
  while (rest.length) {
    const a = rest.shift() as string;
    if (a === '--print-config') print = true;
    else if (a === '--root') {
      const v = rest.shift();
      if (!v) {
        io.err('prismbox mcp: --root needs a value.\n');
        return 2;
      }
      root = v;
    } else if (a === '-h' || a === '--help') {
      io.out(mcpHelp());
      return 0;
    } else {
      io.err(`prismbox mcp: unknown argument "${a}".\n`);
      return 2;
    }
  }
  if (print) {
    io.out(printConfig(root, process.argv[1] ?? 'prismbox'));
    return 0;
  }
  const toErr = (...a: unknown[]) => process.stderr.write(`${a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')}\n`);
  console.log = toErr;
  console.info = toErr;
  console.debug = toErr;
  const server = createMcpServer({ root: path.resolve(root), version });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`prismbox mcp ${version} ready for ${path.resolve(root)}\n`);
  await new Promise<void>((resolve) => {
    process.stdin.once('end', resolve);
    process.stdin.once('close', resolve);
  });
  await server.close().catch(() => undefined);
  return 0;
}
