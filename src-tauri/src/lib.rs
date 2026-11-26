const LOG_MAX_FILE_SIZE: u128 = 5 * 1024 * 1024; // 5 MiB
const LOG_FILE_HISTORY: usize = 10;

/// The bridge of the local test page, which runs in a frame of a local page. Content views and
/// activation pages get theirs, with their environment, from the code that opens them.
fn bucky_runtime_plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("bucky-runtime")
        .js_init_script_on_all_frames(content::bridge::API_SCRIPT)
        .build()
}

fn logging_plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    let pid = std::process::id();
    let file_name = format!("BuckyOSApp-{pid}");
    tauri_plugin_log::Builder::default()
        .targets([
            tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir {
                file_name: Some(file_name),
            }),
            tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
        ])
        .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepSome(
            LOG_FILE_HISTORY,
        ))
        .max_file_size(LOG_MAX_FILE_SIZE)
        .level(log::LevelFilter::Info)
        .build()
}

#[cfg(target_os = "android")]
mod android;
mod audio;
mod config;
mod content;
mod deeplink;
mod did;
mod error;
mod http_client;
#[cfg(target_os = "ios")]
mod ios_webview;
#[cfg(any(mobile, test))]
mod json_file;
#[cfg(desktop)]
mod lifecycle;
mod name_resolution;
mod network;
#[cfg(desktop)]
mod node_control;
mod notify;
mod route;
#[cfg(desktop)]
mod tray;
mod zone;

#[cfg(desktop)]
fn secrets(_app: &tauri::AppHandle) -> zone::secret::SecretStore {
    zone::secret::SecretStore::system()
}

#[cfg(mobile)]
fn secrets(app: &tauri::AppHandle) -> zone::secret::SecretStore {
    content::mobile::secrets(app)
}

#[cfg(desktop)]
fn from_local_page(message: &tauri::ipc::InvokeMessage) -> bool {
    let origin = message.headers().get("origin").and_then(|value| value.to_str().ok());
    let local = |origin: &str| matches!(origin, "tauri://localhost" | "http://tauri.localhost" | "https://tauri.localhost");
    origin.is_none_or(|origin| local(origin) || tauri::is_dev())
}

fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::Manager;
    let handle = app.handle().clone();
    app.manage(deeplink::PendingLinks::default());
    let notifications = notify::NotifyManager::load(&handle)?;
    let zones = zone::ZoneManager::load(&handle, secrets(&handle))?;
    app.manage(notifications);
    app.manage(zones);
    route::client::attach(&handle);

    {
        use tauri_plugin_deep_link::DeepLinkExt;
        // Windows and Linux: a development build has no installer to register the scheme.
        #[cfg(any(target_os = "windows", target_os = "linux"))]
        if let Err(error) = app.deep_link().register(deeplink::SCHEME) {
            log::warn!("[deeplink] registering failed: {error}");
        }
        let link_app = handle.clone();
        app.deep_link().on_open_url(move |event| {
            for url in event.urls() {
                deeplink::open(&link_app, url.as_str());
            }
        });
        if let Ok(Some(urls)) = app.deep_link().get_current() {
            for url in urls {
                deeplink::open(&handle, url.as_str());
            }
        }
    }

    #[cfg(desktop)]
    {
        app.manage(content::windows::ContentViews::default());
        app.manage(content::prompt::Prompts::default());
        app.manage(content::activation::Activations::default());
        content::windows::allow_zones(&handle);
        if let Some(window) = app.get_webview_window("main") {
            content::windows::restore_main(&window);
            let close_app = handle.clone();
            let close_window = window.clone();
            window.on_window_event(move |event| match event {
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    content::windows::remember_main(&close_window);
                    if lifecycle::main_close_requested(&close_app) {
                        api.prevent_close();
                    }
                }
                tauri::WindowEvent::Focused(false) => content::windows::remember_main(&close_window),
                _ => {}
            });
        }
    }

    #[cfg(mobile)]
    content::mobile::setup(&handle)?;

    #[cfg(desktop)]
    lifecycle::fit_main_window(&handle);
    #[cfg(target_os = "macos")]
    lifecycle::ask_before_terminating(&handle);

    #[cfg(target_os = "ios")]
    if let Some(window) = app.get_webview_window("main") {
        ios_webview::use_full_screen_viewport(&window);
    }

    zone::resume(&handle);
    notify::sync_soon(&handle);
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let context = tauri::generate_context!();
    #[cfg(target_os = "windows")]
    content::window_icon::taskbar::keep_client_identity(&context.config().identifier);
    route::client::start();
    let builder = tauri::Builder::default();

    // This must be the first registered plugin so a second desktop process is
    // stopped before it can create another main window or tray icon. The links
    // it was started with come here.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(
        |app, arguments, _working_directory| {
            if !deeplink::open_arguments(app, &arguments) {
                tray::show_main_window(app);
            }
        },
    ));

    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--hidden"]),
        ))
        .manage(tray::TrayState::new());

    #[cfg(mobile)]
    let builder = builder.plugin(content::mobile::plugin());

    let builder = builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(bucky_runtime_plugin())
        .plugin(logging_plugin())
        .plugin(tauri_plugin_store::Builder::default().build())
        .register_asynchronous_uri_scheme_protocol(zone::media::SCHEME, zone::media::respond)
        .setup(setup);

    // Every command here is also listed in build.rs, and each capability says
    // which windows may call which (capabilities/).
    #[cfg(desktop)]
    let commands: Box<dyn Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync> = Box::new(tauri::generate_handler![
        did::generate_mnemonic,
        did::validate_mnemonic_words,
        did::derive_registration_material,
        did::create_did,
        did::import_did,
        did::update_owner_document,
        did::wallet_exists,
        did::list_dids,
        did::active_did,
        did::set_active_did,
        did::delete_wallet,
        did::reveal_mnemonic,
        did::extend_wallets,
        did::current_wallet_nickname,
        did::generate_zone_boot_config_jwt,
        did::list_sn_statuses,
        did::set_sn_status,
        did::clear_sn_status,
        did::sign_json_with_active_did,
        network::local_ipv4_list,
        network::scan_device_batch,
        name_resolution::resolve_did,
        config::get_service_endpoints,
        zone::zone_list,
        zone::zone_probe,
        zone::zone_sync_owner,
        zone::zone_add,
        zone::zone_login,
        zone::zone_reconnect,
        zone::zone_logout,
        zone::zone_remove,
        zone::zone_set_current,
        zone::zone_update,
        zone::zone_rpc,
        zone::zone_fetch,
        zone::zone_image,
        route::client::zone_lines,
        route::client::zone_find,
        route::client::route_status,
        route::client::route_set_browser,
        content::windows::content_open,
        content::windows::content_focus,
        content::windows::content_close,
        content::windows::content_closing,
        content::activation::activation_open,
        content::activation::activation_close,
        content::windows::content_list,
        content::windows::content_emit,
        content::windows::content_set_title,
        content::windows::content_set_icon,
        content::windows::content_retry,
        content::windows::content_lines,
        content::windows::content_sign_in,
        content::windows::bucky_api_call,
        content::prompt::prompt_get,
        content::prompt::prompt_submit,
        content::prompt::prompt_cancel,
        deeplink::deeplink_ready,
        notify::notify_status,
        notify::notify_recent,
        notify::notify_set_labels,
        notify::notify_settings,
        notify::notify_set_enabled,
        notify::notify_permission,
        notify::notify_refresh,
        notify::notify_activate,
        notify::notify_show,
        lifecycle::quit_started,
        lifecycle::quit_confirmed,
        tray::tray_set_enabled,
        tray::tray_set_labels,
        tray::tray_get_state,
        tray::tray_start_service,
        tray::tray_stop_service,
        tray::tray_restart_service,
        tray::tray_refresh_status,
        tray::tray_finish_setup,
        tray::tray_request_permissions,
        tray::tray_set_autostart,
        tray::tray_popover_hover,
        tray::tray_popover_open,
    ]);
    #[cfg(desktop)]
    let builder = builder.invoke_handler(move |invoke| {
        // Tauri takes a page for a local one by the first label of its host name; the origin of the
        // request cannot be chosen by the page. Pages of Zones and devices have this one command.
        if invoke.message.command() != "bucky_api_call" && !from_local_page(&invoke.message) {
            invoke.resolver.reject("not allowed");
            return true;
        }
        commands(invoke)
    });

    #[cfg(not(desktop))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        did::generate_mnemonic,
        did::validate_mnemonic_words,
        did::derive_registration_material,
        did::create_did,
        did::import_did,
        did::update_owner_document,
        did::wallet_exists,
        did::list_dids,
        did::active_did,
        did::set_active_did,
        did::delete_wallet,
        did::reveal_mnemonic,
        did::extend_wallets,
        did::current_wallet_nickname,
        did::generate_zone_boot_config_jwt,
        did::list_sn_statuses,
        did::set_sn_status,
        did::clear_sn_status,
        did::sign_json_with_active_did,
        network::local_ipv4_list,
        network::scan_device_batch,
        name_resolution::resolve_did,
        config::get_service_endpoints,
        zone::zone_list,
        zone::zone_probe,
        zone::zone_sync_owner,
        zone::zone_add,
        zone::zone_login,
        zone::zone_reconnect,
        zone::zone_logout,
        zone::zone_remove,
        zone::zone_set_current,
        zone::zone_update,
        zone::zone_rpc,
        zone::zone_fetch,
        zone::zone_image,
        route::client::zone_lines,
        route::client::zone_find,
        route::client::route_status,
        content::mobile::content_open,
        content::mobile::content_focus,
        content::mobile::content_close,
        content::mobile::activation_open,
        content::mobile::activation_close,
        content::mobile::content_list,
        content::mobile::content_emit,
        content::mobile::content_set_title,
        content::mobile::content_layout,
        content::mobile::content_overlay,
        content::mobile::content_back,
        content::mobile::content_retry,
        content::mobile::app_to_background,
        content::mobile::native_set_labels,
        content::mobile::native_status,
        content::mobile::native_open_settings,
        content::mobile::native_share,
        audio::audio_status,
        audio::audio_hold,
        deeplink::deeplink_ready,
        notify::notify_status,
        notify::notify_recent,
        notify::notify_set_labels,
        notify::notify_settings,
        notify::notify_set_enabled,
        notify::notify_permission,
        notify::notify_refresh,
        notify::notify_activate,
        notify::notify_show,
    ]);

    builder
        .build(context)
        .expect("error while running tauri application")
        .run(|_app, _event| {
            // The Dock icon, while the main window is hidden.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { has_visible_windows: false, .. } = _event {
                tray::show_main_window(_app);
            }
        });
}
