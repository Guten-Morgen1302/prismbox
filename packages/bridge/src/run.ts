import { readFileSync } from 'node:fs';

export interface Io {
  out: (text: string) => void;
  err: (text: string) => void;
}

/** The version in this package's own package.json (works from `src/` and from the built `dist/`). */
export function version(): string {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
  return pkg.version;
}

export function helpText(): string {
  return [
    `prismbox ${version()}`,
    'Agent-native visual editor for React Three Fiber (early development).',
    '',
    'Usage:',
    '  prismbox [options]',
    '',
    'Options:',
    '  -v, --version  Print the version',
    '  -h, --help     Show this help',
    '',
    'The dev-server plugin, Studio and MCP server are not implemented yet.',
    'Progress: https://github.com/Guten-Morgen1302/prismbox',
    '',
  ].join('\n');
}

/** Run the CLI and return the process exit code. Never calls `process.exit` itself. */
export function run(argv: readonly string[], io: Io): number {
  if (argv.length === 0) {
    io.out(helpText());
    return 0;
  }
  const [first] = argv;
  if (first === '-v' || first === '--version') {
    io.out(`${version()}\n`);
    return 0;
  }
  if (first === '-h' || first === '--help') {
    io.out(helpText());
    return 0;
  }
  io.err(`prismbox: unknown argument "${first}". Run \`prismbox --help\`.\n`);
  return 2;
}
