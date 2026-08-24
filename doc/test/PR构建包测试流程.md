# BuckyOSApp PR 构建包测试流程

本文档用于验收 PR 对应的实际构建产物。被测 App 必须来自 [pvehost.local](http://pvehost.local/)，测试期间不得用本地源码重新编译的包替代。

功能用例和完整业务主链路分别引用 [测试流程](./测试流程.md) 与 [共用账户与 OOD 生命周期](./端到端/共用账户与OOD生命周期.md)；平台安装和控制方式分别见 Android、macOS 端到端执行流程。本文档只规定构建选择、安装和版本追溯。

## 1. 输入

执行前需要明确：

- 目标 PR 编号、合并提交或期望的 BuckyOSApp commit。
- 测试平台和架构，例如 Android arm64、Windows amd64。
- 安装模式：`fresh-install` 或 `upgrade-install`，执行前必须明确指定，不得由执行者自行推断。
- 是否同时验收 OOD；如验收，明确 OOD 平台和架构。
- 测试设备和真实 SN/OOD 环境是否可用。

## 2. 选择最新可用包

打开 [pvehost.local](http://pvehost.local/) 后按以下规则选择：

1. 构建列表按时间从新到旧检查。
2. 跳过仍为 `Building`、显示 `0 packages` 或目标平台没有下载入口的构建。
3. 目标平台必须明确显示 `package(s) ready`。整个构建因其他平台失败而标记为 `Failed` 时，只要目标平台产物 ready，仍可用于该平台测试。
4. 检查 `Build From` 中的 `BuckyOSApp` 分支和 commit。该 commit 必须等于目标提交，或已确认包含目标 PR。
5. 如果最新可下载包早于目标 PR，结果是 `BLOCKED：PR 构建尚未就绪`，不能用旧包冒充该 PR 的测试结果。
6. 同一平台出现多个相同版本文件时，以构建时间较新的 ready 产物为准，并记录 Build ID。

“最新包”在本流程中专指“包含目标 PR 的最新可下载目标平台产物”，不是页面最上方的构建记录。

## 3. 下载与校验

下载后记录：

- PVE Build ID，例如 `20260812-164220`。
- 完整下载地址和文件名。
- 平台、架构、版本、文件大小和 SHA-256。
- `Build From` 中 BuckyOSApp 的分支与完整 commit。
- 页面显示的目标平台状态。

如果 App APK 与 OOD 安装包来自不同 Build ID，必须记录完整版本组合和兼容性风险。端到端验收优先使用同一构建批次中已经 ready 的 App 与 OOD 产物。macOS `.pkg` 是同时包含 BuckyOS Desktop App 与本机 OOD/BuckyOS Service 的组合包，只下载本机原生架构对应的一份组合包，不再分别选择 App 包和 OOD 包。

## 4. 安装规则

### 4.1 Android

1. 先记录设备上旧版本的版本号，并明确本轮安装模式。
2. `upgrade-install`：保留 App 数据并覆盖安装，记录原版本、目标版本和安装后版本，再执行升级冒烟。
3. `fresh-install`：卸载现有 App，确认包和 App 数据均不存在后安装下载的 APK。仅清 App 数据不能作为“全新安装”证据。
4. 安装后核对包名、版本和 ABI，确保运行的是下载的 APK。

### 4.2 Desktop

安装或解压下载的目标平台产物，核对程序版本和进程路径。不得启动本地 `tauri dev` 代替安装包。

### 4.3 macOS 组合包

1. 在目标 Mac 上执行 `uname -m`：`arm64` 选择 `arm64/aarch64` 包，`x86_64` 选择 `amd64/x86_64` 包。
2. 同时存在签名与未签名 pkg 时，PR 验收默认使用签名 pkg；无法使用签名包时停止并说明原因。
3. 安装前明确记录 `fresh-install` 或 `upgrade-install`。覆盖安装必须记录安装前 App 版本、OOD receipt 版本和目标包版本。
4. 当前完整的全新安装、App/OOD 独立检查和端到端步骤见 [macOS 端到端执行流程](./端到端/macOS执行流程.md)。
5. 一个 pkg 同时安装 App 和 OOD，不允许另外安装不同 Build ID 的 Mac App 或 OOD 覆盖其中任一组件。

## 5. 测试范围

PR 包测试至少包括：

1. 安装、首次启动和基础导航。
2. [测试流程](./测试流程.md) 的最小功能回归集。
3. 目标 PR 的改动区域和异常分支。
4. Android 身份、SN 或 OOD 相关 PR 按 [Android 端到端执行流程](./端到端/Android执行流程.md) 执行完整的[共用账户与 OOD 生命周期](./端到端/共用账户与OOD生命周期.md)，必须覆盖解绑 OOD、重置同一 OOD、重新绑定和最终重启复核，不能在首次绑定成功后提前结束。
5. macOS PR 包测试按 [macOS 端到端执行流程](./端到端/macOS执行流程.md) 执行；当前只把 `fresh-install` 定义为完整流程。
6. 按本轮明确指定的安装模式执行安装和重启持久化；macOS 当前完整执行 `fresh-install`，Android 的完整 PR 端到端默认执行 `fresh-install`，升级专项必须明确指定 `upgrade-install`。
7. 安装包运行日志与敏感信息检查。
8. Windows 和 macOS 桌面包必须执行[桌面 App 单例用例](./测试流程.md#64-windowsmacos-桌面-app-单例)；重复启动后出现第二个长期存活的主进程或主窗口时直接判定该平台 `FAIL`。

PR 包测试是产物黑盒验收，不替代 CI 中的源码单元测试和编译门禁。

## 6. 禁止事项

- 不得自行重新编译 App 后继续以 `pr-package` 名义报告。
- 不得修改 APK、可执行文件或包内配置。
- 不得把未包含目标 PR 的更新日期包当作目标 PR 包。
- 不得通过写入内部状态、替换接口或注入源码 workaround 把结果记为 clean pass。
- 外部环境 workaround 如确有必要，必须单独标记 `PASS WITH WORKAROUND` 并说明影响边界。

## 7. 结果与证据

输出到：

```text
auto_test/runs/YYYYMMDD-HHMMSS/pr-package-{pass|fail|blocked}-{summary}/
```

报告必须包含：

- `测试类型：pr-package`。
- 安装模式：`fresh-install / upgrade-install`。
- PR、目标 commit、PVE Build ID 和 Build From commit。
- 下载地址、文件名、SHA-256 和安装结果。
- 实际执行的共用测试用例编号。
- App、SN/BNS、OOD 激活、OOD 激活后健康四项独立结论。
- workaround、未执行项和剩余风险。
