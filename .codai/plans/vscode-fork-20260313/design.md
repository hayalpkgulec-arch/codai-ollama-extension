# Design

## Direction

CodAI Desktop will now be a VS Code OSS fork with CodAI-specific product layers added on top, not a custom workbench that imitates Cursor from scratch. That gives us mature editor, layout, explorer, terminal, tabs, theming, and command infrastructure on day one, while keeping our real differentiation in the agent runtime, review flow, trace visibility, and tool orchestration.

## Product Thesis

- Use VS Code OSS for the workbench, editor, terminal, panels, layout system, and native desktop behavior
- Use CodAI shared runtime for the model/provider/tool/trace layer
- Optimize for a GUI-first agentic coding IDE in the Dvina/Cursor class, where sessions, review, trace, and agent actions are first-class workbench surfaces
- Add CodAI product surfaces where Cursor differentiates:
  - chat and composer
  - review and changes lane
  - trace and tool transparency
  - task/session history
  - context-aware coding workflows

## Architecture

### Upstream Base

- Clone Microsoft VS Code OSS into a sibling folder outside the main repo root, defaulting to `..\codai-vscode-oss`
- Keep it ignored in the main repository and isolated from the extension repo's `node_modules`
- Maintain a CodAI branch inside that clone for workbench/product patches

### CodAI Overlay

- Keep CodAI runtime, tool, provider, and persistence code in this repository
- Extract shared runtime into `packages/core` so both the extension and the fork host can consume it
- Treat the current `apps/desktop` shell as a disposable prototype for interaction ideas only

### Integration Layers

1. Workbench host integration
- Right auxiliary bar entry point for CodAI chat plus sidebar/thread surfaces
- Secondary side panel or right panel entry for Review / Trace / Changes
- Bottom panel integration for terminal-aware tool output when needed

2. Runtime bridge
- Host-side adapter that exposes workspace, editor, terminal, notifications, and browser hooks to `@codai/core`
- Event stream from runtime into workbench panels and inline UI

3. Product surfaces
- Thread list and task history
- Agent timeline and composer
- Review lane with changed files, diff summaries, and checkpoint groups
- Trace lane with tool calls, shell metadata, provider events, and recovery hints
- Multi-session workflow primitives that feel native in the workbench instead of bolted onto a sidebar-only extension surface

## Fork Strategy

### Phase A: Bootstrap

- Clone upstream VS Code OSS
- Verify local build
- Identify injection points for:
  - custom activity item
  - chat/composer panel
  - review pane
  - trace pane
  - session history view

### Phase B: CodAI Shell Inside VS Code OSS

- Add CodAI workbench contributions using native VS Code panels/views first
- Avoid immediate deep core surgery where an extension-like workbench contribution is enough
- Reuse VS Code layout, typography, theming, explorer, tabs, status bar, and terminal

### Phase C: Deep Productization

- Move beyond extension-style surfaces where needed for a Cursor-like experience
- Tighten Ask -> Edit -> Review loop
- Add review-first diff UX, tool traces, and richer agent controls directly into the workbench
- Bring in GUI-first traits from Dvina-class tools: persistent session switching, visual agent affordances, and strong review visibility without hiding the editor

## Constraints

- Keep the extension shippable while the fork spins up
- Do not vendor the upstream repo into the published extension artifact
- Do not nest the upstream fork under the extension repo root; the upstream TypeScript build must stay isolated from the extension workspace
- Keep runtime, tool, and trace behavior local-first
- Avoid forking faster than we can maintain; patch discipline matters more than breadth

## Done Criteria

- The repo can bootstrap the upstream fork with one command
- The new roadmap clearly supersedes the rejected custom shell direction
- The next implementation slice can begin from a real upstream tree instead of more mock desktop CSS

## Progress Notes

- 2026-03-13: Added the fork bootstrap script and used it to create a local shallow clone of VS Code OSS under `.upstream/vscode`. The next implementation slice should work against that tree and stop spending product effort on the rejected custom shell.
- 2026-03-13: The first upstream build surfaced a real isolation problem: nesting the fork inside this repository let the extension workspace leak `@types/vscode` into upstream extension compiles. The default fork location is now moved outside the repo root to keep the VS Code OSS workspace clean.
- 2026-03-13: The design north star is now explicitly GUI-first and session-centric. The fork should evolve toward Dvina/Cursor-level native workbench flows, not back toward a webview-style assistant shell.
- 2026-03-13: Added the first workbench patch map to ground the fork effort in concrete VS Code OSS files and surfaces. This keeps the next implementation slice focused on native activity bar, sidebar, auxiliary bar, chat, SCM, and comments primitives instead of abstract shell ideas.
- 2026-03-13: The first native shell pass moved CodAI into the auxiliary right lane and made the fork launch path load the local CodAI extension as the active AI surface. The next design slice should make the CodAI webview feel more native inside that lane and align review/trace surfaces around it.
- 2026-03-13: The first palette-unification pass now treats the fork shell and the CodAI right pane as one visual system. The current direction is solid charcoal surfaces, low-contrast borders, restrained blue accents, and softer card geometry closer to Cursor/Dvina than to a standalone extension panel.
- 2026-03-13: The accent palette is now being collapsed further from restrained blue into near-monochrome slate. The visual target is dark, dense, and soft, with contrast coming mostly from value and spacing instead of hue.
