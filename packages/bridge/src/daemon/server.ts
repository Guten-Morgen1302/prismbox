import { findNodeByTag, readScene } from '@prismbox/core';
import type { Op } from '@prismbox/core';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createReadStream, promises as fs, watch as fsWatch } from 'node:fs';
import type { FSWatcher } from 'node:fs';
import http from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import type { RawData, WebSocket } from 'ws';
import { PageMsg, PROPOSAL_LIMITS, StudioMsg } from '../protocol';
import type { DiffWire, ErrorCode, FileSnap, ToPage, ToStudio } from '../protocol';
import { TokenBucket } from './limiter';
import { DaemonError, hashBytes, Project, TMP_PREFIX } from './project';
import type { ProjectOptions } from './project';

export interface DaemonOptions {
  root: string;
  /** The Studio session token (write authority). Random per run. */
  token: string;
  /** 0 picks a free port; otherwise the first free port from here up. */
  port?: number;
  version?: string;
  /** Directory with the built Studio, served as static files. */
  studioDir?: string | null;
  /** Page-proposal rate limit (token bucket). */
  rate?: { capacity: number; perSecond: number };
  now?: () => number;
  project?: ProjectOptions;
  /** Preferred entry file (project-relative). */
  entry?: string;
  /** Turn the disk watcher off (tests drive `onDiskChange` directly). */
  watch?: boolean;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.map': 'application/json', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};

const safeEqual = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

interface Client {
  ws: WebSocket;
  kind: 'studio' | 'page';
  authed: boolean;
}

export interface Daemon {
  readonly project: Project;
  listen(): Promise<{ port: number; origin: string }>;
  close(): Promise<void>;
  /** An origin that may fetch a page token and open the page channel (the user's own dev server). */
  allowPageOrigin(origin: string): void;
  /** The URL of the user's page, shown in Studio. */
  setPageUrl(url: string): void;
  readonly armed: boolean;
  /** Feed a disk change (from the watcher, or a test). */
  onDiskChange(rel: string): Promise<void>;
  stats(): { studios: number; pages: number; armed: boolean; proposalsAccepted: number; proposalsRejected: number };
}

export function createDaemon(opts: DaemonOptions): Daemon {
  const project = new Project(opts.root, opts.project);
  const bucket = new TokenBucket(opts.rate?.capacity ?? 6, opts.rate?.perSecond ?? 3, opts.now);
  const clients = new Set<Client>();
  const pageTokens = new Map<string, number>();
  const pageOrigins = new Set<string>();
  let port = 0;
  let armed = false;
  let current: FileSnap | null = null;
  let files: string[] = [];
  let accepted = 0;
  let rejected = 0;
  let watcher: FSWatcher | null = null;
  let pageUrl: string | null = null;
  const timers = new Map<string, NodeJS.Timeout>();
  const now = () => (opts.now ?? Date.now)();

  const studios = () => [...clients].filter((c) => c.kind === 'studio' && c.authed);
  const pages = () => [...clients].filter((c) => c.kind === 'page' && c.authed);
  const send = (c: Client, m: ToStudio | ToPage) => {
    if (c.ws.readyState === c.ws.OPEN) c.ws.send(JSON.stringify(m));
  };
  const toStudios = (m: ToStudio) => studios().forEach((c) => send(c, m));
  const toPages = (m: ToPage) => pages().forEach((c) => send(c, m));

  const allowedHosts = () => new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const studioOrigins = () => new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]);

  // ---------------- state helpers ----------------
  const undoState = async () => project.undoState();
  const pushUndoState = async () => toStudios({ type: 'undo', state: await undoState() });

  async function setArmed(value: boolean, reason?: string): Promise<void> {
    if (armed === value) return;
    armed = value;
    toPages({ type: 'arm', value });
    toStudios({ type: 'armed', value, ...(reason ? { reason } : {}) });
  }

  async function open(rel: string, cause: 'open' | 'external' = 'open'): Promise<FileSnap> {
    const snap = await project.read(rel);
    current = snap;
    toStudios({ type: 'file', file: snap, cause });
    return snap;
  }

  async function refreshFiles(): Promise<void> {
    files = await project.listScenes();
    toStudios({ type: 'files', files });
  }

  async function pickEntry(): Promise<string | null> {
    if (opts.entry) {
      try {
        return (await project.resolve(opts.entry)).rel;
      } catch {
        /* fall through */
      }
    }
    const withCanvas: string[] = [];
    for (const f of files) {
      try {
        const s = (await project.read(f)).source;
        if (/<Canvas\b/.test(s) && /react-three\/fiber/.test(s)) withCanvas.push(f);
      } catch {
        /* skip */
      }
    }
    return withCanvas[0] ?? files[0] ?? null;
  }

  const errorOf = (e: unknown): { code: ErrorCode; message: string; file?: FileSnap } => {
    if (e instanceof DaemonError) return { code: e.code, message: e.message, ...(e.file ? { file: e.file } : {}) };
    const code = (e as { code?: unknown })?.code;
    if (typeof code === 'string' && /^[A-Z_]+$/.test(code)) return { code: code as ErrorCode, message: (e as Error).message };
    return { code: 'INTERNAL', message: e instanceof Error ? e.message : String(e) };
  };

  function afterWrite(file: FileSnap, diff: DiffWire | null, cause: 'edit' | 'undo' | 'redo'): void {
    if (current?.path === file.path || !current) current = file;
    toStudios({ type: 'file', file, cause });
    if (diff) toStudios({ type: 'diff', entry: diff });
    void pushUndoState();
  }

  // ---------------- Studio messages ----------------
  async function onStudio(c: Client, m: StudioMsg): Promise<void> {
    switch (m.type) {
      case 'arm':
        await setArmed(m.value, m.value ? undefined : 'disarmed by you');
        return;
      case 'open':
        try {
          await open(m.file);
        } catch (e) {
          const er = errorOf(e);
          send(c, { type: 'rejected', code: er.code, message: er.message });
        }
        return;
      case 'edit': {
        try {
          const op: Op =
            m.op.kind === 'prop'
              ? { op: 'setProp', node: m.op.node, prop: m.op.prop, value: m.op.value as never }
              : { op: 'setUniform', node: m.op.node, uniform: m.op.uniform, value: m.op.value as never };
          const summary = m.op.kind === 'prop' ? m.op.prop : `uniform ${m.op.uniform}`;
          const r = await project.edit(m.file, [op], { baseHash: m.baseHash, author: 'you', summary });
          send(c, { type: 'result', id: m.id, ok: true, file: r.file });
          if (r.changed) afterWrite(r.file, r.diff, 'edit');
        } catch (e) {
          const er = errorOf(e);
          send(c, { type: 'result', id: m.id, ok: false, ...er });
          if (er.file) send(c, { type: 'file', file: er.file, cause: 'open' }); // resync only: keep the conflict banner
        }
        return;
      }
      case 'undo':
      case 'redo': {
        try {
          const r = m.type === 'undo' ? await project.undo() : await project.redo();
          send(c, { type: 'result', id: m.id, ok: true, file: r.file });
          afterWrite(r.file, r.diff, m.type);
        } catch (e) {
          const er = errorOf(e);
          send(c, { type: 'result', id: m.id, ok: false, ...er });
          if (er.file) send(c, { type: 'file', file: er.file, cause: 'open' }); // resync only: keep the conflict banner
          void pushUndoState();
        }
        return;
      }
      case 'select':
        toPages({ type: 'select', tag: m.tag });
        return;
      case 'live':
        toPages({ type: 'live', tag: m.tag, prop: m.prop, value: m.value, ...(m.uniform ? { uniform: true } : {}) });
        return;
      case 'view':
        toPages({ type: 'view', mode: m.mode });
        return;
      case 'gizmo':
        toPages({ type: 'gizmo', mode: m.mode });
        return;
      case 'hello':
        return;
    }
  }

  // ---------------- page proposals (d8) ----------------
  const reject = (c: Client, id: number, code: ErrorCode, message: string) => {
    rejected++;
    send(c, { type: 'proposal-result', id, ok: false, code, message });
    toStudios({ type: 'rejected', code, message: `A page edit was rejected: ${message}` });
  };

  async function onProposal(c: Client, m: Extract<PageMsg, { type: 'proposal' }>): Promise<void> {
    // 1. the gate: page-originated edits are accepted only while Studio is armed
    if (!armed) return reject(c, m.id, 'DISARMED', 'Studio is not armed, so page edits are ignored. Arm Studio to edit from the page.');
    // 2. bounded rate
    if (!bucket.take()) return reject(c, m.id, 'RATE_LIMITED', 'Too many page edits in a short time.');
    // 3. bounded values
    for (const [prop, ch] of Object.entries(m.changes) as [keyof typeof PROPOSAL_LIMITS, { from: number[]; to: number[] }][]) {
      if (ch.to.some((v) => Math.abs(v) > PROPOSAL_LIMITS[prop])) return reject(c, m.id, 'INVALID_PROPOSAL', `${prop} is out of the plausible range.`);
    }
    if (Object.keys(m.changes).length === 0) return reject(c, m.id, 'INVALID_PROPOSAL', 'No changes.');
    try {
      // 4. re-validate against the daemon's own parse of the CURRENT file, never the page's claims
      const tag = /^(.+):(\d+):(\d+)$/.exec(m.tag);
      if (!tag) return reject(c, m.id, 'INVALID_PROPOSAL', 'Malformed node tag.');
      const snap = await project.read(tag[1] as string);
      const node = findNodeByTag(readScene(snap.source, snap.path), m.tag);
      if (!node) return reject(c, m.id, 'NODE_NOT_FOUND', `No node at ${m.tag}; the file changed since the page loaded.`);
      if (node.kind !== 'host') return reject(c, m.id, 'READ_ONLY_NODE', 'Only scene elements can be edited from the page.');
      const DEFAULTS: Record<string, number[]> = { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };
      const same = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => Math.abs(v - (b[i] as number)) < 1e-3);
      const ops: Op[] = [];
      for (const [prop, ch] of Object.entries(m.changes) as [string, { from: number[]; to: number[] }][]) {
        const info = node.props.find((p) => p.name === prop);
        // The page reports the object's real transform. A prop that is absent in the source means the default, so the
        // page's "from" must equal that default (and there is nothing to compare against). A scalar `scale={2}` reads as [2, 2, 2].
        if (!info) {
          if (!same(ch.from, DEFAULTS[prop] as number[])) return reject(c, m.id, 'CONFLICT', `"${prop}" is not set in the file, but the page believes it is ${JSON.stringify(ch.from)}; reload the page.`);
          ops.push({ op: 'setProp', node: node.id, prop, value: ch.to });
          continue;
        }
        const cur = info.value;
        const expected = typeof cur === 'number' && ch.from.every((v) => Math.abs(v - cur) < 1e-3) ? cur : ch.from;
        ops.push({ op: 'setProp', node: node.id, prop, value: ch.to, expected });
      }
      const r = await project.edit(snap.path, ops, { baseHash: snap.hash, author: 'page', summary: Object.keys(m.changes).join(' + ') });
      accepted++;
      send(c, { type: 'proposal-result', id: m.id, ok: true });
      if (r.changed) afterWrite(r.file, r.diff, 'edit');
    } catch (e) {
      const er = errorOf(e);
      reject(c, m.id, er.code, er.message);
    }
  }

  async function onPage(c: Client, m: PageMsg): Promise<void> {
    switch (m.type) {
      case 'pick':
        toStudios({ type: 'pick', tag: m.tag });
        return;
      case 'frozen':
        toStudios({ type: 'frozen', value: m.value });
        return;
      case 'proposal':
        await onProposal(c, m);
        return;
      case 'hello':
        return;
    }
  }

  // ---------------- disk changes ----------------
  async function onDiskChange(rel: string): Promise<void> {
    let snap: FileSnap;
    try {
      snap = await project.read(rel);
    } catch {
      await refreshFiles();
      return;
    }
    if (!files.includes(snap.path) && /\.(tsx|jsx)$/.test(snap.path)) await refreshFiles();
    if (current?.path !== snap.path) return;
    if (snap.hash === current.hash) return;
    const before = current.source;
    const own = project.selfWrites.has(snap.hash);
    current = snap;
    if (own) return; // our own write: Studio already has it
    toStudios({ type: 'file', file: snap, cause: 'external' });
    const diff = project.externalDiff(snap.path, before, snap.source);
    if (diff) toStudios({ type: 'diff', entry: diff });
    void pushUndoState();
  }

  function startWatching(): void {
    try {
      watcher = fsWatch(project.root, { recursive: true }, (_ev, name) => {
        if (!name) return;
        const rel = String(name).replace(/\\/g, '/');
        const parts = rel.split('/');
        if (parts.some((p) => p.startsWith('.') || p === 'node_modules' || p === 'dist') || path.basename(rel).startsWith(TMP_PREFIX)) return;
        if (!/\.(tsx|jsx|ts|js)$/.test(rel)) return;
        clearTimeout(timers.get(rel));
        timers.set(rel, setTimeout(() => { timers.delete(rel); void onDiskChange(rel); }, 40));
      });
      watcher.on('error', () => undefined);
    } catch {
      /* recursive watching unavailable: Studio still works, it just will not see external edits live */
    }
  }

  // ---------------- HTTP ----------------
  const json = (res: ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra });
    res.end(JSON.stringify(body));
  };

  function hostOk(req: IncomingMessage): boolean {
    const host = req.headers.host;
    return typeof host === 'string' && allowedHosts().has(host.toLowerCase());
  }

  async function serveStatic(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const dir = opts.studioDir;
    if (!dir) return json(res, 404, { error: 'Studio is not bundled in this build.' });
    const url = new URL(req.url ?? '/', 'http://x');
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/' || rel === '') rel = '/index.html';
    const target = path.join(dir, path.normalize(rel).replace(/^([/\\])+/, ''));
    if (!target.startsWith(path.resolve(dir))) return json(res, 403, { error: 'forbidden' });
    let file = target;
    try {
      if (!(await fs.stat(file)).isFile()) throw new Error('not a file');
    } catch {
      if (path.extname(rel)) return json(res, 404, { error: 'not found' });
      file = path.join(dir, 'index.html'); // SPA fallback
    }
    res.writeHead(200, {
      'content-type': MIME[path.extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
      // The sandboxed preview iframe has an opaque origin and loads its modules cross-origin; these are public static assets.
      'access-control-allow-origin': '*',
      'x-content-type-options': 'nosniff',
    });
    createReadStream(file).pipe(res);
  }

  const server = http.createServer((req, res) => {
    if (!hostOk(req)) return json(res, 421, { error: 'Bad Host header' });
    const url = new URL(req.url ?? '/', 'http://x');
    if (req.method === 'GET' && url.pathname === '/__prism/session') return json(res, 200, { prismbox: true, local: true, version: opts.version ?? '0.0.0' });
    if (req.method === 'GET' && url.pathname === '/__prism/page-token') {
      const origin = req.headers.origin;
      if (typeof origin !== 'string' || !pageOrigins.has(origin)) return json(res, 403, { error: 'This origin is not the project dev server.' });
      if (pageTokens.size > 50) pageTokens.clear();
      const token = randomBytes(18).toString('base64url');
      pageTokens.set(token, now() + 60_000);
      return json(res, 200, { token }, { 'access-control-allow-origin': origin, vary: 'Origin' });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'method not allowed' });
    void serveStatic(req, res).catch(() => json(res, 500, { error: 'internal' }));
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
  server.on('upgrade', (req, socket, head) => {
    const deny = (code: number) => {
      socket.write(`HTTP/1.1 ${code} Forbidden\r\nConnection: close\r\n\r\n`);
      socket.destroy();
    };
    if (!hostOk(req)) return deny(421);
    const pathname = new URL(req.url ?? '/', 'http://x').pathname;
    const origin = req.headers.origin;
    if (pathname === '/studio') {
      if (typeof origin !== 'string' || !studioOrigins().has(origin)) return deny(403);
    } else if (pathname === '/page') {
      if (typeof origin !== 'string' || !pageOrigins.has(origin)) return deny(403);
    } else return deny(404);
    wss.handleUpgrade(req, socket, head, (ws) => connect(ws, pathname === '/studio' ? 'studio' : 'page'));
  });

  function connect(ws: WebSocket, kind: 'studio' | 'page'): void {
    const c: Client = { ws, kind, authed: false };
    clients.add(c);
    const helloTimer = setTimeout(() => !c.authed && ws.close(4401, 'hello timeout'), 3000);
    ws.on('message', (data: RawData) => {
      void (async () => {
        let raw: unknown;
        try {
          raw = JSON.parse(data.toString());
        } catch {
          return ws.close(4400, 'bad json');
        }
        if (!c.authed) {
          const h = (raw as { type?: string; token?: unknown }) ?? {};
          if (h.type !== 'hello' || typeof h.token !== 'string') return ws.close(4401, 'hello first');
          if (kind === 'studio') {
            if (!safeEqual(h.token, opts.token)) return ws.close(4403, 'bad token');
          } else {
            const exp = pageTokens.get(h.token);
            pageTokens.delete(h.token); // one-shot
            if (!exp || exp < now()) return ws.close(4403, 'bad token');
          }
          c.authed = true;
          clearTimeout(helloTimer);
          if (kind === 'studio') {
            if (!current) {
              files = await project.listScenes();
              const entry = await pickEntry();
              if (entry) current = await project.read(entry).catch(() => null);
            }
            send(c, { type: 'ready', version: opts.version ?? '0.0.0', root: project.root, pageUrl, files, file: current, armed, page: pages().length > 0, undo: await undoState() });
          } else {
            send(c, { type: 'hello-ok', armed });
            toStudios({ type: 'page', connected: true });
          }
          return;
        }
        if (kind === 'studio') {
          const p = StudioMsg.safeParse(raw);
          if (!p.success) return send(c, { type: 'rejected', code: 'BAD_REQUEST', message: 'Malformed message.' });
          await onStudio(c, p.data);
        } else {
          const p = PageMsg.safeParse(raw);
          if (!p.success) {
            const id = (raw as { id?: unknown })?.id;
            if (typeof id === 'number') return reject(c, id, 'INVALID_PROPOSAL', 'Malformed proposal.');
            return;
          }
          await onPage(c, p.data);
        }
      })().catch(() => undefined);
    });
    ws.on('close', () => {
      clearTimeout(helloTimer);
      clients.delete(c);
      if (kind === 'studio' && studios().length === 0) void setArmed(false, 'Studio disconnected');
      if (kind === 'page' && c.authed) toStudios({ type: 'page', connected: pages().length > 0 });
    });
    ws.on('error', () => undefined);
  }

  return {
    project,
    get armed() {
      return armed;
    },
    allowPageOrigin: (o) => void pageOrigins.add(o),
    setPageUrl: (u) => void (pageUrl = u),
    onDiskChange,
    stats: () => ({ studios: studios().length, pages: pages().length, armed, proposalsAccepted: accepted, proposalsRejected: rejected }),
    async listen() {
      const start = opts.port ?? 0;
      const tryListen = (p: number) =>
        new Promise<boolean>((resolve, reject) => {
          const onErr = (e: NodeJS.ErrnoException) => (e.code === 'EADDRINUSE' ? resolve(false) : reject(e));
          server.once('error', onErr);
          server.listen(p, '127.0.0.1', () => {
            server.off('error', onErr);
            resolve(true);
          });
        });
      let bound = false;
      for (let p = start; p <= (start === 0 ? 0 : start + 20) && !bound; p++) bound = await tryListen(p);
      if (!bound) throw new Error(`No free port from ${start} to ${start + 20}`);
      port = (server.address() as AddressInfo).port;
      files = await project.listScenes();
      if (opts.watch !== false) startWatching();
      return { port, origin: `http://127.0.0.1:${port}` };
    },
    async close() {
      watcher?.close();
      timers.forEach((t) => clearTimeout(t));
      clients.forEach((c) => c.ws.close());
      wss.close();
      await new Promise<void>((r) => server.close(() => r()));
      server.closeAllConnections?.();
    },
  };
}

export { hashBytes };
