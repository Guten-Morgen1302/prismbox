import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { helpText, run, version } from '../src/run';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string; bin: Record<string, string> };

function exec(argv: string[]) {
  let out = '';
  let err = '';
  const code = run(argv, { out: (t) => (out += t), err: (t) => (err += t) });
  return { code, out, err };
}

describe('prismbox CLI', () => {
  it('--version and -v print the package version and exit 0', () => {
    for (const flag of ['--version', '-v']) {
      const r = exec([flag]);
      expect(r.code).toBe(0);
      expect(r.out).toBe(`${pkg.version}\n`);
      expect(r.err).toBe('');
    }
    expect(version()).toBe(pkg.version);
  });

  it('--help and -h print usage and exit 0', () => {
    for (const flag of ['--help', '-h']) {
      const r = exec([flag]);
      expect(r.code).toBe(0);
      expect(r.out).toContain('Usage:');
      expect(r.out).toContain('--version');
      expect(r.out).toBe(helpText());
    }
  });

  it('with no arguments shows help', () => {
    expect(exec([]).out).toBe(helpText());
  });

  it('rejects unknown arguments on stderr with exit code 2', () => {
    const r = exec(['--nope']);
    expect(r.code).toBe(2);
    expect(r.out).toBe('');
    expect(r.err).toContain('unknown argument "--nope"');
  });

  it('is wired to the `prismbox` bin', () => {
    expect(pkg.bin.prismbox).toBe('./dist/cli.js');
  });
});
