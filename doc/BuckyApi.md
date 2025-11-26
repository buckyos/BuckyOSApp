# Bucky API 集成指南

面向希望在 iframe / 外部页面中调用宿主端能力的第三方开发者。

## 集成步骤

1. 在页面中引入脚本（需能访问本应用的静态资源，例如 `http://localhost:1420`）：
   ```html
   <script src="/bucky-api.js"></script>
   ```
   加载完成后页面会获得 `window.BuckyApi` 对象，可以通过它与宿主应用通信。

2. 在需要调用的地方使用 Promise 接口：
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

第三方页面只需根据 `code` 做分支，`message` 中提供了可展示的文案。

## 可用接口

### `BuckyApi.getPublicKey(): Promise<{ code, message?, data?: { key: string } }>`

- **说明**：返回当前激活 DID 的第一枚公钥（JSON 字符串），用于身份展示或验证。
- **参数**：无。
- **成功 data**：`{ key: string }`，内容为 JSON 字符串，可直接显示或存储。
- **典型错误码**：
  - `3` (NoKey)：当前没有公钥。
  - `4` (NoActiveDid)：没有激活的 DID。

### `BuckyApi.signWithActiveDid(message: string): Promise<{ code, message?, data?: { signature: string } }>`

- **说明**：使用本地当前激活 DID 的私钥对传入字符串进行签名，常用于 iframe 内的身份认证/授权。
- **参数**：`message` —— 待签名内容。
- **成功 data**：`{ signature: string }`，即签名后的字符串，第三方可带回到自己的后端进行验证。
- **典型错误码**：
  - `5` (NoMessage)：`message` 为空。
  - `6` (InvalidPassword)：密码错误。
  - `7` (Cancelled)：用户取消密码输入。
  - `4` (NoActiveDid)：没有激活的 DID。

> **提示**：`signWithActiveDid` 为交互式请求，可能等待用户输入较长时间。第三方页面应在等待期间禁用重复点击或展示 Loading。

## 与宿主程序的交互

一旦调用 `window.BuckyApi.xxx()`：
1. 脚本会通过 `postMessage` 将 action+palyload 发给宿主。
2. 宿主在 `iframeBridge` 中匹配 action，执行对应逻辑（可能弹窗或调用 Rust API）。
3. 宿主返回 `{ code, message?, data? }`，脚本解析后 resolve Promise。
4. 外部页面依据 `code` 判断成功与否，展示 message 或使用 data。

只要遵循以上协议，第三方页面无需关心宿主的实现细节即可安全地调用原生能力。更多接口将陆续补充，保持关注本文件即可。
