# Tasks

## v0.0.50 Web Tools Hardening

- [x] Add citation-ready source metadata to `web_fetch`
- [x] Add `robots` and `noindex` awareness to `web_fetch`
- [x] Add redirect policy, cache policy, and domain throttling guardrails
- [x] Render structured `web_search` results as dedicated chat cards instead of generic tool text
- [x] Collapse duplicate domains and repeated result URLs before they reach the model
- [x] Add fixtures for bad HTML, redirect chains, empty pages, timeouts, and binary responses

## v0.0.51 Browser Session

- [ ] Add a local-first `BrowserSession` service
- [ ] Add browser tools: `navigate`, `click`, `type`, `scroll`, `wait_for_text`, `screenshot`, `console_logs`, `close`
- [ ] Persist browser artifacts under workspace storage
- [ ] Attach browser session state to runtime trace payloads
- [ ] Add smoke coverage for browser crash recovery and session cleanup

## v0.0.52 UI And State Refactor

- [ ] Replace the `useVSCodeMessage` monolith with `ExtensionStore` and `ChatRuntimeStore`
- [ ] Move provider, model, auth, and fetch state into a shared reducer
- [ ] Switch chat rendering to event-grouped runtime rows for tools, browser actions, checkpoints, and command output
- [ ] Expand the trace drawer with runtime warnings, blocked reasons, recovery hints, and latest artifacts
- [ ] Add a context inspector that shows prompt layers and token budget usage

## v0.0.53 Goal Control And Extensibility

- [ ] Add `GoalControlService` with active goal, checkpoints, progress, and drift warnings
- [ ] Detect repeated host, tool, and failure loops and emit recovery hints
- [ ] Add a read-only external tool registry with workspace boundary labeling
- [ ] Add approval preview payloads for high-risk tools
- [ ] Add retry policy definitions per tool family

## v0.0.54 Hardening Sprint

- [ ] Add provider contract fixtures for Mistral, Gemini, OpenRouter, Ollama, and custom OpenAI-compatible endpoints
- [ ] Add session export, import, pin, archive, and search flows
- [ ] Add resume-after-restart smoke tests for long-running tool loops
- [ ] Add grouped checkpoint rollback and "restore all files from turn"
- [ ] Audit updater and release delivery reliability end-to-end

## Cross-Cutting Guardrails

- [ ] Keep all new persistence schema changes backward-compatible
- [ ] Keep all runtime and tool traces local-only
- [ ] Require compile, test, and package gates before every release
- [ ] Keep `TaskController` as a thin facade and push new loop logic into runtime modules

## Progress Log

- 2026-03-13: Completed the backend half of `v0.0.50` by hardening `web_fetch` with citation, redirect, robots, trust, cache, and throttling metadata, and by collapsing duplicate/over-concentrated `web_search` results before they reach the model.
- 2026-03-13: Completed the UI and test half of `v0.0.50` by adding dedicated `web_search` cards, richer `web_fetch` cards, and fixture-backed coverage for malformed pages, redirects, empty shells, timeouts, and binary responses.
