# Design

## Direction

CodAI Desktop will now be a VS Code OSS fork with CodAI-specific product layers added on top, not a custom workbench that imitates Cursor from scratch. That gives us mature editor, layout, explorer, terminal, tabs, theming, and command infrastructure on day one, while keeping our real differentiation in the agent runtime, review flow, trace visibility, and tool orchestration.

## Product Thesis

- Use VS Code OSS for the workbench, editor, terminal, panels, layout system, and native desktop behavior
- Use CodAI shared runtime for the model/provider/tool/trace layer
- Add CodAI product surfaces where Cursor differentiates:
  - chat and composer
  - review and changes lane
  - trace and tool transparency
  - task/session history
  - context-aware coding workflows

## Architecture

### Upstream Base

- Clone Microsoft VS Code OSS into `.upstream/vscode`
- Keep it ignored in the main repository
- Maintain a CodAI branch inside that clone for workbench/product patches

### CodAI Overlay

- Keep CodAI runtime, tool, provider, and persistence code in this repository
- Extract shared runtime into `packages/core` so both the extension and the fork host can consume it
- Treat the current `apps/desktop` shell as a disposable prototype for interaction ideas only

### Integration Layers

1. Workbench host integration
- Activity bar / sidebar entry points for CodAI
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

## Constraints

- Keep the extension shippable while the fork spins up
- Do not vendor the upstream repo into the published extension artifact
- Keep runtime, tool, and trace behavior local-first
- Avoid forking faster than we can maintain; patch discipline matters more than breadth

## Done Criteria

- The repo can bootstrap the upstream fork with one command
- The new roadmap clearly supersedes the rejected custom shell direction
- The next implementation slice can begin from a real upstream tree instead of more mock desktop CSS

## Progress Notes

- 2026-03-13: Added the fork bootstrap script and used it to create a local shallow clone of VS Code OSS under `.upstream/vscode`. The next implementation slice should work against that tree and stop spending product effort on the rejected custom shell.
