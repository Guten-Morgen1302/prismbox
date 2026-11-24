import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: { cli: 'src/cli.ts', plugin: 'src/plugin.ts', next: 'src/next-plugin.ts' },
    format: ['esm'],
    platform: 'node',
    target: 'node20',
    // not `clean`: dist/studio is copied in by the build script and must survive a plain `tsup` (the tests run one)
    clean: false,
    sourcemap: false,
    // the user's Vite or Next is loaded at runtime from their project; never bundle it
    external: ['vite', 'next', '@modelcontextprotocol/sdk'],
  },
  {
    entry: { 'next-loader': 'src/next-loader.ts' },
    format: ['cjs', 'esm'],
    platform: 'node',
    target: 'node20',
    clean: false,
    sourcemap: false,
  },
  {
    // runs in the user's page: react, three and R3F must resolve to the USER's copies
    entry: { overlay: 'src/overlay/overlay.ts' },
    format: ['esm'],
    platform: 'browser',
    target: 'es2022',
    clean: false,
    sourcemap: false,
    external: ['react', '@react-three/fiber', 'three', /^three\//],
  },
]);
