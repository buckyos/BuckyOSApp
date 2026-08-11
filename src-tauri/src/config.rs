use serde::{Deserialize, Serialize};
use std::fs;
use tauri::{AppHandle, Manager};

use crate::error::{CommandErrors, CommandResult};

const DEFAULT_SN_HOST: &str = "buckyos.ai";
const CONFIG_FILENAME: &str = "config.json";

#[derive(Deserialize)]
struct AppConfig {
    sn_host: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ServiceEndpoints {
    pub sn_host: String,
    pub sn_api_url: String,
    pub bns_api_url: String,
}

fn normalize_root_host(value: &str) -> String {
    let trimmed = value.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return DEFAULT_SN_HOST.to_string();
    }

    let host = if trimmed.contains("://") {
        reqwest::Url::parse(trimmed)
            .ok()
            .and_then(|url| url.host_str().map(str::to_string))
            .unwrap_or_else(|| trimmed.to_string())
    } else {
        trimmed
            .split('/')
            .next()
            .unwrap_or(DEFAULT_SN_HOST)
            .to_string()
    };

    host.strip_prefix("sn.")
        .or_else(|| host.strip_prefix("bns."))
        .unwrap_or(&host)
        .trim_matches('.')
        .to_ascii_lowercase()
}

fn endpoints_for_root(root: &str) -> ServiceEndpoints {
    let sn_host = normalize_root_host(root);
    ServiceEndpoints {
        sn_api_url: format!("https://sn.{sn_host}"),
        bns_api_url: format!("https://bns.{sn_host}"),
        sn_host,
    }
}

#[tauri::command]
pub fn get_service_endpoints(app_handle: AppHandle) -> CommandResult<ServiceEndpoints> {
    let config_dir = app_handle
        .path()
        .app_config_dir()
        .map_err(|e| CommandErrors::internal(format!("missing app config directory: {e}")))?;
    let path = config_dir.join(CONFIG_FILENAME);
    if !path.exists() {
        return Ok(endpoints_for_root(DEFAULT_SN_HOST));
    }

    let raw = fs::read_to_string(&path)
        .map_err(|e| CommandErrors::internal(format!("failed to read sn config: {e}")))?;
    let parsed: AppConfig = serde_json::from_str(&raw)
        .map_err(|e| CommandErrors::internal(format!("invalid sn config: {e}")))?;

    let root = parsed
        .sn_host
        .map(|h| h.trim().to_string())
        .filter(|h| !h.is_empty())
        .unwrap_or_else(|| DEFAULT_SN_HOST.to_string());
    Ok(endpoints_for_root(&root))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_sn_and_bns_urls_from_one_root() {
        assert_eq!(
            endpoints_for_root("https://sn.buckyos.ai/kapi/sn"),
            ServiceEndpoints {
                sn_host: "buckyos.ai".to_string(),
                sn_api_url: "https://sn.buckyos.ai".to_string(),
                bns_api_url: "https://bns.buckyos.ai".to_string(),
            }
        );
    }
}
