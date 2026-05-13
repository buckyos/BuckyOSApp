# Flutter 重实现方案

## 1. 目标

基于 [当前需求文档.md](./当前需求文档.md) 用 Flutter 重实现一个功能等价的 BuckyOS App，目标平台包括 macOS、Windows、Android 和 iOS。

本方案重点关注 Runtime/WebView 能力：App 需要载入第三方页面，并向第三方页面提供 `window.BuckyApi` 方法。Flutter 版本不要求复刻当前 React/Tauri 中的 iframe 结构，只要求第三方页面看到的 JS API、返回结构、交互行为和宿主能力保持等价。

## 1.1 关键确认结论

### 1.1.1 当前版本功能是否都能用 Flutter 实现

结论：可以实现，但需要把“Flutter UI 能实现”和“底层平台能力要补齐”分开看。

当前需求文档中的页面、路由、状态、SN JSON-RPC、DID 创建/导入、OOD 扫描、Runtime WebView、桌面独立窗口、移动端安全区和键盘避让，都可以在 Flutter 体系中实现。Flutter 负责跨平台 UI 和业务编排；涉及系统 WebView、多窗口、加密存储、本机网络枚举、局域网扫描、文件/配置目录等能力时，通过 Flutter plugin、Dart FFI 或平台通道补齐。

需要重点验证的不是“能不能做”，而是以下工程细节：

- Windows WebView 需要基于 WebView2 的实现；Flutter 官方 `webview_flutter` 当前覆盖 Android、iOS 和 macOS，不直接覆盖 Windows，因此 Windows 需要额外插件或自研平台实现。
- 桌面端多窗口、窗口 label 复用、窗口关闭回调需要单独做 RuntimeWindowManager。
- `window.BuckyApi` 是否能在页面初始化足够早的时机注入，需要按各平台 WebView 分别验证。
- 如果第三方页面自己的子 frame 也要求 `window.BuckyApi`，需要确认所选 WebView 方案是否支持 all-frame 注入；否则需要定义为仅 main frame 支持。

因此，产品功能可以等价实现；具体实现上不能只依赖一个 Flutter 包，需要为 Windows WebView、多窗口和密码学实现预留平台层。

### 1.1.2 第三方页面使用 `BuckyApi` 是否有变化

结论：按本方案实现时，第三方页面对 `BuckyApi` 的使用不应有变化，也不应感知宿主从 Tauri 切换到 Flutter。

第三方页面仍然只依赖以下公开契约：

- 判断 `window.BuckyApi` 是否存在。
- 调用 `window.BuckyApi.getPublicKey()`。
- 调用 `window.BuckyApi.getCurrentUser()`。
- 调用 `window.BuckyApi.signJsonWithActiveDid(payloads)`。
- 如保留当前测试接口，则调用 `window.BuckyApi.openExternalUrl(url)`。
- 所有接口都返回 Promise。
- Promise resolve 后的对象仍为 `{ code, message?, data? }`。
- 错误码保持与 [BuckyApi.md](./BuckyApi.md) 一致。

变化只发生在宿主内部通信层：当前 Tauri/React 版本是 `iframe -> window.parent.postMessage -> iframeBridge`；Flutter 版本会变成 `WebView 注入脚本 -> JavaScript channel / platform bridge -> Dart dispatcher`。这个变化不应暴露给第三方页面。

第三方页面只有在依赖了非正式细节时才可能感知差异，例如：

- 显式判断自己是否运行在 iframe 中。
- 直接访问 `window.parent` 并假设父页面存在。
- 依赖 Tauri 相关 user agent、URL、窗口层级或调试对象。
- 依赖 `postMessage` 的内部消息格式，而不是调用 `window.BuckyApi`。

这些都不属于正式 `BuckyApi` 契约。Flutter 版本只保证正式 API 等价。

### 1.1.3 DID 创建及加密算法是否必须兼容旧版本

结论：当前目标调整为“功能正确即可”，因此不强制兼容当前 Tauri 版本的本地 `wallet.store` / `vault` 数据，也不要求旧版本本地身份数据可被 Flutter 版本直接读取或迁移。

Flutter 版本可以定义自己的本地存储结构、助记词加密格式和内部 DID 数据模型。用户从旧版本切换到 Flutter 版本时，推荐通过助记词重新导入账户，而不是自动迁移旧 App 的本地 vault。

仍建议保持一致或语义等价的规则包括：

- 助记词生成：128-bit entropy，BIP-39 English，生成 12 个单词。
- 助记词导入校验：BIP-39 English，校验单词表、单词数量和 checksum。
- 同一助记词应能稳定恢复同一个 Flutter 版本内的 DID、公钥和签名身份。
- Runtime 签名继续使用明确的 Ed25519 / JWS / JWT 类方案，保证第三方页面能验证签名语义。
- SN 注册、SN 查询、导入账户、Runtime 签名等流程的产品行为保持正确。
- `window.BuckyApi` 的方法、Promise 返回结构和错误码保持兼容。
- `pwd_hash` 如果仍用于 SN 或第三方集成，应与服务端期望保持一致；这属于外部协议兼容，不是本地 vault 兼容。

可选兼容项：

- 如果后续要求无感迁移旧 App 数据，再单独补充旧 `wallet.store` / `vault` 读取、解密、迁移和兼容测试。
- 如果希望减少密码学实现风险，可以复用当前 Rust DID/crypto/name-lib 逻辑，通过 FFI 或平台库暴露给 Flutter；但在“功能正确即可”的目标下，这不是第一阶段硬性要求。

## 2. 当前 Runtime 实现摘要

当前项目的 Runtime 由三层组成：

- `openWebView`：主 App 中的统一 URL 打开入口。
- `/web-container`：App 内部容器页面。
- `iframe + iframeBridge + public/bucky-api.js`：第三方页面和宿主之间的 JS 通信层。

当前桌面端打开 URL 时，会创建独立 Tauri `WebviewWindow`。窗口并不直接加载第三方 URL，而是加载 App 内部 `/web-container?src=...&title=...&label=...`，再由 `/web-container` 内的 iframe 承载第三方页面。

当前移动端不创建新窗口，而是在当前 WebView 内跳转到 `#/web-container?embedded=1&src=...&title=...&label=...`。

当前通信协议如下：

1. `public/bucky-api.js` 在第三方页面内创建 `window.BuckyApi`。
2. 第三方页面调用 `window.BuckyApi.xxx()`。
3. 注入脚本向 `window.parent.postMessage({ kind: "bucky-api", id, action, payload }, "*")`。
4. 外层 React `iframeBridge` 校验消息来源，按 `action` 分发到宿主处理函数。
5. 宿主返回 `{ code, message?, data? }`。
6. 注入脚本收到 `bucky-api-result` 后 resolve 对应 Promise。

当前正式文档覆盖的接口：

- `getPublicKey`
- `getCurrentUser`
- `signJsonWithActiveDid`

当前实现和测试页还包含：

- `openExternalUrl`

## 3. Flutter Runtime 方案

Flutter 版本建议把 Runtime 抽象为一个直接承载第三方页面的 `BuckyRuntimeWebView`，不再使用 iframe。

核心原则：

- WebView 直接加载第三方 URL。
- 宿主在页面加载前或页面创建时注入 `window.BuckyApi`。
- `window.BuckyApi` 的方法签名、Promise 行为、错误码和返回结构保持兼容。
- JS 到宿主的调用通过 Flutter WebView 的 JavaScript channel 或平台侧 WebView bridge 实现。
- 桌面端每个独立 Runtime 窗口内放一个 Flutter 页面，该页面包含一个 `BuckyRuntimeWebView`。

这意味着 Flutter 版本的结构从：

```text
Tauri Window
  -> App /web-container
      -> iframe(third-party page)
          -> window.BuckyApi -> postMessage(parent)
```

调整为：

```text
Flutter Window / Route
  -> BuckyRuntimeWebView(third-party page)
      -> window.BuckyApi -> JS channel / platform bridge
```

第三方页面不应感知这次结构变化。它仍然只判断 `window.BuckyApi` 是否存在，并调用同名 Promise API。

## 4. JS 注入协议

Flutter 版本应保留 `public/bucky-api.js` 的语义，但通信底层需要替换。

建议注入的 JS 对象仍然是：

```js
window.BuckyApi = {
  getPublicKey() {},
  getCurrentUser() {},
  openExternalUrl(url) {},
  signJsonWithActiveDid(payloads) {}
}
```

每个方法都返回 Promise，成功 resolve 的对象统一为：

```ts
{
  code: number;
  message?: string;
  data?: unknown;
}
```

推荐 Flutter 注入脚本内部使用统一调用函数：

```js
callNative(action, payload): Promise<BuckyApiResult>
```

`callNative` 负责：

- 生成唯一请求 id。
- 把 `{ id, action, payload }` 序列化后发送给 Flutter 宿主。
- 维护 pending promise map。
- 对普通请求设置 10 秒超时。
- `signJsonWithActiveDid` 不设置固定超时，因为它需要等待用户输入密码。
- 收到宿主回调后 resolve 对应 Promise。

当前 iframe 版本依赖 `postMessage`，Flutter 版本可以改为：

- Android/iOS：WebView JavaScript channel。
- macOS/Windows：桌面 WebView 对应的 script message handler 或平台通道封装。

无论底层用什么插件或平台 API，Dart 层应统一抽象为：

```dart
abstract interface class BuckyWebBridge {
  Future<void> injectBuckyApi();
  Future<void> sendResult(String requestId, Map<String, Object?> result);
  Stream<BuckyWebRequest> get requests;
}
```

## 5. Dart 分发层

Flutter 侧建议实现统一分发器：

```dart
class BuckyApiDispatcher {
  Future<BuckyApiResult> dispatch(BuckyWebRequest request);
}
```

分发器按 `action` 处理：

| action | Flutter 宿主行为 |
| --- | --- |
| `getPublicKey` | 从当前 Active DID 的第一枚 bucky wallet 读取 public key，成功返回 `{ key }` |
| `getCurrentUser` | 返回 DID、nickname、public_key、SN username |
| `signJsonWithActiveDid` | 校验 payload 数组，弹出密码输入框，验证密码并签名 |
| `openExternalUrl` | 校验并打开 `http(s)` URL |
| 未知 action | 返回 `UnknownAction` |

错误码必须与 [BuckyApi.md](./BuckyApi.md) 保持一致：

| code | 含义 |
| --- | --- |
| `0` | Success |
| `1` | UnknownAction |
| `2` | NativeError |
| `3` | NoKey |
| `4` | NoActiveDid |
| `5` | NoMessage |
| `6` | InvalidPassword |
| `7` | Cancelled |
| `8` | Busy |

## 6. 签名交互方案

`signJsonWithActiveDid` 是 Runtime 中风险最高的接口，需要单独保证行为等价。

Flutter 版本要求：

- 只接受对象数组 `payloads`。
- 非对象条目过滤。
- 过滤后为空返回 `NoMessage`。
- 无 Active DID 返回 `NoActiveDid`。
- 同一时刻只允许一个签名请求，重复请求返回 `Busy`。
- 弹出宿主密码输入对话框。
- 用户取消返回 `Cancelled`。
- 密码错误返回 `InvalidPassword`。
- 成功后返回 `{ signatures, pwd_hash }`。

签名弹窗应该属于宿主 UI，而不是 Web 页面 UI。第三方页面只等待 Promise 结果，不直接获得密码，也不能控制弹窗内容。

`pwd_hash` 规则应以 SN 服务端和第三方集成的实际要求为准。如果继续沿用当前 SN 协议，则需要生成与现有 `buckyos.hashPassword(username, password)` 等价的结果；如果 Flutter 版本调整 SN 协议，则必须同步更新 SN 服务端和 `BuckyApi` 文档。若本地无法读取 SN 用户名，则返回 `null`。

## 7. 桌面端窗口模型

桌面端 macOS 和 Windows 的 URL 打开方式必须保持当前需求文档约束：

- 打开 URL 时创建独立 Flutter 窗口。
- 独立窗口内加载 `BuckyRuntimeWebView`。
- 主窗口不跳转、不被替换、不丢失当前页面状态。
- 同一稳定 label 的窗口已经存在时，聚焦已有窗口，不重复创建。
- 没有传入 label 时，生成随机 label，允许多开。
- 窗口标题优先使用调用方传入的 title；为空时用 URL hostname。

建议在 Flutter 层抽象：

```dart
class RuntimeWindowManager {
  Future<void> openRuntimeUrl({
    required Uri url,
    String? title,
    String? label,
    RuntimeWindowOptions? options,
    Object? userData,
    void Function(Object? userData)? onClosed,
  });
}
```

Android 和 iOS 不创建独立系统窗口，而是进入 App 内的 Runtime 页面：

```text
/runtime?src=...&title=...&label=...
```

## 8. 是否需要 iframe

Flutter 版本不建议继续使用 iframe 作为 Runtime 基础结构。

当前 iframe 的主要作用是让 Tauri 独立窗口仍先加载 App 自己的 React 页面，再由 React 页面承载第三方 URL，并用 `window.parent.postMessage` 收消息。Flutter 可以直接控制 WebView 和 JS bridge，因此没有必要再套一层 iframe。

去掉 iframe 后要重点验证：

- 第三方页面是否能在 main frame 中获得 `window.BuckyApi`。
- 页面跳转后是否仍会重新注入 `window.BuckyApi`。
- Android/iOS 的键盘避让是否仍然满足 Runtime 页面输入框可见。
- macOS/Windows 独立窗口关闭、复用、聚焦是否稳定。
- 跨域页面是否仍可调用注入对象。Flutter WebView 注入发生在页面上下文内，不依赖宿主访问第三方 DOM，因此不受当前 iframe 同源 DOM 访问限制的影响。

## 9. Native 能力映射

Flutter 版本需要把当前 Tauri/Rust 能力对应的产品能力迁移为 Dart service、Flutter plugin 或平台通道。不强制复用当前本地 vault 数据格式。

优先级如下：

1. DID 本地存储、加密、解密、助记词派生、签名。
2. SN JSON-RPC 调用与 `buckyos.hashPassword` 等价实现。
3. Runtime `BuckyApi` 分发。
4. 本机 IPv4 枚举与局域网扫描。
5. 桌面独立窗口管理。
6. 移动端安全区和键盘避让。

其中 DID、签名和 `pwd_hash` 必须先做功能正确性测试。旧 vault 兼容测试作为可选迁移需求处理，不进入第一阶段硬性验收。

## 10. 验收重点

Flutter Runtime 的最小验收用例：

- 第三方测试页加载后能检测到 `window.BuckyApi`。
- `getPublicKey()` 返回当前 Active DID 的 public key。
- `getCurrentUser()` 返回 DID、username、public_key、sn_username。
- `signJsonWithActiveDid([{ hello: "world" }])` 能弹出宿主密码框并返回签名数组。
- 签名弹窗期间重复调用返回 `Busy`。
- 用户取消返回 `Cancelled`。
- 密码错误返回 `InvalidPassword`。
- `openExternalUrl("example.com")` 自动补全为 `https://example.com/` 并打开。
- 桌面端打开 URL 不改变主窗口路由。
- 桌面端同 label 重复打开时复用窗口。
- 移动端 Runtime 页面内输入框在键盘弹出时不被遮挡。

## 11. 建议实施顺序

1. 先实现 Flutter 主路由、DID 基础页面骨架和 Runtime 页面骨架。
2. 实现 `BuckyRuntimeWebView`，注入 `window.BuckyApi`，用静态 mock dispatcher 跑通测试页。
3. 接入真实 Active DID 查询和 `getPublicKey` / `getCurrentUser`。
4. 接入签名弹窗、密码验证和真实签名。
5. 接入桌面端独立窗口管理。
6. 接入移动端 Runtime 页面、安全区和键盘避让。
7. 接入 OOD 扫描和设备 `active_url` 打开。
8. 用当前 `test_api.html` 或等价测试页做四端回归。

## 12. 需要提前确认的问题

- `openExternalUrl` 在 Flutter 版本中是否继续作为正式 `BuckyApi` 对外接口发布；如果是，需要同步补充到 [BuckyApi.md](./BuckyApi.md)。
- 第三方页面是否需要在子 frame 中也获得 `window.BuckyApi`。当前 Tauri 插件配置是向所有 frame 注入脚本；Flutter WebView 插件未必默认支持 all-frame 注入，可能需要平台侧补充。
- 桌面端 WebView 选型是否能同时满足 macOS、Windows、JS 注入、JS channel、窗口多开和窗口复用。
- iOS 是否允许目标第三方页面需要的全部 WebView 能力，尤其是文件选择、弹窗、下载、跨域请求和自定义 scheme。
- `buckyos.hashPassword` 是否继续作为 SN 协议要求保留；如果保留，在 Flutter/Dart 中采用纯 Dart 实现、Rust FFI 复用，还是平台原生库复用。
