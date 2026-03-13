# Design

## Approach

Store the roadmap as a Kiro-style plan under `.codai/plans` so the backlog sits next to the codebase and can be expanded by future plan-mode work. Keep the structure milestone-first, but make each milestone explicit about which subsystem it touches:

- runtime/tooling
- web/browser
- webview state/UI
- persistence/recovery
- testing/hardening

## Sequencing

1. `0.0.50`: harden web tools and make `web_search` first-class in the UI
2. `0.0.51`: add local-first browser session and browser tools
3. `0.0.52`: split the webview into shared stores and grouped runtime rendering
4. `0.0.53`: add goal control, drift detection, and read-only external tool binding
5. `0.0.54`: run a hardening sprint across providers, restore flows, checkpoints, and update delivery

## Constraints

- Keep `postMessage` as the bridge for now
- Keep all traces local-only
- Keep session/provider/checkpoint compatibility through migration code
- Do not let `TaskController` become the runtime monolith again

## Done Criteria

- `npm run compile` passes
- `npm test` passes
- VSIX packaging passes
- smoke coverage is added where the milestone changes user-facing runtime behavior
- release notes clearly map to the milestone checklist

## Progress Notes

- 2026-03-13: `v0.0.50` backend work is in place. `web_fetch` now emits citation-ready metadata, robots/noindex signals, redirect chains, cache policy, trust warnings, and per-host throttling details. `web_search` now collapses repeated URLs and over-concentrated domains before results are serialized back into the runtime.
- 2026-03-13: `v0.0.50` UI and test coverage is also in place. The chat renders dedicated `web_search` result cards, the `web_fetch` card surfaces provenance/trust details, and fixture-backed tests now cover malformed HTML, empty shell pages, redirect chains, binary payloads, and timeout failures.
- 2026-03-13: `v0.0.51` is in place. Browser automation now lives in a dedicated local-first `BrowserSessionService`, browser actions are exposed as first-party tools, artifacts are stored under workspace storage, and the trace drawer/runtime snapshots can inspect browser session state without re-expanding `TaskController`.
- 2026-03-13: `v0.0.52` is in place. The webview now routes state through dedicated extension/runtime stores, provider/model fetch state is reducer-backed instead of App-local, assistant timelines are grouped into runtime rows, and the debug/context drawers expose prompt-layer and recovery-oriented summaries instead of raw state blobs.
- 2026-03-13: `v0.0.53` is in place. Goal tracking now lives in a dedicated `GoalControlService`, runtime/tool policy now emits approval previews and retry profiles, the trace drawer can inspect goal drift and recovery hints, and external read-only tool aliases can be registered from `.codai/external-tools.json` without turning `TaskController` back into the orchestrator.
- 2026-03-13: The first `v0.0.54` hardening fixes are in place. Workspace persistence now queues per-file writes and uses unique temp files to avoid Windows rename races, the provider settings panel auto-fetches models from live draft credentials/base URLs instead of only persisted state, and the Ollama path now polls for real model availability so local startup state is reflected in the UI.
