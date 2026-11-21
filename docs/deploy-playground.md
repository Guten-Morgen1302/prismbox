# Deploying the static Playground

The Playground is `apps/studio` built as static files. Two things matter on any host:

1. **CORS on assets.** Scene code runs in an iframe with `sandbox="allow-scripts"` and no `allow-same-origin`, so it has an opaque origin and loads its modules cross-origin. Everything under `/assets/` (and `sandbox.html`) needs `Access-Control-Allow-Origin: *`. They are public static files.
2. **SPA fallback** to `index.html`, but real files (`/sandbox.html`, `/assets/*`) must still be served as files and a missing asset must be a 404.

Both configs below do this and add a strict CSP for the Studio page (`frame-ancestors 'none'`) while letting `sandbox.html` be framed by Studio only. `sandbox.html` also carries its own CSP in a `<meta>` tag with `connect-src 'none'`, so scene code cannot make network requests.

## Cloudflare Pages

- Build command: `pnpm install --frozen-lockfile && pnpm --filter @prismbox/studio build`
- Build output directory: `apps/studio/dist`
- Root directory: the repository root (the Studio build reads `packages/core` and `packages/templates`).
- Headers come from `apps/studio/public/_headers` (copied into `dist/`).

## Vercel

- Framework preset: Other. Root directory: `apps/studio`, with **Include source files outside of the Root Directory** enabled.
- Install command: `pnpm install --frozen-lockfile` (run from the repository root). Build command: `pnpm --filter @prismbox/studio build`. Output directory: `dist`.
- Headers and the SPA rewrite come from `apps/studio/vercel.json`.

## Before you announce

- Open the URL in a private window; every template should load with no console errors.
- Keep it unlisted (`noindex` is already set on both pages) until the launch.
- Put the URL in `README.md` where `<!-- PLAYGROUND_URL -->` appears.

`pnpm e2e` includes a run of the production build behind a small host that applies `_headers` (`e2e/playground.e2e.mjs`), so the header file is tested, not just the build.
