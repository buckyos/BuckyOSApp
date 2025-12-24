use serde::Deserialize;
use std::fs;
use tauri::{AppHandle, Manager};

use crate::error::{CommandErrors, CommandResult};

const DEFAULT_SN_API_URL: &str = "https://sn.buckyos.ai/kapi/sn";
const CONFIG_FILENAME: &str = "config.json";

#[derive(Deserialize)]
struct AppConfig {
    sn_host: Option<String>,
}

#[tauri::command]
pub fn get_sn_api_host(app_handle: AppHandle) -> CommandResult<String> {
    let config_dir = app_handle
        .path()
        .app_config_dir()
        .map_err(|e| CommandErrors::internal(format!("missing app config directory: {e}")))?;
    let path = config_dir.join(CONFIG_FILENAME);
    if !path.exists() {
        return Ok(DEFAULT_SN_API_URL.to_string());
    }

    let raw = fs::read_to_string(&path)
        .map_err(|e| CommandErrors::internal(format!("failed to read sn config: {e}")))?;
    let parsed: AppConfig = serde_json::from_str(&raw)
        .map_err(|e| CommandErrors::internal(format!("invalid sn config: {e}")))?;

    let host = parsed
        .sn_host
        .map(|h| h.trim().to_string())
        .filter(|h| !h.is_empty())
        .unwrap_or_else(|| DEFAULT_SN_API_URL.to_string());
    Ok(host)
}
