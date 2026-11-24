import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { detect } from '../src/detect';
import {
  createNextWebpackConfig,
  isClientComponent,
  transformNextClientComponent,
} from '../src/next-plugin';

const fixtureDir = fileURLToPath(new URL('../../../examples/next-hero/', import.meta.url));

describe('Next.js App Router e2e fixture (examples/next-hero)', () => {
  it('detect() recognizes the fixture as a Next.js App Router project', () => {
    // Fake node_modules in fixture if not already present
    const nm = path.join(fixtureDir, 'node_modules');
    const fake = (name: string, version: string) => {
      const p = path.join(nm, ...name.split('/'));
      mkdirSync(p, { recursive: true });
      writeFileSync(path.join(p, 'package.json'), JSON.stringify({ name, version }));
    };
    fake('next', '15.1.0');
    fake('react', '19.0.0');
    fake('@react-three/fiber', '9.0.0');
    fake('three', '0.180.0');

    try {
      const proj = detect(fixtureDir);
      expect(proj.framework).toBe('next');
      expect(proj.root).toBe(path.resolve(fixtureDir));
      expect(proj.nextConfig).toBe(path.join(path.resolve(fixtureDir), 'next.config.mjs'));
      expect(proj.viteConfig).toBeNull();
      expect(proj.versions.next).toBe('15.1.0');
      expect(proj.versions.react).toBe('19.0.0');
      expect(proj.versions.fiber).toBe('9.0.0');
    } finally {
      rmSync(nm, { recursive: true, force: true });
    }
  });

  it('leaves layout.tsx and page.tsx Server Components completely untouched', () => {
    const layoutCode = readFileSync(path.join(fixtureDir, 'app', 'layout.tsx'), 'utf8');
    const pageCode = readFileSync(path.join(fixtureDir, 'app', 'page.tsx'), 'utf8');

    expect(isClientComponent(layoutCode)).toBe(false);
    expect(isClientComponent(pageCode)).toBe(false);

    const layoutTransformed = transformNextClientComponent(
      layoutCode,
      path.join(fixtureDir, 'app', 'layout.tsx'),
      fixtureDir,
    );
    const pageTransformed = transformNextClientComponent(
      pageCode,
      path.join(fixtureDir, 'app', 'page.tsx'),
      fixtureDir,
    );

    expect(layoutTransformed).toBeNull();
    expect(pageTransformed).toBeNull();
  });

  it('instruments HeroScene.tsx Client Component with Canvas overlay and userData-prism tags', () => {
    const heroCode = readFileSync(path.join(fixtureDir, 'app', 'HeroScene.tsx'), 'utf8');

    expect(isClientComponent(heroCode)).toBe(true);

    const transformed = transformNextClientComponent(
      heroCode,
      path.join(fixtureDir, 'app', 'HeroScene.tsx'),
      fixtureDir,
    );

    expect(transformed).not.toBeNull();
    expect(transformed!.code).toContain('import { __PrismOverlay } from "virtual:prism-overlay";');
    expect(transformed!.code).toContain('<__PrismOverlay />');
    expect(transformed!.code).toContain('userData-prism="app/HeroScene.tsx:');
    expect(transformed!.map).toBeDefined();
  });

  it('integrates with webpack for both client and server compilations', () => {
    const webpackFn = createNextWebpackConfig(undefined, {
      root: fixtureDir,
      daemonOrigin: 'http://127.0.0.1:4173',
      overlayPath: path.resolve('packages/bridge/dist/overlay.js'),
    });

    const clientConf = webpackFn({}, { isServer: false, dev: true });
    expect(clientConf.resolve.alias['virtual:prism-overlay']).toContain('virtual-prism-overlay-client.js');

    const serverConf = webpackFn({}, { isServer: true, dev: true });
    expect(serverConf.resolve.alias['virtual:prism-overlay']).toContain('virtual-prism-overlay-server.js');
  });
});
