use std::{
    fs::{self, File},
    io::BufWriter,
    path::PathBuf,
    sync::{mpsc, Arc, Mutex},
    time::{Duration, Instant},
};

use cpal::{
    traits::{DeviceTrait, HostTrait, StreamTrait},
    BufferSize, SampleFormat, StreamConfig,
};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime, State};

const RECORDING_DIR_NAME: &str = "recordings";

#[derive(Debug, Clone, Serialize)]
pub struct PermissionResponse {
    pub granted: bool,
    #[serde(rename = "canRequest")]
    pub can_request: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct StartResponse {
    #[serde(rename = "sessionId")]
    pub session_id: String,
    #[serde(rename = "mimeType")]
    pub mime_type: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct StatusResponse {
    pub state: RecordingState,
    #[serde(rename = "durationMs")]
    pub duration_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct StopResponse {
    #[serde(rename = "filePath")]
    pub file_path: String,
    #[serde(rename = "durationMs")]
    pub duration_ms: u64,
    #[serde(rename = "fileSize")]
    pub file_size: u64,
    #[serde(rename = "sampleRate")]
    pub sample_rate: u32,
    #[serde(rename = "channels")]
    pub channels: u16,
}

#[derive(Debug, Deserialize)]
pub struct StartRequest {
    #[serde(rename = "maxDurationMs")]
    pub max_duration_ms: Option<u64>,
}

#[derive(Debug, Deserialize)]
pub struct SessionRequest {
    #[serde(rename = "sessionId")]
    pub session_id: String,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum RecordingState {
    Idle,
    Recording,
    Stopped,
}

struct RecorderStateInternal {
    state: RecordingState,
    session_id: Option<String>,
    started_at: Option<Instant>,
    file_path: Option<PathBuf>,
    sample_rate: u32,
    channels: u16,
    last_duration_ms: Option<u64>,
    last_file_size: Option<u64>,
    control_tx: Option<mpsc::Sender<WorkerCommand>>,
}

impl RecorderStateInternal {
    fn new() -> Self {
        Self {
            state: RecordingState::Idle,
            session_id: None,
            started_at: None,
            file_path: None,
            sample_rate: 0,
            channels: 0,
            last_duration_ms: None,
            last_file_size: None,
            control_tx: None,
        }
    }
}

enum WorkerCommand {
    Stop(mpsc::Sender<Result<StopResponse, String>>),
    Cancel(mpsc::Sender<Result<(), String>>),
}

#[derive(Clone)]
pub struct RecorderManager {
    inner: Arc<Mutex<RecorderStateInternal>>,
}

impl RecorderManager {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(RecorderStateInternal::new())),
        }
    }

    fn recording_dir<R: Runtime>(&self, app: &AppHandle<R>) -> Result<PathBuf, String> {
        let base = app.path().app_cache_dir().map_err(|err| err.to_string())?;
        let dir = base.join(RECORDING_DIR_NAME);
        fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
        Ok(dir)
    }

    fn build_session_id(&self) -> String {
        ulid::Ulid::new().to_string()
    }

    fn wav_spec(sample_rate: u32, channels: u16) -> hound::WavSpec {
        hound::WavSpec {
            channels,
            sample_rate,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        }
    }

    fn write_input_data_f32(
        input: &[f32],
        writer: &Arc<Mutex<Option<hound::WavWriter<BufWriter<File>>>>>,
    ) {
        if let Ok(mut guard) = writer.lock() {
            if let Some(writer) = guard.as_mut() {
                for &sample in input {
                    let clamped = sample.max(-1.0).min(1.0);
                    let value = (clamped * i16::MAX as f32) as i16;
                    let _ = writer.write_sample(value);
                }
            }
        }
    }

    fn write_input_data_i16(
        input: &[i16],
        writer: &Arc<Mutex<Option<hound::WavWriter<BufWriter<File>>>>>,
    ) {
        if let Ok(mut guard) = writer.lock() {
            if let Some(writer) = guard.as_mut() {
                for &sample in input {
                    let _ = writer.write_sample(sample);
                }
            }
        }
    }

    fn write_input_data_u16(
        input: &[u16],
        writer: &Arc<Mutex<Option<hound::WavWriter<BufWriter<File>>>>>,
    ) {
        if let Ok(mut guard) = writer.lock() {
            if let Some(writer) = guard.as_mut() {
                for &sample in input {
                    let value = (sample as i32 - i16::MAX as i32 - 1) as i16;
                    let _ = writer.write_sample(value);
                }
            }
        }
    }

    pub fn start<R: Runtime>(
        &self,
        app: &AppHandle<R>,
        max_duration_ms: u64,
    ) -> Result<StartResponse, String> {
        let mut state = self
            .inner
            .lock()
            .map_err(|_| "Recorder lock poisoned".to_string())?;
        if state.state == RecordingState::Recording {
            return Err("Recording already in progress".to_string());
        }

        let session_id = self.build_session_id();
        let dir = self.recording_dir(app)?;
        let _ = app
            .asset_protocol_scope()
            .allow_directory(dir.clone(), true);
        let file_path = dir.join(format!("{session_id}.wav"));

        let (control_tx, control_rx) = mpsc::channel::<WorkerCommand>();
        let (start_tx, start_rx) = mpsc::channel::<Result<(u32, u16), String>>();
        let file_path_for_thread = file_path.clone();

        std::thread::spawn(move || {
            let host = cpal::default_host();
            let device = match host.default_input_device() {
                Some(device) => device,
                None => {
                    let _ = start_tx.send(Err("No input audio device available".to_string()));
                    return;
                }
            };
            struct Candidate {
                config: StreamConfig,
                format: SampleFormat,
                sample_rate: u32,
                channels: u16,
            }

            let preferred_rates = [48_000, 44_100, 16_000, 8_000];
            let mut candidates: Vec<Candidate> = Vec::new();

            if let Ok(configs) = device.supported_input_configs() {
                let ranges: Vec<cpal::SupportedStreamConfigRange> = configs.collect();
                for range in ranges.iter() {
                    if range.channels() != 1 {
                        continue;
                    }
                    let min_rate = range.min_sample_rate().0;
                    let max_rate = range.max_sample_rate().0;
                    for rate in preferred_rates {
                        if rate >= min_rate && rate <= max_rate {
                            let config = range.clone().with_sample_rate(cpal::SampleRate(rate));
                            candidates.push(Candidate {
                                config: StreamConfig {
                                    channels: config.channels(),
                                    sample_rate: config.sample_rate(),
                                    buffer_size: BufferSize::Default,
                                },
                                format: config.sample_format(),
                                sample_rate: rate,
                                channels: config.channels(),
                            });
                        }
                    }
                }

                for range in ranges.iter() {
                    if range.channels() == 1 {
                        continue;
                    }
                    let min_rate = range.min_sample_rate().0;
                    let max_rate = range.max_sample_rate().0;
                    for rate in preferred_rates {
                        if rate >= min_rate && rate <= max_rate {
                            let config = range.clone().with_sample_rate(cpal::SampleRate(rate));
                            candidates.push(Candidate {
                                config: StreamConfig {
                                    channels: config.channels(),
                                    sample_rate: config.sample_rate(),
                                    buffer_size: BufferSize::Default,
                                },
                                format: config.sample_format(),
                                sample_rate: rate,
                                channels: config.channels(),
                            });
                        }
                    }
                }
            }

            if let Ok(default_config) = device.default_input_config() {
                for rate in preferred_rates {
                    candidates.insert(
                        0,
                        Candidate {
                            config: StreamConfig {
                                channels: 1,
                                sample_rate: cpal::SampleRate(rate),
                                buffer_size: BufferSize::Default,
                            },
                            format: default_config.sample_format(),
                            sample_rate: rate,
                            channels: 1,
                        },
                    );
                }
            }

            if candidates.is_empty() {
                let _ = start_tx.send(Err("No supported input config found".to_string()));
                return;
            }

            let err_fn = |err| {
                log::error!("recording stream error: {err}");
            };

            let mut selected: Option<(
                cpal::Stream,
                Arc<Mutex<Option<hound::WavWriter<BufWriter<File>>>>>,
                u32,
                u16,
            )> = None;
            let mut last_error: Option<String> = None;
            for candidate in candidates {
                let sample_rate = candidate.sample_rate;
                let channels = candidate.channels;
                let stream_config = candidate.config;
                let format = candidate.format;

                let spec = Self::wav_spec(sample_rate, channels);
                let writer = match hound::WavWriter::create(&file_path_for_thread, spec) {
                    Ok(writer) => writer,
                    Err(err) => {
                        last_error = Some(err.to_string());
                        continue;
                    }
                };
                let writer = Arc::new(Mutex::new(Some(writer)));
                let writer_clone = writer.clone();

                let stream_result = match format {
                    SampleFormat::F32 => device.build_input_stream(
                        &stream_config,
                        move |data: &[f32], _| Self::write_input_data_f32(data, &writer_clone),
                        err_fn,
                        None,
                    ),
                    SampleFormat::I16 => device.build_input_stream(
                        &stream_config,
                        move |data: &[i16], _| Self::write_input_data_i16(data, &writer_clone),
                        err_fn,
                        None,
                    ),
                    SampleFormat::U16 => device.build_input_stream(
                        &stream_config,
                        move |data: &[u16], _| Self::write_input_data_u16(data, &writer_clone),
                        err_fn,
                        None,
                    ),
                    _ => {
                        last_error = Some("Unsupported sample format".to_string());
                        continue;
                    }
                };

                let stream = match stream_result {
                    Ok(stream) => stream,
                    Err(err) => {
                        last_error = Some(err.to_string());
                        continue;
                    }
                };

                if let Err(err) = stream.play() {
                    last_error = Some(err.to_string());
                    continue;
                }

                selected = Some((stream, writer, sample_rate, channels));
                break;
            }

            let Some((stream, writer, sample_rate, channels)) = selected else {
                let message =
                    last_error.unwrap_or_else(|| "No supported input config found".to_string());
                let _ = start_tx.send(Err(message));
                return;
            };

            let _ = start_tx.send(Ok((sample_rate, channels)));

            match control_rx.recv() {
                Ok(WorkerCommand::Stop(response_tx)) => {
                    drop(stream);
                    if let Ok(mut guard) = writer.lock() {
                        if let Some(writer) = guard.take() {
                            let _ = writer.finalize();
                        }
                    }
                    let file_size = fs::metadata(&file_path_for_thread)
                        .map(|meta| meta.len())
                        .unwrap_or_default();
                    let response = StopResponse {
                        file_path: file_path_for_thread.display().to_string(),
                        duration_ms: 0,
                        file_size,
                        sample_rate,
                        channels,
                    };
                    let _ = response_tx.send(Ok(response));
                }
                Ok(WorkerCommand::Cancel(response_tx)) => {
                    drop(stream);
                    if let Ok(mut guard) = writer.lock() {
                        if let Some(writer) = guard.take() {
                            let _ = writer.finalize();
                        }
                    }
                    let _ = fs::remove_file(&file_path_for_thread);
                    let _ = response_tx.send(Ok(()));
                }
                Err(_) => {}
            }
        });

        let (sample_rate, channels) = match start_rx.recv() {
            Ok(Ok(info)) => info,
            Ok(Err(err)) => return Err(err),
            Err(_) => return Err("Failed to start recorder".to_string()),
        };

        state.state = RecordingState::Recording;
        state.session_id = Some(session_id.clone());
        state.started_at = Some(Instant::now());
        state.file_path = Some(file_path);
        state.sample_rate = sample_rate;
        state.channels = channels;
        state.last_duration_ms = None;
        state.last_file_size = None;
        state.control_tx = Some(control_tx.clone());

        if max_duration_ms > 0 {
            let manager = self.clone();
            let session_for_timer = session_id.clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(max_duration_ms));
                let _ = manager.stop(&session_for_timer);
            });
        }

        Ok(StartResponse {
            session_id,
            mime_type: "audio/wav".to_string(),
        })
    }

    pub fn stop(&self, session_id: &str) -> Result<StopResponse, String> {
        let mut state = self
            .inner
            .lock()
            .map_err(|_| "Recorder lock poisoned".to_string())?;
        if state.state != RecordingState::Recording {
            return Err("Recording is not active".to_string());
        }
        if state.session_id.as_deref() != Some(session_id) {
            return Err("Invalid recording session".to_string());
        }
        let control_tx = state
            .control_tx
            .clone()
            .ok_or_else(|| "Recorder not ready".to_string())?;
        let started_at = state.started_at;
        let file_path = state.file_path.clone();
        state.control_tx = None;
        drop(state);

        let (response_tx, response_rx) = mpsc::channel();
        control_tx
            .send(WorkerCommand::Stop(response_tx))
            .map_err(|_| "Recorder thread unavailable".to_string())?;
        let mut response = response_rx
            .recv()
            .map_err(|_| "Recorder stop failed".to_string())??;

        if let Some(started_at) = started_at {
            response.duration_ms = started_at.elapsed().as_millis() as u64;
        }

        let mut state = self
            .inner
            .lock()
            .map_err(|_| "Recorder lock poisoned".to_string())?;
        state.state = RecordingState::Stopped;
        state.last_duration_ms = Some(response.duration_ms);
        state.last_file_size = Some(response.file_size);
        if let Some(file_path) = file_path {
            response.file_path = file_path.display().to_string();
        }
        Ok(response)
    }

    pub fn cancel(&self, session_id: &str) -> Result<(), String> {
        let mut state = self
            .inner
            .lock()
            .map_err(|_| "Recorder lock poisoned".to_string())?;
        if state.state != RecordingState::Recording {
            state.state = RecordingState::Idle;
            return Ok(());
        }
        if state.session_id.as_deref() != Some(session_id) {
            return Err("Invalid recording session".to_string());
        }
        let control_tx = state
            .control_tx
            .clone()
            .ok_or_else(|| "Recorder not ready".to_string())?;
        state.control_tx = None;
        drop(state);

        let (response_tx, response_rx) = mpsc::channel();
        control_tx
            .send(WorkerCommand::Cancel(response_tx))
            .map_err(|_| "Recorder thread unavailable".to_string())?;
        let _ = response_rx
            .recv()
            .map_err(|_| "Recorder cancel failed".to_string())??;

        let mut state = self
            .inner
            .lock()
            .map_err(|_| "Recorder lock poisoned".to_string())?;
        if let Some(path) = state.file_path.take() {
            let _ = fs::remove_file(path);
        }
        state.session_id = None;
        state.started_at = None;
        state.last_duration_ms = None;
        state.last_file_size = None;
        state.state = RecordingState::Idle;
        Ok(())
    }

    pub fn status(&self, session_id: &str) -> Result<StatusResponse, String> {
        let state = self
            .inner
            .lock()
            .map_err(|_| "Recorder lock poisoned".to_string())?;
        if state.session_id.as_deref() != Some(session_id) {
            return Err("Invalid recording session".to_string());
        }
        let duration_ms = match state.state {
            RecordingState::Recording => state
                .started_at
                .map(|instant| instant.elapsed().as_millis() as u64)
                .unwrap_or_default(),
            _ => state.last_duration_ms.unwrap_or_default(),
        };
        Ok(StatusResponse {
            state: state.state,
            duration_ms,
        })
    }
}

#[tauri::command]
pub fn recording_check_permission() -> PermissionResponse {
    PermissionResponse {
        granted: true,
        can_request: false,
    }
}

#[tauri::command]
pub fn recording_request_permission() -> PermissionResponse {
    PermissionResponse {
        granted: true,
        can_request: false,
    }
}

#[tauri::command]
pub fn recording_start<R: Runtime>(
    app: AppHandle<R>,
    state: State<RecorderManager>,
    request: StartRequest,
) -> Result<StartResponse, String> {
    let max_duration = request.max_duration_ms.unwrap_or(0);
    state.inner().start(&app, max_duration)
}

#[tauri::command]
pub fn recording_stop<R: Runtime>(
    _app: AppHandle<R>,
    state: State<RecorderManager>,
    request: SessionRequest,
) -> Result<StopResponse, String> {
    state.inner().stop(&request.session_id)
}

#[tauri::command]
pub fn recording_cancel<R: Runtime>(
    _app: AppHandle<R>,
    state: State<RecorderManager>,
    request: SessionRequest,
) -> Result<(), String> {
    state.inner().cancel(&request.session_id)
}

#[tauri::command]
pub fn recording_status<R: Runtime>(
    _app: AppHandle<R>,
    state: State<RecorderManager>,
    request: SessionRequest,
) -> Result<StatusResponse, String> {
    state.inner().status(&request.session_id)
}
