import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import {
  Activity,
  Bell,
  Brain,
  Bot,
  BookOpen,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Code2,
  Copy,
  Database,
  DownloadCloud,
  FileCog,
  FolderOpen,
  Github,
  GitBranch,
  GitCommitHorizontal,
  Globe2,
  HardDrive,
  Home,
  KeyRound,
  Layers3,
  Link2,
  LogOut,
  MessageSquare,
  Palette,
  Plug,
  Plus,
  RefreshCw,
  RotateCcw,
  Send,
  Server,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Smartphone,
  Square,
  TerminalSquare,
  Trash2,
  UploadCloud,
  UserRound,
  X,
  Zap
} from "lucide-react";
import { getDesktopBridge } from "./desktopApi";
import { shouldSubmitComposerShortcut } from "./composerKeys";

type InspectorPanel = "skills" | "mcp" | "remote" | "git" | "settings" | null;
type MainView = "chat" | "tools" | "tasks" | "agents" | "terminal";
type ToolPage = "overview" | "skills" | "mcp";
type AgentMode = "plan" | "agent" | "yolo";
type StatusState =
  | { type: "ready" }
  | { type: "launching" }
  | { type: "running"; pid?: number }
  | { type: "stopped" }
  | { type: "settingsSaved" }
  | { type: "languageSaved" }
  | { type: "editorOpened"; editor: string }
  | { type: "exited"; exitCode?: number }
  | { type: "error"; message: string };

interface RunCapture {
  action: LaunchAction;
  prompt: string;
  sessionId: string;
  replyMessageId?: string;
  workspacePath: string;
  startedAt: string;
  output: string;
  thinking: string;
}

interface AutomationDraft {
  id?: string;
  name: string;
  prompt: string;
  workspacePath: string;
  minute: number;
  hour: number;
  timezone: string;
  status: AutomationStatus;
}

interface ChatMessage {
  id: string;
  role: "assistant" | "user";
  title?: string;
  content: string;
  thinking?: string;
  marked?: boolean;
  rollbackId?: string;
  createdAt?: string;
}

interface SkillPreset {
  id: string;
  name: string;
  description: string;
  icon: "zap" | "palette" | "calendar" | "download";
  category: string;
  tools: string[];
}

interface SkillCatalogItem extends SkillPreset {
  path: string;
  source: "default" | "file";
  origin: "preset" | "custom";
  content: string;
}

interface McpPreset {
  id: string;
  name: string;
  description: string;
  command: string;
  envHint: string;
  accent: "blue" | "orange" | "green" | "purple" | "red";
  category: "Coding" | "Browser" | "Data" | "Knowledge" | "Productivity" | "Remote";
  source: string;
  downloads: number;
  auth: "None" | "Token" | "Connection" | "OAuth";
  safety: "Low" | "Medium" | "High";
}

const DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const NVIDIA_NIM_BASE_URL = "https://integrate.api.nvidia.com/v1";
const DEFAULT_DEEPSEEK_MODEL = "deepseek-v4-pro";
const DEEPSEEK_V4_RELEASE_DOC_URL = "https://api-docs.deepseek.com/news/news260424";
const DEEPSEEK_MODEL_PRICING_DOC_URL = "https://api-docs.deepseek.com/quick_start/pricing/";

interface DeepSeekModelPreset {
  value: string;
  label: string;
  apiModel: string;
  docsUrl: string;
  docsLabelZh: string;
  docsLabelEn: string;
}

const defaultSettings: DesktopSettings = {
  language: "zh",
  workspacePath: "",
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
  maxSubagents: 10,
  harnessEnabled: false,
  launchAction: "tui",
  rememberWorkspace: true,
  enabledSkills: ["superpowers", "ui-ux-design", "cron-scheduler", "skill-downloader"],
  enabledMcpServers: [],
  mobileBridgeEnabled: false,
  mobileBridgeHost: "127.0.0.1",
  mobileBridgePort: 8765,
  mobileBridgeToken: "",
  mobileRemoteControlEnabled: false,
  updatePushEnabled: false
};

const skillPresets: SkillPreset[] = [
  {
    id: "superpowers",
    name: "Superpowers",
    description: "加强规划、分解任务、代码修改和自检的默认工作流。",
    icon: "zap",
    category: "Agent",
    tools: ["Plan", "Patch", "Verify"]
  },
  {
    id: "ui-ux-design",
    name: "UI/UX 设计",
    description: "为桌面端、网页和工具界面提供布局、状态和交互质量检查。",
    icon: "palette",
    category: "Design",
    tools: ["Layout", "States", "Visual QA"]
  },
  {
    id: "cron-scheduler",
    name: "Cron 高级脚本",
    description: "仅用于需要手写 crontab 文件的高级场景；普通定时任务由定时任务界面管理。",
    icon: "calendar",
    category: "定时任务",
    tools: ["Advanced", "Cron", "Logs"]
  },
  {
    id: "skill-downloader",
    name: "Skill 下载",
    description: "让 Agent 通过 curl 真实下载 Skill，保存并验证 SKILL.md，而不是手写相似内容。",
    icon: "download",
    category: "Skills",
    tools: ["Download", "Install", "Verify"]
  }
];

const mcpPresets: McpPreset[] = [
  {
    id: "playwright",
    name: "Playwright",
    description: "浏览器自动化、页面检查和端到端测试，Cursor/Claude 开发流里最常见的浏览器 MCP。",
    command: "npx -y @playwright/mcp",
    envHint: "无需 token",
    accent: "green",
    category: "Browser",
    source: "@playwright/mcp",
    downloads: 2143014,
    auth: "None",
    safety: "Medium"
  },
  {
    id: "context7",
    name: "Context7",
    description: "给 Agent 提供最新框架/库文档上下文，适合编码时查官方 API。",
    command: "npx -y @upstash/context7-mcp",
    envHint: "无需 token",
    accent: "purple",
    category: "Knowledge",
    source: "@upstash/context7-mcp",
    downloads: 1542305,
    auth: "None",
    safety: "Low"
  },
  {
    id: "filesystem",
    name: "Filesystem",
    description: "将当前 workspace 作为 MCP 文件上下文暴露给 Agent。",
    command: "npx -y @modelcontextprotocol/server-filesystem <workspace>",
    envHint: "Workspace path",
    accent: "green",
    category: "Coding",
    source: "@modelcontextprotocol/server-filesystem",
    downloads: 357283,
    auth: "None",
    safety: "High"
  },
  {
    id: "mcp-remote",
    name: "MCP Remote",
    description: "把本地-only 客户端接到远程 MCP，适合 OAuth/托管 MCP 桥接。",
    command: "npx -y mcp-remote <remote-url>",
    envHint: "MCP_REMOTE_URL",
    accent: "purple",
    category: "Remote",
    source: "mcp-remote",
    downloads: 313116,
    auth: "OAuth",
    safety: "Medium"
  },
  {
    id: "github",
    name: "GitHub",
    description: "连接仓库、Issue、PR 和代码搜索。需要 GitHub token。",
    command: "npx -y @modelcontextprotocol/server-github",
    envHint: "GITHUB_PERSONAL_ACCESS_TOKEN",
    accent: "blue",
    category: "Coding",
    source: "@modelcontextprotocol/server-github",
    downloads: 109525,
    auth: "Token",
    safety: "High"
  },
  {
    id: "postgres",
    name: "Postgres",
    description: "只读/查询 PostgreSQL 数据库结构和数据，适合全栈项目排查。",
    command: "npx -y @modelcontextprotocol/server-postgres <connection-string>",
    envHint: "POSTGRES_CONNECTION_STRING",
    accent: "blue",
    category: "Data",
    source: "@modelcontextprotocol/server-postgres",
    downloads: 96218,
    auth: "Connection",
    safety: "High"
  },
  {
    id: "sequential-thinking",
    name: "Sequential Thinking",
    description: "分步骤推理/规划工具，适合复杂调试和方案拆解。",
    command: "npx -y @modelcontextprotocol/server-sequential-thinking",
    envHint: "无需 token",
    accent: "purple",
    category: "Knowledge",
    source: "@modelcontextprotocol/server-sequential-thinking",
    downloads: 90477,
    auth: "None",
    safety: "Low"
  },
  {
    id: "memory",
    name: "Memory",
    description: "知识图谱式长期记忆，适合跨会话保存项目事实。",
    command: "npx -y @modelcontextprotocol/server-memory",
    envHint: "本地存储",
    accent: "purple",
    category: "Knowledge",
    source: "@modelcontextprotocol/server-memory",
    downloads: 65339,
    auth: "None",
    safety: "Medium"
  },
  {
    id: "slack",
    name: "Slack",
    description: "读取/发送 Slack 工作区信息，适合团队协作场景。",
    command: "npx -y @modelcontextprotocol/server-slack",
    envHint: "SLACK_BOT_TOKEN, SLACK_TEAM_ID",
    accent: "purple",
    category: "Productivity",
    source: "@modelcontextprotocol/server-slack",
    downloads: 56071,
    auth: "Token",
    safety: "High"
  },
  {
    id: "notion",
    name: "Notion",
    description: "官方 Notion MCP，可读取和管理 Notion 页面/数据库。",
    command: "npx -y @notionhq/notion-mcp-server",
    envHint: "NOTION_TOKEN",
    accent: "red",
    category: "Productivity",
    source: "@notionhq/notion-mcp-server",
    downloads: 52740,
    auth: "Token",
    safety: "High"
  },
  {
    id: "sentry",
    name: "Sentry",
    description: "官方 Sentry MCP，用于读取错误、项目和事件上下文。",
    command: "npx -y @sentry/mcp-server",
    envHint: "SENTRY_ACCESS_TOKEN",
    accent: "purple",
    category: "Coding",
    source: "@sentry/mcp-server",
    downloads: 50170,
    auth: "Token",
    safety: "Medium"
  },
  {
    id: "figma",
    name: "Figma Developer",
    description: "让 Agent 读取 Figma 设计数据，辅助实现 UI。",
    command: "npx -y figma-developer-mcp",
    envHint: "FIGMA_API_KEY",
    accent: "red",
    category: "Productivity",
    source: "figma-developer-mcp",
    downloads: 40225,
    auth: "Token",
    safety: "Medium"
  },
  {
    id: "stripe",
    name: "Stripe",
    description: "官方 Stripe MCP，适合支付、订阅、发票和客户数据操作。",
    command: "npx -y @stripe/mcp",
    envHint: "STRIPE_SECRET_KEY",
    accent: "blue",
    category: "Data",
    source: "@stripe/mcp",
    downloads: 37775,
    auth: "Token",
    safety: "High"
  },
  {
    id: "puppeteer",
    name: "Puppeteer",
    description: "传统浏览器自动化 MCP，适合截图、抓取和表单流程。",
    command: "npx -y @modelcontextprotocol/server-puppeteer",
    envHint: "无需 token",
    accent: "green",
    category: "Browser",
    source: "@modelcontextprotocol/server-puppeteer",
    downloads: 28205,
    auth: "None",
    safety: "Medium"
  },
  {
    id: "brave-search",
    name: "Brave Search",
    description: "Web 搜索 MCP，适合需要外部搜索但不想接浏览器时使用。",
    command: "npx -y @modelcontextprotocol/server-brave-search",
    envHint: "BRAVE_API_KEY",
    accent: "orange",
    category: "Knowledge",
    source: "@modelcontextprotocol/server-brave-search",
    downloads: 24872,
    auth: "Token",
    safety: "Low"
  },
  {
    id: "google-maps",
    name: "Google Maps",
    description: "地理位置、路线和地点查询 MCP。",
    command: "npx -y @modelcontextprotocol/server-google-maps",
    envHint: "GOOGLE_MAPS_API_KEY",
    accent: "green",
    category: "Data",
    source: "@modelcontextprotocol/server-google-maps",
    downloads: 9335,
    auth: "Token",
    safety: "Medium"
  },
  {
    id: "pannel",
    name: "Panel / 1Panel",
    description: "1Panel 服务器面板管理 MCP，适合网站、数据库、应用和面板状态读取。",
    command: "mcp-1panel",
    envHint: "PANEL_HOST, PANEL_ACCESS_TOKEN",
    accent: "orange",
    category: "Remote",
    source: "github.com/1Panel-dev/mcp-1panel",
    downloads: 0,
    auth: "Token",
    safety: "High"
  }
];

const modelPresets: DeepSeekModelPreset[] = [
  {
    value: "deepseek-v4-pro",
    label: "DeepSeek v4 Pro",
    apiModel: "deepseek-v4-pro",
    docsUrl: `${DEEPSEEK_V4_RELEASE_DOC_URL}#deepseek-v4-pro`,
    docsLabelZh: "DeepSeek v4 Pro 官方文档",
    docsLabelEn: "DeepSeek v4 Pro docs"
  },
  {
    value: "deepseek-v4-pro-1m",
    label: "DeepSeek v4 Pro 1M",
    apiModel: "deepseek-v4-pro",
    docsUrl: `${DEEPSEEK_MODEL_PRICING_DOC_URL}#model-details`,
    docsLabelZh: "DeepSeek v4 Pro 1M 官方文档",
    docsLabelEn: "DeepSeek v4 Pro 1M docs"
  },
  {
    value: "deepseek-v4-flash",
    label: "DeepSeek v4 Flash",
    apiModel: "deepseek-v4-flash",
    docsUrl: `${DEEPSEEK_V4_RELEASE_DOC_URL}#deepseek-v4-flash`,
    docsLabelZh: "DeepSeek v4 Flash 官方文档",
    docsLabelEn: "DeepSeek v4 Flash docs"
  },
  {
    value: "deepseek-v4-flash-1m",
    label: "DeepSeek v4 Flash 1M",
    apiModel: "deepseek-v4-flash",
    docsUrl: `${DEEPSEEK_MODEL_PRICING_DOC_URL}#model-details`,
    docsLabelZh: "DeepSeek v4 Flash 1M 官方文档",
    docsLabelEn: "DeepSeek v4 Flash 1M docs"
  }
];

function findModelPreset(model: string) {
  return modelPresets.find((preset) => preset.value === model);
}

function normalizeDeepSeekModelSelection(model: string) {
  const value = String(model || "").trim();
  if (findModelPreset(value)) {
    return value;
  }
  if (value === "deepseek-chat" || value === "deepseek-reasoner") {
    return "deepseek-v4-flash";
  }
  return DEFAULT_DEEPSEEK_MODEL;
}

function modelPresetForValue(model: string) {
  return findModelPreset(normalizeDeepSeekModelSelection(model)) || modelPresets[0];
}

function apiModelForProvider(provider: ProviderMode, model: string) {
  if (provider === "nvidia-nim") {
    return model || DEFAULT_DEEPSEEK_MODEL;
  }
  return modelPresetForValue(model).apiModel;
}

const uiCopy = {
  zh: {
    status: {
      ready: "就绪",
      checking: "检查中",
      missing: "缺失",
      runtimeReady: "就绪",
      launching: "正在启动",
      runningPid: (pid?: number) => pid ? `运行中 pid ${pid}` : "运行中",
      launchFailed: "启动失败",
      stopped: "已停止",
      settingsSaved: "设置已保存",
      languageSaved: "语言已切换",
      editorOpened: (editor: string) => `已打开 ${editor}`,
      exited: (exitCode?: number) => `已退出 ${exitCode ?? ""}`.trim()
    },
    welcome: {
      title: "DeepSeek TUI Desktop",
      content: "选择项目目录后可以直接开始对话。模型和运行模式可以在主界面切换。"
    },
    newConversation: {
      title: "新对话",
      content: "选择 workspace 后输入任务即可开始。"
    },
    promptResult: {
      planTitle: "Plan",
      harnessTitle: "Agent",
      yoloTitle: "YOLO",
      planContent: "正在规划。",
      execContent: "正在处理。",
      yoloContent: "正在处理。"
    },
    runSummary: {
      title: "回复",
      status: "状态",
      mode: "模式",
      workspace: "Workspace",
      started: "开始时间",
      terminal: "过程摘要",
      success: "完成",
      failed: "失败",
      noOutput: "已完成。",
      failedShort: "未完成，请查看过程面板。",
      completedShort: "已完成。"
    },
    sidebar: {
      subtitle: "Desktop",
      newChat: "新对话",
      navLabel: "对话列表",
      assistant: "DeepSeek 编程助手",
      automations: "定时任务",
      remote: "手机控制",
      git: "GitHub 版本",
      settings: "设置"
    },
    history: {
      noProject: "未选择项目",
      untitled: "新会话",
      empty: "暂无历史会话",
      deleteSession: "删除会话",
      selectProject: "选中项目",
      newProjectSession: "在此项目中新建对话",
      sessions: (count: number) => `${count} 个会话`
    },
    topbar: {
      title: "DeepSeek 编程对话",
      noWorkspace: "未选择 workspace",
      viewSwitch: "界面视图切换",
	      chat: "对话",
	      tools: "工具",
	      agents: "Agents",
	      tasks: "定时任务",
	      terminal: "过程",
      checkRuntime: "检查运行环境",
      chooseWorkspace: "选择 workspace",
      currentBranch: "当前分支",
      noBranch: "未检测到分支",
      openCursor: "导出到 Cursor",
      apiKeySaved: "API Key 已保存",
      apiKeyMissing: "设置 API Key",
      remoteStopped: "手机控制未启动"
    },
    tools: {
      enabledMcp: "已选择 MCP",
      enabledSkills: "已启用 Skills",
      enabledAutomations: "运行中定时任务",
      installablePresets: "可安装预设",
      automationsDesc: "只保留每天几点运行、任务内容、工作区和启用状态。",
      manageAutomations: "管理定时任务",
      mcpStatus: "MCP 工具状态",
      mcpStatusDesc: "MCP 是给 Agent 接入浏览器、GitHub、数据库等外部工具的配置。需要 token 的工具只提示环境变量名，桌面端不保存密钥。",
      manageMcp: "管理 MCP",
      off: "关闭",
      enabled: "已启用",
      selected: "已选择",
      skillsDesc: "Skills 是可新增、导入和勾选的 Markdown 指令，告诉 Agent 遇到某类任务时该怎么做。",
      manageSkills: "管理 Skills"
    },
	    terminal: {
	      clear: "清空过程",
	      stop: "停止",
	      bootReady: "过程面板已就绪。\r\n",
	      bootHint: "运行过程会显示在这里。\r\n\r\n"
	    },
	    runtimeAgents: {
	      title: "Agent 运行状态",
	      subtitle: "结构化状态来自 runtime API；不可用时由终端事件兜底生成。",
	      status: "状态",
	      source: "来源",
	      mode: "模式",
	      workspace: "Workspace",
	      started: "开始",
	      noAgents: "还没有检测到子 Agent。",
	      recentEvents: "最近事件",
	      noEvents: "暂无运行事件。",
	      counts: (running: number, completed: number, failed: number) => `${running} 运行 / ${completed} 完成 / ${failed} 失败`,
	      statuses: {
	        idle: "空闲",
	        running: "运行中",
	        completed: "已完成",
	        failed: "失败",
	        stopped: "已停止",
	        queued: "排队中",
	        cancelled: "已取消"
	      }
	    },
	    composer: {
      modeLabel: "运行模式",
      modelLabel: "模型",
      harness: "过程流",
      harnessHint: "打开显示过程面板并启用 DeepSeek 思考流；关闭会停止当前过程并关闭思考流。",
      stop: "停止",
      planPlaceholder: "描述目标，Plan 模式只会输出计划，不改文件...",
      execPlaceholder: "给 Agent 模式一个编程任务...",
      yoloPlaceholder: "给 YOLO 模式一个高权限任务..."
    },
    inspector: {
      titles: {
        skills: "Skills",
        mcp: "MCP 预设",
        automations: "定时任务",
        remote: "手机控制",
        git: "GitHub 版本",
        settings: "设置"
      },
      subtitles: {
        skills: "新增、导入并勾选启动时加载的 Skill",
        mcp: "勾选预设，也可以新增自定义 MCP",
        automations: "创建、启用和暂停每天运行的本机定时任务",
        remote: "手机查看进度、远程控制和更新提醒",
        git: "查看分支、远程仓库、变更、提交和推送",
        settings: "Workspace、运行环境和 Agent 参数"
      },
      close: "关闭"
    },
    skills: {
      customDirPlaceholder: "可选：自定义 skills 目录",
      chooseDir: "选择 skills 目录",
      save: "保存 Skills",
      enableRuntime: "启动时注入 Skills",
      runtimeHint: "关闭后仍可新增和导入 Skill，但启动运行时不会加载这些 Skill。",
      createTitle: "新增 Skill",
      createName: "名称",
      createNamePlaceholder: "例如：日报检查",
      createDescription: "触发条件",
      createDescriptionPlaceholder: "Use when...",
      createSkill: "新增 Skill",
      importSkill: "导入 Skills",
      importFailed: "导入失败",
      created: (path: string) => `Skill 已新增：${path}`,
      imported: (count: number) => `已导入 ${count} 个 Skill`,
      saveFailed: "Skill 保存失败",
      customCategory: "自定义",
      defaultTag: "默认",
      fileTag: "文件"
    },
    mcp: {
      helpTitle: "MCP 是什么",
      helpBody: "MCP 可以理解为 Agent 的工具插座。这里默认只是选择预设和新增自定义 MCP；只有打开“启动时启用 MCP 接口”后，启动运行时才会注入这些 MCP。",
      searchPlaceholder: "搜索 MCP、命令、分类...",
      summaryEnabled: (count: number) => `${count} 已选择`,
      summaryVisible: (count: number) => `${count} 可见`,
      summaryInstalled: (count: number) => `${count} 个内置预设`,
      customConfigPlaceholder: "可选：使用已有 MCP JSON 文件",
      chooseConfig: "选择 MCP 配置",
      save: "保存 MCP",
      enableRuntime: "启动时启用 MCP 接口",
      runtimeHint: "默认关闭。关闭时可以选择、新增和预检，但不会设置 DEEPSEEK_MCP_CONFIG，也不会启动 MCP 服务。",
      runtimeOn: "启动时会注入 MCP",
      runtimePending: "MCP 接口已打开，但还没有可注入的配置",
      runtimeOff: "启动时不会注入 MCP",
      riskSuffix: "风险",
      sourceCustom: "来自自定义 JSON",
      configFailed: "MCP JSON 保存失败",
      test: "预检 MCP",
      testing: "正在预检 MCP...",
      testOk: "MCP 预检通过",
      testFailed: "MCP 预检发现问题",
      noServers: "当前没有选择 MCP 服务器，也没有自定义 MCP JSON。",
      customTitle: "新增 MCP",
      customHint: "填写一个 command 型或 URL 型 MCP，新增后会直接保存为自定义 MCP 配置。",
      customId: "服务器 ID",
      customIdPlaceholder: "例如：my-server",
      customCommand: "Command",
      customCommandPlaceholder: "npx / node / uvx / python",
      customArgs: "Args",
      customArgsPlaceholder: "-y\n@modelcontextprotocol/server-memory",
      customUrl: "URL",
      customUrlPlaceholder: "https://example.com/mcp",
      customEnv: "Env JSON",
      customEnvPlaceholder: "{\"TOKEN\":\"\"}",
      addCustom: "新增 MCP",
      customAdded: (id: string) => `已新增 MCP：${id}`,
      customInvalidId: "服务器 ID 只能包含字母、数字、点、下划线和横线。",
      customMissingTarget: "请填写 Command 或 URL。",
      customInvalidJson: "MCP JSON 或 Env JSON 格式不正确。"
    },
    git: {
      repoReady: "Git 仓库已连接",
      notRepoTitle: "当前 workspace 还不是 Git 仓库",
      notRepoBody: "初始化后才能绑定 GitHub remote、提交和推送。",
      repoRoot: "仓库根目录",
      branch: "分支",
      upstream: "上游",
      remote: "GitHub remote",
      noRemote: "未设置 origin",
      remotePlaceholder: "https://github.com/owner/repo.git 或 git@github.com:owner/repo.git",
      init: "初始化 Git",
      saveRemote: "保存 remote",
      copyRemote: "复制 remote",
      refresh: "刷新",
      fetch: "Fetch",
      pull: "Pull",
      push: "Push",
      changes: "变更",
      noChanges: "工作区干净",
      staged: "已暂存",
      unstaged: "未暂存",
      untracked: "未跟踪",
      commitMessage: "提交信息",
      commitPlaceholder: "描述这次修改",
      commit: "Stage all + Commit",
      preview: "预览提交范围",
      previewTitle: "提交前预览",
      previewOk: "已生成提交前预览",
      lastCommit: "最近提交",
      noCommit: "暂无提交",
      aheadBehind: (ahead: number, behind: number) => `ahead ${ahead} / behind ${behind}`,
      initOk: "Git 仓库已初始化",
      remoteOk: "GitHub remote 已保存",
      fetchOk: "Fetch 完成",
      pullOk: "Pull 完成",
      pushOk: "Push 完成",
      commitOk: "Commit 已创建",
      copied: "Remote 已复制",
      actionFailed: "Git 操作失败"
    },
    automations: {
      helpTitle: "定时任务",
      helpBody: "设置一个每天自动运行的 Agent 任务。界面只保留任务内容、工作区、运行时间和启用状态。",
      newTask: "新建定时任务",
      taskName: "任务名称",
      taskNamePlaceholder: "例如：每日项目巡检",
      prompt: "任务内容",
      promptPlaceholder: "例如：每天检查这个项目并总结需要处理的问题。",
      workspace: "Workspace",
      chooseWorkspace: "选择 workspace",
      daily: "每天",
      scheduleTime: "运行时间",
      timezone: "时区",
      status: "状态",
      enableTask: "启用这个定时任务",
      active: "已启用",
      paused: "已暂停",
      schedulePreview: "计划",
      save: "保存定时任务",
      install: "启用",
      uninstall: "暂停",
      delete: "删除",
      installed: "已启用",
      generated: "已保存",
      draft: "已暂停",
      listTitle: "已有定时任务",
      noTasks: "还没有定时任务。",
      localRunner: "本机执行",
      logFile: "日志文件",
      command: "运行命令",
      lastGenerated: "更新时间",
      lastInstalled: "启用时间",
      saved: "定时任务已保存",
      installedOk: "定时任务已启用",
      uninstalledOk: "定时任务已暂停",
      deletedOk: "定时任务已删除",
      confirmDelete: "删除这个定时任务？",
      failed: "定时任务操作失败"
    },
    remote: {
      accountTitle: "手机控制账号",
      accountLoggedOut: "未登录推送账号",
      accountPlaceholder: "邮箱 / 用户 ID",
      displayNamePlaceholder: "显示名称（可选）",
      login: "登录并绑定桌面端",
      logout: "退出登录",
      pairTitle: "手机配对",
      pairHint: "手机端使用同一账号和配对码完成绑定。",
      startPairing: "生成配对码",
      pairingCode: "配对码",
      pairingExpires: "过期时间",
      noDevices: "暂无已配对手机",
      pairedDevices: "已配对手机",
      revokeDevice: "移除设备",
      loginRequired: "请先登录推送账号",
      loginSaved: "推送账号已登录",
      logoutSaved: "已退出推送账号",
      pairingStarted: "配对码已生成",
      pairingFailed: "配对码生成失败",
      deviceRevoked: "设备已移除",
      enableMobile: "启用手机控制",
      allowControl: "允许手机下发控制指令",
      allowUpdates: "允许自动更新推送通知",
      bridgeRunning: "手机控制已运行",
      bridgeStopped: "手机控制未启动",
      tokenRequired: "手机控制需要访问密钥。",
      connectionAddress: "连接地址",
      accessKey: "访问密钥",
      copyLanUrl: "复制连接地址",
      copyToken: "复制访问密钥",
      saveApply: "保存手机控制",
      restart: "重启",
      rotateToken: "更换访问密钥",
      testUpdate: "测试更新推送",
      saved: "手机控制配置已保存",
      running: "手机控制已运行",
      stopped: "手机控制未启动",
      tokenUpdated: "访问密钥已更新",
      statusLabel: "手机控制",
      testUpdateTitle: "DeepSeek TUI Desktop 更新",
      testUpdateBody: "自动更新推送通知接口已可用。",
      testUpdateSent: "已发送测试更新通知",
      testUpdateFailed: "更新通知发送失败",
      copied: (label: string) => `${label} 已复制`
    },
    settings: {
      language: "界面语言",
      languageHint: "切换后立即保存并应用到界面。",
      chinese: "中文",
      english: "English",
      chooseWorkspace: "选择 workspace",
      openCursor: "打开 Cursor",
      openVSCode: "打开 VS Code",
      chooseBinary: "选择 binary",
      customDeepseekPath: "Custom deepseek path",
      provider: "Provider",
      model: "Model",
      modelDoc: "官方文档",
      apiModel: (model: string) => `API model：${model}`,
      baseUrl: "Base URL",
      apiKey: "DeepSeek API Key（全局）",
      apiKeyHint: "保存后作为全局登录密钥，之后所有 workspace 默认使用；不会写入项目历史。",
      deepseekKeyPlaceholder: "粘贴 DeepSeek API Key",
      nvidiaKeyPlaceholder: "粘贴 NVIDIA NIM API Key",
      allowShell: "Allow shell",
      agents: "Agents",
      harnessMode: "过程流式输出",
      harnessHint: "开启后显示过程面板并启用 DeepSeek thinking；关闭后下一次请求会以 reasoning_effort=off 启动。",
      setup: "Setup",
      apiKeySaveFailed: "API Key 保存失败",
      save: "保存设置"
    },
    category: {
      All: "全部",
      Coding: "编码",
      Browser: "浏览器",
      Data: "数据",
      Knowledge: "知识",
      Productivity: "效率",
      Remote: "远程"
    },
    auth: {
      None: "无需认证",
      Token: "Token",
      Connection: "连接串",
      OAuth: "OAuth"
    },
    safety: {
      Low: "低",
      Medium: "中",
      High: "高"
    },
    downloadsCommunity: "社区"
  },
  en: {
    status: {
      ready: "Ready",
      checking: "Checking",
      missing: "Missing",
      runtimeReady: "Ready",
      launching: "Launching",
      runningPid: (pid?: number) => pid ? `Running pid ${pid}` : "Running",
      launchFailed: "Launch failed",
      stopped: "Stopped",
      settingsSaved: "Settings saved",
      languageSaved: "Language switched",
      editorOpened: (editor: string) => `Opened ${editor}`,
      exited: (exitCode?: number) => `Exited ${exitCode ?? ""}`.trim()
    },
    welcome: {
      title: "DeepSeek TUI Desktop",
      content: "Choose a project folder to start chatting. Model and run mode can be changed on the main screen."
    },
    newConversation: {
      title: "New chat",
      content: "Choose a workspace, then enter a task to begin."
    },
    promptResult: {
      planTitle: "Plan",
      harnessTitle: "Agent",
      yoloTitle: "YOLO",
      planContent: "Planning.",
      execContent: "Working.",
      yoloContent: "Working."
    },
    runSummary: {
      title: "Reply",
      status: "Status",
      mode: "Mode",
      workspace: "Workspace",
      started: "Started",
      terminal: "Process excerpt",
      success: "Completed",
      failed: "Failed",
      noOutput: "Completed.",
      failedShort: "Not completed. See the process panel.",
      completedShort: "Completed."
    },
    sidebar: {
      subtitle: "Desktop",
      newChat: "New chat",
      navLabel: "Conversations",
      assistant: "DeepSeek coding assistant",
      automations: "Scheduled Tasks",
      remote: "Mobile Control",
      git: "GitHub Versions",
      settings: "Settings"
    },
    history: {
      noProject: "No project",
      untitled: "New session",
      empty: "No saved sessions",
      deleteSession: "Delete session",
      selectProject: "Select project",
      newProjectSession: "New chat in this project",
      sessions: (count: number) => `${count} sessions`
    },
    topbar: {
      title: "DeepSeek coding chat",
      noWorkspace: "No workspace selected",
      viewSwitch: "UI view switch",
	      chat: "Chat",
	      tools: "Tools",
	      agents: "Agents",
	      tasks: "Tasks",
	      terminal: "Process",
      checkRuntime: "Check runtime",
      chooseWorkspace: "Choose workspace",
      currentBranch: "Current branch",
      noBranch: "No branch detected",
      openCursor: "Export to Cursor",
      apiKeySaved: "API Key saved",
      apiKeyMissing: "Set API Key",
      remoteStopped: "Mobile control stopped"
    },
    tools: {
      enabledMcp: "Selected MCP",
      enabledSkills: "Enabled Skills",
      enabledAutomations: "Active scheduled tasks",
      installablePresets: "Installable presets",
      automationsDesc: "Keep only the task prompt, workspace, daily run time, and active status.",
      manageAutomations: "Manage scheduled tasks",
      mcpStatus: "MCP tool status",
      mcpStatusDesc: "MCP connects the Agent to external tools such as browsers, GitHub, and databases. Token-based tools show env-var names only; this app does not save secrets.",
      manageMcp: "Manage MCP",
      off: "Off",
      enabled: "Enabled",
      selected: "Selected",
      skillsDesc: "Skills are Markdown instructions you can create, import, and enable for specific work.",
      manageSkills: "Manage Skills"
    },
	    terminal: {
	      clear: "Clear process",
	      stop: "Stop",
	      bootReady: "Process panel is ready.\r\n",
	      bootHint: "Run progress will appear here.\r\n\r\n"
	    },
	    runtimeAgents: {
	      title: "Agent Runtime",
	      subtitle: "Structured state uses the runtime API when available and falls back to terminal events.",
	      status: "Status",
	      source: "Source",
	      mode: "Mode",
	      workspace: "Workspace",
	      started: "Started",
	      noAgents: "No sub-agents detected yet.",
	      recentEvents: "Recent events",
	      noEvents: "No runtime events yet.",
	      counts: (running: number, completed: number, failed: number) => `${running} running / ${completed} completed / ${failed} failed`,
	      statuses: {
	        idle: "Idle",
	        running: "Running",
	        completed: "Completed",
	        failed: "Failed",
	        stopped: "Stopped",
	        queued: "Queued",
	        cancelled: "Cancelled"
	      }
	    },
	    composer: {
      modeLabel: "Run mode",
      modelLabel: "Model",
      harness: "Process Stream",
      harnessHint: "Show the process panel and enable DeepSeek thinking output; turning it off stops the current run and disables thinking output.",
      stop: "Stop",
      planPlaceholder: "Describe the goal. Plan mode will only produce a plan and will not edit files...",
      execPlaceholder: "Give Agent mode a coding task...",
      yoloPlaceholder: "Give YOLO mode a high-permission task..."
    },
    inspector: {
      titles: {
        skills: "Skills",
        mcp: "MCP presets",
        automations: "Scheduled Tasks",
        remote: "Mobile Control",
        git: "GitHub Versions",
        settings: "Settings"
      },
      subtitles: {
        skills: "Create, import, and enable launch-time Skills",
        mcp: "Enable presets or add custom MCP servers",
        automations: "Create, activate, and pause local daily scheduled tasks",
        remote: "Mobile progress, controls, and update alerts",
        git: "View branches, remotes, changes, commits, and pushes",
        settings: "Workspace, runtime, and Agent parameters"
      },
      close: "Close"
    },
    skills: {
      customDirPlaceholder: "Optional: custom skills directory",
      chooseDir: "Choose skills directory",
      save: "Save Skills",
      enableRuntime: "Inject Skills on launch",
      runtimeHint: "When off, you can still create and import Skills, but the runtime will not load them at launch.",
      createTitle: "New Skill",
      createName: "Name",
      createNamePlaceholder: "Daily report check",
      createDescription: "Trigger",
      createDescriptionPlaceholder: "Use when...",
      createSkill: "Create Skill",
      importSkill: "Import Skills",
      importFailed: "Import failed",
      created: (path: string) => `Skill created: ${path}`,
      imported: (count: number) => `${count} Skill${count === 1 ? "" : "s"} imported`,
      saveFailed: "Skill save failed",
      customCategory: "Custom",
      defaultTag: "Default",
      fileTag: "File"
    },
    mcp: {
      helpTitle: "What MCP Does",
      helpBody: "MCP is a tool socket for the Agent. This panel selects presets and adds custom MCP servers; the runtime only receives MCP after you turn on launch-time MCP.",
      searchPlaceholder: "Search MCP, commands, categories...",
      summaryEnabled: (count: number) => `${count} selected`,
      summaryVisible: (count: number) => `${count} visible`,
      summaryInstalled: (count: number) => `${count} built-in presets`,
      customConfigPlaceholder: "Optional: use an existing MCP JSON file",
      chooseConfig: "Choose MCP config",
      save: "Save MCP",
      enableRuntime: "Enable MCP at launch",
      runtimeHint: "Off by default. You can still select, add, and preflight MCP servers, but DEEPSEEK_MCP_CONFIG is not set and services are not started.",
      runtimeOn: "MCP will be injected at launch",
      runtimePending: "MCP is on, but no injectable config is selected yet",
      runtimeOff: "MCP will not be injected at launch",
      riskSuffix: "risk",
      sourceCustom: "Loaded from custom JSON",
      configFailed: "MCP JSON save failed",
      test: "Preflight MCP",
      testing: "Checking MCP...",
      testOk: "MCP preflight passed",
      testFailed: "MCP preflight found issues",
      noServers: "No MCP servers are selected and no custom MCP JSON is set.",
      customTitle: "Add MCP",
      customHint: "Add a command-based or URL-based MCP server and save it directly as the custom MCP config.",
      customId: "Server ID",
      customIdPlaceholder: "my-server",
      customCommand: "Command",
      customCommandPlaceholder: "npx / node / uvx / python",
      customArgs: "Args",
      customArgsPlaceholder: "-y\n@modelcontextprotocol/server-memory",
      customUrl: "URL",
      customUrlPlaceholder: "https://example.com/mcp",
      customEnv: "Env JSON",
      customEnvPlaceholder: "{\"TOKEN\":\"\"}",
      addCustom: "Add MCP",
      customAdded: (id: string) => `MCP added: ${id}`,
      customInvalidId: "Server ID can only use letters, numbers, dots, underscores, and hyphens.",
      customMissingTarget: "Enter a Command or URL.",
      customInvalidJson: "MCP JSON or Env JSON is invalid."
    },
    git: {
      repoReady: "Git repository connected",
      notRepoTitle: "Current workspace is not a Git repository",
      notRepoBody: "Initialize Git before binding a GitHub remote, committing, or pushing.",
      repoRoot: "Repository root",
      branch: "Branch",
      upstream: "Upstream",
      remote: "GitHub remote",
      noRemote: "No origin remote",
      remotePlaceholder: "https://github.com/owner/repo.git or git@github.com:owner/repo.git",
      init: "Initialize Git",
      saveRemote: "Save remote",
      copyRemote: "Copy remote",
      refresh: "Refresh",
      fetch: "Fetch",
      pull: "Pull",
      push: "Push",
      changes: "Changes",
      noChanges: "Working tree clean",
      staged: "Staged",
      unstaged: "Unstaged",
      untracked: "Untracked",
      commitMessage: "Commit message",
      commitPlaceholder: "Describe this change",
      commit: "Stage all + Commit",
      preview: "Preview commit scope",
      previewTitle: "Pre-commit Preview",
      previewOk: "Generated pre-commit preview",
      lastCommit: "Last commit",
      noCommit: "No commits yet",
      aheadBehind: (ahead: number, behind: number) => `ahead ${ahead} / behind ${behind}`,
      initOk: "Git repository initialized",
      remoteOk: "GitHub remote saved",
      fetchOk: "Fetch complete",
      pullOk: "Pull complete",
      pushOk: "Push complete",
      commitOk: "Commit created",
      copied: "Remote copied",
      actionFailed: "Git action failed"
    },
    automations: {
      helpTitle: "Scheduled Tasks",
      helpBody: "Set up one Agent task that runs automatically every day. The interface only keeps the task prompt, workspace, run time, and active status.",
      newTask: "New scheduled task",
      taskName: "Task name",
      taskNamePlaceholder: "Example: Daily project check",
      prompt: "Task prompt",
      promptPlaceholder: "Example: Check this project every day and summarize items that need attention.",
      workspace: "Workspace",
      chooseWorkspace: "Choose workspace",
      daily: "Daily",
      scheduleTime: "Run time",
      timezone: "Timezone",
      status: "Status",
      enableTask: "Enable this scheduled task",
      active: "Active",
      paused: "Paused",
      schedulePreview: "Schedule",
      save: "Save scheduled task",
      install: "Activate",
      uninstall: "Pause",
      delete: "Delete",
      installed: "Active",
      generated: "Saved",
      draft: "Paused",
      listTitle: "Scheduled tasks",
      noTasks: "No scheduled tasks yet.",
      localRunner: "Local runner",
      logFile: "Log file",
      command: "Run command",
      lastGenerated: "Updated",
      lastInstalled: "Activated",
      saved: "Scheduled task saved",
      installedOk: "Scheduled task activated",
      uninstalledOk: "Scheduled task paused",
      deletedOk: "Scheduled task deleted",
      confirmDelete: "Delete this scheduled task?",
      failed: "Scheduled task action failed"
    },
    remote: {
      accountTitle: "Mobile control account",
      accountLoggedOut: "No push account signed in",
      accountPlaceholder: "Email / user ID",
      displayNamePlaceholder: "Display name (optional)",
      login: "Sign in and bind desktop",
      logout: "Sign out",
      pairTitle: "Phone pairing",
      pairHint: "Use the same account plus this code in the phone app to pair.",
      startPairing: "Generate pairing code",
      pairingCode: "Pairing code",
      pairingExpires: "Expires",
      noDevices: "No paired phones yet",
      pairedDevices: "Paired phones",
      revokeDevice: "Remove device",
      loginRequired: "Sign in to the push account first",
      loginSaved: "Push account signed in",
      logoutSaved: "Signed out from push account",
      pairingStarted: "Pairing code generated",
      pairingFailed: "Pairing code failed",
      deviceRevoked: "Device removed",
      enableMobile: "Enable mobile control",
      allowControl: "Allow phone control commands",
      allowUpdates: "Allow automatic update push notifications",
      bridgeRunning: "Mobile control running",
      bridgeStopped: "Mobile control stopped",
      tokenRequired: "Mobile control requires an access key.",
      connectionAddress: "Connection address",
      accessKey: "Access key",
      copyLanUrl: "Copy address",
      copyToken: "Copy access key",
      saveApply: "Save mobile control",
      restart: "Restart",
      rotateToken: "Rotate access key",
      testUpdate: "Test update push",
      saved: "Mobile control settings saved",
      running: "Mobile control is running",
      stopped: "Mobile control is not running",
      tokenUpdated: "Access key updated",
      statusLabel: "Mobile control",
      testUpdateTitle: "DeepSeek TUI Desktop update",
      testUpdateBody: "The automatic update push API is available.",
      testUpdateSent: "Test update notification sent",
      testUpdateFailed: "Update notification failed",
      copied: (label: string) => `${label} copied`
    },
    settings: {
      language: "Interface language",
      languageHint: "Switching applies and saves immediately.",
      chinese: "中文",
      english: "English",
      chooseWorkspace: "Choose workspace",
      openCursor: "Open Cursor",
      openVSCode: "Open VS Code",
      chooseBinary: "Choose binary",
      customDeepseekPath: "Custom deepseek path",
      provider: "Provider",
      model: "Model",
      modelDoc: "Official docs",
      apiModel: (model: string) => `API model: ${model}`,
      baseUrl: "Base URL",
      apiKey: "DeepSeek API Key (global)",
      apiKeyHint: "Saved as a global sign-in key and reused for every workspace; it is not written to project history.",
      deepseekKeyPlaceholder: "Paste DeepSeek API Key",
      nvidiaKeyPlaceholder: "Paste NVIDIA NIM API Key",
      allowShell: "Allow shell",
      agents: "Agents",
      harnessMode: "Process stream output",
      harnessHint: "When enabled, the process panel is visible and DeepSeek thinking is enabled; when disabled, the next request starts with reasoning_effort=off.",
      setup: "Setup",
      apiKeySaveFailed: "API key save failed",
      save: "Save settings"
    },
    category: {
      All: "All",
      Coding: "Coding",
      Browser: "Browser",
      Data: "Data",
      Knowledge: "Knowledge",
      Productivity: "Productivity",
      Remote: "Remote"
    },
    auth: {
      None: "None",
      Token: "Token",
      Connection: "Connection",
      OAuth: "OAuth"
    },
    safety: {
      Low: "Low",
      Medium: "Medium",
      High: "High"
    },
    downloadsCommunity: "community"
  }
} as const;

const skillTranslations: Record<AppLanguage, Record<string, Partial<Pick<SkillPreset, "name" | "description" | "category">>>> = {
  zh: {},
  en: {
    superpowers: {
      name: "Superpowers",
      description: "Default workflow for planning, task decomposition, code edits, and self-checks.",
      category: "Agent"
    },
    "ui-ux-design": {
      name: "UI/UX Design",
      description: "Layout, state, and interaction quality checks for desktop, web, and tool interfaces.",
      category: "Design"
    },
    "cron-scheduler": {
      name: "Cron Advanced Scripts",
      description: "Advanced-only helper for hand-authored crontab files; normal scheduled tasks are managed by the Scheduled Tasks screen.",
      category: "Scheduled Tasks"
    },
    "skill-downloader": {
      name: "Skill Download",
      description: "Guides the Agent to download Skills with curl, save SKILL.md, and verify the source instead of synthesizing similar content.",
      category: "Skills"
    }
  }
};

const mcpTranslations: Record<AppLanguage, Record<string, Partial<Pick<McpPreset, "name" | "description" | "envHint">>>> = {
  zh: {},
  en: {
    playwright: {
      description: "Browser automation, page inspection, and end-to-end testing. Common in Cursor and Claude development flows.",
      envHint: "No token required"
    },
    context7: {
      description: "Provides the Agent with current framework and library docs, useful for official API lookup while coding.",
      envHint: "No token required"
    },
    filesystem: {
      description: "Exposes the current workspace as MCP file context for the Agent.",
      envHint: "Workspace path"
    },
    "mcp-remote": {
      description: "Connects local-only clients to remote MCP servers, useful for OAuth and hosted MCP bridging.",
      envHint: "MCP_REMOTE_URL"
    },
    github: {
      description: "Connects repositories, issues, pull requests, and code search. Requires a GitHub token.",
      envHint: "GITHUB_PERSONAL_ACCESS_TOKEN"
    },
    postgres: {
      description: "Read-only PostgreSQL schema and data queries, useful for full-stack debugging.",
      envHint: "POSTGRES_CONNECTION_STRING"
    },
    "sequential-thinking": {
      description: "Step-by-step reasoning and planning tool for complex debugging and solution design.",
      envHint: "No token required"
    },
    memory: {
      description: "Knowledge-graph style long-term memory for saving project facts across sessions.",
      envHint: "Local storage"
    },
    slack: {
      description: "Reads and sends Slack workspace information for team collaboration workflows.",
      envHint: "SLACK_BOT_TOKEN, SLACK_TEAM_ID"
    },
    notion: {
      description: "Official Notion MCP for reading and managing Notion pages and databases.",
      envHint: "NOTION_TOKEN"
    },
    sentry: {
      description: "Official Sentry MCP for reading errors, projects, and event context.",
      envHint: "SENTRY_ACCESS_TOKEN"
    },
    figma: {
      name: "Figma Developer",
      description: "Lets the Agent read Figma design data to assist UI implementation.",
      envHint: "FIGMA_API_KEY"
    },
    stripe: {
      description: "Official Stripe MCP for payments, subscriptions, invoices, and customer data operations.",
      envHint: "STRIPE_SECRET_KEY"
    },
    puppeteer: {
      description: "Classic browser automation MCP for screenshots, scraping, and form flows.",
      envHint: "No token required"
    },
    "brave-search": {
      description: "Web search MCP for external search when you do not want to attach a browser.",
      envHint: "BRAVE_API_KEY"
    },
    "google-maps": {
      description: "Location, route, and place lookup MCP.",
      envHint: "GOOGLE_MAPS_API_KEY"
    },
    pannel: {
      name: "Panel / 1Panel",
      description: "1Panel server-panel management MCP for reading websites, databases, apps, and panel status.",
      envHint: "PANEL_HOST, PANEL_ACCESS_TOKEN"
    }
  }
};

function isRuntimeReady(runtime: RuntimeCheck | null) {
  return Boolean(runtime?.selectedExists);
}

function createId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function defaultBaseUrlForProvider(provider: ProviderMode) {
  return provider === "nvidia-nim" ? NVIDIA_NIM_BASE_URL : DEEPSEEK_BASE_URL;
}

function normalizeSettings(settings: DesktopSettings): DesktopSettings {
  const provider = settings.provider || "deepseek";
  const language = settings.language === "en" ? "en" : "zh";
  return {
    ...settings,
    language,
    provider,
    model: provider === "deepseek"
      ? normalizeDeepSeekModelSelection(settings.model)
      : settings.model || DEFAULT_DEEPSEEK_MODEL,
    baseUrl: settings.baseUrl || defaultBaseUrlForProvider(provider)
  };
}

function defaultTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai";
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function createAutomationDraft(settings: DesktopSettings, task?: AutomationTask | null): AutomationDraft {
  const status = task?.status || (task?.installed || task?.enabled ? "ACTIVE" : "PAUSED");
  return {
    id: task?.id,
    name: task?.name || "",
    prompt: task?.prompt || "",
    workspacePath: task?.workspacePath || settings.workspacePath,
    minute: task?.minute ?? 0,
    hour: task?.hour ?? 9,
    timezone: task?.timezone || defaultTimezone(),
    status: task ? status : "ACTIVE"
  };
}

function automationStatus(task: AutomationTask) {
  return task.status || (task.installed || task.enabled ? "ACTIVE" : "PAUSED");
}

function automationTimeValue(hour: number, minute: number) {
  const safeHour = String(clampNumber(hour, 0, 23)).padStart(2, "0");
  const safeMinute = String(clampNumber(minute, 0, 59)).padStart(2, "0");
  return `${safeHour}:${safeMinute}`;
}

function parseAutomationTime(value: string) {
  const [hourRaw, minuteRaw] = value.split(":");
  return {
    hour: clampNumber(Number(hourRaw), 0, 23),
    minute: clampNumber(Number(minuteRaw), 0, 59)
  };
}

function automationSchedulePreview(draft: AutomationDraft, language: AppLanguage) {
  const minute = clampNumber(draft.minute, 0, 59);
  const hour = clampNumber(draft.hour, 0, 23);
  const time = automationTimeValue(hour, minute);
  return language === "zh" ? `每天 ${time}` : `Daily ${time}`;
}

function formatAutomationTime(value: string, language: AppLanguage) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en-US", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function getSkillText(skill: SkillPreset, language: AppLanguage) {
  const translation = skillTranslations[language][skill.id];
  return {
    name: translation?.name || skill.name,
    description: translation?.description || skill.description,
    category: translation?.category || skill.category
  };
}

function fallbackSkillPreset(template: SkillTemplateDraft, language: AppLanguage): SkillPreset {
  const customCategory = uiCopy[language].skills.customCategory;
  return {
    id: template.id,
    name: template.name,
    description: template.description,
    icon: "zap",
    category: customCategory,
    tools: ["SKILL.md"]
  };
}

function getMcpText(preset: McpPreset, language: AppLanguage) {
  const translation = mcpTranslations[language][preset.id];
  return {
    name: translation?.name || preset.name,
    description: translation?.description || preset.description,
    envHint: translation?.envHint || preset.envHint
  };
}

function mcpArgsFromLines(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseMcpEnv(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return {};
  const parsed = JSON.parse(trimmed);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("env");
  }
  return Object.fromEntries(Object.entries(parsed).map(([key, val]) => [key, String(val ?? "")]));
}

function parseMcpConfigDraft(value: string) {
  const parsed = JSON.parse(value.trim() || "{}");
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("config");
  }
  const config = parsed as { servers?: unknown; [key: string]: unknown };
  if (!config.servers || typeof config.servers !== "object" || Array.isArray(config.servers)) {
    config.servers = {};
  }
  return config as { servers: Record<string, unknown>; [key: string]: unknown };
}

function formatStatus(status: StatusState, language: AppLanguage) {
  const copy = uiCopy[language].status;
  switch (status.type) {
    case "launching":
      return copy.launching;
    case "running":
      return copy.runningPid(status.pid);
    case "stopped":
      return copy.stopped;
    case "settingsSaved":
      return copy.settingsSaved;
    case "languageSaved":
      return copy.languageSaved;
    case "editorOpened":
      return copy.editorOpened(status.editor);
    case "exited":
      return copy.exited(status.exitCode);
    case "error":
      return status.message;
    case "ready":
    default:
      return copy.ready;
  }
}

function createEmptyRuntimeSnapshot(): RuntimeSnapshot {
  const updatedAt = new Date().toISOString();
  return {
    status: "idle",
    source: "none",
    sessionId: "",
    mode: "",
    workspacePath: "",
    pid: 0,
    command: "",
    args: [],
    startedAt: "",
    updatedAt,
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
}

function runtimeStatusText(status: RuntimeRunStatus | RuntimeAgentStatus, language: AppLanguage) {
  return uiCopy[language].runtimeAgents.statuses[status] || status;
}

function gitStatusLabel(change: GitChangeInfo) {
  if (change.untracked) return "NEW";
  const status = change.status.trim();
  if (!status) return "MOD";
  if (status.includes("A")) return "ADD";
  if (status.includes("D")) return "DEL";
  if (status.includes("R")) return "REN";
  if (status.includes("M")) return "MOD";
  return status;
}

function gitStatusSummary(status: GitStatus | null, language: AppLanguage) {
  if (!status) return "";
  if (!status.isRepo) return uiCopy[language].git.notRepoTitle;
  if (!status.hasChanges) return uiCopy[language].git.noChanges;
  return [
    `${uiCopy[language].git.staged} ${status.staged}`,
    `${uiCopy[language].git.unstaged} ${status.unstaged}`,
    `${uiCopy[language].git.untracked} ${status.untracked}`
  ].join(" · ");
}

function createWelcomeMessage(language: AppLanguage): ChatMessage {
  return {
    id: "welcome",
    role: "assistant",
    title: uiCopy[language].welcome.title,
    content: uiCopy[language].welcome.content
  };
}

function createNewConversationMessage(language: AppLanguage): ChatMessage {
  return {
    id: createId(),
    role: "assistant",
    title: uiCopy[language].newConversation.title,
    content: uiCopy[language].newConversation.content
  };
}

function projectIdFromWorkspace(workspacePath: string) {
  const normalized = workspacePath.trim().replace(/[\\/]+$/, "");
  return normalized || "no-workspace";
}

function projectNameFromWorkspace(workspacePath: string, language: AppLanguage) {
  const projectId = projectIdFromWorkspace(workspacePath);
  if (projectId === "no-workspace") {
    return uiCopy[language].history.noProject;
  }
  return projectId.split(/[\\/]/).filter(Boolean).pop() || projectId;
}

function createConversationSession(
  workspacePath: string,
  language: AppLanguage,
  messages: ChatMessage[] = [createNewConversationMessage(language)]
): ConversationSession {
  const now = new Date().toISOString();
  const projectId = projectIdFromWorkspace(workspacePath);
  const projectName = projectNameFromWorkspace(workspacePath, language);
  return {
    id: createId(),
    projectId,
    projectName,
    workspacePath,
    title: uiCopy[language].history.untitled,
    createdAt: now,
    updatedAt: now,
    messages
  };
}

function sortConversationStore(store: ConversationStore): ConversationStore {
  const projects = store.projects
    .map((project) => ({
      ...project,
      sessions: [...project.sessions].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    }))
    .filter((project) => project.sessions.length > 0)
    .sort((a, b) => {
      const aTime = Date.parse(a.sessions[0]?.updatedAt || "");
      const bTime = Date.parse(b.sessions[0]?.updatedAt || "");
      return bTime - aTime;
    });

  return { ...store, projects };
}

function findConversationSession(store: ConversationStore, sessionId: string) {
  for (const project of store.projects) {
    const session = project.sessions.find((candidate) => candidate.id === sessionId);
    if (session) return session;
  }
  return null;
}

function upsertConversationSession(
  store: ConversationStore,
  session: ConversationSession,
  language: AppLanguage,
  makeActive = true
): ConversationStore {
  const projectId = projectIdFromWorkspace(session.workspacePath);
  const projectName = projectNameFromWorkspace(session.workspacePath, language);
  const normalizedSession: ConversationSession = {
    ...session,
    projectId,
    projectName,
    title: session.title || uiCopy[language].history.untitled
  };
  const projects = store.projects
    .map((project) => ({
      ...project,
      sessions: project.sessions.filter((candidate) => candidate.id !== session.id)
    }))
    .filter((project) => project.sessions.length > 0 || project.id === projectId);

  const existingProject = projects.find((project) => project.id === projectId);
  if (existingProject) {
    existingProject.name = projectName;
    existingProject.workspacePath = session.workspacePath;
    existingProject.sessions = [normalizedSession, ...existingProject.sessions];
  } else {
    projects.push({
      id: projectId,
      name: projectName,
      workspacePath: session.workspacePath,
      sessions: [normalizedSession]
    });
  }

  return sortConversationStore({
    activeSessionId: makeActive ? normalizedSession.id : store.activeSessionId,
    projects
  });
}

function updateConversationSession(
  store: ConversationStore,
  sessionId: string,
  language: AppLanguage,
  updater: (session: ConversationSession) => ConversationSession
): ConversationStore {
  const current = findConversationSession(store, sessionId);
  if (!current) return store;
  return upsertConversationSession(store, updater(current), language, store.activeSessionId === sessionId);
}

function deleteConversationSession(store: ConversationStore, sessionId: string): ConversationStore {
  const projects = store.projects
    .map((project) => ({
      ...project,
      sessions: project.sessions.filter((session) => session.id !== sessionId)
    }))
    .filter((project) => project.sessions.length > 0);
  const nextActiveSessionId = store.activeSessionId === sessionId
    ? projects[0]?.sessions[0]?.id || ""
    : store.activeSessionId;
  return sortConversationStore({ activeSessionId: nextActiveSessionId, projects });
}

function normalizeConversationStore(store: ConversationStore, settings: DesktopSettings, language: AppLanguage) {
  const sorted = sortConversationStore({
    activeSessionId: store.activeSessionId || "",
    projects: Array.isArray(store.projects) ? store.projects : []
  });
  if (findConversationSession(sorted, sorted.activeSessionId)) {
    return sorted;
  }
  const firstSession = sorted.projects[0]?.sessions[0];
  if (firstSession) {
    return { ...sorted, activeSessionId: firstSession.id };
  }
  const session = createConversationSession(settings.workspacePath, language, [createWelcomeMessage(language)]);
  return upsertConversationSession(sorted, session, language);
}

function titleFromPrompt(prompt: string, fallback: string) {
  const title = prompt.replace(/\s+/g, " ").trim();
  if (!title) return fallback;
  return title.length > 42 ? `${title.slice(0, 42)}...` : title;
}

function defaultScheduledTaskName(prompt: string, language: AppLanguage) {
  const firstLine = prompt
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .find(Boolean);
  if (!firstLine) return language === "zh" ? "定时任务" : "Scheduled task";
  return firstLine.length > 24 ? `${firstLine.slice(0, 24)}...` : firstLine;
}

function stripAnsi(value: string) {
  return value
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "")  // CSI sequences
    .replace(/\u001b\][^\u001b\x07]*(\x07|\u001b\\)/g, "")  // OSC sequences (e.g. ESC]0;titleBEL)
    .replace(/\u001b[PX^_].*?(?:\u001b\\)/g, "")  // SOS/PM/APC sequences
    .replace(/\x07/g, "")  // BEL characters
    .replace(/\u001b/g, "")  // Any remaining ESC
    .replace(/\r/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

function appendTerminalCapture(current: string, chunk: string) {
  const next = `${current}${chunk}`;
  return next.length > 60000 ? next.slice(-60000) : next;
}

// Extract thinking content from PTY output - matches DeepSeek TUI thinking output
function extractThinking(data: string): string {
  const cleanData = data.replace(/\r/g, '\n');
  
  const thinkingPatterns = [
    /\*\*思考\*\*[\s\S]*?(?=\*\*|$)/i,
    /思考：[\s\S]*?(?=\*\*|\n\n|$)/i,
    /Thinking[:\s]+([\s\S]*?)(?=\n\n|\*\*|\| |\$ |> |```|$)/i,
    /Thought[:\s]+([\s\S]*?)(?=\n\n|\*\*|\| |\$ |> |```|$)/i,
    /Step[:\s]+(\d+)[\s\S]*?(?=\n\n|Step |\*\*|$)/i,
    /分析[:\s]+([\s\S]*?)(?=\n\n|\*\*|$)/i,
    /计划[:\s]+([\s\S]*?)(?=\n\n|\*\*|$)/i,
    /\*\*[\d]+\.\s*([\s\S]*?)(?=\*\*|\n\n|$)/i
  ];
  
  for (const pattern of thinkingPatterns) {
    const match = cleanData.match(pattern);
    if (match) {
      const text = match[1] ? match[1].trim() : match[0].replace(/^\*\*思考\*\*/i, '').replace(/^\*\*/, '').trim();
      if (text.length > 5) {
        return text;
      }
    }
  }
  
  return '';
}

function terminalExcerpt(output: string, fallback: string) {
  const clean = stripAnsi(output);
  if (!clean) return fallback;
  if (clean.length <= 10) return fallback;
  return clean.length > 6000 ? `...${clean.slice(-6000)}` : clean;
}

function compactAgentReply(output: string, fallback: string) {
  const clean = stripAnsi(output);
  if (!clean) return fallback;
  const lines = clean
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((line) => !/^\[harness\b/i.test(line))
    .filter((line) => !/^DeepSeek TUI Desktop/i.test(line));
  const useful = lines.slice(-8).join("\n");
  if (!useful) return fallback;
  return useful.length > 600 ? `${useful.slice(0, 597)}...` : useful;
}

function formatConciseRunReply(capture: RunCapture, exit: { exitCode?: number; signal?: number }, language: AppLanguage) {
  const copy = uiCopy[language].runSummary;
  const ok = !exit.signal && (exit.exitCode === 0 || typeof exit.exitCode === "undefined");
  if (!ok) {
    const output = capture.output ? compactAgentReply(capture.output, "") : "";
    return output || copy.failedShort;
  }
  return compactAgentReply(capture.output, copy.completedShort);
}

function formatRunSummary(capture: RunCapture, exit: { exitCode?: number; signal?: number }, language: AppLanguage) {
  const copy = uiCopy[language].runSummary;
  const ok = !exit.signal && (exit.exitCode === 0 || typeof exit.exitCode === "undefined");
  const status = ok ? copy.success : `${copy.failed}${typeof exit.exitCode === "number" ? ` ${exit.exitCode}` : ""}${exit.signal ? ` ${exit.signal}` : ""}`;
  return [
    `${copy.status}: ${status}`,
    `${copy.mode}: ${capture.action}`,
    `${copy.workspace}: ${capture.workspacePath || "-"}`,
    `${copy.started}: ${formatSessionTime(capture.startedAt, language)}`,
    "",
    `${copy.terminal}:`,
    terminalExcerpt(capture.output, copy.noOutput)
  ].join("\n");
}

function formatSessionTime(updatedAt: string, language: AppLanguage) {
  const date = new Date(updatedAt);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en-US", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function formatDownloads(downloads: number, language: AppLanguage) {
  if (!downloads) return uiCopy[language].downloadsCommunity;
  if (downloads >= 1_000_000) return `${(downloads / 1_000_000).toFixed(1)}M/wk`;
  if (downloads >= 1_000) return `${Math.round(downloads / 1_000)}K/wk`;
  return `${downloads}/wk`;
}

function iconForSkill(skill: SkillPreset) {
  if (skill.icon === "palette") return Palette;
  if (skill.icon === "calendar") return CalendarClock;
  if (skill.icon === "download") return DownloadCloud;
  return Zap;
}

function iconForMcp(id: string) {
  if (id === "github") return Github;
  if (id === "filesystem") return HardDrive;
  if (id === "postgres" || id === "stripe") return Database;
  if (id === "playwright" || id === "puppeteer") return Globe2;
  if (id === "context7" || id === "sequential-thinking" || id === "memory") return Brain;
  if (id === "pannel" || id === "mcp-remote") return Server;
  return Plug;
}

function App() {
  const [settings, setSettings] = useState<DesktopSettings>(defaultSettings);
  const [runtime, setRuntime] = useState<RuntimeCheck | null>(null);
  const [runtimeSnapshot, setRuntimeSnapshot] = useState<RuntimeSnapshot>(() => createEmptyRuntimeSnapshot());
  const [runtimeEvents, setRuntimeEvents] = useState<RuntimeEvent[]>([]);
  const [remoteStatus, setRemoteStatus] = useState<RemoteBridgeStatus | null>(null);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<StatusState>({ type: "ready" });
  const [remoteMessage, setRemoteMessage] = useState("");
  const [loginAccount, setLoginAccount] = useState("");
  const [loginDisplayName, setLoginDisplayName] = useState("");
  const [pairingCode, setPairingCode] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [agentPrompt, setAgentPrompt] = useState("");
  const [inspectorPanel, setInspectorPanel] = useState<InspectorPanel>(null);
  const [mainView, setMainView] = useState<MainView>("chat");
  const [toolPage, setToolPage] = useState<ToolPage>("overview");
  const [agentMode, setAgentMode] = useState<AgentMode>("agent");
  const [mcpSearch, setMcpSearch] = useState("");
  const [mcpCategory, setMcpCategory] = useState<"All" | McpPreset["category"]>("All");
  const [customization, setCustomization] = useState<CustomizationDraft | null>(null);
  const [newSkillName, setNewSkillName] = useState("");
  const [newSkillDescription, setNewSkillDescription] = useState("");
  const [mcpDraft, setMcpDraft] = useState("");
  const [customMcpId, setCustomMcpId] = useState("");
  const [customMcpCommand, setCustomMcpCommand] = useState("npx");
  const [customMcpArgs, setCustomMcpArgs] = useState("");
  const [customMcpUrl, setCustomMcpUrl] = useState("");
  const [customMcpEnv, setCustomMcpEnv] = useState("{}");
  const [templateMessage, setTemplateMessage] = useState("");
  const [mcpTestResult, setMcpTestResult] = useState<McpTestResult | null>(null);
  const [mcpTesting, setMcpTesting] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const [saveButtonClass, setSaveButtonClass] = useState("");
  const [automationTasks, setAutomationTasks] = useState<AutomationTask[]>([]);
  const [automationDraft, setAutomationDraft] = useState<AutomationDraft>(() => createAutomationDraft(defaultSettings));
  const [automationMessage, setAutomationMessage] = useState("");
  const [automationMessageKind, setAutomationMessageKind] = useState<"info" | "error">("info");
  const [automationBusy, setAutomationBusy] = useState(false);
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null);
  const [gitRemoteUrl, setGitRemoteUrl] = useState("");
  const [gitCommitMessage, setGitCommitMessage] = useState("");
  const [gitMessage, setGitMessage] = useState("");
  const [gitMessageKind, setGitMessageKind] = useState<"info" | "error">("info");
  const [gitBusy, setGitBusy] = useState(false);
  const [gitDiffSummary, setGitDiffSummary] = useState("");
  const [gitDiffBusy, setGitDiffBusy] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>(() => [createWelcomeMessage(defaultSettings.language)]);
  const [conversationStore, setConversationStore] = useState<ConversationStore>({ activeSessionId: "", projects: [] });
  const [rollbackState, setRollbackState] = useState<{ active: boolean; snapshotId: string; messageId: string }>({ active: false, snapshotId: "", messageId: "" });
  const [undoSnapshotId, setUndoSnapshotId] = useState<string | null>(null);
  const [copiedMessages, setCopiedMessages] = useState<Set<string>>(new Set());
  const [tasksCollapsed, setTasksCollapsed] = useState(false);
  const [showNewTaskMenu, setShowNewTaskMenu] = useState(false);
  const [newTaskMenuPosition, setNewTaskMenuPosition] = useState({ x: 0, y: 0 });
  const terminalHostRef = useRef<HTMLDivElement | null>(null);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const activeSessionIdRef = useRef("");
  const terminalRunSessionIdRef = useRef("");
  const ptySessionIdRef = useRef("");
  const terminalOutputBySessionRef = useRef<Record<string, string>>({});
  const runCaptureRef = useRef<RunCapture | null>(null);
  const desktop = useMemo(() => getDesktopBridge(), []);
  const language = settings.language;
  const t = uiCopy[language];
  const selectedModelPreset = useMemo(
    () => settings.provider === "deepseek" ? modelPresetForValue(settings.model) : null,
    [settings.model, settings.provider]
  );
  const selectedModelApiName = apiModelForProvider(settings.provider, settings.model);
  const selectedModelDocsLabel = selectedModelPreset
    ? (language === "zh" ? selectedModelPreset.docsLabelZh : selectedModelPreset.docsLabelEn)
    : "";
  const hasGlobalApiKey = Boolean(apiKey.trim());
  const statusText = useMemo(() => formatStatus(status, language), [language, status]);
  const activeSession = useMemo(
    () => findConversationSession(conversationStore, conversationStore.activeSessionId),
    [conversationStore]
  );
  const selectedWorkspacePath = activeSession?.workspacePath || settings.workspacePath;
  const selectedWorkspaceLabel = selectedWorkspacePath.trim()
    ? projectNameFromWorkspace(selectedWorkspacePath, language)
    : t.topbar.chooseWorkspace;
  const currentBranchLabel = gitStatus?.isRepo && gitStatus.branch
    ? gitStatus.branch
    : t.topbar.noBranch;
  const processStreamEnabled = settings.harnessEnabled;
  const selectedProjectId = useMemo(
    () => projectIdFromWorkspace(selectedWorkspacePath),
    [selectedWorkspacePath]
  );

  useEffect(() => {
    activeSessionIdRef.current = conversationStore.activeSessionId;
  }, [conversationStore.activeSessionId]);

  useEffect(() => {
    let active = true;
    desktop.getRuntimeSnapshot().then((snapshot) => {
      if (!active) return;
      setRuntimeSnapshot(snapshot);
      setRuntimeEvents(snapshot.events || []);
    }).catch(() => {
      // Older preview bridges may not expose runtime state during hot reload.
    });
    const offSnapshot = desktop.onRuntimeSnapshot((snapshot) => {
      setRuntimeSnapshot(snapshot);
      setRuntimeEvents(snapshot.events || []);
    });
    const offEvent = desktop.onRuntimeEvent((event) => {
      setRuntimeEvents((current) => [...current, event].slice(-80));
    });
    return () => {
      active = false;
      offSnapshot();
      offEvent();
    };
  }, [desktop]);

  const fitTerminal = useCallback(() => {
    const host = terminalHostRef.current;
    if (!host?.clientWidth || !host.clientHeight || !fitRef.current) {
      return;
    }
    try {
      fitRef.current.fit();
      desktop.resizeTerminal({
        cols: terminalRef.current?.cols || 120,
        rows: terminalRef.current?.rows || 34
      });
    } catch {
      // xterm can briefly report incomplete dimensions while the terminal pane is hidden.
    }
  }, [desktop]);

  const renderTerminalForSession = useCallback((sessionId?: string) => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    terminal.clear();
    const output = sessionId ? terminalOutputBySessionRef.current[sessionId] : "";
    if (output) {
      terminal.write(output);
      return;
    }
    terminal.write(t.terminal.bootReady);
    terminal.write(t.terminal.bootHint);
  }, [t]);

  const updateSetting = useCallback(<K extends keyof DesktopSettings>(key: K, value: DesktopSettings[K]) => {
    setSettings((current) => ({ ...current, [key]: value }));
  }, []);

  const applyConversationStore = useCallback((nextStore: ConversationStore) => {
    setConversationStore(nextStore);
    desktop.saveConversationHistory(nextStore).catch(() => undefined);
    return nextStore;
  }, [desktop]);

  const commitConversationStore = useCallback((updater: (current: ConversationStore) => ConversationStore) => {
    setConversationStore((current) => {
      const nextStore = updater(current);
      desktop.saveConversationHistory(nextStore).catch(() => undefined);
      return nextStore;
    });
  }, [desktop]);

  const refreshRuntime = useCallback(async (nextSettings?: Partial<DesktopSettings>) => {
    setStatus({ type: "launching" });
    const result = await desktop.checkRuntime({ ...settings, ...(nextSettings || {}) });
    setRuntime(result);
    if (result.selectedExists) {
      setStatus({ type: "ready" });
    } else {
      setStatus({ type: "error", message: language === "zh" ? "运行环境未找到，请检查配置" : "Runtime not found, please check your configuration" });
    }
    return result;
  }, [desktop, language, settings]);

  const loadCustomization = useCallback(async (sourceSettings: DesktopSettings = settings) => {
    const draft = await desktop.getCustomization(sourceSettings);
    setCustomization(draft);
    setMcpDraft(draft.mcpConfigText);
    return draft;
  }, [desktop, settings]);

  const loadAutomations = useCallback(async () => {
    const store = await desktop.getAutomations();
    setAutomationTasks(store.tasks || []);
    return store;
  }, [desktop]);

  const loadGitStatus = useCallback(async () => {
    const result = await desktop.getGitStatus(settings.workspacePath);
    setGitStatus(result);
    if (result.originUrl) {
      setGitRemoteUrl(result.originUrl);
    }
    if (!result.ok && result.error) {
      setGitMessage(result.error);
      setGitMessageKind("error");
    }
    return result;
  }, [desktop, settings.workspacePath]);

  useEffect(() => {
    let active = true;
    Promise.all([desktop.getSettings(), desktop.getConversationHistory(), desktop.getAutomations()]).then(([stored, storedHistory, storedAutomations]) => {
      if (!active) return;
      const merged = normalizeSettings({ ...defaultSettings, ...stored });
      const normalizedHistory = normalizeConversationStore(storedHistory, merged, merged.language);
      const session = findConversationSession(normalizedHistory, normalizedHistory.activeSessionId);
      setConversationStore(normalizedHistory);
      setAutomationTasks(storedAutomations.tasks || []);
      setAutomationDraft(createAutomationDraft(merged));
      setMessages(session?.messages.length ? session.messages : [createWelcomeMessage(merged.language)]);
      setSettings(session?.workspacePath ? { ...merged, workspacePath: session.workspacePath } : merged);
      desktop.saveConversationHistory(normalizedHistory).catch(() => undefined);
      desktop.checkRuntime(merged).then((result) => {
        if (active) setRuntime(result);
      });
      desktop.getRemoteStatus().then((result) => {
        if (active) setRemoteStatus(result);
      });
    });
    return () => {
      active = false;
    };
  }, [desktop]);

  useEffect(() => {
    let active = true;
    desktop.getApiKey(settings.provider).then((storedKey) => {
      if (active) {
        setApiKey(storedKey || "");
      }
    }).catch(() => undefined);
    return () => {
      active = false;
    };
  }, [desktop, settings.provider]);

  useEffect(() => {
    setMessages((current) => {
      if (current.length === 1 && current[0]?.id === "welcome") {
        return [createWelcomeMessage(language)];
      }
      return current;
    });
    if (!terminalOutputBySessionRef.current[activeSessionIdRef.current]) {
      renderTerminalForSession(activeSessionIdRef.current);
    }
  }, [language, renderTerminalForSession]);

  useEffect(() => {
    setAutomationDraft((current) => current.id || current.workspacePath ? current : {
      ...current,
      workspacePath: settings.workspacePath
    });
  }, [settings.workspacePath]);

  useEffect(() => {
    const offRemoteStatus = desktop.onRemoteStatus((nextStatus) => {
      setRemoteStatus(nextStatus);
    });
    return () => {
      offRemoteStatus();
    };
  }, [desktop]);

  useEffect(() => {
    if (mainView === "tools" && (toolPage === "skills" || toolPage === "mcp")) {
      loadCustomization().catch(() => undefined);
    }
  }, [loadCustomization, mainView, toolPage]);

  useEffect(() => {
    if (inspectorPanel === "git") {
      loadGitStatus().catch((error) => {
        setGitMessage(error instanceof Error ? error.message : t.git.actionFailed);
      });
    }
  }, [inspectorPanel, loadGitStatus, t]);

  useEffect(() => {
    if (!settings.workspacePath.trim()) {
      setGitStatus(null);
      return;
    }
    loadGitStatus().catch(() => undefined);
  }, [loadGitStatus, settings.workspacePath]);

  useEffect(() => {
    if (mainView === "tasks") {
      loadAutomations().catch((error) => {
        setAutomationMessage(error instanceof Error ? error.message : t.automations.failed);
        setAutomationMessageKind("error");
      });
    }
  }, [loadAutomations, mainView, t]);

  useEffect(() => {
    setTemplateMessage("");
    setAutomationMessage("");
    setAutomationMessageKind("info");
    setGitMessage("");
    setGitMessageKind("info");
  }, [inspectorPanel]);

  useEffect(() => {
    setTemplateMessage("");
    setAutomationMessage("");
    setAutomationMessageKind("info");
  }, [toolPage]);

  useEffect(() => {
    const account = remoteStatus?.auth.account;
    if (!account) return;
    setLoginAccount((current) => current || account.email || account.accountId);
    setLoginDisplayName((current) => current || account.displayName || "");
  }, [remoteStatus?.auth.account]);

  useEffect(() => {
    if (!processStreamEnabled && mainView !== "terminal") {
      return;
    }

    if (!terminalHostRef.current || terminalRef.current) {
      return;
    }

    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: true,
      fontFamily: '"SFMono-Regular", Menlo, Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.2,
      theme: {
        background: "#ffffff",
        foreground: "#1f2933",
        cursor: "#0e8f6e",
        selectionBackground: "#d7eee7",
        black: "#111827",
        red: "#b42318",
        green: "#0e8f6e",
        yellow: "#b7791f",
        blue: "#2563eb",
        magenta: "#7c3aed",
        cyan: "#0891b2",
        white: "#f8fafc",
        brightBlack: "#6b7280",
        brightRed: "#dc2626",
        brightGreen: "#059669",
        brightYellow: "#d97706",
        brightBlue: "#3b82f6",
        brightMagenta: "#9333ea",
        brightCyan: "#06b6d4",
        brightWhite: "#ffffff"
      }
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    const host = terminalHostRef.current;
    terminal.open(host);
    terminal.onData((data) => desktop.sendTerminalInput(data));

    terminalRef.current = terminal;
    fitRef.current = fit;

    const resize = fitTerminal;
    const writeBootText = () => {
      resize();
      renderTerminalForSession(activeSessionIdRef.current);
    };
    window.requestAnimationFrame(writeBootText);
    window.addEventListener("resize", resize);
    const observer = new ResizeObserver(resize);
    observer.observe(host);

    return () => {
      window.removeEventListener("resize", resize);
      observer.disconnect();
      terminal.dispose();
      terminalRef.current = null;
      fitRef.current = null;
    };
  }, [desktop, fitTerminal, mainView, processStreamEnabled, renderTerminalForSession]);

  useEffect(() => {
    window.requestAnimationFrame(fitTerminal);
  }, [fitTerminal, mainView]);

  useEffect(() => {
    if (messageListRef.current) {
      messageListRef.current.scrollTop = messageListRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    const offData = desktop.onTerminalData((data) => {
      console.log("Terminal data received:", data);
      const capture = runCaptureRef.current;
      const terminalSessionId = capture?.sessionId || terminalRunSessionIdRef.current || activeSessionIdRef.current;
      if (terminalSessionId) {
        terminalOutputBySessionRef.current[terminalSessionId] = appendTerminalCapture(
          terminalOutputBySessionRef.current[terminalSessionId] || "",
          data
        );
      }
      if (capture) {
        capture.output = appendTerminalCapture(capture.output, data);
        // Extract thinking content from PTY output
        const thinkingContent = extractThinking(data);
        if (thinkingContent) {
          capture.thinking = appendTerminalCapture(capture.thinking, thinkingContent);
        }
        // Real-time update message in chat if session is active
        if (capture.replyMessageId && activeSessionIdRef.current === capture.sessionId) {
          setMessages((current) => {
            const existing = current.find(m => m.id === capture.replyMessageId);
            if (existing) {
              const newContent = terminalExcerpt(capture.output, formatConciseRunReply({ ...capture, output: capture.output }, { exitCode: 0 }, language));
              return current.map(m => m.id === capture.replyMessageId
                ? { ...m, content: newContent, thinking: capture.thinking || m.thinking }
                : m
              );
            }
            return current;
          });
        }
      }
      if (!terminalSessionId || activeSessionIdRef.current === terminalSessionId) {
        terminalRef.current?.write(data);
      }
    });
    const offExit = desktop.onTerminalExit((exit) => {
      setRunning(false);
      const exitCode = exit.exitCode ?? 0;
      // Exit code 0 is normal completion, don't show "已退出"
      if (exitCode === 0) {
        setStatus({ type: "ready" });
      } else {
        setStatus({ type: "exited", exitCode });
      }
      terminalRunSessionIdRef.current = "";
      const capture = runCaptureRef.current;
      runCaptureRef.current = null;
      if (capture?.sessionId) {
        const message: ChatMessage = {
          id: capture.replyMessageId || createId(),
          role: "assistant",
          content: formatConciseRunReply(capture, exit, language),
          thinking: capture.thinking || undefined
        };
        commitConversationStore((current) => updateConversationSession(current, capture.sessionId, language, (session) => ({
          ...session,
          updatedAt: new Date().toISOString(),
          messages: capture.replyMessageId
            ? session.messages.map((candidate) => candidate.id === capture.replyMessageId ? message : candidate)
            : [...session.messages, message]
        })));
        if (activeSessionIdRef.current === capture.sessionId) {
          setMessages((current) => capture.replyMessageId
            ? current.map((candidate) => candidate.id === capture.replyMessageId ? message : candidate)
            : [...current, message]);
        }
      }
    });
    return () => {
      offData();
      offExit();
    };
  }, [commitConversationStore, desktop, language]);

  const selectedRuntimeLabel = useMemo(() => {
    if (!runtime) return t.status.checking;
    if (!runtime.selectedExists) return t.status.missing;
    return runtime.version || t.status.runtimeReady;
  }, [runtime, t]);

  const enabledMcpCount = settings.enabledMcpServers.length;
  const enabledSkillCount = settings.enabledSkills.length;
  const mcpRuntimeReady = settings.mcpEnabled && (settings.enabledMcpServers.length > 0 || Boolean(settings.mcpConfigPath.trim()));
  const skillsRuntimeReady = settings.skillsEnabled && (settings.enabledSkills.length > 0 || Boolean(settings.skillsDir.trim()));
  const installedAutomationCount = automationTasks.filter((task) => automationStatus(task) === "ACTIVE").length;
  const skillCatalog = useMemo<SkillCatalogItem[]>(() => {
    const templates = customization?.skillTemplates || {};
    const presetMap = new Map(skillPresets.map((preset) => [preset.id, preset]));
    const ids = Array.from(new Set([...skillPresets.map((preset) => preset.id), ...Object.keys(templates)]));
    return ids.map((id) => {
      const template = templates[id];
      const preset = presetMap.get(id) || (template ? fallbackSkillPreset(template, language) : null);
      if (!preset) return null;
      const translated = getSkillText(preset, language);
      return {
        ...preset,
        name: template?.origin === "custom" ? template.name : translated.name,
        description: template?.origin === "custom" ? template.description : translated.description,
        category: template?.origin === "custom" ? t.skills.customCategory : translated.category,
        tools: template?.origin === "custom"
          ? [template.source === "file" ? t.skills.fileTag : t.skills.defaultTag]
          : preset.tools,
        path: template?.path || "",
        source: template?.source || "default",
        origin: template?.origin || "preset",
        content: template?.content || ""
      };
    }).filter((skill): skill is SkillCatalogItem => Boolean(skill));
  }, [customization, language, t]);
  const mcpCategories = useMemo(() => {
    return ["All", ...Array.from(new Set(mcpPresets.map((preset) => preset.category)))] as Array<"All" | McpPreset["category"]>;
  }, []);
  const filteredMcpPresets = useMemo(() => {
    const query = mcpSearch.trim().toLowerCase();
    return mcpPresets.filter((preset) => {
      const text = getMcpText(preset, language);
      const matchesCategory = mcpCategory === "All" || preset.category === mcpCategory;
      const matchesQuery = !query || [
        preset.name,
        preset.description,
        preset.source,
        preset.command,
        text.name,
        text.description,
        text.envHint
      ].join(" ").toLowerCase().includes(query);
      return matchesCategory && matchesQuery;
    });
  }, [language, mcpCategory, mcpSearch]);

  const saveSettings = useCallback(async () => {
    try {
      if (apiKey.trim()) {
        try {
          const keyResult = await desktop.saveApiKey({ provider: settings.provider, apiKey });
          if (keyResult !== undefined && keyResult !== null && !keyResult.ok) {
            const errMsg = language === "zh" ? "API Key 保存失败" : "Failed to save API Key";
            setRemoteMessage(errMsg);
            setSaveButtonClass("flash-error");
            setToast({ message: errMsg, type: "error" });
            setTimeout(() => setSaveButtonClass(""), 600);
            setTimeout(() => setToast(null), 3000);
            return;
          }
        } catch (error) {
          const errDetail = error instanceof Error ? error.message : String(error);
          const errMsg = language === "zh" ? "API Key 保存失败: " + errDetail : "Failed to save API Key: " + errDetail;
          console.error("saveApiKey error:", errDetail);
          setRemoteMessage(errMsg);
          setSaveButtonClass("flash-error");
          setToast({ message: errMsg, type: "error" });
          setTimeout(() => setSaveButtonClass(""), 600);
          setTimeout(() => setToast(null), 3000);
          return;
        }
      }
      
      const nextSettings = normalizeSettings(settings);
      const saved = await desktop.saveSettings(nextSettings);
      setSettings(saved);
      setRemoteStatus(await desktop.getRemoteStatus());
      await loadCustomization(saved);
      await refreshRuntime(saved);
      const msg = language === "zh" ? "设置保存成功" : "Settings saved successfully";
      setRemoteMessage(msg);
      setSaveButtonClass("flash-success");
      setToast({ message: msg, type: "success" });
      setTimeout(() => setSaveButtonClass(""), 600);
      setTimeout(() => setToast(null), 3000);
      setStatus({ type: "settingsSaved" });
    } catch (error) {
      const errMsg = language === "zh" ? "设置保存失败: " + (error instanceof Error ? error.message : "未知错误") : "Failed to save settings: " + (error instanceof Error ? error.message : "unknown error");
      setRemoteMessage(errMsg);
      setSaveButtonClass("flash-error");
      setToast({ message: errMsg, type: "error" });
      setTimeout(() => setSaveButtonClass(""), 600);
      setTimeout(() => setToast(null), 3000);
    }
  }, [apiKey, desktop, language, loadCustomization, refreshRuntime, settings, t]);

  const switchLanguage = useCallback(async (nextLanguage: AppLanguage) => {
    if (nextLanguage === language) return;
    const nextSettings = { ...settings, language: nextLanguage };
    setSettings(nextSettings);
    const saved = await desktop.saveSettings(nextSettings);
    setSettings(saved);
    setRemoteStatus(await desktop.getRemoteStatus());
    setStatus({ type: "languageSaved" });
    setRemoteMessage(uiCopy[nextLanguage].status.languageSaved);
  }, [desktop, language, settings]);

  const chooseWorkspace = useCallback(async () => {
    const selected = await desktop.chooseDirectory();
    if (selected) {
      const nextSettings = normalizeSettings({ ...settings, workspacePath: selected });
      setSettings(nextSettings);
      setAutomationDraft((current) => current.id ? current : { ...current, workspacePath: selected });
      const selectedProjectId = projectIdFromWorkspace(selected);
      const selectedProject = conversationStore.projects.find((project) => project.id === selectedProjectId);
      const currentSession = findConversationSession(conversationStore, conversationStore.activeSessionId);
      const isEmptySession = currentSession
        && currentSession.title === uiCopy[language].history.untitled
        && currentSession.messages.every((message) => message.role === "assistant");
      let nextSession = selectedProject?.sessions[0] || null;
      let nextStore = nextSession
        ? { ...conversationStore, activeSessionId: nextSession.id }
        : conversationStore;

      if (!nextSession && currentSession && isEmptySession) {
        nextSession = {
          ...currentSession,
          workspacePath: selected,
          updatedAt: new Date().toISOString()
        };
        terminalOutputBySessionRef.current[nextSession.id] = "";
        nextStore = upsertConversationSession(conversationStore, nextSession, language);
      }

      if (!nextSession) {
        nextSession = createConversationSession(selected, language, [createNewConversationMessage(language)]);
        nextStore = upsertConversationSession(conversationStore, nextSession, language);
      }

      applyConversationStore(nextStore);
      activeSessionIdRef.current = nextSession.id;
      setMessages(nextSession.messages.length ? nextSession.messages : [createNewConversationMessage(language)]);
      renderTerminalForSession(nextSession.id);
      setAgentPrompt("");
      setMainView("chat");
      const saved = await desktop.saveSettings(nextSettings);
      setSettings(saved);
      await refreshRuntime(saved);
      setStatus({ type: "settingsSaved" });
    }
  }, [applyConversationStore, conversationStore, desktop, language, refreshRuntime, renderTerminalForSession, settings]);

  const openWorkspaceEditor = useCallback(async (editor: WorkspaceEditor) => {
    const workspacePath = settings.workspacePath.trim();
    if (!workspacePath) {
      setStatus({ type: "error", message: t.topbar.noWorkspace });
      return;
    }

    const result = await desktop.openWorkspaceEditor({ editor, workspacePath });
    if (result.ok) {
      setStatus({ type: "editorOpened", editor: editor === "vscode" ? "VS Code" : "Cursor" });
      return;
    }

    setStatus({ type: "error", message: result.error || t.status.launchFailed });
  }, [desktop, settings.workspacePath, t]);

  const chooseCustomBinary = useCallback(async () => {
    const selected = await desktop.chooseFile();
    if (selected) {
      updateSetting("customBinaryPath", selected);
      updateSetting("binaryMode", "custom");
      await refreshRuntime({ customBinaryPath: selected, binaryMode: "custom" });
    }
  }, [desktop, refreshRuntime, updateSetting]);

  const chooseMcpConfig = useCallback(async () => {
    const selected = await desktop.chooseFile([
      { name: "MCP JSON", extensions: ["json"] }
    ]);
    if (selected) {
      updateSetting("mcpConfigPath", selected);
    }
  }, [desktop, updateSetting]);

  const chooseSkillsDir = useCallback(async () => {
    const selected = await desktop.chooseDirectory();
    if (selected) {
      updateSetting("skillsDir", selected);
    }
  }, [desktop, updateSetting]);

  const chooseAutomationWorkspace = useCallback(async () => {
    const selected = await desktop.chooseDirectory();
    if (selected) {
      setAutomationDraft((current) => ({ ...current, workspacePath: selected }));
    }
  }, [desktop]);

  const newAutomationDraft = useCallback(() => {
    setAutomationDraft(createAutomationDraft(settings));
    setAutomationMessage("");
    setAutomationMessageKind("info");
  }, [settings]);

  const selectAutomationTask = useCallback((task: AutomationTask) => {
    setAutomationDraft(createAutomationDraft(settings, task));
    setAutomationMessage("");
    setAutomationMessageKind("info");
  }, [settings]);

  const applyAutomationResult = useCallback((result: AutomationActionResult, successMessage: string) => {
    setAutomationTasks(result.tasks || []);
    setAutomationMessage(result.ok ? successMessage : result.error || t.automations.failed);
    setAutomationMessageKind(result.ok ? "info" : "error");
    if (result.task) {
      setAutomationDraft(createAutomationDraft(settings, result.task));
    }
    return result.ok;
  }, [settings, t]);

  const saveAutomationDraft = useCallback(async () => {
    setAutomationBusy(true);
    try {
      const minute = clampNumber(automationDraft.minute, 0, 59);
      const hour = clampNumber(automationDraft.hour, 0, 23);
      const name = automationDraft.name.trim() || defaultScheduledTaskName(automationDraft.prompt, language);
      const result = await desktop.saveAutomation({
        settings,
        task: {
          ...automationDraft,
          name,
          minute,
          hour,
          frequency: "daily",
          rrule: `FREQ=DAILY;BYHOUR=${hour};BYMINUTE=${minute}`,
          enabled: automationDraft.status === "ACTIVE"
        }
      });
      applyAutomationResult(result, t.automations.saved);
    } finally {
      setAutomationBusy(false);
    }
  }, [applyAutomationResult, automationDraft, desktop, language, settings, t]);

  const installAutomationTask = useCallback(async (task: AutomationTask) => {
    setAutomationBusy(true);
    try {
      const result = await desktop.installAutomation({ id: task.id, settings });
      applyAutomationResult(result, t.automations.installedOk);
    } finally {
      setAutomationBusy(false);
    }
  }, [applyAutomationResult, desktop, settings, t]);

  const uninstallAutomationTask = useCallback(async (task: AutomationTask) => {
    setAutomationBusy(true);
    try {
      const result = await desktop.uninstallAutomation({ id: task.id, settings });
      applyAutomationResult(result, t.automations.uninstalledOk);
    } finally {
      setAutomationBusy(false);
    }
  }, [applyAutomationResult, desktop, settings, t]);

  const deleteAutomationTask = useCallback(async (task: AutomationTask) => {
    if (!window.confirm(t.automations.confirmDelete)) {
      return;
    }
    setAutomationBusy(true);
    try {
      const result = await desktop.deleteAutomation({ id: task.id });
      if (applyAutomationResult(result, t.automations.deletedOk)) {
        setAutomationDraft(createAutomationDraft(settings));
      }
    } finally {
      setAutomationBusy(false);
    }
  }, [applyAutomationResult, desktop, settings, t]);

  const handleNewTaskClick = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setNewTaskMenuPosition({ x: rect.right, y: rect.top });
    setShowNewTaskMenu(true);
  }, []);

  const handleCloseNewTaskMenu = useCallback(() => {
    setShowNewTaskMenu(false);
  }, []);

  const handleChooseTaskFolder = useCallback(async () => {
    setShowNewTaskMenu(false);
    const selected = await desktop.chooseDirectory();
    if (selected) {
      const nextSession = createConversationSession(selected, language, [createNewConversationMessage(language)]);
      const nextStore = upsertConversationSession(conversationStore, nextSession, language);
      applyConversationStore(nextStore);
      activeSessionIdRef.current = nextSession.id;
      setMessages(nextSession.messages);
      renderTerminalForSession(nextSession.id);
      setAgentPrompt("");
      setMainView("chat");
    }
  }, [applyConversationStore, conversationStore, desktop, language, renderTerminalForSession]);

  const handleUseDefaultFolder = useCallback(() => {
    setShowNewTaskMenu(false);
    if (settings.workspacePath.trim()) {
      const nextSession = createConversationSession(settings.workspacePath, language, [createNewConversationMessage(language)]);
      const nextStore = upsertConversationSession(conversationStore, nextSession, language);
      applyConversationStore(nextStore);
      activeSessionIdRef.current = nextSession.id;
      setMessages(nextSession.messages);
      renderTerminalForSession(nextSession.id);
      setAgentPrompt("");
      setMainView("chat");
    } else {
      const nextSession = createConversationSession("未指定任务", language, [createNewConversationMessage(language)]);
      nextSession.title = "未指定任务";
      const nextStore = upsertConversationSession(conversationStore, nextSession, language);
      applyConversationStore(nextStore);
      activeSessionIdRef.current = nextSession.id;
      setMessages(nextSession.messages);
      renderTerminalForSession(nextSession.id);
      setAgentPrompt("");
      setMainView("chat");
    }
  }, [applyConversationStore, conversationStore, desktop, language, renderTerminalForSession, settings.workspacePath]);

  const updateProvider = useCallback((provider: ProviderMode) => {
    setSettings((current) => ({
      ...current,
      provider,
      baseUrl: defaultBaseUrlForProvider(provider),
      model: provider === "deepseek"
        ? normalizeDeepSeekModelSelection(current.model)
        : current.model || DEFAULT_DEEPSEEK_MODEL
    }));
  }, []);

  const updateModel = useCallback((model: string) => {
    setSettings((current) => ({
      ...current,
      model,
      baseUrl: current.baseUrl || defaultBaseUrlForProvider(current.provider)
    }));
  }, []);

  const launch = useCallback(async (action?: LaunchAction, promptOverride?: string, captureSessionId?: string, replyMessageId?: string) => {
    fitTerminal();
    const launchAction = action || settings.launchAction;
    const prompt = (promptOverride ?? agentPrompt).trim();
    const nextSettings = normalizeSettings({
      ...settings,
      launchAction
    });
    const runtimeSettings = {
      ...nextSettings,
      model: apiModelForProvider(nextSettings.provider, nextSettings.model)
    };
    const terminalSessionId = captureSessionId || activeSessionIdRef.current;
    terminalRunSessionIdRef.current = terminalSessionId;
    if (terminalSessionId) {
      terminalOutputBySessionRef.current[terminalSessionId] = "";
      if (activeSessionIdRef.current === terminalSessionId) {
        renderTerminalForSession(terminalSessionId);
      }
    }
    const shouldCapture = Boolean(prompt) && (launchAction === "exec" || launchAction === "plan" || launchAction === "yolo");
    runCaptureRef.current = shouldCapture ? {
      action: launchAction,
      prompt,
      sessionId: terminalSessionId,
      replyMessageId,
      workspacePath: nextSettings.workspacePath,
      startedAt: new Date().toISOString(),
      output: "",
      thinking: ""
    } : null;

    if (nextSettings.rememberWorkspace) {
      await desktop.saveSettings(nextSettings);
    }
    const launchApiKey = apiKey.trim();
    if (launchApiKey) {
      try {
        const keyResult = await desktop.saveApiKey({ provider: nextSettings.provider, apiKey: launchApiKey });
        if (keyResult !== undefined && keyResult !== null && !keyResult.ok) {
          runCaptureRef.current = null;
          terminalRunSessionIdRef.current = "";
          setStatus({ type: "error", message: keyResult.error || t.settings.apiKeySaveFailed });
          return;
        }
      } catch (error) {
        console.warn("Failed to save API key, continuing anyway:", error);
      }
    }
    setStatus({ type: "launching" });

    // Create a file snapshot before launching for potential rollback
    if (replyMessageId) {
      try {
        await desktop.createFileSnapshot({
          messageId: replyMessageId,
          workspacePath: nextSettings.workspacePath
        });
      } catch (err) {
        console.warn("Failed to create file snapshot:", err);
      }
    }

    let result: { ok: boolean; error?: string; pid?: number; runtime?: object; sessionId?: string };
    try {
      result = await desktop.startTerminal({
        ...runtimeSettings,
        apiKey: launchApiKey || undefined,
        agentPrompt: prompt,
        cols: terminalRef.current?.cols,
        rows: terminalRef.current?.rows
      });
    } catch (err) {
      runCaptureRef.current = null;
      terminalRunSessionIdRef.current = "";
      const errorMsg = typeof err === "string" ? err : err instanceof Error ? err.message : t.status.launchFailed;
      setRunning(false);
      setStatus({ type: "error", message: errorMsg });
      if (replyMessageId && activeSessionIdRef.current === terminalSessionId) {
        setMessages((current) => current.map(m => m.id === replyMessageId
          ? { ...m, content: language === "zh" ? "启动失败: " + errorMsg : "Launch failed: " + errorMsg }
          : m
        ));
      }
      return;
    }
    if (!result.ok) {
      runCaptureRef.current = null;
      terminalRunSessionIdRef.current = "";
      const errorMsg = result.error || t.status.launchFailed;
      setRunning(false);
      setStatus({ type: "error", message: errorMsg });
      if (replyMessageId && activeSessionIdRef.current === terminalSessionId) {
        setMessages((current) => current.map(m => m.id === replyMessageId
          ? { ...m, content: language === "zh" ? "启动失败: " + errorMsg : "Launch failed: " + errorMsg }
          : m
        ));
      }
      return;
    }
    if (result.runtime) {
      setRuntime(result.runtime);
    }
    setRunning(true);
    setStatus({ type: "running", pid: result.pid });
  }, [agentPrompt, apiKey, desktop, fitTerminal, renderTerminalForSession, settings, t]);

  const stop = useCallback(async () => {
    await desktop.stopTerminal();
    setRunning(false);
    terminalRunSessionIdRef.current = "";
    setStatus({ type: "stopped" });
  }, [desktop]);

  const toggleProcessStream = useCallback(() => {
    const nextEnabled = !processStreamEnabled;
    updateSetting("harnessEnabled", nextEnabled);
    setMainView("chat");
    if (!nextEnabled && running) {
      void stop();
    }
    if (nextEnabled) {
      window.requestAnimationFrame(fitTerminal);
    }
  }, [fitTerminal, processStreamEnabled, running, stop, updateSetting]);

  const toggleSkill = useCallback((id: string) => {
    setSettings((current) => {
      const enabled = new Set(current.enabledSkills || []);
      if (enabled.has(id)) {
        enabled.delete(id);
      } else {
        enabled.add(id);
      }
      return { ...current, enabledSkills: Array.from(enabled) };
    });
  }, []);

  const toggleMcp = useCallback((id: string) => {
    setSettings((current) => {
      const enabled = new Set(current.enabledMcpServers || []);
      if (enabled.has(id)) {
        enabled.delete(id);
      } else {
        enabled.add(id);
      }
      return { ...current, enabledMcpServers: Array.from(enabled) };
    });
  }, []);

  const createSkill = useCallback(async () => {
    const result = await desktop.createSkillTemplate({
      settings,
      name: newSkillName,
      description: newSkillDescription
    });
    if (!result.ok || !result.skill) {
      setTemplateMessage(result.error || t.skills.saveFailed);
      return;
    }

    const nextSettings = {
      ...settings,
      enabledSkills: Array.from(new Set([...(settings.enabledSkills || []), result.skill.id]))
    };
    const savedSettings = await desktop.saveSettings(nextSettings);
    setSettings(savedSettings);
    await loadCustomization(savedSettings);
    setNewSkillName("");
    setNewSkillDescription("");
    setStatus({ type: "settingsSaved" });
    setTemplateMessage(t.skills.created(result.path || ""));
  }, [desktop, loadCustomization, newSkillDescription, newSkillName, settings, t]);

  const importSkills = useCallback(async () => {
    const sourcePath = await desktop.chooseDirectory();
    if (!sourcePath) return;
    const result = await desktop.importSkillDirectory({ settings, sourcePath });
    if (!result.ok || !result.skills?.length) {
      setTemplateMessage(result.error || t.skills.importFailed);
      return;
    }

    const importedIds = result.skills.map((skill) => skill.id);
    const nextSettings = {
      ...settings,
      enabledSkills: Array.from(new Set([...(settings.enabledSkills || []), ...importedIds]))
    };
    const savedSettings = await desktop.saveSettings(nextSettings);
    setSettings(savedSettings);
    await loadCustomization(savedSettings);
    setStatus({ type: "settingsSaved" });
    setTemplateMessage(t.skills.imported(importedIds.length));
  }, [desktop, loadCustomization, settings, t]);

  const addCustomMcpServer = useCallback(async () => {
    const id = customMcpId.trim();
    const command = customMcpCommand.trim();
    const url = customMcpUrl.trim();

    if (!/^[A-Za-z0-9_.-]+$/.test(id)) {
      setTemplateMessage(t.mcp.customInvalidId);
      return;
    }
    if (!command && !url) {
      setTemplateMessage(t.mcp.customMissingTarget);
      return;
    }

    try {
      const config = parseMcpConfigDraft(mcpDraft);
      const urlServer = Boolean(url);
      config.servers[id] = {
        command: urlServer ? "" : command,
        args: urlServer ? [] : mcpArgsFromLines(customMcpArgs),
        env: parseMcpEnv(customMcpEnv),
        url: url || null,
        connect_timeout: null,
        execute_timeout: null,
        read_timeout: null,
        disabled: false,
        enabled: true,
        required: false,
        enabled_tools: [],
        disabled_tools: []
      };
      const content = JSON.stringify(config, null, 2);
      const result = await desktop.saveMcpConfig({
        settings,
        content
      });
      if (!result.ok || !result.path) {
        setTemplateMessage(result.error || t.mcp.configFailed);
        return;
      }
      const nextSettings = { ...settings, mcpConfigPath: result.path };
      const savedSettings = await desktop.saveSettings(nextSettings);
      setSettings(savedSettings);
      const draft = await loadCustomization(savedSettings);
      setCustomization(draft);
      setMcpDraft(result.content || draft.mcpConfigText || content);
      setMcpTestResult(null);
      setCustomMcpId("");
      setCustomMcpArgs("");
      setCustomMcpUrl("");
      setCustomMcpEnv("{}");
      setStatus({ type: "settingsSaved" });
      setTemplateMessage(t.mcp.customAdded(id));
    } catch {
      setTemplateMessage(t.mcp.customInvalidJson);
    }
  }, [customMcpArgs, customMcpCommand, customMcpEnv, customMcpId, customMcpUrl, desktop, loadCustomization, mcpDraft, settings, t]);

  const testMcpServers = useCallback(async () => {
    setMcpTesting(true);
    try {
      const result = await desktop.testMcpServers({ settings });
      setMcpTestResult(result);
      setTemplateMessage(result.servers.length === 0
        ? t.mcp.noServers
        : result.ok ? t.mcp.testOk : result.error || t.mcp.testFailed);
    } finally {
      setMcpTesting(false);
    }
  }, [desktop, settings, t]);

  const sendPrompt = useCallback(async () => {
    const prompt = agentPrompt.trim();
    if (!prompt) return;

    const assistantContent = agentMode === "plan"
      ? language === "zh" ? "正在规划..." : "Planning..."
      : language === "zh" ? "正在运行..." : "Running...";
    const launchAction: LaunchAction = agentMode === "plan" ? "plan" : agentMode === "yolo" ? "yolo" : "exec";
    const replyMessageId = createId();

    const nextMessages: ChatMessage[] = [
      ...messages,
      { id: createId(), role: "user", content: prompt },
      {
        id: replyMessageId,
        role: "assistant",
        content: assistantContent
      }
    ];
    setMessages(nextMessages);
    commitConversationStore((current) => {
      const session = findConversationSession(current, current.activeSessionId)
        || createConversationSession(settings.workspacePath, language, [createWelcomeMessage(language)]);
      const isUntitled = !session.title || session.title === uiCopy[language].history.untitled;
      return upsertConversationSession(current, {
        ...session,
        workspacePath: settings.workspacePath,
        title: isUntitled ? titleFromPrompt(prompt, uiCopy[language].history.untitled) : session.title,
        updatedAt: new Date().toISOString(),
        messages: nextMessages
      }, language);
    });
    setAgentPrompt("");
    await launch(launchAction, prompt, conversationStore.activeSessionId, replyMessageId);
  }, [agentMode, agentPrompt, commitConversationStore, conversationStore.activeSessionId, language, launch, messages, settings.workspacePath, t]);

  const handleComposerKeyDown = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!shouldSubmitComposerShortcut(event)) return;
    event.preventDefault();
    void sendPrompt();
  }, [sendPrompt]);

  const createProjectConversation = useCallback((workspacePath: string) => {
    const nextMessages = [createNewConversationMessage(language)];
    const session = createConversationSession(workspacePath, language, nextMessages);
    applyConversationStore(upsertConversationSession(conversationStore, session, language));
    activeSessionIdRef.current = session.id;
    renderTerminalForSession(session.id);
    setSettings((current) => ({ ...current, workspacePath }));
    setMessages(nextMessages);
    setAgentPrompt("");
    setMainView("chat");
    setStatus({ type: "ready" });
  }, [applyConversationStore, conversationStore, language, renderTerminalForSession]);

  const newConversation = useCallback(() => {
    createProjectConversation(settings.workspacePath);
  }, [createProjectConversation, settings.workspacePath]);

  const selectProject = useCallback((project: ConversationProject) => {
    if (!project.workspacePath.trim()) return;
    const session = project.sessions[0];
    applyConversationStore({
      ...conversationStore,
      activeSessionId: session?.id || conversationStore.activeSessionId
    });
    activeSessionIdRef.current = session?.id || conversationStore.activeSessionId;
    setSettings((current) => ({ ...current, workspacePath: project.workspacePath }));
    setMessages(session?.messages.length ? session.messages : [createNewConversationMessage(language)]);
    renderTerminalForSession(session?.id);
    setAgentPrompt("");
    setMainView("chat");
  }, [applyConversationStore, conversationStore, language, renderTerminalForSession]);

  const selectConversation = useCallback((sessionId: string) => {
    const session = findConversationSession(conversationStore, sessionId);
    if (!session) return;
    applyConversationStore({ ...conversationStore, activeSessionId: sessionId });
    activeSessionIdRef.current = session.id;
    setMessages(session.messages.length ? session.messages : [createWelcomeMessage(language)]);
    renderTerminalForSession(session.id);
    setAgentPrompt("");
    setMainView("chat");
    if (session.workspacePath) {
      setSettings((current) => ({ ...current, workspacePath: session.workspacePath }));
    }
  }, [applyConversationStore, conversationStore, language, renderTerminalForSession]);

  const removeConversation = useCallback((sessionId: string) => {
    const nextStore = deleteConversationSession(conversationStore, sessionId);
    const nextSession = findConversationSession(nextStore, nextStore.activeSessionId);
    delete terminalOutputBySessionRef.current[sessionId];
    applyConversationStore(nextStore);
    activeSessionIdRef.current = nextSession?.id || "";
    setMessages(nextSession?.messages.length ? nextSession.messages : [createWelcomeMessage(language)]);
    renderTerminalForSession(nextSession?.id);
    if (nextSession?.workspacePath) {
      setSettings((current) => ({ ...current, workspacePath: nextSession.workspacePath }));
    }
  }, [applyConversationStore, conversationStore, language, renderTerminalForSession]);

  const restartRemoteBridge = useCallback(async () => {
    const nextStatus = await desktop.restartRemoteBridge();
    setRemoteStatus(nextStatus);
    setRemoteMessage(nextStatus.running ? t.remote.running : t.remote.stopped);
  }, [desktop, t]);

  const rotateRemoteToken = useCallback(async () => {
    const result = await desktop.rotateRemoteToken();
    setSettings(result.settings);
    setRemoteStatus(result.status);
    setRemoteMessage(t.remote.tokenUpdated);
  }, [desktop, t]);

  const loginRemoteAccount = useCallback(async () => {
    const accountId = loginAccount.trim();
    if (!accountId) {
      setRemoteMessage(t.remote.loginRequired);
      return;
    }
    const result = await desktop.loginRemoteAccount({
      accountId,
      email: accountId,
      displayName: loginDisplayName.trim()
    });
    if (result.status) setRemoteStatus(result.status);
    setRemoteMessage(result.ok ? t.remote.loginSaved : result.error || t.remote.loginRequired);
  }, [desktop, loginAccount, loginDisplayName, t]);

  const logoutRemoteAccount = useCallback(async () => {
    const result = await desktop.logoutRemoteAccount();
    if (result.status) setRemoteStatus(result.status);
    setPairingCode("");
    setRemoteMessage(result.ok ? t.remote.logoutSaved : result.error || t.remote.logoutSaved);
  }, [desktop, t]);

  const startRemotePairing = useCallback(async () => {
    const result = await desktop.startRemotePairing();
    if (result.status) setRemoteStatus(result.status);
    if (result.ok && result.pairing) {
      setPairingCode(result.pairing.code);
      setRemoteMessage(t.remote.pairingStarted);
      return;
    }
    setRemoteMessage(result.error || t.remote.pairingFailed);
  }, [desktop, t]);

  const revokeRemoteDevice = useCallback(async (deviceId: string) => {
    const result = await desktop.revokeRemoteDevice(deviceId);
    if (result.status) setRemoteStatus(result.status);
    setRemoteMessage(result.ok ? t.remote.deviceRevoked : result.error || t.remote.deviceRevoked);
  }, [desktop, t]);

  const pushTestUpdateNotice = useCallback(async () => {
    const result = await desktop.pushUpdateNotice({
      accountId: remoteStatus?.auth.account?.accountId,
      version: "test",
      title: t.remote.testUpdateTitle,
      body: t.remote.testUpdateBody
    });
    setRemoteStatus(await desktop.getRemoteStatus());
    setRemoteMessage(result.ok ? t.remote.testUpdateSent : result.error || t.remote.testUpdateFailed);
  }, [desktop, remoteStatus?.auth.account?.accountId, t]);

  const copyRemoteText = useCallback(async (value: string, label: string) => {
    if (!value) return;
    await navigator.clipboard?.writeText(value);
    setRemoteMessage(t.remote.copied(label));
  }, [t]);

  const applyGitResult = useCallback((result: GitActionResult, successMessage: string) => {
    if (result.status) {
      setGitStatus(result.status);
      if (result.status.originUrl) {
        setGitRemoteUrl(result.status.originUrl);
      }
    }
    setGitMessage(result.ok ? successMessage : result.error || result.output || t.git.actionFailed);
    setGitMessageKind(result.ok ? "info" : "error");
    return result.ok;
  }, [t]);

  const refreshGitStatus = useCallback(async () => {
    setGitBusy(true);
    try {
      const result = await loadGitStatus();
      setGitMessage(result.ok ? "" : result.error || t.git.actionFailed);
      setGitMessageKind(result.ok ? "info" : "error");
    } finally {
      setGitBusy(false);
    }
  }, [loadGitStatus, t]);

  const initGitRepository = useCallback(async () => {
    setGitBusy(true);
    try {
      const result = await desktop.initGitRepository(settings.workspacePath);
      applyGitResult(result, t.git.initOk);
    } finally {
      setGitBusy(false);
    }
  }, [applyGitResult, desktop, settings.workspacePath, t]);

  const saveGitRemote = useCallback(async () => {
    setGitBusy(true);
    try {
      const result = await desktop.setGitRemote({
        workspacePath: settings.workspacePath,
        remoteUrl: gitRemoteUrl
      });
      applyGitResult(result, t.git.remoteOk);
    } finally {
      setGitBusy(false);
    }
  }, [applyGitResult, desktop, gitRemoteUrl, settings.workspacePath, t]);

  const runGitRepositoryAction = useCallback(async (action: "fetch" | "pull" | "push") => {
    setGitBusy(true);
    try {
      const payload = { workspacePath: settings.workspacePath };
      const result = action === "fetch"
        ? await desktop.fetchGitRepository(payload)
        : action === "pull"
          ? await desktop.pullGitRepository(payload)
          : await desktop.pushGitRepository(payload);
      const successMessage = action === "fetch" ? t.git.fetchOk : action === "pull" ? t.git.pullOk : t.git.pushOk;
      applyGitResult(result, successMessage);
    } finally {
      setGitBusy(false);
    }
  }, [applyGitResult, desktop, settings.workspacePath, t]);

  const commitGitRepository = useCallback(async () => {
    setGitBusy(true);
    try {
      const result = await desktop.commitGitRepository({
        workspacePath: settings.workspacePath,
        message: gitCommitMessage
      });
      if (applyGitResult(result, t.git.commitOk)) {
        setGitCommitMessage("");
      }
    } finally {
      setGitBusy(false);
    }
  }, [applyGitResult, desktop, gitCommitMessage, settings.workspacePath, t]);

  const previewGitDiffSummary = useCallback(async () => {
    setGitDiffBusy(true);
    try {
      const result = await desktop.getGitDiffSummary({ workspacePath: settings.workspacePath });
      if (result.status) {
        setGitStatus(result.status);
      }
      setGitDiffSummary(result.output || result.error || "");
      setGitMessage(result.ok ? t.git.previewOk : result.error || t.git.actionFailed);
      setGitMessageKind(result.ok ? "info" : "error");
    } finally {
      setGitDiffBusy(false);
    }
  }, [desktop, settings.workspacePath, t]);

  const copyGitRemote = useCallback(async () => {
    const value = gitStatus?.originUrl || gitRemoteUrl;
    if (!value) return;
    await navigator.clipboard?.writeText(value);
    setGitMessage(t.git.copied);
    setGitMessageKind("info");
  }, [gitRemoteUrl, gitStatus?.originUrl, t]);

  const openToolPage = useCallback((page: ToolPage) => {
    setInspectorPanel(null);
    setToolPage(page);
    setMainView("tools");
  }, []);

  const openScheduledTasksPage = useCallback(() => {
    setInspectorPanel(null);
    setMainView("tasks");
  }, []);

  const toggleInspectorPanel = useCallback((panel: Exclude<InspectorPanel, null>) => {
    setInspectorPanel((current) => current === panel ? null : panel);
  }, []);

  const messageListClassName = mainView === "tools" || mainView === "tasks" || mainView === "agents" ? "message-list tool-message-list" : "message-list";
  const conversationLayoutClassName = processStreamEnabled ? "conversation-layout" : "conversation-layout process-panel-collapsed";
  const terminalCardClassName = mainView === "terminal"
    ? "terminal-card terminal-expanded"
    : mainView === "tools" || mainView === "tasks" || mainView === "agents"
      ? "terminal-card terminal-hidden"
      : "terminal-card process-panel";
  const runtimeEventList = runtimeSnapshot.events.length > 0 ? runtimeSnapshot.events : runtimeEvents;
  const terminalPanel = (
    <section className={terminalCardClassName}>
      <div className="terminal-toolbar">
        <div className="status-line">
          <span className={`dot ${running ? "live" : ""}`} />
          <span>{statusText}</span>
        </div>
        <div className="quick-row process-actions">
          {running ? (
            <button type="button" title={t.terminal.stop} onClick={stop}>
              <Square size={14} aria-hidden />
            </button>
          ) : null}
          <button
            type="button"
            title={t.terminal.clear}
            onClick={() => {
              const sessionId = activeSessionIdRef.current;
              if (sessionId) {
                terminalOutputBySessionRef.current[sessionId] = "";
              }
              renderTerminalForSession(sessionId);
            }}
          >
            <RotateCcw size={14} aria-hidden />
          </button>
        </div>
      </div>
      <div ref={terminalHostRef} className="terminal-host" />
    </section>
  );

  const agentsPanel = (
    <section className="agents-panel">
      <div className="tool-section-head">
        <div>
          <h3>{t.runtimeAgents.title}</h3>
          <p>{t.runtimeAgents.subtitle}</p>
        </div>
        <span className={`status-chip runtime-${runtimeSnapshot.status}`}>
          {runtimeStatusText(runtimeSnapshot.status, language)}
        </span>
      </div>
      <div className="runtime-summary-grid">
        <article>
          <Activity size={18} aria-hidden />
          <span>{t.runtimeAgents.status}</span>
          <strong>{runtimeStatusText(runtimeSnapshot.status, language)}</strong>
        </article>
        <article>
          <Bot size={18} aria-hidden />
          <span>Agents</span>
          <strong>{runtimeSnapshot.counts.total}</strong>
        </article>
        <article>
          <Server size={18} aria-hidden />
          <span>{t.runtimeAgents.source}</span>
          <strong>{runtimeSnapshot.source}</strong>
        </article>
      </div>
      <div className="runtime-meta-row">
        <span>{t.runtimeAgents.mode}: <strong>{runtimeSnapshot.mode || "-"}</strong></span>
        <span>{t.runtimeAgents.started}: <strong>{formatSessionTime(runtimeSnapshot.startedAt, language) || "-"}</strong></span>
        <span>{t.runtimeAgents.workspace}: <strong>{projectNameFromWorkspace(runtimeSnapshot.workspacePath, language)}</strong></span>
      </div>
      <div className="runtime-counts">
        {t.runtimeAgents.counts(runtimeSnapshot.counts.running, runtimeSnapshot.counts.completed, runtimeSnapshot.counts.failed)}
      </div>
      <div className="agent-list">
        {runtimeSnapshot.agents.length === 0 ? (
          <p className="history-empty">{t.runtimeAgents.noAgents}</p>
        ) : runtimeSnapshot.agents.map((agent) => (
          <article key={agent.id} className="agent-runtime-row">
            <div className="agent-runtime-main">
              <span className="preset-icon"><Bot size={16} aria-hidden /></span>
              <div>
                <strong>{agent.name}</strong>
                <small>{agent.summary || agent.id}</small>
              </div>
            </div>
            <span className={`status-chip agent-${agent.status}`}>
              {runtimeStatusText(agent.status, language)}
            </span>
          </article>
        ))}
      </div>
      <section className="runtime-events">
        <div className="tool-section-head compact">
          <div>
            <h3>{t.runtimeAgents.recentEvents}</h3>
          </div>
        </div>
        {runtimeEventList.length === 0 ? (
          <p className="history-empty">{t.runtimeAgents.noEvents}</p>
        ) : (
          <ol>
            {runtimeEventList.slice(-8).reverse().map((event) => (
              <li key={event.id}>
                <span>{formatSessionTime(event.at, language)}</span>
                <strong>{event.label}</strong>
                {event.detail ? <small>{event.detail}</small> : null}
              </li>
            ))}
          </ol>
        )}
      </section>
    </section>
  );

  const skillsToolPage = (
    <section className="tool-editor-page">
      <section className={skillsRuntimeReady ? "runtime-toggle-card enabled" : "runtime-toggle-card"}>
        <label className="check-row">
          <input
            type="checkbox"
            checked={settings.skillsEnabled}
            onChange={(event) => updateSetting("skillsEnabled", event.target.checked)}
          />
          <span>{t.skills.enableRuntime}</span>
        </label>
        <small>{t.skills.runtimeHint}</small>
      </section>
      <section className="template-editor compact-editor">
        <div className="template-editor-head">
          <div>
            <strong>{t.skills.createTitle}</strong>
            <small>{customization?.skillRoot || ""}</small>
          </div>
          <button type="button" className="secondary" onClick={importSkills}>
            <UploadCloud size={15} aria-hidden />
            {t.skills.importSkill}
          </button>
        </div>
        <label>
          {t.skills.createName}
          <input
            value={newSkillName}
            onChange={(event) => setNewSkillName(event.target.value)}
            placeholder={t.skills.createNamePlaceholder}
            spellCheck={false}
          />
        </label>
        <label>
          {t.skills.createDescription}
          <input
            value={newSkillDescription}
            onChange={(event) => setNewSkillDescription(event.target.value)}
            placeholder={t.skills.createDescriptionPlaceholder}
            spellCheck={false}
          />
        </label>
        <button type="button" className="primary wide" onClick={createSkill} disabled={!newSkillName.trim()}>
          <Plus size={16} aria-hidden />
          {t.skills.createSkill}
        </button>
      </section>
      {skillCatalog.map((skill) => {
        const enabled = settings.enabledSkills.includes(skill.id);
        const Icon = iconForSkill(skill);
        return (
          <button
            type="button"
            key={skill.id}
            className={enabled ? "preset-card enabled" : "preset-card"}
            onClick={() => toggleSkill(skill.id)}
          >
            <span className="preset-icon"><Icon size={18} aria-hidden /></span>
            <span>
              <strong>{skill.name}</strong>
              <small>{skill.description}</small>
              <span className="preset-meta">
                <b>{skill.category}</b>
                {skill.tools.map((tool) => <b key={tool}>{tool}</b>)}
              </span>
            </span>
            <span className={enabled ? "switch on" : "switch"} />
          </button>
        );
      })}
      {templateMessage ? <p className="template-message">{templateMessage}</p> : null}
      <div className="path-picker">
        <input
          value={settings.skillsDir}
          onChange={(event) => updateSetting("skillsDir", event.target.value)}
          placeholder={t.skills.customDirPlaceholder}
          spellCheck={false}
        />
        <button type="button" title={t.skills.chooseDir} onClick={chooseSkillsDir}>
          <FolderOpen size={16} aria-hidden />
        </button>
      </div>
      <button type="button" className="secondary wide" onClick={saveSettings}>
        {t.skills.save}
      </button>
    </section>
  );

  const mcpToolPage = (
    <section className="tool-editor-page">
      <div className="tool-help">
        <BookOpen size={17} aria-hidden />
        <div>
          <strong>{t.mcp.helpTitle}</strong>
          <p>{t.mcp.helpBody}</p>
        </div>
      </div>

	      <section className={mcpRuntimeReady ? "runtime-toggle-card enabled" : "runtime-toggle-card"}>
	        <label className="check-row">
	          <input
	            type="checkbox"
	            checked={settings.mcpEnabled}
            onChange={(event) => updateSetting("mcpEnabled", event.target.checked)}
          />
          <span>{t.mcp.enableRuntime}</span>
        </label>
	        <small>{settings.mcpEnabled ? (mcpRuntimeReady ? t.mcp.runtimeOn : t.mcp.runtimePending) : t.mcp.runtimeOff}</small>
	        <p>{t.mcp.runtimeHint}</p>
	      </section>

	      <section className="template-editor custom-mcp-builder">
	        <div className="template-editor-head">
	          <div>
	            <strong>{t.mcp.customTitle}</strong>
	            <small>{t.mcp.customHint}</small>
	          </div>
	          <span className="status-chip">{t.mcp.sourceCustom}</span>
	        </div>
	        <div className="custom-mcp-grid">
	          <label>
	            {t.mcp.customId}
	            <input
	              value={customMcpId}
	              onChange={(event) => setCustomMcpId(event.target.value)}
	              placeholder={t.mcp.customIdPlaceholder}
	              spellCheck={false}
	            />
	          </label>
	          <label>
	            {t.mcp.customCommand}
	            <input
	              value={customMcpCommand}
	              onChange={(event) => setCustomMcpCommand(event.target.value)}
	              placeholder={t.mcp.customCommandPlaceholder}
	              spellCheck={false}
	            />
	          </label>
	          <label className="wide-field">
	            {t.mcp.customUrl}
	            <input
	              value={customMcpUrl}
	              onChange={(event) => setCustomMcpUrl(event.target.value)}
	              placeholder={t.mcp.customUrlPlaceholder}
	              spellCheck={false}
	            />
	          </label>
	          <label className="wide-field">
	            {t.mcp.customArgs}
	            <textarea
	              value={customMcpArgs}
	              onChange={(event) => setCustomMcpArgs(event.target.value)}
	              placeholder={t.mcp.customArgsPlaceholder}
	              spellCheck={false}
	            />
	          </label>
	          <label className="wide-field">
	            {t.mcp.customEnv}
	            <textarea
	              value={customMcpEnv}
	              onChange={(event) => setCustomMcpEnv(event.target.value)}
	              placeholder={t.mcp.customEnvPlaceholder}
	              spellCheck={false}
	            />
	          </label>
	        </div>
	        <button type="button" className="primary wide" onClick={addCustomMcpServer}>
	          <Plus size={16} aria-hidden />
	          {t.mcp.addCustom}
	        </button>
	      </section>

	      <input
	        value={mcpSearch}
        onChange={(event) => setMcpSearch(event.target.value)}
        placeholder={t.mcp.searchPlaceholder}
        spellCheck={false}
      />

      <div className="category-row">
        {mcpCategories.map((category) => (
          <button
            type="button"
            key={category}
            className={mcpCategory === category ? "active" : ""}
            onClick={() => setMcpCategory(category)}
          >
            {t.category[category]}
          </button>
        ))}
      </div>

      <div className="mcp-summary-row">
        <span>{t.mcp.summaryEnabled(enabledMcpCount)}</span>
        <span>{t.mcp.summaryVisible(filteredMcpPresets.length)}</span>
        <span>{t.mcp.summaryInstalled(mcpPresets.length)}</span>
      </div>

      <button type="button" className="secondary wide" onClick={testMcpServers} disabled={mcpTesting}>
        <Activity size={16} aria-hidden />
        {mcpTesting ? t.mcp.testing : t.mcp.test}
      </button>

      {mcpTestResult ? (
        <section className="mcp-test-list">
          {mcpTestResult.servers.length === 0 ? <p>{t.mcp.noServers}</p> : null}
          {mcpTestResult.servers.map((server) => {
            const preset = mcpPresets.find((candidate) => candidate.id === server.id);
            const serverName = preset ? getMcpText(preset, language).name : server.id;
            return (
              <div key={server.id} className="mcp-test-row">
                <div>
                  <strong>{serverName}</strong>
                  <span className={server.ok ? "status-chip enabled" : "status-chip warning"}>
                    {server.ok ? t.mcp.testOk : t.mcp.testFailed}
                  </span>
                </div>
	                <code>{server.url || [server.command, ...server.args].filter(Boolean).join(" ")}</code>
                {server.warnings.length > 0 ? (
                  <ul>
                    {server.warnings.map((warning) => <li key={warning}>{warning}</li>)}
                  </ul>
                ) : null}
              </div>
            );
          })}
        </section>
      ) : null}

	      {filteredMcpPresets.map((preset) => {
	        const enabled = settings.enabledMcpServers.includes(preset.id);
	        const Icon = iconForMcp(preset.id);
	        const presetText = getMcpText(preset, language);
	        return (
          <button
            type="button"
            key={preset.id}
            className={enabled ? `preset-card enabled ${preset.accent}` : `preset-card ${preset.accent}`}
            onClick={() => toggleMcp(preset.id)}
          >
            <span className="preset-icon"><Icon size={18} aria-hidden /></span>
            <span>
              <strong>{presetText.name}</strong>
              <small>{presetText.description}</small>
              <code>{preset.command}</code>
              <em>{presetText.envHint}</em>
              <span className="preset-meta">
                <b>{t.category[preset.category]}</b>
                <b>{formatDownloads(preset.downloads, language)}</b>
                <b>{t.safety[preset.safety]} {t.mcp.riskSuffix}</b>
              </span>
            </span>
            <span className={enabled ? "switch on" : "switch"} />
	          </button>
	        );
	      })}
      {templateMessage ? <p className="template-message">{templateMessage}</p> : null}
      <div className="path-picker">
        <input
          value={settings.mcpConfigPath}
          onChange={(event) => updateSetting("mcpConfigPath", event.target.value)}
          placeholder={t.mcp.customConfigPlaceholder}
          spellCheck={false}
        />
        <button type="button" title={t.mcp.chooseConfig} onClick={chooseMcpConfig}>
          <FileCog size={16} aria-hidden />
        </button>
      </div>
      <button type="button" className="secondary wide" onClick={saveSettings}>
        {t.mcp.save}
      </button>
    </section>
  );

  const scheduledTasksPage = (
    <section className="tool-editor-page scheduled-task-page">
      <div className="tool-help">
        <CalendarClock size={17} aria-hidden />
        <div>
          <strong>{t.automations.helpTitle}</strong>
          <p>{t.automations.helpBody}</p>
        </div>
      </div>

      <section className="template-editor automation-editor">
        <div className="template-editor-head">
          <div>
            <strong>{automationDraft.id ? automationDraft.name || defaultScheduledTaskName(automationDraft.prompt, language) : t.automations.newTask}</strong>
            <small>{automationSchedulePreview(automationDraft, language)}</small>
          </div>
          <span className={automationDraft.status === "ACTIVE" ? "status-chip enabled" : "status-chip"}>
            {automationDraft.status === "ACTIVE" ? t.automations.active : t.automations.paused}
          </span>
        </div>

        <label>
          {t.automations.prompt}
          <textarea
            value={automationDraft.prompt}
            onChange={(event) => setAutomationDraft((current) => ({ ...current, prompt: event.target.value }))}
            placeholder={t.automations.promptPlaceholder}
            rows={5}
          />
        </label>

        <label>
          {t.automations.workspace}
          <span className="path-picker">
            <input
              value={automationDraft.workspacePath}
              onChange={(event) => setAutomationDraft((current) => ({ ...current, workspacePath: event.target.value }))}
              placeholder={settings.workspacePath || t.topbar.noWorkspace}
              spellCheck={false}
            />
            <button type="button" title={t.automations.chooseWorkspace} onClick={chooseAutomationWorkspace}>
              <FolderOpen size={16} aria-hidden />
            </button>
          </span>
        </label>

        <div className="automation-time-grid simple">
          <label>
            {t.automations.scheduleTime}
            <input
              type="time"
              value={automationTimeValue(automationDraft.hour, automationDraft.minute)}
              onChange={(event) => setAutomationDraft((current) => ({ ...current, ...parseAutomationTime(event.target.value) }))}
            />
          </label>
          <label className="check-row scheduled-task-toggle">
            <input
              type="checkbox"
              checked={automationDraft.status === "ACTIVE"}
              onChange={(event) => setAutomationDraft((current) => ({ ...current, status: event.target.checked ? "ACTIVE" : "PAUSED" }))}
            />
            <span>{t.automations.enableTask}</span>
          </label>
        </div>

        <div className="automation-preview">
          <span>{t.automations.schedulePreview}</span>
          <code>{automationSchedulePreview(automationDraft, language)}</code>
        </div>

        <div className="template-actions">
          <button type="button" className="secondary" onClick={newAutomationDraft} disabled={automationBusy}>
            <Plus size={16} aria-hidden />
            {t.automations.newTask}
          </button>
          <button
            type="button"
            className="primary"
            onClick={saveAutomationDraft}
            disabled={automationBusy || !automationDraft.prompt.trim()}
          >
            <CheckCircle2 size={16} aria-hidden />
            {t.automations.save}
          </button>
        </div>
      </section>

      {automationMessage ? (
        <p className={automationMessageKind === "error" ? "template-message error" : "template-message"}>{automationMessage}</p>
      ) : null}

      <section className="automation-list">
        <div className="automation-list-head">
          <strong>{t.automations.listTitle}</strong>
          <small>{automationTasks.length}</small>
        </div>
        {automationTasks.length === 0 ? <p>{t.automations.noTasks}</p> : null}
        {automationTasks.map((task) => {
          const taskStatus = automationStatus(task);
          return (
          <article key={task.id} className={taskStatus === "ACTIVE" ? "automation-card installed" : "automation-card"}>
            <button type="button" className="automation-card-main" onClick={() => selectAutomationTask(task)}>
              <span className="preset-icon"><CalendarClock size={18} aria-hidden /></span>
              <span>
                <strong>{task.name}</strong>
                <small>{automationSchedulePreview(createAutomationDraft(settings, task), language)}</small>
              </span>
              <span className={taskStatus === "ACTIVE" ? "status-chip enabled" : "status-chip"}>
                {taskStatus === "ACTIVE" ? t.automations.installed : t.automations.draft}
              </span>
            </button>
            <div className="automation-paths">
              <span>{t.automations.workspace}</span>
              <code title={task.workspacePath}>{task.workspacePath || "-"}</code>
              {task.lastGeneratedAt ? (
                <>
                  <span>{t.automations.lastGenerated}</span>
                  <code>{formatAutomationTime(task.lastGeneratedAt, language)}</code>
                </>
              ) : null}
              {task.lastInstalledAt ? (
                <>
                  <span>{t.automations.lastInstalled}</span>
                  <code>{formatAutomationTime(task.lastInstalledAt, language)}</code>
                </>
              ) : null}
            </div>
            {task.commandPreview && task.error ? (
              <div className="automation-command">
                <span>{t.automations.localRunner}</span>
                <code title={task.commandPreview}>{task.commandPreview}</code>
              </div>
            ) : null}
            {task.error ? <p className="template-message error">{task.error}</p> : null}
            <div className="automation-actions">
              {taskStatus === "ACTIVE" ? (
                <button type="button" className="secondary" onClick={() => uninstallAutomationTask(task)} disabled={automationBusy}>
                  <Square size={16} aria-hidden />
                  {t.automations.uninstall}
                </button>
              ) : (
                <button type="button" className="primary" onClick={() => installAutomationTask(task)} disabled={automationBusy}>
                  <CalendarClock size={16} aria-hidden />
                  {t.automations.install}
                </button>
              )}
              <button type="button" className="secondary danger" onClick={() => deleteAutomationTask(task)} disabled={automationBusy}>
                <Trash2 size={16} aria-hidden />
                {t.automations.delete}
              </button>
            </div>
          </article>
          );
        })}
      </section>
    </section>
  );

  const inspectorDrawerPanel =
    inspectorPanel === "remote" || inspectorPanel === "git" || inspectorPanel === "settings"
      ? inspectorPanel
      : null;

  return (
    <main className="app-shell">
      <aside className="conversation-sidebar">
        <section className="brand-row">
          <div className="brand-mark">
            <Bot size={21} aria-hidden />
          </div>
          <div>
            <h1>GZDSCode</h1>
            <p>Desktop-1.0.1-39</p>
          </div>
        </section>

        <button type="button" className="new-chat-button" onClick={newConversation}>
          <Plus size={17} aria-hidden />
          {t.sidebar.newChat}
        </button>

        <div className="tasks-section">
          <div className="tasks-header">
            <button type="button" className="tasks-title-button">
              <span className="tasks-title">任务</span>
            </button>
            <div className="tasks-actions">
              <button
                type="button"
                className="task-action-button"
                title="新建任务"
                onClick={handleNewTaskClick}
              >
                <Plus size={14} aria-hidden />
              </button>
              <button
                type="button"
                className="task-action-button"
                title={tasksCollapsed ? "展开任务列表" : "折叠任务列表"}
                onClick={() => setTasksCollapsed(!tasksCollapsed)}
              >
                {tasksCollapsed ? <ChevronDown size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden style={{ transform: 'rotate(180deg)' }} />}
              </button>
            </div>
          </div>
          {!tasksCollapsed && automationTasks.length > 0 && (
            <div className="tasks-list">
              {automationTasks.map((task) => (
                <div key={task.id} className="task-list-item">
                  <button type="button" className="task-list-main" onClick={() => selectAutomationTask(task)}>
                    <CalendarClock size={14} aria-hidden />
                    <span>
                      <b>{task.name || t.automations.taskNamePlaceholder}</b>
                      <small>{task.workspacePath ? projectNameFromWorkspace(task.workspacePath, language) : ""}</small>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="task-delete-button"
                    title={t.automations.delete}
                    onClick={() => deleteAutomationTask(task)}
                  >
                    <Trash2 size={12} aria-hidden />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {!tasksCollapsed && (
          <nav className="history-tree" aria-label={t.sidebar.navLabel}>
            {conversationStore.projects.length === 0 ? (
            <p className="history-empty">{t.history.empty}</p>
          ) : null}
          {conversationStore.projects.map((project) => {
            const projectIsSelected = projectIdFromWorkspace(project.workspacePath) === selectedProjectId
              || project.sessions.some((session) => session.id === conversationStore.activeSessionId);
            return (
            <section key={project.id} className="project-group">
              <div className={projectIsSelected ? "project-header active" : "project-header"} title={project.workspacePath || project.name}>
                <button
                  type="button"
                  className="project-select-button"
                  title={`${t.history.selectProject}: ${project.name}`}
                  aria-label={`${t.history.selectProject}: ${project.name}`}
                  onClick={() => selectProject(project)}
                  disabled={!project.workspacePath.trim()}
                >
                  <FolderOpen size={15} aria-hidden />
                  <span>{project.name}</span>
                  <small>{project.sessions.length}</small>
                </button>
                <button
                  type="button"
                  className="project-new-chat-button"
                  title={t.history.newProjectSession}
                  aria-label={t.history.newProjectSession}
                  onClick={() => createProjectConversation(project.workspacePath)}
                  disabled={!project.workspacePath.trim()}
                >
                  <Plus size={13} aria-hidden />
                </button>
              </div>
              <div className="chat-list">
                {project.sessions.map((session) => (
                  <div
                    key={session.id}
                    className={session.id === conversationStore.activeSessionId ? "chat-list-item active" : "chat-list-item"}
                  >
                    <button type="button" className="chat-list-main" onClick={() => selectConversation(session.id)}>
                      <MessageSquare size={16} aria-hidden />
                      <span>
                        <b>{session.title || t.history.untitled}</b>
                        <small>{formatSessionTime(session.updatedAt, language)}</small>
                      </span>
                    </button>
                    <button
                      type="button"
                      className="chat-delete-button"
                      title={t.history.deleteSession}
                      onClick={() => removeConversation(session.id)}
                    >
                      <Trash2 size={14} aria-hidden />
                    </button>
                  </div>
                ))}
              </div>
            </section>
            );
          })}
        </nav>
        )}

        <div className="sidebar-spacer" />

        <section className="sidebar-actions">
          <button
            type="button"
            className={mainView === "agents" ? "sidebar-tool active" : "sidebar-tool"}
            onClick={() => {
              setInspectorPanel(null);
              setMainView("agents");
            }}
          >
            <Bot size={16} aria-hidden />
            {t.topbar.agents}
            <span className="sidebar-badge">{runtimeSnapshot.counts.total}</span>
          </button>
          <button
            type="button"
            className={mainView === "tools" && toolPage === "skills" ? "sidebar-tool active" : "sidebar-tool"}
            onClick={() => openToolPage("skills")}
          >
            <BookOpen size={16} aria-hidden />
            Skills
            <span className="sidebar-badge">{enabledSkillCount}</span>
          </button>
          <button
            type="button"
            className={mainView === "tools" && toolPage === "mcp" ? "sidebar-tool active" : "sidebar-tool"}
            onClick={() => openToolPage("mcp")}
          >
            <Plug size={16} aria-hidden />
            MCP
            <span className="sidebar-badge">{enabledMcpCount}</span>
          </button>
          <button
            type="button"
            className={mainView === "tasks" ? "sidebar-tool active" : "sidebar-tool"}
            onClick={openScheduledTasksPage}
          >
            <CalendarClock size={16} aria-hidden />
            {t.sidebar.automations}
            <span className="sidebar-badge">{installedAutomationCount}</span>
          </button>
          <button
            type="button"
            className={inspectorPanel === "remote" ? "sidebar-tool active" : "sidebar-tool"}
            onClick={() => toggleInspectorPanel("remote")}
          >
            <Smartphone size={16} aria-hidden />
            {t.sidebar.remote}
          </button>
          <button
            type="button"
            className={inspectorPanel === "git" ? "sidebar-tool active" : "sidebar-tool"}
            onClick={() => toggleInspectorPanel("git")}
          >
            <Github size={16} aria-hidden />
            {t.sidebar.git}
          </button>
          <button
            type="button"
            className={inspectorPanel === "settings" ? "sidebar-tool active" : "sidebar-tool"}
            onClick={() => toggleInspectorPanel("settings")}
          >
            <Settings2 size={16} aria-hidden />
            {t.sidebar.settings}
          </button>
        </section>
      </aside>

      {showNewTaskMenu && (
        <>
          <div className="new-task-menu-backdrop" onClick={handleCloseNewTaskMenu} />
          <div
            className="new-task-menu"
            style={{ left: `${newTaskMenuPosition.x}px`, top: `${newTaskMenuPosition.y}px` }}
          >
            <button type="button" className="new-task-menu-item" onClick={handleChooseTaskFolder}>
              <FolderOpen size={16} aria-hidden />
              <span>选择任务文件夹</span>
            </button>
            <button type="button" className="new-task-menu-item" onClick={handleUseDefaultFolder}>
              <Home size={16} aria-hidden />
              <span>使用默认文件夹</span>
            </button>
          </div>
        </>
      )}

      <section className="conversation-main">
        <header className="conversation-topbar">
          <div className="topbar-title">
            <h2>{activeSession?.title && activeSession.title !== t.history.untitled ? activeSession.title : t.topbar.title}</h2>
          </div>
          <div className="view-switch" aria-label={t.topbar.viewSwitch}>
            <button type="button" className={mainView === "chat" ? "active" : ""} onClick={() => setMainView("chat")}>
              <MessageSquare size={15} aria-hidden />
              {t.topbar.chat}
            </button>
	            <button type="button" className={mainView === "tools" ? "active" : ""} onClick={() => setMainView("tools")}>
	              <Layers3 size={15} aria-hidden />
	              {t.topbar.tools}
	            </button>
	            <button type="button" className={mainView === "agents" ? "active" : ""} onClick={() => setMainView("agents")}>
	              <Bot size={15} aria-hidden />
	              {t.topbar.agents}
	            </button>
	          </div>
          <div className="topbar-actions">
            {remoteStatus?.enabled && remoteStatus.running ? (
              <div className="runtime-pill ready">
                <Smartphone size={15} aria-hidden />
                <span>{`${t.remote.statusLabel} ${remoteStatus.port}`}</span>
              </div>
            ) : null}
            <button
              type="button"
              className={hasGlobalApiKey ? "api-key-global-button saved" : "api-key-global-button missing"}
              title={hasGlobalApiKey ? t.topbar.apiKeySaved : t.topbar.apiKeyMissing}
              onClick={() => setInspectorPanel("settings")}
            >
              <KeyRound size={16} aria-hidden />
              <span>{hasGlobalApiKey ? t.topbar.apiKeySaved : t.topbar.apiKeyMissing}</span>
            </button>
            <button type="button" className="icon-button" title={`${t.topbar.checkRuntime}: ${selectedRuntimeLabel}`} onClick={() => refreshRuntime()}>
              <Activity size={17} aria-hidden />
            </button>
            <button
              type="button"
              className="secondary topbar-editor-button"
              title={t.topbar.openCursor}
              onClick={() => openWorkspaceEditor("cursor")}
              disabled={!settings.workspacePath.trim()}
            >
              <Code2 size={17} aria-hidden />
              <span>{t.topbar.openCursor}</span>
            </button>
          </div>
        </header>


        <div className={`conversation-body ${mainView === "chat" ? "chat-view" : ""}`}>
          <div className={mainView === "chat" ? conversationLayoutClassName : messageListClassName}>
            <div ref={messageListRef} className={mainView === "chat" ? "message-list chat-output-list" : "view-content"}>
            {rollbackState.active && (
              <div className="rollback-banner">
                <RotateCcw size={16} aria-hidden />
                <span>{language === "zh" ? "回滚确认：是否撤销到此消息发出前的状态？" : "Rollback: Revert to state before this message?"}</span>
                <button type="button" className="confirm-btn" onClick={async () => {
                  try {
                    const result = await desktop.rollbackToSnapshot({
                      snapshotId: rollbackState.snapshotId,
                      workspacePath: selectedWorkspacePath
                    });
                    if (result.ok && result.undoSnapshotId) {
                      setUndoSnapshotId(result.undoSnapshotId);
                    }
                    setRollbackState({ active: false, snapshotId: "", messageId: "" });
                  } catch (err) {
                    console.error("Rollback failed:", err);
                  }
                }}>
                  {language === "zh" ? "确认回滚" : "Confirm"}
                </button>
                <button type="button" className="undo-btn" onClick={() => {
                  setRollbackState({ active: false, snapshotId: "", messageId: "" });
                }}>
                  {language === "zh" ? "取消" : "Cancel"}
                </button>
              </div>
            )}
            {undoSnapshotId && (
              <div className="rollback-banner">
                <RotateCcw size={16} aria-hidden />
                <span>{language === "zh" ? "可以撤销上一次的回滚操作" : "You can undo the last rollback"}</span>
                <button type="button" className="undo-btn" onClick={async () => {
                  try {
                    await desktop.undoRollback({
                      undoSnapshotId,
                      workspacePath: selectedWorkspacePath
                    });
                    setUndoSnapshotId(null);
                  } catch (err) {
                    console.error("Undo rollback failed:", err);
                  }
                }}>
                  {language === "zh" ? "撤销回滚" : "Undo Rollback"}
                </button>
              </div>
            )}
            {mainView === "chat" ? messages.map((message) => (
                <article key={message.id} className={`message-row ${message.role} ${message.marked ? "marked" : ""}`}>
                  <div className="message-avatar">
                    {message.role === "assistant" ? <Bot size={16} aria-hidden /> : <Code2 size={16} aria-hidden />}
                  </div>
                  <div className="message-content">
                    <div className="message-bubble">
                      {message.title ? <strong>{message.title}</strong> : null}
                      {message.thinking && (
                        <details className="thinking-section">
                          <summary className="thinking-header">
                            <Brain size={14} aria-hidden />
                            <span>{language === "zh" ? "思考过程" : "Thinking"}</span>
                          </summary>
                          <pre className="thinking-content">{message.thinking}</pre>
                        </details>
                      )}
                      <p>{message.content}</p>
                    </div>
                    <div className="message-actions">
                      <button type="button" className={`action-btn ${message.marked ? "active" : ""}`} title={language === "zh" ? "标记" : "Mark"} onClick={() => {
                        setMessages(msgs => msgs.map(m => m.id === message.id ? { ...m, marked: !m.marked } : m));
                        commitConversationStore(store => updateConversationSession(store, conversationStore.activeSessionId, language, session => ({
                          ...session,
                          messages: session.messages.map(m => m.id === message.id ? { ...m, marked: !m.marked } : m)
                        })));
                      }}>
                        <Bot size={14} aria-hidden />
                      </button>
                      <button type="button" className="action-btn" title={language === "zh" ? "重试" : "Retry"} onClick={async () => {
                        const lastUserMsg = messages.filter(m => m.role === "user").at(-1);
                        if (lastUserMsg && message.role === "assistant") {
                          setAgentPrompt(lastUserMsg.content);
                          if (running) {
                            await desktop.stopTerminal();
                            setRunning(false);
                          }
                          await new Promise(resolve => setTimeout(resolve, 200));
                          void launch();
                        } else if (message.role === "assistant") {
                          setAgentPrompt(message.content);
                          if (running) {
                            await desktop.stopTerminal();
                            setRunning(false);
                          }
                          await new Promise(resolve => setTimeout(resolve, 200));
                          void launch();
                        }
                      }}>
                        <RefreshCw size={14} aria-hidden />
                      </button>
                      <button type="button" className="action-btn rollback-btn" title={language === "zh" ? "回滚" : "Rollback"} onClick={async () => {
                        try {
                          const snapshots = await desktop.getFileSnapshots(selectedWorkspacePath);
                          const latestSnapshot = snapshots.find(s => s.messageId === message.id);
                          if (latestSnapshot) {
                            setRollbackState({ active: true, snapshotId: latestSnapshot.id, messageId: message.id });
                          }
                        } catch (err) {
                          console.error("Failed to find snapshot:", err);
                        }
                      }}>
                        <RotateCcw size={14} aria-hidden />
                      </button>
                      <button type="button" className={`action-btn ${copiedMessages.has(message.id) ? "copied" : ""}`} title={language === "zh" ? "复制" : "Copy"} onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(message.content);
                          setCopiedMessages(prev => new Set(prev).add(message.id));
                          setTimeout(() => {
                            setCopiedMessages(prev => {
                              const next = new Set(prev);
                              next.delete(message.id);
                              return next;
                            });
                          }, 2000);
                        } catch (err) {
                          console.error("Copy failed:", err);
                        }
                      }}>
                        {copiedMessages.has(message.id) ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
                      </button>
                      <button type="button" className="action-btn delete-btn" title={language === "zh" ? "删除" : "Delete"} onClick={() => {
                        setMessages(msgs => msgs.filter(m => m.id !== message.id));
                        commitConversationStore(store => updateConversationSession(store, conversationStore.activeSessionId, language, session => ({
                          ...session,
                          messages: session.messages.filter(m => m.id !== message.id)
                        })));
                      }}>
                        <Trash2 size={14} aria-hidden />
                      </button>
                    </div>
                  </div>
                </article>
              )) : null}

            {mainView === "tools" ? (
              <section className="tool-dashboard">
                <div className="tool-page-tabs" aria-label={t.topbar.tools}>
                  <button type="button" className={toolPage === "overview" ? "active" : ""} onClick={() => setToolPage("overview")}>
                    <Layers3 size={15} aria-hidden />
                    {t.topbar.tools}
                  </button>
                  <button type="button" className={toolPage === "mcp" ? "active" : ""} onClick={() => setToolPage("mcp")}>
                    <Plug size={15} aria-hidden />
                    MCP
                  </button>
                  <button type="button" className={toolPage === "skills" ? "active" : ""} onClick={() => setToolPage("skills")}>
                    <BookOpen size={15} aria-hidden />
                    Skills
                  </button>
                </div>

                {toolPage === "overview" ? (
                  <>
                <div className="dashboard-grid">
                  <button type="button" className="metric-card" onClick={() => setToolPage("mcp")}>
                    <Plug size={20} aria-hidden />
                    <strong>{enabledMcpCount}</strong>
                    <span>{t.tools.enabledMcp}</span>
                  </button>
                  <button type="button" className="metric-card" onClick={() => setToolPage("skills")}>
                    <BookOpen size={20} aria-hidden />
                    <strong>{enabledSkillCount}</strong>
                    <span>{t.tools.enabledSkills}</span>
                  </button>
                  <article className="metric-card">
                    <ShieldCheck size={20} aria-hidden />
                    <strong>{mcpPresets.length}</strong>
                    <span>{t.tools.installablePresets}</span>
                  </article>
                </div>

                <div className="tool-section-head">
                  <div>
                    <h3>{t.tools.mcpStatus}</h3>
                    <p>{t.tools.mcpStatusDesc}</p>
                  </div>
                  <button type="button" className="secondary" onClick={() => setToolPage("mcp")}>
                    <SlidersHorizontal size={16} aria-hidden />
                    {t.tools.manageMcp}
                  </button>
                </div>

                <div className="tool-grid">
                  {mcpPresets.map((preset) => {
                    const enabled = settings.enabledMcpServers.includes(preset.id);
                    const Icon = iconForMcp(preset.id);
                    const presetText = getMcpText(preset, language);
                    return (
                      <button
                        type="button"
                        key={preset.id}
                        className={enabled ? `tool-card enabled ${preset.accent}` : `tool-card ${preset.accent}`}
                        onClick={() => setToolPage("mcp")}
                      >
                        <div className="tool-card-top">
                          <span className="preset-icon"><Icon size={18} aria-hidden /></span>
                          <span className={enabled ? "status-chip enabled" : "status-chip"}>{enabled ? t.tools.selected : t.tools.off}</span>
                        </div>
                        <strong>{presetText.name}</strong>
                        <p>{presetText.description}</p>
                        <div className="tool-meta">
                          <span>{t.category[preset.category]}</span>
                          <span>{formatDownloads(preset.downloads, language)}</span>
                          <span>{t.auth[preset.auth]}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>

                <div className="tool-section-head">
                  <div>
                    <h3>Skills</h3>
                    <p>{t.tools.skillsDesc}</p>
                  </div>
                  <button type="button" className="secondary" onClick={() => setToolPage("skills")}>
                    <BookOpen size={16} aria-hidden />
                    {t.tools.manageSkills}
                  </button>
                </div>

                <div className="skill-grid">
                  {skillCatalog.map((skill) => {
                    const enabled = settings.enabledSkills.includes(skill.id);
                    const Icon = iconForSkill(skill);
                    return (
                      <button
                        type="button"
                        key={skill.id}
                        className={enabled ? "skill-card enabled" : "skill-card"}
                        onClick={() => setToolPage("skills")}
                      >
                        <span className="preset-icon"><Icon size={18} aria-hidden /></span>
                        <strong>{skill.name}</strong>
                        <p>{skill.description}</p>
                        <div className="tool-meta">
                          <span>{skill.category}</span>
                          {skill.tools.map((tool) => <span key={tool}>{tool}</span>)}
                        </div>
                      </button>
                    );
                  })}
                </div>
                  </>
                ) : null}

                {toolPage === "skills" ? skillsToolPage : null}
                {toolPage === "mcp" ? mcpToolPage : null}
              </section>
	            ) : null}
	            {mainView === "tasks" ? scheduledTasksPage : null}
	            {mainView === "agents" ? agentsPanel : null}
	            </div>
            {processStreamEnabled ? terminalPanel : null}
          </div>
        </div>

        <footer className="composer">
          <div className="composer-actions">
            <div className="agent-mode-switch" aria-label={t.composer.modeLabel}>
              <button type="button" className={agentMode === "plan" ? "active" : ""} onClick={() => setAgentMode("plan")}>
                <Brain size={15} aria-hidden />
                Plan
              </button>
              <button type="button" className={agentMode === "agent" ? "active" : ""} onClick={() => setAgentMode("agent")}>
                <Bot size={15} aria-hidden />
                Agent
              </button>
              <button type="button" className={agentMode === "yolo" ? "active" : ""} onClick={() => setAgentMode("yolo")}>
                <Zap size={15} aria-hidden />
                YOLO
              </button>
            </div>
            <button
              type="button"
              className={gitStatus?.isRepo ? "branch-status-button" : "branch-status-button missing"}
              title={`${t.topbar.currentBranch}: ${currentBranchLabel}`}
              onClick={() => setInspectorPanel("git")}
              disabled={!settings.workspacePath.trim()}
            >
              <GitBranch size={16} aria-hidden />
              <span>{currentBranchLabel}</span>
            </button>
            <button
              type="button"
              className="workspace-picker-button"
              title={selectedWorkspacePath ? `${t.topbar.chooseWorkspace}: ${selectedWorkspacePath}` : t.topbar.chooseWorkspace}
              onClick={chooseWorkspace}
            >
              <FolderOpen size={15} aria-hidden />
              <span>{selectedWorkspaceLabel}</span>
            </button>
            <button
              type="button"
              className={processStreamEnabled ? "process-stream-toggle active" : "process-stream-toggle"}
              aria-pressed={processStreamEnabled}
              title={t.composer.harnessHint}
              onClick={toggleProcessStream}
            >
              <TerminalSquare size={15} aria-hidden />
              {t.composer.harness}
            </button>
            <label className="model-picker">
              <span>{t.composer.modelLabel}</span>
              <span className="select-wrap">
                <select
                  value={selectedModelPreset?.value || settings.model}
                  onChange={(event) => updateModel(event.target.value)}
                >
                  {modelPresets.map((preset) => (
                    <option key={preset.value} value={preset.value}>{preset.label}</option>
                  ))}
                </select>
                <ChevronDown size={14} aria-hidden />
              </span>
            </label>
          </div>
          <div className="composer-input">
            <textarea
              value={agentPrompt}
              onChange={(event) => setAgentPrompt(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              placeholder={agentMode === "plan"
                ? t.composer.planPlaceholder
                : agentMode === "yolo"
                  ? t.composer.yoloPlaceholder
                  : t.composer.execPlaceholder}
              rows={2}
            />
            <button type="button" className="send-button" onClick={sendPrompt} disabled={!agentPrompt.trim()}>
              <Send size={18} aria-hidden />
            </button>
          </div>
        </footer>
      </section>

      {inspectorDrawerPanel ? (
        <>
        <button
          type="button"
          className="inspector-scrim"
          aria-label={t.inspector.close}
          onClick={() => setInspectorPanel(null)}
        />
        <aside className="inspector-panel">
          <div className="inspector-header">
            <div>
              <h3>{t.inspector.titles[inspectorDrawerPanel]}</h3>
              <p>{t.inspector.subtitles[inspectorDrawerPanel]}</p>
            </div>
            <button type="button" className="icon-button" title={t.inspector.close} onClick={() => setInspectorPanel(null)}>
              <X size={17} aria-hidden />
            </button>
          </div>

          {inspectorPanel === "skills" ? (
            <div className="inspector-content">
              <section className={skillsRuntimeReady ? "runtime-toggle-card enabled" : "runtime-toggle-card"}>
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={settings.skillsEnabled}
                    onChange={(event) => updateSetting("skillsEnabled", event.target.checked)}
                  />
                  <span>{t.skills.enableRuntime}</span>
                </label>
                <small>{t.skills.runtimeHint}</small>
              </section>
              <section className="template-editor compact-editor">
                <div className="template-editor-head">
                  <div>
                    <strong>{t.skills.createTitle}</strong>
                    <small>{customization?.skillRoot || ""}</small>
                  </div>
                  <button type="button" className="secondary" onClick={importSkills}>
                    <UploadCloud size={15} aria-hidden />
                    {t.skills.importSkill}
                  </button>
                </div>
                <label>
                  {t.skills.createName}
                  <input
                    value={newSkillName}
                    onChange={(event) => setNewSkillName(event.target.value)}
                    placeholder={t.skills.createNamePlaceholder}
                    spellCheck={false}
                  />
                </label>
                <label>
                  {t.skills.createDescription}
                  <input
                    value={newSkillDescription}
                    onChange={(event) => setNewSkillDescription(event.target.value)}
                    placeholder={t.skills.createDescriptionPlaceholder}
                    spellCheck={false}
                  />
                </label>
                <button type="button" className="primary wide" onClick={createSkill} disabled={!newSkillName.trim()}>
                  <Plus size={16} aria-hidden />
                  {t.skills.createSkill}
                </button>
              </section>
              {skillCatalog.map((skill) => {
                const enabled = settings.enabledSkills.includes(skill.id);
                const Icon = iconForSkill(skill);
                return (
                  <button
                    type="button"
                    key={skill.id}
                    className={enabled ? "preset-card enabled" : "preset-card"}
                    onClick={() => toggleSkill(skill.id)}
                  >
                    <span className="preset-icon"><Icon size={18} aria-hidden /></span>
                    <span>
                      <strong>{skill.name}</strong>
                      <small>{skill.description}</small>
                      <span className="preset-meta">
                        <b>{skill.category}</b>
                        {skill.tools.map((tool) => <b key={tool}>{tool}</b>)}
                      </span>
                    </span>
                    <span className={enabled ? "switch on" : "switch"} />
                  </button>
                );
              })}
              {templateMessage ? <p className="template-message">{templateMessage}</p> : null}
              <div className="path-picker">
                <input
                  value={settings.skillsDir}
                  onChange={(event) => updateSetting("skillsDir", event.target.value)}
                  placeholder={t.skills.customDirPlaceholder}
                  spellCheck={false}
                />
                <button type="button" title={t.skills.chooseDir} onClick={chooseSkillsDir}>
                  <FolderOpen size={16} aria-hidden />
                </button>
              </div>
              <button type="button" className="secondary wide" onClick={saveSettings}>
                {t.skills.save}
              </button>
            </div>
          ) : null}

          {inspectorPanel === "mcp" ? (
            <div className="inspector-content">
              <div className="tool-help">
                <BookOpen size={17} aria-hidden />
                <div>
                  <strong>{t.mcp.helpTitle}</strong>
                  <p>{t.mcp.helpBody}</p>
                </div>
              </div>

              <section className={mcpRuntimeReady ? "runtime-toggle-card enabled" : "runtime-toggle-card"}>
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={settings.mcpEnabled}
                    onChange={(event) => updateSetting("mcpEnabled", event.target.checked)}
                  />
                  <span>{t.mcp.enableRuntime}</span>
                </label>
                <small>{settings.mcpEnabled ? (mcpRuntimeReady ? t.mcp.runtimeOn : t.mcp.runtimePending) : t.mcp.runtimeOff}</small>
                <p>{t.mcp.runtimeHint}</p>
              </section>

              <input
                value={mcpSearch}
                onChange={(event) => setMcpSearch(event.target.value)}
                placeholder={t.mcp.searchPlaceholder}
                spellCheck={false}
              />

              <div className="category-row">
                {mcpCategories.map((category) => (
                  <button
                    type="button"
                    key={category}
                    className={mcpCategory === category ? "active" : ""}
                    onClick={() => setMcpCategory(category)}
                  >
                    {t.category[category]}
                  </button>
                ))}
              </div>

              <div className="mcp-summary-row">
                <span>{t.mcp.summaryEnabled(enabledMcpCount)}</span>
                <span>{t.mcp.summaryVisible(filteredMcpPresets.length)}</span>
                <span>{t.mcp.summaryInstalled(mcpPresets.length)}</span>
              </div>

              <button type="button" className="secondary wide" onClick={testMcpServers} disabled={mcpTesting}>
                <Activity size={16} aria-hidden />
                {mcpTesting ? t.mcp.testing : t.mcp.test}
              </button>

              {mcpTestResult ? (
                <section className="mcp-test-list">
                  {mcpTestResult.servers.length === 0 ? <p>{t.mcp.noServers}</p> : null}
                  {mcpTestResult.servers.map((server) => {
                    const preset = mcpPresets.find((candidate) => candidate.id === server.id);
                    const serverName = preset ? getMcpText(preset, language).name : server.id;
                    return (
                      <div key={server.id} className="mcp-test-row">
                        <div>
                          <strong>{serverName}</strong>
                          <span className={server.ok ? "status-chip enabled" : "status-chip warning"}>
                            {server.ok ? t.mcp.testOk : t.mcp.testFailed}
                          </span>
                        </div>
	                        <code>{server.url || [server.command, ...server.args].filter(Boolean).join(" ")}</code>
                        {server.warnings.length > 0 ? (
                          <ul>
                            {server.warnings.map((warning) => <li key={warning}>{warning}</li>)}
                          </ul>
                        ) : null}
                      </div>
                    );
                  })}
                </section>
              ) : null}

              {filteredMcpPresets.map((preset) => {
                const enabled = settings.enabledMcpServers.includes(preset.id);
                const Icon = iconForMcp(preset.id);
                const presetText = getMcpText(preset, language);
                return (
                  <button
                    type="button"
                    key={preset.id}
                    className={enabled ? `preset-card enabled ${preset.accent}` : `preset-card ${preset.accent}`}
                    onClick={() => toggleMcp(preset.id)}
                  >
                    <span className="preset-icon"><Icon size={18} aria-hidden /></span>
                    <span>
                      <strong>{presetText.name}</strong>
                      <small>{presetText.description}</small>
                      <code>{preset.command}</code>
                      <em>{presetText.envHint}</em>
                      <span className="preset-meta">
                        <b>{t.category[preset.category]}</b>
                        <b>{formatDownloads(preset.downloads, language)}</b>
                        <b>{t.safety[preset.safety]} {t.mcp.riskSuffix}</b>
                      </span>
                    </span>
                    <span className={enabled ? "switch on" : "switch"} />
                  </button>
                );
              })}
              {templateMessage ? <p className="template-message">{templateMessage}</p> : null}
              <div className="path-picker">
                <input
                  value={settings.mcpConfigPath}
                  onChange={(event) => updateSetting("mcpConfigPath", event.target.value)}
                  placeholder={t.mcp.customConfigPlaceholder}
                  spellCheck={false}
                />
                <button type="button" title={t.mcp.chooseConfig} onClick={chooseMcpConfig}>
                  <FileCog size={16} aria-hidden />
                </button>
              </div>
              <button type="button" className="secondary wide" onClick={saveSettings}>
                {t.mcp.save}
              </button>
            </div>
          ) : null}

          {inspectorPanel === "git" ? (
            <div className="inspector-content">
              <section className={gitStatus?.isRepo ? "git-summary" : "git-summary warning"}>
                <div>
                  {gitStatus?.isRepo ? <CheckCircle2 size={16} aria-hidden /> : <CircleAlert size={16} aria-hidden />}
                  <strong>{gitStatus?.isRepo ? t.git.repoReady : t.git.notRepoTitle}</strong>
                </div>
                <small>{gitStatus?.isRepo ? gitStatusSummary(gitStatus, language) : t.git.notRepoBody}</small>
              </section>

              <div className="remote-actions">
                <button type="button" className="secondary" onClick={refreshGitStatus} disabled={gitBusy}>
                  <RefreshCw size={16} aria-hidden />
                  {t.git.refresh}
                </button>
                <button type="button" className="primary" onClick={initGitRepository} disabled={gitBusy || gitStatus?.isRepo}>
                  <GitBranch size={16} aria-hidden />
                  {t.git.init}
                </button>
              </div>

              {gitStatus?.isRepo ? (
                <>
                  <section className="git-meta-grid">
                    <div>
                      <span>{t.git.branch}</span>
                      <strong>{gitStatus.branch || "main"}</strong>
                    </div>
                    <div>
                      <span>{t.git.upstream}</span>
                      <strong>{gitStatus.upstream || t.git.noRemote}</strong>
                    </div>
                    <div>
                      <span>{t.git.repoRoot}</span>
                      <strong title={gitStatus.repoRoot}>{gitStatus.repoRoot}</strong>
                    </div>
                    <div>
                      <span>{t.git.lastCommit}</span>
                      <strong>{gitStatus.lastCommit ? `${gitStatus.lastCommit.hash} ${gitStatus.lastCommit.subject}` : t.git.noCommit}</strong>
                    </div>
                  </section>

                  <div className="mcp-summary-row">
                    <span>{t.git.aheadBehind(gitStatus.ahead, gitStatus.behind)}</span>
                    <span>{t.git.staged} {gitStatus.staged}</span>
                    <span>{t.git.unstaged} {gitStatus.unstaged}</span>
                    <span>{t.git.untracked} {gitStatus.untracked}</span>
                  </div>

                  <label>
                    {t.git.remote}
                    <input
                      value={gitRemoteUrl}
                      onChange={(event) => setGitRemoteUrl(event.target.value)}
                      placeholder={t.git.remotePlaceholder}
                      spellCheck={false}
                    />
                  </label>
                  <div className="remote-actions">
                    <button type="button" className="primary" onClick={saveGitRemote} disabled={gitBusy || !gitRemoteUrl.trim()}>
                      <Link2 size={16} aria-hidden />
                      {t.git.saveRemote}
                    </button>
                    <button type="button" className="secondary" onClick={copyGitRemote} disabled={gitBusy || !gitRemoteUrl.trim()}>
                      <Copy size={16} aria-hidden />
                      {t.git.copyRemote}
                    </button>
                  </div>

                  <div className="git-actions">
                    <button type="button" className="secondary" onClick={() => runGitRepositoryAction("fetch")} disabled={gitBusy || !gitStatus.originUrl}>
                      <RefreshCw size={16} aria-hidden />
                      {t.git.fetch}
                    </button>
                    <button type="button" className="secondary" onClick={() => runGitRepositoryAction("pull")} disabled={gitBusy || !gitStatus.upstream}>
                      <DownloadCloud size={16} aria-hidden />
                      {t.git.pull}
                    </button>
                    <button type="button" className="secondary" onClick={() => runGitRepositoryAction("push")} disabled={gitBusy || !gitStatus.originUrl}>
                      <UploadCloud size={16} aria-hidden />
                      {t.git.push}
                    </button>
                  </div>

                  <label>
                    {t.git.commitMessage}
                    <input
                      value={gitCommitMessage}
                      onChange={(event) => setGitCommitMessage(event.target.value)}
                      placeholder={t.git.commitPlaceholder}
                      spellCheck={false}
                    />
                  </label>
                  <button
                    type="button"
                    className="secondary wide"
                    onClick={previewGitDiffSummary}
                    disabled={gitDiffBusy || !gitStatus.hasChanges}
                  >
                    <FileCog size={16} aria-hidden />
                    {t.git.preview}
                  </button>
                  {gitDiffSummary ? (
                    <section className="git-diff-preview">
                      <strong>{t.git.previewTitle}</strong>
                      <pre>{gitDiffSummary}</pre>
                    </section>
                  ) : null}
                  <button
                    type="button"
                    className="primary wide"
                    onClick={commitGitRepository}
                    disabled={gitBusy || !gitStatus.hasChanges || !gitCommitMessage.trim()}
                  >
                    <GitCommitHorizontal size={16} aria-hidden />
                    {t.git.commit}
                  </button>

                  <section className="git-change-list">
                    <div>
                      <strong>{t.git.changes}</strong>
                      <small>{gitStatus.hasChanges ? gitStatusSummary(gitStatus, language) : t.git.noChanges}</small>
                    </div>
                    {gitStatus.changes.length === 0 ? <p>{t.git.noChanges}</p> : null}
                    {gitStatus.changes.slice(0, 50).map((change, index) => (
                      <div key={`${change.status}-${change.path}-${index}`} className="git-change-row">
                        <span>{gitStatusLabel(change)}</span>
                        <code title={change.path}>{change.path}</code>
                      </div>
                    ))}
                  </section>
                </>
              ) : null}

              {gitMessage ? <p className={gitMessageKind === "error" ? "template-message error" : "template-message"}>{gitMessage}</p> : null}
            </div>
          ) : null}

          {inspectorPanel === "remote" ? (
            <div className="inspector-content">
              <section className="remote-summary">
                <div>
                  <UserRound size={15} aria-hidden />
                  <strong>{remoteStatus?.auth.account?.displayName || remoteStatus?.auth.account?.accountId || t.remote.accountLoggedOut}</strong>
                </div>
                <small>{remoteStatus?.auth.desktopId || ""}</small>
              </section>

              <label>
                {t.remote.accountTitle}
                <input
                  value={loginAccount}
                  onChange={(event) => setLoginAccount(event.target.value)}
                  placeholder={t.remote.accountPlaceholder}
                  spellCheck={false}
                />
              </label>
              <input
                value={loginDisplayName}
                onChange={(event) => setLoginDisplayName(event.target.value)}
                placeholder={t.remote.displayNamePlaceholder}
                spellCheck={false}
              />
              <div className="remote-actions">
                <button type="button" className="primary" onClick={loginRemoteAccount}>
                  <UserRound size={16} aria-hidden />
                  {t.remote.login}
                </button>
                <button type="button" className="secondary" onClick={logoutRemoteAccount} disabled={!remoteStatus?.auth.loggedIn}>
                  <LogOut size={16} aria-hidden />
                  {t.remote.logout}
                </button>
              </div>

              <section className="remote-summary">
                <div>
                  <Link2 size={15} aria-hidden />
                  <strong>{t.remote.pairTitle}</strong>
                </div>
                <small>{t.remote.pairHint}</small>
              </section>
              {pairingCode || remoteStatus?.auth.pairing ? (
                <div className="pairing-code">
                  <span>{t.remote.pairingCode}</span>
                  <strong>{pairingCode || remoteStatus?.auth.pairing?.codePreview}</strong>
                  <small>{t.remote.pairingExpires}: {remoteStatus?.auth.pairing?.expiresAt || ""}</small>
                </div>
              ) : null}
              <button type="button" className="secondary wide" onClick={startRemotePairing} disabled={!remoteStatus?.auth.loggedIn}>
                <Link2 size={16} aria-hidden />
                {t.remote.startPairing}
              </button>

              <section className="device-list">
                <strong>{t.remote.pairedDevices}</strong>
                {(remoteStatus?.auth.devices || []).length === 0 ? (
                  <small>{t.remote.noDevices}</small>
                ) : null}
                {(remoteStatus?.auth.devices || []).map((device) => (
                  <div key={device.id} className="device-row">
                    <span>
                      <b>{device.name}</b>
                      <small>{device.platform} · {device.lastSeenAt || device.pairedAt}</small>
                    </span>
                    <button type="button" title={t.remote.revokeDevice} onClick={() => revokeRemoteDevice(device.id)}>
                      <Trash2 size={15} aria-hidden />
                    </button>
                  </div>
                ))}
              </section>

              <label className="check-row">
                <input
                  type="checkbox"
                  checked={settings.mobileBridgeEnabled}
                  onChange={(event) => updateSetting("mobileBridgeEnabled", event.target.checked)}
                />
                <span>{t.remote.enableMobile}</span>
              </label>

              <div className="two-col remote-grid">
                <label>
                  Host
                  <span className="select-wrap">
                    <select
                      value={settings.mobileBridgeHost}
                      onChange={(event) => updateSetting("mobileBridgeHost", event.target.value)}
                    >
                      <option value="127.0.0.1">127.0.0.1</option>
                      <option value="0.0.0.0">0.0.0.0 / LAN</option>
                    </select>
                    <ChevronDown size={14} aria-hidden />
                  </span>
                </label>
                <label>
                  Port
                  <input
                    type="number"
                    min={1024}
                    max={65535}
                    value={settings.mobileBridgePort}
                    onChange={(event) => updateSetting("mobileBridgePort", Number(event.target.value))}
                  />
                </label>
              </div>

              <label className="check-row">
                <input
                  type="checkbox"
                  checked={settings.mobileRemoteControlEnabled}
                  onChange={(event) => updateSetting("mobileRemoteControlEnabled", event.target.checked)}
                />
                <span>{t.remote.allowControl}</span>
              </label>

              <label className="check-row">
                <input
                  type="checkbox"
                  checked={settings.updatePushEnabled}
                  onChange={(event) => updateSetting("updatePushEnabled", event.target.checked)}
                />
                <span>{t.remote.allowUpdates}</span>
              </label>

              <section className="remote-summary">
                <div>
                  <span className={`dot ${remoteStatus?.running ? "live" : ""}`} />
                  <strong>{remoteStatus?.running ? t.remote.bridgeRunning : t.remote.bridgeStopped}</strong>
                </div>
                <small>{remoteStatus?.error || t.remote.tokenRequired}</small>
              </section>

              <div className="copy-row">
                <label>{t.remote.connectionAddress}</label>
                <input value={remoteStatus?.lanUrl || ""} readOnly spellCheck={false} />
                <button type="button" title={t.remote.copyLanUrl} onClick={() => copyRemoteText(remoteStatus?.lanUrl || "", t.remote.connectionAddress)}>
                  <Copy size={15} aria-hidden />
                </button>
              </div>
              <div className="copy-row">
                <label>{t.remote.accessKey}</label>
                <input value={remoteStatus?.token || settings.mobileBridgeToken || ""} readOnly spellCheck={false} />
                <button type="button" title={t.remote.copyToken} onClick={() => copyRemoteText(remoteStatus?.token || settings.mobileBridgeToken, t.remote.accessKey)}>
                  <Copy size={15} aria-hidden />
                </button>
              </div>

              <div className="endpoint-list">
                <code>GET /api/v1/status</code>
                <code>POST /api/v1/auth/login</code>
                <code>POST /api/v1/auth/pair</code>
                <code>GET /api/v1/events</code>
                <code>POST /api/v1/session/start</code>
                <code>POST /api/v1/terminal/input</code>
                <code>POST /api/v1/skills/upsert</code>
                <code>POST /api/v1/updates/push</code>
              </div>

              {remoteStatus?.lastUpdateNotice ? (
                <section className="remote-summary">
                  <div>
                    <Bell size={15} aria-hidden />
                    <strong>{remoteStatus.lastUpdateNotice.title}</strong>
                  </div>
                  <small>{remoteStatus.lastUpdateNotice.body}</small>
                </section>
              ) : null}

              {remoteMessage ? <p className="remote-message">{remoteMessage}</p> : null}

              <button type="button" className="primary wide" onClick={saveSettings}>
                <ShieldCheck size={16} aria-hidden />
                {t.remote.saveApply}
              </button>
              <div className="remote-actions">
                <button type="button" className="secondary" onClick={restartRemoteBridge}>
                  <RefreshCw size={16} aria-hidden />
                  {t.remote.restart}
                </button>
                <button type="button" className="secondary" onClick={rotateRemoteToken}>
                  <KeyRound size={16} aria-hidden />
                  {t.remote.rotateToken}
                </button>
              </div>
              <button type="button" className="secondary wide" onClick={pushTestUpdateNotice}>
                <Bell size={16} aria-hidden />
                {t.remote.testUpdate}
              </button>
            </div>
          ) : null}

          {inspectorPanel === "settings" ? (
            <div className="inspector-content">
              <section className="language-settings">
                <div>
                  <strong>{t.settings.language}</strong>
                  <small>{t.settings.languageHint}</small>
                </div>
                <div className="language-switch" aria-label={t.settings.language}>
                  <button
                    type="button"
                    className={language === "zh" ? "active" : ""}
                    onClick={() => switchLanguage("zh")}
                  >
                    <Globe2 size={15} aria-hidden />
                    {t.settings.chinese}
                  </button>
                  <button
                    type="button"
                    className={language === "en" ? "active" : ""}
                    onClick={() => switchLanguage("en")}
                  >
                    <Globe2 size={15} aria-hidden />
                    {t.settings.english}
                  </button>
                </div>
              </section>
              <label>
                Workspace
                <div className="path-picker">
                  <input
                    value={settings.workspacePath}
                    onChange={(event) => updateSetting("workspacePath", event.target.value)}
                    placeholder="/path/to/project"
                    spellCheck={false}
                  />
                  <button type="button" title={t.settings.chooseWorkspace} onClick={chooseWorkspace}>
                    <FolderOpen size={16} aria-hidden />
                  </button>
                </div>
              </label>
              <div className="editor-actions">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => openWorkspaceEditor("cursor")}
                  disabled={!settings.workspacePath.trim()}
                >
                  <Code2 size={16} aria-hidden />
                  {t.settings.openCursor}
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => openWorkspaceEditor("vscode")}
                  disabled={!settings.workspacePath.trim()}
                >
                  <TerminalSquare size={16} aria-hidden />
                  {t.settings.openVSCode}
                </button>
              </div>
              <label>
                {language === "zh" ? "运行环境" : "Runtime"}
                <span className="select-wrap">
                  <select
                    value={settings.binaryMode}
                    onChange={async (event) => {
                      const value = event.target.value as BinaryMode;
                      updateSetting("binaryMode", value);
                      await refreshRuntime({ binaryMode: value });
                    }}
                  >
                    <option value="bundled">Bundled</option>
                    <option value="system">System PATH</option>
                    <option value="custom">Custom</option>
                  </select>
                  <ChevronDown size={14} aria-hidden />
                </span>
              </label>
              <div className="path-picker">
                <input
                  value={settings.customBinaryPath}
                  onChange={(event) => updateSetting("customBinaryPath", event.target.value)}
                  placeholder={t.settings.customDeepseekPath}
                  spellCheck={false}
                />
                <button type="button" title={t.settings.chooseBinary} onClick={chooseCustomBinary}>
                  <TerminalSquare size={16} aria-hidden />
                </button>
              </div>
              <label>
                {t.settings.provider}
                <span className="select-wrap">
                  <select
                    value={settings.provider}
                    onChange={(event) => updateProvider(event.target.value as ProviderMode)}
                  >
                    <option value="deepseek">DeepSeek</option>
                    <option value="nvidia-nim">NVIDIA NIM</option>
                  </select>
                  <ChevronDown size={14} aria-hidden />
                </span>
              </label>
              <label>
                {t.settings.model}
                <span className="select-wrap">
                  <select
                    value={selectedModelPreset?.value || settings.model}
                    onChange={(event) => updateModel(event.target.value)}
                    disabled={settings.provider !== "deepseek"}
                  >
                    {modelPresets.map((preset) => (
                      <option key={preset.value} value={preset.value}>{preset.label}</option>
                    ))}
                  </select>
                  <ChevronDown size={14} aria-hidden />
                </span>
              </label>
              {selectedModelPreset ? (
                <a className="model-doc-row" href={selectedModelPreset.docsUrl} target="_blank" rel="noreferrer">
                  <BookOpen size={15} aria-hidden />
                  <span>{selectedModelDocsLabel}</span>
                  <code>{t.settings.apiModel(selectedModelApiName)}</code>
                </a>
              ) : null}
              <label>
                {t.settings.baseUrl}
                <input
                  value={settings.baseUrl}
                  onChange={(event) => updateSetting("baseUrl", event.target.value)}
                  placeholder={defaultBaseUrlForProvider(settings.provider)}
                  spellCheck={false}
                />
              </label>
              <label className="global-api-key-field">
                {t.settings.apiKey}
                <div className="input-icon">
                  <KeyRound size={15} aria-hidden />
                  <input
                    value={apiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                    type="password"
                    placeholder={settings.provider === "nvidia-nim" ? t.settings.nvidiaKeyPlaceholder : t.settings.deepseekKeyPlaceholder}
                    spellCheck={false}
                  />
                </div>
                <small className="field-hint">{t.settings.apiKeyHint}</small>
              </label>
              <section className={processStreamEnabled ? "runtime-toggle-card enabled" : "runtime-toggle-card"}>
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={processStreamEnabled}
                    onChange={toggleProcessStream}
                  />
                  <span>{t.settings.harnessMode}</span>
                </label>
                <small>{t.settings.harnessHint}</small>
              </section>
              <div className="two-col">
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={settings.allowShell}
                    onChange={(event) => updateSetting("allowShell", event.target.checked)}
                  />
                  <span>{t.settings.allowShell}</span>
                </label>
                <label>
                  {t.settings.agents}
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={settings.maxSubagents}
                    onChange={(event) => updateSetting("maxSubagents", Number(event.target.value))}
                  />
                </label>
              </div>
              {remoteMessage ? <p className="remote-message">{remoteMessage}</p> : null}
              <button type="button" className={`primary wide ${saveButtonClass}`} onClick={saveSettings}>
                {t.settings.save}
              </button>
            </div>
          ) : null}
        </aside>
        </>
      ) : null}
      {toast && (
        <div className={`toast-message ${toast.type} show`}>
          {toast.message}
        </div>
      )}
    </main>
  );
}

export default App;
