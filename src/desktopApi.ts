import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

// Check if running in Tauri
const isTauri = "__TAURI__" in window;

// API invoke via embedded tiny_http server (same origin, no ACL issues)
const eventInvoke = (() => {
  return async (command: string, args?: any): Promise<any> => {
    try {
      const response = await fetch("/api/invoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command, args: args || {} })
      });
      const data = await response.json();
      if (data.ok) {
        return data.result;
      }
      throw new Error(data.error || "Invoke failed");
    } catch (error) {
      throw error;
    }
  };
})();

// Base URL for other API endpoints served by the same tiny_http server
const API_BASE = "";

// Preview implementations for browser development
const previewSettings: DesktopSettings = {
  language: "zh",
  workspacePath: "/Users/west/project",
  binaryMode: "bundled",
  customBinaryPath: "",
  provider: "deepseek",
  model: "deepseek-v4-pro",
  baseUrl: "https://api.deepseek.com",
  mcpConfigPath: "",
  skillsDir: "",
  skillsEnabled: true,
  mcpEnabled: false,
  allowShell: false,
  maxSubagents: 10,
  harnessEnabled: false,
  launchAction: "tui",
  rememberWorkspace: true,
  enabledSkills: ["superpowers", "ui-ux-design", "cron-scheduler", "skill-downloader"],
  enabledMcpServers: [],
  mobileBridgeEnabled: false,
  mobileBridgeHost: "127.0.0.1",
  mobileBridgePort: 8765,
  mobileBridgeToken: "browser-preview-token",
  mobileRemoteControlEnabled: false,
  updatePushEnabled: false
};

function previewDeepSeekApiModel(model: string) {
  if (model === "deepseek-v4-flash" || model === "deepseek-v4-flash-1m") {
    return "deepseek-v4-flash";
  }
  if (model === "deepseek-v4-pro" || model === "deepseek-v4-pro-1m") {
    return "deepseek-v4-pro";
  }
  if (model === "deepseek-chat" || model === "deepseek-reasoner") {
    return "deepseek-v4-flash";
  }
  return model || "deepseek-v4-pro";
}

function previewApiModel(provider: ProviderMode, model: string) {
  return provider === "nvidia-nim" ? model : previewDeepSeekApiModel(model);
}

const previewSkillTemplateDefaults: Record<string, string> = {
  superpowers: [
    "# Superpowers",
    "",
    "Use this skill to strengthen planning, task decomposition, code editing, verification, and final reporting.",
    "",
    "- Start by identifying the user's concrete goal and the workspace scope.",
    "- Prefer small, reversible edits that match the existing codebase.",
    "- Verify changes with the narrowest useful command before reporting completion.",
    "- Surface blockers, assumptions, and residual risk clearly."
  ].join("\n"),
  "ui-ux-design": [
    "# UI/UX Design",
    "",
    "Use this skill for product UI work, desktop app polish, and visual interaction checks.",
    "",
    "- Keep primary workflows visible and reduce default configuration clutter.",
    "- Use familiar controls: icon buttons for tools, toggles for binary settings, and compact panels for advanced options.",
    "- Check spacing, overflow, text fit, empty states, disabled states, and responsive constraints.",
    "- Prefer restrained, work-focused surfaces for developer tools."
  ].join("\n"),
  "cron-scheduler": [
    "---",
    "name: cron-scheduler",
    "description: Advanced-only helper for hand-authored crontab files. Normal scheduled tasks are managed by the Scheduled Tasks screen.",
    "---",
    "",
    "# Cron Advanced Scripts",
    "",
    "Use this skill only when the user explicitly asks for a raw cron file or crontab snippet. For normal recurring Agent tasks, use the desktop Scheduled Tasks screen.",
    "",
    "- Treat this as an advanced escape hatch, not the default scheduled-task workflow.",
    "- Generate and validate a cron file before discussing installation.",
    "- Do not run `crontab`, overwrite an existing crontab, or install a task unless the user explicitly asks.",
    "- Prefer outputs under `.deepseek/cron/` and logs under `.deepseek/logs/`.",
    "- Run `node \"$DEEPSEEK_SKILLS_DIR/cron-scheduler/scripts/write-cron-file.mjs\" --name \"daily-health-check\" --schedule \"0 5 * * *\" --command \"npm run health:check\" --cwd \"$PWD\" --timezone \"Asia/Shanghai\"`.",
    "- Report the generated file path, schedule, command, log path, and whether installation was skipped."
  ].join("\n"),
  "skill-downloader": [
    "---",
    "name: skill-downloader",
    "description: Use when the user asks to download, install, import, fetch, or update a Skill from a URL, GitHub raw file, local path, or archive.",
    "---",
    "",
    "# Skill Downloader",
    "",
    "Use this skill when a user asks to download or install a Skill during a desktop Agent conversation.",
    "",
    "- Do not synthesize remote Skill content. Download or copy the source bytes first, then verify the saved file.",
    "- Prefer `curl -fsSL \"<skill-url>\" -o \".deepseek/skills/<skill-id>/SKILL.md\"` for URL sources.",
    "- Verify with `test -s` and inspect the first lines for `name:` and `description:` frontmatter.",
    "- Report the source URL, destination path, and verification result."
  ].join("\n")
};

let previewSkillTemplates: Record<string, string> = { ...previewSkillTemplateDefaults };
let previewMcpConfigPath = "";
let previewMcpConfigText = "";
let previewApiKeys: Record<ProviderMode, string> = {
  deepseek: "",
  "nvidia-nim": ""
};

let previewRuntimeSnapshot: RuntimeSnapshot = {
  status: "idle",
  source: "none",
  sessionId: "",
  mode: "",
  workspacePath: "",
  pid: 0,
  command: "",
  args: [],
  startedAt: "",
  updatedAt: new Date().toISOString(),
  lastExit: null,
  agents: [],
  counts: {
    total: 0,
    running: 0,
    completed: 0,
    failed: 0,
    cancelled: 0
  },
  events: []
};

function previewSkillName(id: string) {
  return id.split("-").filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ") || "Skill";
}

function previewSkillDescription(content: string) {
  const frontmatter = content.match(/^---\n([\s\S]*?)\n---/);
  const description = frontmatter?.[1]?.split(/\n/).find((line) => line.startsWith("description:"));
  if (description) return description.replace("description:", "").trim();
  return "Custom agent workflow skill.";
}

function previewSkillDraft(id: string, root: string, content: string, source: "default" | "file"): SkillTemplateDraft {
  return {
    id,
    name: previewSkillName(id),
    description: previewSkillDescription(content),
    path: `${root}/${id}/SKILL.md`,
    source,
    origin: previewSkillTemplateDefaults[id] ? "preset" : "custom",
    content
  };
}

let previewConversationStore: ConversationStore = {
  activeSessionId: "",
  projects: []
};

let previewAutomations: AutomationTask[] = [
  {
    id: "automation-preview-daily",
    kind: "cron",
    name: "每日项目巡检",
    prompt: "检查当前 workspace 的运行状态、待处理变更和潜在问题，输出简短日报。",
    workspacePath: previewSettings.workspacePath,
    frequency: "daily",
    minute: 0,
    hour: 9,
    weekday: 1,
    customSchedule: "0 9 * * *",
    schedule: "0 9 * * *",
    rrule: "FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai",
    status: "ACTIVE",
    enabled: true,
    installed: true,
    cronPath: "/browser-preview/workspace/.deepseek/cron/daily-project-check.cron",
    logPath: "/browser-preview/workspace/.deepseek/logs/daily-project-check.log",
    commandPreview: "deepseek exec --auto '检查当前 workspace 的运行状态、待处理变更和潜在问题，输出简短日报。'",
    runtimePath: "browser-preview://deepseek",
    runnerPath: "",
    runArgs: [],
    provider: previewSettings.provider,
    model: previewSettings.model,
    baseUrl: previewSettings.baseUrl,
    mcpConfigPath: previewSettings.mcpConfigPath,
    skillsDir: previewSettings.skillsDir,
    enabledSkills: previewSettings.enabledSkills,
    mcpEnabled: previewSettings.mcpEnabled,
    enabledMcpServers: previewSettings.enabledMcpServers,
    allowShell: previewSettings.allowShell,
    maxSubagents: previewSettings.maxSubagents,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastGeneratedAt: new Date().toISOString(),
    lastInstalledAt: ""
  }
];

function previewSchedule(task: Partial<AutomationTask>) {
  const minute = Number(task.minute ?? 0);
  const hour = Number(task.hour ?? 9);
  return `${minute} ${hour} * * *`;
}

function previewRuntime(settings: Partial<DesktopSettings> = {}): RuntimeCheck {
  return {
    selected: "browser-preview://deepseek",
    selectedExists: true,
    bundled: "browser-preview://deepseek",
    bundledExists: true,
    system: "",
    systemExists: false,
    custom: settings.customBinaryPath || "",
    customExists: false,
    version: "Browser preview"
  };
}

function previewGitStatus(workspacePath: string): GitStatus {
  return {
    ok: true,
    workspacePath: workspacePath || previewSettings.workspacePath,
    repoRoot: workspacePath || previewSettings.workspacePath,
    isRepo: true,
    branch: "main",
    upstream: "origin/main",
    ahead: 0,
    behind: 0,
    hasChanges: true,
    staged: 0,
    unstaged: 1,
    untracked: 1,
    remotes: [
      {
        name: "origin",
        fetchUrl: "https://github.com/example/deepseek-tui-desktop.git",
        pushUrl: "https://github.com/example/deepseek-tui-desktop.git"
      }
    ],
    originUrl: "https://github.com/example/deepseek-tui-desktop.git",
    lastCommit: {
      hash: "abc1234",
      subject: "Preview commit",
      author: "DeepSeek TUI",
      date: "just now"
    },
    changes: [
      { status: " M", path: "src/App.tsx", staged: false, unstaged: true, untracked: false },
      { status: "??", path: "docs/git-notes.md", staged: false, unstaged: false, untracked: true }
    ]
  };
}

function previewMcpConfig(settings: DesktopSettings) {
  const servers = Object.fromEntries((settings.enabledMcpServers || []).map((id) => [
    id,
    {
      command: "npx",
      args: ["-y", id],
      env: {},
      disabled: false,
      enabled: true
    }
  ]));

  return {
    timeouts: {
      connect_timeout: 10,
      execute_timeout: 60,
      read_timeout: 120
    },
    servers
  };
}

function previewMcpTests(settings: DesktopSettings): McpServerTest[] {
  if (settings.mcpConfigPath && previewMcpConfigText) {
    try {
      const parsed = JSON.parse(previewMcpConfigText);
      const servers = parsed?.servers && typeof parsed.servers === "object" ? parsed.servers : {};
      return Object.entries(servers)
        .filter(([, server]) => (server as { disabled?: boolean; enabled?: boolean })?.disabled !== true && (server as { enabled?: boolean })?.enabled !== false)
        .map(([id, raw]) => {
          const server = raw as { command?: string; args?: unknown[]; env?: Record<string, string>; url?: string };
          const missingEnv = Object.entries(server.env || {})
            .filter(([, value]) => !String(value || "").trim())
            .map(([key]) => key);
          const hasUrl = Boolean(String(server.url || "").trim());
          return {
            id,
            command: String(server.command || ""),
            args: Array.isArray(server.args) ? server.args.map(String) : [],
            url: String(server.url || ""),
            ok: (hasUrl || Boolean(server.command)) && missingEnv.length === 0,
            commandFound: hasUrl || Boolean(server.command),
            missingEnv,
            warnings: missingEnv.length ? [`Missing environment variables: ${missingEnv.join(", ")}`] : []
          };
        });
    } catch {
      return [];
    }
  }
  return (settings.enabledMcpServers || []).map((id) => ({
    id,
    command: "npx",
    args: ["-y", id],
    ok: id === "playwright" || id === "context7",
    commandFound: true,
    missingEnv: id === "github" ? ["GITHUB_PERSONAL_ACCESS_TOKEN"] : [],
    warnings: id === "github" ? ["Missing environment variables: GITHUB_PERSONAL_ACCESS_TOKEN"] : []
  }));
}

function createPreviewBridge(): Window["deepseekDesktop"] {
  const listeners = new Set<(data: string) => void>();
  const exits = new Set<(exit: { exitCode: number; signal?: number }) => void>();
  const runtimeSnapshots = new Set<(snapshot: RuntimeSnapshot) => void>();
  const runtimeEvents = new Set<(event: RuntimeEvent) => void>();
  const remoteStatuses = new Set<(status: RemoteBridgeStatus) => void>();
  let previewAuth: RemoteAuthState = {
    desktopId: "desktop_preview",
    loggedIn: false,
    account: null,
    pairing: null,
    devices: []
  };

  const previewRemoteStatus = (): RemoteBridgeStatus => ({
    enabled: previewSettings.mobileBridgeEnabled,
    running: previewSettings.mobileBridgeEnabled,
    error: "",
    bindHost: previewSettings.mobileBridgeHost,
    port: previewSettings.mobileBridgePort,
    localUrl: `http://127.0.0.1:${previewSettings.mobileBridgePort}`,
    lanUrl: `http://127.0.0.1:${previewSettings.mobileBridgePort}`,
    token: previewSettings.mobileBridgeToken,
    tokenPreview: "browser...oken",
    mobileRemoteControlEnabled: previewSettings.mobileRemoteControlEnabled,
    updatePushEnabled: previewSettings.updatePushEnabled,
    auth: previewAuth,
    sseClients: 0,
    terminalPreview: "",
    lastTerminalAt: "",
    lastUpdateNotice: null,
    harness: {
      running: false,
      activeSession: null,
      lastExit: null
    }
  });

  return {
    getSettings: async () => previewSettings,
    saveSettings: async (settings) => {
      Object.assign(previewSettings, settings);
      previewSettings.model = previewSettings.provider === "deepseek"
        ? previewSettings.model || "deepseek-v4-pro"
        : previewSettings.model;
      const status = previewRemoteStatus();
      remoteStatuses.forEach((listener) => listener(status));
      return { ...previewSettings };
    },
    getApiKey: async (provider = "deepseek") => previewApiKeys[provider] || "",
    saveApiKey: async (payload) => {
      const provider = payload.provider === "nvidia-nim" ? "nvidia-nim" : "deepseek";
      const apiKey = String(payload.apiKey || "").trim();
      if (apiKey) {
        previewApiKeys = { ...previewApiKeys, [provider]: apiKey };
      }
      return { ok: true, provider, hasKey: Boolean(previewApiKeys[provider]) };
    },
    getCustomization: async (settings) => {
      const nextSettings = { ...previewSettings, ...settings };
      const root = "/browser-preview/userData/skills";
      const skillIds = Array.from(new Set([
        ...Object.keys(previewSkillTemplateDefaults),
        ...Object.keys(previewSkillTemplates)
      ]));
      return {
        skillRoot: root,
        skillTemplates: Object.fromEntries(skillIds.map((id) => {
          const content = previewSkillTemplates[id] || previewSkillTemplateDefaults[id] || "";
          return [id, previewSkillDraft(id, root, content, previewSkillTemplates[id] ? "file" : "default")];
        })),
        mcpConfigPath: previewMcpConfigPath,
        mcpConfigSource: previewMcpConfigPath ? "custom" : "generated",
        mcpConfigText: previewMcpConfigText || JSON.stringify(previewMcpConfig(nextSettings), null, 2),
        mcpConfigError: ""
      };
    },
    createSkillTemplate: async (payload) => {
      const id = (payload.skillId || payload.name || `skill-${Date.now().toString(36)}`)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || `skill-${Date.now().toString(36)}`;
      const content = payload.content || [
        "---",
        `name: ${id}`,
        `description: ${payload.description || `Use when ${payload.name || id} guidance is needed.`}`,
        "---",
        "",
        `# ${payload.name || previewSkillName(id)}`,
        "",
        "## Overview",
        "",
        "Describe the reusable workflow, trigger conditions, and verification steps for this skill."
      ].join("\n");
      previewSkillTemplates[id] = content;
      const root = "/browser-preview/userData/skills";
      return {
        ok: true,
        skill: previewSkillDraft(id, root, content, "file"),
        path: `${root}/${id}/SKILL.md`,
        skillRoot: root
      };
    },
    importSkillDirectory: async (payload) => {
      const id = payload.sourcePath.split(/[\\/]/).filter(Boolean).pop()?.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "imported-skill";
      const content = [
        "---",
        `name: ${id}`,
        "description: Use when imported workflow guidance is needed.",
        "---",
        "",
        `# ${previewSkillName(id)}`,
        "",
        "Imported preview skill."
      ].join("\n");
      previewSkillTemplates[id] = content;
      const root = "/browser-preview/userData/skills";
      return {
        ok: true,
        skills: [previewSkillDraft(id, root, content, "file")],
        path: root,
        skillRoot: root
      };
    },
    saveMcpConfig: async (payload) => {
      try {
        previewMcpConfigText = JSON.stringify(JSON.parse(payload.content), null, 2);
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : "Invalid JSON" };
      }
      previewMcpConfigPath = "/browser-preview/userData/mcp.custom.json";
      return { ok: true, path: previewMcpConfigPath, content: previewMcpConfigText };
    },
    testMcpServers: async (payload) => {
      const servers = previewMcpTests(payload.settings);
      return {
        ok: servers.every((server) => server.ok),
        testedAt: new Date().toISOString(),
        configPath: previewMcpConfigPath,
        servers
      };
    },
    getConversationHistory: async () => previewConversationStore,
    saveConversationHistory: async (history) => {
      previewConversationStore = history;
      return previewConversationStore;
    },
    getAutomations: async () => ({ version: 1, tasks: previewAutomations }),
    saveAutomation: async (payload) => {
      const task = payload.task;
      const id = task.id || `automation-${Date.now().toString(36)}`;
      const now = new Date().toISOString();
      const existing = previewAutomations.find((item) => item.id === id);
      const enabled = task.status === "PAUSED" ? false : task.enabled !== false;
      const saved: AutomationTask = {
        id,
        kind: "cron",
        name: task.name || "Scheduled Agent Task",
        prompt: task.prompt || "",
        workspacePath: task.workspacePath || payload.settings.workspacePath || previewSettings.workspacePath,
        frequency: task.frequency || "daily",
        minute: Number(task.minute ?? 0),
        hour: Number(task.hour ?? 9),
        weekday: Number(task.weekday ?? 1),
        customSchedule: task.customSchedule || "0 9 * * *",
        schedule: previewSchedule(task),
        timezone: task.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai",
        rrule: task.rrule || `FREQ=DAILY;BYHOUR=${Number(task.hour ?? 9)};BYMINUTE=${Number(task.minute ?? 0)}`,
        status: enabled ? "ACTIVE" : "PAUSED",
        enabled,
        installed: enabled,
        cronPath: `/browser-preview/workspace/.deepseek/cron/${id}.cron`,
        logPath: `/browser-preview/workspace/.deepseek/logs/${id}.log`,
        commandPreview: `browser-preview://deepseek exec --auto '${task.prompt || ""}'`,
        runtimePath: "browser-preview://deepseek",
        runnerPath: "",
        runArgs: [],
        provider: task.provider || payload.settings.provider || previewSettings.provider,
        model: previewApiModel(
          task.provider || payload.settings.provider || previewSettings.provider,
          task.model || payload.settings.model || previewSettings.model
        ),
        baseUrl: task.baseUrl || payload.settings.baseUrl || previewSettings.baseUrl,
        mcpConfigPath: task.mcpConfigPath || payload.settings.mcpConfigPath || "",
        skillsDir: task.skillsDir || payload.settings.skillsDir || "",
        enabledSkills: task.enabledSkills || payload.settings.enabledSkills || [],
        mcpEnabled: Boolean(task.mcpEnabled ?? payload.settings.mcpEnabled),
        enabledMcpServers: task.enabledMcpServers || payload.settings.enabledMcpServers || [],
        allowShell: Boolean(task.allowShell ?? payload.settings.allowShell),
        maxSubagents: Number(task.maxSubagents ?? payload.settings.maxSubagents ?? 0),
        createdAt: existing?.createdAt || now,
        updatedAt: now,
        lastGeneratedAt: now,
        lastInstalledAt: enabled ? existing?.lastInstalledAt || now : existing?.lastInstalledAt || ""
      };
      previewAutomations = [saved, ...previewAutomations.filter((item) => item.id !== id)];
      return { ok: true, task: saved, tasks: previewAutomations };
    },
    deleteAutomation: async (payload) => {
      previewAutomations = previewAutomations.filter((item) => item.id !== payload.id);
      return { ok: true, tasks: previewAutomations };
    },
    installAutomation: async (payload) => {
      const now = new Date().toISOString();
      previewAutomations = previewAutomations.map((item) => item.id === payload.id ? { ...item, installed: true, enabled: true, status: "ACTIVE", lastInstalledAt: now, updatedAt: now } : item);
      return { ok: true, task: previewAutomations.find((item) => item.id === payload.id), tasks: previewAutomations };
    },
    uninstallAutomation: async (payload) => {
      const now = new Date().toISOString();
      previewAutomations = previewAutomations.map((item) => item.id === payload.id ? { ...item, installed: false, enabled: false, status: "PAUSED", updatedAt: now } : item);
      return { ok: true, task: previewAutomations.find((item) => item.id === payload.id), tasks: previewAutomations };
    },
    chooseDirectory: async () => previewSettings.workspacePath,
    chooseFile: async () => "",
    openWorkspaceEditor: async (options) => options.workspacePath
      ? {
        ok: true,
        editor: options.editor,
        path: options.workspacePath,
        command: "browser-preview"
      }
      : {
        ok: false,
        error: "Choose a workspace before opening an editor."
      },
    checkRuntime: async (settings) => previewRuntime(settings),
    getRuntimeSnapshot: async () => previewRuntimeSnapshot,
    getGitStatus: async (workspacePath) => previewGitStatus(workspacePath),
    initGitRepository: async (workspacePath) => ({ ok: true, status: previewGitStatus(workspacePath), output: "Initialized empty Git repository" }),
    setGitRemote: async (payload) => ({ ok: true, status: { ...previewGitStatus(payload.workspacePath), originUrl: payload.remoteUrl }, output: "" }),
    fetchGitRepository: async (payload) => ({ ok: true, status: previewGitStatus(payload.workspacePath), output: "Fetched origin" }),
    pullGitRepository: async (payload) => ({ ok: true, status: previewGitStatus(payload.workspacePath), output: "Already up to date." }),
    pushGitRepository: async (payload) => ({ ok: true, status: previewGitStatus(payload.workspacePath), output: "Pushed main" }),
    commitGitRepository: async (payload) => ({
      ok: Boolean(payload.message.trim()),
      error: payload.message.trim() ? undefined : "Commit message is required.",
      status: { ...previewGitStatus(payload.workspacePath), hasChanges: false, changes: [] },
      output: payload.message.trim() ? "[main abc1234] Preview commit" : ""
    }),
    getGitDiffSummary: async (payload) => ({
      ok: true,
      status: previewGitStatus(payload.workspacePath),
      output: [
        "Changed files:",
        " M src/App.tsx",
        "?? docs/git-notes.md",
        "",
        "Unstaged diff stat:",
        " src/App.tsx | 12 +++++++++---"
      ].join("\n")
    }),
    startTerminal: async (options) => {
      const runtime = previewRuntime(options);
      const now = new Date().toISOString();
      const event: RuntimeEvent = {
        id: `preview-${Date.now().toString(36)}`,
        type: "run-started",
        label: "Run started",
        detail: options.launchAction,
        at: now
      };
      previewRuntimeSnapshot = {
        ...previewRuntimeSnapshot,
        status: "running",
        source: "pty",
        sessionId: `preview-${Date.now().toString(36)}`,
        mode: options.launchAction,
        workspacePath: options.workspacePath,
        pid: 0,
        command: "browser-preview://deepseek",
        args: [options.launchAction, options.agentPrompt || ""].filter(Boolean),
        startedAt: now,
        updatedAt: now,
        events: [...previewRuntimeSnapshot.events, event].slice(-80)
      };
      runtimeEvents.forEach((listener) => listener(event));
      runtimeSnapshots.forEach((listener) => listener(previewRuntimeSnapshot));
      const line = [
        options.harnessEnabled ? "\r\n[harness preview] browser-preview://deepseek " : "\r\nbrowser-preview://deepseek ",
        options.launchAction === "exec" || options.launchAction === "plan" ? `${options.launchAction} exec --auto` : options.launchAction,
        "\r\n",
        "Tauri is not active in browser preview.\r\n\r\n"
      ].join("");
      listeners.forEach((listener) => listener(line));
      return { ok: true, runtime, pid: 0 };
    },
    stopTerminal: async () => {
      const now = new Date().toISOString();
      const event: RuntimeEvent = {
        id: `preview-${Date.now().toString(36)}`,
        type: "run-exit",
        label: "Run completed",
        detail: "exitCode=0",
        at: now
      };
      previewRuntimeSnapshot = {
        ...previewRuntimeSnapshot,
        status: "completed",
        updatedAt: now,
        lastExit: { exitCode: 0, exitedAt: now },
        events: [...previewRuntimeSnapshot.events, event].slice(-80)
      };
      runtimeEvents.forEach((listener) => listener(event));
      runtimeSnapshots.forEach((listener) => listener(previewRuntimeSnapshot));
      exits.forEach((listener) => listener({ exitCode: 0 }));
      return { ok: true };
    },
    sendTerminalInput: () => undefined,
    resizeTerminal: () => undefined,
    getRemoteStatus: async () => previewRemoteStatus(),
    restartRemoteBridge: async () => previewRemoteStatus(),
    rotateRemoteToken: async () => {
      previewSettings.mobileBridgeToken = `preview-${Date.now().toString(36)}`;
      return { settings: { ...previewSettings }, status: previewRemoteStatus() };
    },
    loginRemoteAccount: async (payload) => {
      const accountId = (payload.accountId || payload.email || "preview@example.com").toLowerCase();
      previewAuth = {
        ...previewAuth,
        loggedIn: true,
        account: {
          accountId,
          email: payload.email || accountId,
          displayName: payload.displayName || payload.name || accountId,
          loggedInAt: new Date().toISOString()
        },
        pairing: null
      };
      const status = previewRemoteStatus();
      remoteStatuses.forEach((listener) => listener(status));
      return { ok: true, auth: previewAuth, status };
    },
    logoutRemoteAccount: async () => {
      previewAuth = { ...previewAuth, loggedIn: false, account: null, pairing: null, devices: [] };
      const status = previewRemoteStatus();
      remoteStatuses.forEach((listener) => listener(status));
      return { ok: true, auth: previewAuth, status };
    },
    startRemotePairing: async () => {
      const pairing = {
        active: true,
        codePreview: "123 456",
        expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        createdAt: new Date().toISOString()
      };
      previewAuth = { ...previewAuth, pairing };
      const status = previewRemoteStatus();
      remoteStatuses.forEach((listener) => listener(status));
      return {
        ok: true,
        auth: previewAuth,
        status,
        pairing: {
          code: "123456",
          codePreview: pairing.codePreview,
          expiresAt: pairing.expiresAt,
          accountId: previewAuth.account?.accountId || "preview@example.com",
          desktopId: previewAuth.desktopId
        }
      };
    },
    revokeRemoteDevice: async (deviceId) => {
      previewAuth = { ...previewAuth, devices: previewAuth.devices.filter((device) => device.id !== deviceId) };
      const status = previewRemoteStatus();
      remoteStatuses.forEach((listener) => listener(status));
      return { ok: true, auth: previewAuth, status };
    },
    pushUpdateNotice: async (payload) => ({
      ok: previewSettings.updatePushEnabled,
      notice: previewSettings.updatePushEnabled ? {
        id: "preview-update",
        source: "browser-preview",
        accountId: payload.accountId || previewAuth.account?.accountId || "",
        matchedDeviceIds: previewAuth.devices.map((device) => device.id),
        version: payload.version || "0.1.1",
        title: payload.title || "Preview update",
        body: payload.body || payload.message || "Preview update notice",
        url: payload.url || payload.downloadUrl || "",
        createdAt: new Date().toISOString()
      } : undefined,
      error: previewSettings.updatePushEnabled ? undefined : "Update push notifications are disabled"
    }),
    onTerminalData: (callback) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    onTerminalExit: (callback) => {
      exits.add(callback);
      return () => exits.delete(callback);
    },
    onRuntimeSnapshot: (callback) => {
      runtimeSnapshots.add(callback);
      return () => runtimeSnapshots.delete(callback);
    },
    onRuntimeEvent: (callback) => {
      runtimeEvents.add(callback);
      return () => runtimeEvents.delete(callback);
    },
    onRemoteStatus: (callback) => {
      remoteStatuses.add(callback);
      return () => remoteStatuses.delete(callback);
    },
    createFileSnapshot: (payload) => invoke<{ id: string; messageId: string; files: Record<string, string>; createdAt: string }>("create_file_snapshot", {
      messageId: payload.messageId,
      workspacePath: payload.workspacePath
    }),
    getFileSnapshots: (workspacePath) => invoke<Array<{ id: string; messageId: string; files: Record<string, string>; createdAt: string }>>("get_file_snapshots", { workspacePath }),
    rollbackToSnapshot: (payload) => invoke<{ ok: boolean; error?: string; snapshotId: string; undoSnapshotId?: string; restoredFiles: string[] }>("rollback_to_snapshot", {
      snapshotId: payload.snapshotId,
      workspacePath: payload.workspacePath
    }),
    undoRollback: (payload) => invoke<{ ok: boolean; error?: string; snapshotId: string; undoSnapshotId?: string; restoredFiles: string[] }>("undo_rollback", {
      undoSnapshotId: payload.undoSnapshotId,
      workspacePath: payload.workspacePath
    }),
    deleteSnapshot: (snapshotId) => invoke<boolean>("delete_snapshot", { snapshotId }),
  };
}

// Tauri bridge implementation
function createTauriBridge(): Window["deepseekDesktop"] {
  let ptySessionId = "";
  return {
    getSettings: () => eventInvoke("get_settings"),
    saveSettings: (settings) => eventInvoke("save_settings", settings).then(() => settings),
    getApiKey: (provider = "deepseek") => eventInvoke("get_api_key", { provider }).then((r: any) => r?.apiKey ?? ""),
    saveApiKey: (payload) => eventInvoke("save_api_key", { provider: payload.provider, api_key: payload.apiKey }).then(() => { return { ok: true }; }),
    getCustomization: (settings) => invoke<CustomizationDraft>("get_customization", { settings }).catch(() => { return { skills: [], templates: [] }; }),
    createSkillTemplate: (payload) => invoke<TemplateSaveResult>("create_skill_template", {
      skillId: payload.skillId || "",
      name: payload.name || "",
      description: payload.description || "",
      content: payload.content || "",
      source: payload.source || "",
      vars: payload.vars || []
    }).catch(() => { return { ok: true }; }),
    importSkillDirectory: (payload) => invoke<SkillImportResult>("import_skill_directory", { sourcePath: payload.sourcePath }).catch(() => { return { ok: true }; }),
    saveMcpConfig: (payload) => invoke<string>("save_mcp_config", { content: payload.content }).catch(() => ""),
    testMcpServers: (payload) => invoke<McpTestResult>("test_mcp_servers", { settings: payload.settings }).catch(() => { return { ok: true }; }),
    getConversationHistory: () => invoke<ConversationStore>("get_conversation_history").catch(() => { return { activeSessionId: "", projects: [] }; }),
    saveConversationHistory: (history) => invoke<void>("save_conversation_history", { history }).catch(() => {}),
    getAutomations: () => invoke<AutomationStore>("get_automations").catch(() => { return { version: 1, tasks: [] }; }),
    saveAutomation: (payload) => invoke<AutomationActionResult>("save_automation", { task: payload.task }).catch(() => { return { ok: true }; }),
    deleteAutomation: (payload) => invoke<AutomationActionResult>("delete_automation", { id: payload.id }).catch(() => { return { ok: true }; }),
    installAutomation: (payload) => invoke<AutomationActionResult>("save_automation", { task: { ...payload.task, status: "ACTIVE" } }).catch(() => { return { ok: true }; }),
    uninstallAutomation: (payload) => invoke<AutomationActionResult>("save_automation", { task: { ...payload.task, status: "PAUSED" } }).catch(() => { return { ok: true }; }),
    chooseDirectory: () => eventInvoke("choose_directory") as Promise<string>,
    chooseFile: (filters) => {
      return invoke<string>("choose_file", { filters: filters || [] }).catch(() => {
        return open({ multiple: false, filters: filters || [] }).then((result) => result ?? "");
      });
    },
    openWorkspaceEditor: (options) => invoke<OpenWorkspaceEditorResult>("open_workspace_editor", { editor: options.editor, workspacePath: options.workspacePath }).catch(() => { return { ok: false }; }),
    checkRuntime: (settings) => invoke<RuntimeCheck>("check_runtime", { settings: settings || {} }).catch(() => { return { selected: "", selectedExists: false, bundled: "", bundledExists: false, system: "", systemExists: false, custom: "", customExists: false, version: "" }; }),
    getRuntimeSnapshot: () => invoke<RuntimeSnapshot>("get_runtime_snapshot").catch(() => {
      const now = new Date().toISOString();
      return { status: "idle", source: "none", sessionId: "", mode: "", workspacePath: "", pid: 0, command: "", args: [], startedAt: "", updatedAt: now, lastExit: null, agents: [], counts: { total: 0, running: 0, completed: 0, failed: 0, cancelled: 0 }, events: [] };
    }),
    getGitStatus: (workspacePath) => invoke<GitStatus>("git_status", { workspacePath }).catch(() => { return { branch: "", status: [], ahead: 0, behind: 0 }; }),
    initGitRepository: (workspacePath) => invoke<GitActionResult>("git_init", { workspacePath }).catch(() => { return { ok: true }; }),
    setGitRemote: (payload) => invoke<GitActionResult>("git_set_remote", { workspacePath: payload.workspacePath, remoteUrl: payload.remoteUrl }).catch(() => { return { ok: true }; }),
    fetchGitRepository: (payload) => invoke<GitActionResult>("git_fetch", { workspacePath: payload.workspacePath }).catch(() => { return { ok: true }; }),
    pullGitRepository: (payload) => invoke<GitActionResult>("git_pull", { workspacePath: payload.workspacePath }).catch(() => { return { ok: true }; }),
    pushGitRepository: (payload) => invoke<GitActionResult>("git_push", { workspacePath: payload.workspacePath }).catch(() => { return { ok: true }; }),
    commitGitRepository: (payload) => invoke<GitActionResult>("git_commit", { workspacePath: payload.workspacePath, message: payload.message }).catch(() => { return { ok: true }; }),
    getGitDiffSummary: (payload) => invoke<GitDiffSummaryResult>("git_diff_summary", { workspacePath: payload.workspacePath }).catch(() => { return { summary: "" }; }),
    startTerminal: async (options) => {
      try {
        const result = await eventInvoke("terminal_start", {
          options: {
            cols: options.cols || 120,
            rows: options.rows || 34,
            workspacePath: options.workspacePath,
            launchAction: options.launchAction,
            agentPrompt: options.agentPrompt || "",
            apiKey: options.apiKey || ""
          },
          settings: {
            language: options.language || "zh",
            workspacePath: options.workspacePath,
            binaryMode: options.binaryMode || "bundled",
            customBinaryPath: options.customBinaryPath || "",
            provider: options.provider || "deepseek",
            model: options.model || "deepseek-v4-pro",
            baseUrl: options.baseUrl || "https://api.deepseek.com",
            mcpConfigPath: options.mcpConfigPath || "",
            skillsDir: options.skillsDir || "",
            skillsEnabled: options.skillsEnabled ?? true,
            mcpEnabled: options.mcpEnabled ?? false,
            allowShell: options.allowShell ?? false,
            maxSubagents: options.maxSubagents || 10,
            harnessEnabled: options.harnessEnabled ?? false,
            launchAction: options.launchAction || "tui",
            rememberWorkspace: options.rememberWorkspace ?? true,
            enabledSkills: options.enabledSkills || [],
            enabledMcpServers: options.enabledMcpServers || [],
            mobileBridgeEnabled: false,
            mobileBridgeHost: "127.0.0.1",
            mobileBridgePort: 8765,
            mobileBridgeToken: "",
            mobileRemoteControlEnabled: false,
            updatePushEnabled: false
          }
        });
        if (result && result.sessionId) {
          ptySessionId = result.sessionId;
        }
        return result;
      } catch (error) {
        return { ok: false, error: String(error) };
      }
    },
    stopTerminal: () => invoke<void>("terminal_stop", { sessionId: ptySessionId }),
    sendTerminalInput: (data) => invoke<void>("terminal_input", { sessionId: ptySessionId, data }),
    resizeTerminal: (size) => invoke<void>("terminal_resize", { sessionId: ptySessionId, cols: size.cols, rows: size.rows }),
    getRemoteStatus: () => Promise.resolve({
      enabled: false,
      running: false,
      error: "",
      bindHost: "127.0.0.1",
      port: 8765,
      localUrl: "http://127.0.0.1:8765",
      lanUrl: "http://127.0.0.1:8765",
      tokenPreview: "",
      mobileRemoteControlEnabled: false,
      updatePushEnabled: false,
      auth: {
        desktopId: "",
        loggedIn: false,
        account: null,
        pairing: null,
        devices: []
      },
      sseClients: 0,
      terminalPreview: "",
      lastTerminalAt: "",
      lastUpdateNotice: null,
      harness: {
        running: false,
        activeSession: null,
        lastExit: null
      }
    }),
    restartRemoteBridge: () => Promise.resolve({
      enabled: false,
      running: false,
      error: "",
      bindHost: "127.0.0.1",
      port: 8765,
      localUrl: "http://127.0.0.1:8765",
      lanUrl: "http://127.0.0.1:8765",
      tokenPreview: "",
      mobileRemoteControlEnabled: false,
      updatePushEnabled: false,
      auth: {
        desktopId: "",
        loggedIn: false,
        account: null,
        pairing: null,
        devices: []
      },
      sseClients: 0,
      terminalPreview: "",
      lastTerminalAt: "",
      lastUpdateNotice: null,
      harness: {
        running: false,
        activeSession: null,
        lastExit: null
      }
    }),
    rotateRemoteToken: () => Promise.resolve({
      settings: previewSettings,
      status: {
        enabled: false,
        running: false,
        error: "",
        bindHost: "127.0.0.1",
        port: 8765,
        localUrl: "http://127.0.0.1:8765",
        lanUrl: "http://127.0.0.1:8765",
        tokenPreview: "",
        mobileRemoteControlEnabled: false,
        updatePushEnabled: false,
        auth: {
          desktopId: "",
          loggedIn: false,
          account: null,
          pairing: null,
          devices: []
        },
        sseClients: 0,
        terminalPreview: "",
        lastTerminalAt: "",
        lastUpdateNotice: null,
        harness: {
          running: false,
          activeSession: null,
          lastExit: null
        }
      }
    }),
    loginRemoteAccount: () => Promise.resolve({
      ok: false,
      error: "Remote bridge not available in Tauri"
    }),
    logoutRemoteAccount: () => Promise.resolve({
      ok: false,
      error: "Remote bridge not available in Tauri"
    }),
    startRemotePairing: () => Promise.resolve({
      ok: false,
      error: "Remote bridge not available in Tauri"
    }),
    revokeRemoteDevice: () => Promise.resolve({
      ok: false,
      error: "Remote bridge not available in Tauri"
    }),
    pushUpdateNotice: () => Promise.resolve({
      ok: false,
      error: "Update push not available in Tauri"
    }),
    onTerminalData: (callback) => {
      let polling = true;
      let lastTimestamp = Date.now();
      const poll = async () => {
        if (!polling) return;
        try {
          const resp = await fetch(`/api/terminal-events?after=${lastTimestamp}`);
          const data = await resp.json();
          for (const event of (data.events || [])) {
            if (event.event_type === "terminal:data") {
              callback(event.data);
            }
            if (event.timestamp > lastTimestamp) {
              lastTimestamp = event.timestamp;
            }
          }
        } catch (e) {
          // Ignore polling errors
        }
        if (polling) setTimeout(poll, 100);
      };
      poll();
      return () => { polling = false; };
    },
    onTerminalExit: (callback) => {
      let polling = true;
      let lastTimestamp = Date.now();
      const poll = async () => {
        if (!polling) return;
        try {
          const resp = await fetch(`/api/terminal-events?after=${lastTimestamp}`);
          const data = await resp.json();
          for (const event of (data.events || [])) {
            if (event.event_type === "terminal:exit") {
              const payload = event.data;
              let exitCode = 0;
              try {
                const parsed = JSON.parse(payload);
                exitCode = parsed.exitCode ?? 0;
              } catch {
                // data is not JSON (legacy/plain session id)
              }
              callback({ exitCode });
            }
            if (event.timestamp > lastTimestamp) {
              lastTimestamp = event.timestamp;
            }
          }
        } catch (e) {
          // Ignore polling errors
        }
        if (polling) setTimeout(poll, 100);
      };
      poll();
      return () => { polling = false; };
    },
    onRuntimeSnapshot: () => {
      return () => {};
    },
    onRuntimeEvent: () => {
      return () => {};
    },
    onRemoteStatus: () => {
      return () => {};
    },
    createFileSnapshot: (payload) => invoke<{ id: string; messageId: string; files: Record<string, string>; createdAt: string }>("create_file_snapshot", {
      messageId: payload.messageId,
      workspacePath: payload.workspacePath
    }),
    getFileSnapshots: (workspacePath) => invoke<Array<{ id: string; messageId: string; files: Record<string, string>; createdAt: string }>>("get_file_snapshots", { workspacePath }),
    rollbackToSnapshot: (payload) => invoke<{ ok: boolean; error?: string; snapshotId: string; undoSnapshotId?: string; restoredFiles: string[] }>("rollback_to_snapshot", {
      snapshotId: payload.snapshotId,
      workspacePath: payload.workspacePath
    }),
    undoRollback: (payload) => invoke<{ ok: boolean; error?: string; snapshotId: string; undoSnapshotId?: string; restoredFiles: string[] }>("undo_rollback", {
      undoSnapshotId: payload.undoSnapshotId,
      workspacePath: payload.workspacePath
    }),
    deleteSnapshot: (snapshotId) => invoke<boolean>("delete_snapshot", { snapshotId }),
  };
}

export function getDesktopBridge(): Window["deepseekDesktop"] {
  if (isTauri) {
    return createTauriBridge();
  }
  return createPreviewBridge();
}
