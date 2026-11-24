import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createNextWebpackConfig,
  isClientComponent,
  transformNextClientComponent,
  type WebpackConfig,
} from '../src/next-plugin';
import prismboxNextLoader from '../src/next-loader';

describe('Next.js Client vs Server Component recognition', () => {
  it('identifies client components by "use client" directive', () => {
    expect(isClientComponent("'use client';\nexport function Client() { return null; }")).toBe(true);
    expect(isClientComponent('"use client";\nexport function Client() { return null; }')).toBe(true);
    expect(isClientComponent('  "use client"\nexport function Client() { return null; }')).toBe(true);
    expect(isClientComponent('// comment\n"use client";\nexport function Client() {}')).toBe(true);
  });

  it('treats files without "use client" as server components', () => {
    expect(isClientComponent('export function Server() { return <div>hello</div>; }')).toBe(false);
    expect(isClientComponent('// server component\nexport default function Page() {}')).toBe(false);
    expect(isClientComponent('const x = "use client";')).toBe(false);
  });
});

describe('Next.js dev transform for App Router', () => {
  const root = '/mock/project';

  it('leaves Server Components completely untouched (returns null)', () => {
    const serverComponent = `
import { Canvas } from '@react-three/fiber';
export default function Page() {
  return (
    <main>
      <Canvas>
        <mesh position={[1, 2, 3]}>
          <boxGeometry />
        </mesh>
      </Canvas>
    </main>
  );
}
`;
    const res = transformNextClientComponent(serverComponent, '/mock/project/app/page.tsx', root);
    expect(res).toBeNull();
  });

  it('instruments Client Components with R3F Canvas and host elements', () => {
    const clientComponent = `'use client';
import { Canvas } from '@react-three/fiber';

export function HeroScene() {
  return (
    <Canvas>
      <mesh position={[0, 1, 0]}>
        <boxGeometry />
        <meshStandardMaterial />
      </mesh>
    </Canvas>
  );
}
`;
    const res = transformNextClientComponent(clientComponent, '/mock/project/components/HeroScene.tsx', root);
    expect(res).not.toBeNull();
    expect(res!.code).toContain('__PrismOverlay');
    expect(res!.code).toContain('userData-prism="components/HeroScene.tsx:');
    expect(res!.code).toContain('import { __PrismOverlay } from "virtual:prism-overlay";');
    expect(res!.map).toBeDefined();
  });

  it('leaves Client Components without any R3F elements untouched', () => {
    const plainClient = `'use client';
export function Counter() {
  return <button>Click me</button>;
}
`;
    const res = transformNextClientComponent(plainClient, '/mock/project/components/Counter.tsx', root);
    expect(res).toBeNull();
  });

  it('leaves node_modules and non-tsx/jsx files untouched', () => {
    const code = `'use client';\n<Canvas><mesh /></Canvas>`;
    expect(transformNextClientComponent(code, '/mock/project/node_modules/pkg/index.tsx', root)).toBeNull();
    expect(transformNextClientComponent(code, '/mock/project/app/styles.css', root)).toBeNull();
  });
});

describe('Next.js webpack configuration wrapper', () => {
  it('wraps webpack to add pre-loader and virtual:prism-overlay aliases for client & server', () => {
    let originalCalled = false;
    const existingWebpack = (cfg: WebpackConfig) => {
      originalCalled = true;
      cfg.customProp = true;
      return cfg;
    };

    const webpack = createNextWebpackConfig(existingWebpack, {
      root: path.resolve('examples/vite-hero'),
      daemonOrigin: 'http://127.0.0.1:4173',
      overlayPath: path.resolve('packages/bridge/dist/overlay.js'),
    });

    // Test client compilation
    const clientConfig: WebpackConfig = {};
    const clientResult = webpack(clientConfig, { isServer: false, dev: true });
    expect(originalCalled).toBe(true);
    expect(clientResult.customProp).toBe(true);
    expect(clientResult.resolve?.alias?.['virtual:prism-overlay']).toContain('virtual-prism-overlay-client.js');
    const clientOverlayCode = readFileSync(clientResult.resolve?.alias?.['virtual:prism-overlay'] ?? '', 'utf8');
    expect(clientOverlayCode).toContain('globalThis.__PRISMBOX_DAEMON__ = "http://127.0.0.1:4173";');

    // Loader rule should be registered
    const loaderRule = clientResult.module?.rules?.find((r) => r.enforce === 'pre');
    expect(loaderRule).toBeDefined();
    expect(loaderRule?.test).toEqual(/\.(tsx|jsx)$/);
    expect(loaderRule?.exclude).toEqual(/node_modules/);

    // Test server compilation
    const serverConfig: WebpackConfig = {};
    const serverResult = webpack(serverConfig, { isServer: true, dev: true });
    expect(serverResult.resolve?.alias?.['virtual:prism-overlay']).toContain('virtual-prism-overlay-server.js');
    const serverOverlayCode = readFileSync(serverResult.resolve?.alias?.['virtual:prism-overlay'] ?? '', 'utf8');
    expect(serverOverlayCode).toContain('export function __PrismOverlay() { return null; }');
  });
});

describe('Next loader behavior', () => {
  it('calls callback with transformed code on client component and original code on server component', () => {
    let cbCalled = false;
    let outCode = '';
    const ctx = {
      resourcePath: '/mock/project/app/Scene.tsx',
      getOptions: () => ({ root: '/mock/project' }),
      callback: (_err: null, code?: string) => {
        cbCalled = true;
        outCode = code ?? '';
      },
    };

    const serverSource = 'export default function ServerPage() { return <div>Server</div>; }';
    prismboxNextLoader.call(ctx, serverSource);
    expect(cbCalled).toBe(true);
    expect(outCode).toBe(serverSource);

    cbCalled = false;
    const clientSource = `'use client';\nimport { Canvas } from '@react-three/fiber';\nexport function C() { return <Canvas><mesh /></Canvas>; }`;
    prismboxNextLoader.call(ctx, clientSource);
    expect(cbCalled).toBe(true);
    expect(outCode).toContain('userData-prism');
  });
});
