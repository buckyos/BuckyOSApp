# Bucky API 集成指南

面向希望在 iframe / 外部页面中调用宿主端能力的第三方开发者。

## 集成步骤

1. 只要页面运行在 BuckyOS Runtime（嵌入式 iframe 或独立 WebView），程序会自动向页面注入 `window.BuckyApi`。

   - 若使用录音能力，宿主侧 iframe 需设置 `allow="microphone"`，否则无法获取麦克风权限。
   - iOS 需在宿主 App 的 `Info.plist` 中配置 `NSMicrophoneUsageDescription`。

2. 判断是否在 BuckyOS Runtime 环境中的方式：`if (window.BuckyApi)`。

3. 在需要调用的地方使用 Promise 接口，如：
   ```js
   const result = await window.BuckyApi.getPublicKey();
   if (result.code === 0) {
     console.log(result.data.key);
   } else {
     console.error(result.message);
   }
   ```

## 请求 / 响应规范

所有方法都返回一个 Promise，解析后的对象结构统一为：

```ts
{
  code: number;        // 状态码，0 代表成功
  message?: string;    // 失败或取消时的提示
  data?: unknown;      // 成功时携带的数据
}
```

### 错误码

| code | 含义 |
| --- | --- |
| `0` | Success，调用成功 |
| `1` | UnknownAction，宿主无法识别的 action |
| `2` | NativeError，宿主内部错误（详见 message） |
| `3` | NoKey，没有可用的 DID 公钥 |
| `4` | NoActiveDid，当前没有激活的 DID |
| `5` | NoMessage，签名内容为空 |
| `6` | InvalidPassword，密码验证失败 |
| `7` | Cancelled，用户在交互过程中取消操作 |
| `8` | Busy，已有签名流程正在进行，请稍候重试 |

第三方页面只需根据 `code` 做分支，`message` 中提供了可展示的文案。

## 可用接口

### `BuckyApi.getPublicKey(): Promise<{ code, message?, data?: { key: string } }>`

- **说明**：返回当前激活 DID 的第一枚公钥（JSON 字符串），用于身份展示或验证。
- **参数**：无。
- **成功 data**：`{ key: string }`，内容为 JSON 字符串，可直接显示或存储。
- **典型错误码**：
  - `3` (NoKey)：当前没有公钥。
  - `4` (NoActiveDid)：没有激活的 DID。

### `BuckyApi.getCurrentUser(): Promise<{ code, message?, data?: { did: string; username: string; public_key: string; sn_username: string | null } }>`

- **说明**：返回宿主侧当前激活 DID 的基础信息与 SN 绑定状态，方便 iframe 了解用户身份。
- **参数**：无。
- **成功 data**：
  - `did`：当前激活 DID 的 Bucky DID（取自第一枚 bucky wallet）。
  - `username`：DID 的昵称。
  - `public_key`：第一枚 bucky wallet 的公钥（JSON 字符串，与 `getPublicKey` 一致）。
  - `sn_username`：若已绑定 SN 用户名则返回字符串，否则为 `null`。
- **典型错误码**：
  - `3` (NoKey)：当前没有可用 bucky wallet。
  - `4` (NoActiveDid)：没有激活的 DID。

### `BuckyApi.signJsonWithActiveDid(payloads: Record<string, unknown>[]): Promise<{ code, message?, data?: { signatures: (string | null)[] } }>`

- **说明**：使用当前激活 DID 的私钥对传入的 JSON 对象数组依次进行签名。
- **参数**：`payloads` —— 待签名的 JSON 对象数组，非对象条目会被忽略；若过滤后为空则返回 `NoMessage`。
- **成功 data**：`{ signatures: (string | null)[] }`，长度与有效输入一致，若某一项签名失败则对应元素为 `null`，其余成功项按原顺序返回。
- **典型错误码**：
  - `5` (NoMessage)：`payloads` 为空或不存在有效 JSON 对象。
  - `6` (InvalidPassword)：密码错误。
  - `7` (Cancelled)：用户取消密码输入。
  - `4` (NoActiveDid)：没有激活的 DID。
  - `8` (Busy)：当前已有签名请求在进行中，请稍后再发起新的请求。

> **提示**：`signJsonWithActiveDid` 为交互式请求，可能等待用户输入较长时间。第三方页面需避免连续发送多次请求。

### `BuckyApi.startRecording(options?: { maxDurationMs?: number }): Promise<{ code, message?, data?: { sessionId: string; mimeType: string } }>`

- **说明**：请求宿主开始录音，并返回录音会话 ID。
- **参数**：
  - `maxDurationMs`（可选）：最大录音时长（毫秒），到时自动停止。
- **成功 data**：`{ sessionId: string; mimeType: string }`（当前原生输出为 `audio/wav`）
- **典型错误码**：
  - `2` (NativeError)：不支持录音、麦克风权限被拒绝或初始化失败。
  - `8` (Busy)：已有录音在进行中。

> **提示**：移动端需在系统权限中允许麦克风访问，否则会返回权限错误。

### `BuckyApi.getRecordingStatus(sessionId: string): Promise<{ code, message?, data?: { status: "idle" | "recording" | "stopping" | "stopped"; durationMs: number; hasResult: boolean; mimeType?: string; size?: number } }>`

- **说明**：查询指定录音会话的当前状态。
- **参数**：`sessionId` —— 录音会话 ID。
- **成功 data**：
  - `status`：录音状态。
  - `durationMs`：当前已录制时长。
  - `hasResult`：是否已有录音结果可获取。
  - `mimeType`、`size`：若已生成录音结果则返回。
- **典型错误码**：
  - `2` (NativeError)：会话 ID 无效或录音状态异常。

### `BuckyApi.stopRecording(sessionId: string): Promise<{ code, message?, data?: { filePath: string; url: string; mimeType: string; durationMs: number; size: number; sampleRate?: number; channels?: number } }>`

- **说明**：停止录音并返回录音数据。
- **参数**：`sessionId` —— 录音会话 ID。
- **成功 data**：
  - `filePath`：原生录音文件路径。
  - `url`：可直接在 iframe 中播放的 URL。
  - `mimeType`、`durationMs`、`size`：录音元信息。
  - `sampleRate`、`channels`：可选的采样率与声道信息。
- **典型错误码**：
  - `2` (NativeError)：会话 ID 无效或录音已结束。

> **提示**：`url` 为本地文件映射 URL，可直接用于 `<audio src>`. 

> **提示**：原生录音会生成 WAV 文件，体积相对较大，建议及时上传/转码。

### `BuckyApi.cancelRecording(sessionId: string): Promise<{ code, message? }>`

- **说明**：取消录音并丢弃数据。
- **参数**：`sessionId` —— 录音会话 ID。
- **典型错误码**：
  - `2` (NativeError)：会话 ID 无效或录音状态异常。

## 与宿主程序的交互

一旦调用 `window.BuckyApi.xxx()`：
1. 脚本会通过 `postMessage` 将 action+palyload 发给宿主。
2. 宿主在 `iframeBridge` 中匹配 action，执行对应逻辑（可能弹窗或调用 Rust API）。
3. 宿主返回 `{ code, message?, data? }`，脚本解析后 resolve Promise。
4. 外部页面依据 `code` 判断成功与否，展示 message 或使用 data。

只要遵循以上协议，第三方页面无需关心宿主的实现细节即可安全地调用原生能力。更多接口将陆续补充，保持关注本文件即可。
