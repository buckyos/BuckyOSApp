#[cfg(target_os = "ios")]
use serde::{Deserialize, Serialize};
#[cfg(target_os = "ios")]
use tauri::{plugin::PluginHandle, AppHandle, Manager, Runtime};

#[cfg(target_os = "ios")]
pub struct IosAudioRecorder<R: Runtime>(PluginHandle<R>);

#[cfg(target_os = "ios")]
impl<R: Runtime> IosAudioRecorder<R> {
    fn new(handle: PluginHandle<R>) -> Self {
        Self(handle)
    }

    fn run<T: for<'de> Deserialize<'de>>(
        &self,
        method: &str,
        payload: impl Serialize,
    ) -> Result<T, String> {
        self.0
            .run_mobile_plugin(method, payload)
            .map_err(|err| err.to_string())
    }

    fn run_unit(&self, method: &str, payload: impl Serialize) -> Result<(), String> {
        self.0
            .run_mobile_plugin::<()>(method, payload)
            .map_err(|err| err.to_string())
    }
}

#[cfg(not(target_os = "ios"))]
pub struct IosAudioRecorder<R: Runtime>(std::marker::PhantomData<R>);

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_audio);

#[cfg(target_os = "ios")]
pub fn init<R: Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("ios-audio-bridge")
        .setup(|app, api| {
            let handle = api.register_ios_plugin(init_plugin_audio)?;
            app.manage(IosAudioRecorder::new(handle));
            Ok(())
        })
        .build()
}

#[cfg(not(target_os = "ios"))]
pub fn init<R: Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("ios-audio-bridge").build()
}

#[cfg(target_os = "ios")]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartRecordingPayload {
    pub output_path: String,
    pub record_id: String,
    pub format: String,
    pub sample_rate: u32,
    pub channels: u16,
    pub bit_rate: u32,
}

#[cfg(target_os = "ios")]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StopRecordingResult {
    pub file_path: String,
    pub duration_ms: u64,
    pub file_size: u64,
    pub sample_rate: u32,
    pub channels: u16,
}

#[cfg(target_os = "ios")]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionStatus {
    pub granted: bool,
    pub can_request: bool,
}

#[cfg(target_os = "ios")]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingStatus {
    pub state: String,
    pub duration_ms: u64,
    pub output_path: Option<String>,
}

#[cfg(target_os = "ios")]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackStatus {
    pub state: String,
}

#[cfg(target_os = "ios")]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PlayPayload {
    pub file_path: String,
}

#[cfg(target_os = "ios")]
fn recorder<R: Runtime>(app: &AppHandle<R>) -> Result<&IosAudioRecorder<R>, String> {
    app.try_state::<IosAudioRecorder<R>>()
        .map(|state| state.inner())
        .ok_or_else(|| "ios_audio_bridge_not_initialized".to_string())
}

#[cfg(target_os = "ios")]
pub fn start_recording<R: Runtime>(
    app: &AppHandle<R>,
    payload: StartRecordingPayload,
) -> Result<(), String> {
    recorder(app)?.run_unit("startRecording", payload)
}

#[cfg(target_os = "ios")]
pub fn stop_recording<R: Runtime>(app: &AppHandle<R>) -> Result<StopRecordingResult, String> {
    recorder(app)?.run("stopRecording", ())
}

#[cfg(target_os = "ios")]
pub fn pause_recording<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    recorder(app)?.run_unit("pauseRecording", ())
}

#[cfg(target_os = "ios")]
pub fn resume_recording<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    recorder(app)?.run_unit("resumeRecording", ())
}

#[cfg(target_os = "ios")]
pub fn get_status<R: Runtime>(app: &AppHandle<R>) -> Result<RecordingStatus, String> {
    recorder(app)?.run("getStatus", ())
}

#[cfg(target_os = "ios")]
pub fn check_permission<R: Runtime>(app: &AppHandle<R>) -> Result<PermissionStatus, String> {
    recorder(app)?.run("checkPermission", ())
}

#[cfg(target_os = "ios")]
pub fn request_permission<R: Runtime>(app: &AppHandle<R>) -> Result<PermissionStatus, String> {
    recorder(app)?.run("requestPermission", ())
}

#[cfg(target_os = "ios")]
pub fn play_recording<R: Runtime>(app: &AppHandle<R>, file_path: String) -> Result<(), String> {
    recorder(app)?.run_unit("playRecording", PlayPayload { file_path })
}

#[cfg(target_os = "ios")]
pub fn stop_playback<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    recorder(app)?.run_unit("stopPlayback", ())
}

#[cfg(target_os = "ios")]
pub fn get_playback_status<R: Runtime>(app: &AppHandle<R>) -> Result<PlaybackStatus, String> {
    recorder(app)?.run("getPlaybackStatus", ())
}
