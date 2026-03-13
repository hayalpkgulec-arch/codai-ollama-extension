# Requirements

## Goals

- WHEN CodAI targets a true Cursor-class IDE THE SYSTEM SHALL use a VS Code OSS fork as the desktop foundation instead of deepening the custom Electron + Monaco prototype shell.
- WHEN desktop work starts again THE SYSTEM SHALL integrate the existing CodAI runtime, tool, and provider stack into the forked workbench instead of rebuilding editor chrome from scratch.
- WHEN the fork is bootstrapped THE SYSTEM SHALL keep the upstream source outside the shipping VSIX artifact, outside the main repo history, and outside the main repo root by default.
- WHEN desktop workbench customizations are added THE SYSTEM SHALL preserve the ask-edit-review workflow with CodAI-specific chat, review, trace, and tool visibility.
- WHEN desktop product design advances THE SYSTEM SHALL optimize for a GUI-first agentic coding IDE inspired by Dvina and Cursor, not an extension-first shell transplanted into a desktop window.

## Acceptance Criteria

- [x] A dedicated VS Code OSS fork roadmap exists under `.codai/plans/vscode-fork-20260313/`
- [x] The previous custom desktop shell is explicitly marked as a prototype/superseded direction
- [x] A bootstrap script exists to clone or refresh upstream VS Code OSS into an ignored workspace path
- [x] The upstream fork is cloned locally into `.upstream/vscode`
- [x] The upstream fork path is excluded from shipped VSIX artifacts
- [x] The repo contains a repeatable local start path for the fork using the correct Node toolchain
- [x] The default fork path no longer lives under the main repo root, preventing ambient TypeScript type leakage from the extension workspace into upstream builds
- [x] A documented patch map exists for where CodAI will hook chat, review, trace, terminal, and runtime surfaces into VS Code OSS
- [x] The fork launch path opens CodAI as the extension-backed AI surface inside the native right auxiliary pane
- [x] The first integrated right-pane slice uses a shared neutral-dark palette across the fork shell and the CodAI webview instead of mismatched blue and dark surfaces
- [ ] Shared runtime modules are consumable from the fork host without depending on the VS Code extension webview shell
- [ ] The first fork milestone can open a workspace, show the explorer/editor, open CodAI chat, and render review/trace side panels
- [ ] The first GUI-first fork milestone supports persistent thread history, review-first side panels, and a native-feeling agent composer inside the VS Code OSS workbench

## Non-Goals For This Pivot Slice

- Shipping a finished desktop IDE in this change
- Achieving full Cursor parity immediately
- Replacing all extension UX in one step
- Pulling LSP, marketplace, or full git porcelain into the first fork milestone

## Progress Notes

- 2026-03-13: The product direction changed from a custom Electron + Monaco desktop shell to a VS Code OSS fork after the prototype shell failed the expected Cursor-like quality bar. The repo now carries a dedicated fork roadmap and bootstrap tooling to make the pivot concrete.
- 2026-03-13: The first upstream bootstrap completed successfully. `.upstream/vscode` now tracks Microsoft VS Code OSS `main` at `df64f4f`, giving the next slice a real fork base instead of more mock workbench work.
- 2026-03-13: Extension packaging was hardened for the new fork layout. `.vscodeignore` now excludes `.upstream`, `.forks`, `.codai`, and `scripts`, preventing the local VS Code OSS checkout from bloating or stalling VSIX packaging.
- 2026-03-13: The local start prerequisites are now encoded into the repo. The fork can be launched through a dedicated script that uses portable Node 22, the VS Code OSS checkout, and the required Visual Studio environment overrides instead of relying on ad hoc manual setup.
- 2026-03-13: The fork bootstrap/start path was moved out of the repository root after the first upstream compile attempt showed duplicate `vscode.d.ts` symbols coming from the main repo's `node_modules/@types/vscode`. The default fork location is now a sibling folder to keep the upstream workspace isolated.
- 2026-03-13: The visual product target is now explicitly GUI-first. Dvina-style multi-session agent workflows and Cursor-like native workbench polish are the benchmark, while VS Code OSS remains the technical base.
- 2026-03-13: The first integrated fork slice now launches with the local CodAI extension loaded as the active AI surface. CodAI is contributed into the secondary sidebar/right auxiliary bar, giving the fork a real extension-backed agent lane instead of a mock shell.
- 2026-03-13: The first right-pane visual unification pass is in place. The shell and CodAI lane now share a darker neutral palette, which raises the baseline before deeper native thread/review/trace work.
