# Android 端到端执行流程

本文档只定义 Android 平台如何准备 APK、设备和外部 OOD，以及如何实现公共生命周期中的平台动作。账户创建、首次绑定、删除、导入、解绑和重新绑定的业务步骤统一执行 [共用账户与 OOD 生命周期](./共用账户与OOD生命周期.md)，不在本文档重复。

## 1. 支持范围

- 测试类型：`local-dev` 或 `pr-package`，每轮只能选择一种。
- local-dev APK：按 [本地 Dev 测试流程](../本地Dev测试流程.md) 从当前代码构建。
- pr-package APK：按 [PR 构建包测试流程](../PR构建包测试流程.md) 从 PVE 选择包含目标 PR 的最新可用包。
- Android App 与 OOD 是两台设备；OOD 必须与 Android 测试设备局域网互通。

执行公共完整生命周期时，PR 包默认使用 `fresh-install`。若本轮还要求覆盖升级，必须把 `upgrade-install` 作为独立前置阶段，记录升级证据后再用同一目标 APK 执行全新安装，不能混用两种模式的结论。

执行前记录 APK 来源、commit/PVE Build ID、文件名、版本、ABI、大小和 SHA-256，以及 Android 设备序列号、型号和系统版本。

## 2. PLATFORM-PREPARE-FRESH

1. 确认本轮测试类型和安装模式。公共完整生命周期要求最终进入 `fresh-install`；如同时验证升级，先独立完成覆盖安装冒烟并保存证据。
2. 优先使用已连接实体机；没有实体机时使用 Pixel 4 XL 模拟器。
3. 卸载 `com.buckyos.buckyosapp`，确认设备上已不存在该包及其 App 数据；随后安装本轮 APK。
4. 核对包名、版本和 ABI，确认没有 DID、SN 缓存和历史 localStorage。
5. 使用 `reset-ood-bindable` 将目标 OOD 恢复为可绑定状态；报告只记录准备结果。
6. 启动 App，确认进入欢迎页。

不得用 PVE APK冒充 local-dev，也不得本地重编译后以 pr-package 名义报告。

## 3. PLATFORM-DISCOVER-OOD

1. 确认 Android 设备与目标 OOD 网络互通。
2. 授予 App 必要的本地网络权限。
3. 从 OOD 激活入口扫描局域网设备。
4. 只选择返回有效 `active_url` 的目标 OOD。
5. 点击目标后确认进入 `/web-container?embedded=1` 承载的激活页。

Android 专项断言：

- 扫描中状态和进度可见。
- 无效、超时设备不显示为可绑定目标。
- OOD 激活页留在 Android App 内。
- 安全区、系统栏和软键盘没有遮挡关键输入或确认按钮。

## 4. PLATFORM-RESTART-APP

通过 adb 或设备操作完全停止 `com.buckyos.buckyosapp` 后重新启动。不能只刷新当前 WebView 代替 App 重启。

## 5. PLATFORM-RESET-OOD

仅在公共 E2E-08 已真实解绑后执行：

1. 使用 `reset-ood-bindable` 重置同一目标 OOD。
2. 确认 OOD 恢复为可绑定状态且仍与 Android 设备网络互通。
3. 不在报告中记录重置内部命令或敏感数据。

## 6. PLATFORM-RESTART-HOST

Android 公共流程默认不要求重启外部 OOD 主机。若本轮专门验证 OOD 主机重启恢复，必须取得授权并在报告中单独记录；否则记为 `NOT RUN`。

## 7. 证据和 Android 专项

输出目录：

```text
auto_test/runs/YYYYMMDD-HHMMSS/android-e2e-{local-dev|pr-package}-{pass|fail|blocked}-{summary}/
```

优先使用可用的 Android emulator QA 能力；没有专用工具时使用 adb/UI 自动化。报告保留关键截图，不保存包含完整敏感值的 UI tree、logcat 或命令输出。

除公共 E2E 外，按 [测试流程](../测试流程.md) 补充：

- Android 安全区和普通页面键盘避让。
- 同源/跨域 iframe 键盘边界。
- App 内 WebView 容器和返回导航。
- 安装包运行日志与敏感信息检查。

平台文档与公共流程发生冲突时：包来源、设备控制和 Android UI 规则以本文为准；业务步骤和通过标准以公共流程为准。
