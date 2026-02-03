录音功能需求文档

修订记录
- V1.2 (2026-02-03)
  - 引入 interrupted 状态与音频中断事件语义。
  - 增加录音前预检接口与磁盘空间检查说明。
  - 明确 get_recording_url 推荐自定义协议与 Range 支持。
  - 简化原生播放为可选/备选能力，WebView 播放优先。
  - 补充 Android 通知配置与 iOS 音频会话管理要求。
- V1.1 (2026-02-03)
  - 明确 Android 后台录音必须使用前台服务与通知，并补充权限与电池优化说明。
  - 增加 WebView 直连播放的访问方式（recording URL），降低 Base64 大文件传输风险。
  - 增加音频中断/焦点处理策略与事件要求。
  - 完善生命周期异常恢复与取消删除策略。
  - 完善导出能力与文件命名建议。
  - 补齐播放能力（seek/进度/音量）或明确 WebView 播放优先路径。
  - 将“实时录音流式传输到 WebView”列为下一版本目标。
- V1.0 (2026-02-03)
  - 初版需求定义，覆盖录音生命周期、权限、存储、播放与清理策略。

目标
- 在 native-app-runtime 中提供跨平台录音能力，并通过 Tauri command API 供 WebView 调用。
- 覆盖 Windows、macOS、Android、iOS，保持一致的 API 形态。
- 录音实时传回给 WebView 以便边录边处理（低优先级）。

功能优先级
- 高优先级：Runtime 基础录音能力（权限申请、录音、播放、读取、状态查询、文件信息、导出、URL 访问、TTL 清理、异常恢复、音频中断处理、录音前预检），不包含后台录音。
- 中优先级：后台录音能力（前台服务、后台权限与相关设施）。
- 低优先级：录音数据实时传输给 WebView 进行处理。

范围
- 录音开始、暂停、继续、停止
- 查询状态与当前会话元数据
- 录音数据存储与管理（支持播放与定期清理）
- 后台录音支持（应用切后台或 WebView 不活跃时仍持续录音）
- 麦克风与后台录音权限申请

非目标
- 录音实时流式传输到 WebView（低优先级，V1.1 不在范围，后续版本目标）
- 服务端上传或云同步（不在范围内）
- 高级 DSP 功能（降噪、AGC、VAD），除非平台默认强制

术语
- Recording Session：一次完整的录音生命周期，由唯一的 record_id 标识
- Record ID：start_recording 返回的唯一字符串，用于后续操作
- Runtime：native-app-runtime 组件，提供设备能力
- WebView API：供 JS 调用的 Tauri command 接口

功能需求
1) 会话生命周期
- 全局仅允许一个活动录音会话（单路录音）。
- start_recording 返回唯一 record_id。
- pause_recording 暂停采集但不完成文件。
- resume_recording 继续已暂停的会话。
- stop_recording 完成文件并将会话标记为已完成。
- cancel_recording 停止并丢弃会话及相关文件。
  - 取消时应异步删除临时文件，避免阻塞主线程。

初始化与异常恢复
- SDK 初始化时扫描持久化记录，若发现状态为 recording/paused 但应用刚启动，标记为 error(abnormal exit)。
- 对异常会话的临时文件：可按策略保留供排查，或在下一次清理周期删除。
- 对可能损坏的音频文件（如 M4A/AAC 未正常写入索引）可尝试修复或标记为损坏。

2) 状态与查询
- get_recording_status 返回：
  - state：idle | recording | paused | interrupted | stopping | finished | error
  - record_id（若存在会话）
  - start_time, elapsed_ms
  - file_path（若已完成）
  - file_format, sample_rate, channels, bit_rate（若已知）
  - last_error（若 state=error）

3) 存储与访问
- 默认存储位置为 runtime 管理目录：
  - 桌面端：运行时范围内的应用数据目录
  - 移动端：应用沙盒的 documents/cache 目录（按平台规范）
- 文件名基于 record_id 生成且稳定，建议加入时间戳前缀以便人工识别（如 20231027_102030_{record_id}.m4a）。
- WebView 无法直接读原生文件系统，需由 runtime 提供访问：
  - get_recording_file_info(record_id)：size、duration、path（若允许）、created_at
  - read_recording_file(record_id, offset, length)：返回 base64 字节片段（大文件不推荐）
  - get_recording_url(record_id)：返回可供 WebView 直接加载的本地 URL（asset:// 或自定义协议），用于流式播放/读取。
  - export_recording_file(record_id, target_path)：导出到用户可见路径（平台需用户授权与合规 API）。
- 建议优先通过 get_recording_url 进行二进制拉取；若桥接支持 ArrayBuffer/Blob，可替代 base64 返回。

4) 播放支持
- 推荐 WebView 使用 get_recording_url(record_id) + HTML5 <audio> 直接播放。
- 原生播放为备选能力，仅提供最小接口：
  - play_recording(record_id)
  - stop_playback()
  - get_playback_status()
- 播放与录音互斥，不允许同时进行。

5) 保留与清理
- Runtime 以 TTL 策略进行定期清理。
- TTL：超过 30 天删除。
- 清理在应用启动时执行，并按固定周期运行（如 24 小时）。
- 仅清理已完成会话，活动或暂停会话不清理。

6) 后台录音
- 应用进入后台或 WebView 不活跃时仍持续录音。
- 后台行为需按平台说明（见平台说明）。
- WebView 可通过 get_recording_status 重新绑定并继续操作。

7) 权限
- 所有平台均需要麦克风权限。
- 需要后台录音权限的平台必须申请相关权限。
- 若权限被拒绝，start_recording 返回权限错误。
- 提供查询与申请流程：
  - get_recording_permissions(): { mic: granted|denied|prompt, background: granted|denied|prompt }
  - request_recording_permissions(): 触发系统弹窗并返回最新状态

8) 音频中断与焦点
- 需处理系统中断与音频焦点变化，避免录音静默失败。
- 中断策略建议：来电/闹钟响铃时自动 pause_recording 并发送事件；中断结束由前端决定是否 resume_recording。
 - 被系统夺取音频焦点时应进入 interrupted 状态，并发送中断事件。

推荐文件格式
- 默认格式：AAC（M4A 容器）
  - 理由：质量/体积平衡，iOS/Android/macOS 原生支持，Windows 也可接受
- AAC 不可用时回退：WAV/PCM
- 实际格式需在 get_recording_status 与文件信息中暴露。

API（Tauri Command）
所有命令返回 Result { ok: true, data } 或 { ok: false, error }。

1) start_recording(options)
- 输入：
  - options: {
      sample_rate?: number (默认 44100)
      channels?: 1|2 (默认 1)
      bit_rate?: number (默认平台值)
      format?: "m4a"|"wav" (可选，尽力满足)
      tag?: string (可选，用于业务标记)
    }
- 输出：
  - { record_id: string, file_url?: string }
- 错误：
  - PERMISSION_DENIED, RECORDING_IN_PROGRESS, PLATFORM_UNAVAILABLE

2) pause_recording(record_id)
- 输出：{ state: "paused" }
- 错误：INVALID_RECORD_ID, INVALID_STATE

3) resume_recording(record_id)
- 输出：{ state: "recording" }
- 错误：INVALID_RECORD_ID, INVALID_STATE

4) stop_recording(record_id)
- 输出：{ state: "finished", file_info }
- 错误：INVALID_RECORD_ID, INVALID_STATE, IO_ERROR

5) cancel_recording(record_id)
- 输出：{ state: "idle" }
- 错误：INVALID_RECORD_ID

6) get_recording_status()
- 输出：上文状态结构

7) get_recording_file_info(record_id)
- 输出：{ size_bytes, duration_ms, format, sample_rate, channels, created_at }

8) read_recording_file(record_id, offset, length)
- 输出：{ chunk_base64, offset, length, eof }

9) get_recording_url(record_id)
- 输出：{ url }
 - 说明：建议使用自定义协议（如 buckyos-record://recording/{id}）并支持 HTTP Range。

10) play_recording(record_id)
- 输出：{ state: "playing" }

11) stop_playback()
- 输出：{ state: "idle" }

12) get_playback_status()
- 输出：{ state: "idle"|"playing", record_id? }

13) get_recording_permissions()
- 输出：{ mic, background }

14) request_recording_permissions()
- 输出：{ mic, background }

15) check_recording_readiness()
- 输出：{ ready: boolean, mic, background, free_space_bytes, reason? }

事件（必选）
- recording_state_changed: { record_id, state }
- recording_error: { record_id, error_code, message }
- playback_state_changed: { record_id, state }
- audio_interruption_begin: { record_id, reason }
- audio_interruption_end: { record_id }

状态机
- idle -> recording -> paused -> recording -> stopping -> finished -> idle
- idle -> recording -> stopping -> finished -> idle
- idle -> recording -> interrupted -> paused -> recording -> stopping -> finished -> idle
- idle -> recording -> error -> idle（清理后）
- cancel_recording 进入 idle 并删除临时输出

错误码
- PERMISSION_DENIED
- RECORDING_IN_PROGRESS
- INVALID_RECORD_ID
- INVALID_STATE
- PLATFORM_UNAVAILABLE
- IO_ERROR
- INTERNAL_ERROR

平台说明
- Windows：后台录音取决于系统音频会话策略，默认允许，除非系统限制。
- macOS：需要麦克风权限，应用仍运行时允许后台录音。
- iOS：需要麦克风权限与后台音频能力，需配置录音音频会话并处理系统中断通知；录音期间设置 AVAudioSessionCategory 为 PlayAndRecord 并在结束后恢复。
- Android：需要 RECORD_AUDIO 权限；后台录音必须使用前台服务并展示不可消除通知。
  - Android 14+ 需声明 FOREGROUND_SERVICE_MICROPHONE。
  - Android 13+ 需 POST_NOTIFICATIONS 以展示前台服务通知。
  - 某些厂商 ROM 仍可能限制后台运行，可提示用户加入电池优化白名单（可选）。
  - 建议支持 notification_config 以便业务自定义前台通知内容。

安全与隐私
- 音频仅存储于应用受控目录。
- 通过 TTL 清理避免默认长期保存。
- WebView 仅能通过 read_recording_file 或 get_recording_url 访问，不应暴露原始路径（除非明确允许）。

验收标准
- WebView 能开始、暂停、继续、停止与查询状态，并获取 record_id。
- 全平台严格执行单路录音规则。
- 录音文件可通过 get_recording_url 在 WebView 直接播放；read_recording_file 用于上传或低频读取场景。
- 应用进入后台或 WebView 不活跃时，录音持续进行。
- 权限申请与拒绝有清晰错误返回。
- 定期清理按期执行，且不影响活动会话。

开放问题
- get_recording_url 使用自定义协议 buckyos-record:// 并支持 HTTP Range。
- TTL 固定为超过 30 天删除。
