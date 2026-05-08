export {};

declare global {
  interface Window {
    deepseekDesktop: {
	      getSettings: () => Promise<DesktopSettings>;
	      saveSettings: (settings: DesktopSettings) => Promise<DesktopSettings>;
	      getApiKey: (provider?: ProviderMode) => Promise<string>;
	      saveApiKey: (payload: ApiKeySavePayload) => Promise<ApiKeySaveResult>;
	      getCustomization: (settings: DesktopSettings) => Promise<CustomizationDraft>;
      createSkillTemplate: (payload: SkillCreatePayload) => Promise<TemplateSaveResult>;
      importSkillDirectory: (payload: SkillImportPayload) => Promise<SkillImportResult>;
      saveMcpConfig: (payload: McpConfigSavePayload) => Promise<McpConfigSaveResult>;
      testMcpServers: (payload: McpTestPayload) => Promise<McpTestResult>;
      getConversationHistory: () => Promise<ConversationStore>;
      saveConversationHistory: (history: ConversationStore) => Promise<ConversationStore>;
      getAutomations: () => Promise<AutomationStore>;
      saveAutomation: (payload: AutomationSavePayload) => Promise<AutomationActionResult>;
      deleteAutomation: (payload: AutomationIdPayload) => Promise<AutomationActionResult>;
      installAutomation: (payload: AutomationRunPayload) => Promise<AutomationActionResult>;
      uninstallAutomation: (payload: AutomationRunPayload) => Promise<AutomationActionResult>;
      chooseDirectory: () => Promise<string>;
      chooseFile: (filters?: Array<{ name: string; extensions: string[] }>) => Promise<string>;
	      openWorkspaceEditor: (options: OpenWorkspaceEditorOptions) => Promise<OpenWorkspaceEditorResult>;
	      checkRuntime: (settings?: Partial<DesktopSettings>) => Promise<RuntimeCheck>;
	      getRuntimeSnapshot: () => Promise<RuntimeSnapshot>;
	      getGitStatus: (workspacePath: string) => Promise<GitStatus>;
      initGitRepository: (workspacePath: string) => Promise<GitActionResult>;
      setGitRemote: (payload: GitRemotePayload) => Promise<GitActionResult>;
      fetchGitRepository: (payload: GitWorkspacePayload) => Promise<GitActionResult>;
      pullGitRepository: (payload: GitWorkspacePayload) => Promise<GitActionResult>;
      pushGitRepository: (payload: GitWorkspacePayload) => Promise<GitActionResult>;
      commitGitRepository: (payload: GitCommitPayload) => Promise<GitActionResult>;
      getGitDiffSummary: (payload: GitWorkspacePayload) => Promise<GitDiffSummaryResult>;
      startTerminal: (options: LaunchOptions) => Promise<{ ok: boolean; error?: string; runtime?: RuntimeCheck; pid?: number }>;
      stopTerminal: () => Promise<{ ok: boolean }>;
      sendTerminalInput: (data: string) => void;
      resizeTerminal: (size: { cols: number; rows: number }) => void;
      getRemoteStatus: () => Promise<RemoteBridgeStatus>;
      restartRemoteBridge: () => Promise<RemoteBridgeStatus>;
      rotateRemoteToken: () => Promise<{ settings: DesktopSettings; status: RemoteBridgeStatus }>;
      loginRemoteAccount: (payload: RemoteLoginPayload) => Promise<RemoteAuthResult>;
      logoutRemoteAccount: () => Promise<RemoteAuthResult>;
      startRemotePairing: () => Promise<RemotePairingResult>;
      revokeRemoteDevice: (deviceId: string) => Promise<RemoteAuthResult>;
      pushUpdateNotice: (payload: UpdatePushPayload) => Promise<{ ok: boolean; error?: string; notice?: UpdateNotice }>;
	      onTerminalData: (callback: (data: string) => void) => () => void;
	      onTerminalExit: (callback: (exit: { exitCode: number; signal?: number }) => void) => () => void;
	      onRuntimeSnapshot: (callback: (snapshot: RuntimeSnapshot) => void) => () => void;
	      onRuntimeEvent: (callback: (event: RuntimeEvent) => void) => () => void;
	      onRemoteStatus: (callback: (status: RemoteBridgeStatus) => void) => () => void;
	    };
  }

  type LaunchAction = "tui" | "continue" | "doctor" | "setup" | "mcp-init" | "sessions" | "exec" | "plan" | "yolo";
  type BinaryMode = "bundled" | "system" | "custom";
  type ProviderMode = "deepseek" | "nvidia-nim";
  type AppLanguage = "zh" | "en";
  type WorkspaceEditor = "cursor" | "vscode";
  type AutomationFrequency = "hourly" | "daily" | "weekly" | "custom";
  type AutomationStatus = "ACTIVE" | "PAUSED";

  interface OpenWorkspaceEditorOptions {
    editor: WorkspaceEditor;
    workspacePath: string;
  }

	  interface OpenWorkspaceEditorResult {
	    ok: boolean;
	    editor?: WorkspaceEditor;
	    path?: string;
	    command?: string;
	    error?: string;
	  }

	  interface ApiKeySavePayload {
	    provider: ProviderMode;
	    apiKey: string;
	  }

	  interface ApiKeySaveResult {
	    ok: boolean;
	    provider: ProviderMode;
	    hasKey: boolean;
	    error?: string;
	  }

  interface DesktopSettings {
    language: AppLanguage;
    workspacePath: string;
    binaryMode: BinaryMode;
    customBinaryPath: string;
    provider: ProviderMode;
    model: string;
    baseUrl: string;
    mcpConfigPath: string;
    skillsDir: string;
    skillsEnabled: boolean;
    mcpEnabled: boolean;
    allowShell: boolean;
    maxSubagents: number;
    harnessEnabled: boolean;
    launchAction: LaunchAction;
    rememberWorkspace: boolean;
    enabledSkills: string[];
    enabledMcpServers: string[];
    mobileBridgeEnabled: boolean;
    mobileBridgeHost: string;
    mobileBridgePort: number;
    mobileBridgeToken: string;
    mobileRemoteControlEnabled: boolean;
    updatePushEnabled: boolean;
  }

  interface SkillTemplateDraft {
    id: string;
    name: string;
    description: string;
    path: string;
    source: "default" | "file";
    origin: "preset" | "custom";
    content: string;
  }

  interface CustomizationDraft {
    skillRoot: string;
    skillTemplates: Record<string, SkillTemplateDraft>;
    mcpConfigPath: string;
    mcpConfigSource: "generated" | "custom" | "missing";
    mcpConfigText: string;
    mcpConfigError?: string;
  }

  interface SkillCreatePayload {
    settings: DesktopSettings;
    skillId?: string;
    name?: string;
    description?: string;
    content?: string;
  }

  interface SkillImportPayload {
    settings: DesktopSettings;
    sourcePath: string;
  }

  interface TemplateSaveResult {
    ok: boolean;
    error?: string;
    skill?: SkillTemplateDraft;
    path?: string;
    skillRoot?: string;
  }

  interface SkillImportResult {
    ok: boolean;
    error?: string;
    skills?: SkillTemplateDraft[];
    path?: string;
    skillRoot?: string;
  }

  interface McpConfigSavePayload {
    settings: DesktopSettings;
    content: string;
  }

  interface McpConfigSaveResult {
    ok: boolean;
    error?: string;
    path?: string;
    content?: string;
  }

  interface McpTestPayload {
    settings: DesktopSettings;
  }

	  interface McpServerTest {
	    id: string;
	    command: string;
	    args: string[];
	    url?: string;
	    ok: boolean;
	    commandFound: boolean;
    missingEnv: string[];
    warnings: string[];
    error?: string;
  }

  interface McpTestResult {
    ok: boolean;
    testedAt: string;
    configPath?: string;
    servers: McpServerTest[];
    error?: string;
  }

  interface LaunchOptions extends DesktopSettings {
    apiKey?: string;
    agentPrompt?: string;
    cols?: number;
    rows?: number;
  }

  interface ConversationMessage {
    id: string;
    role: "assistant" | "user";
    title?: string;
    content: string;
  }

  interface ConversationSession {
    id: string;
    projectId: string;
    projectName: string;
    workspacePath: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    messages: ConversationMessage[];
  }

  interface ConversationProject {
    id: string;
    name: string;
    workspacePath: string;
    sessions: ConversationSession[];
  }

  interface ConversationStore {
    activeSessionId: string;
    projects: ConversationProject[];
  }

  interface AutomationTask {
    id: string;
    kind: "cron";
    name: string;
    prompt: string;
    workspacePath: string;
    frequency: AutomationFrequency;
    minute: number;
    hour: number;
    weekday: number;
    customSchedule: string;
    schedule: string;
    rrule: string;
    timezone: string;
    status: AutomationStatus;
    enabled: boolean;
    installed: boolean;
    cronPath: string;
    logPath: string;
    commandPreview: string;
    runtimePath: string;
    runnerPath: string;
    runArgs: string[];
    provider: ProviderMode;
    model: string;
    baseUrl: string;
    mcpConfigPath: string;
    skillsDir: string;
    enabledSkills: string[];
    mcpEnabled: boolean;
    enabledMcpServers: string[];
    allowShell: boolean;
    maxSubagents: number;
    error?: string;
    createdAt: string;
    updatedAt: string;
    lastGeneratedAt: string;
    lastInstalledAt: string;
  }

  interface AutomationStore {
    version: number;
    tasks: AutomationTask[];
  }

  interface AutomationSavePayload {
    settings: DesktopSettings;
    task: Partial<AutomationTask>;
  }

  interface AutomationIdPayload {
    id: string;
  }

  interface AutomationRunPayload extends AutomationIdPayload {
    settings: DesktopSettings;
  }

  interface AutomationActionResult {
    ok: boolean;
    error?: string;
    task?: AutomationTask;
    tasks: AutomationTask[];
  }

	  interface RuntimeCheck {
	    selected: string;
    selectedExists: boolean;
    bundled: string;
    bundledExists: boolean;
    system: string;
    systemExists: boolean;
    custom: string;
    customExists: boolean;
	    version: string;
	  }

	  type RuntimeRunStatus = "idle" | "running" | "completed" | "failed" | "stopped";
	  type RuntimeAgentStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

	  interface RuntimeAgent {
	    id: string;
	    name: string;
	    status: RuntimeAgentStatus;
	    summary: string;
	    source: "pty" | "runtime-api";
	    createdAt: string;
	    updatedAt: string;
	  }

	  interface RuntimeEvent {
	    id: string;
	    type: string;
	    label: string;
	    detail: string;
	    at: string;
	  }

	  interface RuntimeSnapshot {
	    status: RuntimeRunStatus;
	    source: "none" | "pty" | "runtime-api";
	    sessionId: string;
	    mode: string;
	    workspacePath: string;
	    pid: number;
	    command: string;
	    args: string[];
	    startedAt: string;
	    updatedAt: string;
	    lastExit: { exitCode: number; signal?: string; exitedAt: string } | null;
	    agents: RuntimeAgent[];
	    counts: {
	      total: number;
	      running: number;
	      completed: number;
	      failed: number;
	      cancelled: number;
	    };
	    events: RuntimeEvent[];
	  }

	  interface GitRemoteInfo {
    name: string;
    fetchUrl: string;
    pushUrl: string;
  }

  interface GitChangeInfo {
    status: string;
    path: string;
    staged: boolean;
    unstaged: boolean;
    untracked: boolean;
  }

  interface GitStatus {
    ok: boolean;
    error?: string;
    workspacePath: string;
    repoRoot: string;
    isRepo: boolean;
    branch: string;
    upstream: string;
    ahead: number;
    behind: number;
    hasChanges: boolean;
    staged: number;
    unstaged: number;
    untracked: number;
    remotes: GitRemoteInfo[];
    originUrl: string;
    lastCommit: {
      hash: string;
      subject: string;
      author: string;
      date: string;
    } | null;
    changes: GitChangeInfo[];
  }

  interface GitWorkspacePayload {
    workspacePath: string;
  }

  interface GitRemotePayload extends GitWorkspacePayload {
    remoteUrl: string;
  }

  interface GitCommitPayload extends GitWorkspacePayload {
    message: string;
  }

  interface GitActionResult {
    ok: boolean;
    error?: string;
    output?: string;
    status?: GitStatus;
  }

  interface GitDiffSummaryResult {
    ok: boolean;
    error?: string;
    output?: string;
    status?: GitStatus;
  }

  interface RemoteBridgeStatus {
    enabled: boolean;
    running: boolean;
    error: string;
    bindHost: string;
    port: number;
    localUrl: string;
    lanUrl: string;
    token?: string;
    tokenPreview: string;
    mobileRemoteControlEnabled: boolean;
    updatePushEnabled: boolean;
    auth: RemoteAuthState;
    sseClients: number;
    terminalPreview: string;
    lastTerminalAt: string;
    lastUpdateNotice: UpdateNotice | null;
    harness: {
      running: boolean;
      activeSession: {
        id: string;
        command: string;
        args: string[];
        cwd: string;
        pid: number;
        startedAt: string;
      } | null;
      lastExit: {
        exitCode?: number;
        signal?: number;
        exitedAt?: string;
      } | null;
    };
  }

  interface UpdatePushPayload {
    accountId?: string;
    email?: string;
    title?: string;
    body?: string;
    message?: string;
    version?: string;
    release?: string;
    url?: string;
    downloadUrl?: string;
  }

  interface UpdateNotice {
    id: string;
    source: string;
    accountId: string;
    matchedDeviceIds: string[];
    version: string;
    title: string;
    body: string;
    url: string;
    createdAt: string;
  }

  interface RemoteLoginPayload {
    accountId?: string;
    email?: string;
    displayName?: string;
    name?: string;
  }

  interface RemoteAuthAccount {
    accountId: string;
    email: string;
    displayName: string;
    loggedInAt: string;
  }

  interface RemotePairingState {
    active: boolean;
    codePreview: string;
    expiresAt: string;
    createdAt: string;
  }

  interface RemoteDevice {
    id: string;
    name: string;
    platform: string;
    accountId: string;
    pushProvider?: string;
    pushTokenPreview?: string;
    pairedAt: string;
    lastSeenAt: string;
    enabled?: boolean;
  }

  interface RemoteAuthState {
    desktopId: string;
    loggedIn: boolean;
    account: RemoteAuthAccount | null;
    pairing: RemotePairingState | null;
    devices: RemoteDevice[];
  }

  interface RemoteAuthResult {
    ok: boolean;
    error?: string;
    auth?: RemoteAuthState;
    status?: RemoteBridgeStatus;
  }

  interface RemotePairingResult extends RemoteAuthResult {
    pairing?: {
      code: string;
      codePreview: string;
      expiresAt: string;
      accountId: string;
      desktopId: string;
    };
  }
}
