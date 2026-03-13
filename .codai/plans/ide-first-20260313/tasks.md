# Tasks

## Phase 1 Shared Core Readiness

- [x] Add `packages/core` with host/runtime contract exports
- [ ] Move provider registry and runtime services into `@codai/core`
- [ ] Add shared storage/trace contracts used by both extension and desktop

## Phase 2 Stability Before Extraction

- [x] Add `ShellExecutionService` with `requestedCommand`, `adaptedCommand`, `shellKind`, `cwd`, and `executionPath`
- [x] Make `CodaiTerminalManager` use a single shell config for shell integration, spawn, and terminal mirroring
- [x] Include shell execution metadata in `run_command` tool results
- [x] Stop provider settings auto-fetch from re-triggering on its own `lastFetchedAt` updates
- [x] Gate Ollama polling so it only continues while models are missing or stale
- [ ] Introduce a single model catalog controller used across the entire webview/runtime boundary
- [ ] Isolate terminal/provider/chat trace channels more deeply in runtime storage

## Phase 3 Desktop Workbench Skeleton

- [x] Add `apps/desktop` package with Electron main/preload build setup
- [x] Add a Monaco renderer with file tree, tabs, and agent/sidebar layout
- [x] Add workspace open + file read IPC bridge
- [x] Fix Electron `file://` renderer asset paths so the desktop app does not open to a black screen
- [x] Add integrated terminal bridge beyond the current placeholder panel
- [ ] Connect desktop UI to the shared runtime instead of mock timeline cards

## Phase 4 Desktop Alpha

- [x] Open workspace
- [x] Edit file
- [x] Run command
- [ ] Ask agent
- [x] Inspect trace
- [x] Review diff
- [ ] Reopen session

## Maintenance Track

- [ ] Keep the extension limited to critical bugfixes, provider compatibility, security, and shared-core adoption

## Progress Log

- 2026-03-13: Implemented the first IDE-first slice by adding the `packages/core` scaffold, the `apps/desktop` Electron + Monaco shell, explicit Windows shell execution envelopes, `run_command` shell metadata, and the first model-fetch ownership fixes for provider settings plus background Ollama polling.
- 2026-03-13: Fixed the first desktop launch blocker by switching the renderer build to relative asset paths. Electron now loads the built Vite bundle through `file://` without resolving JS and CSS from the drive root, which was causing the desktop window to stay black.
- 2026-03-13: Completed the first real desktop workbench slice by replacing the placeholder shell with a Cursor-like rail/sidebar/editor/right-pane layout, adding desktop workbench/runtime stores, wiring workspace and runtime IPC events, enabling file save plus diff review, and connecting a structured terminal run surface that feeds both the bottom activity dock and the trace pane.
