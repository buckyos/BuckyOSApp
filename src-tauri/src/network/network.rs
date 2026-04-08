use futures::stream::{self, StreamExt};
use if_addrs::get_if_addrs;
use reqwest::Client;
use serde_json::{Map, Value};
use std::time::Duration;

const SCAN_REQUEST_TIMEOUT_MS: u64 = 1500;
const SCAN_BATCH_CONCURRENCY: usize = 64;

#[tauri::command]
pub fn local_ipv4_list() -> Result<Vec<String>, String> {
    let interfaces = get_if_addrs().map_err(|e| e.to_string())?;
    let mut ips: Vec<String> = interfaces
        .into_iter()
        .filter_map(|iface| match iface.ip() {
            std::net::IpAddr::V4(addr) if !addr.is_loopback() => Some(addr.to_string()),
            _ => None,
        })
        .collect();
    ips.sort();
    ips.dedup();
    Ok(ips)
}

async fn probe_device(client: &Client, ip: String) -> Option<Value> {
    let url = format!("http://{ip}:3182/device");
    let response = client.get(url).send().await.ok()?;
    if !response.status().is_success() {
        return None;
    }

    let body = response.text().await.ok()?;
    let normalized = body.trim_start_matches('\u{feff}').trim();
    if normalized.is_empty() {
        return None;
    }

    let mut data = serde_json::from_str::<Value>(normalized).ok()?;
    let object = data.as_object_mut()?;
    let active_url = object.get("active_url")?.as_str()?.trim();
    if active_url.is_empty() {
        return None;
    }

    object.insert("ip".to_string(), Value::String(ip));
    Some(Value::Object(Map::from_iter(object.clone())))
}

#[tauri::command]
pub async fn scan_device_batch(ips: Vec<String>) -> Result<Vec<Value>, String> {
    if ips.is_empty() {
        return Ok(Vec::new());
    }

    let client = Client::builder()
        .connect_timeout(Duration::from_millis(SCAN_REQUEST_TIMEOUT_MS))
        .timeout(Duration::from_millis(SCAN_REQUEST_TIMEOUT_MS))
        .build()
        .map_err(|e| e.to_string())?;

    let devices = stream::iter(ips.into_iter())
        .map(|ip| {
            let client = client.clone();
            async move { probe_device(&client, ip).await }
        })
        .buffer_unordered(SCAN_BATCH_CONCURRENCY)
        .filter_map(async move |device| device)
        .collect::<Vec<_>>()
        .await;

    Ok(devices)
}
