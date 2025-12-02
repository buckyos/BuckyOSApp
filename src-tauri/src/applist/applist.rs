use crate::error::{CommandErrors, CommandResult};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::{env, fs, io::ErrorKind, path::PathBuf};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppMeta {
    pub pkg_name: String,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AppDoc {
    #[serde(flatten)]
    pub meta: AppMeta,
    pub show_name: String, // just for display, app_id is meta.pkg_name (like "buckyos-filebrowser")
    #[serde(skip_serializing_if = "Option::is_none")]
    pub app_icon_url: Option<String>,
    pub selector_type: String,
    pub install_config_tips: String,
    pub pkg_list: String,
}

#[tauri::command]
pub fn get_applist() -> CommandResult<Vec<AppDoc>> {
    // 优先读取 $BUCKYOS_ROOT/bin/applist.json；开发模式下找不到则回退到本仓库的 applist.json
    let content = read_applist_from_env().or_else(|err| match err {
        CommandErrors::NotFound(_) => read_applist_from_dev(),
        other => Err(other),
    })?;

    let apps: Vec<AppDoc> = serde_json::from_str(&content)
        .map_err(|err| CommandErrors::internal(format!("invalid_applist.json: {err}")))?;

    Ok(apps)
}

fn read_applist_from_env() -> CommandResult<String> {
    let root = env::var("BUCKYOS_ROOT")
        .map_err(|_| CommandErrors::not_found("env:BUCKYOS_ROOT_not_set"))?;
    let path = PathBuf::from(root).join("bin").join("applist.json");
    fs::read_to_string(&path).map_err(|err| match err.kind() {
        ErrorKind::NotFound => CommandErrors::not_found(format!(
            "applist.json_not_found: {}",
            path.to_string_lossy()
        )),
        _ => CommandErrors::internal(err.to_string()),
    })
}

fn read_applist_from_dev() -> CommandResult<String> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("applist.json");
    fs::read_to_string(&path).map_err(|err| match err.kind() {
        ErrorKind::NotFound => CommandErrors::not_found(format!(
            "dev_applist.json_not_found: {}",
            path.to_string_lossy()
        )),
        _ => CommandErrors::internal(err.to_string()),
    })
}
