# Tasks

## v0.0.50 Web Tools Hardening

- [x] Add citation-ready source metadata to `web_fetch`
- [x] Add `robots` and `noindex` awareness to `web_fetch`
- [x] Add redirect policy, cache policy, and domain throttling guardrails
- [x] Render structured `web_search` results as dedicated chat cards instead of generic tool text
- [x] Collapse duplicate domains and repeated result URLs before they reach the model
- [x] Add fixtures for bad HTML, redirect chains, empty pages, timeouts, and binary responses

## v0.0.51 Browser Session

- [x] Add a local-first `BrowserSession` service
- [x] Add browser tools: `navigate`, `click`, `type`, `scroll`, `wait_for_text`, `screenshot`, `console_logs`, `close`
- [x] Persist browser artifacts under workspace storage
- [x] Attach browser session state to runtime trace payloads
- [x] Add smoke coverage for browser crash recovery and session cleanup

## v0.0.52 UI And State Refactor

- [x] Replace the `useVSCodeMessage` monolith with `ExtensionStore` and `ChatRuntimeStore`
- [x] Move provider, model, auth, and fetch state into a shared reducer
- [x] Switch chat rendering to event-grouped runtime rows for tools, browser actions, checkpoints, and command output
- [x] Expand the trace drawer with runtime warnings, blocked reasons, recovery hints, and latest artifacts
- [x] Add a context inspector that shows prompt layers and token budget usage

## v0.0.53 Goal Control And Extensibility

- [x] Add `GoalControlService` with active goal, checkpoints, progress, and drift warnings
- [x] Detect repeated host, tool, and failure loops and emit recovery hints
- [x] Add a read-only external tool registry with workspace boundary labeling
- [x] Add approval preview payloads for high-risk tools
- [x] Add retry policy definitions per tool family

## v0.0.54 Hardening Sprint

- [ ] Add provider contract fixtures for Mistral, Gemini, OpenRouter, Ollama, and custom OpenAI-compatible endpoints
- [x] Add session export, import, pin, archive, and search flows
- [ ] Add resume-after-restart smoke tests for long-running tool loops
- [ ] Add grouped checkpoint rollback and "restore all files from turn"
- [ ] Audit updater and release delivery reliability end-to-end

## v0.0.56 IDE-First Bootstrap

- [x] Add explicit shell execution envelopes for Windows command parity
- [x] Include shell metadata in `run_command` results for traceability
- [x] Stop provider settings auto-fetch from looping on its own timestamp state
- [x] Gate background Ollama polling so it stops after models load
- [x] Add `packages/core` host/runtime contract scaffold
- [x] Add `apps/desktop` Electron + Monaco workbench scaffold
- [ ] Move live runtime services behind the shared core package
- [ ] Replace the desktop mock timeline with the real shared runtime

## Cross-Cutting Guardrails

- [ ] Keep all new persistence schema changes backward-compatible
- [ ] Keep all runtime and tool traces local-only
- [ ] Require compile, test, and package gates before every release
- [ ] Keep `TaskController` as a thin facade and push new loop logic into runtime modules

## Progress Log

- 2026-03-13: Completed the backend half of `v0.0.50` by hardening `web_fetch` with citation, redirect, robots, trust, cache, and throttling metadata, and by collapsing duplicate/over-concentrated `web_search` results before they reach the model.
- 2026-03-13: Completed the UI and test half of `v0.0.50` by adding dedicated `web_search` cards, richer `web_fetch` cards, and fixture-backed coverage for malformed pages, redirects, empty shells, timeouts, and binary responses.
- 2026-03-13: Completed `v0.0.51` by adding a local-first browser session service, first-party browser tools, workspace-backed screenshot and console artifacts, runtime/browser trace state, and crash-recovery tests for browser cleanup flows.
- 2026-03-13: Completed `v0.0.52` by splitting webview state into `ExtensionStore` and `ChatRuntimeStore`, moving provider/model fetch state into shared reducers, grouping runtime rows in chat, and expanding the trace/context drawers with richer runtime inspection details.
- 2026-03-13: Completed `v0.0.53` by wiring a real `GoalControlService` into the runtime loop, persisting goal snapshots with sessions, emitting recovery/drift warnings into the trace UI, adding approval previews plus retry policies for risky tools, and supporting workspace-bound read-only external tool aliases through `.codai/external-tools.json`.
- 2026-03-13: Started the `v0.0.54` hardening slice by fixing concurrent workspace-state writes in `WorkspaceStorage`, making provider model fetching debounce live drafts instead of only saved settings, and polling Ollama model availability so the local provider reflects startup changes without manual refresh loops.
- 2026-03-13: Completed the session-management hardening slice under `v0.0.54` by adding import/export bundles, pin/archive metadata, archived-aware search/grouping, and regression coverage for session ordering plus round-trip transfer behavior.
- 2026-03-13: Started the IDE-first bootstrap slice by normalizing Windows shell execution into explicit envelopes, surfacing that metadata through `run_command`, stopping provider auto-fetch loops from re-triggering on internal timestamps, and scaffolding both `packages/core` and `apps/desktop` so the standalone IDE track has a real codebase to build on.
