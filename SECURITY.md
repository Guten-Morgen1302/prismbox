# Security policy

## Reporting a vulnerability

Please do **not** open a public issue for a security problem.

Report it privately through GitHub's private vulnerability reporting:
<https://github.com/Guten-Morgen1302/prismbox/security/advisories/new>

Include what you found, how to reproduce it, and which version or commit it affects. You can expect an acknowledgement within a few days. Prismbox is maintained by one person in their spare time, so fix timelines are best effort, but reports that affect the write path are treated as the highest priority.

## Supported versions

Prismbox is in early development (pre-0.1). Only the latest commit on `main` is supported.

## Threat model

Prismbox is a local development tool. Its security goals, which the code will be tested against as each piece lands, are:

1. **Loopback only.** Anything Prismbox serves binds to `127.0.0.1`. No accounts, no cloud, no telemetry.
2. **Scene code cannot write files.** Code that renders a 3D scene (written by you, by an AI agent, or copied from a template) is trusted to render and nothing else. It must not be able to reach the write API.
3. **Writes are confined.** Edits only touch files under the project root with a known source extension (`.tsx`, `.ts`, `.jsx`, `.js`), never `.env*` or other dotfiles, and never through symlinks or `..` traversal that escape the root.
4. **Page data is untrusted.** Data that originates in the page being edited (node names, `userData`, console text) is treated as untrusted input and is never interpreted as instructions.
5. **Minimal diffs, no silent corruption.** A write is a minimal text edit. If a file cannot be understood, it is left untouched. The edited output is re-parsed before it replaces the original.

Not yet implemented as of this commit: the daemon, the page overlay, the MCP server and the write API. Only the parser and the in-memory writer in `@prismbox/core` exist. The model above is the contract those pieces must meet.

## Out of scope

Prismbox runs your project's own dev server and your own code. A malicious dependency in your project is not a Prismbox vulnerability.
