/// Every command of the app. Naming them here puts each one under the ACL: without this list any
/// page of a content window, a Zone's app included, could call all of them.
const COMMANDS: &[&str] = &[
    "generate_mnemonic",
    "validate_mnemonic_words",
    "derive_registration_material",
    "create_did",
    "import_did",
    "update_owner_document",
    "wallet_exists",
    "list_dids",
    "active_did",
    "set_active_did",
    "delete_wallet",
    "reveal_mnemonic",
    "extend_wallets",
    "current_wallet_nickname",
    "generate_zone_boot_config_jwt",
    "list_sn_statuses",
    "set_sn_status",
    "clear_sn_status",
    "sign_json_with_active_did",
    "local_ipv4_list",
    "scan_device_batch",
    "resolve_did",
    "get_service_endpoints",
    "zone_list",
    "zone_probe",
    "zone_sync_owner",
    "zone_add",
    "zone_login",
    "zone_reconnect",
    "zone_logout",
    "zone_remove",
    "zone_set_current",
    "zone_update",
    "zone_rpc",
    "zone_fetch",
    "zone_image",
    "content_open",
    "content_focus",
    "content_close",
    "content_closing",
    "activation_open",
    "activation_close",
    "content_list",
    "content_emit",
    "content_set_title",
    "content_retry",
    "content_sign_in",
    "content_layout",
    "content_overlay",
    "content_back",
    "app_to_background",
    "native_set_labels",
    "native_status",
    "native_open_settings",
    "native_share",
    "audio_status",
    "audio_hold",
    "bucky_api_call",
    "prompt_get",
    "prompt_submit",
    "prompt_cancel",
    "deeplink_ready",
    "notify_status",
    "notify_recent",
    "notify_set_labels",
    "notify_settings",
    "notify_set_enabled",
    "notify_permission",
    "notify_refresh",
    "notify_activate",
    "notify_show",
    "quit_started",
    "quit_confirmed",
    "tray_set_enabled",
    "tray_set_labels",
    "tray_get_state",
    "tray_start_service",
    "tray_stop_service",
    "tray_restart_service",
    "tray_refresh_status",
    "tray_finish_setup",
    "tray_request_permissions",
    "tray_set_autostart",
    "tray_popover_hover",
    "tray_popover_open",
];

/// Builds and links the Swift side of the client (`ios/ClientPlugin`).
#[cfg(target_os = "macos")]
fn link_ios_plugin() {
    use std::path::{Path, PathBuf};

    /// The plugin's package depends on Tauri's, which is inside the `tauri` crate.
    fn copy(from: &Path, to: &Path) -> std::io::Result<()> {
        std::fs::create_dir_all(to)?;
        for entry in std::fs::read_dir(from)? {
            let entry = entry?;
            let target = to.join(entry.file_name());
            if entry.file_type()?.is_dir() {
                copy(&entry.path(), &target)?;
            } else if std::fs::read(entry.path())? != std::fs::read(&target).unwrap_or_default() {
                std::fs::copy(entry.path(), &target)?;
            }
        }
        Ok(())
    }

    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("ios") {
        return;
    }
    println!("cargo:rerun-if-env-changed=DEP_TAURI_IOS_LIBRARY_PATH");
    let tauri = PathBuf::from(std::env::var("DEP_TAURI_IOS_LIBRARY_PATH").expect("the tauri crate names its Swift package"));
    let plugin = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").expect("a manifest")).join("ios/ClientPlugin");
    let api = plugin.join(".tauri/tauri-api");
    for part in ["Package.swift", "Sources"] {
        let (from, to) = (tauri.join(part), api.join(part));
        let copied = if from.is_dir() {
            copy(&from, &to)
        } else {
            std::fs::create_dir_all(&api).and_then(|()| std::fs::copy(&from, &to)).map(drop)
        };
        copied.expect("Tauri's Swift package could not be copied");
    }
    // Xcode says which version it builds for; a plain `cargo check` does not.
    if std::env::var_os("IPHONEOS_DEPLOYMENT_TARGET").is_none() {
        std::env::set_var("IPHONEOS_DEPLOYMENT_TARGET", "17.0");
    }
    tauri_utils::build::link_apple_library("ClientPlugin", &plugin);
}

fn main() {
    #[cfg(target_os = "macos")]
    link_ios_plugin();

    let attributes = tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(COMMANDS));
    if let Err(error) = tauri_build::try_build(attributes) {
        panic!("tauri build failed: {error:#}");
    }
}
