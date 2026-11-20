# Architecture

Prismbox is in early development. This page describes the intended design and marks what exists. See the README for the current status.

## Principles

- **Your source file is the single source of truth.** The editor never owns the scene.
- **Minimal diffs.** An edit is a text splice on one span. Prismbox never reprints or reformats your file.
- **A declared subset.** Round-tripping is only trustworthy on a known subset of R3F (see [subset.md](subset.md)). Everything outside it degrades to read-only, never to a corrupted file.
- **No lock-in.** Prismbox is never a dependency of your app. Delete it and nothing breaks.
- **Local, loopback, no telemetry.**

## The three surfaces (Local mode)

```
 Claude Code / Codex           your project on disk: *.tsx is the source of truth
 ┌──────────────┐ stdio   ┌──────────────────────────────────────────────────────┐
 │ MCP client   ├───────▶ │ stdio proxy ──▶ daemon (per project)                  │
 └──────────────┘         │                 ops queue, compare-and-set, scene      │
                          │                 snapshot, watcher, atomic write        │
                          └───────▲───────────────────────────────▲───────────────┘
                     observation  │ (untrusted)        write token │ (Studio only)
                   ┌──────────────┴────────────┐     ┌────────────┴───────────┐
                   │ your real page             │     │ Studio tab (localhost)  │
                   │ dev server + dev plugin    │     │ tree, inspector,        │
                   │ overlay: pick, gizmo,      │     │ diff strip, agent pill  │
                   │ capture                    │     └─────────────────────────┘
                   └────────────────────────────┘
```

1. **Your real page** runs on your own dev server. A dev-only plugin (Vite first) tags R3F elements with their source location and injects a small overlay into the page's own `<Canvas>`. The overlay does picking, the gizmo, camera swap and canvas capture through the public `useThree()` API.
2. **The daemon** owns the scene snapshot, the ops queue and the write path. Claude talks to it over MCP.
3. **Studio** is the control panel: scene tree, inspector, a diff strip showing every edit as a real diff, and an agent-context indicator.

**Fallback.** Where the plugin cannot inject (Next.js until a zero-repo-change launch exists, scene-only modules), an isolated harness renders the component in a separate-origin iframe.

**Playground.** The same Studio on an in-memory file system, for editing templates in the browser with zero install. It edits templates, not your repo.

## Animation pause (d9)

While a gizmo handle is hovered **or** dragged, the overlay pauses animation by freezing the R3F clock: `clock.getDelta()` returns 0 and keeps `oldTime` fresh, so `useFrame` callbacks keep running with `delta = 0` and a frozen `elapsedTime`, and animation resumes exactly where it stopped. R3F's own `setFrameloop` is not used because it resets `clock.elapsedTime` to 0, which makes absolute-time animation jump. Code that reads time itself (`performance.now()`, GSAP, CSS) is not paused. This relies on R3F's loop calling `clock.getDelta()`; `apps/studio/test/clock.test.ts` reads the installed R3F source and fails if that stops being true, and the overlay warns at runtime if a frozen frame reports a non-zero delta.

## Playground sandbox (d2)

Scene code runs in an iframe with `sandbox="allow-scripts"` and no `allow-same-origin`: an opaque origin with no access to Studio's storage or DOM. The only channel is a typed, validated `postMessage` protocol (`apps/studio/src/protocol.ts`); Studio ignores anything that does not parse and any message not from its own iframe. Inside, `instrument()` tags the file, Sucrase strips TypeScript and JSX, and the result is evaluated against a fixed module map (react, three, R3F, drei, the overlay, relative files); any other import is an `UNSUPPORTED_IMPORT` error, never a network fetch. The production build adds a CSP to the sandbox page with `connect-src 'none'`. Edits live in an in-memory file system and are saved to `localStorage`.

## Write-back (`@prismbox/core`, implemented)

- **Parse** with `@babel/parser`. Never reprint.
- **Edit** with semantic ops resolved against a fresh AST and applied as span replacements with `magic-string`.
- **Identity**: a node's id is its `name` prop if unique, else a structural path. Ambiguity is an error, never a guess.
- **Concurrency**: ops carry the value the caller last saw (`expected`); a mismatch is `CONFLICT`.
- **Invariants** (CI-enforced): no-op is byte-identical; one primitive op changes one span; out-of-subset input produces diagnostics and zero writes; the edited output is re-parsed before it is accepted.

## Trust model (design, not yet implemented)

- Everything the page sends is untrusted observation: strings are length-capped, labeled untrusted in MCP results, and never placed in instruction position.
- The write token lives only in Studio-origin session storage. The page channel carries an observation token that rotates per page load and has no write authority.
- Page-originated edits (a gizmo drag happens in your page) arrive as bounded proposals and are accepted only while Studio is **armed**.
- Scene code, whether written by you, an agent or a template, can render but cannot reach the write API.

See [SECURITY.md](../SECURITY.md).

## Packages

| Path | Purpose | State |
|---|---|---|
| `packages/core` | `@prismbox/core`: parser, subset classifier, writer, `instrument()`, `outline()` | implemented (reader, `setProp`, `setUniform`, per-key uniforms) |
| `packages/bridge` | `prismbox` CLI; later the daemon, Vite plugin, harness and MCP server | CLI skeleton |
| `apps/studio` | Studio control panel and the browser Playground (memory FS, sandboxed preview) | implemented for the Playground; not deployed |
| `packages/templates`, `packages/shaders` | six hero templates and the GLSL blocks they are built from | implemented |
| `packages/behaviors` | copy-in behavior wrappers | planned |
| `fixtures/subset` | conformance fixtures | Step 0 files |
| `examples/` | `vite-landing`, `next-landing` end-to-end targets | planned |

## Roadmap

- **M0:** repository standards, CI, `@prismbox/core` reader and writer, CLI skeleton.
- **M1 (in progress):** `instrument()`, per-key uniforms, six hero templates, Studio on the memory file system (Playground, not deployed). Still to do: `unsetProp`, behaviors package, templates 7 to 10.
- **M2:** the Vite real-page plugin, daemon, overlay with gizmo, `setCamera`, Studio control panel. Gate: scripted demo on a real Vite page.
- **M3:** MCP server and agent style guide, point-at selection, Next harness fallback.
- **M4:** polish, demo, public launch.

Before M2, a spike (Step 0b) must show that a dev-time plugin can inject the overlay into a real Vite page and support pick-to-source and gizmo drag.
