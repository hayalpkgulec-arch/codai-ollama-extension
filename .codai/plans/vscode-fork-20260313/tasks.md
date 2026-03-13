# Tasks

## Phase 0 Pivot And Bootstrap

- [x] Mark the custom `apps/desktop` shell as a prototype-only direction
- [x] Add a dedicated VS Code OSS fork roadmap
- [x] Add a bootstrap script for cloning/updating upstream VS Code OSS into `.upstream/vscode`
- [x] Add npm scripts and ignore rules for the fork bootstrap path
- [x] Run the bootstrap and verify the upstream tree exists locally
- [x] Keep the upstream fork path out of the shipped VSIX
- [x] Add a repeatable local start script for the fork runtime environment
- [x] Move the default fork checkout outside the main repo root to avoid VS Code type collisions during upstream builds

## Phase 1 Upstream Mapping

- [x] Build the upstream VS Code OSS checkout locally
- [x] Map the workbench injection points for CodAI surfaces
- [x] Document which native panels/views can be reused before deeper shell patches
- [x] Define the minimal first fork milestone: explorer + editor + CodAI chat + review + trace
- [x] Define the first GUI-first fork milestone: threads + native composer + review lane + trace lane + session switching

## Phase 2 Shared Runtime Host

- [ ] Finish moving runtime/provider/tool modules into `packages/core`
- [ ] Add a VS Code OSS host adapter that satisfies workspace/editor/terminal/notification contracts
- [ ] Replace desktop mock timeline state with real shared runtime events
- [ ] Ensure trace, terminal, and provider channels stay isolated in the fork host

## Phase 3 CodAI Workbench Surfaces

- [x] Move CodAI into the native right auxiliary pane instead of the activity bar
- [x] Add the first Cursor/Dvina-style solid dark workbench pass across titlebar, rails, sidebars, panels, and tabs
- [x] Add the first unified right-pane dark pass so the CodAI webview and the fork shell share one palette
- [x] Remove the remaining blue accent leakage from the integrated fork and CodAI pane
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
- 2026-03-13: Finished the first local developer bootstrap for the fork path. Added a repeatable start script, isolated a portable Node 22 toolchain under `.tools`, and resolved the Windows-side blockers around Spectre libraries and Visual Studio 18 compatibility so the upstream fork can actually be launched for testing.
- 2026-03-13: Identified the first real fork-start regression: a nested checkout under `.upstream/vscode` let the main repo `node_modules/@types/vscode` leak into upstream extension builds, causing hundreds of duplicate identifier errors. The default bootstrap/start path now moves the fork to a sibling folder outside the repo root.
- 2026-03-13: Verified the external fork path fix by compiling VS Code OSS successfully from `..\codai-vscode-oss` and launching `Code - OSS` from that sibling checkout. The next slice should map GUI-first CodAI surfaces into the native workbench instead of spending more time on the discarded custom shell.
- 2026-03-13: Added the first native workbench patch map. The roadmap now points directly at `activitybar`, `sidebar`, `panel`, `auxiliarybar`, `chat`, `scm`, and `comments` as the concrete fork surfaces for the first CodAI GUI-first milestone.
- 2026-03-13: Delivered the first native right-lane CodAI slice. The extension now contributes its main view to the secondary sidebar, the fork opens it as the active auxiliary-bar AI surface on launch, and the shell styling pass now targets a darker, softer Cursor/Dvina baseline.
- 2026-03-13: Added the first palette-unification pass across the fork shell and the CodAI webview. The right AI lane now uses solid charcoal surfaces and softer neutral borders instead of mixing neutral dark with blue-tinted panels.
- 2026-03-13: Removed the remaining blue accent leakage from the right pane and shell chrome. Active, focused, selected, save/apply, and context states now resolve to neutral slate/graphite values instead of bright blue.
