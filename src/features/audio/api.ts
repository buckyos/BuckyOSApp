import { invoke } from "@tauri-apps/api/core";
import type {
  ApiResult,
  PlaybackStatus,
  ReadinessStatus,
  RecordingFileInfo,
  RecordingListItem,
  RecordingStatus,
  StartRecordingOptions,
} from "./types";

function unwrap<T>(result: ApiResult<T>): T {
  if (result.ok && result.data !== undefined) {
    return result.data;
  }
  const error = result.error;
  throw new Error(`${error?.code ?? "UNKNOWN_ERROR"}: ${error?.message ?? "unknown"}`);
}

export async function startRecording(options: StartRecordingOptions = {}) {
  const result = await invoke<ApiResult<{ record_id: string; file_url?: string | null }>>(
    "start_recording",
    { options }
  );
  return unwrap(result);
}

export async function pauseRecording(recordId: string) {
  const result = await invoke<ApiResult<{ state: string }>>("pause_recording", { recordId });
  return unwrap(result);
}

export async function resumeRecording(recordId: string) {
  const result = await invoke<ApiResult<{ state: string }>>("resume_recording", { recordId });
  return unwrap(result);
}

export async function stopRecording(recordId: string) {
  const result = await invoke<ApiResult<{ state: string; file_info: RecordingFileInfo }>>(
    "stop_recording",
    { recordId }
  );
  return unwrap(result);
}

export async function cancelRecording(recordId: string) {
  const result = await invoke<ApiResult<{ state: string }>>("cancel_recording", { recordId });
  return unwrap(result);
}

export async function getRecordingStatus() {
  const result = await invoke<ApiResult<RecordingStatus>>("get_recording_status");
  return unwrap(result);
}

export async function listRecordings() {
  const result = await invoke<ApiResult<RecordingListItem[]>>("list_recordings");
  return unwrap(result);
}

export async function getRecordingFileInfo(recordId: string) {
  const result = await invoke<ApiResult<RecordingFileInfo>>("get_recording_file_info", {
    recordId,
  });
  return unwrap(result);
}

export async function readRecordingFile(recordId: string, offset: number, length: number) {
  const result = await invoke<
    ApiResult<{ chunk_base64: string; offset: number; length: number; eof: boolean }>
  >("read_recording_file", { recordId, offset, length });
  return unwrap(result);
}

export async function getRecordingUrl(recordId: string) {
  const result = await invoke<ApiResult<{ url: string }>>("get_recording_url", { recordId });
  return unwrap(result);
}

export async function exportRecordingFile(recordId: string, targetPath: string) {
  const result = await invoke<ApiResult<RecordingFileInfo>>("export_recording_file", {
    recordId,
    targetPath,
  });
  return unwrap(result);
}

export async function playRecording(recordId: string) {
  const result = await invoke<ApiResult<PlaybackStatus>>("play_recording", { recordId });
  return unwrap(result);
}

export async function stopPlayback() {
  const result = await invoke<ApiResult<PlaybackStatus>>("stop_playback");
  return unwrap(result);
}

export async function getPlaybackStatus() {
  const result = await invoke<ApiResult<PlaybackStatus>>("get_playback_status");
  return unwrap(result);
}

export async function getRecordingPermissions() {
  const result = await invoke<ApiResult<{ mic: string; background: string }>>(
    "get_recording_permissions"
  );
  return unwrap(result);
}

export async function requestRecordingPermissions() {
  const result = await invoke<ApiResult<{ mic: string; background: string }>>(
    "request_recording_permissions"
  );
  return unwrap(result);
}

export async function checkRecordingReadiness() {
  const result = await invoke<ApiResult<ReadinessStatus>>("check_recording_readiness");
  return unwrap(result);
}

export async function markAudioInterruptionBegin(reason = "test") {
  const result = await invoke<ApiResult<{ state: string }>>("mark_audio_interruption_begin", {
    reason,
  });
  return unwrap(result);
}

export async function markAudioInterruptionEnd() {
  const result = await invoke<ApiResult<{ state: string }>>("mark_audio_interruption_end", {});
  return unwrap(result);
}
