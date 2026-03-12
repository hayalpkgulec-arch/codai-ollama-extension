# Changelog

## [0.0.48] - 2026-03-13
### Added
- Tool manifests and per-turn tool control now track risk, repetition, blocked calls, browsing focus, and recommended next actions across the agent loop
- Structured `web_fetch` responses now capture status code, content type, title, excerpt, extracted links, cache usage, and local control warnings
- New contract tests cover tool-control loop prevention and structured web-fetch parsing

### Changed
- The task loop now attaches manifest and control state metadata to tool events, so the Trace drawer can show what the agent is doing and why it was blocked
- The chat UI now renders richer web-fetch cards with source metadata, excerpts, quick-open links, and control alerts instead of a single generic pill

---

## [0.0.47] - 2026-03-12
### Added
- Shared provider capability registry, provider preflight validation, and transport adapters now form a single provider contract layer across the extension and webview
- Local turn tracing and deterministic turn-state persistence now write redacted JSONL traces under extension storage, with new Context and Trace drawers in the chat UI
- File-backed workspace storage, lightweight workspace indexing, retrieval-backed context compaction, and transcript-aware session restore now keep long chats resumable without dropping raw history
- Contract tests now cover provider payload normalization, provider preflight validation, and context compaction behavior

### Changed
- Loading a saved chat now restores agent context, mode, model, and transcript state instead of only repainting UI bubbles
- The chat header and runtime surface now expose preflight warnings, recovered-turn notices, context budget details, and trace access directly in the webview

---

## [0.0.46] - 2026-03-12
### Fixed
- Model selection is now scoped to the active provider instead of showing a mixed global list, so Mistral no longer receives OpenRouter or Ollama model IDs by accident
- Applying a provider now sends the provider change and selected model together, and the chat UI auto-falls back to the first valid model for that provider when the current one is invalid

---

## [0.0.45] - 2026-03-12
### Fixed
- Duplicate tool call IDs inside the same assistant message are now uniquified before tool execution and before provider requests are sent
- Older chat history containing duplicate tool call IDs is remapped on the provider-request path so strict providers like Mistral no longer reject it with `invalid_request_message_order`

---

## [0.0.44] - 2026-03-12
### Fixed
- OpenAI-compatible provider requests now normalize assistant tool calls, tool call IDs, and message content before sending history back to Mistral, OpenRouter, Gemini, and similar providers
- Persisted chat history is sanitized on reload so stale `tool_calls` payloads from older sessions no longer leak unsupported fields back into provider requests
- The extra three-dot waiting indicator above `Generating...` was removed

### Changed
- Chat context now keeps a full local transcript while compacting the active model context window when it grows too large
- The header now shows context usage with an auto-compaction hover summary, and the chat stream shows a temporary `Automatically compacting context` notice when compaction runs

---

## [0.0.43] - 2026-03-12
### Fixed
- The inline `working` badge was removed from the composer so it no longer collides with the send or stop control

### Changed
- The processing state is back under the chat stream as a simple shimmer status line instead of living inside the input footer
- Thinking blocks now use a cleaner disclosure card layout with a compact timing row, bold title, and softer body copy

---

## [0.0.42] - 2026-03-12
### Fixed
- Provider settings now persist separate API keys, extra rotation keys, and base URLs for each provider instead of only remembering the active one
- Saved provider credentials now restore into the settings UI after restarting VSCodium

### Changed
- Chat composer background fill was removed for a simpler footer look

---

## [0.0.41] - 2026-03-12
### Fixed
- Chat composer shadow was toned down so the footer no longer looks detached from the panel
- Mode and model dropdowns now stay above the composer instead of getting clipped under the input area

### Changed
- Composer buttons and selector pills were tightened up for a smaller, cleaner bottom control strip

---

## [0.0.40] - 2026-03-12
### Changed
- Chat composer refreshed with a larger rounded shell and cleaner bottom action strip inspired by the new reference layout
- Send control now uses a compact circular arrow treatment and the input footer controls sit inside the same composer card

---

## [0.0.39] - 2026-03-12
### Fixed
- Auto-update now re-checks when the VS Code window regains focus, so newly published releases do not get missed as easily in long-running sessions
- The install-update command now always points at the latest pending release instead of keeping the first captured download URL

---

## [0.0.38] - 2026-03-12
### Fixed
- Provider settings no longer re-fetch models continuously when the selected model or saved provider state changes
- Applying provider settings no longer triggers a duplicate model refresh that can keep the loader spinning

---

## [0.0.37] - 2026-03-12
### Fixed
- Provider model fetching now uses the currently selected provider config instead of stale saved state
- Provider settings now ignore stale model-fetch responses so the loading state does not get stuck
- Refreshing models no longer depends on changing provider state first

---

## [0.0.36] - 2026-03-12
### Added
- Slash command menu now loads custom prompts from `.codai/commands`
- Write tool cards can restore the last saved checkpoint directly from chat

### Changed
- Checkpoint restore actions moved out of settings and into the relevant tool result cards
- Slash commands now support prompt arguments and show the source file in the menu

---

## [0.0.34] - 2026-03-12
### Added
- Puter provider preset wired to the official OpenAI-compatible endpoint
- Claude model presets for Puter, including `claude-sonnet-4-6`
- Provider settings support for Puter auth tokens with a direct guide link

### Changed
- Provider apply flow now keeps model selection aligned when switching providers
- Cloud providers restored from state now render with the correct cloud/local model tag

### Fixed
- Base URLs are normalized before API calls so trailing slashes do not break provider requests
- Provider state updates in the webview now carry `hasApiKey` and `baseUrl` reliably

---

## [0.0.7] - 2026-03-07
### Test
- Auto-updater test: v0.0.6 → v0.0.7

---

## [0.0.6] - 2026-03-07
### Fixed
- Auto-updater now works on VSCodium (`process.execPath` used instead of hardcoded `code` CLI)
- Fallback CLI candidates: `codium`, `code`, `codium.cmd`, `code.cmd`

### Added
- README with feature overview, provider table and usage guide
- CHANGELOG

---

## [0.0.5] - 2026-03-07
### Added
- Auto-updater test release

---

## [0.0.4] - 2026-03-07
### Added
- **Auto-updater**: checks GitHub Releases every 30 minutes, downloads and installs new versions automatically
- **Multi-key rotation**: add multiple API keys per provider; on rate limit, instantly rotates to the next key — no waiting
- Exponential backoff for rate limits: 15s → 30s → 60s → 120s (used only when all keys are exhausted)
- Provider Settings: model list auto-fetched from API on open; static list used only as fallback

### Fixed
- `Cannot read properties of undefined (reading 'signal')` crash in `fetchModels`
- Gemini model IDs updated to current API-supported names

---

## [0.0.3] - 2026-03-06
### Added
- `read_multiple_files` tool: read N files in a single LLM turn
- `list_directory_tree` tool: recursive directory listing in a single turn
- System prompt: batch/parallel tool call instructions to reduce API round-trips
- Rate limit retry with exponential backoff

---

## [0.0.2] - 2026-03-05
### Added
- Multi-provider support: Ollama, Google Gemini, OpenRouter, Groq, Cerebras, Mistral, Custom
- Provider Settings UI with model picker and API key management
- Plan mode with task list panel
- Streaming responses with thinking block support
- Tool execution: `read_file`, `write_file`, `list_files`, `run_command`, `grep_code`, `web_fetch`

---

## [0.0.1] - 2026-03-04
### Added
- Initial release: Ollama-based chat assistant in VS Code sidebar
