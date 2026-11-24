# Bucky API 集成指南

`window.BuckyApi` 是 BuckyOS 客户端给页面的原生桥。应用开发者通常不直接用它：websdk 把它包成了 `AppFrameClient`、`getRuntimeEnvironment()`、音频接口和钱包接口，并在浏览器里给出对应的回退。本文是桥本身的约定。

## 哪些页面有

| 页面 | 怎么到客户端 | 能用的部分 |
| --- | --- | --- |
| 内容视图的顶层文档（名单内 Zone 的应用页面和系统页面） | 桌面走 Tauri IPC 的 `bucky_api_call`，移动端走 `__buckyPort` 消息通道（iOS 是对 `WKScriptMessageHandlerWithReply` 的包装） | 全部 |
| 设备激活页（桌面的独立窗口、移动端的原生视图） | 同内容视图，只对打开时的那个源（协议、主机、端口）有效 | 五个钱包方法 |
| 其它页面，包括应用页面里的 iframe、名单外的网站 | 没有 | 没有 `window.BuckyApi` |

脚本在页面自己的脚本之前执行，源码是 `public/bucky-api.js`。内容视图属于哪个 Zone、哪个应用由客户端在打开视图时记下，页面传的参数不算数；顶层文档离开这个 Zone 以后，调用一律以 `not_allowed` 失败。桌面上这条限制有两层：Tauri 的权限配置只给名单内 Zone 的源 `bucky_api_call` 这一个命令（`src-tauri/capabilities/`、`content/windows.rs` 的 `allow_zones`），命令自己再按视图和当前地址检查一次。

判断是否在客户端里：`if (window.BuckyApi?.env)`，或者用 websdk 的 `getRuntimeEnvironment()`。

## 内容视图的接口

### `BuckyApi.env`

同步可读、不可修改：

```ts
{
  container: 'desktop-app' | 'mobile-app',
  formFactor: 'desktop' | 'mobile',
  platform: 'windows' | 'macos' | 'linux' | 'android' | 'ios',
  clientVersion: string,
  capabilities: string[],      // window.native、notify.system、app.open、media.session、audio.background、audio.record、header.native
  zone: string,                // Zone DID
  app: string, appInstance: string, windowId: string,
  presentation: 'window' | 'tab',
  accent?: string              // 这个账号给这个 Zone 选的主题色
}
```

能力可用才列出；应用按能力清单决定用什么，不靠平台名猜。现在各平台列出的：

| 能力 | 桌面 | Android | iOS |
| --- | --- | --- | --- |
| `app.open` | ✓ | ✓ | ✓ |
| `notify.system` | ✓ | ✓ | |
| `window.native`、`media.session` | ✓ | | |
| `audio.background` | ✓ | ✓ | ✓ |
| `audio.record` | | ✓ | ✓ |
| `header.native` | | ✓ | ✓ |

### `BuckyApi.call(name, payload?): Promise<unknown>`

成功给数据，失败 reject 一个带 `code` 的 Error。`code`：`unsupported`、`not_allowed`、`denied`、`canceled`、`busy`、`not_found`、`invalid_state`、`failed`。

| name | 说明 |
| --- | --- |
| `frame.post` | 把一条 app-frame 消息交给宿主（客户端）。应用用 websdk 的 `AppFrameClient`，不直接调 |
| `audio.background.acquire` / `update` / `release` | 申请、更新、释放后台播放保活，载荷 `{title, artist?, artwork?, playing}`。桌面窗口最小化后本来就继续播放，这三个调用直接成功。Android 起媒体播放类型的前台服务并显示系统媒体控件（声音仍由页面的 `<audio>` 发出），必须在客户端处于前台时第一次申请；控件、耳机按键、拔耳机变成 `audio.background.command`。iOS 显示锁屏和控制中心的媒体控件，声音在后台和锁屏后继续；拔耳机由系统暂停页面的播放。没有 `acquire` 就 `update` 是 `invalid_state` |
| `audio.record.start / pause / resume / stop / status / list / get / delete` | 录音，能力清单里有 `audio.record` 时可用（现在是 Android 和 iOS）。被来电等打断时状态是 `interrupted`，结束后自动继续。同一时刻整个客户端只有一个录音（`busy`）；第一次用先由客户端的原生对话框问用户，再由系统授权（`denied`）。文件是 ADTS 封装的 AAC（`audio/aac`），按账号、Zone、应用实例隔离，视图关闭时自动结束并保留；进程中途被杀的录音保留已写入的部分，没有 `durationMs` |

### `BuckyApi.on(event, handler): () => void`

返回取消订阅的函数。事件：`frame.message`（宿主发来的 app-frame 消息）、`audio.background.command`、`audio.record.state`。

`invoke` 这个名字留给《外部调用协议》。

## 钱包方法

五个方法在内容视图和激活页里都有，都返回 Promise，解析后的对象结构统一为：

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

### `BuckyApi.getCurrentUser(): Promise<{ code, message?, data?: { did: string; username: string; public_key: object; sn_username: string | null; owner_document: OwnerDocument } }>`

- **说明**：返回宿主侧当前激活 DID 的基础信息与 SN 绑定状态，方便 iframe 了解用户身份。
- **参数**：无。
- **成功 data**：
  - `did`：当前激活 DID 的 Bucky DID（取自第一枚 bucky wallet）。
  - `username`：DID 的昵称。
  - `public_key`：第一枚 bucky wallet 的公钥 JWK 对象（与 `getPublicKey` 一致）。
  - `sn_username`：若已绑定 SN 用户名则返回字符串，否则为 `null`。
  - `owner_document`：通过宿主配置的 `name-client::NameClient::resolve_did(did, owner)` 读取的完整 OwnerDocument；缓存有效期内复用解析结果，TTL 到期后重新查询权威源。成功返回可用用户时该字段必然存在。读取成功后同步本地钱包副本，但不推进 `iat`，也不发布文档；较旧的解析结果不会覆盖本地已确认的新版本，同 `iat` 不同内容会报错。
- **典型错误码**：
  - `3` (NoKey)：当前没有可用 bucky wallet。
  - `4` (NoActiveDid)：没有激活的 DID。

### `BuckyApi.signJsonWithActiveDid(payloads: Record<string, unknown>[]): Promise<{ code, message?, data?: { signatures: (string | null)[]; pwd_hash: string | null } }>`

- **说明**：使用当前激活 DID 的私钥对传入的 JSON 对象数组依次进行签名。
- **参数**：`payloads` —— 待签名的 JSON 对象数组，非对象条目会被忽略；若过滤后为空则返回 `NoMessage`。
- **成功 data**：
  - `signatures: (string | null)[]`，长度与有效输入一致，若某一项签名失败则对应元素为 `null`，其余成功项按原顺序返回。
  - `pwd_hash: string | null`，基于当前激活 DID 在本地已保存的 SN 用户名和本次输入密码计算出的摘要值，规则为 `Base64(SHA256(password + username + ".buckyos"))`。宿主仅从本地 `sn_username` / SN 状态缓存读取用户名；若本地不存在则返回 `null`。只有激活页能得到它；内容视图（Zone 的页面和应用）里恒为 `null`，因为这个摘要可以登录账号自己的 Zone。
- **典型错误码**：
  - `5` (NoMessage)：`payloads` 为空或不存在有效 JSON 对象。
  - `6` (InvalidPassword)：密码错误。
  - `7` (Cancelled)：用户取消密码输入。
  - `4` (NoActiveDid)：没有激活的 DID。
  - `8` (Busy)：当前已有签名请求在进行中，请稍后再发起新的请求。

> **提示**：`signJsonWithActiveDid` 为交互式请求，可能等待用户输入较长时间。第三方页面需避免连续发送多次请求。密码由客户端自己的界面询问：桌面是一个单独的本地小窗，移动端是原生对话框。页面看不到密码，也看不到输入它的界面。界面上写明请求方（应用名，或“设备”）、Zone 或设备的主机地址、以哪个身份签名，以及要签的内容；请求之后切换了身份，签名作废。

### `BuckyApi.resolve_did(did: string, docType?: DidDocType | null): Promise<{ code, message?, data?: EncodedDocument }>`

- **说明**：通过宿主 Rust 扩展调用配置好 BNS 解析器的 `name-client::NameClient::resolve_did`，复用该实例及机器级 DID 文档缓存。
- **解析器配置**：优先使用 `machine.json` 中明确设置且非空的 `bns_host`；未设置时复用应用 `config.json` 的 `sn_host` 根域构造的 BNS 端点，默认 `https://bns.buckyos.ai`。`web3_bridge.bns` 仅用于 DID 到访问域名的映射，不作为 BNS 文档解析器地址。
- **参数**：
  - `did`：要解析的 DID 字符串。
  - `docType`：可选的 WebSDK `DidDocType`；省略或传 `null` 时使用 `name-client` 的默认文档类型。
- **成功 data**：与 `buckyos-websdk` 的 `namelib.EncodedDocument` 一致：`{ type: "json", value: unknown }` 或 `{ type: "jwt", jwt: string }`。
