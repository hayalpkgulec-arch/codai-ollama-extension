# CodAI — AI Coding Assistant

An agentic AI coding assistant for VS Code and VSCodium. Supports Ollama, Google Gemini, OpenRouter, Groq, Cerebras, Mistral, Puter and any OpenAI-compatible provider.

## Features

- **Agentic task execution** — reads files, writes code, runs terminal commands, searches the web
- **Multi-provider support** — Ollama (local), Gemini, Groq, OpenRouter, Cerebras, Mistral, Puter, Custom
- **Multi-key rotation** — add multiple API keys per provider; auto-rotates on rate limit with no waiting
- **Plan mode** — structured task planning before execution
- **Auto-updater** — checks GitHub Releases every 30 minutes; notifies and installs updates automatically
- **Context injection** — mention files with `@filename` or use `/` commands

## Getting Started

1. Install the extension from VSIX
2. Open the CodAI sidebar (sparkle icon in activity bar)
3. Click the settings icon → select a provider → enter your API key → Apply
4. Start chatting

## Providers

| Provider | Notes |
|---|---|
| Ollama | Local models, no API key needed |
| Google Gemini | Free tier: 1.5M tokens/day |
| Groq | Very fast inference, free tier |
| OpenRouter | Access to many models, free tier available |
| Cerebras | 2100 TPS, free tier |
| Mistral | Codestral for coding tasks |
| Puter | Use a Puter auth token to access Claude models through the OpenAI-compatible endpoint |
| Custom | Any OpenAI-compatible endpoint |

## Puter + Claude

1. Open the CodAI settings panel
2. Select `Puter`
3. Paste your Puter auth token
4. Click `Apply`
5. Pick a Claude model such as `claude-sonnet-4-6`

Reference guide: [Use Cline with Puter](https://developer.puter.com/tutorials/use-cline-with-puter/)

## Multi-Key Rotation

To avoid rate limits, add multiple API keys for the same provider:

1. Settings → select provider → enter first key in **API KEY** field
2. Click **Add key** to add more keys
3. Click **Apply**

When a rate limit is hit, CodAI automatically switches to the next available key — no waiting.

## Auto-Updater

CodAI checks for updates from GitHub Releases every 30 minutes. When a new version is available:
- A status bar badge appears: `↑ CodAI x.x.x`
- A notification popup offers **Update Now**
- The update is downloaded, installed, and a reload is requested

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for full history.

## Development Backlog

Current roadmap is split between the agent/runtime backlog and the new VS Code OSS fork track:

- [agentic requirements](.codai/plans/agentic-coding-backlog-20260313/requirements.md)
- [agentic design](.codai/plans/agentic-coding-backlog-20260313/design.md)
- [agentic tasks](.codai/plans/agentic-coding-backlog-20260313/tasks.md)
- [fork requirements](.codai/plans/vscode-fork-20260313/requirements.md)
- [fork design](.codai/plans/vscode-fork-20260313/design.md)
- [fork tasks](.codai/plans/vscode-fork-20260313/tasks.md)
- [fork patch map](.codai/plans/vscode-fork-20260313/patch-map.md)

To bootstrap the upstream VS Code OSS base for the desktop fork:

```powershell
npm run ide:fork:bootstrap
```

The fork now lives in a sibling folder outside this repository by default: `..\codai-vscode-oss`.
That avoids TypeScript ambient type collisions between the main extension repo and the VS Code OSS source tree.

To launch the local fork with the expected Node 22 + Visual Studio environment:

```powershell
npm run ide:fork:start
```
