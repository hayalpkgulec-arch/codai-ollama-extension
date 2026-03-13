# Requirements

## Goals

- WHEN CodAI shifts to an IDE-first roadmap THE SYSTEM SHALL keep the extension stable while moving new product investment into a shared core plus desktop workbench.
- WHEN terminal, provider, and tool behavior changes THE SYSTEM SHALL keep shell execution, provider fetch state, and runtime traces inspectable and deterministic.
- WHEN the desktop app is introduced THE SYSTEM SHALL provide a buildable Electron + Monaco skeleton that can evolve into an AI-native coding environment.

## Acceptance Criteria

- [x] A shared `packages/core` scaffold exists for host/runtime contracts
- [x] An `apps/desktop` Electron + Monaco workbench skeleton exists and builds independently
- [x] Windows shell execution is normalized through a shared envelope with requested vs adapted commands
- [x] Provider model fetching no longer self-triggers from its own fetch timestamps
- [ ] Model catalog ownership is fully centralized beyond the current App/settings split
- [ ] The extension is reduced to a thin shell over shared runtime modules
- [ ] Desktop alpha reaches open workspace, edit file, run command, ask agent, inspect trace, and review diff

## Progress Notes

- 2026-03-13: Started the IDE-first roadmap by adding a dedicated shared-core scaffold, a desktop Electron + Monaco workbench shell, shell execution envelopes for Windows command parity, and first-pass fixes for provider model fetch loops plus Ollama reachability polling.
- 2026-03-13: The desktop scaffold is now launchable from built files as well. Renderer assets are emitted with relative paths, so the Electron shell can load the workbench over `file://` instead of failing into a black screen on startup.
