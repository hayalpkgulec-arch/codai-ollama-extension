# Design

## Direction

CodAI now treats the VS Code extension as the compatibility shell and the standalone desktop IDE as the product surface. The immediate goal is not to replace the extension overnight, but to stop deepening extension-specific coupling while giving the future IDE a real codebase to grow from.

## Phase Breakdown

1. Shared core contracts and host abstractions
2. Terminal and provider stability fixes at the extension/runtime boundary
3. Desktop workbench skeleton with Electron main process, preload bridge, and Monaco renderer
4. Shared runtime extraction from extension modules into the core package
5. Desktop alpha flows and extension maintenance-only track

## Constraints

- Keep the existing extension shippable during the transition
- Do not break VSIX packaging with new desktop/core source trees
- Keep traces local-only
- Make shell execution explicit on Windows so mirrored terminal output matches real execution semantics

## Done Criteria

- `npm test` passes for the extension
- `npm run compile` passes for the extension
- `npx @vscode/vsce package` passes
- `npm --prefix apps/desktop run build` passes
- The new plan files stay updated after each delivered slice

## Progress Notes

- 2026-03-13: Phase 1 and the first Phase 2 fixes are in motion. `ShellExecutionService` now defines explicit shell envelopes, the terminal manager consumes a single shell config for shell integration, child process spawn, and terminal mirroring, and the provider settings/app layer now share model-fetch helper logic so Ollama polling stops once models are actually loaded.
- 2026-03-13: Phase 3 started with a real `apps/desktop` scaffold. The new Electron main process can open a workspace and read files, the renderer presents a file tree + Monaco editor + agent shell layout, and `.vscodeignore` now keeps the desktop/core sources out of the VSIX artifact.
- 2026-03-13: The first desktop bootstrap bug is closed as well. The renderer build now emits relative asset URLs for `file://` loading, preventing the black-screen launch failure that came from Electron resolving `/assets/...` against the machine root instead of the built app directory.
