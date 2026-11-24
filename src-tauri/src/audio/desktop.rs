//! A content view's window keeps playing while it is minimized (TODO T0-5), so keeping audio alive
//! needs nothing here. Recording stays with the page's own `getUserMedia`.

use serde_json::Value;
use tauri::{AppHandle, Runtime};

use crate::content::bridge::{BridgeError, Caller};

pub async fn dispatch<R: Runtime>(_app: &AppHandle<R>, _caller: &Caller, name: &str, _payload: Value) -> Result<Value, BridgeError> {
    match name {
        "audio.background.acquire" | "audio.background.update" | "audio.background.release" => Ok(Value::Null),
        _ => Err(BridgeError::unsupported(name)),
    }
}
