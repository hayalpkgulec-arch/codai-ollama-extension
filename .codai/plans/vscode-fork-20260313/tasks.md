# Tasks

## Phase 0 Pivot And Bootstrap

- [x] Mark the custom `apps/desktop` shell as a prototype-only direction
- [x] Add a dedicated VS Code OSS fork roadmap
- [x] Add a bootstrap script for cloning/updating upstream VS Code OSS into `.upstream/vscode`
- [x] Add npm scripts and ignore rules for the fork bootstrap path
- [x] Run the bootstrap and verify the upstream tree exists locally
- [x] Keep the upstream fork path out of the shipped VSIX

## Phase 1 Upstream Mapping

- [ ] Build the upstream VS Code OSS checkout locally
- [ ] Map the workbench injection points for CodAI surfaces
- [ ] Document which native panels/views can be reused before deeper shell patches
- [ ] Define the minimal first fork milestone: explorer + editor + CodAI chat + review + trace

## Phase 2 Shared Runtime Host

- [ ] Finish moving runtime/provider/tool modules into `packages/core`
- [ ] Add a VS Code OSS host adapter that satisfies workspace/editor/terminal/notification contracts
- [ ] Replace desktop mock timeline state with real shared runtime events
- [ ] Ensure trace, terminal, and provider channels stay isolated in the fork host

## Phase 3 CodAI Workbench Surfaces

- [ ] Add CodAI thread/task history surface inside the fork
- [ ] Add a native-feeling chat/composer surface
- [ ] Add Review / Changes / Trace panels wired to shared runtime data
- [ ] Connect diff/checkpoint data into the review lane

## Phase 4 Ask -> Edit -> Review

- [ ] Ask agent from inside the forked workbench
- [ ] Stream responses and tool cards in the fork UI
- [ ] Run commands with structured shell metadata and clean terminal parity
- [ ] Restore sessions, threads, and review state across restarts

## Maintenance Track

- [ ] Keep the VS Code extension limited to critical bugfixes, provider compatibility, security, and shared-core adoption

## Progress Log

- 2026-03-13: Pivoted away from the custom Electron + Monaco shell after it failed the expected Cursor-like quality bar. Added the first fork roadmap, marked the previous plan as superseded, and introduced a bootstrap script plus package wiring for a VS Code OSS-based CodAI desktop direction.
- 2026-03-13: Bootstrapped a local VS Code OSS source tree into `.upstream/vscode` from `microsoft/vscode` main (`df64f4f`). The next implementation slice should start mapping actual workbench injection points instead of extending the prototype desktop shell.
- 2026-03-13: Fixed the first maintenance issue caused by the fork pivot. VSIX packaging had started walking the local upstream checkout, so `.vscodeignore` was updated to exclude the fork source and keep extension packaging fast and bounded.
