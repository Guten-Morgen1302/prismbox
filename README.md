# Prismbox

**An agent-native visual editor for React Three Fiber.** Your AI agent writes the `.tsx`. You nudge the scene visually. The change lands as a minimal diff in the same file, and the agent can see what you are pointing at.

> **Status: active v1 development (milestone M2). Early.** You can run `prismbox` in a Vite + React 19 + R3F 9 project, drag objects on your real page, and watch each drag land as one line in your `.tsx`. There is no hosted Playground yet, and the API will change.

## The idea

Claude Code and Codex already write good React Three Fiber code, but you cannot *steer* it visually: "move the orb a bit left and make the glass less frosty" is slow and lossy in prose. Visual editors tend to own the scene and turn your code into a build artifact.

Prismbox is the missing loop:

1. The agent writes plain R3F in a `.tsx` file.
2. You drag, scrub and pick in a visual editor.
3. Each edit is a **minimal text diff** to that same file. No reprinting, no reformatting.
4. The agent can ask what you have selected ("make *this one* glassier") through MCP.
5. You commit plain R3F. Prismbox is never a runtime dependency; delete it and your app runs unchanged.

Round-tripping is only trustworthy on a declared subset of R3F, so Prismbox is strict about it: anything outside the subset is shown read-only and is **never rewritten**.

## What exists today

| Piece | State |
|---|---|
| `@prismbox/core`: parse R3F files, classify nodes and props, write one prop as a single-span edit | working, tested |
| `prismbox` CLI: `--version`, `--help` | working |
| Six hero templates (`packages/templates`), built from shared GLSL blocks (`packages/shaders`) | working |
| Studio Playground: scene tree, inspector, gizmo, live diff strip, Copy `.tsx` (runs locally, not deployed) | working |
| `prismbox` Local mode for Vite projects: daemon, real-page overlay, armed Studio, live disk write-back with undo and compare-and-set | working (`pnpm demo`) |
| `prismbox mcp`: MCP server (selection, live canvas capture, scene, minimal-diff edits, lint, authoring guide) | working |
| Next.js | planned |

See [docs/architecture.md](docs/architecture.md) for the design and [docs/subset.md](docs/subset.md) for exactly what is editable.

## Try it on a real page

```bash
pnpm install && pnpm build
pnpm demo     # prismbox on examples/vite-hero
```

Open the two URLs it prints: your page and Studio. Click **Arm**, then drag the 3D knot on the real page. See [examples/vite-hero](examples/vite-hero).

## Try the Playground locally

```bash
pnpm install
pnpm --filter @prismbox/studio dev
```

Open <http://127.0.0.1:4173/>. Pick a template, click an object, drag a gizmo handle or use the inspector, and watch the exact one-line patch land in the diff strip. **Copy .tsx** gives you plain React Three Fiber with no Prismbox in it. Design notes: [DESIGN.md](DESIGN.md).

## Try the core

```ts
import { readScene, setProp } from '@prismbox/core';

const scene = readScene(source);
// scene.nodes, scene.diagnostics, scene.summary.coverage

const result = setProp(source, {
  op: 'setProp',
  node: 'orb',            // the node's `name` prop, or a path id from the scene
  prop: 'position',
  value: [0.4, 0.1, 0],
});
result.source; // the file with exactly one span changed
result.hunk;   // { line, before, after } for a diff view
```

`@prismbox/core` is not published to npm yet; run it from a clone (below).

## Develop

Requires Node.js 22.12+ and pnpm 10.

```bash
git clone https://github.com/Guten-Morgen1302/prismbox.git
cd prismbox
pnpm install
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

The write path is held to three invariants, enforced by the test suite on real agent-written files (see [fixtures/subset/step0](fixtures/subset/step0)):

- a no-op leaves the file byte-identical,
- one primitive edit changes exactly one span,
- a file or node outside the subset is reported and never written.

## Contributing

Bug reports and small focused PRs are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md). Security issues: [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © 2026 Guten-Morgen1302
