# Research Notes

Verified on 2026-05-07.

## DeepSeek TUI Surface

- Public upstream: https://github.com/Hmbown/DeepSeek-TUI
- npm package: `deepseek-tui@0.8.16`
- Local bundled binary after install on macOS: `node_modules/deepseek-tui/bin/downloads/deepseek`
- Windows x64 runtime assets: `deepseek-windows-x64.exe` and `deepseek-tui-windows-x64.exe`
- Verified local macOS binary: `deepseek 0.8.16`

The upstream runtime already includes the core agent platform: terminal TUI, multiple modes, file tools, shell execution, task/plan helpers, sub-agents, sessions, skills, MCP, web search, git workflows, and macOS sandbox support. This makes a harness wrapper the right first desktop shape.

## Claude / Codex-Inspired Desktop Shape

The useful desktop pattern is not a second agent loop. It is a local harness boundary:

- Desktop client renders project/session controls.
- Harness owns workspace, permissions/env policy, runtime discovery, and process lifecycle.
- Agent runtime remains isolated in its own executable.
- MCP and skills stay configurable from the harness but execute inside the upstream runtime.

Claude Code's MCP documentation also points toward UI-managed MCP state, dynamic tool updates, OAuth/auth handoffs, and output limits. Those are second-stage desktop features once DeepSeek TUI exposes enough structured status or JSON output to make them reliable.

## Packaging Decision

Electron was chosen for the first DMG because this machine already had Node/npm and the upstream npm package provides prebuilt macOS binaries. Rust/Cargo was not present, so a Tauri-first build would add toolchain work before proving the desktop integration.

The app is packaged as a debug-signed macOS arm64 DMG for local testing:

```bash
npm run dist:mac
```

The app can also be packaged as a Windows x64 NSIS installer with a local self-signed test certificate:

```bash
npm run dist:win:test
```

Cross-building Windows from macOS requires an explicit Windows runtime preflight because the upstream npm postinstall downloads binaries for the current host platform. The desktop project now downloads and verifies the Windows x64 DeepSeek TUI assets before invoking Electron Builder. Public distribution still needs Developer ID signing/notarization for macOS, a trusted Windows code-signing certificate, and likely a universal macOS x64/arm64 build.

## Current UI Direction

The desktop UI now follows a Codex-like pattern:

- Left sidebar: brand, `新对话`, conversation list, and compact entries for Skills, MCP, remote, and settings.
- Main surface: conversation messages, composer, a tool dashboard, and a terminal-backed runtime output panel.
- Top-level switch: `对话`, `工具`, and `终端`.
- Skills and MCP do not appear by default. They open as dedicated tool pages when selected.
- Default Skills are `Superpowers` and `UI/UX 设计`.
- The bottom composer should mirror the upstream `Plan / Agent / YOLO` mode names. Plan one-shot prompts use a non-mutating plan-only prefix, while YOLO uses the upstream `--yolo` launch path.

## MCP Preset Research

The MCP preset list was refreshed on 2026-05-07 from Cursor/Claude-facing MCP documentation, package availability, and npm last-week download counts. Cursor's MCP server surface highlights developer-oriented servers such as GitHub, Playwright, and Context7. Claude Desktop documentation recommends UI-managed local MCP installation, and Claude SDK docs show stdio MCP configuration with `npx`, env-based auth, explicit tool permission, filesystem, GitHub, and Postgres examples.

Included npm presets:

| Preset | Package | Latest | Last-week npm downloads |
| --- | --- | ---: | ---: |
| Playwright | `@playwright/mcp` | 0.0.74 | 2,143,014 |
| Context7 | `@upstash/context7-mcp` | 2.2.4 | 1,542,305 |
| Filesystem | `@modelcontextprotocol/server-filesystem` | 2026.1.14 | 357,283 |
| MCP Remote | `mcp-remote` | 0.1.38 | 313,116 |
| GitHub | `@modelcontextprotocol/server-github` | 2025.4.8 | 109,525 |
| Postgres | `@modelcontextprotocol/server-postgres` | 0.6.2 | 96,218 |
| Sequential Thinking | `@modelcontextprotocol/server-sequential-thinking` | 2025.12.18 | 90,477 |
| Memory | `@modelcontextprotocol/server-memory` | 2026.1.26 | 65,339 |
| Slack | `@modelcontextprotocol/server-slack` | 2025.4.25 | 56,071 |
| Notion | `@notionhq/notion-mcp-server` | 2.2.1 | 52,740 |
| Sentry | `@sentry/mcp-server` | 0.33.0 | 50,170 |
| Figma Developer | `figma-developer-mcp` | 0.11.0 | 40,225 |
| Stripe | `@stripe/mcp` | 0.3.3 | 37,775 |
| Puppeteer | `@modelcontextprotocol/server-puppeteer` | 2025.5.12 | 28,205 |
| Brave Search | `@modelcontextprotocol/server-brave-search` | 0.6.2 | 24,872 |
| Google Maps | `@modelcontextprotocol/server-google-maps` | 0.6.2 | 9,335 |

Panel / 1Panel is included as a Go/GitHub preset rather than an npm preset because `@1Panel-dev/mcp-1panel` is not a valid npm package. The verified command model is `go install github.com/1Panel-dev/mcp-1panel@latest` followed by `mcp-1panel` with `PANEL_HOST` and `PANEL_ACCESS_TOKEN`.

Primary references:

- https://docs.cursor.com/en/tools/mcp
- https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop
- https://platform.claude.com/docs/en/agent-sdk/mcp
- https://api.npmjs.org/downloads/point/last-week/@playwright/mcp
- https://api.npmjs.org/downloads/point/last-week/@upstash/context7-mcp
- https://api.npmjs.org/downloads/point/last-week/@modelcontextprotocol/server-filesystem
- https://github.com/1Panel-dev/mcp-1panel
