Audio Record Requirements

Goal
- Provide a cross-platform audio recording capability in native-app-runtime with a Tauri command API for WebView.
- Support Windows, macOS, Android, and iOS with a consistent API surface.

Scope
- Start, pause, resume, stop recording
- Query status and current session metadata
- Store and manage recorded audio (playback support and periodic cleanup)
- Background recording support (record continues when app goes to background, and when WebView is not active)
- Permission prompts for microphone and background recording where applicable

Non-Goals
- Real-time streaming to WebView (out of scope)
- Server upload or cloud sync (out of scope)
- Advanced DSP features (noise suppression, AGC, VAD) unless required by platform defaults

Terminology
- Recording Session: one recording lifecycle identified by a unique record_id
- Record ID: unique string returned by start_recording and used for later operations
- Runtime: native-app-runtime component that provides device capabilities
- WebView API: Tauri command interface used by JS

Functional Requirements
1) Session Lifecycle
- Only one active recording session at a time (single global session).
- start_recording returns a unique record_id.
- pause_recording pauses capture without finalizing the file.
- resume_recording continues a paused session.
- stop_recording finalizes the file and marks the session as completed.
- cancel_recording stops and discards the session and any associated file.

2) Status and Query
- get_recording_status returns:
  - state: idle | recording | paused | stopping | finished | error
  - record_id (if session exists)
  - start_time, elapsed_ms
  - file_path (if finished)
  - file_format, sample_rate, channels, bit_rate (if known)
  - last_error (if state=error)

3) Storage and Access
- Default storage location is a runtime-managed directory:
  - desktop: app data directory under runtime scope
  - mobile: app sandbox documents/cache directory (platform-appropriate)
- Files are stored with stable names derived from record_id.
- WebView cannot read native filesystem directly; runtime provides access:
  - get_recording_file_info(record_id): size, duration, path (if allowed), created_at
  - read_recording_file(record_id, offset, length): returns bytes (base64) for safe transport
- Optional: export_recording_file(record_id, target_path) if platform allows and user grants permission.

4) Playback Support
- Provide a minimal playback API for recorded files:
  - play_recording(record_id)
  - stop_playback()
  - get_playback_status()
- Playback is mutually exclusive with active recording (no simultaneous record and playback).

5) Retention and Cleanup
- Runtime manages periodic cleanup with a TTL policy.
- Default TTL: 7 days (configurable at build time).
- Cleanup runs on app start and then at a fixed interval (e.g., every 24 hours).
- Cleanup only removes finished sessions; active or paused sessions are excluded.

6) Background Recording
- Recording continues when app goes to background and when WebView is not active.
- Background behavior is platform dependent and must be documented (see Platform Notes).
- WebView can re-attach by calling get_recording_status and resume operations after background.

7) Permissions
- Microphone permission is required on all platforms.
- Background recording permission is required where applicable.
- If permission is denied, start_recording fails with a permission error.
- Provide a query and request flow:
  - get_recording_permissions(): { mic: granted|denied|prompt, background: granted|denied|prompt }
  - request_recording_permissions(): triggers OS prompts and returns updated status

Recommended File Format
- Default format: AAC in M4A container
  - Rationale: good quality/size balance, native support on iOS/Android/macOS, acceptable on Windows
- Fallback format if AAC not available: WAV/PCM
- Runtime must expose actual format used in get_recording_status and file info.

API (Tauri Command)
All commands return a Result { ok: true, data } or { ok: false, error }.

1) start_recording(options)
- Input:
  - options: {
      sample_rate?: number (default 44100)
      channels?: 1|2 (default 1)
      bit_rate?: number (default platform default)
      format?: "m4a"|"wav" (optional request, best-effort)
      tag?: string (optional for app-side labeling)
    }
- Output:
  - { record_id: string }
- Errors:
  - PERMISSION_DENIED, RECORDING_IN_PROGRESS, PLATFORM_UNAVAILABLE

2) pause_recording(record_id)
- Output: { state: "paused" }
- Errors: INVALID_RECORD_ID, INVALID_STATE

3) resume_recording(record_id)
- Output: { state: "recording" }
- Errors: INVALID_RECORD_ID, INVALID_STATE

4) stop_recording(record_id)
- Output: { state: "finished", file_info }
- Errors: INVALID_RECORD_ID, INVALID_STATE, IO_ERROR

5) cancel_recording(record_id)
- Output: { state: "idle" }
- Errors: INVALID_RECORD_ID

6) get_recording_status()
- Output: status payload described above

7) get_recording_file_info(record_id)
- Output: { size_bytes, duration_ms, format, sample_rate, channels, created_at }

8) read_recording_file(record_id, offset, length)
- Output: { chunk_base64, offset, length, eof }

9) play_recording(record_id)
- Output: { state: "playing" }

10) stop_playback()
- Output: { state: "idle" }

11) get_playback_status()
- Output: { state: "idle"|"playing", record_id? }

12) get_recording_permissions()
- Output: { mic, background }

13) request_recording_permissions()
- Output: { mic, background }

Events (Optional but Recommended)
- recording_state_changed: { record_id, state }
- recording_error: { record_id, error_code, message }
- playback_state_changed: { record_id, state }

State Machine
- idle -> recording -> paused -> recording -> stopping -> finished -> idle
- idle -> recording -> stopping -> finished -> idle
- idle -> recording -> error -> idle (after cleanup)
- cancel_recording moves to idle and deletes temp output if any

Error Codes
- PERMISSION_DENIED
- RECORDING_IN_PROGRESS
- INVALID_RECORD_ID
- INVALID_STATE
- PLATFORM_UNAVAILABLE
- IO_ERROR
- INTERNAL_ERROR

Platform Notes
- Windows: background recording depends on system audio session policies; default to allow unless OS restricts.
- macOS: requires microphone permission, background recording allowed if app remains running.
- iOS: requires Microphone permission and background audio capability; ensure audio session configured for recording.
- Android: requires RECORD_AUDIO permission; background recording requires foreground service or special permission depending on API level.

Security and Privacy
- Store audio under app-controlled directory only.
- Provide TTL cleanup to avoid long-term retention by default.
- WebView access only via read_recording_file API; do not expose raw filesystem paths unless explicitly allowed.

Acceptance Criteria
- WebView can start, pause, resume, stop, query status, and receive a record_id.
- Single-session rule enforced across all platforms.
- Recorded file can be read via read_recording_file and played back using API.
- Background recording continues after app is backgrounded and WebView is inactive.
- Permissions are requested and handled with clear errors on denial.
- Cleanup removes expired files on schedule without affecting active sessions.

Open Questions
- Whether to allow export_recording_file to user-specified path on each platform.
- Exact TTL duration (default is 7 days) and whether it should be configurable by WebView.
