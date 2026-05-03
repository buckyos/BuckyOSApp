// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

const BUCKY_API_INIT: &str = include_str!("../../public/bucky-api.js");
const LOG_MAX_FILE_SIZE: u128 = 5 * 1024 * 1024; // 5 MiB
const LOG_FILE_HISTORY: usize = 10;

fn bucky_runtime_plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("bucky-runtime")
        .js_init_script_on_all_frames(BUCKY_API_INIT)
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

mod applist;
mod config;
mod did;
mod error;
mod network;
#[cfg(desktop)]
mod tray;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_log::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(bucky_runtime_plugin())
        .plugin(logging_plugin())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_http::init());

    #[cfg(desktop)]
    let builder = builder
        .manage(tray::TrayState::new())
        .setup(|app| {
            use tauri::Manager;
            let app_handle = app.handle().clone();
            if let Some(window) = app.get_webview_window("main") {
                let handle_for_close = app_handle.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        // When the tray icon is enabled, the close
                        // button hides the window so the tray remains
                        // the way to bring the app back. Quitting only
                        // happens via the tray's explicit "Quit" item.
                        let state = handle_for_close.state::<tray::TrayState>();
                        if state.is_enabled() {
                            api.prevent_close();
                            if let Some(win) = handle_for_close.get_webview_window("main") {
                                let _ = win.hide();
                            }
                        }
                    }
                });
            }
            Ok(())
        });

    #[cfg(desktop)]
    let builder = builder.invoke_handler(tauri::generate_handler![
        greet,
        did::generate_mnemonic,
        did::validate_mnemonic_words,
        did::derive_bucky_public_key,
        did::create_did,
        did::import_did,
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
        applist::get_applist,
        network::local_ipv4_list,
        network::scan_device_batch,
        config::get_sn_api_host,
        tray::tray_set_enabled,
        tray::tray_set_labels,
        tray::tray_set_status,
        tray::tray_get_state,
        tray::tray_start_service,
        tray::tray_stop_service,
        tray::tray_restart_service,
        tray::tray_refresh_status,
    ]);

    #[cfg(not(desktop))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        greet,
        did::generate_mnemonic,
        did::validate_mnemonic_words,
        did::derive_bucky_public_key,
        did::create_did,
        did::import_did,
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
        applist::get_applist,
        network::local_ipv4_list,
        network::scan_device_batch,
        config::get_sn_api_host,
    ]);

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
