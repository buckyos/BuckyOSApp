录音功能需求文档

目标
- 在 native-app-runtime 中提供跨平台录音能力，并通过 Tauri command API 供 WebView 调用。
- 覆盖 Windows、macOS、Android、iOS，保持一致的 API 形态。

范围
- 录音开始、暂停、继续、停止
- 查询状态与当前会话元数据
- 录音数据存储与管理（支持播放与定期清理）
- 后台录音支持（应用切后台或 WebView 不活跃时仍持续录音）
- 麦克风与后台录音权限申请

非目标
- 录音实时流式传输到 WebView（不在范围内）
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

2) 状态与查询
- get_recording_status 返回：
  - state：idle | recording | paused | stopping | finished | error
  - record_id（若存在会话）
  - start_time, elapsed_ms
  - file_path（若已完成）
  - file_format, sample_rate, channels, bit_rate（若已知）
  - last_error（若 state=error）

3) 存储与访问
- 默认存储位置为 runtime 管理目录：
  - 桌面端：运行时范围内的应用数据目录
  - 移动端：应用沙盒的 documents/cache 目录（按平台规范）
- 文件名基于 record_id 生成且稳定。
- WebView 无法直接读原生文件系统，需由 runtime 提供访问：
  - get_recording_file_info(record_id)：size、duration、path（若允许）、created_at
  - read_recording_file(record_id, offset, length)：返回 base64 字节片段
- 可选：export_recording_file(record_id, target_path)，若平台允许且用户授权。

4) 播放支持
- 提供最小播放 API：
  - play_recording(record_id)
  - stop_playback()
  - get_playback_status()
- 播放与录音互斥，不允许同时进行。

5) 保留与清理
- Runtime 以 TTL 策略进行定期清理。
- 默认 TTL：7 天（可在构建时配置）。
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
  - { record_id: string }
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

9) play_recording(record_id)
- 输出：{ state: "playing" }

10) stop_playback()
- 输出：{ state: "idle" }

11) get_playback_status()
- 输出：{ state: "idle"|"playing", record_id? }

12) get_recording_permissions()
- 输出：{ mic, background }

13) request_recording_permissions()
- 输出：{ mic, background }

事件（可选但建议）
- recording_state_changed: { record_id, state }
- recording_error: { record_id, error_code, message }
- playback_state_changed: { record_id, state }

状态机
- idle -> recording -> paused -> recording -> stopping -> finished -> idle
- idle -> recording -> stopping -> finished -> idle
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
- iOS：需要麦克风权限与后台音频能力，需配置录音音频会话。
- Android：需要 RECORD_AUDIO 权限；后台录音通常需要前台服务或特定权限，视 API 等级而定。

安全与隐私
- 音频仅存储于应用受控目录。
- 通过 TTL 清理避免默认长期保存。
- WebView 仅能通过 read_recording_file 访问，不应暴露原始路径（除非明确允许）。

验收标准
- WebView 能开始、暂停、继续、停止与查询状态，并获取 record_id。
- 全平台严格执行单路录音规则。
- 录音文件可通过 read_recording_file 读取，并可通过播放 API 播放。
- 应用进入后台或 WebView 不活跃时，录音持续进行。
- 权限申请与拒绝有清晰错误返回。
- 定期清理按期执行，且不影响活动会话。

开放问题
- 是否允许 export_recording_file 导出到用户指定路径（各平台权限差异）。
- TTL 的具体时长（默认 7 天）是否允许由 WebView 配置。

------ review -----
用下面的Review提示词可以得到一些意见，基本和我自己看的相同：
```
计划在android的buckyos app sdk里提供如下SDK给开发者使用，review 一下:
```

https://gemini.google.com/share/533b068dad53

