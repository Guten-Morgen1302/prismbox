import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { compatWarnings, detect, DetectError } from '../src/detect';
import { helpText, parseArgs, run, version } from '../src/run';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string; bin: Record<string, string> };

async function exec(argv: string[]) {
  let out = '';
  let err = '';
  const code = await run(argv, { out: (t) => (out += t), err: (t) => (err += t) });
  return { code, out, err };
}

import { printConfig } from '../src/mcp/run';

describe('mcp setup snippets', () => {
  it('prints npx commands for external users, a cmd /c wrapper on Windows, and the source-checkout variant only outside node_modules', () => {
    const posix = printConfig('/p/app', '/usr/lib/node_modules/prismbox/dist/cli.js', 'linux');
    expect(posix).toContain('claude mcp add prismbox -- npx -y prismbox mcp --root');
    expect(posix).toContain('"command": "npx"');
    expect(posix).not.toContain('source checkout');
    const win = printConfig('C:\\p\\app', 'C:\\x\\node_modules\\prismbox\\dist\\cli.js', 'win32');
    expect(win).toContain('claude mcp add prismbox -- cmd /c npx -y prismbox mcp --root');
    expect(win).toContain('"command": "cmd"');
    expect(printConfig('/p/app', '/work/prismbox/packages/bridge/dist/cli.js', 'linux')).toContain('source checkout');
  });
});

describe('prismbox CLI', () => {
  it('--version and -v print the package version and exit 0', async () => {
    for (const flag of ['--version', '-v']) {
      const r = await exec([flag]);
      expect(r).toEqual({ code: 0, out: `${pkg.version}\n`, err: '' });
    }
    expect(version()).toBe(pkg.version);
  });

  it('--help and -h print usage and exit 0', async () => {
    for (const flag of ['--help', '-h']) {
      const r = await exec([flag]);
      expect(r.code).toBe(0);
      expect(r.out).toBe(helpText());
      expect(r.out).toContain('prismbox [dev]');
      expect(r.out).toContain('prismbox mcp');
    }
  });

  it('rejects unknown options and bad values on stderr with exit code 2', async () => {
    for (const argv of [['--nope'], ['--port', 'abc'], ['--port'], ['--root'], ['a.tsx', 'b.tsx']]) {
      const r = await exec(argv);
      expect(r.code).toBe(2);
      expect(r.out).toBe('');
      expect(r.err).toContain('prismbox:');
    }
  });

  it('is wired to the `prismbox` bin', () => {
    expect(pkg.bin.prismbox).toBe('./dist/cli.js');
  });

  it('parses dev, root, port, entry and open flags', () => {
    expect(parseArgs(['dev', 'src/Hero.tsx', '--root', 'x', '--port', '5000', '--no-open'])).toMatchObject({ command: 'dev', entry: 'src/Hero.tsx', root: 'x', port: 5000, open: false });
    expect(parseArgs([])).toMatchObject({ command: 'dev', open: undefined });
  });
});

describe('compatibility warnings', () => {
  it('warns for three older than r156 and stays quiet otherwise', () => {
    expect(compatWarnings({ three: '0.150.1' })[0]).toMatch(/older than r156/);
    expect(compatWarnings({ three: '0.155.0' })).toHaveLength(1);
    for (const v of ['0.156.0', '0.187.0', '1.0.0', null, 'weird']) expect(compatWarnings({ three: v })).toEqual([]);
  });
});

describe('project detection (read-only)', () => {
  const tmp = (pkgJson: unknown | null) => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'prismbox-detect-'));
    if (pkgJson) writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkgJson));
    return dir;
  };
  const fakeModules = (dir: string, versions: Record<string, string>) => {
    for (const [name, version] of Object.entries(versions)) {
      const p = path.join(dir, 'node_modules', ...name.split('/'));
      mkdirSync(p, { recursive: true });
      writeFileSync(path.join(p, 'package.json'), JSON.stringify({ name, version }));
    }
  };
  const code = (fn: () => unknown) => {
    try {
      fn();
    } catch (e) {
      return e instanceof DetectError ? e.code : String(e);
    }
    return 'no error';
  };

  it('explains why a folder is not supported, without touching it', async () => {
    const empty = tmp(null);
    const notVite = tmp({ dependencies: { express: '4', '@react-three/fiber': '9' } });
    const pagesRouter = tmp({ dependencies: { next: '15', '@react-three/fiber': '9' } });
    mkdirSync(path.join(pagesRouter, 'pages'));
    const noR3f = tmp({ devDependencies: { vite: '8' } });
    const react18 = tmp({ devDependencies: { vite: '8', react: '18', '@react-three/fiber': '9' } });
    fakeModules(react18, { vite: '8.0.0', react: '18.3.1', '@react-three/fiber': '9.0.0' });
    const okVite = tmp({ devDependencies: { vite: '8', react: '19', '@react-three/fiber': '9', three: '0.180' } });
    fakeModules(okVite, { vite: '8.1.0', react: '19.1.0', '@react-three/fiber': '9.2.0', three: '0.180.0' });
    const okNext = tmp({ dependencies: { next: '15', react: '19', '@react-three/fiber': '9', three: '0.180' } });
    mkdirSync(path.join(okNext, 'app'));
    fakeModules(okNext, { next: '15.1.0', react: '19.1.0', '@react-three/fiber': '9.2.0', three: '0.180.0' });
    try {
      expect(code(() => detect(empty))).toBe('NOT_A_PROJECT');
      expect(code(() => detect(notVite))).toBe('NOT_VITE');
      expect(code(() => detect(pagesRouter))).toBe('PAGES_ROUTER');
      expect(code(() => detect(noR3f))).toBe('NO_R3F');
      expect(code(() => detect(react18))).toBe('UNSUPPORTED_VERSION');
      expect(detect(okVite).framework).toBe('vite');
      expect(detect(okVite).versions).toEqual({ vite: '8.1.0', react: '19.1.0', three: '0.180.0', fiber: '9.2.0' });
      expect(detect(okNext).framework).toBe('next');
      expect(detect(okNext).versions).toEqual({ next: '15.1.0', react: '19.1.0', three: '0.180.0', fiber: '9.2.0' });
      const r = await exec(['--root', pagesRouter, '--no-open']);
      expect(r.code).toBe(1);
      expect(r.err).toContain('Pages Router is not supported');
    } finally {
      for (const d of [empty, notVite, pagesRouter, noR3f, react18, okVite, okNext]) rmSync(d, { recursive: true, force: true });
    }
  });
});
