const { EventEmitter } = require("events");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const DEFAULT_PATH = [
  "/opt/homebrew/bin",
  "/usr/local/bin",
  "/usr/bin",
  "/bin",
  "/usr/sbin",
  "/sbin"
].join(path.delimiter);
const DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const NVIDIA_NIM_BASE_URL = "https://integrate.api.nvidia.com/v1";
const DEFAULT_DEEPSEEK_MODEL = "deepseek-v4-pro";
const DEFAULT_ENABLED_SKILLS = ["superpowers", "ui-ux-design", "cron-scheduler"];
const SKILL_PRESET_VERSION = 1;
const AUTOMATION_STORE_VERSION = 1;
const AUTOMATION_CRON_BEGIN = "# BEGIN DeepSeek TUI Desktop automation";
const AUTOMATION_CRON_END = "# END DeepSeek TUI Desktop automation";
const SKILL_CONTENT_MAX_CHARS = 120000;
const SKILL_ID_MAX_CHARS = 72;
const CRON_ALIASES = new Set(["@reboot", "@yearly", "@annually", "@monthly", "@weekly", "@daily", "@midnight", "@hourly"]);
const GIT_COMMAND_TIMEOUT = 30000;
const SECRET_STORE_VERSION = 1;

function desktopPath(env = process.env) {
  return env.PATH ? `${DEFAULT_PATH}${path.delimiter}${env.PATH}` : DEFAULT_PATH;
}

function desktopEnv(env = process.env) {
  return {
    ...env,
    PATH: desktopPath(env)
  };
}

const CRON_SCHEDULER_SKILL_CONTENT = [
  "---",
  "name: cron-scheduler",
  "description: Use when the user asks to create, update, review, or install a recurring task, cron entry, crontab file, scheduled automation, daily job, weekly job, or timed command.",
  "---",
  "",
  "# Cron Scheduler",
  "",
  "Use this skill to convert a user's scheduling request into a workspace-local cron file.",
  "",
  "## Guardrails",
  "",
  "- Generate and validate a cron file before discussing installation.",
  "- Do not run `crontab`, overwrite an existing crontab, or install a task unless the user explicitly asks.",
  "- If the schedule, command, workspace, or timezone is ambiguous, ask only for the missing field.",
  "- Prefer workspace-local outputs under `.deepseek/cron/` and logs under `.deepseek/logs/`.",
  "- Use five-field cron syntax unless the user explicitly asks for a cron alias such as `@daily`.",
  "",
  "## Workflow",
  "",
  "1. Normalize the request into: task name, cron expression, command, working directory, timezone, and optional env vars.",
  "2. Run the bundled helper from the active skills directory:",
  "",
  "```bash",
  "node \"$DEEPSEEK_SKILLS_DIR/cron-scheduler/scripts/write-cron-file.mjs\" \\",
  "  --name \"daily-health-check\" \\",
  "  --schedule \"0 5 * * *\" \\",
  "  --command \"npm run health:check\" \\",
  "  --cwd \"$PWD\" \\",
  "  --timezone \"Asia/Shanghai\"",
  "```",
  "",
  "3. Inspect the generated cron file and verify the path exists.",
  "4. Report the generated file path, schedule, command, log path, and whether installation was skipped.",
  "",
  "## Installation Handling",
  "",
  "If the user explicitly asks to install it, first inspect `crontab -l`. Merge the new entry with existing entries instead of replacing the user's crontab blindly."
].join("\n");

const PRESET_SKILLS = {
  superpowers: {
    dir: "superpowers",
    name: "Superpowers",
    content: [
      "# Superpowers",
      "",
      "Use this skill to strengthen planning, task decomposition, code editing, verification, and final reporting.",
      "",
      "- Start by identifying the user's concrete goal and the workspace scope.",
      "- Prefer small, reversible edits that match the existing codebase.",
      "- Verify changes with the narrowest useful command before reporting completion.",
      "- Surface blockers, assumptions, and residual risk clearly."
    ].join("\n")
  },
  "ui-ux-design": {
    dir: "ui-ux-design",
    name: "UI/UX Design",
    content: [
      "# UI/UX Design",
      "",
      "Use this skill for product UI work, desktop app polish, and visual interaction checks.",
      "",
      "- Keep primary workflows visible and reduce default configuration clutter.",
      "- Use familiar controls: icon buttons for tools, toggles for binary settings, and compact panels for advanced options.",
      "- Check spacing, overflow, text fit, empty states, disabled states, and responsive constraints.",
      "- Prefer restrained, work-focused surfaces for developer tools."
    ].join("\n")
  },
  "cron-scheduler": {
    dir: "cron-scheduler",
    name: "Cron Scheduler",
    content: CRON_SCHEDULER_SKILL_CONTENT,
    files: [
      {
        source: path.join("skills", "cron-scheduler", "scripts", "write-cron-file.mjs"),
        target: path.join("scripts", "write-cron-file.mjs"),
        executable: true
      }
    ]
  }
};

const MCP_PRESETS = {
  playwright: {
    command: "npx",
    args: ["-y", "@playwright/mcp"],
    env() {
      return {};
    }
  },
  context7: {
    command: "npx",
    args: ["-y", "@upstash/context7-mcp"],
    env() {
      return {};
    }
  },
  github: {
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    env() {
      return {
        GITHUB_PERSONAL_ACCESS_TOKEN: process.env.GITHUB_PERSONAL_ACCESS_TOKEN || process.env.GITHUB_TOKEN || ""
      };
    }
  },
  memory: {
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-memory"],
    env() {
      return {};
    }
  },
  "sequential-thinking": {
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-sequential-thinking"],
    env() {
      return {};
    }
  },
  postgres: {
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-postgres", process.env.POSTGRES_CONNECTION_STRING || "postgresql://localhost/postgres"],
    env() {
      return {};
    }
  },
  puppeteer: {
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-puppeteer"],
    env() {
      return {};
    }
  },
  "brave-search": {
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-brave-search"],
    env() {
      return {
        BRAVE_API_KEY: process.env.BRAVE_API_KEY || ""
      };
    }
  },
  slack: {
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-slack"],
    env() {
      return {
        SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN || "",
        SLACK_TEAM_ID: process.env.SLACK_TEAM_ID || ""
      };
    }
  },
  notion: {
    command: "npx",
    args: ["-y", "@notionhq/notion-mcp-server"],
    env() {
      return {
        NOTION_TOKEN: process.env.NOTION_TOKEN || process.env.NOTION_API_TOKEN || ""
      };
    }
  },
  sentry: {
    command: "npx",
    args: ["-y", "@sentry/mcp-server"],
    env() {
      return {
        SENTRY_ACCESS_TOKEN: process.env.SENTRY_ACCESS_TOKEN || "",
        SENTRY_HOST: process.env.SENTRY_HOST || "sentry.io",
        SENTRY_URL: process.env.SENTRY_URL || ""
      };
    }
  },
  stripe: {
    command: "npx",
    args: ["-y", "@stripe/mcp"],
    env() {
      return {
        STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || ""
      };
    }
  },
  figma: {
    command: "npx",
    args: ["-y", "figma-developer-mcp"],
    env() {
      return {
        FIGMA_API_KEY: process.env.FIGMA_API_KEY || process.env.FIGMA_ACCESS_TOKEN || ""
      };
    }
  },
  "google-maps": {
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-google-maps"],
    env() {
      return {
        GOOGLE_MAPS_API_KEY: process.env.GOOGLE_MAPS_API_KEY || ""
      };
    }
  },
  "mcp-remote": {
    command: "npx",
    args: ["-y", "mcp-remote", process.env.MCP_REMOTE_URL || "https://example.com/mcp"],
    env() {
      return {};
    }
  },
  pannel: {
    command: "mcp-1panel",
    args: [],
    env() {
      return {
        PANEL_HOST: process.env.PANEL_HOST || process.env["1PANEL_BASE_URL"] || "",
        PANEL_ACCESS_TOKEN: process.env.PANEL_ACCESS_TOKEN || process.env["1PANEL_API_KEY"] || ""
      };
    }
  },
  filesystem: {
    command: "npx",
    args(workspacePath) {
      return ["-y", "@modelcontextprotocol/server-filesystem", workspacePath];
    },
    env() {
      return {};
    }
  }
};

function defaultSettings() {
  return {
    language: "zh",
    workspacePath: os.homedir(),
    binaryMode: "bundled",
    customBinaryPath: "",
    provider: "deepseek",
    model: DEFAULT_DEEPSEEK_MODEL,
    baseUrl: DEEPSEEK_BASE_URL,
    mcpConfigPath: "",
    skillsDir: "",
    skillsEnabled: true,
    mcpEnabled: false,
    allowShell: false,
    maxSubagents: 3,
    launchAction: "tui",
    rememberWorkspace: true,
    enabledSkills: [...DEFAULT_ENABLED_SKILLS],
    enabledMcpServers: [],
    mobileBridgeEnabled: false,
    mobileBridgeHost: "127.0.0.1",
    mobileBridgePort: 8765,
    mobileBridgeToken: "",
    mobileRemoteControlEnabled: false,
    updatePushEnabled: false
  };
}

function defaultBaseUrlForProvider(provider) {
  return provider === "nvidia-nim" ? NVIDIA_NIM_BASE_URL : DEEPSEEK_BASE_URL;
}

function normalizeSettings(settings) {
  const provider = settings.provider || "deepseek";
  const language = settings.language === "en" ? "en" : "zh";
  return {
    ...settings,
    language,
    provider,
    model: settings.model || DEFAULT_DEEPSEEK_MODEL,
    baseUrl: settings.baseUrl || defaultBaseUrlForProvider(provider)
  };
}

function binaryName(base) {
  return process.platform === "win32" ? `${base}.exe` : base;
}

function unpackAsar(binaryPath) {
  return binaryPath.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`);
}

function findOnPath(command) {
  const result = spawnSync(process.platform === "win32" ? "where" : "which", [command], {
    encoding: "utf8",
    env: desktopEnv()
  });
  if (result.status === 0) {
    return result.stdout.split(/\r?\n/).find(Boolean) || "";
  }
  return "";
}

function runtimeVersion(binaryPath) {
  if (!binaryPath || !fs.existsSync(binaryPath)) {
    return "";
  }
  const result = spawnSync(binaryPath, ["--version"], {
    encoding: "utf8",
    env: desktopEnv(),
    timeout: 5000
  });
  const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
  return output.split(/\r?\n/)[0] || "";
}

function normalizeWorkspace(workspacePath) {
  if (workspacePath && fs.existsSync(workspacePath)) {
    const stat = fs.statSync(workspacePath);
    if (stat.isDirectory()) {
      return path.resolve(workspacePath);
    }
  }
  return os.homedir();
}

function sanitizeSettings(settings) {
  const safeSettings = normalizeSettings({ ...defaultSettings(), ...settings });
  delete safeSettings.apiKey;
  delete safeSettings.agentPrompt;
  delete safeSettings.cols;
  delete safeSettings.rows;
  safeSettings.mobileBridgeEnabled = Boolean(safeSettings.mobileBridgeEnabled);
  safeSettings.skillsEnabled = safeSettings.skillsEnabled !== false;
  safeSettings.mcpEnabled = Boolean(safeSettings.mcpEnabled);
  safeSettings.mobileRemoteControlEnabled = Boolean(safeSettings.mobileRemoteControlEnabled);
  safeSettings.updatePushEnabled = Boolean(safeSettings.updatePushEnabled);
  safeSettings.mobileBridgeHost = typeof safeSettings.mobileBridgeHost === "string" && safeSettings.mobileBridgeHost.trim()
    ? safeSettings.mobileBridgeHost.trim()
    : "127.0.0.1";
  const bridgePort = Number(safeSettings.mobileBridgePort);
  safeSettings.mobileBridgePort = Number.isInteger(bridgePort) && bridgePort >= 1024 && bridgePort <= 65535
    ? bridgePort
    : 8765;
  if (typeof safeSettings.mobileBridgeToken !== "string" || safeSettings.mobileBridgeToken.length < 20) {
    safeSettings.mobileBridgeToken = createRemoteToken();
  }
  safeSettings.enabledSkills = normalizeEnabledSkills(safeSettings);
  safeSettings.skillPresetVersion = SKILL_PRESET_VERSION;
  return safeSettings;
}

function enabledList(values) {
  return Array.isArray(values) ? values.filter((value) => typeof value === "string") : [];
}

function mcpFeatureArgs(options = {}) {
  const hasPresetConfig = enabledList(options.enabledMcpServers).length > 0;
  const hasCustomConfig = Boolean(String(options.mcpConfigPath || "").trim());
  return options.mcpEnabled && (hasPresetConfig || hasCustomConfig) ? ["--enable", "mcp"] : [];
}

function normalizeEnabledSkills(settings) {
  if (!Array.isArray(settings.enabledSkills)) {
    return [...DEFAULT_ENABLED_SKILLS];
  }

  const selected = enabledList(settings.enabledSkills);
  const skillPresetVersion = Number(settings.skillPresetVersion) || 0;
  const oldDefaultSkills = ["superpowers", "ui-ux-design"];
  const shouldRunSkillMigration = skillPresetVersion < SKILL_PRESET_VERSION;
  const stillOnOldDefaults = shouldRunSkillMigration
    && selected.length === oldDefaultSkills.length
    && oldDefaultSkills.every((id) => selected.includes(id));

  if (stillOnOldDefaults) {
    return [...oldDefaultSkills, "cron-scheduler"];
  }

  return selected;
}

function safeTemplateText(value) {
  return String(value || "").slice(0, SKILL_CONTENT_MAX_CHARS);
}

function slugifySkillId(value, fallback = "custom-skill") {
  const slug = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SKILL_ID_MAX_CHARS)
    .replace(/-+$/g, "");
  if (slug) return slug;
  return `${fallback}-${Date.now().toString(36)}`.slice(0, SKILL_ID_MAX_CHARS);
}

function humanizeSkillId(id) {
  return String(id || "Skill")
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function parseSkillFrontmatter(content) {
  const text = String(content || "");
  if (!text.startsWith("---")) {
    return {};
  }
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) {
    return {};
  }
  const meta = {};
  for (const line of match[1].split(/\r?\n/)) {
    const field = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!field) continue;
    meta[field[1]] = field[2].replace(/^['"]|['"]$/g, "").trim();
  }
  return meta;
}

function skillHeading(content) {
  const match = String(content || "").match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : "";
}

function skillDescriptionFromContent(content) {
  const lines = String(content || "").split(/\r?\n/);
  let afterHeading = false;
  for (const line of lines) {
    if (!afterHeading) {
      afterHeading = /^#\s+/.test(line);
      continue;
    }
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("-")) continue;
    return trimmed.slice(0, 220);
  }
  return "";
}

function describeSkill(id, content, preset, source) {
  const frontmatter = parseSkillFrontmatter(content);
  const name = frontmatter.name || preset?.name || skillHeading(content) || humanizeSkillId(id);
  const description = frontmatter.description || skillDescriptionFromContent(content) || "Custom agent workflow skill.";
  return {
    id,
    name,
    description,
    source,
    origin: preset ? "preset" : "custom"
  };
}

function createSkillContent({ id, name, description, content }) {
  const body = safeTemplateText(content);
  if (body.trim()) {
    return body;
  }
  const safeName = String(name || humanizeSkillId(id)).trim() || humanizeSkillId(id);
  const safeDescription = String(description || `Use when ${safeName} guidance is needed.`).trim();
  return [
    "---",
    `name: ${id}`,
    `description: ${safeDescription}`,
    "---",
    "",
    `# ${safeName}`,
    "",
    "## Overview",
    "",
    "Describe the reusable workflow, trigger conditions, and verification steps for this skill."
  ].join("\n");
}

function discoverSkillIds(root) {
  try {
    return fs.readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((id) => fs.existsSync(path.join(root, id, "SKILL.md")))
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

function findSkillDirectories(sourcePath) {
  const resolved = path.resolve(sourcePath || "");
  if (!resolved || !fs.existsSync(resolved)) {
    return [];
  }
  const stat = fs.statSync(resolved);
  if (!stat.isDirectory()) {
    return [];
  }
  if (fs.existsSync(path.join(resolved, "SKILL.md"))) {
    return [resolved];
  }
  return fs.readdirSync(resolved, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(resolved, entry.name))
    .filter((candidate) => fs.existsSync(path.join(candidate, "SKILL.md")));
}

function copySkillDirectory(sourceDir, targetDir) {
  const source = path.resolve(sourceDir);
  const target = path.resolve(targetDir);
  if (source === target) {
    return;
  }
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, {
    recursive: true,
    filter: (candidate) => {
      const base = path.basename(candidate);
      return base !== ".git" && base !== "node_modules" && base !== ".DS_Store";
    }
  });
}

function ensureInsideDirectory(parentDir, candidatePath) {
  const relativePath = path.relative(parentDir, candidatePath);
  return relativePath && !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
}

function copyPresetSupportFiles(skillDir, preset) {
  const files = Array.isArray(preset.files) ? preset.files : [];
  for (const file of files) {
    const sourcePath = path.resolve(__dirname, file.source || "");
    const targetPath = path.resolve(skillDir, file.target || "");
    if (!ensureInsideDirectory(skillDir, targetPath)) {
      throw new Error(`Invalid skill support file path: ${file.target || ""}`);
    }
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.copyFileSync(sourcePath, targetPath);
    if (file.executable && process.platform !== "win32") {
      fs.chmodSync(targetPath, 0o755);
    }
  }
}

function createRemoteToken() {
  return crypto.randomBytes(24).toString("base64url");
}

function trimString(value, maxLength) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function trimSecret(value, maxLength = 8000) {
  return String(value || "").trim().slice(0, maxLength);
}

function normalizeProvider(provider) {
  return provider === "nvidia-nim" ? "nvidia-nim" : "deepseek";
}

function trimOutput(value, maxLength = 12000) {
  return String(value || "").trim().slice(0, maxLength);
}

function createId(prefix = "") {
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return prefix ? `${prefix}-${id}` : id;
}

function slugify(value) {
  const slug = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || "scheduled-task";
}

function clampInteger(value, min, max, fallback) {
  const number = Number.parseInt(String(value), 10);
  if (!Number.isInteger(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function validateCronSchedule(schedule) {
  const value = String(schedule || "").trim();
  if (CRON_ALIASES.has(value)) {
    return true;
  }
  const fields = value.split(/\s+/);
  const fieldPattern = /^[A-Za-z0-9*,/?#L\-\[\]]+$/;
  return fields.length === 5 && fields.every((field) => fieldPattern.test(field));
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function cronEnvValue(value) {
  return `"${String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function escapeCronPercent(command) {
  let escaped = "";
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    const previous = index > 0 ? command[index - 1] : "";
    escaped += char === "%" && previous !== "\\" ? "\\%" : char;
  }
  return escaped;
}

function normalizeAutomationFrequency(value) {
  return ["hourly", "daily", "weekly", "custom"].includes(value) ? value : "daily";
}

function buildAutomationSchedule(task) {
  if (task.frequency === "hourly") {
    return `${task.minute} * * * *`;
  }
  if (task.frequency === "weekly") {
    return `${task.minute} ${task.hour} * * ${task.weekday}`;
  }
  if (task.frequency === "custom") {
    return task.customSchedule;
  }
  return `${task.minute} ${task.hour} * * *`;
}

function normalizeAutomationTask(input = {}, settings = {}, existing = {}) {
  const frequency = normalizeAutomationFrequency(input.frequency || existing.frequency);
  const minute = clampInteger(input.minute ?? existing.minute, 0, 59, 0);
  const hour = clampInteger(input.hour ?? existing.hour, 0, 23, 9);
  const weekday = clampInteger(input.weekday ?? existing.weekday, 0, 6, 1);
  const name = trimString(input.name || existing.name || "Scheduled Agent Task", 120);
  const prompt = String(input.prompt || existing.prompt || "").trim().slice(0, 20000);
  const customSchedule = trimString(input.customSchedule || existing.customSchedule || "0 9 * * *", 80);
  const timezone = trimString(input.timezone || existing.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", 80);
  const workspacePath = normalizeWorkspace(input.workspacePath || existing.workspacePath || settings.workspacePath);
  const task = {
    id: trimString(input.id || existing.id || createId("automation"), 100),
    name,
    prompt,
    workspacePath,
    frequency,
    minute,
    hour,
    weekday,
    customSchedule,
    timezone,
    enabled: input.enabled === undefined ? existing.enabled !== false : Boolean(input.enabled),
    installed: Boolean(existing.installed),
    cronPath: existing.cronPath || "",
    logPath: existing.logPath || "",
    commandPreview: existing.commandPreview || "",
    error: "",
    createdAt: existing.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastGeneratedAt: existing.lastGeneratedAt || ""
  };
  task.schedule = buildAutomationSchedule(task);
  return task;
}

function sanitizeAutomationStore(store) {
  const tasks = Array.isArray(store?.tasks) ? store.tasks : [];
  return {
    version: AUTOMATION_STORE_VERSION,
    tasks: tasks.map((task) => normalizeAutomationTask(task, {}, task))
  };
}

function gitResultError(result, fallback) {
  if (result.error) {
    return result.error.message || fallback;
  }
  return trimOutput(result.stderr || result.stdout) || fallback;
}

function runGit(args, cwd, timeout = GIT_COMMAND_TIMEOUT) {
  return spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: desktopEnv(),
    timeout,
    windowsHide: true,
    maxBuffer: 1024 * 1024 * 4
  });
}

function parseGitRemotes(output) {
  const remotesByName = new Map();
  for (const line of String(output || "").split(/\r?\n/)) {
    const match = line.match(/^(\S+)\s+(.+)\s+\((fetch|push)\)$/);
    if (!match) continue;
    const [, name, url, kind] = match;
    const remote = remotesByName.get(name) || { name, fetchUrl: "", pushUrl: "" };
    if (kind === "fetch") remote.fetchUrl = url;
    if (kind === "push") remote.pushUrl = url;
    remotesByName.set(name, remote);
  }
  return Array.from(remotesByName.values());
}

function parseGitChanges(output) {
  return String(output || "")
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(0, 200)
    .map((line) => ({
      status: line.slice(0, 2),
      path: line.slice(3),
      staged: line[0] !== " " && line[0] !== "?",
      unstaged: line[1] !== " " && line[1] !== "?",
      untracked: line.startsWith("??")
    }));
}

function parseAheadBehind(output) {
  const [aheadRaw, behindRaw] = String(output || "").trim().split(/\s+/);
  return {
    ahead: Number.parseInt(aheadRaw, 10) || 0,
    behind: Number.parseInt(behindRaw, 10) || 0
  };
}

function isGitHubRemoteUrl(remoteUrl) {
  const value = String(remoteUrl || "").trim();
  return /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+(?:\.git)?$/i.test(value)
    || /^git@github\.com:[^/\s]+\/[^/\s]+\.git$/i.test(value)
    || /^ssh:\/\/git@github\.com\/[^/\s]+\/[^/\s]+\.git$/i.test(value);
}

function commandExists(command) {
  if (!command) return false;
  const executable = process.platform === "win32" && !/\.(cmd|exe|bat)$/i.test(command)
    ? `${command}.cmd`
    : command;
  return Boolean(findOnPath(executable) || findOnPath(command));
}

function normalizeMcpArgs(args) {
  return Array.isArray(args) ? args.map((value) => String(value)) : [];
}

function missingEnvKeys(env) {
  return Object.entries(env || {})
    .filter(([, value]) => !String(value || "").trim())
    .map(([key]) => key);
}

function mcpConfigWarnings(id, args, env) {
  const warnings = [];
  const joinedArgs = normalizeMcpArgs(args).join(" ");
  if (/example\.com|<remote-url>|<connection-string>|<workspace>/i.test(joinedArgs)) {
    warnings.push("Command arguments still contain a placeholder.");
  }
  if (id === "postgres" && /postgresql:\/\/localhost\/postgres/i.test(joinedArgs)) {
    warnings.push("Postgres is using the localhost fallback connection string.");
  }
  if (id === "mcp-remote" && /example\.com/i.test(joinedArgs)) {
    warnings.push("MCP Remote needs a real MCP_REMOTE_URL before it can connect.");
  }
  if (id === "pannel" && missingEnvKeys(env).length > 0) {
    warnings.push("Panel / 1Panel needs PANEL_HOST and PANEL_ACCESS_TOKEN in the environment.");
  }
  return warnings;
}

function normalizeGitCommitMessage(message) {
  return String(message || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, 500);
}

function projectIdFromWorkspace(workspacePath) {
  const normalized = String(workspacePath || "").trim().replace(/[\\/]+$/, "");
  return normalized || "no-workspace";
}

function projectNameFromWorkspace(workspacePath) {
  const projectId = projectIdFromWorkspace(workspacePath);
  if (projectId === "no-workspace") {
    return "No workspace";
  }
  return projectId.split(/[\\/]/).filter(Boolean).pop() || projectId;
}

function sanitizeConversationMessage(message) {
  return {
    id: trimString(message?.id, 80) || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    role: message?.role === "user" ? "user" : "assistant",
    title: trimString(message?.title, 120),
    content: String(message?.content || "").slice(0, 20000)
  };
}

function sanitizeConversationStore(history) {
  const sourceProjects = Array.isArray(history?.projects) ? history.projects : [];
  const projects = [];
  const seenProjectIds = new Set();
  const seenSessionIds = new Set();

  for (const project of sourceProjects) {
    const workspacePath = String(project?.workspacePath || "");
    const fallbackProjectId = projectIdFromWorkspace(workspacePath);
    let projectId = trimString(project?.id, 240) || fallbackProjectId;
    if (seenProjectIds.has(projectId)) {
      projectId = `${projectId}-${projects.length + 1}`;
    }
    seenProjectIds.add(projectId);

    const sessions = [];
    const sourceSessions = Array.isArray(project?.sessions) ? project.sessions : [];
    for (const session of sourceSessions) {
      let sessionId = trimString(session?.id, 80);
      if (!sessionId || seenSessionIds.has(sessionId)) {
        sessionId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      }
      seenSessionIds.add(sessionId);

      const sessionWorkspace = String(session?.workspacePath || workspacePath || "");
      const createdAt = trimString(session?.createdAt, 40) || new Date().toISOString();
      sessions.push({
        id: sessionId,
        projectId,
        projectName: trimString(session?.projectName || project?.name || projectNameFromWorkspace(sessionWorkspace), 120),
        workspacePath: sessionWorkspace,
        title: trimString(session?.title, 120),
        createdAt,
        updatedAt: trimString(session?.updatedAt, 40) || createdAt,
        messages: Array.isArray(session?.messages)
          ? session.messages.slice(0, 400).map(sanitizeConversationMessage)
          : []
      });
    }

    projects.push({
      id: projectId,
      name: trimString(project?.name || projectNameFromWorkspace(workspacePath), 120),
      workspacePath,
      sessions
    });
  }

  const activeSessionId = trimString(history?.activeSessionId, 80);
  return {
    activeSessionId: seenSessionIds.has(activeSessionId) ? activeSessionId : "",
    projects
  };
}

class DeepSeekDesktopHarness extends EventEmitter {
  constructor(electronApp) {
    super();
    this.app = electronApp;
    this.terminalProcess = null;
    this.activeSession = null;
    this.lastExit = null;
  }

  userDataPath(file) {
    return path.join(this.app.getPath("userData"), file);
  }

  packageRoot() {
    return this.app.getAppPath();
  }

  bundledDeepseekPath() {
    const candidate = path.join(
      this.packageRoot(),
      "node_modules",
      "deepseek-tui",
      "bin",
      "downloads",
      binaryName("deepseek")
    );
    return unpackAsar(candidate);
  }

  readSettings() {
    try {
      const raw = fs.readFileSync(this.userDataPath("settings.json"), "utf8");
      const parsed = JSON.parse(raw);
      const safeSettings = sanitizeSettings(parsed);
      if (!parsed.mobileBridgeToken) {
        this.writeSettings(safeSettings);
      }
      return safeSettings;
    } catch {
      return this.writeSettings(defaultSettings());
    }
  }

  writeSettings(settings) {
    const safeSettings = sanitizeSettings(settings);
    fs.mkdirSync(this.app.getPath("userData"), { recursive: true });
    fs.writeFileSync(this.userDataPath("settings.json"), JSON.stringify(safeSettings, null, 2));
    return safeSettings;
  }

  readSecretStore() {
    try {
      const raw = fs.readFileSync(this.userDataPath("secrets.json"), "utf8");
      const parsed = JSON.parse(raw);
      return {
        version: SECRET_STORE_VERSION,
        apiKeys: {
          deepseek: trimSecret(parsed?.apiKeys?.deepseek),
          "nvidia-nim": trimSecret(parsed?.apiKeys?.["nvidia-nim"])
        }
      };
    } catch {
      return {
        version: SECRET_STORE_VERSION,
        apiKeys: {
          deepseek: "",
          "nvidia-nim": ""
        }
      };
    }
  }

  writeSecretStore(store) {
    const safeStore = {
      version: SECRET_STORE_VERSION,
      apiKeys: {
        deepseek: trimSecret(store?.apiKeys?.deepseek),
        "nvidia-nim": trimSecret(store?.apiKeys?.["nvidia-nim"])
      }
    };
    fs.mkdirSync(this.app.getPath("userData"), { recursive: true });
    fs.writeFileSync(this.userDataPath("secrets.json"), JSON.stringify(safeStore, null, 2), { mode: 0o600 });
    if (process.platform !== "win32") {
      try {
        fs.chmodSync(this.userDataPath("secrets.json"), 0o600);
      } catch {
        // Best effort; the app can still launch if chmod is unavailable.
      }
    }
    return safeStore;
  }

  readApiKey(provider = "deepseek") {
    const safeProvider = normalizeProvider(provider);
    return this.readSecretStore().apiKeys[safeProvider] || "";
  }

  saveApiKey(payload = {}) {
    const provider = normalizeProvider(payload.provider);
    const apiKey = trimSecret(payload.apiKey);
    const current = this.readSecretStore();
    if (!apiKey) {
      return { ok: true, provider, hasKey: Boolean(current.apiKeys[provider]) };
    }

    const next = this.writeSecretStore({
      ...current,
      apiKeys: {
        ...current.apiKeys,
        [provider]: apiKey
      }
    });
    return { ok: true, provider, hasKey: Boolean(next.apiKeys[provider]) };
  }

  readConversationHistory() {
    try {
      const raw = fs.readFileSync(this.userDataPath("history.json"), "utf8");
      return sanitizeConversationStore(JSON.parse(raw));
    } catch {
      return this.writeConversationHistory({ activeSessionId: "", projects: [] });
    }
  }

  writeConversationHistory(history) {
    const safeHistory = sanitizeConversationStore(history);
    fs.mkdirSync(this.app.getPath("userData"), { recursive: true });
    fs.writeFileSync(this.userDataPath("history.json"), JSON.stringify(safeHistory, null, 2));
    return safeHistory;
  }

  readAutomations() {
    try {
      const raw = fs.readFileSync(this.userDataPath("automations.json"), "utf8");
      return sanitizeAutomationStore(JSON.parse(raw));
    } catch {
      return this.writeAutomations({ version: AUTOMATION_STORE_VERSION, tasks: [] });
    }
  }

  writeAutomations(store) {
    const safeStore = sanitizeAutomationStore(store);
    fs.mkdirSync(this.app.getPath("userData"), { recursive: true });
    fs.writeFileSync(this.userDataPath("automations.json"), JSON.stringify(safeStore, null, 2));
    return safeStore;
  }

  automationCronPaths(task) {
    const workspacePath = normalizeWorkspace(task.workspacePath);
    const slug = slugify(task.name || task.id);
    return {
      cronPath: path.join(workspacePath, ".deepseek", "cron", `${slug}.cron`),
      logPath: path.join(workspacePath, ".deepseek", "logs", `${slug}.log`)
    };
  }

  automationCommand(task, settings) {
    const runtime = this.resolveRuntime(settings);
    const binary = runtime.selected || "deepseek";
    return {
      runtime,
      command: `${shellQuote(binary)} exec --auto ${shellQuote(task.prompt)}`
    };
  }

  writeAutomationCronFile(task, settings) {
    if (!task.name) {
      return { ok: false, error: "Automation name is required." };
    }
    if (!task.prompt) {
      return { ok: false, error: "Automation prompt is required." };
    }
    if (!validateCronSchedule(task.schedule)) {
      return { ok: false, error: "Cron schedule is invalid." };
    }

    const workspacePath = normalizeWorkspace(task.workspacePath);
    const { cronPath, logPath } = this.automationCronPaths({ ...task, workspacePath });
    const settingsForRun = normalizeSettings({ ...this.readSettings(), ...settings, workspacePath });
    const { runtime, command } = this.automationCommand(task, settingsForRun);
    const mcpConfigPath = this.writePresetMcpConfig(settingsForRun, workspacePath);
    const skillsDir = this.writePresetSkills(settingsForRun);

    fs.mkdirSync(path.dirname(cronPath), { recursive: true });
    fs.mkdirSync(path.dirname(logPath), { recursive: true });

    const envLines = [
      `SHELL=${process.platform === "win32" ? "cmd.exe" : "/bin/sh"}`,
      `PATH=${cronEnvValue(DEFAULT_PATH)}`,
      `CRON_TZ=${cronEnvValue(task.timezone || "UTC")}`,
      `DEEPSEEK_MODEL=${cronEnvValue(settingsForRun.model || DEFAULT_DEEPSEEK_MODEL)}`,
      `DEEPSEEK_BASE_URL=${cronEnvValue(settingsForRun.baseUrl || defaultBaseUrlForProvider(settingsForRun.provider))}`
    ];
    if (settingsForRun.provider && settingsForRun.provider !== "deepseek") {
      envLines.push(`DEEPSEEK_PROVIDER=${cronEnvValue(settingsForRun.provider)}`);
    }
    if (mcpConfigPath) {
      envLines.push(`DEEPSEEK_MCP_CONFIG=${cronEnvValue(mcpConfigPath)}`);
    }
    if (skillsDir) {
      envLines.push(`DEEPSEEK_SKILLS_DIR=${cronEnvValue(skillsDir)}`);
    }
    if (settingsForRun.skillsEnabled !== false && settingsForRun.enabledSkills) {
      envLines.push(`DEEPSEEK_DESKTOP_ENABLED_SKILLS=${cronEnvValue(enabledList(settingsForRun.enabledSkills).join(","))}`);
    }
    if (settingsForRun.mcpEnabled && settingsForRun.enabledMcpServers) {
      envLines.push(`DEEPSEEK_DESKTOP_ENABLED_MCP=${cronEnvValue(enabledList(settingsForRun.enabledMcpServers).join(","))}`);
    }
    if (settingsForRun.allowShell) {
      envLines.push("DEEPSEEK_ALLOW_SHELL=1");
    }
    if (settingsForRun.maxSubagents) {
      envLines.push(`DEEPSEEK_MAX_SUBAGENTS=${cronEnvValue(String(settingsForRun.maxSubagents))}`);
    }

    const cronLine = [
      task.schedule,
      "cd",
      shellQuote(workspacePath),
      "&&",
      escapeCronPercent(command),
      ">>",
      shellQuote(logPath),
      "2>&1"
    ].join(" ");

    const content = [
      "# Generated by DeepSeek TUI Desktop Automations.",
      `# Task: ${task.name}`,
      `# Task ID: ${task.id}`,
      `# Created: ${new Date().toISOString()}`,
      "# Install from the Automations panel or merge manually with `crontab -l`.",
      "# Secrets are not written here. Ensure DEEPSEEK_API_KEY is available to cron before running.",
      "",
      ...envLines,
      "",
      cronLine,
      ""
    ].join(os.EOL);
    fs.writeFileSync(cronPath, content);

    return {
      ok: true,
      task: {
        ...task,
        workspacePath,
        cronPath,
        logPath,
        commandPreview: command,
        lastGeneratedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        error: runtime.selectedExists ? "" : "Selected DeepSeek runtime does not exist."
      }
    };
  }

  saveAutomation(payload = {}) {
    const settings = sanitizeSettings({ ...this.readSettings(), ...(payload.settings || {}) });
    const store = this.readAutomations();
    const existing = store.tasks.find((task) => task.id === payload.task?.id) || {};
    const task = normalizeAutomationTask(payload.task || {}, settings, existing);
    const generated = this.writeAutomationCronFile(task, settings);
    if (!generated.ok) {
      return { ok: false, error: generated.error, tasks: store.tasks };
    }

    let storedTask = { ...generated.task, installed: Boolean(existing.installed) };
    if (existing.installed && process.platform !== "win32") {
      const current = this.crontabRead();
      if (current.ok) {
        const withoutCurrent = this.removeManagedCronBlock(current.text, storedTask.id);
        if (storedTask.enabled) {
          const block = this.managedCronBlock(storedTask);
          const nextCrontab = [withoutCurrent, block].filter(Boolean).join(os.EOL + os.EOL) + os.EOL;
          const result = this.crontabWrite(nextCrontab);
          storedTask = {
            ...storedTask,
            installed: result.status === 0,
            error: result.status === 0 ? storedTask.error : gitResultError(result, "Unable to update installed crontab entry.")
          };
        } else {
          const result = this.crontabWrite(withoutCurrent ? `${withoutCurrent}${os.EOL}` : "");
          storedTask = {
            ...storedTask,
            installed: result.status === 0 ? false : true,
            error: result.status === 0 ? "" : gitResultError(result, "Unable to remove installed crontab entry.")
          };
        }
      } else {
        storedTask = { ...storedTask, error: current.error || "Unable to read crontab." };
      }
    }

    const nextTasks = [
      storedTask,
      ...store.tasks.filter((candidate) => candidate.id !== storedTask.id)
    ].sort((a, b) => Date.parse(b.updatedAt || "") - Date.parse(a.updatedAt || ""));
    const nextStore = this.writeAutomations({ version: AUTOMATION_STORE_VERSION, tasks: nextTasks });
    return { ok: !storedTask.error, error: storedTask.error, task: storedTask, tasks: nextStore.tasks };
  }

  deleteAutomation(payload = {}) {
    const id = trimString(payload.id, 100);
    const store = this.readAutomations();
    const task = store.tasks.find((candidate) => candidate.id === id);
    const nextStore = this.writeAutomations({
      version: AUTOMATION_STORE_VERSION,
      tasks: store.tasks.filter((candidate) => candidate.id !== id)
    });
    if (task?.cronPath && task.cronPath.includes(`${path.sep}.deepseek${path.sep}cron${path.sep}`)) {
      try {
        fs.rmSync(task.cronPath, { force: true });
      } catch {
        // A missing generated file should not block deleting the local automation record.
      }
    }
    return { ok: true, tasks: nextStore.tasks };
  }

  managedCronBlock(task) {
    let content = "";
    try {
      content = fs.readFileSync(task.cronPath, "utf8").trim();
    } catch {
      return "";
    }
    return [
      `${AUTOMATION_CRON_BEGIN} ${task.id}`,
      content,
      `${AUTOMATION_CRON_END} ${task.id}`
    ].join(os.EOL);
  }

  removeManagedCronBlock(crontabText, taskId) {
    const escapedId = String(taskId || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`\\n?${AUTOMATION_CRON_BEGIN} ${escapedId}[\\s\\S]*?${AUTOMATION_CRON_END} ${escapedId}\\n?`, "g");
    return String(crontabText || "").replace(pattern, "\n").trim();
  }

  crontabRead() {
    const result = spawnSync("crontab", ["-l"], {
      encoding: "utf8",
      env: desktopEnv(),
      windowsHide: true
    });
    if (result.status === 0) {
      return { ok: true, text: result.stdout || "" };
    }
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
    if (/no crontab/i.test(output)) {
      return { ok: true, text: "" };
    }
    return { ok: false, error: gitResultError(result, "Unable to read crontab.") };
  }

  crontabWrite(content) {
    return spawnSync("crontab", ["-"], {
      input: content,
      encoding: "utf8",
      env: desktopEnv(),
      windowsHide: true
    });
  }

  installAutomation(payload = {}) {
    if (process.platform === "win32") {
      return { ok: false, error: "Cron installation is not available on Windows.", tasks: this.readAutomations().tasks };
    }
    const id = trimString(payload.id, 100);
    const store = this.readAutomations();
    const task = store.tasks.find((candidate) => candidate.id === id);
    if (!task) {
      return { ok: false, error: "Automation was not found.", tasks: store.tasks };
    }

    const generated = this.writeAutomationCronFile(task, sanitizeSettings({ ...this.readSettings(), ...(payload.settings || {}) }));
    if (!generated.ok) {
      return { ok: false, error: generated.error, tasks: store.tasks };
    }

    const current = this.crontabRead();
    if (!current.ok) {
      return { ok: false, error: current.error, tasks: store.tasks };
    }
    const block = this.managedCronBlock(generated.task);
    if (!block) {
      return { ok: false, error: "Generated cron file could not be read.", tasks: store.tasks };
    }
    const nextCrontab = [this.removeManagedCronBlock(current.text, task.id), block].filter(Boolean).join(os.EOL + os.EOL) + os.EOL;
    const result = this.crontabWrite(nextCrontab);
    if (result.status !== 0) {
      return { ok: false, error: gitResultError(result, "Unable to install crontab."), tasks: store.tasks };
    }

    const installedTask = { ...generated.task, installed: true, enabled: true, updatedAt: new Date().toISOString() };
    const nextStore = this.writeAutomations({
      version: AUTOMATION_STORE_VERSION,
      tasks: [installedTask, ...store.tasks.filter((candidate) => candidate.id !== id)]
    });
    return { ok: true, task: installedTask, tasks: nextStore.tasks };
  }

  uninstallAutomation(payload = {}) {
    if (process.platform === "win32") {
      return { ok: false, error: "Cron installation is not available on Windows.", tasks: this.readAutomations().tasks };
    }
    const id = trimString(payload.id, 100);
    const store = this.readAutomations();
    const task = store.tasks.find((candidate) => candidate.id === id);
    if (!task) {
      return { ok: false, error: "Automation was not found.", tasks: store.tasks };
    }
    const current = this.crontabRead();
    if (!current.ok) {
      return { ok: false, error: current.error, tasks: store.tasks };
    }
    const nextCrontab = this.removeManagedCronBlock(current.text, id);
    const result = this.crontabWrite(nextCrontab ? `${nextCrontab}${os.EOL}` : "");
    if (result.status !== 0) {
      return { ok: false, error: gitResultError(result, "Unable to update crontab."), tasks: store.tasks };
    }

    const nextTask = { ...task, installed: false, updatedAt: new Date().toISOString() };
    const nextStore = this.writeAutomations({
      version: AUTOMATION_STORE_VERSION,
      tasks: [nextTask, ...store.tasks.filter((candidate) => candidate.id !== id)]
    });
    return { ok: true, task: nextTask, tasks: nextStore.tasks };
  }

  rotateRemoteToken() {
    const settings = this.readSettings();
    return this.writeSettings({ ...settings, mobileBridgeToken: createRemoteToken() });
  }

  skillRoot(settings) {
    const safeSettings = sanitizeSettings({ ...this.readSettings(), ...(settings || {}) });
    return safeSettings.skillsDir ? path.resolve(safeSettings.skillsDir) : this.userDataPath("skills");
  }

  skillFilePath(settings, preset) {
    return path.join(this.skillRoot(settings), preset.dir, "SKILL.md");
  }

  customSkillFilePath(settings, skillId) {
    return path.join(this.skillRoot(settings), slugifySkillId(skillId), "SKILL.md");
  }

  readSkillTemplate(settings, id) {
    const preset = PRESET_SKILLS[id];
    const safeId = preset ? id : slugifySkillId(id);
    const filePath = preset ? this.skillFilePath(settings, preset) : this.customSkillFilePath(settings, safeId);
    try {
      const content = fs.readFileSync(filePath, "utf8");
      return {
        ...describeSkill(safeId, content, preset, "file"),
        path: filePath,
        content
      };
    } catch {
      if (!preset) {
        return null;
      }
      return {
        ...describeSkill(safeId, preset.content, preset, "default"),
        path: filePath,
        content: preset.content
      };
    }
  }

  readCustomization(settings) {
    const safeSettings = sanitizeSettings({ ...this.readSettings(), ...(settings || {}) });
    const workspacePath = normalizeWorkspace(safeSettings.workspacePath);
    const skillTemplates = {};

    const root = this.skillRoot(safeSettings);
    const skillIds = new Set([...Object.keys(PRESET_SKILLS), ...discoverSkillIds(root)]);

    for (const id of skillIds) {
      const template = this.readSkillTemplate(safeSettings, id);
      if (template) {
        skillTemplates[id] = template;
      }
    }

    let mcpConfigSource = "generated";
    let mcpConfigPath = safeSettings.mcpConfigPath || "";
    let mcpConfigText = JSON.stringify(this.buildPresetMcpConfig(safeSettings, workspacePath), null, 2);
    let mcpConfigError = "";

    if (mcpConfigPath) {
      try {
        mcpConfigText = fs.readFileSync(path.resolve(mcpConfigPath), "utf8");
        mcpConfigSource = "custom";
      } catch (error) {
        mcpConfigSource = "missing";
        mcpConfigError = error.message || "Unable to read MCP config";
      }
    }

    return {
      skillRoot: root,
      skillTemplates,
      mcpConfigPath,
      mcpConfigSource,
      mcpConfigText,
      mcpConfigError
    };
  }

  saveSkillTemplate(payload = {}) {
    const skillId = slugifySkillId(payload.skillId || payload.name || "");
    const preset = PRESET_SKILLS[skillId];
    if (!skillId) {
      return { ok: false, error: "Missing skill id" };
    }

    const settings = sanitizeSettings({ ...this.readSettings(), ...(payload.settings || {}) });
    const filePath = preset ? this.skillFilePath(settings, preset) : this.customSkillFilePath(settings, skillId);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, safeTemplateText(payload.content));
    if (preset) {
      copyPresetSupportFiles(path.dirname(filePath), preset);
    }
    const skill = this.readSkillTemplate(settings, skillId);

    return {
      ok: true,
      skill,
      path: filePath,
      skillRoot: this.skillRoot(settings)
    };
  }

  createSkillTemplate(payload = {}) {
    const settings = sanitizeSettings({ ...this.readSettings(), ...(payload.settings || {}) });
    const skillId = slugifySkillId(payload.skillId || payload.name || "custom-skill");
    const filePath = this.customSkillFilePath(settings, skillId);
    const content = createSkillContent({
      id: skillId,
      name: payload.name,
      description: payload.description,
      content: payload.content
    });
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
    return {
      ok: true,
      skill: this.readSkillTemplate(settings, skillId),
      path: filePath,
      skillRoot: this.skillRoot(settings)
    };
  }

  importSkillDirectory(payload = {}) {
    const settings = sanitizeSettings({ ...this.readSettings(), ...(payload.settings || {}) });
    const sourcePath = path.resolve(String(payload.sourcePath || ""));
    const sourceDirs = findSkillDirectories(sourcePath);
    if (!sourceDirs.length) {
      return { ok: false, error: "No SKILL.md files found in the selected directory" };
    }

    const root = this.skillRoot(settings);
    fs.mkdirSync(root, { recursive: true });
    const imported = [];
    for (const sourceDir of sourceDirs) {
      const fallback = path.basename(sourceDir);
      const sourceContent = fs.readFileSync(path.join(sourceDir, "SKILL.md"), "utf8");
      const meta = parseSkillFrontmatter(sourceContent);
      const skillId = slugifySkillId(meta.name || fallback);
      const targetDir = path.join(root, skillId);
      copySkillDirectory(sourceDir, targetDir);
      imported.push(this.readSkillTemplate(settings, skillId));
    }

    return {
      ok: true,
      skills: imported.filter(Boolean),
      path: root,
      skillRoot: root
    };
  }

  saveMcpConfig(payload = {}) {
    let parsed;
    try {
      parsed = JSON.parse(String(payload.content || ""));
    } catch (error) {
      return { ok: false, error: `Invalid MCP JSON: ${error.message}` };
    }

    const filePath = this.userDataPath("mcp.custom.json");
    fs.mkdirSync(this.app.getPath("userData"), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(parsed, null, 2));

    return {
      ok: true,
      path: filePath,
      content: JSON.stringify(parsed, null, 2)
    };
  }

  writePresetSkills(settings) {
    if (settings.skillsEnabled === false) {
      return "";
    }

    const selected = enabledList(settings.enabledSkills);
    if (selected.length === 0) {
      return settings.skillsDir || "";
    }

    const root = this.skillRoot(settings);
    fs.mkdirSync(root, { recursive: true });

    for (const id of selected) {
      const preset = PRESET_SKILLS[id];
      if (!preset) continue;
      const skillDir = path.join(root, preset.dir);
      const filePath = path.join(skillDir, "SKILL.md");
      fs.mkdirSync(skillDir, { recursive: true });
      if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, preset.content);
      }
      copyPresetSupportFiles(skillDir, preset);
    }

    return root;
  }

  buildPresetMcpConfig(settings, workspacePath) {
    const selected = enabledList(settings.enabledMcpServers);
    const servers = {};

    for (const id of selected) {
      const preset = MCP_PRESETS[id];
      if (!preset) continue;
      servers[id] = {
        command: preset.command,
        args: typeof preset.args === "function" ? preset.args(workspacePath) : preset.args,
        env: preset.env(),
        url: null,
        connect_timeout: null,
        execute_timeout: null,
        read_timeout: null,
        disabled: false,
        enabled: true,
        required: false,
        enabled_tools: [],
        disabled_tools: []
      };
    }

    return {
      timeouts: {
        connect_timeout: 10,
        execute_timeout: 60,
        read_timeout: 120
      },
      servers
    };
  }

  writePresetMcpConfig(settings, workspacePath) {
    if (!settings.mcpEnabled) {
      return "";
    }

    if (settings.mcpConfigPath) {
      return settings.mcpConfigPath;
    }

    const selected = enabledList(settings.enabledMcpServers);
    if (selected.length === 0) {
      return "";
    }

    const config = this.buildPresetMcpConfig(settings, workspacePath);
    const filePath = this.userDataPath("mcp.presets.json");
    fs.mkdirSync(this.app.getPath("userData"), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(config, null, 2));
    return filePath;
  }

  readMcpServerEntries(settings, workspacePath) {
    if (settings.mcpConfigPath) {
      const configPath = path.resolve(settings.mcpConfigPath);
      const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
      const servers = parsed?.servers && typeof parsed.servers === "object" ? parsed.servers : {};
      return {
        configPath,
        entries: Object.entries(servers).map(([id, server]) => ({
          id,
          command: String(server?.command || ""),
          args: normalizeMcpArgs(server?.args),
          env: server?.env && typeof server.env === "object" ? server.env : {}
        }))
      };
    }

    const selected = enabledList(settings.enabledMcpServers);
    return {
      configPath: "",
      entries: selected
        .map((id) => {
          const preset = MCP_PRESETS[id];
          if (!preset) return null;
          const args = typeof preset.args === "function" ? preset.args(workspacePath) : preset.args;
          return {
            id,
            command: preset.command,
            args: normalizeMcpArgs(args),
            env: preset.env()
          };
        })
        .filter(Boolean)
    };
  }

  testMcpServers(payload = {}) {
    const settings = sanitizeSettings({ ...this.readSettings(), ...(payload.settings || {}) });
    const workspacePath = normalizeWorkspace(settings.workspacePath);
    let source;
    try {
      source = this.readMcpServerEntries(settings, workspacePath);
    } catch (error) {
      return {
        ok: false,
        testedAt: new Date().toISOString(),
        configPath: settings.mcpConfigPath || "",
        servers: [],
        error: error.message || "Unable to read MCP config."
      };
    }

    const servers = source.entries.map((entry) => {
      const commandFound = commandExists(entry.command);
      const missingEnv = missingEnvKeys(entry.env);
      const warnings = [
        ...mcpConfigWarnings(entry.id, entry.args, entry.env),
        ...(commandFound ? [] : ["Command is not available in PATH."]),
        ...(missingEnv.length > 0 ? [`Missing environment variables: ${missingEnv.join(", ")}`] : [])
      ];
      return {
        id: entry.id,
        command: entry.command,
        args: entry.args,
        ok: commandFound && missingEnv.length === 0 && warnings.length === 0,
        commandFound,
        missingEnv,
        warnings
      };
    });

    return {
      ok: servers.every((server) => server.ok),
      testedAt: new Date().toISOString(),
      configPath: source.configPath,
      servers
    };
  }

  resolveRuntime(settings) {
    const custom = settings.customBinaryPath ? path.resolve(settings.customBinaryPath) : "";
    const bundled = this.bundledDeepseekPath();
    const system = findOnPath(process.platform === "win32" ? "deepseek.exe" : "deepseek");

    let selected = bundled;
    if (settings.binaryMode === "system" && system) {
      selected = system;
    }
    if (settings.binaryMode === "custom" && custom) {
      selected = custom;
    }

    return {
      selected,
      selectedExists: selected ? fs.existsSync(selected) : false,
      bundled,
      bundledExists: fs.existsSync(bundled),
      system,
      systemExists: Boolean(system),
      custom,
      customExists: custom ? fs.existsSync(custom) : false
    };
  }

  checkRuntime(partialSettings) {
    const settings = normalizeSettings({ ...this.readSettings(), ...(partialSettings || {}) });
    const runtime = this.resolveRuntime(settings);
    return {
      ...runtime,
      version: runtimeVersion(runtime.selected)
    };
  }

  gitStatus(workspacePathInput) {
    const workspacePath = normalizeWorkspace(workspacePathInput);
    const gitVersion = runGit(["--version"], workspacePath, 5000);
    if (gitVersion.error || gitVersion.status !== 0) {
      return {
        ok: false,
        error: gitResultError(gitVersion, "Git is not available in PATH."),
        workspacePath,
        repoRoot: "",
        isRepo: false,
        branch: "",
        upstream: "",
        ahead: 0,
        behind: 0,
        hasChanges: false,
        staged: 0,
        unstaged: 0,
        untracked: 0,
        remotes: [],
        originUrl: "",
        lastCommit: null,
        changes: []
      };
    }

    const rootResult = runGit(["rev-parse", "--show-toplevel"], workspacePath, 5000);
    if (rootResult.status !== 0) {
      return {
        ok: true,
        workspacePath,
        repoRoot: "",
        isRepo: false,
        branch: "",
        upstream: "",
        ahead: 0,
        behind: 0,
        hasChanges: false,
        staged: 0,
        unstaged: 0,
        untracked: 0,
        remotes: [],
        originUrl: "",
        lastCommit: null,
        changes: []
      };
    }

    const repoRoot = trimOutput(rootResult.stdout);
    const branchResult = runGit(["branch", "--show-current"], repoRoot, 5000);
    const branch = trimOutput(branchResult.stdout) || "HEAD";
    const upstreamResult = runGit(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], repoRoot, 5000);
    const upstream = upstreamResult.status === 0 ? trimOutput(upstreamResult.stdout) : "";
    const aheadBehind = upstream
      ? parseAheadBehind(runGit(["rev-list", "--left-right", "--count", "HEAD...@{u}"], repoRoot, 10000).stdout)
      : { ahead: 0, behind: 0 };
    const statusResult = runGit(["status", "--porcelain=v1", "-uall"], repoRoot, 10000);
    const changes = parseGitChanges(statusResult.stdout);
    const remotes = parseGitRemotes(runGit(["remote", "-v"], repoRoot, 5000).stdout);
    const origin = remotes.find((remote) => remote.name === "origin");
    const lastCommitResult = runGit(["log", "-1", "--pretty=format:%h%x1f%s%x1f%an%x1f%cr"], repoRoot, 5000);
    const lastCommitParts = lastCommitResult.status === 0 ? String(lastCommitResult.stdout || "").split("\x1f") : [];

    return {
      ok: true,
      workspacePath,
      repoRoot,
      isRepo: true,
      branch,
      upstream,
      ahead: aheadBehind.ahead,
      behind: aheadBehind.behind,
      hasChanges: changes.length > 0,
      staged: changes.filter((change) => change.staged).length,
      unstaged: changes.filter((change) => change.unstaged).length,
      untracked: changes.filter((change) => change.untracked).length,
      remotes,
      originUrl: origin?.pushUrl || origin?.fetchUrl || "",
      lastCommit: lastCommitParts.length >= 4
        ? {
          hash: lastCommitParts[0] || "",
          subject: lastCommitParts[1] || "",
          author: lastCommitParts[2] || "",
          date: lastCommitParts[3] || ""
        }
        : null,
      changes
    };
  }

  gitInit(workspacePathInput) {
    const workspacePath = normalizeWorkspace(workspacePathInput);
    let result = runGit(["init", "-b", "main"], workspacePath);
    if (result.status !== 0) {
      result = runGit(["init"], workspacePath);
      if (result.status === 0) {
        runGit(["branch", "-M", "main"], workspacePath, 5000);
      }
    }

    if (result.status !== 0) {
      return {
        ok: false,
        error: gitResultError(result, "Unable to initialize Git repository."),
        output: trimOutput([result.stdout, result.stderr].filter(Boolean).join("\n")),
        status: this.gitStatus(workspacePath)
      };
    }

    return {
      ok: true,
      output: trimOutput([result.stdout, result.stderr].filter(Boolean).join("\n")),
      status: this.gitStatus(workspacePath)
    };
  }

  gitSetRemote(payload = {}) {
    const workspacePath = normalizeWorkspace(payload.workspacePath);
    const remoteUrl = String(payload.remoteUrl || "").trim();
    if (!isGitHubRemoteUrl(remoteUrl)) {
      return {
        ok: false,
        error: "Use a GitHub HTTPS or SSH remote URL.",
        status: this.gitStatus(workspacePath)
      };
    }

    const status = this.gitStatus(workspacePath);
    if (!status.isRepo) {
      return { ok: false, error: "Initialize Git before setting the GitHub remote.", status };
    }

    const hasOrigin = runGit(["remote", "get-url", "origin"], status.repoRoot, 5000).status === 0;
    const result = runGit(hasOrigin ? ["remote", "set-url", "origin", remoteUrl] : ["remote", "add", "origin", remoteUrl], status.repoRoot);
    if (result.status !== 0) {
      return {
        ok: false,
        error: gitResultError(result, "Unable to save GitHub remote."),
        output: trimOutput([result.stdout, result.stderr].filter(Boolean).join("\n")),
        status: this.gitStatus(workspacePath)
      };
    }

    return {
      ok: true,
      output: trimOutput([result.stdout, result.stderr].filter(Boolean).join("\n")),
      status: this.gitStatus(workspacePath)
    };
  }

  gitRunWorkspaceAction(payload = {}, action) {
    const workspacePath = normalizeWorkspace(payload.workspacePath);
    const status = this.gitStatus(workspacePath);
    if (!status.isRepo) {
      return { ok: false, error: "Workspace is not a Git repository.", status };
    }
    if (action === "fetch" && !status.originUrl) {
      return { ok: false, error: "Set a GitHub origin remote before fetching.", status };
    }
    if (action === "pull" && !status.upstream) {
      return { ok: false, error: "Set an upstream branch before pulling.", status };
    }
    if (action === "push" && !status.originUrl) {
      return { ok: false, error: "Set a GitHub origin remote before pushing.", status };
    }

    let args = [];
    if (action === "fetch") {
      args = ["fetch", "--prune", "origin"];
    } else if (action === "pull") {
      args = ["pull", "--ff-only"];
    } else if (action === "push") {
      args = status.upstream ? ["push"] : ["push", "-u", "origin", status.branch || "main"];
    } else {
      return { ok: false, error: "Unsupported Git action.", status };
    }

    const result = runGit(args, status.repoRoot, 120000);
    return {
      ok: result.status === 0,
      error: result.status === 0 ? "" : gitResultError(result, `Git ${action} failed.`),
      output: trimOutput([result.stdout, result.stderr].filter(Boolean).join("\n")),
      status: this.gitStatus(workspacePath)
    };
  }

  gitCommit(payload = {}) {
    const workspacePath = normalizeWorkspace(payload.workspacePath);
    const message = normalizeGitCommitMessage(payload.message);
    const status = this.gitStatus(workspacePath);
    if (!status.isRepo) {
      return { ok: false, error: "Workspace is not a Git repository.", status };
    }
    if (!status.hasChanges) {
      return { ok: false, error: "There are no changes to commit.", status };
    }
    if (!message) {
      return { ok: false, error: "Commit message is required.", status };
    }

    const addResult = runGit(["add", "-A"], status.repoRoot, 120000);
    if (addResult.status !== 0) {
      return {
        ok: false,
        error: gitResultError(addResult, "Unable to stage changes."),
        output: trimOutput([addResult.stdout, addResult.stderr].filter(Boolean).join("\n")),
        status: this.gitStatus(workspacePath)
      };
    }

    const commitResult = runGit(["commit", "-m", message], status.repoRoot, 120000);
    return {
      ok: commitResult.status === 0,
      error: commitResult.status === 0 ? "" : gitResultError(commitResult, "Unable to create commit."),
      output: trimOutput([commitResult.stdout, commitResult.stderr].filter(Boolean).join("\n")),
      status: this.gitStatus(workspacePath)
    };
  }

  gitDiffSummary(payload = {}) {
    const workspacePath = normalizeWorkspace(payload.workspacePath);
    const status = this.gitStatus(workspacePath);
    if (!status.isRepo) {
      return { ok: false, error: "Workspace is not a Git repository.", status };
    }

    const unstaged = runGit(["diff", "--stat"], status.repoRoot, 10000);
    const staged = runGit(["diff", "--cached", "--stat"], status.repoRoot, 10000);
    const names = runGit(["status", "--short"], status.repoRoot, 10000);
    const sections = [];

    if (trimOutput(names.stdout)) {
      sections.push(["Changed files:", trimOutput(names.stdout)].join("\n"));
    }
    if (trimOutput(staged.stdout)) {
      sections.push(["Staged diff stat:", trimOutput(staged.stdout)].join("\n"));
    }
    if (trimOutput(unstaged.stdout)) {
      sections.push(["Unstaged diff stat:", trimOutput(unstaged.stdout)].join("\n"));
    }

    const errors = [names, staged, unstaged]
      .filter((result) => result.status !== 0)
      .map((result) => gitResultError(result, "Git diff failed."));

    if (errors.length > 0) {
      return {
        ok: false,
        error: errors[0],
        output: trimOutput(sections.join("\n\n")),
        status: this.gitStatus(workspacePath)
      };
    }

    return {
      ok: true,
      output: sections.length > 0 ? trimOutput(sections.join("\n\n")) : "No file changes to preview.",
      status: this.gitStatus(workspacePath)
    };
  }

  buildLaunchPlan(options) {
    const settings = normalizeSettings({ ...this.readSettings(), ...options });
    const workspacePath = normalizeWorkspace(settings.workspacePath);
    const runtime = this.resolveRuntime(settings);
    const args = this.buildArgs({ ...settings, workspacePath });
    const env = this.buildEnv(settings, workspacePath);
    const sessionId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

    return {
      sessionId,
      command: runtime.selected,
      args,
      cwd: workspacePath,
      env,
      runtime,
      cols: Number(settings.cols) || 120,
      rows: Number(settings.rows) || 34,
      launchAction: settings.launchAction
    };
  }

  buildArgs(options) {
    const mcpArgs = mcpFeatureArgs(options);
    switch (options.launchAction) {
      case "continue":
        return ["run", ...mcpArgs, "--workspace", options.workspacePath, "--continue"];
      case "doctor":
        return ["doctor"];
      case "setup":
        return ["setup"];
      case "mcp-init":
        return ["setup", "--mcp"];
      case "sessions":
        return ["sessions", "--limit", "50"];
      case "exec":
        return ["exec", ...mcpArgs, "--auto", options.agentPrompt || ""].filter(Boolean);
      case "plan":
        return ["exec", ...mcpArgs, "--auto", [
          "You are in Plan mode. Produce a concrete implementation plan only.",
          "Do not edit files, do not run destructive commands, and do not make external changes.",
          "Focus on steps, risks, required tools, and verification.",
          "",
          options.agentPrompt || ""
        ].join("\n")].filter(Boolean);
      case "yolo":
        return ["run", ...mcpArgs, "--workspace", options.workspacePath, "--yolo", "-p", options.agentPrompt || ""].filter(Boolean);
      case "tui":
      default:
        return ["run", ...mcpArgs, "--workspace", options.workspacePath];
    }
  }

  buildEnv(options, workspacePath) {
    const env = {
      ...desktopEnv(),
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      DEEPSEEK_DESKTOP_HARNESS: "1"
    };

    const effectiveApiKey = trimSecret(options.apiKey) || this.readApiKey(options.provider);
    if (effectiveApiKey) {
      env.DEEPSEEK_API_KEY = effectiveApiKey;
      if (options.provider === "nvidia-nim") {
        env.NVIDIA_NIM_API_KEY = effectiveApiKey;
        env.NVIDIA_API_KEY = effectiveApiKey;
      }
    }
    env.DEEPSEEK_MODEL = options.model || DEFAULT_DEEPSEEK_MODEL;
    if (options.baseUrl) {
      env.DEEPSEEK_BASE_URL = options.baseUrl;
      if (options.provider === "nvidia-nim") {
        env.NVIDIA_NIM_BASE_URL = options.baseUrl;
      }
    }
    if (options.provider && options.provider !== "deepseek") {
      env.DEEPSEEK_PROVIDER = options.provider;
    }
    const mcpConfigPath = this.writePresetMcpConfig(options, workspacePath);
    const skillsDir = this.writePresetSkills(options);
    if (mcpConfigPath) {
      env.DEEPSEEK_MCP_CONFIG = mcpConfigPath;
    }
    if (skillsDir) {
      env.DEEPSEEK_SKILLS_DIR = skillsDir;
    }
    if (options.skillsEnabled !== false && options.enabledSkills) {
      env.DEEPSEEK_DESKTOP_ENABLED_SKILLS = enabledList(options.enabledSkills).join(",");
    }
    if (options.mcpEnabled && options.enabledMcpServers) {
      env.DEEPSEEK_DESKTOP_ENABLED_MCP = enabledList(options.enabledMcpServers).join(",");
    }
    if (typeof options.allowShell === "boolean") {
      env.DEEPSEEK_ALLOW_SHELL = options.allowShell ? "1" : "0";
    }
    if (options.maxSubagents) {
      env.DEEPSEEK_MAX_SUBAGENTS = String(options.maxSubagents);
    }

    return env;
  }

  start(options) {
    if (this.terminalProcess) {
      this.stop();
    }

    const plan = this.buildLaunchPlan(options);
    if (!plan.runtime.selectedExists) {
      const runtimeHint = this.app.isPackaged
        ? "The bundled DeepSeek runtime is missing from this app package. Reinstall the app, rebuild the package, or choose a custom deepseek executable.\r\n\r\n"
        : "Run `npm install` in this desktop project to download the bundled binary, or choose a custom deepseek executable.\r\n\r\n";
      this.emit("terminal:data", [
        "\r\nDeepSeek runtime not found.\r\n",
        `Selected: ${plan.runtime.selected || "(empty)"}\r\n`,
        runtimeHint
      ].join(""));
      return { ok: false, error: "Runtime not found", runtime: plan.runtime };
    }

    const pty = require("node-pty");
    this.terminalProcess = pty.spawn(plan.command, plan.args, {
      name: "xterm-256color",
      cols: plan.cols,
      rows: plan.rows,
      cwd: plan.cwd,
      env: plan.env
    });
    this.activeSession = {
      id: plan.sessionId,
      command: plan.command,
      args: plan.args,
      cwd: plan.cwd,
      pid: this.terminalProcess.pid,
      startedAt: new Date().toISOString()
    };
    this.lastExit = null;

    this.emit("terminal:data", `\r\n[harness ${plan.sessionId}] ${plan.command} ${plan.args.join(" ")}\r\n\r\n`);

    this.terminalProcess.onData((data) => this.emit("terminal:data", data));
    this.terminalProcess.onExit((exit) => {
      const session = this.activeSession;
      this.terminalProcess = null;
      this.activeSession = null;
      this.lastExit = { ...exit, session, exitedAt: new Date().toISOString() };
      this.emit("terminal:exit", this.lastExit);
    });

    return { ok: true, runtime: plan.runtime, pid: this.terminalProcess.pid, session: this.activeSession };
  }

  stop() {
    if (this.terminalProcess) {
      this.terminalProcess.kill();
      this.terminalProcess = null;
      this.activeSession = null;
      return { ok: true };
    }
    return { ok: false };
  }

  input(data) {
    if (this.terminalProcess) {
      this.terminalProcess.write(data);
    }
  }

  resize(size) {
    if (this.terminalProcess && size && size.cols && size.rows) {
      this.terminalProcess.resize(size.cols, size.rows);
    }
  }

  getStatus() {
    return {
      running: Boolean(this.terminalProcess),
      activeSession: this.activeSession,
      lastExit: this.lastExit
    };
  }

  shutdown() {
    this.stop();
  }
}

module.exports = {
  DeepSeekDesktopHarness,
  defaultSettings
};
