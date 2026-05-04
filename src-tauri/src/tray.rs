// Tray icon for BuckyOS App. Desktop-only (Mac / Windows / Linux).
//
// Architecture:
// - The Rust side owns the OS tray icon and menu objects.
// - The frontend (React) owns translations and confirmation dialogs.
//   It pushes labels via `tray_set_labels` whenever the locale changes
//   and toggles the icon via `tray_set_enabled`.
// - When a user clicks an action item that needs confirmation (start /
//   stop / restart / refresh) the Rust side does NOT execute it; it
//   emits `TRAY_ACTION_EVENT` with the action name. The frontend brings
//   the window to front, asks for confirmation in a translated dialog,
//   and only then invokes the corresponding command.
// - "Open BuckyOS App" is handled directly in Rust (just show + focus).
// - "Quit BuckyOS App" is also handled in Rust (clean app exit).
//
// Service state is read from the vendored `node_control` module
// (originally from buckyos-api). `node_control::node_check` runs the
// real probe (process scan, TCP, launchctl/systemctl/schtasks query)
// and `node_start` / `node_stop` route through the appropriate
// host-control model internally — the tray layer just calls them.
// Because these calls are blocking and can take 0.5–2s, every tray
// command is `async` and offloads to `tauri::async_runtime::spawn_blocking`.

use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};

use serde::{Deserialize, Serialize};
use tauri::{
    image::Image,
    menu::{MenuBuilder, MenuItem, MenuItemBuilder, Submenu, SubmenuBuilder},
    tray::{TrayIcon, TrayIconBuilder},
    AppHandle, Emitter, Manager, Wry,
};

use crate::error::{CommandErrors, CommandResult};
use crate::node_control::{
    self, NodeCheckOptions, NodeCheckReport, NodeFaultLevel, NodeHostControlModel,
    NodeStartRequest, NodeStopRequest,
};

pub const TRAY_ID: &str = "buckyos-tray";
pub const TRAY_ACTION_EVENT: &str = "buckyos://tray-action";
pub const TRAY_STATE_EVENT: &str = "buckyos://tray-state";

const ICON_BYTES: &[u8] = include_bytes!("../icons/32x32.png");

// Time to wait after start/stop before re-probing real state. The host
// service managers (launchd / systemd / schtasks) and node_daemon spawn
// take a moment to settle — too short and the recheck still sees the
// transient state.
const POST_ACTION_SETTLE_MS: u64 = 1500;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ServiceStatus {
    Running,
    #[default]
    Stopped,
    /// Active install/runtime expected to be up but isn't.
    Error,
    /// `etc/node_identity.json` doesn't exist — device hasn't been
    /// activated yet. Service start/stop is meaningless until the user
    /// completes activation in the App.
    NotActivated,
    Starting,
    Stopping,
    Refreshing,
}

/// How node_daemon is being run on this device.
///
/// Derived from `NodeHostControlModel`:
/// - DirectProcess          → Dev
/// - ServiceManager         → Installed
/// - ScheduledLauncher      → Installed
/// - ContainerizedRuntime   → Installed
/// - Unknown                → Unknown
///
/// `node_control::node_start` / `node_stop` already dispatch to the
/// right backend internally based on the host-control model, so the
/// tray layer never branches on this value for control logic. It is
/// kept purely as a UI hint shown next to the status text.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DeploymentMode {
    Dev,
    Installed,
    #[default]
    Unknown,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct TrayLabels {
    pub tooltip: String,
    /// Short status hint shown next to the icon on macOS only. Often
    /// empty for normal states; non-empty for error / transitioning.
    pub title_running: String,
    pub title_stopped: String,
    pub title_error: String,
    pub title_not_activated: String,
    pub title_starting: String,
    pub title_stopping: String,
    pub title_refreshing: String,
    /// Status text shown in the menu's first (disabled) item.
    /// Composed as `<status_text>（<deployment_text>）` when the
    /// deployment text is non-empty.
    pub status_running: String,
    pub status_stopped: String,
    pub status_error: String,
    pub status_not_activated: String,
    pub status_starting: String,
    pub status_stopping: String,
    pub status_refreshing: String,
    /// Suffix indicating how node_daemon is hosted on this device.
    pub deployment_dev: String,
    pub deployment_installed: String,
    /// Empty by default — Unknown means "we couldn't tell", so we
    /// usually omit the suffix entirely.
    pub deployment_unknown: String,
    pub submenu_actions: String,
    pub action_start: String,
    pub action_stop: String,
    pub action_restart: String,
    pub action_refresh: String,
    pub action_open_app: String,
    pub action_quit: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct TrayStateSnapshot {
    pub enabled: bool,
    pub status: ServiceStatus,
    pub deployment: DeploymentMode,
}

pub struct TrayState {
    enabled: AtomicBool,
    inner: Mutex<TrayInner>,
}

struct TrayInner {
    status: ServiceStatus,
    deployment: DeploymentMode,
    labels: TrayLabels,
    tray: Option<TrayIcon<Wry>>,
    items: Option<TrayMenuItems>,
}

struct TrayMenuItems {
    status: MenuItem<Wry>,
    start: MenuItem<Wry>,
    stop: MenuItem<Wry>,
    restart: MenuItem<Wry>,
    refresh: MenuItem<Wry>,
    open_app: MenuItem<Wry>,
    quit: MenuItem<Wry>,
    actions_submenu: Submenu<Wry>,
}

impl TrayState {
    pub fn new() -> Self {
        Self {
            enabled: AtomicBool::new(false),
            inner: Mutex::new(TrayInner {
                status: ServiceStatus::Stopped,
                deployment: DeploymentMode::Unknown,
                labels: TrayLabels::default(),
                tray: None,
                items: None,
            }),
        }
    }

    pub fn is_enabled(&self) -> bool {
        self.enabled.load(Ordering::Acquire)
    }

    fn snapshot(&self) -> TrayStateSnapshot {
        let guard = self.inner.lock().expect("tray state poisoned");
        TrayStateSnapshot {
            enabled: self.is_enabled(),
            status: guard.status,
            deployment: guard.deployment,
        }
    }
}

fn install_tray(app: &AppHandle, state: &TrayState) -> CommandResult<()> {
    let mut guard = state.inner.lock().expect("tray state poisoned");
    if guard.tray.is_some() {
        return Ok(());
    }

    let labels = guard.labels.clone();
    let status = guard.status;
    let deployment = guard.deployment;

    let status_item =
        MenuItemBuilder::with_id("tray_status", &status_text(&labels, status, deployment))
            .enabled(false)
            .build(app)
            .map_err(|e| CommandErrors::internal(format!("tray status item: {e}")))?;
    let start_item = MenuItemBuilder::with_id("tray_start", &or_default(&labels.action_start, "Start"))
        .enabled(can_start(status))
        .build(app)
        .map_err(|e| CommandErrors::internal(format!("tray start item: {e}")))?;
    let stop_item = MenuItemBuilder::with_id("tray_stop", &or_default(&labels.action_stop, "Stop"))
        .enabled(can_stop(status))
        .build(app)
        .map_err(|e| CommandErrors::internal(format!("tray stop item: {e}")))?;
    let restart_item =
        MenuItemBuilder::with_id("tray_restart", &or_default(&labels.action_restart, "Restart"))
            .enabled(can_restart(status))
            .build(app)
            .map_err(|e| CommandErrors::internal(format!("tray restart item: {e}")))?;
    let refresh_item =
        MenuItemBuilder::with_id("tray_refresh", &or_default(&labels.action_refresh, "Refresh"))
            .enabled(can_refresh(status))
            .build(app)
            .map_err(|e| CommandErrors::internal(format!("tray refresh item: {e}")))?;

    let actions_submenu = SubmenuBuilder::with_id(
        app,
        "tray_actions",
        &or_default(&labels.submenu_actions, "Actions"),
    )
    .item(&start_item)
    .item(&stop_item)
    .item(&restart_item)
    .item(&refresh_item)
    .build()
    .map_err(|e| CommandErrors::internal(format!("tray actions submenu: {e}")))?;

    let open_app_item = MenuItemBuilder::with_id(
        "tray_open_app",
        &or_default(&labels.action_open_app, "Open BuckyOS App"),
    )
    .build(app)
    .map_err(|e| CommandErrors::internal(format!("tray open-app item: {e}")))?;
    let quit_item = MenuItemBuilder::with_id(
        "tray_quit",
        &or_default(&labels.action_quit, "Quit BuckyOS App"),
    )
    .build(app)
    .map_err(|e| CommandErrors::internal(format!("tray quit item: {e}")))?;

    let menu = MenuBuilder::new(app)
        .item(&status_item)
        .separator()
        .item(&actions_submenu)
        .item(&open_app_item)
        .separator()
        .item(&quit_item)
        .build()
        .map_err(|e| CommandErrors::internal(format!("tray menu: {e}")))?;

    let icon = Image::from_bytes(ICON_BYTES)
        .map_err(|e| CommandErrors::internal(format!("tray icon decode: {e}")))?;

    let tray = TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        // Render the icon in full color rather than as a macOS template
        // image — the BuckyOS logo is colored, not monochrome.
        .icon_as_template(false)
        .tooltip(or_default(&labels.tooltip, "BuckyOS"))
        .title(title_text(&labels, status))
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(handle_menu_event)
        .build(app)
        .map_err(|e| CommandErrors::internal(format!("tray build: {e}")))?;

    guard.tray = Some(tray);
    guard.items = Some(TrayMenuItems {
        status: status_item,
        start: start_item,
        stop: stop_item,
        restart: restart_item,
        refresh: refresh_item,
        open_app: open_app_item,
        quit: quit_item,
        actions_submenu,
    });
    state.enabled.store(true, Ordering::Release);
    Ok(())
}

fn uninstall_tray(app: &AppHandle, state: &TrayState) {
    let mut guard = state.inner.lock().expect("tray state poisoned");
    guard.items = None;
    if guard.tray.take().is_some() {
        let _ = app.remove_tray_by_id(TRAY_ID);
    }
    state.enabled.store(false, Ordering::Release);
}

fn refresh_menu(state: &TrayState) {
    let guard = state.inner.lock().expect("tray state poisoned");
    let Some(items) = guard.items.as_ref() else {
        return;
    };

    let labels = &guard.labels;
    let status = guard.status;
    let deployment = guard.deployment;

    let _ = items.status.set_text(&status_text(labels, status, deployment));
    let _ = items.start.set_text(&or_default(&labels.action_start, "Start"));
    let _ = items.stop.set_text(&or_default(&labels.action_stop, "Stop"));
    let _ = items
        .restart
        .set_text(&or_default(&labels.action_restart, "Restart"));
    let _ = items
        .refresh
        .set_text(&or_default(&labels.action_refresh, "Refresh"));
    let _ = items
        .actions_submenu
        .set_text(&or_default(&labels.submenu_actions, "Actions"));
    let _ = items
        .open_app
        .set_text(&or_default(&labels.action_open_app, "Open BuckyOS App"));
    let _ = items
        .quit
        .set_text(&or_default(&labels.action_quit, "Quit BuckyOS App"));

    let _ = items.start.set_enabled(can_start(status));
    let _ = items.stop.set_enabled(can_stop(status));
    let _ = items.restart.set_enabled(can_restart(status));
    let _ = items.refresh.set_enabled(can_refresh(status));

    if let Some(tray) = guard.tray.as_ref() {
        let _ = tray.set_tooltip(Some(or_default(&labels.tooltip, "BuckyOS")));
        let _ = tray.set_title(Some(title_text(labels, status)));
    }
}

fn handle_menu_event(app: &AppHandle, event: tauri::menu::MenuEvent) {
    match event.id.as_ref() {
        "tray_open_app" => show_main_window(app),
        "tray_quit" => {
            // Cleanly exit. Note: this only stops the BuckyOS App
            // process. Local services (if any) are NOT affected — see
            // doc/托盘图标需求.md §10.
            app.exit(0);
        }
        "tray_start" => emit_action(app, "start"),
        "tray_stop" => emit_action(app, "stop"),
        "tray_restart" => emit_action(app, "restart"),
        "tray_refresh" => emit_action(app, "refresh"),
        _ => {}
    }
}

fn emit_action(app: &AppHandle, action: &str) {
    show_main_window(app);
    let _ = app.emit(TRAY_ACTION_EVENT, action.to_string());
}

fn emit_state(app: &AppHandle) {
    let state = app.state::<TrayState>();
    let _ = app.emit(TRAY_STATE_EVENT, state.snapshot());
}

pub fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn or_default(value: &str, fallback: &str) -> String {
    if value.trim().is_empty() {
        fallback.to_string()
    } else {
        value.to_string()
    }
}

fn status_text(labels: &TrayLabels, status: ServiceStatus, deployment: DeploymentMode) -> String {
    let base = match status {
        ServiceStatus::Running => &labels.status_running,
        ServiceStatus::Stopped => &labels.status_stopped,
        ServiceStatus::Error => &labels.status_error,
        ServiceStatus::NotActivated => &labels.status_not_activated,
        ServiceStatus::Starting => &labels.status_starting,
        ServiceStatus::Stopping => &labels.status_stopping,
        ServiceStatus::Refreshing => &labels.status_refreshing,
    };
    let base = or_default(base, "BuckyOS status");

    let suffix = match deployment {
        DeploymentMode::Dev => labels.deployment_dev.trim(),
        DeploymentMode::Installed => labels.deployment_installed.trim(),
        DeploymentMode::Unknown => labels.deployment_unknown.trim(),
    };
    if suffix.is_empty() {
        base
    } else {
        // Use FULLWIDTH parenthesis when the base contains CJK; ASCII
        // otherwise. Cheap heuristic: presence of any non-ASCII char.
        if base.chars().any(|c| !c.is_ascii()) {
            format!("{base}（{suffix}）")
        } else {
            format!("{base} ({suffix})")
        }
    }
}

fn title_text(labels: &TrayLabels, status: ServiceStatus) -> String {
    let raw = match status {
        ServiceStatus::Running => &labels.title_running,
        ServiceStatus::Stopped => &labels.title_stopped,
        ServiceStatus::Error => &labels.title_error,
        ServiceStatus::NotActivated => &labels.title_not_activated,
        ServiceStatus::Starting => &labels.title_starting,
        ServiceStatus::Stopping => &labels.title_stopping,
        ServiceStatus::Refreshing => &labels.title_refreshing,
    };
    raw.clone()
}

fn can_start(status: ServiceStatus) -> bool {
    matches!(status, ServiceStatus::Stopped | ServiceStatus::Error)
}
fn can_stop(status: ServiceStatus) -> bool {
    matches!(status, ServiceStatus::Running | ServiceStatus::Error)
}
fn can_restart(status: ServiceStatus) -> bool {
    matches!(status, ServiceStatus::Running | ServiceStatus::Error)
}
fn can_refresh(status: ServiceStatus) -> bool {
    !matches!(status, ServiceStatus::Starting | ServiceStatus::Stopping | ServiceStatus::Refreshing)
}

// ---------- node_control glue ----------

fn map_report(report: &NodeCheckReport) -> (ServiceStatus, DeploymentMode) {
    let deployment = match report.host_control.model {
        NodeHostControlModel::DirectProcess => DeploymentMode::Dev,
        NodeHostControlModel::ServiceManager
        | NodeHostControlModel::ScheduledLauncher
        | NodeHostControlModel::ContainerizedRuntime => DeploymentMode::Installed,
        NodeHostControlModel::Unknown => DeploymentMode::Unknown,
    };

    let status = if !report.activated {
        ServiceStatus::NotActivated
    } else if matches!(report.host_control.service_enabled, Some(false)) {
        // Host service manager says the unit is disabled — user/admin
        // chose to keep it stopped.
        ServiceStatus::Stopped
    } else {
        match report.overall {
            NodeFaultLevel::Green | NodeFaultLevel::Blue => ServiceStatus::Running,
            // Yellow ("booting or degraded") is intentionally surfaced
            // as Error so the user gets the warning indicator. If the
            // system is mid-boot the next refresh will flip it back to
            // Running.
            NodeFaultLevel::Yellow | NodeFaultLevel::Orange | NodeFaultLevel::Red => {
                ServiceStatus::Error
            }
        }
    };

    (status, deployment)
}

async fn run_node_check() -> Result<NodeCheckReport, String> {
    tauri::async_runtime::spawn_blocking(|| node_control::node_check(None, NodeCheckOptions::standard()))
        .await
        .map_err(|e| format!("node_check task failed: {e}"))
}

async fn run_node_start() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(|| node_control::node_start(NodeStartRequest::default()))
        .await
        .map_err(|e| format!("node_start task failed: {e}"))?
        .map(|_| ())
}

async fn run_node_stop() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(|| node_control::node_stop(NodeStopRequest::default()))
        .await
        .map_err(|e| format!("node_stop task failed: {e}"))?
        .map(|_| ())
}

async fn settle_after_action(app: &AppHandle, fallback: ServiceStatus) {
    tokio::time::sleep(std::time::Duration::from_millis(POST_ACTION_SETTLE_MS)).await;
    match run_node_check().await {
        Ok(report) => {
            let (status, deployment) = map_report(&report);
            apply_state(app, status, Some(deployment));
        }
        Err(err) => {
            log::warn!("[tray] post-action node_check failed: {err}");
            apply_state(app, fallback, None);
        }
    }
}

fn apply_state(app: &AppHandle, status: ServiceStatus, deployment: Option<DeploymentMode>) {
    let state = app.state::<TrayState>();
    {
        let mut guard = state.inner.lock().expect("tray state poisoned");
        guard.status = status;
        if let Some(form) = deployment {
            guard.deployment = form;
        }
    }
    refresh_menu(&state);
    emit_state(app);
}

// ---------- Tauri commands ----------

#[tauri::command]
pub async fn tray_set_enabled(
    app: AppHandle,
    enabled: bool,
) -> CommandResult<TrayStateSnapshot> {
    {
        let state = app.state::<TrayState>();
        if enabled {
            install_tray(&app, &state)?;
        } else {
            uninstall_tray(&app, &state);
        }
    }

    if enabled {
        // Kick off a real status probe in the background so the tray
        // starts showing live state without blocking the toggle reply.
        let app_for_probe = app.clone();
        tauri::async_runtime::spawn(async move {
            apply_state(&app_for_probe, ServiceStatus::Refreshing, None);
            match run_node_check().await {
                Ok(report) => {
                    let (status, deployment) = map_report(&report);
                    apply_state(&app_for_probe, status, Some(deployment));
                }
                Err(err) => {
                    log::warn!("[tray] initial node_check failed: {err}");
                    apply_state(&app_for_probe, ServiceStatus::Error, None);
                }
            }
        });
    }

    let snapshot = app.state::<TrayState>().snapshot();
    let _ = app.emit(TRAY_STATE_EVENT, snapshot.clone());
    Ok(snapshot)
}

#[tauri::command]
pub fn tray_set_labels(app: AppHandle, labels: TrayLabels) -> CommandResult<()> {
    {
        let state = app.state::<TrayState>();
        let mut guard = state.inner.lock().expect("tray state poisoned");
        guard.labels = labels;
    }
    let state = app.state::<TrayState>();
    refresh_menu(&state);
    emit_state(&app);
    Ok(())
}

#[tauri::command]
pub fn tray_get_state(app: AppHandle) -> CommandResult<TrayStateSnapshot> {
    Ok(app.state::<TrayState>().snapshot())
}

#[tauri::command]
pub async fn tray_start_service(app: AppHandle) -> CommandResult<TrayStateSnapshot> {
    apply_state(&app, ServiceStatus::Starting, None);
    if let Err(err) = run_node_start().await {
        log::error!("[tray] node_start failed: {err}");
        apply_state(&app, ServiceStatus::Error, None);
        return Err(CommandErrors::internal(format!("node_start failed: {err}")));
    }
    settle_after_action(&app, ServiceStatus::Running).await;
    Ok(app.state::<TrayState>().snapshot())
}

#[tauri::command]
pub async fn tray_stop_service(app: AppHandle) -> CommandResult<TrayStateSnapshot> {
    apply_state(&app, ServiceStatus::Stopping, None);
    if let Err(err) = run_node_stop().await {
        log::error!("[tray] node_stop failed: {err}");
        apply_state(&app, ServiceStatus::Error, None);
        return Err(CommandErrors::internal(format!("node_stop failed: {err}")));
    }
    settle_after_action(&app, ServiceStatus::Stopped).await;
    Ok(app.state::<TrayState>().snapshot())
}

#[tauri::command]
pub async fn tray_restart_service(app: AppHandle) -> CommandResult<TrayStateSnapshot> {
    apply_state(&app, ServiceStatus::Stopping, None);
    if let Err(err) = run_node_stop().await {
        log::error!("[tray] node_stop (restart) failed: {err}");
        apply_state(&app, ServiceStatus::Error, None);
        return Err(CommandErrors::internal(format!("node_stop failed: {err}")));
    }
    apply_state(&app, ServiceStatus::Starting, None);
    if let Err(err) = run_node_start().await {
        log::error!("[tray] node_start (restart) failed: {err}");
        apply_state(&app, ServiceStatus::Error, None);
        return Err(CommandErrors::internal(format!("node_start failed: {err}")));
    }
    settle_after_action(&app, ServiceStatus::Running).await;
    Ok(app.state::<TrayState>().snapshot())
}

#[tauri::command]
pub async fn tray_refresh_status(app: AppHandle) -> CommandResult<TrayStateSnapshot> {
    apply_state(&app, ServiceStatus::Refreshing, None);
    match run_node_check().await {
        Ok(report) => {
            let (status, deployment) = map_report(&report);
            apply_state(&app, status, Some(deployment));
        }
        Err(err) => {
            log::warn!("[tray] node_check failed: {err}");
            apply_state(&app, ServiceStatus::Error, None);
        }
    }
    Ok(app.state::<TrayState>().snapshot())
}
