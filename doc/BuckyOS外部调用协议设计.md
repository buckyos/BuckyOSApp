# BuckyOS 外部调用协议设计

## 摘要

本文定义 BuckyOS 的外部调用协议。协议的第一阶段只要求支持 `buckyos://` custom scheme，用于让普通浏览器页面、桌面网页、第三方 App 或系统入口拉起 BuckyOS App / 桌面端，并把一个可验证的调用意图交给 BuckyOS。

`buckyos://` 不是某个具体业务协议。它只是一层外部调用 envelope，真正的业务由 `action` 决定。保存网页、请求签名、打开 Zone 页面、授权登录、设备绑定等能力都应作为不同 action 扩展，而不是为每个业务重新发明一套外部入口。

本协议的核心目标是：

- 给第三方 SDK 一个稳定的拉起入口。
- 让 App 内部把 deep link、扫码、Runtime API 等入口收敛为同一种 action 分发模型。
- 允许 action 按版本持续扩展，不要求一次设计完所有业务。
- 避免 URL 中携带大 payload、密码、助记词、私钥或长期凭证。
- 从 v1 开始保留来源展示、用户确认、hash 校验、过期时间和防重放能力。

## 1. 设计定位

### 1.1 `buckyos://` 的职责

`buckyos://` 只负责四件事：

1. 被系统识别并拉起 BuckyOS App / 桌面端。
2. 携带一个结构化调用 envelope。
3. 告诉 BuckyOS 这次调用希望执行哪个 `action`。
4. 提供足够信息，让 BuckyOS 拉取、校验并分发完整请求。

`buckyos://` 不负责：

- 直接完成保存、签名、授权、绑定等业务。
- 承载完整业务 payload。
- 证明发起方一定可信。
- 绕过用户确认或权限系统。
- 作为任意代码执行入口。

### 1.2 统一入口模型

第一阶段只实现 custom scheme。`buckyos://` 本身已经表达“调用 BuckyOS”，因此不再额外固定一层 `invoke`。URL 的 host 直接表示 action：

```text
buckyos://<action>
```

后续可以增加其他入口，但它们都应转换为同一种内部模型：

```text
第三方 SDK / 网页 / App / 扫码
  -> 外部入口
  -> BuckyOS Invoke Envelope
  -> BuckyOS App 解析与校验
  -> action handler
  -> 用户确认 / 权限策略 / Zone 页面 / 本地能力
```

未来入口包括但不限于：

- `window.BuckyApi.invoke(...)`
- 二维码
- Android App Link / iOS Universal Link
- 系统分享入口
- 浏览器扩展

这些入口不应各自定义业务语义。它们只是 transport，真正的语义仍由 `action` 和 request object 决定。

## 2. 协议 URL

### 2.1 标准形式

```text
buckyos://<action>?v=1&request_url=<url>&request_hash=<hash>&source=<origin>
```

示例：

```text
buckyos://sign.payload?v=1&request_url=https%3A%2F%2Fexample.com%2Fbuckyos%2Freq%2F123&request_hash=sha256-abc123&source=https%3A%2F%2Fexample.com
```

解析规则：

- scheme 必须是 `buckyos`。
- host 必须是合法 action，例如 `sign.payload`。
- query string 使用 UTF-8 + percent encoding。
- 参数名使用 snake_case。
- 未识别参数必须被保留到调试信息中，但不能影响核心校验结果。
- action 只允许小写字母、数字、连字符和点号。URL parser 可能会规范化 host 大小写，因此 action 不允许依赖大小写区分。

### 2.2 通用 intent fallback

`buckyos://<action>` 是主路径。未来如果出现协议层尚未标准化、或 App 当前版本不直接认识的能力，可以增加一个通用 fallback action：

```text
buckyos://intent?v=1&type=x.example.notes.import&request_url=<url>&request_hash=<hash>
```

含义：

- `intent` 是一个保留 action。
- `type` 表示真正的业务意图。
- BuckyOS App 不一定自己处理该业务，可以把它交给 Current Zone、已安装 BuckyOS app、插件或后续 action registry 匹配 handler。

`intent` 的价值是兼容未来扩展，不是绕过安全模型。它仍然必须满足：

- `type` 必须通过 action 命名规则校验。
- `request_url` / `request_hash` 仍要校验。
- 默认必须用户确认。
- 只有已注册 handler 才能处理。
- 没有 handler 时必须拒绝。

第一阶段可以不实现 `intent`，未知 action 直接拒绝。等需要动态分发时，再把 `intent` 作为标准 action 加入。

### 2.3 必填参数

`buckyos://<action>` v1 的必填元素：

```ts
interface InvokeUrlParams {
  action: string;       // parsed from URL host
  v: "1";
  request_url: string;
  request_hash: string;
}
```

约束：

- `v` 必须等于 `"1"`。
- URL host 解析出的 `action` 必须存在并通过命名规则校验。
- 第一版必须提供 `request_url` 和 `request_hash`。
- 第一版不支持在 `buckyos://` URL 中直接携带完整 payload。

### 2.4 推荐参数

```ts
interface RecommendedInvokeUrlParams {
  source?: string;
  nonce?: string;
  expires_at?: string;
}
```

字段说明：

- `source`：发起方声明的 origin，用于展示和辅助校验。custom scheme 中的 `source` 不能单独作为可信依据。
- `nonce`：防重放随机值。
- `expires_at`：Unix 秒级时间戳。App 收到过期请求必须拒绝。
- callback 不放在 URL query 中。第一版 `result_post` callback 必须写在 request object 内，避免 deep link 泄露或被篡改。

## 3. Request Object

### 3.1 request_url 模式

当 URL 中存在 `request_url` 时，BuckyOS App 应通过 HTTPS 拉取完整 request object。

```http
GET <request_url>
```

返回体建议为 JSON：

```json
{
  "v": "1",
  "action": "sign.payload",
  "source": "https://example.com",
  "app_id": "com.example.web",
  "app_name": "Example",
  "created_at": 1782380000,
  "expires_at": 1782380600,
  "nonce": "n-123",
  "payload": {
    "purpose": "publish_note",
    "payloads": [
      {
        "title": "Hello",
        "content_hash": "sha256-content123",
        "created_at": 1782380000
      }
    ],
    "payload_summary": "Publish note: Hello"
  },
  "callback": {
    "type": "result_post",
    "url": "https://example.com/buckyos/result/123"
  }
}
```

### 3.2 通用结构

```ts
interface BuckyInvokeRequest {
  v: "1";
  action: string;
  source?: string;
  app_id?: string;
  app_name?: string;
  created_at?: number;
  expires_at: number;
  nonce: string;
  payload: unknown;
  callback?: InvokeCallback;
}

type InvokeCallback =
  | { type: "none" }
  | { type: "result_post"; url: string };
```

字段约束：

- `v` 必须与 URL 中的 `v` 一致。
- `action` 必须与 URL host 解析出的 action 一致。对于 `buckyos://intent`，request object 的 `action` 应为 `intent`，真正的业务类型放在 payload 的 `intent_type` 或 URL 的 `type` 字段中。
- `expires_at` 必须存在，并且不能晚于当前时间太多。建议默认有效期 2 到 5 分钟。
- `nonce` 必须存在，并在同一个 `source + action` 范围内短时去重。
- `payload` 结构由 action 定义。
- `callback` 由 action 选择是否支持。第一版 `sign.payload` 支持 `result_post`，用于把签名结果 POST 回第三方服务端。

### 3.3 request_hash

`request_hash` 用于确保 App 拉取到的 request object 与调用方生成 deep link 时承诺的内容一致。

第一版不使用 canonical JSON。`request_hash` 直接对 `request_url` 返回的原始 HTTP response body bytes 计算。这样可以避免不同语言、不同 JSON 序列化方式导致字段顺序、空格或转义差异。

v1 格式：

```text
sha256-<base64url digest>
```

计算方式：

1. 第三方服务端创建 request object，并固定最终 HTTP response body bytes。
2. 第三方服务端计算 `SHA-256(response_body_bytes)`。
3. 用 base64url 无 padding 编码 digest。
4. 拼接 `sha256-` 前缀，得到 `request_hash`。
5. SDK 把 `request_url` 和 `request_hash` 放入 `buckyos://sign.payload?...`。
6. BuckyOS App 拉取 `request_url`，先对原始 response body bytes 计算同样的 hash。
7. App 比较计算结果与 URL 中的 `request_hash`，一致后才解析 JSON。

伪代码：

```ts
const bodyBytes = await fetchBytes(requestUrl);
const actualHash = `sha256-${base64url(sha256(bodyBytes))}`;

if (actualHash !== requestHashFromUrl) {
  throw new Error("invalid_hash");
}

const request = JSON.parse(utf8Decode(bodyBytes));
```

约束：

- 第三方服务端应在创建请求时返回 `request_url` 和 `request_hash`，SDK 不应根据本地临时 object 自行猜测 hash。
- `request_url` 在同一个请求有效期内必须返回稳定 body。若服务端动态重排字段或补充字段，会导致 hash 不一致。
- App 必须先校验 hash，再 parse JSON。
- hash 通过只证明内容未被替换，不证明来源可信。App 仍需继续校验 `action`、`source`、`expires_at`、`nonce`、payload schema 和用户确认。

## 4. Action 命名和分发

### 4.1 命名规则

普通 `action` 使用 dot-separated namespace：

```text
<namespace>.<verb>[.<detail>]
```

合法字符：

```text
[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+
```

此外，v1 保留一个单段 action：

```text
intent
```

`intent` 只用于未来通用 fallback，不应被普通业务直接占用。

示例：

```text
sign.payload
intent
```

保留 namespace：

- `bucky.*`：BuckyOS 系统内部 action。
- `zone.*`：Current Zone / OOD 相关 action。
- `sign.*`：签名类 action。
- `auth.*`：登录、授权、session 类 action。
- `app.*`：打开或路由到 BuckyOS app。
- `device.*`：设备发现、绑定、激活。
- `intent`：通用 fallback action，详见 2.3。

第三方自定义 action 应使用反向域名或 `x.` 前缀，例如：

```text
x.example.notes.import
com-example-notes.import
```

### 4.2 分发规则

BuckyOS App 收到外部调用后按以下顺序处理：

1. 解析 URL。
2. 校验协议版本和 action 名称。
3. 如果存在 `request_url`，拉取 request object。
4. 校验 `request_hash`、过期时间、nonce、action 一致性。
5. 查找 action handler。
6. 对未知 action 进入安全 fallback 或直接拒绝。
7. 展示来源、action 和 payload 摘要。
8. 按 action 需求执行用户确认、权限校验或路由。
9. 执行 action。
10. 按 callback 规则返回结果或仅展示本地结果。

### 4.3 未知 action

未知 action 不能直接执行，也不能把 payload 当脚本或 URL 任意打开。

v1 行为：

- 如果 action 属于已知 namespace，但 handler 尚未安装，展示“当前版本不支持该操作”。
- 如果 action 是 `intent`，并且 request object 中指定了合法 `intent_type`，可以尝试交给 Current Zone、已安装 BuckyOS app、插件或 action registry 继续匹配 handler。
- 其他未知 action 直接拒绝。

拒绝结果：

```json
{
  "ok": false,
  "code": "unsupported_action",
  "message": "Unsupported action: x.example.notes.import"
}
```

### 4.4 动态扩展边界

协议允许动态扩展 action，但动态扩展不等于任意执行。

必须遵守：

- action handler 必须由 BuckyOS App、Current Zone 或已安装 BuckyOS app 显式注册。
- handler 必须声明 payload schema。
- handler 必须声明是否需要用户确认。
- handler 必须声明所需 capability / scope。
- handler 必须有明确错误码。
- handler 不能默认继承完整 owner 权限。

## 5. SDK 行为

### 5.1 Web SDK 最小 API

协议传输层使用字符串 action id，例如 URL 中的 `sign.payload`。但应用代码不应裸写 action 字符串。BuckyOS SDK 必须导出 action 常量，并优先提供语义化方法，避免第三方应用直接拼接协议细节。

第一版 action 常量：

```ts
export const BuckyAction = {
  SignPayload: "sign.payload",
} as const;

export type BuckyAction = typeof BuckyAction[keyof typeof BuckyAction];
```

底层通用调用可以使用常量：

```ts
await BuckyOS.invoke({
  action: BuckyAction.SignPayload,
  requestUrl,
  requestHash,
  source: window.location.origin,
});
```

更推荐 SDK 暴露语义化方法，让业务代码不需要感知 action id：

```ts
await BuckyOS.signPayload({
  requestUrl,
  requestHash,
  source: window.location.origin,
});
```

SDK 内部负责把它转换为：

```text
buckyos://sign.payload?v=1&request_url=...&request_hash=...&source=...
```

App 内部分发也应使用同一份常量或生成代码，而不是手写字符串：

```ts
switch (action) {
  case BuckyAction.SignPayload:
    return handleSignPayload(request);
  default:
    return unsupportedAction(action);
}
```

这样可以避免拼写错误，支持 IDE 自动补全，并让 action id 与 payload 类型在 SDK 中绑定起来。

第三方页面建议通过 SDK 使用协议，而不是手写 deep link。

```ts
const result = await BuckyOS.invoke({
  action: BuckyAction.SignPayload,
  payload: {
    purpose: "publish_note",
    payloads: [
      {
        title: "Hello",
        contentHash: "sha256-content123",
        createdAt: Date.now()
      }
    ],
    payload_summary: "Publish note: Hello"
  }
});
```

SDK 内部负责：

- 调用第三方服务端创建 request object。
- 获取服务端返回的 `request_url` 和 `request_hash`。
- 打开 `buckyos://<action>?...`。
- 处理拉起失败和 fallback。

### 5.2 第一阶段通道选择

第一阶段只要求支持 `buckyos://`：

```ts
if (window.BuckyApi?.invoke) {
  return window.BuckyApi.invoke(request);
}

open(`buckyos://${request.action}?v=1&request_url=...&request_hash=...`);
```

说明：

- `window.BuckyApi.invoke` 不是第一阶段必做，但协议应预留。
- 移动端和桌面端都可以尝试打开 `buckyos://`。
- 浏览器不能可靠静默判断 App 是否已安装，SDK 只能尝试打开并提供 fallback。

### 5.3 拉起失败处理

浏览器对 custom scheme 的行为不统一。SDK 应提供保守 fallback：

1. 用户点击按钮后立即打开 `buckyos://<action>?...`。
2. 设置 1.5 到 3 秒超时。
3. 监听 `visibilitychange` 或 `pagehide`。
4. 如果页面仍可见且未收到 callback，展示 fallback UI。

fallback UI 可以包含：

- 下载 BuckyOS App。
- 复制调用链接。
- 展示二维码。
- 改用浏览器扩展。
- 提示用户手动打开 BuckyOS。

SDK 不应承诺能百分百判断 App 是否已安装。

## 6. App 侧实现要求

### 6.1 Tauri / Rust

需要接入 deep link 能力：

- 注册 `buckyos` custom scheme。
- 冷启动时读取启动 URL。
- App 已运行时接收新的 BuckyOS URL。
- 桌面端处理 single instance，避免 Windows / Linux 上启动多个进程导致请求丢失。
- 把 URL 交给前端统一解析或在 Rust 层先做基础校验。

建议内部事件：

```ts
type InvokeOpenEvent = {
  url: string;
  source: "cold_start" | "runtime";
  received_at: number;
};
```

### 6.2 Android

Android 需要增加 intent-filter：

```xml
<intent-filter>
    <action android:name="android.intent.action.VIEW" />
    <category android:name="android.intent.category.DEFAULT" />
    <category android:name="android.intent.category.BROWSABLE" />
    <data
        android:scheme="buckyos" />
</intent-filter>
```

后续如果增加 HTTPS App Link，可以映射到 `https://link.buckyos.org/<action>` 或其他统一 HTTPS 入口，但进入 App 后仍应转换为本文定义的 envelope。

### 6.3 iOS

iOS 需要注册 URL Types：

```text
scheme: buckyos
```

后续如果增加 Universal Link，应让 Universal Link 也转换为同一个外部调用事件。

### 6.4 桌面端

桌面端需要注册系统协议：

```text
buckyos://
```

并处理：

- 已运行实例接收新 URL。
- 冷启动带 URL。
- 多窗口下把外部调用交给主窗口或专门的确认窗口。
- 用户取消或处理完成后回到原窗口状态。

## 7. 用户确认和权限

### 7.1 默认确认原则

第一版外部调用默认且始终需要用户确认。后续如果引入可信来源、授权策略或静默能力，应作为独立能力重新设计，不属于第一版范围。

### 7.2 确认页必须展示

确认页至少展示：

- 应用名称或来源域名。
- action 名称和本地化说明。
- payload 摘要。
- 使用的 DID / SN / Zone 身份。
- 请求过期时间。
- 需要授予或使用的权限。

如果 payload 复杂，应提供展开查看入口。

### 7.3 并发

同一时间只允许一个外部调用处于确认或执行状态。

如果已有任务：

```json
{
  "ok": false,
  "code": "busy",
  "message": "Another external request is in progress."
}
```

## 8. 安全要求

### 8.1 URL 不可信

`buckyos://<action>?...` 中的所有参数都不可信，包括 `source`、`nonce` 和 `expires_at`。URL host 中的 action 也不可信，必须先通过命名规则校验再分发。

App 必须：

- 严格解析 URL。
- 限制最大 URL 长度。
- 限制参数数量和单个字段长度。
- 拒绝未知协议版本。
- 拒绝非法 action 名称。
- 拒绝非 HTTPS 的 `request_url`，开发模式除外。

第一版建议硬限制：

- deep link URL 最大 8192 bytes。
- `request_url` response body 最大 256 KiB。
- `payload.payloads` 最多 16 项。
- `payload.payload_summary` 最大 512 个 Unicode 字符。
- `callback.url` 最大 2048 bytes。

### 8.2 来源校验

custom scheme 无法天然证明发起来源。

建议规则：

- `source` 只作为展示字段和辅助信息。
- 当存在 `request_url` 时，以 `request_url` 的 HTTPS origin 作为可验证来源。
- request object 中的 `source` 应与 URL 参数中的 `source` 一致，或至少属于同一 registrable domain。
- 高风险 action 应要求 request object 由第三方服务端签名，或后续接入 AppID / origin 绑定机制。

### 8.3 Callback 校验

`callback` 不能默认打开，也不能默认提交结果。

App 只有在 action handler 明确允许时才处理 callback。处理前必须校验：

- callback type 是否允许。第一版 `sign.payload` 只允许 `result_post`。
- callback scheme 是否允许。生产环境只允许 HTTPS。
- callback host 是否与 source / request_url origin 匹配。
- callback 是否会把敏感结果放进 URL query。
- 是否存在 open redirect 风险。

第一版 `result_post` 规则：

- App 使用 HTTP POST 向 callback URL 提交结果。
- 签名结果必须放在 POST body 中。
- 签名结果不得放入 URL query、fragment 或 path。
- 生产环境 callback URL 必须是 `https://`。
- 开发环境允许 `http://localhost`、`http://127.0.0.1` 和明确开启开发模式的局域网 HTTP callback；生产构建必须禁用。
- callback POST 失败时，App 应展示明确错误，并允许用户重试或关闭。

### 8.4 防重放

App 应维护短时 nonce cache：

```text
key = source + action + nonce
ttl = max(请求剩余有效期, 5 分钟)
```

重复 nonce 应拒绝。

### 8.5 敏感信息

以下内容不得出现在 `buckyos://` URL、二维码、普通日志或第三方可见 callback 中：

- 明文密码。
- 助记词。
- 私钥。
- 长期 owner capability。
- 完整本地钱包数据。
- 不必要的个人隐私数据。

完整 payload 如包含敏感业务数据，应使用 `request_url` 拉取，并避免在本地普通日志中记录明文。

## 9. 第一版 Action

第一版只实现一个 action：`sign.payload`。其他 action 等 `buckyos://` 拉起、解析、校验、确认和结果返回链路稳定后再逐步增加。

### 9.1 `sign.payload`

用途：请求用户对明确 JSON payload 签名。

payload：

```ts
interface SignPayload {
  purpose: string;
  payloads: Record<string, unknown>[];
  payload_summary?: string;
  signature_level?: "root" | "zone";
}
```

结果：

```ts
interface SignPayloadResult {
  signer: {
    did: string;
    username: string;
    public_key: unknown;
  };
  signatures: string[];
}
```

规则：

- 默认必须用户确认。
- 第一版必须使用 `request_url` 拉取完整签名请求。
- payload 不应放在 URL 中。
- 签名结果必须绑定原始 payload hash。
- 签名结果必须返回 signer 信息，其中 `username` 直接表示当前用户名称。
- 第一版不返回 `pwd_hash`。如果未来确有兼容需求，应单独定义 capability 和适用范围。
- 第三方收到签名后必须自行验证。

## 10. 返回结果

### 10.1 本地结果结构

App 内部 action handler 统一返回：

```ts
type InvokeResult =
  | {
      ok: true;
      action: string;
      request_id?: string;
      data?: unknown;
    }
  | {
      ok: false;
      action?: string;
      request_id?: string;
      code: InvokeErrorCode;
      message: string;
    };
```

错误码：

```ts
type InvokeErrorCode =
  | "unsupported_version"
  | "invalid_url"
  | "invalid_action"
  | "unsupported_action"
  | "invalid_request"
  | "invalid_hash"
  | "expired"
  | "replayed"
  | "busy"
  | "user_cancelled"
  | "permission_denied"
  | "no_active_identity"
  | "network_error"
  | "handler_error";
```

### 10.2 结果回传

第一版 `sign.payload` 支持 `callback.type = "result_post"`。签名完成后，App 向 callback URL 提交签名结果。

请求：

```http
POST <callback.url>
Content-Type: application/json
```

成功 body：

```json
{
  "ok": true,
  "action": "sign.payload",
  "request_hash": "sha256-...",
  "result": {
    "signer": {
      "did": "did:bucky:...",
      "username": "alice",
      "public_key": {}
    },
    "signatures": ["..."]
  }
}
```

失败 body：

```json
{
  "ok": false,
  "action": "sign.payload",
  "request_hash": "sha256-...",
  "code": "user_cancelled",
  "message": "User cancelled signing."
}
```

约束：

- callback URL 不携带签名结果。
- App 必须用 POST body 返回结果。
- 返回结果必须包含 signer 信息和 signatures。
- 第一版不得返回 `pwd_hash`。
- 第三方服务端收到结果后仍必须验证签名和 `request_hash`。
- 第三方网页通过自己的服务端 session、轮询、SSE 或 WebSocket 获取最终状态。
- 如果 request object 不提供 callback，App 只展示本地完成状态；第三方网页无法自动获得结果。

## 11. 版本策略

### 11.1 协议版本

URL 中的 `v=1` 是 envelope 版本，不是 action 版本。

action 如需版本，应放在 request object 内：

```json
{
  "v": "1",
  "action": "sign.payload",
  "action_version": 1,
  "payload": {}
}
```

### 11.2 兼容原则

- 新增 query 参数必须向后兼容。
- 新增 action 不需要升级 envelope 版本。
- 修改已有 action payload 的不兼容字段时，应升级 `action_version`。
- App 遇到不支持的 action version 必须拒绝，而不是猜测执行。

## 12. 第一阶段实现范围

第一阶段建议只交付以下内容：

1. 注册 `buckyos://` custom scheme。
2. App 冷启动和已运行时都能收到 BuckyOS URL。
3. 实现 URL 解析、基础校验和错误展示。
4. 支持 `request_url + request_hash` 拉取和校验。
5. 建立统一 action dispatch 框架。
6. 内置 `sign.payload` handler：复用当前 active DID 签名能力，但必须显示来源和 payload 摘要。
7. 提供 SDK 生成 `buckyos://sign.payload` 的辅助函数。
8. 补齐错误码、日志脱敏和并发保护。

暂不要求：

- HTTPS App Link / Universal Link。
- 完整二维码扫码流程。
- 完整 relay 服务。
- 完整授权策略管理。
- 保存、登录、Zone 路由等其他 action。
- 静默自动执行。

## 13. 验收标准

### 13.1 协议入口

- Android、iOS、Windows、macOS 桌面端安装后能响应 `buckyos://sign.payload?...`。
- App 冷启动和已运行两种状态都能收到 URL。
- 非法版本、非法 action、缺少 payload 的 URL 会被拒绝。
- 超长 URL 和非法编码不会导致崩溃。

### 13.2 request_url

- App 能拉取 HTTPS `request_url`。
- App 能校验 `request_hash`。
- hash 不匹配时拒绝执行。
- 请求过期时拒绝执行。
- 重复 nonce 被拒绝。

### 13.3 action 分发

- 已注册 action 能进入对应 handler。
- 未注册 action 显示明确错误。
- handler 执行前能展示来源、action 和 payload 摘要。
- 同时发起多个外部调用时只处理一个，其余返回 busy。

### 13.4 `sign.payload`

- 普通网页能通过 `request_url` 发起签名请求。
- 普通网页 SDK 能生成 `buckyos://sign.payload?...`。
- 点击后能拉起 BuckyOS。
- App 能展示来源和 payload 摘要。
- 用户取消、密码错误、无 active DID、hash 不匹配均有明确错误。
- 签名成功后 App 能通过 `result_post` callback 把结果 POST 回第三方服务端。
- callback 成功结果包含 `signer.did`、`signer.username`、`signer.public_key` 和 `signatures`。
- callback 成功结果不包含 `pwd_hash`。
- callback POST 失败时有明确错误和重试/关闭路径。
- 成功签名后结果不泄露到普通日志。

## 14. 已决策与待决策问题

### 14.1 第一版已决策

- `request_hash` 第一版按 `request_url` 返回的原始 HTTP response body bytes 计算，不使用 canonical JSON。
- 第一版 `sign.payload` 必须使用 `request_url + request_hash`，不把完整 payload 放进 `buckyos://` URL。
- 第一版不支持 inline payload。
- 生产环境的 `request_url` 必须使用 HTTPS。
- 开发环境允许非 HTTPS `request_url`，但仅限 `http://localhost`、`http://127.0.0.1` 和明确开启开发模式的局域网地址；生产构建必须禁用。
- `sign.payload` 第一版复用当前 `signJsonWithActiveDid` 能力，不新增底层签名 command。
- 复用 `signJsonWithActiveDid` 时，外部调用层必须补齐来源展示、hash 校验、并发保护和日志脱敏。
- 第一版支持 `callback.type = "result_post"`，App 通过 POST body 向第三方服务端提交签名结果。
- callback 成功结果必须包含 signer 信息和 signatures；signer 使用 `username` 字段表示当前用户名称。
- 第一版不返回 `pwd_hash`。
- 生产环境 callback URL 必须使用 HTTPS；开发环境允许受限 HTTP callback，规则与开发环境 `request_url` 一致。
- 签名结果不得放入 callback URL query、fragment 或 path。
- 第一版采用固定大小限制：deep link URL 8192 bytes、request body 256 KiB、payloads 16 项、payload_summary 512 个 Unicode 字符、callback URL 2048 bytes。
- `buckyos://` 的系统注册只按 scheme 注册，不按 host 限定 action。host 由 App 解析为 action。
- 普通第三方应用代码不裸写 action 字符串，应使用 SDK 常量或 `BuckyOS.signPayload(...)` 语义化 API。

### 14.2 后续演进决策

- AppID 与 origin 的绑定关系由谁维护，是否需要 BNS / Zone 参与。
- 是否引入 canonical JSON，用于未来允许 SDK 本地生成 request object 并跨语言稳定计算 hash。
- 未安装 App 的 fallback 是否由第三方 SDK 自行处理，还是提供官方网页 fallback。
