use std::{
    collections::HashMap,
    fs::{self, File},
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    sync::{
        atomic::AtomicU64,
        mpsc, Arc, Mutex,
    },
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use base64::Engine;
use chrono::Local;
use fs2::available_space;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use ulid::Ulid;

#[cfg(target_os = "android")]
pub mod android_bridge;

#[cfg(not(any(target_os = "android", target_os = "ios")))]
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use hound::{SampleFormat, WavSpec, WavWriter};
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use std::sync::atomic::{AtomicBool, Ordering};

const RECORDINGS_DIR_NAME: &str = "recordings";
const RECORDINGS_INDEX_NAME: &str = "recordings_index.json";
const RECORDING_TTL_DAYS: u64 = 30;
const CLEANUP_INTERVAL_SECS: u64 = 24 * 60 * 60;
const MIN_FREE_SPACE_BYTES: u64 = 20 * 1024 * 1024;

const ERR_PERMISSION_DENIED: &str = "PERMISSION_DENIED";
const ERR_RECORDING_IN_PROGRESS: &str = "RECORDING_IN_PROGRESS";
const ERR_INVALID_RECORD_ID: &str = "INVALID_RECORD_ID";
const ERR_INVALID_STATE: &str = "INVALID_STATE";
const ERR_PLATFORM_UNAVAILABLE: &str = "PLATFORM_UNAVAILABLE";
const ERR_IO_ERROR: &str = "IO_ERROR";
const ERR_INTERNAL_ERROR: &str = "INTERNAL_ERROR";

#[derive(Default)]
pub struct AudioRecordState {
    inner: Mutex<RuntimeState>,
}

#[derive(Default)]
struct RuntimeState {
    initialized: bool,
    active_session: Option<ActiveSession>,
    recordings: HashMap<String, StoredRecording>,
    playback: PlaybackState,
    permissions: PermissionPayload,
    last_status: RecordingStatus,
}

struct ActiveSession {
    record_id: String,
    file_path: PathBuf,
    control_tx: mpsc::Sender<RecorderControl>,
    worker: Option<thread::JoinHandle<()>>,
    samples_written: Arc<AtomicU64>,
    started_at: Instant,
    started_at_epoch_ms: u64,
    paused_started_at: Option<Instant>,
    total_paused_ms: u64,
    sample_rate: u32,
    channels: u16,
    bit_rate: Option<u32>,
    format: String,
}

enum RecorderControl {
    Pause,
    Resume,
    Stop,
    Cancel,
}

enum PlaybackControl {
    Stop,
}

struct PlaybackWorker {
    control_tx: mpsc::Sender<PlaybackControl>,
    worker: thread::JoinHandle<()>,
}

#[derive(Clone, Serialize, Deserialize, Default)]
struct StoredRecording {
    record_id: String,
    file_path: String,
    format: String,
    sample_rate: u32,
    channels: u16,
    bit_rate: Option<u32>,
    created_at: u64,
    updated_at: u64,
    duration_ms: Option<u64>,
    tag: Option<String>,
    state: RecordingState,
    last_error: Option<String>,
}

#[derive(Clone, Serialize, Deserialize, Default)]
struct StoredIndex {
    records: Vec<StoredRecording>,
}

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum RecordingState {
    #[default]
    Idle,
    Recording,
    Paused,
    Interrupted,
    Stopping,
    Finished,
    Error,
}

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum PlaybackStatus {
    #[default]
    Idle,
    Playing,
}

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PermissionState {
    Granted,
    Denied,
    Prompt,
}

impl Default for PermissionState {
    fn default() -> Self {
        Self::Prompt
    }
}

#[derive(Clone, Serialize, Deserialize, Default)]
pub struct PermissionPayload {
    mic: PermissionState,
    background: PermissionState,
}

#[derive(Clone, Serialize, Deserialize, Default)]
pub struct RecordingStatus {
    state: RecordingState,
    record_id: Option<String>,
    start_time: Option<u64>,
    elapsed_ms: u64,
    file_path: Option<String>,
    file_format: Option<String>,
    sample_rate: Option<u32>,
    channels: Option<u16>,
    bit_rate: Option<u32>,
    last_error: Option<String>,
}

#[derive(Clone, Serialize)]
pub struct StartRecordingOutput {
    record_id: String,
    file_url: Option<String>,
}

#[derive(Clone, Serialize)]
pub struct StateOnlyOutput {
    state: RecordingState,
}

#[derive(Clone, Serialize)]
pub struct StopRecordingOutput {
    state: RecordingState,
    file_info: RecordingFileInfo,
}

#[derive(Clone, Serialize)]
pub struct RecordingFileInfo {
    size_bytes: u64,
    duration_ms: Option<u64>,
    format: String,
    sample_rate: u32,
    channels: u16,
    created_at: u64,
}

#[derive(Clone, Serialize)]
pub struct RecordingListItem {
    record_id: String,
    file_name: String,
    state: RecordingState,
    format: String,
    created_at: u64,
    updated_at: u64,
    duration_ms: Option<u64>,
    size_bytes: u64,
    file_exists: bool,
}

#[derive(Clone, Serialize)]
pub struct RecordingFileChunk {
    chunk_base64: String,
    offset: u64,
    length: u64,
    eof: bool,
}

#[derive(Clone, Serialize)]
pub struct RecordingUrl {
    url: String,
}

#[derive(Clone, Serialize)]
pub struct PlaybackStatusOutput {
    state: PlaybackStatus,
    record_id: Option<String>,
}

#[derive(Clone, Serialize)]
pub struct ReadinessOutput {
    ready: bool,
    mic: PermissionState,
    background: PermissionState,
    free_space_bytes: u64,
    reason: Option<String>,
}

#[derive(Clone, Deserialize)]
pub struct StartRecordingOptions {
    sample_rate: Option<u32>,
    channels: Option<u16>,
    bit_rate: Option<u32>,
    format: Option<String>,
    tag: Option<String>,
}

#[derive(Clone, Serialize)]
pub struct ApiError {
    code: String,
    message: String,
}

#[derive(Clone, Serialize)]
pub struct ApiResult<T: Serialize> {
    ok: bool,
    data: Option<T>,
    error: Option<ApiError>,
}

impl<T: Serialize> ApiResult<T> {
    fn ok(data: T) -> Self {
        Self {
            ok: true,
            data: Some(data),
            error: None,
        }
    }

    fn err(code: &str, message: impl Into<String>) -> Self {
        Self {
            ok: false,
            data: None,
            error: Some(ApiError {
                code: code.to_string(),
                message: message.into(),
            }),
        }
    }
}

#[derive(Clone, Serialize)]
struct RecordingStateChangedEvent {
    record_id: String,
    state: RecordingState,
}

#[derive(Clone, Serialize)]
struct RecordingErrorEvent {
    record_id: String,
    error_code: String,
    message: String,
}

#[derive(Clone, Serialize)]
struct PlaybackStateChangedEvent {
    record_id: Option<String>,
    state: PlaybackStatus,
}

#[derive(Clone, Serialize)]
struct AudioInterruptionBeginEvent {
    record_id: String,
    reason: String,
}

#[derive(Clone, Serialize)]
struct AudioInterruptionEndEvent {
    record_id: String,
}

pub fn initialize_audio_recording(state: State<'_, AudioRecordState>, app: AppHandle) {
    let mut guard = match state.inner.lock() {
        Ok(guard) => guard,
        Err(err) => {
            log::error!("audio initialize lock failed: {err}");
            return;
        }
    };
    if guard.initialized {
        return;
    }

    guard.permissions = detect_permissions_runtime(&app);
    match load_index_from_disk(&app) {
        Ok(mut loaded) => {
            for record in loaded.values_mut() {
                if matches!(
                    record.state,
                    RecordingState::Recording
                        | RecordingState::Paused
                        | RecordingState::Interrupted
                        | RecordingState::Stopping
                ) {
                    record.state = RecordingState::Error;
                    record.last_error = Some("abnormal_exit".to_string());
                    record.updated_at = now_millis();
                }
            }
            guard.recordings = loaded;
        }
        Err(err) => {
            log::warn!("load recording index failed: {err}");
        }
    }

    run_ttl_cleanup(&app, &mut guard.recordings);
    if let Err(err) = save_index_to_disk(&app, &guard.recordings) {
        log::warn!("save recording index failed: {err}");
    }

    guard.initialized = true;
    drop(guard);
    spawn_cleanup_loop(app);
}

#[tauri::command]
pub fn start_recording(
    app: AppHandle,
    state: State<'_, AudioRecordState>,
    options: Option<StartRecordingOptions>,
) -> ApiResult<StartRecordingOutput> {
    #[cfg(target_os = "android")]
    {
        let default_options = StartRecordingOptions {
            sample_rate: Some(44_100),
            channels: Some(1),
            bit_rate: Some(128_000),
            format: Some("m4a".to_string()),
            tag: None,
        };
        let options = options.unwrap_or(default_options);

        if let Some(err) = ensure_ready_to_record(&app, &state) {
            return err;
        }

        let record_id = Ulid::new().to_string();
        let file_path = match build_recording_file_path(&app, &record_id, "m4a") {
            Ok(path) => path,
            Err(err) => return ApiResult::err(ERR_IO_ERROR, err.to_string()),
        };

        let sample_rate = options.sample_rate.unwrap_or(44_100);
        let channels = options.channels.unwrap_or(1);
        let bit_rate = options.bit_rate.unwrap_or(128_000);

        if let Err(err) = android_bridge::start_recording(
            &app,
            android_bridge::StartRecordingPayload {
                output_path: file_path.to_string_lossy().to_string(),
                sample_rate,
                channels,
                bit_rate,
            },
        ) {
            return ApiResult::err(ERR_PLATFORM_UNAVAILABLE, err);
        }

        let (control_tx, _control_rx) = mpsc::channel::<RecorderControl>();
        let samples_written = Arc::new(AtomicU64::new(0));
        let now = now_millis();
        let mut guard = match state.inner.lock() {
            Ok(guard) => guard,
            Err(err) => return ApiResult::err(ERR_INTERNAL_ERROR, err.to_string()),
        };

        let stored = StoredRecording {
            record_id: record_id.clone(),
            file_path: file_path.to_string_lossy().to_string(),
            format: "m4a".to_string(),
            sample_rate,
            channels,
            bit_rate: Some(bit_rate),
            created_at: now,
            updated_at: now,
            duration_ms: None,
            tag: options.tag.clone(),
            state: RecordingState::Recording,
            last_error: None,
        };

        guard.last_status = RecordingStatus {
            state: RecordingState::Recording,
            record_id: Some(record_id.clone()),
            start_time: Some(now),
            elapsed_ms: 0,
            file_path: None,
            file_format: Some("m4a".to_string()),
            sample_rate: Some(sample_rate),
            channels: Some(channels),
            bit_rate: Some(bit_rate),
            last_error: None,
        };
        guard.recordings.insert(record_id.clone(), stored);
        guard.active_session = Some(ActiveSession {
            record_id: record_id.clone(),
            file_path: file_path.clone(),
            control_tx,
            worker: None,
            samples_written,
            started_at: Instant::now(),
            started_at_epoch_ms: now,
            paused_started_at: None,
            total_paused_ms: 0,
            sample_rate,
            channels,
            bit_rate: Some(bit_rate),
            format: "m4a".to_string(),
        });

        if let Err(err) = save_index_to_disk(&app, &guard.recordings) {
            log::warn!("save index failed on start(android): {err}");
        }
        emit_recording_state_changed(&app, &record_id, RecordingState::Recording);
        let file_url = format!("buckyos-record://localhost/recording/{record_id}");
        return ApiResult::ok(StartRecordingOutput {
            record_id: record_id.clone(),
            file_url: Some(file_url),
        });
    }

    #[cfg(target_os = "ios")]
    {
        let _ = app;
        let _ = state;
        let _ = options;
        return ApiResult::err(ERR_PLATFORM_UNAVAILABLE, "ios_runtime_not_implemented");
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        let default_options = StartRecordingOptions {
            sample_rate: Some(44_100),
            channels: Some(1),
            bit_rate: None,
            format: Some("m4a".to_string()),
            tag: None,
        };
        let options = options.unwrap_or(default_options);
        let requested_format = options.format.clone().unwrap_or_else(|| "m4a".to_string());
        let actual_format = if requested_format.eq_ignore_ascii_case("wav") {
            "wav".to_string()
        } else {
            "wav".to_string()
        };

        if let Some(err) = ensure_ready_to_record(&app, &state) {
            return err;
        }

        let host = cpal::default_host();
        let device = match host.default_input_device() {
            Some(device) => device,
            None => return ApiResult::err(ERR_PLATFORM_UNAVAILABLE, "no_input_device"),
        };
        let default_config = match device.default_input_config() {
            Ok(config) => config,
            Err(err) => return ApiResult::err(ERR_PLATFORM_UNAVAILABLE, err.to_string()),
        };

        let record_id = Ulid::new().to_string();
        let file_path = match build_recording_file_path(&app, &record_id, "wav") {
            Ok(path) => path,
            Err(err) => return ApiResult::err(ERR_IO_ERROR, err.to_string()),
        };

        let sample_rate = options
            .sample_rate
            .unwrap_or(default_config.sample_rate().0);
        let channels = options.channels.unwrap_or(default_config.channels()).max(1);

        let (control_tx, control_rx) = mpsc::channel::<RecorderControl>();
        let samples_written = Arc::new(AtomicU64::new(0));
        let samples_for_worker = Arc::clone(&samples_written);
        let path_for_worker = file_path.clone();
        let app_for_worker = app.clone();
        let record_id_for_worker = record_id.clone();

        let worker = thread::spawn(move || {
            if let Err(err) = recorder_worker_loop(
                app_for_worker.clone(),
                record_id_for_worker.clone(),
                &path_for_worker,
                sample_rate,
                channels,
                samples_for_worker,
                control_rx,
            ) {
                let _ = app_for_worker.emit(
                    "recording_error",
                    RecordingErrorEvent {
                        record_id: record_id_for_worker,
                        error_code: ERR_IO_ERROR.to_string(),
                        message: err,
                    },
                );
            }
        });

        let now = now_millis();
        let mut guard = match state.inner.lock() {
            Ok(guard) => guard,
            Err(err) => return ApiResult::err(ERR_INTERNAL_ERROR, err.to_string()),
        };

        let stored = StoredRecording {
            record_id: record_id.clone(),
            file_path: file_path.to_string_lossy().to_string(),
            format: actual_format.clone(),
            sample_rate,
            channels,
            bit_rate: options.bit_rate,
            created_at: now,
            updated_at: now,
            duration_ms: None,
            tag: options.tag.clone(),
            state: RecordingState::Recording,
            last_error: None,
        };

        guard.last_status = RecordingStatus {
            state: RecordingState::Recording,
            record_id: Some(record_id.clone()),
            start_time: Some(now),
            elapsed_ms: 0,
            file_path: None,
            file_format: Some(stored.format.clone()),
            sample_rate: Some(sample_rate),
            channels: Some(channels),
            bit_rate: options.bit_rate,
            last_error: None,
        };

        guard.recordings.insert(record_id.clone(), stored);
        guard.active_session = Some(ActiveSession {
            record_id: record_id.clone(),
            file_path: file_path.clone(),
            control_tx,
            worker: Some(worker),
            samples_written,
            started_at: Instant::now(),
            started_at_epoch_ms: now,
            paused_started_at: None,
            total_paused_ms: 0,
            sample_rate,
            channels,
            bit_rate: options.bit_rate,
            format: actual_format,
        });

        if let Err(err) = save_index_to_disk(&app, &guard.recordings) {
            log::warn!("save index failed on start: {err}");
        }
        emit_recording_state_changed(&app, &record_id, RecordingState::Recording);

        ApiResult::ok(StartRecordingOutput {
            record_id,
            file_url: Some(file_url_from_path(&file_path)),
        })
    }
}

#[tauri::command]
pub fn pause_recording(
    app: AppHandle,
    state: State<'_, AudioRecordState>,
    record_id: String,
) -> ApiResult<StateOnlyOutput> {
    let mut guard = match state.inner.lock() {
        Ok(guard) => guard,
        Err(err) => return ApiResult::err(ERR_INTERNAL_ERROR, err.to_string()),
    };
    let state_now = guard.last_status.state.clone();
    if !matches!(state_now, RecordingState::Recording) {
        return ApiResult::err(ERR_INVALID_STATE, "recording_not_active");
    }
    let elapsed = {
        let Some(session) = guard.active_session.as_mut() else {
            return ApiResult::err(ERR_INVALID_STATE, "no_active_session");
        };
        if session.record_id != record_id {
            return ApiResult::err(ERR_INVALID_RECORD_ID, "record_id_not_found");
        }
        #[cfg(target_os = "android")]
        {
            if let Err(err) = android_bridge::pause_recording(&app) {
                return ApiResult::err(ERR_INVALID_STATE, err);
            }
        }
        #[cfg(not(target_os = "android"))]
        {
            if let Err(err) = session.control_tx.send(RecorderControl::Pause) {
                return ApiResult::err(ERR_INTERNAL_ERROR, err.to_string());
            }
        }
        session.paused_started_at = Some(Instant::now());
        elapsed_ms(session)
    };

    update_record_state(
        &mut guard.recordings,
        &record_id,
        RecordingState::Paused,
        None,
    );
    guard.last_status.state = RecordingState::Paused;
    guard.last_status.elapsed_ms = elapsed;

    if let Err(err) = save_index_to_disk(&app, &guard.recordings) {
        log::warn!("save index failed on pause: {err}");
    }
    emit_recording_state_changed(&app, &record_id, RecordingState::Paused);

    ApiResult::ok(StateOnlyOutput {
        state: RecordingState::Paused,
    })
}

#[tauri::command]
pub fn resume_recording(
    app: AppHandle,
    state: State<'_, AudioRecordState>,
    record_id: String,
) -> ApiResult<StateOnlyOutput> {
    let mut guard = match state.inner.lock() {
        Ok(guard) => guard,
        Err(err) => return ApiResult::err(ERR_INTERNAL_ERROR, err.to_string()),
    };
    let now_state = guard.last_status.state.clone();
    if !matches!(
        now_state,
        RecordingState::Paused | RecordingState::Interrupted
    ) {
        return ApiResult::err(ERR_INVALID_STATE, "session_not_paused");
    }
    let was_interrupted = now_state == RecordingState::Interrupted;

    let elapsed = {
        let Some(session) = guard.active_session.as_mut() else {
            return ApiResult::err(ERR_INVALID_STATE, "no_active_session");
        };
        if session.record_id != record_id {
            return ApiResult::err(ERR_INVALID_RECORD_ID, "record_id_not_found");
        }
        #[cfg(target_os = "android")]
        {
            if let Err(err) = android_bridge::resume_recording(&app) {
                return ApiResult::err(ERR_INVALID_STATE, err);
            }
        }
        #[cfg(not(target_os = "android"))]
        {
            if let Err(err) = session.control_tx.send(RecorderControl::Resume) {
                return ApiResult::err(ERR_INTERNAL_ERROR, err.to_string());
            }
        }
        if let Some(paused_started_at) = session.paused_started_at.take() {
            session.total_paused_ms = session
                .total_paused_ms
                .saturating_add(paused_started_at.elapsed().as_millis() as u64);
        }
        elapsed_ms(session)
    };

    update_record_state(
        &mut guard.recordings,
        &record_id,
        RecordingState::Recording,
        None,
    );
    guard.last_status.state = RecordingState::Recording;
    guard.last_status.elapsed_ms = elapsed;

    if let Err(err) = save_index_to_disk(&app, &guard.recordings) {
        log::warn!("save index failed on resume: {err}");
    }
    if was_interrupted {
        let _ = app.emit(
            "audio_interruption_end",
            AudioInterruptionEndEvent {
                record_id: record_id.clone(),
            },
        );
    }
    emit_recording_state_changed(&app, &record_id, RecordingState::Recording);

    ApiResult::ok(StateOnlyOutput {
        state: RecordingState::Recording,
    })
}

#[tauri::command]
pub fn stop_recording(
    app: AppHandle,
    state: State<'_, AudioRecordState>,
    record_id: String,
) -> ApiResult<StopRecordingOutput> {
    let mut guard = match state.inner.lock() {
        Ok(guard) => guard,
        Err(err) => return ApiResult::err(ERR_INTERNAL_ERROR, err.to_string()),
    };

    let Some(mut session) = guard.active_session.take() else {
        return ApiResult::err(ERR_INVALID_STATE, "no_active_session");
    };
    if session.record_id != record_id {
        guard.active_session = Some(session);
        return ApiResult::err(ERR_INVALID_RECORD_ID, "record_id_not_found");
    }

    guard.last_status.state = RecordingState::Stopping;
    update_record_state(
        &mut guard.recordings,
        &record_id,
        RecordingState::Stopping,
        None,
    );
    emit_recording_state_changed(&app, &record_id, RecordingState::Stopping);

    #[cfg(target_os = "android")]
    let (duration_ms, file_size, sample_rate, channels, final_path) =
        match android_bridge::stop_recording(&app) {
            Ok(result) => (
                result.duration_ms,
                result.file_size,
                result.sample_rate,
                result.channels,
                PathBuf::from(result.file_path),
            ),
            Err(err) => return ApiResult::err(ERR_IO_ERROR, err),
        };

    #[cfg(not(target_os = "android"))]
    {
        if let Err(err) = session.control_tx.send(RecorderControl::Stop) {
            return ApiResult::err(ERR_INTERNAL_ERROR, err.to_string());
        }
        if let Some(worker) = session.worker.take() {
            let _ = worker.join();
        }
    }

    #[cfg(not(target_os = "android"))]
    let duration_ms = duration_ms_from_samples(
        session.samples_written.load(Ordering::SeqCst),
        session.sample_rate,
        session.channels,
    );

    #[cfg(not(target_os = "android"))]
    let file_size: u64 = 0;
    #[cfg(not(target_os = "android"))]
    let sample_rate = session.sample_rate;
    #[cfg(not(target_os = "android"))]
    let channels = session.channels;
    #[cfg(not(target_os = "android"))]
    let final_path = session.file_path.clone();

    session.file_path = final_path.clone();
    session.sample_rate = sample_rate;
    session.channels = channels;

    if let Some(record) = guard.recordings.get_mut(&record_id) {
        record.file_path = final_path.to_string_lossy().to_string();
        record.sample_rate = sample_rate;
        record.channels = channels;
        if file_size > 0 {
            let _ = file_size;
        }
    }

    let file_info = match build_file_info_from_session(&session, duration_ms) {
        Ok(info) => info,
        Err(err) => return ApiResult::err(ERR_IO_ERROR, err.to_string()),
    };

    update_finished_record(&mut guard.recordings, &record_id, duration_ms);
    guard.last_status = RecordingStatus {
        state: RecordingState::Finished,
        record_id: Some(record_id.clone()),
        start_time: Some(session.started_at_epoch_ms),
        elapsed_ms: elapsed_ms(&session),
        file_path: Some(session.file_path.to_string_lossy().to_string()),
        file_format: Some(session.format.clone()),
        sample_rate: Some(session.sample_rate),
        channels: Some(session.channels),
        bit_rate: session.bit_rate,
        last_error: None,
    };

    if let Err(err) = save_index_to_disk(&app, &guard.recordings) {
        log::warn!("save index failed on stop: {err}");
    }
    emit_recording_state_changed(&app, &record_id, RecordingState::Finished);

    ApiResult::ok(StopRecordingOutput {
        state: RecordingState::Finished,
        file_info,
    })
}

#[tauri::command]
#[allow(unused_mut)]
pub fn cancel_recording(
    app: AppHandle,
    state: State<'_, AudioRecordState>,
    record_id: String,
) -> ApiResult<StateOnlyOutput> {
    let mut guard = match state.inner.lock() {
        Ok(guard) => guard,
        Err(err) => return ApiResult::err(ERR_INTERNAL_ERROR, err.to_string()),
    };

    let Some(mut session) = guard.active_session.take() else {
        return ApiResult::err(ERR_INVALID_RECORD_ID, "no_active_session");
    };
    if session.record_id != record_id {
        guard.active_session = Some(session);
        return ApiResult::err(ERR_INVALID_RECORD_ID, "record_id_not_found");
    }

    #[cfg(target_os = "android")]
    {
        let _ = android_bridge::stop_recording(&app);
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = session.control_tx.send(RecorderControl::Cancel);
        if let Some(worker) = session.worker.take() {
            let _ = worker.join();
        }
    }

    let path = session.file_path.clone();
    tauri::async_runtime::spawn(async move {
        let _ = fs::remove_file(path);
    });

    guard.recordings.remove(&record_id);
    guard.last_status = RecordingStatus {
        state: RecordingState::Idle,
        record_id: None,
        start_time: None,
        elapsed_ms: 0,
        file_path: None,
        file_format: None,
        sample_rate: None,
        channels: None,
        bit_rate: None,
        last_error: None,
    };

    if let Err(err) = save_index_to_disk(&app, &guard.recordings) {
        log::warn!("save index failed on cancel: {err}");
    }
    emit_recording_state_changed(&app, &record_id, RecordingState::Idle);

    ApiResult::ok(StateOnlyOutput {
        state: RecordingState::Idle,
    })
}

#[tauri::command]
#[allow(unused_variables)]
pub fn get_recording_status(
    app: AppHandle,
    state: State<'_, AudioRecordState>,
) -> ApiResult<RecordingStatus> {
    let mut guard = match state.inner.lock() {
        Ok(guard) => guard,
        Err(err) => return ApiResult::err(ERR_INTERNAL_ERROR, err.to_string()),
    };
    #[cfg(target_os = "android")]
    {
        if let Ok(status) = android_bridge::get_status(&app) {
            let active_record_id = guard.active_session.as_ref().map(|s| s.record_id.clone());
            if let Some(active_record_id) = active_record_id {
                guard.last_status.elapsed_ms = status.duration_ms;
                guard.last_status.state = match status.state.as_str() {
                    "recording" => RecordingState::Recording,
                    "paused" => RecordingState::Paused,
                    "interrupted" => RecordingState::Interrupted,
                    _ => guard.last_status.state.clone(),
                };
                if let Some(path) = status.output_path {
                    guard.last_status.file_path = Some(path);
                }
                guard.last_status.record_id = Some(active_record_id);
            }
        }
    }
    #[cfg(not(target_os = "android"))]
    if let Some(session) = guard.active_session.as_ref() {
        guard.last_status.elapsed_ms = elapsed_ms(session);
    }
    ApiResult::ok(guard.last_status.clone())
}

#[tauri::command]
pub fn list_recordings(state: State<'_, AudioRecordState>) -> ApiResult<Vec<RecordingListItem>> {
    let guard = match state.inner.lock() {
        Ok(guard) => guard,
        Err(err) => return ApiResult::err(ERR_INTERNAL_ERROR, err.to_string()),
    };

    let mut records: Vec<&StoredRecording> = guard.recordings.values().collect();
    records.sort_by(|a, b| b.created_at.cmp(&a.created_at));

    let list = records
        .into_iter()
        .map(|record| {
            let path = PathBuf::from(&record.file_path);
            let metadata = fs::metadata(&path).ok();
            let size_bytes = metadata.as_ref().map_or(0, |m| m.len());
            RecordingListItem {
                record_id: record.record_id.clone(),
                file_name: path
                    .file_name()
                    .map(|v| v.to_string_lossy().to_string())
                    .unwrap_or_else(|| format!("{}.{}", record.record_id, record.format)),
                state: record.state.clone(),
                format: record.format.clone(),
                created_at: record.created_at,
                updated_at: record.updated_at,
                duration_ms: record.duration_ms,
                size_bytes,
                file_exists: metadata.is_some(),
            }
        })
        .collect();

    ApiResult::ok(list)
}

#[tauri::command]
pub fn get_recording_file_info(
    state: State<'_, AudioRecordState>,
    record_id: String,
) -> ApiResult<RecordingFileInfo> {
    let guard = match state.inner.lock() {
        Ok(guard) => guard,
        Err(err) => return ApiResult::err(ERR_INTERNAL_ERROR, err.to_string()),
    };
    let Some(record) = guard.recordings.get(&record_id) else {
        return ApiResult::err(ERR_INVALID_RECORD_ID, "recording_not_found");
    };
    let path = PathBuf::from(&record.file_path);
    match build_file_info(record, &path) {
        Ok(info) => ApiResult::ok(info),
        Err(err) => ApiResult::err(ERR_IO_ERROR, err.to_string()),
    }
}

#[tauri::command]
pub fn read_recording_file(
    state: State<'_, AudioRecordState>,
    record_id: String,
    offset: u64,
    length: u64,
) -> ApiResult<RecordingFileChunk> {
    let guard = match state.inner.lock() {
        Ok(guard) => guard,
        Err(err) => return ApiResult::err(ERR_INTERNAL_ERROR, err.to_string()),
    };
    let Some(record) = guard.recordings.get(&record_id) else {
        return ApiResult::err(ERR_INVALID_RECORD_ID, "recording_not_found");
    };

    let mut file = match File::open(&record.file_path) {
        Ok(file) => file,
        Err(err) => return ApiResult::err(ERR_IO_ERROR, err.to_string()),
    };
    if let Err(err) = file.seek(SeekFrom::Start(offset)) {
        return ApiResult::err(ERR_IO_ERROR, err.to_string());
    }

    let mut buf = vec![0u8; length as usize];
    let read_bytes = match file.read(&mut buf) {
        Ok(bytes) => bytes,
        Err(err) => return ApiResult::err(ERR_IO_ERROR, err.to_string()),
    };
    buf.truncate(read_bytes);
    let file_len = file.metadata().map(|m| m.len()).unwrap_or(0);

    ApiResult::ok(RecordingFileChunk {
        chunk_base64: base64::engine::general_purpose::STANDARD.encode(&buf),
        offset,
        length: read_bytes as u64,
        eof: offset.saturating_add(read_bytes as u64) >= file_len,
    })
}

#[tauri::command]
pub fn get_recording_url(
    state: State<'_, AudioRecordState>,
    record_id: String,
) -> ApiResult<RecordingUrl> {
    let guard = match state.inner.lock() {
        Ok(guard) => guard,
        Err(err) => return ApiResult::err(ERR_INTERNAL_ERROR, err.to_string()),
    };
    let Some(_record) = guard.recordings.get(&record_id) else {
        return ApiResult::err(ERR_INVALID_RECORD_ID, "recording_not_found");
    };

    ApiResult::ok(RecordingUrl {
        url: format!("buckyos-record://localhost/recording/{record_id}"),
    })
}

pub fn handle_recording_uri_scheme<R: tauri::Runtime>(
    ctx: tauri::UriSchemeContext<'_, R>,
    request: tauri::http::Request<Vec<u8>>,
) -> tauri::http::Response<Vec<u8>> {
    let path = request.uri().path();
    let record_id = match path.strip_prefix("/recording/") {
        Some(value) if !value.is_empty() => value,
        _ => {
            return build_http_response(
                tauri::http::StatusCode::BAD_REQUEST,
                "text/plain; charset=utf-8",
                b"invalid_recording_url".to_vec(),
                &[],
            );
        }
    };

    let Some(state) = ctx.app_handle().try_state::<AudioRecordState>() else {
        return build_http_response(
            tauri::http::StatusCode::INTERNAL_SERVER_ERROR,
            "text/plain; charset=utf-8",
            b"audio_state_unavailable".to_vec(),
            &[],
        );
    };

    let (file_path, content_type) = {
        let guard = match state.inner.lock() {
            Ok(guard) => guard,
            Err(_) => {
                return build_http_response(
                    tauri::http::StatusCode::INTERNAL_SERVER_ERROR,
                    "text/plain; charset=utf-8",
                    b"audio_state_lock_failed".to_vec(),
                    &[],
                );
            }
        };
        let Some(record) = guard.recordings.get(record_id) else {
            return build_http_response(
                tauri::http::StatusCode::NOT_FOUND,
                "text/plain; charset=utf-8",
                b"recording_not_found".to_vec(),
                &[],
            );
        };

        let content_type = if record.format.eq_ignore_ascii_case("m4a")
            || record.format.eq_ignore_ascii_case("mp4")
        {
            "audio/mp4"
        } else {
            "audio/wav"
        };

        (PathBuf::from(&record.file_path), content_type)
    };

    let mut file = match File::open(&file_path) {
        Ok(file) => file,
        Err(_) => {
            return build_http_response(
                tauri::http::StatusCode::NOT_FOUND,
                "text/plain; charset=utf-8",
                b"recording_file_not_found".to_vec(),
                &[],
            );
        }
    };

    let total_len = match file.metadata() {
        Ok(metadata) => metadata.len(),
        Err(_) => {
            return build_http_response(
                tauri::http::StatusCode::INTERNAL_SERVER_ERROR,
                "text/plain; charset=utf-8",
                b"recording_metadata_failed".to_vec(),
                &[],
            );
        }
    };

    let range_header = request
        .headers()
        .get(tauri::http::header::RANGE)
        .and_then(|value| value.to_str().ok());

    if let Some(range_header) = range_header {
        let Some((start, end)) = parse_byte_range(range_header, total_len) else {
            return build_http_response(
                tauri::http::StatusCode::RANGE_NOT_SATISFIABLE,
                "text/plain; charset=utf-8",
                b"invalid_range".to_vec(),
                &[(
                    tauri::http::header::CONTENT_RANGE,
                    format!("bytes */{total_len}"),
                )],
            );
        };
        let len = end.saturating_sub(start).saturating_add(1);
        if file.seek(SeekFrom::Start(start)).is_err() {
            return build_http_response(
                tauri::http::StatusCode::INTERNAL_SERVER_ERROR,
                "text/plain; charset=utf-8",
                b"seek_failed".to_vec(),
                &[],
            );
        }
        let mut bytes = vec![0u8; len as usize];
        if file.read_exact(&mut bytes).is_err() {
            return build_http_response(
                tauri::http::StatusCode::INTERNAL_SERVER_ERROR,
                "text/plain; charset=utf-8",
                b"read_failed".to_vec(),
                &[],
            );
        }

        return build_http_response(
            tauri::http::StatusCode::PARTIAL_CONTENT,
            content_type,
            bytes,
            &[
                (tauri::http::header::ACCEPT_RANGES, "bytes".to_string()),
                (
                    tauri::http::header::CONTENT_RANGE,
                    format!("bytes {start}-{end}/{total_len}"),
                ),
            ],
        );
    }

    let mut bytes = Vec::with_capacity(total_len as usize);
    if file.read_to_end(&mut bytes).is_err() {
        return build_http_response(
            tauri::http::StatusCode::INTERNAL_SERVER_ERROR,
            "text/plain; charset=utf-8",
            b"read_failed".to_vec(),
            &[],
        );
    }

    build_http_response(
        tauri::http::StatusCode::OK,
        content_type,
        bytes,
        &[(tauri::http::header::ACCEPT_RANGES, "bytes".to_string())],
    )
}

#[tauri::command]
pub fn export_recording_file(
    state: State<'_, AudioRecordState>,
    record_id: String,
    target_path: String,
) -> ApiResult<RecordingFileInfo> {
    let guard = match state.inner.lock() {
        Ok(guard) => guard,
        Err(err) => return ApiResult::err(ERR_INTERNAL_ERROR, err.to_string()),
    };
    let Some(record) = guard.recordings.get(&record_id) else {
        return ApiResult::err(ERR_INVALID_RECORD_ID, "recording_not_found");
    };

    if let Err(err) = fs::copy(&record.file_path, &target_path) {
        return ApiResult::err(ERR_IO_ERROR, err.to_string());
    }
    match build_file_info(record, Path::new(&target_path)) {
        Ok(info) => ApiResult::ok(info),
        Err(err) => ApiResult::err(ERR_IO_ERROR, err.to_string()),
    }
}

#[tauri::command]
pub fn play_recording(
    app: AppHandle,
    state: State<'_, AudioRecordState>,
    record_id: String,
) -> ApiResult<PlaybackStatusOutput> {
    let mut guard = match state.inner.lock() {
        Ok(guard) => guard,
        Err(err) => return ApiResult::err(ERR_INTERNAL_ERROR, err.to_string()),
    };

    if guard.active_session.is_some() {
        return ApiResult::err(ERR_INVALID_STATE, "recording_in_progress");
    }
    let Some(record) = guard.recordings.get(&record_id) else {
        return ApiResult::err(ERR_INVALID_RECORD_ID, "recording_not_found");
    };
    if guard.playback.state == PlaybackStatus::Playing {
        return ApiResult::err(ERR_INVALID_STATE, "playback_already_started");
    }

    #[cfg(target_os = "android")]
    {
        if let Err(err) = android_bridge::play_recording(&app, record.file_path.clone()) {
            return ApiResult::err(ERR_PLATFORM_UNAVAILABLE, err);
        }
        guard.playback.state = PlaybackStatus::Playing;
        guard.playback.record_id = Some(record_id.clone());
        let _ = app.emit(
            "playback_state_changed",
            PlaybackStateChangedEvent {
                record_id: Some(record_id.clone()),
                state: PlaybackStatus::Playing,
            },
        );
        return ApiResult::ok(PlaybackStatusOutput {
            state: PlaybackStatus::Playing,
            record_id: Some(record_id),
        });
    }

    #[cfg(not(target_os = "android"))]
    {
        let file_path = record.file_path.clone();
        let (playback_tx, playback_rx) = mpsc::channel::<PlaybackControl>();
        let app_for_worker = app.clone();
        let record_id_for_worker = record_id.clone();
        let worker = thread::spawn(move || {
            if let Err(err) = playback_worker_loop(&file_path, playback_rx) {
                log::warn!("playback worker failed: {err}");
            }
            if let Some(state) = app_for_worker.try_state::<AudioRecordState>() {
                if let Ok(mut guard) = state.inner.lock() {
                    if guard.playback.record_id.as_deref() == Some(record_id_for_worker.as_str()) {
                        guard.playback.state = PlaybackStatus::Idle;
                        guard.playback.record_id = None;
                        guard.playback.worker = None;
                        let _ = app_for_worker.emit(
                            "playback_state_changed",
                            PlaybackStateChangedEvent {
                                record_id: None,
                                state: PlaybackStatus::Idle,
                            },
                        );
                    }
                }
            }
        });

        guard.playback.state = PlaybackStatus::Playing;
        guard.playback.record_id = Some(record_id.clone());
        guard.playback.worker = Some(PlaybackWorker {
            control_tx: playback_tx,
            worker,
        });
        let _ = app.emit(
            "playback_state_changed",
            PlaybackStateChangedEvent {
                record_id: Some(record_id.clone()),
                state: PlaybackStatus::Playing,
            },
        );

        ApiResult::ok(PlaybackStatusOutput {
            state: PlaybackStatus::Playing,
            record_id: Some(record_id),
        })
    }
}

#[tauri::command]
pub fn stop_playback(
    app: AppHandle,
    state: State<'_, AudioRecordState>,
) -> ApiResult<PlaybackStatusOutput> {
    #[cfg(target_os = "android")]
    {
        if let Err(err) = android_bridge::stop_playback(&app) {
            return ApiResult::err(ERR_INTERNAL_ERROR, err);
        }
    }

    #[cfg(not(target_os = "android"))]
    {
        let mut worker_to_join: Option<thread::JoinHandle<()>> = None;
        let mut guard = match state.inner.lock() {
            Ok(guard) => guard,
            Err(err) => return ApiResult::err(ERR_INTERNAL_ERROR, err.to_string()),
        };

        if let Some(worker) = guard.playback.worker.take() {
            let _ = worker.control_tx.send(PlaybackControl::Stop);
            worker_to_join = Some(worker.worker);
        }
        guard.playback.state = PlaybackStatus::Idle;
        guard.playback.record_id = None;
        drop(guard);

        if let Some(worker) = worker_to_join {
            let _ = worker.join();
        }
    }

    let mut guard = match state.inner.lock() {
        Ok(guard) => guard,
        Err(err) => return ApiResult::err(ERR_INTERNAL_ERROR, err.to_string()),
    };
    guard.playback.state = PlaybackStatus::Idle;
    guard.playback.record_id = None;
    guard.playback.worker = None;
    drop(guard);

    let _ = app.emit(
        "playback_state_changed",
        PlaybackStateChangedEvent {
            record_id: None,
            state: PlaybackStatus::Idle,
        },
    );

    ApiResult::ok(PlaybackStatusOutput {
        state: PlaybackStatus::Idle,
        record_id: None,
    })
}

#[tauri::command]
#[allow(unused_variables)]
pub fn get_playback_status(
    app: AppHandle,
    state: State<'_, AudioRecordState>,
) -> ApiResult<PlaybackStatusOutput> {
    #[cfg(target_os = "android")]
    {
        if let Ok(status) = android_bridge::get_playback_status(&app) {
            let mut guard = match state.inner.lock() {
                Ok(guard) => guard,
                Err(err) => return ApiResult::err(ERR_INTERNAL_ERROR, err.to_string()),
            };
            guard.playback.state = if status.state == "playing" {
                PlaybackStatus::Playing
            } else {
                PlaybackStatus::Idle
            };
            if guard.playback.state == PlaybackStatus::Idle {
                guard.playback.record_id = None;
            }
            return ApiResult::ok(PlaybackStatusOutput {
                state: guard.playback.state.clone(),
                record_id: guard.playback.record_id.clone(),
            });
        }
    }
    let guard = match state.inner.lock() {
        Ok(guard) => guard,
        Err(err) => return ApiResult::err(ERR_INTERNAL_ERROR, err.to_string()),
    };

    ApiResult::ok(PlaybackStatusOutput {
        state: guard.playback.state.clone(),
        record_id: guard.playback.record_id.clone(),
    })
}

#[tauri::command]
pub fn get_recording_permissions(
    app: AppHandle,
    state: State<'_, AudioRecordState>,
) -> ApiResult<PermissionPayload> {
    let mut guard = match state.inner.lock() {
        Ok(guard) => guard,
        Err(err) => return ApiResult::err(ERR_INTERNAL_ERROR, err.to_string()),
    };
    #[cfg(target_os = "android")]
    {
        if let Ok(p) = android_bridge::check_permission(&app) {
            guard.permissions = PermissionPayload {
                mic: if p.granted {
                    PermissionState::Granted
                } else if p.can_request {
                    PermissionState::Prompt
                } else {
                    PermissionState::Denied
                },
                background: PermissionState::Prompt,
            };
            return ApiResult::ok(guard.permissions.clone());
        }
    }
    guard.permissions = detect_permissions_runtime(&app);
    ApiResult::ok(guard.permissions.clone())
}

#[tauri::command]
pub fn request_recording_permissions(
    app: AppHandle,
    state: State<'_, AudioRecordState>,
) -> ApiResult<PermissionPayload> {
    let mut guard = match state.inner.lock() {
        Ok(guard) => guard,
        Err(err) => return ApiResult::err(ERR_INTERNAL_ERROR, err.to_string()),
    };
    #[cfg(target_os = "android")]
    {
        match android_bridge::request_permission(&app) {
            Ok(p) => {
                guard.permissions = PermissionPayload {
                    mic: if p.granted {
                        PermissionState::Granted
                    } else if p.can_request {
                        PermissionState::Prompt
                    } else {
                        PermissionState::Denied
                    },
                    background: PermissionState::Prompt,
                };
            }
            Err(err) => return ApiResult::err(ERR_INTERNAL_ERROR, err),
        }
    }
    #[cfg(not(target_os = "android"))]
    {
        guard.permissions = request_permissions_runtime(&app);
    }
    ApiResult::ok(guard.permissions.clone())
}

#[tauri::command]
pub fn check_recording_readiness(
    app: AppHandle,
    state: State<'_, AudioRecordState>,
) -> ApiResult<ReadinessOutput> {
    let guard = match state.inner.lock() {
        Ok(guard) => guard,
        Err(err) => return ApiResult::err(ERR_INTERNAL_ERROR, err.to_string()),
    };

    let (free_space_bytes, ready_by_disk) = match get_free_space(&app) {
        Ok(bytes) => (bytes, bytes >= MIN_FREE_SPACE_BYTES),
        Err(_) => (0, false),
    };

    let mic_ready = guard.permissions.mic == PermissionState::Granted;
    let ready = mic_ready && ready_by_disk;
    let reason = if !mic_ready {
        Some("mic_permission_not_granted".to_string())
    } else if !ready_by_disk {
        Some("insufficient_disk_space".to_string())
    } else {
        None
    };

    ApiResult::ok(ReadinessOutput {
        ready,
        mic: guard.permissions.mic.clone(),
        background: guard.permissions.background.clone(),
        free_space_bytes,
        reason,
    })
}

#[tauri::command]
pub fn mark_audio_interruption_begin(
    app: AppHandle,
    state: State<'_, AudioRecordState>,
    reason: String,
) -> ApiResult<StateOnlyOutput> {
    let mut guard = match state.inner.lock() {
        Ok(guard) => guard,
        Err(err) => return ApiResult::err(ERR_INTERNAL_ERROR, err.to_string()),
    };

    let current_state = guard.last_status.state.clone();
    if current_state != RecordingState::Recording {
        return ApiResult::err(ERR_INVALID_STATE, "invalid_interrupt_state");
    }

    let record_id = {
        let Some(session) = guard.active_session.as_mut() else {
            return ApiResult::err(ERR_INVALID_STATE, "no_active_session");
        };
        #[cfg(target_os = "android")]
        {
            if let Err(err) = android_bridge::pause_recording(&app) {
                return ApiResult::err(ERR_INTERNAL_ERROR, err);
            }
        }
        #[cfg(not(target_os = "android"))]
        {
            if let Err(err) = session.control_tx.send(RecorderControl::Pause) {
                return ApiResult::err(ERR_INTERNAL_ERROR, err.to_string());
            }
        }
        session.paused_started_at = Some(Instant::now());
        session.record_id.clone()
    };

    update_record_state(
        &mut guard.recordings,
        &record_id,
        RecordingState::Interrupted,
        None,
    );
    guard.last_status.state = RecordingState::Interrupted;

    let _ = app.emit(
        "audio_interruption_begin",
        AudioInterruptionBeginEvent {
            record_id: record_id.clone(),
            reason,
        },
    );
    emit_recording_state_changed(&app, &record_id, RecordingState::Interrupted);

    ApiResult::ok(StateOnlyOutput {
        state: RecordingState::Interrupted,
    })
}

fn recorder_worker_loop(
    app: AppHandle,
    record_id: String,
    path: &Path,
    sample_rate: u32,
    channels: u16,
    samples_written: Arc<AtomicU64>,
    control_rx: mpsc::Receiver<RecorderControl>,
) -> Result<(), String> {
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let _ = app;
        let _ = record_id;
        let _ = path;
        let _ = sample_rate;
        let _ = channels;
        let _ = samples_written;
        let _ = control_rx;
        return Err("mobile_recording_runtime_not_enabled".to_string());
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        let host = cpal::default_host();
        let device = host
            .default_input_device()
            .ok_or_else(|| "no_input_device".to_string())?;
        let default_config = device
            .default_input_config()
            .map_err(|err| err.to_string())?;

        let spec = WavSpec {
            channels,
            sample_rate,
            bits_per_sample: 16,
            sample_format: SampleFormat::Int,
        };
        let writer = WavWriter::create(path, spec).map_err(|err| err.to_string())?;
        let writer = Arc::new(Mutex::new(Some(writer)));
        let paused = Arc::new(AtomicBool::new(false));

        let stream_config = cpal::StreamConfig {
            channels,
            sample_rate: cpal::SampleRate(sample_rate),
            buffer_size: cpal::BufferSize::Default,
        };

        let writer_for_stream = Arc::clone(&writer);
        let paused_for_stream = Arc::clone(&paused);
        let samples_for_stream = Arc::clone(&samples_written);

        let stream = match default_config.sample_format() {
            cpal::SampleFormat::F32 => build_f32_stream(
                &device,
                &stream_config,
                writer_for_stream,
                paused_for_stream,
                samples_for_stream,
                {
                    let app = app.clone();
                    let record_id = record_id.clone();
                    move |err| {
                        log::error!("audio input stream error: {err}");
                        handle_stream_interruption(&app, &record_id, err.to_string());
                    }
                },
            ),
            cpal::SampleFormat::I16 => build_i16_stream(
                &device,
                &stream_config,
                writer_for_stream,
                paused_for_stream,
                samples_for_stream,
                {
                    let app = app.clone();
                    let record_id = record_id.clone();
                    move |err| {
                        log::error!("audio input stream error: {err}");
                        handle_stream_interruption(&app, &record_id, err.to_string());
                    }
                },
            ),
            cpal::SampleFormat::U16 => build_u16_stream(
                &device,
                &stream_config,
                writer_for_stream,
                paused_for_stream,
                samples_for_stream,
                {
                    let app = app.clone();
                    let record_id = record_id.clone();
                    move |err| {
                        log::error!("audio input stream error: {err}");
                        handle_stream_interruption(&app, &record_id, err.to_string());
                    }
                },
            ),
            _ => Err(cpal::BuildStreamError::StreamConfigNotSupported),
        }
        .map_err(|err| err.to_string())?;

        stream.play().map_err(|err| err.to_string())?;

        loop {
            match control_rx.recv_timeout(Duration::from_millis(40)) {
                Ok(RecorderControl::Pause) => {
                    paused.store(true, Ordering::SeqCst);
                    continue;
                }
                Ok(RecorderControl::Resume) => {
                    paused.store(false, Ordering::SeqCst);
                    continue;
                }
                Ok(RecorderControl::Stop) | Ok(RecorderControl::Cancel) => break,
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
                Err(mpsc::RecvTimeoutError::Timeout) => {}
            }
        }

        drop(stream);
        if let Some(writer) = writer.lock().ok().and_then(|mut guard| guard.take()) {
            writer.finalize().map_err(|err| err.to_string())?;
        }

        Ok(())
    }
}

fn playback_worker_loop(
    file_path: &str,
    control_rx: mpsc::Receiver<PlaybackControl>,
) -> Result<(), String> {
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let _ = file_path;
        let _ = control_rx;
        return Err("mobile_playback_runtime_not_enabled".to_string());
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        use rodio::{Decoder, OutputStream, Sink};

        let (_stream, stream_handle) =
            OutputStream::try_default().map_err(|err| err.to_string())?;
        let sink = Sink::try_new(&stream_handle).map_err(|err| err.to_string())?;
        let file = File::open(file_path).map_err(|err| err.to_string())?;
        let reader = std::io::BufReader::new(file);
        let source = Decoder::new(reader).map_err(|err| err.to_string())?;
        sink.append(source);

        loop {
            match control_rx.recv_timeout(Duration::from_millis(100)) {
                Ok(PlaybackControl::Stop) => {
                    sink.stop();
                    break;
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    sink.stop();
                    break;
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    if sink.empty() {
                        break;
                    }
                }
            }
        }

        drop(sink);
        Ok(())
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn build_f32_stream(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    writer: Arc<Mutex<Option<WavWriter<std::io::BufWriter<File>>>>>,
    paused: Arc<AtomicBool>,
    samples_written: Arc<AtomicU64>,
    err_fn: impl FnMut(cpal::StreamError) + Send + 'static,
) -> Result<cpal::Stream, cpal::BuildStreamError> {
    device.build_input_stream(
        config,
        move |data: &[f32], _| {
            if paused.load(Ordering::SeqCst) {
                return;
            }
            let Ok(mut guard) = writer.lock() else {
                return;
            };
            let Some(writer) = guard.as_mut() else {
                return;
            };
            for sample in data {
                let i = (sample * i16::MAX as f32) as i16;
                if writer.write_sample(i).is_ok() {
                    samples_written.fetch_add(1, Ordering::SeqCst);
                }
            }
        },
        err_fn,
        None,
    )
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn build_i16_stream(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    writer: Arc<Mutex<Option<WavWriter<std::io::BufWriter<File>>>>>,
    paused: Arc<AtomicBool>,
    samples_written: Arc<AtomicU64>,
    err_fn: impl FnMut(cpal::StreamError) + Send + 'static,
) -> Result<cpal::Stream, cpal::BuildStreamError> {
    device.build_input_stream(
        config,
        move |data: &[i16], _| {
            if paused.load(Ordering::SeqCst) {
                return;
            }
            let Ok(mut guard) = writer.lock() else {
                return;
            };
            let Some(writer) = guard.as_mut() else {
                return;
            };
            for sample in data {
                if writer.write_sample(*sample).is_ok() {
                    samples_written.fetch_add(1, Ordering::SeqCst);
                }
            }
        },
        err_fn,
        None,
    )
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn build_u16_stream(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    writer: Arc<Mutex<Option<WavWriter<std::io::BufWriter<File>>>>>,
    paused: Arc<AtomicBool>,
    samples_written: Arc<AtomicU64>,
    err_fn: impl FnMut(cpal::StreamError) + Send + 'static,
) -> Result<cpal::Stream, cpal::BuildStreamError> {
    device.build_input_stream(
        config,
        move |data: &[u16], _| {
            if paused.load(Ordering::SeqCst) {
                return;
            }
            let Ok(mut guard) = writer.lock() else {
                return;
            };
            let Some(writer) = guard.as_mut() else {
                return;
            };
            for sample in data {
                let i = (*sample as i32 - i16::MAX as i32 - 1) as i16;
                if writer.write_sample(i).is_ok() {
                    samples_written.fetch_add(1, Ordering::SeqCst);
                }
            }
        },
        err_fn,
        None,
    )
}

fn handle_stream_interruption(app: &AppHandle, record_id: &str, message: String) {
    if let Some(state) = app.try_state::<AudioRecordState>() {
        if let Ok(mut guard) = state.inner.lock() {
            if guard.last_status.record_id.as_deref() == Some(record_id)
                && guard.last_status.state == RecordingState::Recording
            {
                if let Some(session) = guard.active_session.as_mut() {
                    let _ = session.control_tx.send(RecorderControl::Pause);
                    session.paused_started_at = Some(Instant::now());
                }
                update_record_state(
                    &mut guard.recordings,
                    record_id,
                    RecordingState::Interrupted,
                    None,
                );
                guard.last_status.state = RecordingState::Interrupted;
            }
        }
    }

    let _ = app.emit(
        "audio_interruption_begin",
        AudioInterruptionBeginEvent {
            record_id: record_id.to_string(),
            reason: "stream_error".to_string(),
        },
    );
    emit_recording_state_changed(app, record_id, RecordingState::Interrupted);
    let _ = app.emit(
        "recording_error",
        RecordingErrorEvent {
            record_id: record_id.to_string(),
            error_code: ERR_INTERNAL_ERROR.to_string(),
            message,
        },
    );
}

fn ensure_ready_to_record(
    app: &AppHandle,
    state: &State<'_, AudioRecordState>,
) -> Option<ApiResult<StartRecordingOutput>> {
    #[cfg(target_os = "android")]
    {
        if let Ok(permission) = android_bridge::check_permission(app) {
            if !permission.granted {
                return Some(ApiResult::err(
                    ERR_PERMISSION_DENIED,
                    "microphone_permission_denied",
                ));
            }
        }
    }

    let guard = match state.inner.lock() {
        Ok(guard) => guard,
        Err(err) => return Some(ApiResult::err(ERR_INTERNAL_ERROR, err.to_string())),
    };

    if guard.active_session.is_some() {
        return Some(ApiResult::err(
            ERR_RECORDING_IN_PROGRESS,
            "only_single_recording_session_allowed",
        ));
    }
    if guard.permissions.mic != PermissionState::Granted {
        return Some(ApiResult::err(
            ERR_PERMISSION_DENIED,
            "microphone_permission_denied",
        ));
    }
    if guard.playback.state == PlaybackStatus::Playing {
        return Some(ApiResult::err(ERR_INVALID_STATE, "playback_in_progress"));
    }
    drop(guard);

    match get_free_space(app) {
        Ok(space) if space < MIN_FREE_SPACE_BYTES => {
            Some(ApiResult::err(ERR_IO_ERROR, "insufficient_disk_space"))
        }
        Ok(_) => None,
        Err(err) => Some(ApiResult::err(ERR_IO_ERROR, err.to_string())),
    }
}

fn detect_permissions_runtime(_app: &AppHandle) -> PermissionPayload {
    let mic = match probe_mic_permission(false) {
        ProbePermissionState::Granted => PermissionState::Granted,
        ProbePermissionState::Denied => PermissionState::Denied,
        ProbePermissionState::Prompt => PermissionState::Prompt,
    };

    let background = background_permission_state();

    PermissionPayload { mic, background }
}

fn request_permissions_runtime(_app: &AppHandle) -> PermissionPayload {
    let mic = match probe_mic_permission(true) {
        ProbePermissionState::Granted => PermissionState::Granted,
        ProbePermissionState::Denied => PermissionState::Denied,
        ProbePermissionState::Prompt => PermissionState::Prompt,
    };

    let background = background_permission_state();

    PermissionPayload { mic, background }
}

#[derive(Clone, Copy)]
enum ProbePermissionState {
    Granted,
    Denied,
    Prompt,
}

fn probe_mic_permission(force_stream_probe: bool) -> ProbePermissionState {
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let _ = force_stream_probe;
        return ProbePermissionState::Prompt;
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        let host = cpal::default_host();
        let Some(device) = host.default_input_device() else {
            return ProbePermissionState::Denied;
        };

        let config = match device.default_input_config() {
            Ok(config) => config,
            Err(err) => {
                let lower = err.to_string().to_ascii_lowercase();
                if lower.contains("permission") || lower.contains("denied") {
                    return ProbePermissionState::Denied;
                }
                return ProbePermissionState::Prompt;
            }
        };

        if !force_stream_probe {
            return ProbePermissionState::Granted;
        }

        let stream_config = cpal::StreamConfig {
            channels: config.channels(),
            sample_rate: config.sample_rate(),
            buffer_size: cpal::BufferSize::Default,
        };

        let build = match config.sample_format() {
            cpal::SampleFormat::F32 => {
                device.build_input_stream(&stream_config, |_data: &[f32], _| {}, |_err| {}, None)
            }
            cpal::SampleFormat::I16 => {
                device.build_input_stream(&stream_config, |_data: &[i16], _| {}, |_err| {}, None)
            }
            cpal::SampleFormat::U16 => {
                device.build_input_stream(&stream_config, |_data: &[u16], _| {}, |_err| {}, None)
            }
            _ => return ProbePermissionState::Prompt,
        };

        match build {
            Ok(stream) => match stream.play() {
                Ok(_) => {
                    std::thread::sleep(Duration::from_millis(80));
                    drop(stream);
                    ProbePermissionState::Granted
                }
                Err(err) => {
                    let lower = err.to_string().to_ascii_lowercase();
                    if lower.contains("permission") || lower.contains("denied") {
                        ProbePermissionState::Denied
                    } else {
                        ProbePermissionState::Prompt
                    }
                }
            },
            Err(err) => {
                let lower = err.to_string().to_ascii_lowercase();
                if lower.contains("permission") || lower.contains("denied") {
                    ProbePermissionState::Denied
                } else {
                    ProbePermissionState::Prompt
                }
            }
        }
    }
}

fn background_permission_state() -> PermissionState {
    #[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
    {
        PermissionState::Granted
    }

    #[cfg(target_os = "android")]
    {
        PermissionState::Prompt
    }

    #[cfg(target_os = "ios")]
    {
        PermissionState::Prompt
    }
}

fn get_recordings_dir(app: &AppHandle) -> Result<PathBuf, std::io::Error> {
    let base = app.path().app_data_dir().map_err(std::io::Error::other)?;
    let dir = base.join(RECORDINGS_DIR_NAME);
    if !dir.exists() {
        fs::create_dir_all(&dir)?;
    }
    Ok(dir)
}

fn get_index_path(app: &AppHandle) -> Result<PathBuf, std::io::Error> {
    Ok(get_recordings_dir(app)?.join(RECORDINGS_INDEX_NAME))
}

fn load_index_from_disk(
    app: &AppHandle,
) -> Result<HashMap<String, StoredRecording>, std::io::Error> {
    let path = get_index_path(app)?;
    if !path.exists() {
        return Ok(HashMap::new());
    }

    let file = File::open(path)?;
    let parsed: StoredIndex = serde_json::from_reader(file).map_err(std::io::Error::other)?;

    let mut map = HashMap::new();
    for record in parsed.records {
        map.insert(record.record_id.clone(), record);
    }
    Ok(map)
}

fn save_index_to_disk(
    app: &AppHandle,
    records: &HashMap<String, StoredRecording>,
) -> Result<(), std::io::Error> {
    let path = get_index_path(app)?;
    let mut vec: Vec<StoredRecording> = records.values().cloned().collect();
    vec.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    let payload = StoredIndex { records: vec };

    let file = File::create(path)?;
    serde_json::to_writer_pretty(file, &payload).map_err(std::io::Error::other)
}

fn build_recording_file_path(
    app: &AppHandle,
    record_id: &str,
    extension: &str,
) -> Result<PathBuf, std::io::Error> {
    let dir = get_recordings_dir(app)?;
    let prefix = Local::now().format("%Y%m%d_%H%M%S").to_string();
    Ok(dir.join(format!("{prefix}_{record_id}.{extension}")))
}

fn update_record_state(
    records: &mut HashMap<String, StoredRecording>,
    record_id: &str,
    state: RecordingState,
    error: Option<String>,
) {
    if let Some(record) = records.get_mut(record_id) {
        record.state = state;
        record.updated_at = now_millis();
        record.last_error = error;
    }
}

fn update_finished_record(
    records: &mut HashMap<String, StoredRecording>,
    record_id: &str,
    duration_ms: u64,
) {
    if let Some(record) = records.get_mut(record_id) {
        record.state = RecordingState::Finished;
        record.duration_ms = Some(duration_ms);
        record.updated_at = now_millis();
        record.last_error = None;
    }
}

fn build_file_info(
    record: &StoredRecording,
    path: &Path,
) -> Result<RecordingFileInfo, std::io::Error> {
    let metadata = fs::metadata(path)?;
    Ok(RecordingFileInfo {
        size_bytes: metadata.len(),
        duration_ms: record.duration_ms,
        format: record.format.clone(),
        sample_rate: record.sample_rate,
        channels: record.channels,
        created_at: record.created_at,
    })
}

fn build_file_info_from_session(
    session: &ActiveSession,
    duration_ms: u64,
) -> Result<RecordingFileInfo, std::io::Error> {
    let metadata = fs::metadata(&session.file_path)?;
    Ok(RecordingFileInfo {
        size_bytes: metadata.len(),
        duration_ms: Some(duration_ms),
        format: session.format.clone(),
        sample_rate: session.sample_rate,
        channels: session.channels,
        created_at: session.started_at_epoch_ms,
    })
}

fn duration_ms_from_samples(samples: u64, sample_rate: u32, channels: u16) -> u64 {
    if sample_rate == 0 || channels == 0 {
        return 0;
    }
    let frames = samples / channels as u64;
    (frames * 1000) / sample_rate as u64
}

fn elapsed_ms(session: &ActiveSession) -> u64 {
    let base = session.started_at.elapsed().as_millis() as u64;
    let mut paused_total = session.total_paused_ms;
    if let Some(paused_at) = session.paused_started_at {
        paused_total = paused_total.saturating_add(paused_at.elapsed().as_millis() as u64);
    }
    base.saturating_sub(paused_total)
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or(Duration::from_secs(0))
        .as_millis() as u64
}

fn get_free_space(app: &AppHandle) -> Result<u64, std::io::Error> {
    let path = get_recordings_dir(app)?;
    available_space(path).map_err(std::io::Error::other)
}

fn file_url_from_path(path: &Path) -> String {
    let mut raw = path.to_string_lossy().replace('\\', "/");
    if !raw.starts_with('/') {
        raw = format!("/{raw}");
    }
    format!("file://{raw}")
}

fn parse_byte_range(range_header: &str, total_len: u64) -> Option<(u64, u64)> {
    if total_len == 0 {
        return None;
    }
    let value = range_header.trim();
    let raw = value.strip_prefix("bytes=")?;
    let (start_raw, end_raw) = raw.split_once('-')?;

    if start_raw.is_empty() {
        let suffix = end_raw.parse::<u64>().ok()?;
        if suffix == 0 {
            return None;
        }
        let start = total_len.saturating_sub(suffix);
        return Some((start, total_len - 1));
    }

    let start = start_raw.parse::<u64>().ok()?;
    if start >= total_len {
        return None;
    }

    if end_raw.is_empty() {
        return Some((start, total_len - 1));
    }

    let end = end_raw.parse::<u64>().ok()?;
    if end < start {
        return None;
    }

    Some((start, end.min(total_len - 1)))
}

fn build_http_response(
    status: tauri::http::StatusCode,
    content_type: &str,
    body: Vec<u8>,
    headers: &[(tauri::http::header::HeaderName, String)],
) -> tauri::http::Response<Vec<u8>> {
    let mut builder = tauri::http::Response::builder()
        .status(status)
        .header(tauri::http::header::CONTENT_TYPE, content_type)
        .header(tauri::http::header::CONTENT_LENGTH, body.len().to_string());

    for (key, value) in headers {
        builder = builder.header(key, value);
    }

    builder
        .body(body)
        .unwrap_or_else(|_| tauri::http::Response::new(Vec::new()))
}

fn emit_recording_state_changed(app: &AppHandle, record_id: &str, state: RecordingState) {
    let _ = app.emit(
        "recording_state_changed",
        RecordingStateChangedEvent {
            record_id: record_id.to_string(),
            state,
        },
    );
}

fn run_ttl_cleanup(app: &AppHandle, records: &mut HashMap<String, StoredRecording>) {
    let now = now_millis();
    let ttl_ms = RECORDING_TTL_DAYS * 24 * 60 * 60 * 1000;
    let mut to_remove = Vec::new();

    for (record_id, record) in records.iter() {
        if record.state != RecordingState::Finished {
            continue;
        }
        if now.saturating_sub(record.created_at) > ttl_ms {
            let _ = fs::remove_file(&record.file_path);
            to_remove.push(record_id.clone());
        }
    }

    for record_id in to_remove {
        records.remove(&record_id);
    }

    if let Err(err) = save_index_to_disk(app, records) {
        log::warn!("save index failed after cleanup: {err}");
    }
}

fn spawn_cleanup_loop(app: AppHandle) {
    thread::spawn(move || loop {
        thread::sleep(Duration::from_secs(CLEANUP_INTERVAL_SECS));

        if let Some(state) = app.try_state::<AudioRecordState>() {
            if let Ok(mut guard) = state.inner.lock() {
                if guard.active_session.is_none() {
                    run_ttl_cleanup(&app, &mut guard.recordings);
                }
            }
        }
    });
}

#[derive(Default)]
struct PlaybackState {
    state: PlaybackStatus,
    record_id: Option<String>,
    worker: Option<PlaybackWorker>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_range_normal() {
        assert_eq!(parse_byte_range("bytes=0-99", 1000), Some((0, 99)));
        assert_eq!(parse_byte_range("bytes=100-", 1000), Some((100, 999)));
        assert_eq!(parse_byte_range("bytes=-200", 1000), Some((800, 999)));
    }

    #[test]
    fn parse_range_invalid() {
        assert_eq!(parse_byte_range("bytes=200-100", 1000), None);
        assert_eq!(parse_byte_range("bytes=1000-1200", 1000), None);
        assert_eq!(parse_byte_range("invalid", 1000), None);
        assert_eq!(parse_byte_range("bytes=-0", 1000), None);
    }

    #[test]
    fn duration_calculation() {
        let sample_rate = 48_000;
        let channels = 2;
        let samples = 96_000;
        assert_eq!(
            duration_ms_from_samples(samples, sample_rate, channels),
            1000
        );
    }

    #[test]
    fn response_builder_sets_headers() {
        let response = build_http_response(
            tauri::http::StatusCode::OK,
            "audio/wav",
            vec![1, 2, 3, 4],
            &[(tauri::http::header::ACCEPT_RANGES, "bytes".to_string())],
        );
        assert_eq!(response.status(), tauri::http::StatusCode::OK);
        assert_eq!(
            response
                .headers()
                .get(tauri::http::header::CONTENT_TYPE)
                .and_then(|v| v.to_str().ok()),
            Some("audio/wav")
        );
        assert_eq!(
            response
                .headers()
                .get(tauri::http::header::ACCEPT_RANGES)
                .and_then(|v| v.to_str().ok()),
            Some("bytes")
        );
        assert_eq!(response.body().len(), 4);
    }
}
