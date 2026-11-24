import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findOverlay } from './plugin';
export { isClientComponent, transformNextClientComponent } from './next-loader';

export interface NextPluginOptions {
  root: string;
  daemonOrigin: string;
  overlayPath?: string;
}

export function findNextLoader(): string {
  const here = typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url));
  for (const p of [
    path.join(here, 'next-loader.cjs'),
    path.join(here, 'next-loader.js'),
    path.join(here, '..', 'dist', 'next-loader.cjs'),
    path.join(here, '..', 'dist', 'next-loader.js'),
    path.join(here, 'next-loader.ts'),
  ]) {
    if (existsSync(p)) return p;
  }
  return path.join(here, 'next-loader.cjs');
}

export function setupVirtualOverlayFiles(options: { daemonOrigin: string; overlayPath?: string }) {
  const tmpDir = path.join(os.tmpdir(), `prismbox-next-${process.pid}`);
  mkdirSync(tmpDir, { recursive: true });

  const realOverlay = findOverlay(options.overlayPath);
  const clientOverlayPath = path.join(tmpDir, 'virtual-prism-overlay-client.js');
  const serverOverlayPath = path.join(tmpDir, 'virtual-prism-overlay-server.js');

  const clientCode = `globalThis.__PRISMBOX_DAEMON__ = ${JSON.stringify(options.daemonOrigin)};\nexport * from ${JSON.stringify(realOverlay)};\n`;
  const serverCode = `export function __PrismOverlay() { return null; }\n`;

  writeFileSync(clientOverlayPath, clientCode, 'utf8');
  writeFileSync(serverOverlayPath, serverCode, 'utf8');

  return { tmpDir, clientOverlayPath, serverOverlayPath };
}

export interface WebpackConfig {
  resolve?: {
    alias?: Record<string, string>;
    modules?: string[];
  };
  module?: {
    rules?: Array<{
      test?: RegExp;
      exclude?: RegExp;
      enforce?: string;
      use?: Array<{
        loader?: string;
        options?: Record<string, unknown>;
      }>;
    }>;
  };
  [key: string]: unknown;
}

export interface WebpackOptions {
  isServer?: boolean;
  dev?: boolean;
  [key: string]: unknown;
}

/**
 * Creates a wrapped webpack config function that injects Prismbox instrumentation into Next.js.
 * - Leaves Server Components untouched.
 * - Instruments Client Components containing R3F Canvas.
 * - Virtual overlay alias resolves to client runtime on client and a harmless no-op on server (SSR).
 */
export function createNextWebpackConfig(
  existingWebpack: ((config: WebpackConfig, options: WebpackOptions) => WebpackConfig) | undefined,
  options: NextPluginOptions,
) {
  const { clientOverlayPath, serverOverlayPath } = setupVirtualOverlayFiles(options);
  const loaderPath = findNextLoader();

  return function webpack(config: WebpackConfig, webpackOpts: WebpackOptions): WebpackConfig {
    if (typeof existingWebpack === 'function') {
      config = existingWebpack(config, webpackOpts) ?? config;
    }

    config.resolve = config.resolve || {};
    config.resolve.alias = config.resolve.alias || {};

    if (webpackOpts.isServer) {
      config.resolve.alias['virtual:prism-overlay'] = serverOverlayPath;
    } else {
      config.resolve.alias['virtual:prism-overlay'] = clientOverlayPath;
    }

    config.module = config.module || {};
    config.module.rules = config.module.rules || [];
    config.module.rules.push({
      test: /\.(tsx|jsx)$/,
      exclude: /node_modules/,
      enforce: 'pre',
      use: [
        {
          loader: loaderPath,
          options: {
            root: options.root,
          },
        },
      ],
    });

    return config;
  };
}
