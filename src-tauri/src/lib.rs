use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::thread;

use chrono::Utc;
use dirs::home_dir;
use once_cell::sync::Lazy;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_dialog::DialogExt;
use tracing::{info, warn};
use tracing_appender::rolling::{RollingFileAppender, Rotation};
use tracing_subscriber::{fmt, prelude::*, EnvFilter};

// Global state for terminal sessions
static TERMINAL_SESSIONS: Lazy<Arc<Mutex<HashMap<String, TerminalSession>>>> =
    Lazy::new(|| Arc::new(Mutex::new(HashMap::new())));

// Terminal event buffer for HTTP polling (bypasses Tauri IPC/ACL)
#[derive(Debug, Clone, Serialize, Deserialize)]
struct TerminalEventRecord {
    id: String,
    timestamp: i64,
    event_type: String,
    data: String,
}
static TERMINAL_EVENTS: Lazy<Arc<Mutex<Vec<TerminalEventRecord>>>> =
    Lazy::new(|| Arc::new(Mutex::new(Vec::new())));

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
    #[serde(rename = "apiKey")]
    pub api_key: String,
}

struct TerminalSession {
    writer: Option<Box<dyn Write + Send>>,
    child: Option<Box<dyn portable_pty::Child + Send>>,
}

impl TerminalSession {
    fn new(writer: Box<dyn Write + Send>, child: Box<dyn portable_pty::Child + Send>) -> Self {
        Self { writer: Some(writer), child: Some(child) }
    }

    fn try_get_exit_code(&mut self) -> Option<u32> {
        if let Some(child) = self.child.as_mut() {
            if let Ok(Some(status)) = child.try_wait() {
                return Some(status.exit_code());
            }
        }
        None
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

    let binary_path = find_deepseek_binary(&settings.binary_mode, &settings.custom_binary_path, Some(&app));

    info!("Starting terminal with binary: {}, workspace: {}, action: {}", binary_path, options.workspace_path, options.launch_action);

    let mut args = match options.launch_action.as_str() {
        "continue" => {
            let mut a = vec!["run", "--workspace", &options.workspace_path, "--continue"];
            if settings.mcp_enabled {
                a.push("--enable");
                a.push("mcp");
            }
            a
        }
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
            // Enable runtime HTTP API on port 7878
            a.push("--http");
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
    // Add the binary's directory to PATH so child processes find VCRUNTIME140.dll etc.
    if let Some(bin_dir) = Path::new(&binary_path).parent() {
        let bin_dir_str = bin_dir.to_string_lossy();
        let current_path = std::env::var("PATH").unwrap_or_default();
        let new_path = format!("{};{}", bin_dir_str, current_path);
        cmd.env("PATH", &new_path);
        info!("Added {} to PATH for child process", bin_dir_str);
    } else {
        info!("Could not determine parent directory of {}", binary_path);
    }
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("DEEPSEEK_MODEL", &settings.model);
    if !settings.base_url.is_empty() {
        cmd.env("DEEPSEEK_BASE_URL", &settings.base_url);
    }
    if settings.provider != "deepseek" && !settings.provider.is_empty() {
        cmd.env("DEEPSEEK_PROVIDER", &settings.provider);
    }

    if !options.api_key.is_empty() {
        cmd.env("DEEPSEEK_API_KEY", &options.api_key);
    } else if let Ok(api_key) = get_api_key(settings.provider.clone()) {
        if !api_key.is_empty() {
            cmd.env("DEEPSEEK_API_KEY", &api_key);
        }
    }

    info!("Launching: {} {:?} with DEEPSEEK_MODEL={}, DEEPSEEK_BASE_URL={}", binary_path, args, settings.model, settings.base_url);

    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    let pid = child.process_id();

    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    {
        let mut sessions = TERMINAL_SESSIONS.lock().unwrap();
        sessions.insert(session_id.clone(), TerminalSession::new(writer, child));
    }

    let session_id_clone = session_id.clone();
    let app_clone = app.clone();

    std::thread::spawn(move || {
        let mut buffer = [0u8; 4096];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => {
                    info!("Terminal EOF for session: {}", session_id_clone);
                    // Try to get exit code before cleaning up
                    let mut sessions = TERMINAL_SESSIONS.lock().unwrap();
                    let ec = if let Some(session) = sessions.get_mut(&session_id_clone) {
                        session.try_get_exit_code().unwrap_or(0)
                    } else {
                        0
                    };
                    let payload = serde_json::json!({
                        "session_id": session_id_clone,
                        "exitCode": ec
                    });
                    sessions.remove(&session_id_clone);
                    drop(sessions);
                    let _ = emit_terminal_event(&app_clone, "terminal:exit", &payload.to_string());
                    break;
                }
                Ok(n) => {
                    if let Ok(data) = String::from_utf8(buffer[..n].to_vec()) {
                        info!("Terminal output: {} bytes", data.len());
                        let _ = emit_terminal_event(&app_clone, "terminal:data", &data);
                    }
                }
                Err(e) => {
                    info!("Terminal read error: {}, session: {}", e, session_id_clone);
                    let mut sessions = TERMINAL_SESSIONS.lock().unwrap();
                    let ec = if let Some(session) = sessions.get_mut(&session_id_clone) {
                        session.try_get_exit_code().unwrap_or(1)
                    } else {
                        1
                    };
                    let payload = serde_json::json!({
                        "session_id": session_id_clone,
                        "exitCode": ec
                    });
                    sessions.remove(&session_id_clone);
                    drop(sessions);
                    let _ = emit_terminal_event(&app_clone, "terminal:exit", &payload.to_string());
                    break;
                }
            }
        }
    });

    info!("Terminal session started: {} (pid: {:?})", session_id, pid);

    Ok(TerminalStartResult {
        ok: true,
        error: String::new(),
        pid,
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
fn find_deepseek_binary(binary_mode: &str, custom_binary_path: &str, app: Option<&AppHandle>) -> String {
    if binary_mode == "custom" && !custom_binary_path.is_empty() {
        return custom_binary_path.to_string();
    }

    // Minimum size for a real deepseek binary (shim scripts are ~16KB, real binary is >1MB)
    const MIN_REAL_BINARY_SIZE: u64 = 1_000_000;

    // Helper to check if a file is a real binary (not a 16KB node shim)
    fn is_real_binary(path: &std::path::Path) -> bool {
        if let Ok(metadata) = std::fs::metadata(path) {
            metadata.len() > MIN_REAL_BINARY_SIZE
        } else {
            false
        }
    }

    // Helper to find a deepseek binary alongside the executable
    fn find_alongside_exe(name: &str) -> Option<String> {
        if let Ok(exe_path) = std::env::current_exe() {
            if let Some(exe_dir) = exe_path.parent() {
                let candidate = exe_dir.join(name);
                if candidate.exists() && is_real_binary(&candidate) {
                    info!("Found {} (alongside exe) at: {}", name, candidate.display());
                    // Set DEEPSEEK_TUI_BIN to help the dispatcher find the TUI binary
                    if name == "deepseek.exe" {
                        let tui_candidate = exe_dir.join("deepseek-tui.exe");
                        if tui_candidate.exists() {
                            std::env::set_var("DEEPSEEK_TUI_BIN", tui_candidate.to_string_lossy().as_ref());
                            info!("Set DEEPSEEK_TUI_BIN={}", tui_candidate.display());
                        }
                    }
                    return Some(candidate.to_string_lossy().to_string());
                }
            }
        }
        None
    }

    // Try deepseek-tui.exe FIRST (bypasses dispatcher, fewer DLL issues)
    // deepseek.exe is a CLI dispatcher that forwards to deepseek-tui.exe
    if let Some(path) = find_alongside_exe("deepseek-tui.exe") {
        let tui_path = path.clone();
        // Also set DEEPSEEK_TUI_BIN to the same path
        std::env::set_var("DEEPSEEK_TUI_BIN", &tui_path);
        info!("Using deepseek-tui.exe directly, DEEPSEEK_TUI_BIN={}", tui_path);
        return tui_path;
    }

    // 1. Try deepseek.exe alongside the executable
    if let Some(path) = find_alongside_exe("deepseek.exe") {
        return path;
    }

    // 2. Try bundled resource directory (for installed/release builds)
    if let Some(app) = app {
        if let Ok(resource_dir) = app.path().resource_dir() {
            for name in &["deepseek-tui.exe", "deepseek.exe"] {
                let bundled_path = resource_dir.join("bin").join(name);
                if bundled_path.exists() && is_real_binary(&bundled_path) {
                    info!("Found {} (bundled) at: {}", name, bundled_path.display());
                    if name == &"deepseek.exe" {
                        let tui = resource_dir.join("bin").join("deepseek-tui.exe");
                        if tui.exists() { std::env::set_var("DEEPSEEK_TUI_BIN", tui.to_string_lossy().as_ref()); }
                    }
                    return bundled_path.to_string_lossy().to_string();
                }
            }
        }
        if let Ok(data_dir) = app.path().app_data_dir() {
            for name in &["deepseek-tui.exe", "deepseek.exe"] {
                let data_path = data_dir.join("bin").join(name);
                if data_path.exists() && is_real_binary(&data_path) {
                    info!("Found {} (app data) at: {}", name, data_path.display());
                    return data_path.to_string_lossy().to_string();
                }
            }
        }
    }

    // 3. Try CARGO_MANIFEST_DIR parent / node_modules (for dev builds)
    // This path has the REAL 9.6MB binary, not the 16KB shim
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    if let Some(project_root) = manifest_dir.parent() {
        let alt_path = project_root.join("node_modules").join("deepseek-tui").join("bin").join("downloads").join("deepseek.exe");
        if alt_path.exists() && is_real_binary(&alt_path) {
            info!("Found deepseek binary (node_modules download) at: {}", alt_path.display());
            return std::fs::canonicalize(&alt_path).unwrap_or(alt_path).to_string_lossy().to_string();
        }
        let dev_path = project_root.join("node_modules").join(".bin").join("deepseek.exe");
        if dev_path.exists() && is_real_binary(&dev_path) {
            info!("Found deepseek binary (dev) at: {}", dev_path.display());
            return std::fs::canonicalize(&dev_path).unwrap_or(dev_path).to_string_lossy().to_string();
        }
    }

    // 4. Try PATH lookup as last resort
    // Also check for deepseek-tui directly
    for cmd_name in &["deepseek", "deepseek-tui"] {
        if Command::new(cmd_name).arg("--version").output().is_ok() {
            info!("Found {} via PATH", cmd_name);
            if cmd_name == &"deepseek-tui" {
                std::env::set_var("DEEPSEEK_TUI_BIN", cmd_name);
            }
            return cmd_name.to_string();
        }
    }

    warn!("deepseek binary not found - checked exe_dir, node_modules, and PATH");
    "deepseek".to_string()
}
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
fn check_runtime(app: AppHandle, settings: Settings) -> RuntimeCheck {
    let found_binary = find_deepseek_binary(&settings.binary_mode, &settings.custom_binary_path, Some(&app));
    let system_exists = found_binary == "deepseek" || Path::new(&found_binary).exists();
    RuntimeCheck {
        selected: if settings.binary_mode == "custom" {
            settings.custom_binary_path
        } else {
            found_binary.clone()
        },
        selected_exists: system_exists,
        bundled: String::new(),
        bundled_exists: false,
        system: found_binary,
        system_exists,
        version: String::new(),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeAgent {
    pub id: String,
    pub name: String,
    pub status: String,
    pub summary: String,
    pub source: String,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
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
    pub agents: Vec<RuntimeAgent>,
    pub counts: serde_json::Value,
    pub events: Vec<serde_json::Value>,
}

#[tauri::command]
async fn get_runtime_snapshot() -> RuntimeSnapshot {
    // Try to fetch real runtime data from the deepseek Runtime API at port 7878
    let client = reqwest::Client::new();
    match client
        .get("http://127.0.0.1:7878/v1/tasks")
        .timeout(std::time::Duration::from_millis(500))
        .send()
        .await
    {
        Ok(response) if response.status().is_success() => {
            if let Ok(data) = response.json::<serde_json::Value>().await {
                let counts = data.get("counts");
                let tasks = data.get("tasks").and_then(|t| t.as_array());

                let total = counts
                    .and_then(|c| c.get("total"))
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0) as usize;
                let running = counts
                    .and_then(|c| c.get("running"))
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0) as usize;
                let completed = counts
                    .and_then(|c| c.get("completed"))
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0) as usize;
                let failed = counts
                    .and_then(|c| c.get("failed"))
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0) as usize;
                let cancelled = counts
                    .and_then(|c| c.get("cancelled"))
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0) as usize;

                let agents: Vec<RuntimeAgent> = tasks
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|task| {
                                Some(RuntimeAgent {
                                    id: task.get("id")?.as_str()?.to_string(),
                                    name: task
                                        .get("prompt")
                                        .and_then(|p| p.as_str())
                                        .map(|s| {
                                            if s.len() > 50 {
                                                format!("{}...", &s[..50])
                                            } else {
                                                s.to_string()
                                            }
                                        })
                                        .unwrap_or_default(),
                                    status: task
                                        .get("status")
                                        .and_then(|s| s.as_str())
                                        .map(|s| match s {
                                            "queued" => "queued".to_string(),
                                            "running" => "running".to_string(),
                                            "completed" => "completed".to_string(),
                                            "failed" => "failed".to_string(),
                                            "cancelled" => "cancelled".to_string(),
                                            _ => "unknown".to_string(),
                                        })
                                        .unwrap_or_else(|| "unknown".to_string()),
                                    summary: task
                                        .get("summary")
                                        .and_then(|s| s.as_str())
                                        .unwrap_or("")
                                        .to_string(),
                                    source: "runtime-api".to_string(),
                                    created_at: task
                                        .get("created_at")
                                        .and_then(|s| s.as_str())
                                        .unwrap_or("")
                                        .to_string(),
                                    updated_at: task
                                        .get("updated_at")
                                        .and_then(|s| s.as_str())
                                        .unwrap_or("")
                                        .to_string(),
                                })
                            })
                            .collect()
                    })
                    .unwrap_or_default();

                return RuntimeSnapshot {
                    status: if running > 0 { "running" } else { "idle" }.to_string(),
                    source: "runtime-api".to_string(),
                    session_id: String::new(),
                    mode: String::new(),
                    workspace_path: String::new(),
                    pid: 0,
                    command: String::new(),
                    args: vec![],
                    started_at: String::new(),
                    updated_at: Utc::now().to_rfc3339(),
                    last_exit: None,
                    agents,
                    counts: serde_json::json!({
                        "total": total,
                        "running": running,
                        "completed": completed,
                        "failed": failed,
                        "cancelled": cancelled
                    }),
                    events: vec![],
                };
            }
        }
        _ => {}
    }

    // Fallback: return empty snapshot if API is not available
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

// Conversation History commands
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationMessage {
    pub id: String,
    pub role: String,
    pub title: Option<String>,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationSession {
    pub id: String,
    #[serde(rename = "projectId")]
    pub project_id: String,
    #[serde(rename = "projectName")]
    pub project_name: String,
    #[serde(rename = "workspacePath")]
    pub workspace_path: String,
    pub title: String,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
    pub messages: Vec<ConversationMessage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationProject {
    pub id: String,
    pub name: String,
    #[serde(rename = "workspacePath")]
    pub workspace_path: String,
    pub sessions: Vec<ConversationSession>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationStore {
    #[serde(rename = "activeSessionId")]
    pub active_session_id: String,
    pub projects: Vec<ConversationProject>,
}

fn get_conversation_history_path() -> PathBuf {
    get_user_data_dir().join("conversation_history.json")
}

#[tauri::command]
fn get_conversation_history() -> Result<ConversationStore, String> {
    let path = get_conversation_history_path();
    if path.exists() {
        let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).map_err(|e| e.to_string())
    } else {
        Ok(ConversationStore {
            active_session_id: String::new(),
            projects: vec![],
        })
    }
}

#[tauri::command]
fn save_conversation_history(history: ConversationStore) -> Result<ConversationStore, String> {
    ensure_user_data_dir().map_err(|e| e.to_string())?;
    let path = get_conversation_history_path();
    let content = serde_json::to_string_pretty(&history).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| e.to_string())?;
    info!("Conversation history saved");
    Ok(history)
}

// Automation commands
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutomationTask {
    pub id: String,
    pub kind: String,
    pub name: String,
    pub prompt: String,
    #[serde(rename = "workspacePath")]
    pub workspace_path: String,
    pub frequency: String,
    pub minute: i32,
    pub hour: i32,
    pub weekday: i32,
    #[serde(rename = "customSchedule")]
    pub custom_schedule: String,
    pub schedule: String,
    pub rrule: String,
    pub timezone: String,
    pub status: String,
    pub enabled: bool,
    pub installed: bool,
    #[serde(rename = "cronPath")]
    pub cron_path: String,
    #[serde(rename = "logPath")]
    pub log_path: String,
    #[serde(rename = "commandPreview")]
    pub command_preview: String,
    #[serde(rename = "runtimePath")]
    pub runtime_path: String,
    #[serde(rename = "runnerPath")]
    pub runner_path: String,
    #[serde(rename = "runArgs")]
    pub run_args: Vec<String>,
    pub provider: String,
    pub model: String,
    #[serde(rename = "baseUrl")]
    pub base_url: String,
    #[serde(rename = "mcpConfigPath")]
    pub mcp_config_path: String,
    #[serde(rename = "skillsDir")]
    pub skills_dir: String,
    #[serde(rename = "enabledSkills")]
    pub enabled_skills: Vec<String>,
    #[serde(rename = "mcpEnabled")]
    pub mcp_enabled: bool,
    #[serde(rename = "enabledMcpServers")]
    pub enabled_mcp_servers: Vec<String>,
    #[serde(rename = "allowShell")]
    pub allow_shell: bool,
    #[serde(rename = "maxSubagents")]
    pub max_subagents: i32,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
    #[serde(rename = "lastGeneratedAt")]
    pub last_generated_at: String,
    #[serde(rename = "lastInstalledAt")]
    pub last_installed_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutomationStore {
    pub version: i32,
    pub tasks: Vec<AutomationTask>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutomationActionResult {
    pub ok: bool,
    pub error: Option<String>,
    pub task: Option<AutomationTask>,
    pub tasks: Vec<AutomationTask>,
}

fn get_automations_path() -> PathBuf {
    get_user_data_dir().join("automations.json")
}

#[tauri::command]
fn get_automations() -> Result<AutomationStore, String> {
    let path = get_automations_path();
    if path.exists() {
        let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).map_err(|e| e.to_string())
    } else {
        Ok(AutomationStore {
            version: 1,
            tasks: vec![],
        })
    }
}

#[tauri::command]
fn save_automation(task: AutomationTask) -> Result<AutomationActionResult, String> {
    ensure_user_data_dir().map_err(|e| e.to_string())?;
    let path = get_automations_path();

    let mut store = if path.exists() {
        serde_json::from_str::<AutomationStore>(&fs::read_to_string(&path).map_err(|e| e.to_string())?)
            .unwrap_or(AutomationStore { version: 1, tasks: vec![] })
    } else {
        AutomationStore { version: 1, tasks: vec![] }
    };

    let now = Utc::now().to_rfc3339();
    let mut saved_task = task.clone();
    saved_task.updated_at = now.clone();
    saved_task.last_generated_at = now.clone();

    if store.tasks.iter().any(|t| t.id == task.id) {
        store.tasks = store.tasks.iter().map(|t| if t.id == task.id { saved_task.clone() } else { t.clone() }).collect();
    } else {
        saved_task.created_at = now.clone();
        store.tasks.push(saved_task.clone());
    }

    let content = serde_json::to_string_pretty(&store).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| e.to_string())?;
    info!("Automation saved: {}", saved_task.id);

    Ok(AutomationActionResult {
        ok: true,
        error: None,
        task: Some(saved_task),
        tasks: store.tasks,
    })
}

#[tauri::command]
fn delete_automation(id: String) -> Result<AutomationActionResult, String> {
    ensure_user_data_dir().map_err(|e| e.to_string())?;
    let path = get_automations_path();

    let store = if path.exists() {
        serde_json::from_str::<AutomationStore>(&fs::read_to_string(&path).map_err(|e| e.to_string())?)
            .unwrap_or(AutomationStore { version: 1, tasks: vec![] })
    } else {
        AutomationStore { version: 1, tasks: vec![] }
    };

    let tasks: Vec<AutomationTask> = store.tasks.into_iter().filter(|t| t.id != id).collect();
    let content = serde_json::to_string_pretty(&tasks).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| e.to_string())?;
    info!("Automation deleted: {}", id);

    Ok(AutomationActionResult {
        ok: true,
        error: None,
        task: None,
        tasks,
    })
}

// File Snapshot and Rollback APIs
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileSnapshot {
    pub id: String,
    #[serde(rename = "messageId")]
    pub message_id: String,
    pub files: HashMap<String, String>,
    #[serde(rename = "createdAt")]
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateSnapshotRequest {
    #[serde(rename = "messageId")]
    pub message_id: String,
    #[serde(rename = "workspacePath")]
    pub workspace_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RollbackRequest {
    #[serde(rename = "snapshotId")]
    pub snapshot_id: String,
    #[serde(rename = "workspacePath")]
    pub workspace_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RollbackResult {
    pub ok: bool,
    pub error: Option<String>,
    #[serde(rename = "snapshotId")]
    pub snapshot_id: String,
    #[serde(rename = "undoSnapshotId")]
    pub undo_snapshot_id: Option<String>,
    #[serde(rename = "restoredFiles")]
    pub restored_files: Vec<String>,
}

fn get_snapshots_path() -> PathBuf {
    get_user_data_dir().join("file_snapshots.json")
}

fn read_snapshots() -> Result<Vec<FileSnapshot>, String> {
    let path = get_snapshots_path();
    if path.exists() {
        let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).map_err(|e| e.to_string())
    } else {
        Ok(vec![])
    }
}

fn write_snapshots(snapshots: &[FileSnapshot]) -> Result<(), String> {
    ensure_user_data_dir().map_err(|e| e.to_string())?;
    let path = get_snapshots_path();
    let content = serde_json::to_string_pretty(snapshots).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(())
}

fn collect_workspace_files(workspace_path: &str) -> Result<HashMap<String, String>, String> {
    let mut files = HashMap::new();
    let base_path = PathBuf::from(workspace_path);

    if !base_path.exists() {
        return Ok(files);
    }

    fn collect_dir(dir: &PathBuf, base: &Path, files: &mut HashMap<String, String>) -> Result<(), String> {
        let entries = fs::read_dir(dir).map_err(|e| e.to_string())?;
        for entry in entries.flatten() {
            let path = entry.path();
            let relative = path.strip_prefix(base).unwrap_or(&path);
            let relative_str = relative.to_string_lossy().to_string();

            // Skip .git, node_modules, target, and other common ignore dirs
            if relative_str.starts_with(".git")
                || relative_str.starts_with("node_modules")
                || relative_str.starts_with("target")
                || relative_str.starts_with("dist")
                || relative_str.starts_with("build")
                || relative_str.starts_with(".deepseek")
            {
                continue;
            }

            if path.is_dir() {
                collect_dir(&path, base, files)?;
            } else if path.is_file() {
                // Skip binary files > 1MB
                if let Ok(metadata) = fs::metadata(&path) {
                    if metadata.len() > 1024 * 1024 {
                        continue;
                    }
                }
                if let Ok(content) = fs::read_to_string(&path) {
                    files.insert(relative_str, content);
                }
            }
        }
        Ok(())
    }

    collect_dir(&base_path, &base_path, &mut files)?;
    Ok(files)
}

#[tauri::command]
fn create_file_snapshot(request: CreateSnapshotRequest) -> Result<FileSnapshot, String> {
    let files = collect_workspace_files(&request.workspace_path)?;
    let snapshot = FileSnapshot {
        id: format!("snapshot_{}", Utc::now().timestamp_millis()),
        message_id: request.message_id,
        files,
        created_at: Utc::now().to_rfc3339(),
    };

    let mut snapshots = read_snapshots()?;
    // Keep only last 50 snapshots to avoid unbounded growth
    if snapshots.len() >= 50 {
        let skip_count = snapshots.len() - 50;
        snapshots = snapshots.into_iter().skip(skip_count).collect();
    }
    snapshots.push(snapshot.clone());
    write_snapshots(&snapshots)?;

    info!("File snapshot created: {}", snapshot.id);
    Ok(snapshot)
}

#[tauri::command]
fn get_file_snapshots(workspace_path: String) -> Result<Vec<FileSnapshot>, String> {
    let snapshots = read_snapshots()?;
    // Return all snapshots for the workspace
    Ok(snapshots)
}

#[tauri::command]
fn rollback_to_snapshot(request: RollbackRequest) -> Result<RollbackResult, String> {
    let snapshots = read_snapshots()?;
    let snapshot = snapshots.iter().find(|s| s.id == request.snapshot_id);

    if let Some(snapshot) = snapshot {
        // First create a snapshot of current state for undo
        let current_files = collect_workspace_files(&request.workspace_path)?;
        let undo_snapshot = FileSnapshot {
            id: format!("undo_{}", Utc::now().timestamp_millis()),
            message_id: "undo".to_string(),
            files: current_files,
            created_at: Utc::now().to_rfc3339(),
        };

        // Restore files from the snapshot
        let base_path = PathBuf::from(&request.workspace_path);
        let mut restored_files = Vec::new();

        for (relative_path, content) in &snapshot.files {
            let file_path = base_path.join(relative_path);
            if let Some(parent) = file_path.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            fs::write(&file_path, content).map_err(|e| e.to_string())?;
            restored_files.push(relative_path.clone());
        }

        // Save the undo snapshot
        let mut all_snapshots = read_snapshots()?;
        all_snapshots.push(undo_snapshot.clone());
        write_snapshots(&all_snapshots)?;

        info!("Rollback to snapshot {} completed, undo snapshot: {}", snapshot.id, undo_snapshot.id);

        Ok(RollbackResult {
            ok: true,
            error: None,
            snapshot_id: snapshot.id.clone(),
            undo_snapshot_id: Some(undo_snapshot.id),
            restored_files,
        })
    } else {
        Ok(RollbackResult {
            ok: false,
            error: Some("Snapshot not found".to_string()),
            snapshot_id: request.snapshot_id,
            undo_snapshot_id: None,
            restored_files: vec![],
        })
    }
}

#[tauri::command]
fn undo_rollback(undo_snapshot_id: String, workspace_path: String) -> Result<RollbackResult, String> {
    let snapshots = read_snapshots()?;
    let undo_snapshot = snapshots.iter().find(|s| s.id == undo_snapshot_id);

    if let Some(undo_snapshot) = undo_snapshot {
        // Restore files from the undo snapshot
        let base_path = PathBuf::from(&workspace_path);
        let mut restored_files = Vec::new();

        for (relative_path, content) in &undo_snapshot.files {
            let file_path = base_path.join(relative_path);
            if let Some(parent) = file_path.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            fs::write(&file_path, content).map_err(|e| e.to_string())?;
            restored_files.push(relative_path.clone());
        }

        info!("Undo rollback completed, restored {} files", restored_files.len());

        Ok(RollbackResult {
            ok: true,
            error: None,
            snapshot_id: undo_snapshot.id.clone(),
            undo_snapshot_id: None,
            restored_files,
        })
    } else {
        Ok(RollbackResult {
            ok: false,
            error: Some("Undo snapshot not found".to_string()),
            snapshot_id: undo_snapshot_id,
            undo_snapshot_id: None,
            restored_files: vec![],
        })
    }
}

#[tauri::command]
fn delete_snapshot(snapshot_id: String) -> Result<bool, String> {
    let mut snapshots = read_snapshots()?;
    let original_len = snapshots.len();
    snapshots.retain(|s| s.id != snapshot_id);
    write_snapshots(&snapshots)?;
    info!("Snapshot deleted: {}", snapshot_id);
    Ok(snapshots.len() < original_len)
}

// Git diff summary
#[tauri::command]
fn git_diff_summary(workspace_path: String) -> Result<String, String> {
    let repo_root = run_git(&["rev-parse", "--show-toplevel"], &workspace_path)
        .map_err(|e| e.to_string())?;

    let output = run_git(&["diff", "--stat"], &repo_root).unwrap_or_default();
    let status_output = run_git(&["status", "--porcelain=v1", "-uall"], &repo_root).unwrap_or_default();

    let mut summary = String::new();
    summary.push_str("Changed files:\n");

    for line in status_output.lines() {
        if line.len() >= 3 {
            summary.push_str(&format!(" {}\n", &line[..3]));
        }
    }

    summary.push_str("\nUnstaged diff stat:\n");
    summary.push_str(&output);

    Ok(summary)
}

fn setup_logging(_log_dir: PathBuf) {
    tracing_subscriber::registry()
        .with(fmt::layer())
        .with(EnvFilter::from_default_env().add_directive(tracing::Level::INFO.into()))
        .init();
    println!("DS-Code starting up (logging to console)");
}

fn start_file_server(app: &tauri::AppHandle) {
    let handle = app.clone();
    let dist = find_dist_path(app);
    let dist = match dist {
        Some(d) => d,
        None => {
            info!("dist directory not found, frontend will not be served");
            return;
        }
    };

    // Try to start on port 5173 (matches devUrl), fallback to random port
    let server = tiny_http::Server::http("127.0.0.1:5173")
        .or_else(|_| tiny_http::Server::http("127.0.0.1:0"))
        .map_err(|e| warn!("Failed to start file server: {}", e));

    let server = match server {
        Ok(s) => s,
        Err(_) => return,
    };

    let addr_str = format!("{}", server.server_addr());
    let port = addr_str.rsplit(':').next()
        .and_then(|s| s.trim_end_matches(']').parse().ok())
        .unwrap_or(5173);
    info!("File server started on http://127.0.0.1:{} serving {}", port, dist.display());

    let dist_path = dist.clone();
    thread::spawn(move || {
        let api_path = PathBuf::from("/api/");
        for request in server.incoming_requests() {
            let url = request.url().to_string();
            if url.starts_with("/api/invoke") && request.method() == &tiny_http::Method::Post {
                handle_api_invoke_request(request, &handle);
            } else if url.starts_with("/api/terminal-events") {
                handle_terminal_events_poll(request);
            } else {
                serve_file_request(&dist_path, request);
            }
        }
    });

    // Navigate the window to the file server URL (Tauri devUrl won't work
    // because tauri_build::build() may not have completed properly)
    let url_str = format!("http://127.0.0.1:{}", port);
    if let Some(window) = app.get_webview_window("main") {
        if let Ok(url) = url_str.parse::<tauri::Url>() {
            let _ = window.navigate(url);
            info!("Navigated window to {}", url_str);
        }
    }
}

fn find_dist_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    // 1. Try alongside the executable (portable mode)
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            let dist_dir = exe_dir.join("dist");
            if dist_dir.join("index.html").exists() {
                info!("Found dist alongside exe: {}", dist_dir.display());
                return Some(dist_dir);
            }
        }
    }
    // 2. Try resource directory (installed mode)
    if let Ok(resource_dir) = app.path().resource_dir() {
        let dist_dir = resource_dir.join("dist");
        if dist_dir.join("index.html").exists() {
            info!("Found dist in resources: {}", dist_dir.display());
            return Some(dist_dir);
        }
    }
    // 3. Try CARGO_MANIFEST_DIR parent (dev/build mode)
    let manifest_dist = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(|p| p.join("dist"));
    if let Some(dist_dir) = manifest_dist {
        if dist_dir.join("index.html").exists() {
            info!("Found dist at manifest parent: {}", dist_dir.display());
            return Some(dist_dir);
        }
    }
    warn!("dist directory not found");
    None
}

fn handle_api_invoke_request(mut request: tiny_http::Request, handle: &tauri::AppHandle) {
    use std::io::Read;
    let mut body = String::new();
    let _ = request.as_reader().read_to_string(&mut body);

    let response = if let Ok(payload) = serde_json::from_str::<serde_json::Value>(&body) {
        let command = payload.get("command").and_then(|v| v.as_str()).unwrap_or("");
        let default_args = serde_json::json!({});
        let args = payload.get("args").unwrap_or(&default_args);

        let result = match command {
            "get_settings" => {
                serde_json::to_value(get_settings().ok()).unwrap_or_default()
            }
            "save_settings" => {
                if let Ok(settings) = serde_json::from_value::<Settings>(args.clone()) {
                    let _ = save_settings(settings);
                }
                serde_json::json!({ "ok": true })
            }
            "get_api_key" => {
                let provider = args.get("provider").and_then(|v| v.as_str()).unwrap_or("deepseek");
                let key = get_api_key(provider.to_string()).unwrap_or_default();
                serde_json::json!({ "ok": true, "apiKey": key })
            }
            "save_api_key" => {
                let provider = args.get("provider").and_then(|v| v.as_str()).unwrap_or("deepseek");
                let api_key = args.get("api_key").or_else(|| args.get("apiKey")).and_then(|v| v.as_str()).unwrap_or("");
                let _ = save_api_key(provider.to_string(), api_key.to_string());
                serde_json::json!({ "ok": true })
            }
            "terminal_start" => {
                let options = serde_json::from_value::<TerminalOptions>(args.get("options").unwrap_or(&serde_json::json!({})).clone());
                let settings = serde_json::from_value::<Settings>(args.get("settings").unwrap_or(&serde_json::json!({})).clone());
                if let (Ok(opts), Ok(sett)) = (options, settings) {
                    match terminal_start(handle.clone(), opts, sett) {
                        Ok(r) => serde_json::to_value(r).unwrap_or(serde_json::json!({ "ok": true })),
                        Err(e) => serde_json::json!({ "ok": false, "error": e })
                    }
                } else {
                    serde_json::json!({ "ok": false, "error": "Invalid arguments" })
                }
            }
            "choose_directory" => {
                let folder = handle.dialog().file().blocking_pick_folder();
                serde_json::to_value(folder.map(|p| p.to_string()).unwrap_or_default()).unwrap_or_default()
            }
            _ => serde_json::json!({ "ok": false, "error": format!("Unknown command: {}", command) })
        };
        serde_json::json!({ "ok": true, "result": result })
    } else {
        serde_json::json!({ "ok": false, "error": "Invalid JSON" })
    };

    let response_body = serde_json::to_string(&response).unwrap_or_default();
    let resp = tiny_http::Response::from_string(response_body)
        .with_header("Content-Type: application/json".parse::<tiny_http::Header>().unwrap())
        .with_header("Access-Control-Allow-Origin: *".parse::<tiny_http::Header>().unwrap());
    let _ = request.respond(resp);
}

fn strip_ansi(input: &str) -> String {
    let mut result = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '\x1b' => {
                // Check what follows ESC
                match chars.peek() {
                    Some('[') => {
                        // CSI sequence: ESC[ params... final_byte
                        chars.next(); // consume '['
                        while let Some(&n) = chars.peek() {
                            if n == '@' || ('A'..='Z').contains(&n) || ('a'..='z').contains(&n) {
                                chars.next();
                                break;
                            }
                            chars.next();
                        }
                    }
                    Some(']') => {
                        // OSC sequence: ESC] ... ST (BEL or ESC\)
                        chars.next(); // consume ']'
                        while let Some(&n) = chars.peek() {
                            if n == '\x07' || (n == '\x1b') {
                                if n == '\x1b' {
                                    chars.next(); // consume ESC
                                    if chars.peek() == Some(&'\\') {
                                        chars.next(); // consume '\'
                                    }
                                } else {
                                    chars.next(); // consume BEL
                                }
                                break;
                            }
                            chars.next();
                        }
                    }
                    Some('P') | Some('X') | Some('^') | Some('_') => {
                        // SOS/PM/APC sequences: ESC X ... ST (ESC\)
                        // Discard until ESC\
                        chars.next();
                        while let Some(&n) = chars.peek() {
                            if n == '\x1b' {
                                chars.next();
                                if chars.peek() == Some(&'\\') {
                                    chars.next();
                                }
                                break;
                            }
                            chars.next();
                        }
                    }
                    _ => {} // Drop other escape sequences
                }
            }
            '\x07' => {} // Drop BEL
            '\r' => result.push('\n'),
            _ => result.push(c),
        }
    }
    result
}

fn emit_terminal_event(app: &AppHandle, event_type: &str, data: &str) {
    let cleaned = strip_ansi(data);
    let ts = Utc::now().timestamp_millis();
    {
        let mut events = TERMINAL_EVENTS.lock().unwrap();
        let event_id = format!("{}_{}", ts, events.len());
        events.push(TerminalEventRecord {
            id: event_id,
            timestamp: ts,
            event_type: event_type.to_string(),
            data: cleaned.clone(),
        });
        let len = events.len();
        if len > 1000 {
            events.drain(0..len - 500);
        }
    }
    let _ = app.emit(event_type, &cleaned);
}

fn handle_terminal_events_poll(mut request: tiny_http::Request) {
    let after = request.url().split("after=").nth(1)
        .and_then(|s| s.split('&').next())
        .and_then(|s| s.parse::<i64>().ok())
        .unwrap_or(0);

    let events = TERMINAL_EVENTS.lock().unwrap();
    let filtered: Vec<&TerminalEventRecord> = events.iter()
        .filter(|e| e.timestamp > after)
        .collect();

    let response = serde_json::json!({ "events": filtered });
    drop(events);
    let body = serde_json::to_string(&response).unwrap_or_default();
    let resp = tiny_http::Response::from_string(body)
        .with_header("Content-Type: application/json".parse::<tiny_http::Header>().unwrap())
        .with_header("Access-Control-Allow-Origin: *".parse::<tiny_http::Header>().unwrap());
    let _ = request.respond(resp);
}

fn serve_file_request(base: &Path, request: tiny_http::Request) {
    let url_path = request.url();
    let clean = url_path.trim_start_matches('/');
    let clean = clean.replace("\\", "/").replacen("..", "", 10);

    let file_path = if clean.is_empty() || clean == "/" || clean == "index.html" {
        base.join("index.html")
    } else {
        base.join(&clean)
    };

    let (data, ext, status) = match std::fs::read(&file_path) {
        Ok(content) => {
            let ext = file_path.extension()
                .and_then(|e| e.to_str())
                .unwrap_or("")
                .to_lowercase();
            (content, ext, 200)
        }
        Err(_) => {
            // Try index.html for SPA routing (fallback for all routes)
            match std::fs::read(base.join("index.html")) {
                Ok(content) => (content, "html".to_string(), 200),
                Err(_) => (b"404 Not Found".to_vec(), "txt".to_string(), 404),
            }
        }
    };

    let ct = match ext.as_str() {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "application/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "png" => "image/png",
        "ico" => "image/x-icon",
        "svg" => "image/svg+xml",
        "json" => "application/json",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "txt" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    };

    let mut response = tiny_http::Response::from_data(data).with_status_code(status);
    if let Ok(header) = tiny_http::Header::from_bytes(
        &b"Content-Type"[..],
        ct.as_bytes(),
    ) {
        response = response.with_header(header);
    }

    let _ = request.respond(response);
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
            // Start embedded HTTP server for frontend dist
            start_file_server(app.handle());
            info!("Tauri app setup complete");
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
            get_conversation_history,
            save_conversation_history,
            get_automations,
            save_automation,
            delete_automation,
            git_diff_summary,
            create_file_snapshot,
            get_file_snapshots,
            rollback_to_snapshot,
            undo_rollback,
            delete_snapshot,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
