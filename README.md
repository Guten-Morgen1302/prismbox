# Prismbox

**Edit React Three Fiber on your real page. Each change is one line in your `.tsx`, and your coding agent can point at what you select.**

[**Live Browser Playground**](#try-it-in-the-browser) · [Quickstart](#quickstart) · [MCP setup](#connect-your-coding-agent) · [Security](#security-model) · [Contributing](CONTRIBUTING.md)

<!-- DEMO_VIDEO_URL -->

Prismbox is a visual editor for [React Three Fiber](https://r3f.docs.pmnd.rs) that treats your source file as the single source of truth. You run it next to your own Vite dev server, drag an object on your actual landing page, and the edit lands in the file as a text diff, not a regenerated file. An MCP server lets Claude Code, Cursor, Windsurf or Codex see what you have selected and edit it the same way.

You commit plain React Three Fiber. Prismbox is not a dependency of your project and adds nothing to your production bundle.

## Quickstart

In a Vite + React 19 + React Three Fiber 9 project:

```bash
npx prismbox
```

It starts a local daemon, runs **your** Vite dev server with a dev-only plugin attached, and prints two URLs: your page and Studio. Open both, click **Arm** in Studio, then click and drag objects on your real page. Nothing in your project is modified: your `vite.config`, `package.json` and imports stay as they are. Studio starts **disarmed**, and while disarmed your page behaves exactly as it does in production.

## Try it in the browser

<!-- PLAYGROUND_URL -->

The Playground is Studio on an in-memory file system: six hero templates, edited in the browser, with **Copy .tsx** to take the result with you. It edits templates, not your repo. The hosted copy is not live yet; run it locally with `pnpm --filter @prismbox/studio dev` (see [Develop](#develop)).

## Connect your coding agent

```bash
# Claude Code
claude mcp add prismbox -- npx -y prismbox mcp --root /path/to/your/project

# prints these for your platform (including Cursor and Windsurf JSON); writes nothing
npx prismbox mcp --print-config --root .
```

Cursor (`.cursor/mcp.json`) or Windsurf (`~/.codeium/windsurf/mcp_config.json`):

```json
{
  "mcpServers": {
    "prismbox": { "command": "npx", "args": ["-y", "prismbox", "mcp", "--root", "/path/to/your/project"] }
  }
}
```

On Windows, MCP clients start servers without a shell: use `"command": "cmd", "args": ["/c", "npx", "-y", ...]`. `--print-config` does this for you.

Run `npx prismbox` in the project, open your page, click an object, and tell the agent to make *this* glassier. It calls `prism_get_selection`, looks with `prism_get_view`, and edits with `prism_set_prop` or `prism_set_uniform`. Every agent edit appears in Studio tagged `agent`, with one-click undo.

| Tool | What it does |
|---|---|
| `prism_get_selection` | The node you selected: file, line, props, shader uniforms, surrounding source |
| `prism_get_view` | A PNG of the live canvas (gizmo hidden) plus camera and viewport |
| `prism_get_scene` | The scene tree with edit state per node |
| `prism_set_prop`, `prism_set_uniform` | Validated one-line edits, compare-and-set, returns a diff |
| `prism_lint` | Subset and style findings with fixes. Works without the daemon |
| `prismbox://guide` (resource) | How to write R3F that Prismbox can edit |

## What it does

**Real-page visual editing.** The overlay runs inside your page's own `<Canvas>`: pick, drag a transform gizmo, scrub a shader uniform. The daemon turns each gesture into one minimal text edit with `magic-string`. Your formatting, comments and line endings are untouched, writes are atomic, and undo restores the exact original bytes. If the file changed on disk since you last looked (an editor, a coding agent), the write is refused instead of clobbering it.

**Agent point-and-edit.** "This" means whatever you have selected. The agent gets the file, line, props and a live screenshot, and its edits go through the same parser and compare-and-set writer as yours.

**No lock-in.** `vite build` on your project produces a bundle with zero Prismbox bytes, and a test asserts it: the plugin only exists in the dev server Prismbox starts, and `// @prism` shader annotations are ordinary GLSL comments.

## How it compares

There are several ways to edit 3D on the web, and the others are good. This is our understanding of each at the time of writing; check their docs for the current state.

| | Prismbox | [Triplex](https://triplex.dev) | [Spline](https://spline.design) |
|---|---|---|---|
| Source of truth | Your `.tsx` | Your `.tsx` | A Spline scene, exported to code |
| Where you edit | Your real running page | A dedicated editor | The Spline app |
| How edits land | Minimal text diffs to your file | Edits to your file | In the scene, then export |
| Agent integration | MCP server: selection, screenshot, edits | Check their docs | Check their docs |
| Scope | R3F scenes in Vite projects | R3F components, broader editor | Full 3D design: modeling, materials, interaction |
| License | MIT, runs locally | See their repo | Commercial, free tier |

Pick Spline if you want a design tool and are fine with exported code. Pick Triplex if you want a full-featured editor for your R3F components. Pick Prismbox if you want to nudge a scene an agent wrote, on the real page, and keep the diff reviewable.

## Limitations

- **Vite only for now.** Next.js is on the roadmap; it needs a launch path that does not ask you to change your config.
- **A declared subset.** Round-tripping is only trustworthy on literal props. An expression such as `position={[x, y * 2, 0]}` is shown read-only and never rewritten; so is anything inside `.map()` or a conditional. See [docs/subset.md](docs/subset.md). In our first measurement, agent-written hero scenes were about 97% editable with the style guide and about 72% without (10 files: a regression signal, not a benchmark).
- **Animation pauses while you edit.** While a gizmo handle is hovered or dragged, the R3F clock is frozen. Animation driven by `performance.now()` or `Date.now()` is not paused.
- **Pointer handlers on the 3D scene are paused while armed.** Ordinary page controls keep working.
- **Early software.** It is 0.1: expect rough edges, and the API will change.

## Security model

Prismbox is a local tool: no accounts, no cloud, no telemetry. The daemon binds to `127.0.0.1` only and checks the `Host` and `Origin` headers.

- **Armed gate (`d8`).** The page is untrusted. A drag on the page is a *proposal* that the daemon accepts only while you have armed Studio, rate-limited and bounded, and re-validated against the daemon's own parse of the current file. Disarmed, forged, stale or malformed proposals are rejected and the file is untouched.
- **Write confinement.** Only `.tsx .ts .jsx .js` files under the project root; never dotfiles, `.env*` or `node_modules`; symlinks that escape the root are refused.
- **Session token.** Studio's write token never reaches your page. The MCP server reads it from `~/.prismbox/sessions/`, outside your project, mode 0600 on POSIX.
- **Scene code cannot write files.** In the Playground, templates run in a sandboxed iframe with an opaque origin and no network access.

Details and known limits: [SECURITY.md](SECURITY.md) and [docs/architecture.md](docs/architecture.md). Please report vulnerabilities privately.

## Develop

```bash
git clone https://github.com/Guten-Morgen1302/prismbox.git
cd prismbox && pnpm install && pnpm build
pnpm demo                          # prismbox on examples/vite-hero (a plain landing page with no Prismbox in it)
pnpm --filter @prismbox/studio dev # the Playground at http://127.0.0.1:4173
pnpm test                          # unit and integration
pnpm e2e                           # real browser, real daemon, real MCP client (needs Chromium)
node scripts/pack-smoke.mjs        # packs the tarballs and runs them outside this repo, like npx would
```

Packages: `@prismbox/core` (parser, writer, `instrument()`), `prismbox` (CLI, daemon, Vite plugin, overlay, MCP server, bundled Studio), `apps/studio` (Studio and the Playground), `packages/templates` (hero templates), `packages/shaders` (GLSL blocks). Deploying the Playground: [docs/deploy-playground.md](docs/deploy-playground.md).

## Contributing

Bug reports with the smallest `.tsx` that reproduces them, and hero templates, are the most useful contributions. A template is one plain `.tsx` file with no Prismbox import; the rules and the authoring flow are in [docs/writing-a-template.md](docs/writing-a-template.md), and the PR checklist is in [CONTRIBUTING.md](CONTRIBUTING.md). Templates 7 to 10 are open.

## License

[MIT](LICENSE) © 2026 Guten-Morgen1302
