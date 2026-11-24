import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDaemon } from './daemon/server';
import type { Daemon } from './daemon/server';
import { compatWarnings, detect, loadUserNext, loadUserNextConfig, loadUserVite } from './detect';
import { createNextWebpackConfig } from './next-plugin';
import { prismboxPlugin } from './plugin';
import { prismHome, removeSession, writeSession } from './session-file';

export interface LaunchOptions {
  root: string;
  port?: number;
  entry?: string;
  open?: boolean;
  version: string;
  log: (line: string) => void;
}

export interface Running {
  daemon: Daemon;
  studioUrl: string;
  pageUrl: string;
  close(): Promise<void>;
}

function getAvailablePort(preferred: number): Promise<number> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.on('error', () => {
      resolve(getAvailablePort(preferred + 1));
    });
    server.listen(preferred, () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

function studioDir(): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const p of [path.join(here, 'studio'), path.join(here, '..', 'dist', 'studio')]) if (existsSync(path.join(p, 'index.html'))) return p;
  return null;
}

function openBrowser(url: string): void {
  const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try {
    spawn(cmd[0] as string, cmd[1] as string[], { stdio: 'ignore', detached: true }).unref();
  } catch {
    /* printing the URL is enough */
  }
}

/**
 * `prismbox dev`: start the daemon, start the USER's own Vite or Next.js dev server in this process with the Prismbox
 * dev instrumentation injected inline (their configs, package.json and imports are never touched), and serve Studio.
 */
export async function launch(opts: LaunchOptions): Promise<Running> {
  const project = detect(opts.root);
  const token = randomBytes(24).toString('base64url');
  const daemon = createDaemon({ root: project.root, token, port: opts.port ?? 4173, version: opts.version, studioDir: studioDir(), ...(opts.entry ? { entry: opts.entry } : {}) });
  const { port, origin } = await daemon.listen();
  // The session descriptor lives in ~/.prismbox (never in the project), so `prismbox mcp` can find this daemon.
  const home = prismHome();
  writeSession(home, { port, token, pid: process.pid, root: project.root, startedAt: new Date().toISOString(), version: opts.version });
  const dropSession = () => removeSession(home, project.root, process.pid);
  process.once('exit', dropSession);

  if (project.framework === 'next') {
    let nextApp: any;
    let httpServer: any;
    let actualPort = 3000;
    try {
      const nextFn = await loadUserNext(project.root);
      const userConfig = await loadUserNextConfig(project.root);
      actualPort = await getAvailablePort(3000);
      const wrappedConfig = {
        ...userConfig,
        webpack: createNextWebpackConfig(userConfig?.webpack, {
          root: project.root,
          daemonOrigin: origin,
        }),
      };
      nextApp = nextFn({
        dev: true,
        dir: project.root,
        hostname: 'localhost',
        port: actualPort,
        conf: wrappedConfig,
      });
      await nextApp.prepare();
      const handle = nextApp.getRequestHandler();
      httpServer = createHttpServer((req, res) => {
        handle(req, res);
      });
      await new Promise<void>((resolve, reject) => {
        httpServer.listen(actualPort, 'localhost', () => resolve());
        httpServer.on('error', reject);
      });
    } catch (e) {
      dropSession();
      await daemon.close();
      throw e;
    }

    for (const host of ['localhost', '127.0.0.1', '[::1]']) daemon.allowPageOrigin(`http://${host}:${actualPort}`);
    const pageUrl = `http://localhost:${actualPort}/`;
    daemon.setPageUrl(pageUrl);
    const studioUrl = `${origin}/#token=${token}`;
    opts.log(`prismbox ${opts.version}`);
    opts.log(`  project   ${project.root}`);
    opts.log(`  next      ${project.versions.next}   react ${project.versions.react}   r3f ${project.versions.fiber}   three ${project.versions.three ?? '?'}`);
    opts.log(`  your page ${pageUrl}`);
    opts.log(`  studio    ${studioUrl}`);
    for (const w of compatWarnings(project.versions)) opts.log(`warning: ${w}`);
    opts.log('Studio opens disarmed. Arm it to edit from the page. Nothing in your project was changed to run this.');
    if (opts.open) {
      openBrowser(studioUrl);
      openBrowser(pageUrl);
    }
    void port;
    return {
      daemon,
      studioUrl,
      pageUrl,
      async close() {
        dropSession();
        await Promise.allSettled([
          new Promise((resolve) => (httpServer ? httpServer.close(resolve) : resolve(undefined))),
          nextApp?.close?.(),
          daemon.close(),
        ]);
      },
    };
  }

  const vite = await loadUserVite(project.root);
  let server: Awaited<ReturnType<typeof vite.createServer>>;
  try {
    server = await vite.createServer({ root: project.root, clearScreen: false, plugins: [prismboxPlugin({ daemonOrigin: origin }) as never] });
    await server.listen();
  } catch (e) {
    dropSession();
    await daemon.close();
    throw e;
  }
  // the page origins that may reach the daemon: the dev server's own addresses
  const vitePort = server.config.server.port ?? 5173;
  const actual = (server.httpServer?.address() as { port: number } | null)?.port ?? vitePort;
  for (const host of ['localhost', '127.0.0.1', '[::1]']) daemon.allowPageOrigin(`http://${host}:${actual}`);
  for (const u of [...(server.resolvedUrls?.local ?? []), ...(server.resolvedUrls?.network ?? [])]) daemon.allowPageOrigin(u.replace(/\/$/, ''));

  const pageUrl = server.resolvedUrls?.local[0] ?? `http://localhost:${actual}/`;
  daemon.setPageUrl(pageUrl);
  const studioUrl = `${origin}/#token=${token}`;
  opts.log(`prismbox ${opts.version}`);
  opts.log(`  project   ${project.root}`);
  opts.log(`  vite      ${project.versions.vite}   react ${project.versions.react}   r3f ${project.versions.fiber}   three ${project.versions.three ?? '?'}`);
  opts.log(`  your page ${pageUrl}`);
  opts.log(`  studio    ${studioUrl}`);
  for (const w of compatWarnings(project.versions)) opts.log(`warning: ${w}`);
  opts.log('Studio opens disarmed. Arm it to edit from the page. Nothing in your project was changed to run this.');
  if (opts.open) {
    openBrowser(studioUrl);
    openBrowser(pageUrl);
  }
  void port;
  return {
    daemon,
    studioUrl,
    pageUrl,
    async close() {
      dropSession();
      await Promise.allSettled([server.close(), daemon.close()]);
    },
  };
}
