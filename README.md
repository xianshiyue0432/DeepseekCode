# DeepSeek TUI Desktop

Desktop harness for the DeepSeek TUI coding agent. The app follows a Codex-style layout: a left conversation sidebar, a right conversation surface, and hidden-on-demand drawers for Skills, MCP, workspace, and runtime settings.

## Why Electron First

The current machine has Node/npm ready, while Rust/Cargo is not installed. Electron also lets the app embed a PTY and bundle the npm `deepseek-tui` wrapper, which downloads upstream platform binaries during install. Tauri can stay on the roadmap once a Rust build chain and deeper native integration are available.

## Run Locally

```bash
npm install
npm run dev
```

The `deepseek-tui` dependency downloads the `deepseek` binary into `node_modules/deepseek-tui/bin/downloads/`. The app defaults to that bundled runtime, but can also use a system or custom binary.

## DeepSeek Model URLs

The desktop UI exposes four model choices, but the official DeepSeek API model IDs are only `deepseek-v4-pro` and `deepseek-v4-flash`. The `1M` choices use the same API model ID because DeepSeek's official model table lists 1M context as the supported context length for both V4 models.

| UI choice | API model sent to DeepSeek | Official documentation |
| --- | --- | --- |
| DeepSeek v4 Pro | `deepseek-v4-pro` | https://api-docs.deepseek.com/news/news260424#deepseek-v4-pro |
| DeepSeek v4 Pro 1M | `deepseek-v4-pro` | https://api-docs.deepseek.com/quick_start/pricing/#model-details |
| DeepSeek v4 Flash | `deepseek-v4-flash` | https://api-docs.deepseek.com/news/news260424#deepseek-v4-flash |
| DeepSeek v4 Flash 1M | `deepseek-v4-flash` | https://api-docs.deepseek.com/quick_start/pricing/#model-details |

## Build A Mac DMG

```bash
npm run dist:mac
```

Output is written to `release/`. macOS builds are debug-signed automatically: if a real signing identity is available, electron-builder can pass it through; otherwise the project falls back to a local ad-hoc signature (`codesign -s -`) for development and smoke testing. This is not a notarized production signature.

To force a specific local identity:

```bash
DEEPSEEK_TUI_MAC_SIGN_IDENTITY="Developer ID Application: Example (TEAMID)" npm run dist:mac
```

To verify the debug-signed app directory:

```bash
codesign --verify --deep --strict --verbose=2 "release/mac-arm64/DeepSeek TUI Desktop.app"
```

## Build A Windows Test Installer

```bash
npm run dist:win:test
```

This creates or reuses a local self-signed test certificate at `build/certs/deepseek-tui-desktop-local-test.pfx`, prefetches the upstream Windows x64 `deepseek.exe` and `deepseek-tui.exe`, builds the renderer, and creates a signed NSIS installer:

```text
release/DeepSeek TUI Desktop-0.1.0-win-x64-setup.exe
```

The certificate is intentionally not trusted and is ignored by git. Testers should expect Windows SmartScreen / unknown publisher warnings unless they import the matching local test certificate or you replace it with a real code-signing certificate later.

Useful lower-level commands:

```bash
npm run cert:win:self-signed
npm run prepare:win-runtime
npm run dist:win
```

To override the local-test PFX password:

```bash
DEEPSEEK_TUI_WIN_CERT_PASSWORD="your-local-password" npm run dist:win:test
```

## Harness Scope

- Native Electron app window with a Codex-like conversation UI.
- Left history sidebar groups saved conversations by project/workspace name, with sessions nested under each project.
- Main-process harness in `electron/harness.cjs` for runtime resolution, workspace normalization, env policy, launch plans, and session lifecycle.
- xterm.js terminal backed by `node-pty`, so the upstream TUI keeps keyboard control, colors, resizing, and prompts.
- Workspace picker mapped to `deepseek --workspace <path>`.
- One-click workspace handoff to Cursor or VS Code from the desktop UI. On macOS it opens the installed app directly; on other platforms it uses the `cursor` / `code` command if available.
- Runtime picker for bundled, PATH, or custom `deepseek`.
- Top-level UI switch for `对话`, `工具`, `定时任务`, and `终端`, so MCP/Skills and scheduled tasks have separate surfaces without crowding the chat view.
- Quick actions for TUI, resume, doctor, setup, MCP init, one-shot Agent/Plan prompts, and upstream YOLO launch.
- Environment wiring for `DEEPSEEK_API_KEY`, `DEEPSEEK_MODEL`, `DEEPSEEK_BASE_URL`, `DEEPSEEK_PROVIDER`, `DEEPSEEK_MCP_CONFIG`, `DEEPSEEK_SKILLS_DIR`, `DEEPSEEK_ALLOW_SHELL`, and `DEEPSEEK_MAX_SUBAGENTS`.
- DeepSeek V4 Pro / V4 Flash presets default to `https://api.deepseek.com`, so users only need to paste their API key for the common DeepSeek setup. NVIDIA NIM mode defaults to `https://integrate.api.nvidia.com/v1`.
- Skills drawer: preset Skills remain available, and users can create new `SKILL.md` workflows or import external Skill directories such as a full Superpowers skill pack.
- Scheduled Tasks screen: create a simple daily Agent task with only the prompt, workspace, run time, and enable toggle exposed. The desktop app maintains the local runner and logs while keeping API keys in its local secret store instead of writing secrets into schedule files.
- Preset MCP servers: Playwright, Context7, Filesystem, MCP Remote, GitHub, Postgres, Sequential Thinking, Memory, Slack, Notion, Sentry, Figma Developer, Stripe, Puppeteer, Brave Search, Google Maps, and Panel / 1Panel. Enabled presets are written to an MCP JSON file under Electron `userData` and injected by the harness.
- MCP tool page includes startup instructions, command preview, auth/env hints, category filters, weekly npm download badges, safety labels, and an add-only custom MCP form. MCP service secrets are read from environment variables; DeepSeek/NVIDIA API keys are stored in the desktop app's local secret store for launches and scheduled tasks.
- Optional token-protected mobile bridge for viewing desktop task progress from a phone app, subscribing to live events, and remotely controlling the running desktop session.
- Optional update push notification endpoint that can be called by an updater service or release workflow to notify the desktop UI and connected mobile clients.

## Mobile Bridge API

Enable the bridge from the `远程` inspector. It is disabled by default, requires a generated token for every request, and separates read-only progress viewing from remote control.

Main endpoints:

- `GET /api/v1/status` returns the desktop session, bridge, and last update notice state.
- `POST /api/v1/auth/login` signs the desktop bridge into a push account.
- `POST /api/v1/auth/pairing/start` generates a short phone pairing code for the signed-in account.
- `POST /api/v1/auth/pair` lets the phone app exchange account id + pairing code for a device token.
- `GET /api/v1/events` opens an SSE stream for terminal output, session status, exit events, and update notices.
- `POST /api/v1/session/start` starts a desktop run from the phone app when remote control is enabled.
- `POST /api/v1/terminal/input` writes terminal input to the current desktop PTY when remote control is enabled.
- `POST /api/v1/skills/upsert` writes a generated Skill from a paired phone or voice client when remote control is enabled.
- `POST /api/v1/session/stop` stops the current desktop PTY when remote control is enabled.
- `POST /api/v1/updates/push` publishes an update notification to the desktop and connected mobile clients when update pushes are enabled.

Desktop admin calls use `Authorization: Bearer <bridge-token>` or `x-deepseek-bridge-token: <bridge-token>`. Paired phone calls use the returned device token in `Authorization: Bearer <device-token>` or `x-deepseek-device-token: <device-token>`. The detailed contract is in [`docs/mobile-remote-api.md`](docs/mobile-remote-api.md).

## Roadmap

1. Store API credentials in macOS Keychain / Windows Credential Manager instead of session-only env fields.
2. Add per-MCP credential forms and connection tests for token-based presets.
3. Optionally reconcile local desktop history with upstream `deepseek sessions --json` if upstream exposes stable structured output.
4. Replace local Windows test signing with a real trusted certificate before public release.
5. Add a cloud relay / APNs-FCM layer for phone access outside the same LAN.
6. Split the harness into a standalone local service once the upstream runtime exposes a stable structured API.
