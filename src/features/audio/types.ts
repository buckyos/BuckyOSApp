export type RecordingState =
  | "idle"
  | "recording"
  | "paused"
  | "interrupted"
  | "stopping"
  | "finished"
  | "error";

export type PlaybackState = "idle" | "playing";

export type PermissionState = "granted" | "denied" | "prompt";

export interface RecordingStatus {
  state: RecordingState;
  record_id?: string | null;
  start_time?: number | null;
  elapsed_ms: number;
  file_path?: string | null;
  file_format?: string | null;
  sample_rate?: number | null;
  channels?: number | null;
  bit_rate?: number | null;
  last_error?: string | null;
}

export interface RecordingFileInfo {
  size_bytes: number;
  duration_ms?: number | null;
  format: string;
  sample_rate: number;
  channels: number;
  created_at: number;
}

export interface RecordingListItem {
  record_id: string;
  file_name: string;
  state: RecordingState;
  format: string;
  created_at: number;
  updated_at: number;
  duration_ms?: number | null;
  size_bytes: number;
  file_exists: boolean;
}

export interface ApiErrorPayload {
  code: string;
  message: string;
}

export interface ApiResult<T> {
  ok: boolean;
  data?: T;
  error?: ApiErrorPayload;
}

export interface StartRecordingOptions {
  sample_rate?: number;
  channels?: 1 | 2;
  bit_rate?: number;
  format?: "m4a" | "wav";
  tag?: string;
}

export interface ReadinessStatus {
  ready: boolean;
  mic: PermissionState;
  background: PermissionState;
  free_space_bytes: number;
  reason?: string | null;
}

export interface PlaybackStatus {
  state: PlaybackState;
  record_id?: string | null;
}
