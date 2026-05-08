use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::process::Command;
use std::sync::{Arc, Mutex};

use chrono::Utc;
use dirs::home_dir;
use once_cell::sync::Lazy;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tauri_plugin_dialog::DialogExt;
use tracing::info;
use tracing_appender::rolling::{RollingFileAppender, Rotation};
use tracing_subscriber::{fmt, prelude::*, EnvFilter};

// Global state for terminal sessions
static TERMINAL_SESSIONS: Lazy<Arc<Mutex<HashMap<String, TerminalSession>>>> =
    Lazy::new(|| Arc::new(Mutex::new(HashMap::new())));

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    pub language: String,
    #[serde(rename = "workspacePath")]
    pub workspace_path: String,
    #[serde(rename = "binaryMode")]
    pub binary_mode: String,
    #[serde(rename = "customBinaryPath")]
    pub custom_binary_path: String,
    pub provider: String,
    pub model: String,
    #[serde(rename = "baseUrl")]
    pub base_url: String,
    #[serde(rename = "mcpConfigPath")]
    pub mcp_config_path: String,
    #[serde(rename = "skillsDir")]
    pub skills_dir: String,
    #[serde(rename = "skillsEnabled")]
    pub skills_enabled: bool,
    #[serde(rename = "mcpEnabled")]
    pub mcp_enabled: bool,
    #[serde(rename = "allowShell")]
    pub allow_shell: bool,
    #[serde(rename = "maxSubagents")]
    pub max_subagents: i32,
    #[serde(rename = "harnessEnabled")]
    pub harness_enabled: bool,
    #[serde(rename = "launchAction")]
    pub launch_action: String,
    #[serde(rename = "rememberWorkspace")]
    pub remember_workspace: bool,
    #[serde(rename = "enabledSkills")]
    pub enabled_skills: Vec<String>,
    #[serde(rename = "enabledMcpServers")]
    pub enabled_mcp_servers: Vec<String>,
    #[serde(rename = "mobileBridgeEnabled")]
    pub mobile_bridge_enabled: bool,
    #[serde(rename = "mobileBridgeHost")]
    pub mobile_bridge_host: String,
    #[serde(rename = "mobileBridgePort")]
    pub mobile_bridge_port: i32,
    #[serde(rename = "mobileBridgeToken")]
    pub mobile_bridge_token: String,
    #[serde(rename = "mobileRemoteControlEnabled")]
    pub mobile_remote_control_enabled: bool,
    #[serde(rename = "updatePushEnabled")]
    pub update_push_enabled: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            language: "zh".to_string(),
            workspace_path: home_dir().unwrap_or_default().to_string_lossy().to_string(),
            binary_mode: "bundled".to_string(),
            custom_binary_path: String::new(),
            provider: "deepseek".to_string(),
            model: "deepseek-v4-pro".to_string(),
            base_url: "https://api.deepseek.com".to_string(),
            mcp_config_path: String::new(),
            skills_dir: String::new(),
            skills_enabled: true,
            mcp_enabled: false,
            allow_shell: false,
            max_subagents: 10,
            harness_enabled: false,
            launch_action: "tui".to_string(),
            remember_workspace: true,
            enabled_skills: vec![
                "superpowers".to_string(),
                "ui-ux-design".to_string(),
                "cron-scheduler".to_string(),
                "skill-downloader".to_string(),
            ],
            enabled_mcp_servers: vec![],
            mobile_bridge_enabled: false,
            mobile_bridge_host: "127.0.0.1".to_string(),
            mobile_bridge_port: 8765,
            mobile_bridge_token: String::new(),
            mobile_remote_control_enabled: false,
            update_push_enabled: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalOptions {
    pub cols: i32,
    pub rows: i32,
    #[serde(rename = "workspacePath")]
    pub workspace_path: String,
    #[serde(rename = "launchAction")]
    pub launch_action: String,
    #[serde(rename = "agentPrompt")]
    pub agent_prompt: String,
}

struct TerminalSession {
    writer: Option<Box<dyn Write + Send>>,
}

impl TerminalSession {
    fn new(writer: Box<dyn Write + Send>) -> Self {
        Self { writer: Some(writer) }
    }

    fn write(&mut self, data: &str) -> Result<(), String> {
        if let Some(writer) = self.writer.as_mut() {
            writer.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
        }
        Ok(())
    }
}

fn get_user_data_dir() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("ds-code")
}

fn get_settings_path() -> PathBuf {
    get_user_data_dir().join("settings.json")
}

fn get_secrets_path() -> PathBuf {
    get_user_data_dir().join("secrets.json")
}

fn get_skills_dir() -> PathBuf {
    get_user_data_dir().join("skills")
}

fn get_log_dir() -> PathBuf {
    get_user_data_dir().join("logs")
}

fn ensure_user_data_dir() -> std::io::Result<()> {
    let dir = get_user_data_dir();
    if !dir.exists() {
        fs::create_dir_all(&dir)?;
    }
    Ok(())
}

// Settings commands
#[tauri::command]
fn get_settings() -> Result<Settings, String> {
    let path = get_settings_path();
    if path.exists() {
        let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).map_err(|e| e.to_string())
    } else {
        Ok(Settings::default())
    }
}

#[tauri::command]
fn save_settings(settings: Settings) -> Result<Settings, String> {
    ensure_user_data_dir().map_err(|e| e.to_string())?;
    let path = get_settings_path();
    let content = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| e.to_string())?;
    info!("Settings saved");
    Ok(settings)
}

// API Key commands
#[tauri::command]
fn get_api_key(provider: String) -> Result<String, String> {
    let path = get_secrets_path();
    if path.exists() {
        let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        #[derive(Deserialize)]
        struct SecretStore {
            #[serde(rename = "apiKeys")]
            api_keys: Option<HashMap<String, String>>,
        }
        if let Ok(store) = serde_json::from_str::<SecretStore>(&content) {
            if let Some(api_keys) = store.api_keys {
                return Ok(api_keys.get(&provider).cloned().unwrap_or_default());
            }
        }
    }
    Ok(String::new())
}

#[tauri::command]
fn save_api_key(provider: String, api_key: String) -> Result<(), String> {
    ensure_user_data_dir().map_err(|e| e.to_string())?;
    let path = get_secrets_path();
    #[derive(Serialize, Deserialize)]
    struct SecretStore {
        version: i32,
        #[serde(rename = "apiKeys")]
        api_keys: HashMap<String, String>,
    }
    let mut store = if path.exists() {
        serde_json::from_str::<SecretStore>(&fs::read_to_string(&path).map_err(|e| e.to_string())?)
            .unwrap_or(SecretStore {
                version: 1,
                api_keys: HashMap::new(),
            })
    } else {
        SecretStore {
            version: 1,
            api_keys: HashMap::new(),
        }
    };

    if !api_key.is_empty() {
        store.api_keys.insert(provider, api_key);
    }

    let content = serde_json::to_string_pretty(&store).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| e.to_string())?;
    info!("API key saved");
    Ok(())
}

// Dialog commands - using async API
#[tauri::command]
async fn choose_directory(app: AppHandle) -> Result<String, String> {
    let folder = app.dialog().file().blocking_pick_folder();
    Ok(folder.map(|p| p.to_string()).unwrap_or_default())
}

#[tauri::command]
async fn choose_file(app: AppHandle) -> Result<String, String> {
    let file = app.dialog().file().blocking_pick_file();
    Ok(file.map(|p| p.to_string()).unwrap_or_default())
}

// Git commands
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitStatus {
    pub ok: bool,
    pub error: String,
    #[serde(rename = "workspacePath")]
    pub workspace_path: String,
    #[serde(rename = "repoRoot")]
    pub repo_root: String,
    #[serde(rename = "isRepo")]
    pub is_repo: bool,
    pub branch: String,
    pub upstream: String,
    pub ahead: i32,
    pub behind: i32,
    #[serde(rename = "hasChanges")]
    pub has_changes: bool,
    pub staged: i32,
    pub unstaged: i32,
    pub untracked: i32,
    pub remotes: Vec<GitRemote>,
    #[serde(rename = "originUrl")]
    pub origin_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitRemote {
    pub name: String,
    #[serde(rename = "fetchUrl")]
    pub fetch_url: String,
    #[serde(rename = "pushUrl")]
    pub push_url: String,
}

fn run_git(args: &[&str], cwd: &str) -> Result<String, String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

#[tauri::command]
fn git_status(workspace_path: String) -> GitStatus {
    let workspace_path = if workspace_path.is_empty() {
        home_dir().unwrap_or_default().to_string_lossy().to_string()
    } else {
        workspace_path
    };

    let repo_check = run_git(&["rev-parse", "--show-toplevel"], &workspace_path);
    if repo_check.is_err() {
        return GitStatus {
            ok: true,
            error: String::new(),
            workspace_path,
            repo_root: String::new(),
            is_repo: false,
            branch: String::new(),
            upstream: String::new(),
            ahead: 0,
            behind: 0,
            has_changes: false,
            staged: 0,
            unstaged: 0,
            untracked: 0,
            remotes: vec![],
            origin_url: String::new(),
        };
    }

    let repo_root = repo_check.unwrap();
    let branch = run_git(&["branch", "--show-current"], &repo_root).unwrap_or_default();
    let upstream = run_git(
        &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
        &repo_root,
    )
    .unwrap_or_default();

    let (ahead, behind) = if !upstream.is_empty() {
        let output = run_git(
            &["rev-list", "--left-right", "--count", &format!("HEAD...{}", upstream)],
            &repo_root,
        )
        .unwrap_or_default();
        let parts: Vec<&str> = output.trim().split_whitespace().collect();
        (
            parts.first().and_then(|s| s.parse().ok()).unwrap_or(0),
            parts.get(1).and_then(|s| s.parse().ok()).unwrap_or(0),
        )
    } else {
        (0, 0)
    };

    let status_output = run_git(&["status", "--porcelain=v1", "-uall"], &repo_root).unwrap_or_default();
    let changes: Vec<&str> = status_output.lines().collect();
    let staged = changes.iter().filter(|l| l.starts_with(|c: char| c != ' ' && c != '?')).count() as i32;
    let unstaged = changes.iter().filter(|l| l.chars().nth(1).map(|c| c != ' ').unwrap_or(false)).count() as i32;
    let untracked = changes.iter().filter(|l| l.starts_with("??")).count() as i32;

    let remotes_output = run_git(&["remote", "-v"], &repo_root).unwrap_or_default();
    let mut remotes: HashMap<String, GitRemote> = HashMap::new();
    for line in remotes_output.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 3 {
            let name = parts[0].to_string();
            let url = parts[1].to_string();
            let kind = parts[2].trim_matches(|c: char| c == '(' || c == ')');
            let remote = remotes.entry(name.clone()).or_insert(GitRemote {
                name,
                fetch_url: String::new(),
                push_url: String::new(),
            });
            if kind == "(fetch)" {
                remote.fetch_url = url;
            } else if kind == "(push)" {
                remote.push_url = url;
            }
        }
    }

    GitStatus {
        ok: true,
        error: String::new(),
        workspace_path,
        repo_root,
        is_repo: true,
        branch: branch.trim().to_string(),
        upstream: upstream.trim().to_string(),
        ahead,
        behind,
        has_changes: !changes.is_empty(),
        staged,
        unstaged,
        untracked,
        remotes: remotes.clone().into_values().collect(),
        origin_url: remotes.get("origin").map(|r| r.push_url.clone()).unwrap_or_default(),
    }
}

#[tauri::command]
fn git_init(workspace_path: String) -> Result<GitStatus, String> {
    let workspace_path = if workspace_path.is_empty() {
        home_dir().unwrap_or_default().to_string_lossy().to_string()
    } else {
        workspace_path
    };

    run_git(&["init", "-b", "main"], &workspace_path).map_err(|e| e.to_string())?;
    Ok(git_status(workspace_path))
}

#[tauri::command]
fn git_set_remote(workspace_path: String, remote_url: String) -> Result<GitStatus, String> {
    let repo_root = run_git(&["rev-parse", "--show-toplevel"], &workspace_path)
        .map_err(|e| e.to_string())?;

    let has_origin = run_git(&["remote", "get-url", "origin"], &repo_root).is_ok();

    if has_origin {
        run_git(&["remote", "set-url", "origin", &remote_url], &repo_root)?;
    } else {
        run_git(&["remote", "add", "origin", &remote_url], &repo_root)?;
    }

    Ok(git_status(workspace_path))
}

#[tauri::command]
fn git_commit(workspace_path: String, message: String) -> Result<GitStatus, String> {
    let repo_root = run_git(&["rev-parse", "--show-toplevel"], &workspace_path)
        .map_err(|e| e.to_string())?;

    run_git(&["add", "-A"], &repo_root)?;
    run_git(&["commit", "-m", &message], &repo_root)?;

    Ok(git_status(workspace_path))
}

#[tauri::command]
fn git_fetch(workspace_path: String) -> Result<GitStatus, String> {
    let repo_root = run_git(&["rev-parse", "--show-toplevel"], &workspace_path)
        .map_err(|e| e.to_string())?;
    run_git(&["fetch", "--prune", "origin"], &repo_root)?;
    Ok(git_status(workspace_path))
}

#[tauri::command]
fn git_pull(workspace_path: String) -> Result<GitStatus, String> {
    let repo_root = run_git(&["rev-parse", "--show-toplevel"], &workspace_path)
        .map_err(|e| e.to_string())?;
    run_git(&["pull", "--ff-only"], &repo_root)?;
    Ok(git_status(workspace_path))
}

#[tauri::command]
fn git_push(workspace_path: String) -> Result<GitStatus, String> {
    let repo_root = run_git(&["rev-parse", "--show-toplevel"], &workspace_path)
        .map_err(|e| e.to_string())?;
    run_git(&["push"], &repo_root)?;
    Ok(git_status(workspace_path))
}

// Terminal commands
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalStartResult {
    pub ok: bool,
    pub error: String,
    pub pid: Option<u32>,
    #[serde(rename = "sessionId")]
    pub session_id: Option<String>,
}

#[tauri::command]
fn terminal_start(
    app: AppHandle,
    options: TerminalOptions,
    settings: Settings,
) -> Result<TerminalStartResult, String> {
    let session_id = format!("session_{}", Utc::now().timestamp_millis());

    let binary_path = if settings.binary_mode == "system" {
        "deepseek".to_string()
    } else if settings.binary_mode == "custom" && !settings.custom_binary_path.is_empty() {
        settings.custom_binary_path.clone()
    } else {
        "deepseek".to_string()
    };

    let mut args = match options.launch_action.as_str() {
        "continue" => vec!["run", "--workspace", &options.workspace_path, "--continue"],
        "doctor" => vec!["doctor"],
        "setup" => vec!["setup"],
        "exec" => {
            let mut a = vec!["exec", "--auto", &options.agent_prompt];
            if settings.mcp_enabled {
                a.insert(1, "--enable");
                a.insert(2, "mcp");
            }
            a
        }
        _ => {
            let mut a = vec!["run", "--workspace", &options.workspace_path];
            if settings.mcp_enabled {
                a.insert(1, "--enable");
                a.insert(2, "mcp");
            }
            a
        }
    };

    let pty_system = native_pty_system();
    let pair = pty_system.openpty(PtySize {
        rows: options.rows as u16,
        cols: options.cols as u16,
        pixel_width: 0,
        pixel_height: 0,
    })
    .map_err(|e| e.to_string())?;

    let mut cmd = CommandBuilder::new(&binary_path);
    cmd.args(&args);
    cmd.cwd(&options.workspace_path);
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");

    if let Ok(api_key) = get_api_key(settings.provider.clone()) {
        if !api_key.is_empty() {
            cmd.env("DEEPSEEK_API_KEY", &api_key);
        }
    }

    let _child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;

    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    {
        let mut sessions = TERMINAL_SESSIONS.lock().unwrap();
        sessions.insert(session_id.clone(), TerminalSession::new(writer));
    }

    let session_id_clone = session_id.clone();
    let app_clone = app.clone();

    std::thread::spawn(move || {
        let mut reader = pair.master.try_clone_reader().unwrap();
        let mut buffer = [0u8; 4096];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => {
                    let _ = app_clone.emit("terminal:exit", serde_json::json!({
                        "session_id": session_id_clone,
                    }));
                    break;
                }
                Ok(n) => {
                    if let Ok(data) = String::from_utf8(buffer[..n].to_vec()) {
                        let _ = app_clone.emit("terminal:data", data);
                    }
                }
                Err(_) => break,
            }
        }
    });

    info!("Terminal session started: {}", session_id);

    Ok(TerminalStartResult {
        ok: true,
        error: String::new(),
        pid: None,
        session_id: Some(session_id),
    })
}

#[tauri::command]
fn terminal_input(session_id: String, data: String) -> Result<(), String> {
    let mut sessions = TERMINAL_SESSIONS.lock().unwrap();
    if let Some(session) = sessions.get_mut(&session_id) {
        session.write(&data)?;
    }
    Ok(())
}

#[tauri::command]
fn terminal_resize(_session_id: String, _cols: i32, _rows: i32) -> Result<(), String> {
    info!("Terminal resize requested");
    Ok(())
}

#[tauri::command]
fn terminal_stop(session_id: String) -> Result<(), String> {
    let mut sessions = TERMINAL_SESSIONS.lock().unwrap();
    sessions.remove(&session_id);
    info!("Terminal session stopped: {}", session_id);
    Ok(())
}

// Skills commands
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillTemplate {
    pub id: String,
    pub name: String,
    pub description: String,
    pub source: String,
    pub path: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomizationResult {
    #[serde(rename = "skillRoot")]
    pub skill_root: String,
    #[serde(rename = "skillTemplates")]
    pub skill_templates: HashMap<String, SkillTemplate>,
    #[serde(rename = "mcpConfigPath")]
    pub mcp_config_path: String,
    #[serde(rename = "mcpConfigSource")]
    pub mcp_config_source: String,
    #[serde(rename = "mcpConfigText")]
    pub mcp_config_text: String,
    #[serde(rename = "mcpConfigError")]
    pub mcp_config_error: String,
}

#[tauri::command]
fn get_customization(settings: Settings) -> Result<CustomizationResult, String> {
    let skill_root = if settings.skills_dir.is_empty() {
        get_skills_dir().to_string_lossy().to_string()
    } else {
        settings.skills_dir.clone()
    };

    Ok(CustomizationResult {
        skill_root,
        skill_templates: HashMap::new(),
        mcp_config_path: settings.mcp_config_path,
        mcp_config_source: "generated".to_string(),
        mcp_config_text: "{}".to_string(),
        mcp_config_error: String::new(),
    })
}

#[tauri::command]
fn create_skill_template(
    skill_id: String,
    name: String,
    description: String,
    content: String,
) -> Result<SkillTemplate, String> {
    let skills_dir = get_skills_dir();
    let skill_dir = skills_dir.join(&skill_id);
    let skill_file = skill_dir.join("SKILL.md");

    fs::create_dir_all(&skill_dir).map_err(|e| e.to_string())?;

    let frontmatter = format!(
        "---\nname: {}\ndescription: {}\n---\n\n# {}\n\n{}",
        skill_id, description, name, content
    );

    let content_for_return = frontmatter.clone();
    fs::write(&skill_file, &frontmatter).map_err(|e| e.to_string())?;

    Ok(SkillTemplate {
        id: skill_id,
        name,
        description,
        source: "custom".to_string(),
        path: skill_file.to_string_lossy().to_string(),
        content: content_for_return,
    })
}

#[tauri::command]
fn import_skill_directory(source_path: String) -> Result<Vec<SkillTemplate>, String> {
    let source = PathBuf::from(&source_path);
    if !source.exists() {
        return Err("Source directory does not exist".to_string());
    }

    let skills_dir = get_skills_dir();
    fs::create_dir_all(&skills_dir).map_err(|e| e.to_string())?;

    let mut imported = vec![];

    if let Ok(entries) = fs::read_dir(&source) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() && path.join("SKILL.md").exists() {
                let skill_file = path.join("SKILL.md");
                if let Ok(content) = fs::read_to_string(&skill_file) {
                    let id = path.file_name()
                        .map(|n| n.to_string_lossy().to_string())
                        .unwrap_or_default();
                    let skill_dir = skills_dir.join(&id);
                    fs::create_dir_all(&skill_dir).map_err(|e| e.to_string())?;
                    fs::copy(&skill_file, skill_dir.join("SKILL.md")).map_err(|e| e.to_string())?;

                    imported.push(SkillTemplate {
                        id: id.clone(),
                        name: id.clone(),
                        description: String::new(),
                        source: "imported".to_string(),
                        path: skill_file.to_string_lossy().to_string(),
                        content,
                    });
                }
            }
        }
    }

    Ok(imported)
}

// MCP commands
#[tauri::command]
fn save_mcp_config(content: String) -> Result<String, String> {
    ensure_user_data_dir().map_err(|e| e.to_string())?;
    let path = get_user_data_dir().join("mcp.custom.json");
    fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServerTestResult {
    pub ok: bool,
    #[serde(rename = "testedAt")]
    pub tested_at: String,
    #[serde(rename = "configPath")]
    pub config_path: String,
    pub servers: Vec<McpServerStatus>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServerStatus {
    pub id: String,
    pub command: String,
    pub ok: bool,
    #[serde(rename = "commandFound")]
    pub command_found: bool,
    #[serde(rename = "missingEnv")]
    pub missing_env: Vec<String>,
    pub warnings: Vec<String>,
}

#[tauri::command]
fn test_mcp_servers(settings: Settings) -> McpServerTestResult {
    McpServerTestResult {
        ok: true,
        tested_at: Utc::now().to_rfc3339(),
        config_path: settings.mcp_config_path,
        servers: vec![],
    }
}

// Runtime check
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeCheck {
    pub selected: String,
    #[serde(rename = "selectedExists")]
    pub selected_exists: bool,
    pub bundled: String,
    #[serde(rename = "bundledExists")]
    pub bundled_exists: bool,
    pub system: String,
    #[serde(rename = "systemExists")]
    pub system_exists: bool,
    pub version: String,
}

#[tauri::command]
fn check_runtime(settings: Settings) -> RuntimeCheck {
    RuntimeCheck {
        selected: if settings.binary_mode == "custom" {
            settings.custom_binary_path
        } else {
            "deepseek".to_string()
        },
        selected_exists: true,
        bundled: String::new(),
        bundled_exists: false,
        system: "deepseek".to_string(),
        system_exists: Command::new("deepseek").arg("--version").output().is_ok(),
        version: String::new(),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeSnapshot {
    pub status: String,
    pub source: String,
    #[serde(rename = "sessionId")]
    pub session_id: String,
    pub mode: String,
    #[serde(rename = "workspacePath")]
    pub workspace_path: String,
    pub pid: u32,
    pub command: String,
    pub args: Vec<String>,
    #[serde(rename = "startedAt")]
    pub started_at: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
    #[serde(rename = "lastExit")]
    pub last_exit: Option<serde_json::Value>,
    pub agents: Vec<serde_json::Value>,
    pub counts: serde_json::Value,
    pub events: Vec<serde_json::Value>,
}

#[tauri::command]
fn get_runtime_snapshot() -> RuntimeSnapshot {
    RuntimeSnapshot {
        status: "idle".to_string(),
        source: "none".to_string(),
        session_id: String::new(),
        mode: String::new(),
        workspace_path: String::new(),
        pid: 0,
        command: String::new(),
        args: vec![],
        started_at: String::new(),
        updated_at: Utc::now().to_rfc3339(),
        last_exit: None,
        agents: vec![],
        counts: serde_json::json!({
            "total": 0,
            "running": 0,
            "completed": 0,
            "failed": 0,
            "cancelled": 0
        }),
        events: vec![],
    }
}

// Editor open
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EditorOpenResult {
    pub ok: bool,
    pub error: String,
    pub editor: Option<String>,
    pub path: Option<String>,
    pub command: Option<String>,
}

#[tauri::command]
fn open_workspace_editor(editor: String, workspace_path: String) -> EditorOpenResult {
    let cmd = match editor.as_str() {
        "cursor" => {
            if cfg!(target_os = "windows") {
                vec!["cursor.cmd", "code"]
            } else {
                vec!["cursor"]
            }
        }
        "vscode" => {
            if cfg!(target_os = "windows") {
                vec!["code.cmd", "code"]
            } else {
                vec!["code"]
            }
        }
        _ => return EditorOpenResult {
            ok: false,
            error: "Unsupported editor".to_string(),
            editor: None,
            path: None,
            command: None,
        },
    };

    for command in &cmd {
        let output = Command::new(command)
            .arg(&workspace_path)
            .output();

        if let Ok(output) = output {
            if output.status.success() {
                return EditorOpenResult {
                    ok: true,
                    error: String::new(),
                    editor: Some(editor),
                    path: Some(workspace_path.clone()),
                    command: Some(format!("{} {}", command, workspace_path)),
                };
            }
        }
    }

    EditorOpenResult {
        ok: false,
        error: format!("{} command is not available", editor),
        editor: None,
        path: None,
        command: None,
    }
}

fn setup_logging(log_dir: PathBuf) {
    let _ = fs::create_dir_all(&log_dir);

    let file_appender = RollingFileAppender::new(Rotation::DAILY, &log_dir, "ds-code.log");

    tracing_subscriber::registry()
        .with(fmt::layer().with_writer(file_appender))
        .with(EnvFilter::from_default_env().add_directive(tracing::Level::INFO.into()))
        .init();

    info!("DS-Code starting up");
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let log_dir = get_log_dir();
    setup_logging(log_dir);

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_os::init())
        .setup(|app| {
            info!("Tauri app setup complete");
            let _ = app;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_settings,
            save_settings,
            get_api_key,
            save_api_key,
            choose_directory,
            choose_file,
            git_status,
            git_init,
            git_set_remote,
            git_commit,
            git_fetch,
            git_pull,
            git_push,
            terminal_start,
            terminal_input,
            terminal_resize,
            terminal_stop,
            get_customization,
            create_skill_template,
            import_skill_directory,
            save_mcp_config,
            test_mcp_servers,
            check_runtime,
            get_runtime_snapshot,
            open_workspace_editor,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
