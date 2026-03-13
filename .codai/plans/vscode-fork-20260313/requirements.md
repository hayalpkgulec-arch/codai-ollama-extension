# Requirements

## Goals

- WHEN CodAI targets a true Cursor-class IDE THE SYSTEM SHALL use a VS Code OSS fork as the desktop foundation instead of deepening the custom Electron + Monaco prototype shell.
- WHEN desktop work starts again THE SYSTEM SHALL integrate the existing CodAI runtime, tool, and provider stack into the forked workbench instead of rebuilding editor chrome from scratch.
- WHEN the fork is bootstrapped THE SYSTEM SHALL keep the upstream source outside the shipping VSIX artifact and outside the main repo history by default.
- WHEN desktop workbench customizations are added THE SYSTEM SHALL preserve the ask-edit-review workflow with CodAI-specific chat, review, trace, and tool visibility.

## Acceptance Criteria

- [x] A dedicated VS Code OSS fork roadmap exists under `.codai/plans/vscode-fork-20260313/`
- [x] The previous custom desktop shell is explicitly marked as a prototype/superseded direction
- [x] A bootstrap script exists to clone or refresh upstream VS Code OSS into an ignored workspace path
- [x] The upstream fork is cloned locally into `.upstream/vscode`
- [x] The upstream fork path is excluded from shipped VSIX artifacts
- [ ] A documented patch map exists for where CodAI will hook chat, review, trace, terminal, and runtime surfaces into VS Code OSS
- [ ] Shared runtime modules are consumable from the fork host without depending on the VS Code extension webview shell
- [ ] The first fork milestone can open a workspace, show the explorer/editor, open CodAI chat, and render review/trace side panels

## Non-Goals For This Pivot Slice

- Shipping a finished desktop IDE in this change
- Achieving full Cursor parity immediately
- Replacing all extension UX in one step
- Pulling LSP, marketplace, or full git porcelain into the first fork milestone

## Progress Notes

- 2026-03-13: The product direction changed from a custom Electron + Monaco desktop shell to a VS Code OSS fork after the prototype shell failed the expected Cursor-like quality bar. The repo now carries a dedicated fork roadmap and bootstrap tooling to make the pivot concrete.
- 2026-03-13: The first upstream bootstrap completed successfully. `.upstream/vscode` now tracks Microsoft VS Code OSS `main` at `df64f4f`, giving the next slice a real fork base instead of more mock workbench work.
- 2026-03-13: Extension packaging was hardened for the new fork layout. `.vscodeignore` now excludes `.upstream`, `.forks`, `.codai`, and `scripts`, preventing the local VS Code OSS checkout from bloating or stalling VSIX packaging.
