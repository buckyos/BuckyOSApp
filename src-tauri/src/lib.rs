// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

mod applist;
mod did;
mod error;
mod network;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            greet,
            did::generate_mnemonic,
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
            did::sign_with_active_did,
            applist::get_applist,
            network::local_ipv4_list,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
