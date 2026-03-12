# Changelog

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
