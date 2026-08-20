# BuckyOSApp PR 构建包测试流程

本文档用于验收 PR 对应的实际构建产物。被测 App 必须来自 [pvehost.local](http://pvehost.local/)，测试期间不得用本地源码重新编译的包替代。

功能用例和 Android 完整操作步骤分别引用 [测试流程](./测试流程.md) 与 [Android 端到端测试流程](./安卓端到端测试流程.md)，本文档只规定构建选择、安装和版本追溯。

## 1. 输入

执行前需要明确：

- 目标 PR 编号、合并提交或期望的 BuckyOSApp commit。
- 测试平台和架构，例如 Android arm64、Windows amd64。
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

如果 App APK 与 OOD 安装包来自不同 Build ID，必须记录完整版本组合和兼容性风险。端到端验收优先使用同一构建批次中已经 ready 的 App 与 OOD 产物。

## 4. 安装规则

### 4.1 Android

1. 先记录设备上旧版本的版本号。
2. 需要验证升级时先覆盖安装，保留数据并执行升级后冒烟。
3. 需要验证全新安装时再清理 App 数据；只有覆盖安装失败或用例明确要求时才卸载。
4. 安装后核对包名、版本和 ABI，确保运行的是下载的 APK。

### 4.2 Desktop

安装或解压下载的目标平台产物，核对程序版本和进程路径。不得启动本地 `tauri dev` 代替安装包。

## 5. 测试范围

PR 包测试至少包括：

1. 安装、首次启动和基础导航。
2. [测试流程](./测试流程.md) 的最小功能回归集。
3. 目标 PR 的改动区域和异常分支。
4. Android 身份、SN 或 OOD 相关 PR 执行完整的 [Android 端到端测试流程](./安卓端到端测试流程.md)，必须覆盖解绑 OOD、重置同一 OOD、重新绑定和最终重启复核，不能在首次绑定成功后提前结束。
5. 覆盖安装、清数据启动和重启持久化。
6. 安装包运行日志与敏感信息检查。

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
- PR、目标 commit、PVE Build ID 和 Build From commit。
- 下载地址、文件名、SHA-256 和安装结果。
- 实际执行的共用测试用例编号。
- App、SN/BNS、OOD 激活、OOD 激活后健康四项独立结论。
- workaround、未执行项和剩余风险。
