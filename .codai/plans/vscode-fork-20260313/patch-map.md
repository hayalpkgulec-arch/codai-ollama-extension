# CodAI VS Code OSS Patch Map

## Delivered Slice

- 2026-03-13: First GUI-first native shell pass shipped.
  - `src/vs/workbench/contrib/codai/browser/codai.contribution.ts`: moves and opens the CodAI extension container in the auxiliary bar
  - `src/vs/workbench/workbench.common.main.ts`: registers the CodAI workbench contribution
  - `src/vs/workbench/browser/parts/titlebar/media/titlebarpart.css`: introduces CodAI shell tokens and flatter titlebar styling
  - `src/vs/workbench/browser/parts/activitybar/media/activitybarpart.css`: soft solid rail styling
  - `src/vs/workbench/browser/parts/sidebar/media/sidebarpart.css`: denser dark sidebar styling
  - `src/vs/workbench/browser/parts/auxiliarybar/media/auxiliaryBarPart.css`: dedicated right-lane styling for the CodAI AI surface
  - `src/vs/workbench/browser/parts/panel/media/panelpart.css`: bottom panel styling aligned with the new shell
  - `src/vs/workbench/browser/parts/editor/media/editortabscontrol.css`: softer editor tabs closer to the Cursor/Dvina target
- 2026-03-13: First right-pane palette unification pass shipped.
  - `webview-ui/src/App.css`: moves the CodAI webview away from transparent and blue-tinted extension styling toward solid charcoal cards, composer surfaces, and softer neutral borders
  - `src/vs/workbench/browser/parts/statusbar/media/statusbarpart.css`: aligns the lower shell with the darker neutral baseline
  - `src/vs/workbench/browser/parts/sidebar/media/sidebarpart.css`: removes the more saturated blue row selection in favor of softer neutral active states
  - `src/vs/workbench/browser/parts/auxiliarybar/media/auxiliaryBarPart.css`: keeps the right lane visually aligned with the rest of the fork shell

## Product Goal

Build CodAI as a GUI-first agentic coding IDE on top of VS Code OSS, with a native Ask -> Edit -> Review flow instead of a sidebar-only assistant.

## Primary Integration Strategy

Start with native workbench contributions and existing pane systems before deeper shell surgery.

1. Reuse native view containers and pane composites for the first milestone.
2. Reuse the built-in chat architecture where it helps, but swap product framing to CodAI.
3. Reuse SCM/comments patterns for review and change visibility.
4. Delay deep titlebar/editor layout patches until the shared runtime is visible in the workbench.

## Native Workbench Patch Points

### Bootstrap and contribution entry

- `C:\Users\ireal\OneDrive\Desktop\CodAI\codai-vscode-oss\src\vs\workbench\workbench.common.main.ts`
  - This is the main contribution fan-out for workbench features.
  - CodAI fork-specific contributions should be imported here once they become native workbench modules.

### View registration and container placement

- `C:\Users\ireal\OneDrive\Desktop\CodAI\codai-vscode-oss\src\vs\workbench\services\views\browser\viewDescriptorService.ts`
  - Central service for custom view locations and generated containers.
  - Use this when CodAI views need to move between Sidebar, Panel, and Auxiliary Bar while preserving user layout.

### Global left rail

- `C:\Users\ireal\OneDrive\Desktop\CodAI\codai-vscode-oss\src\vs\workbench\browser\parts\activitybar\activitybarPart.ts`
  - Controls activity bar density, action height, icon sizing, and composite pinning.
  - This is the first file to patch for a Dvina/Cursor-like global rail feel.

### Left sidebar / thread and workspace surfaces

- `C:\Users\ireal\OneDrive\Desktop\CodAI\codai-vscode-oss\src\vs\workbench\browser\parts\sidebar\sidebarPart.ts`
  - Main left workbench sidebar container.
  - Recommended host for CodAI thread history and workspace-aware agent context in the first milestone.

### Bottom panel / terminal and trace

- `C:\Users\ireal\OneDrive\Desktop\CodAI\codai-vscode-oss\src\vs\workbench\browser\parts\panel\panelPart.ts`
  - Bottom panel system.
  - Best first host for terminal-heavy runtime output and raw trace streams without displacing the editor.

### Right review lane

- `C:\Users\ireal\OneDrive\Desktop\CodAI\codai-vscode-oss\src\vs\workbench\browser\parts\auxiliarybar\auxiliaryBarPart.ts`
  - Native right-side pane system.
  - Best first host for Review / Changes / Trace tabs in a GUI-first CodAI workbench.

## Reusable Feature References

### Chat baseline

- `C:\Users\ireal\OneDrive\Desktop\CodAI\codai-vscode-oss\src\vs\workbench\contrib\chat\browser\chat.contribution.ts`
  - Existing chat registration, services, actions, and widget plumbing.
  - Best reference for native composer, timeline rendering, chat sessions, and agent/tool actions.

### Source control and change presentation

- `C:\Users\ireal\OneDrive\Desktop\CodAI\codai-vscode-oss\src\vs\workbench\contrib\scm\browser\scm.contribution.ts`
  - Reference for a first-class workbench view container with changes and history.
  - Good model for CodAI `Changes` and checkpoint-aware review containers.

- `C:\Users\ireal\OneDrive\Desktop\CodAI\codai-vscode-oss\src\vs\workbench\contrib\scm\browser\scmHistoryViewPane.ts`
  - Good reference for review/history style panes.

### Review and threaded feedback

- `C:\Users\ireal\OneDrive\Desktop\CodAI\codai-vscode-oss\src\vs\workbench\contrib\comments\browser\comments.contribution.ts`
  - Reference for review-style badge/activity and right-panel behavior.
  - Useful for checkpoint comments, review findings, and file-linked agent feedback.

## First GUI-First Milestone Mapping

### Sidebar

- CodAI Threads
- CodAI Workspace Context

### Center/editor

- Native editor stays as-is initially
- CodAI context and review actions appear through commands, toolbar actions, and editor-linked overlays later

### Right auxiliary bar

- CodAI Review
- CodAI Changes
- CodAI Trace

### Bottom panel

- Terminal output
- Runtime event stream
- Raw tool diagnostics when needed

## Recommended Sequence

1. Add CodAI-native view containers and panes using existing workbench contribution patterns.
2. Bridge shared runtime events into those panes.
3. Reuse chat contribution internals for the native composer/timeline surface.
4. Patch activity bar, auxiliary bar, and title/status surfaces for a more opinionated CodAI GUI.
5. Only then consider deeper editor chrome or layout surgery.

## Risks

- Patching too early at the shell/layout layer will slow upstream sync.
- Rebuilding chat or SCM concepts from scratch would duplicate proven workbench systems.
- Mixing trace, review, and terminal output in one pane too early will recreate the cramped extension UX we are explicitly leaving behind.
