# macOS PR 组合包端到端执行流程

本文档只定义目标 Mac 上如何选择、全新安装和检查 App + OOD 组合 `.pkg`，以及如何实现公共生命周期中的平台动作。账户与 OOD 业务主链路统一执行 [共用账户与 OOD 生命周期](./共用账户与OOD生命周期.md)，不在本文档重复。

macOS 测试由运行在目标 Mac 上的 agent 执行，只使用 [pvehost.local](http://pvehost.local/) 上包含目标 PR 的本机架构包，不在测试机本地编译。

## 1. 安装模式门禁

开始下载或改动测试机前，必须明确指定并记录：

- `fresh-install`：恢复干净快照，或经明确授权后清除已有 App、OOD 程序与测试数据。
- `upgrade-install`：保留已有数据，覆盖安装并记录安装前后版本。

不得自行推断或中途切换模式。当前本文完整实现 `fresh-install`；指定 `upgrade-install` 时只记录安装前 App 版本、OOD receipt 版本、目标版本、PVE Build ID、Build From commit 和 SHA-256，然后标记 `BLOCKED：macOS 覆盖安装断言待补充`，不得改跑全新安装后记为通过。

## 2. 选择本机架构组合包

记录：

```bash
uname -m
sw_vers
```

| 本机架构 | PVE 包架构 |
| --- | --- |
| `arm64` | `arm64`，历史构建可能标为 `aarch64` |
| `x86_64` | `amd64`，历史构建可能标为 `x86_64` |

按 [PR 构建包测试流程](../PR构建包测试流程.md) 选择包含目标 PR 的最新可用 macOS pkg，并满足：

1. 使用本机原生架构；Rosetta 只能作为明确的专项测试。
2. 当前包通常命名为 `buckyos-macos-{arm64|amd64}-<version>-fogworks-signed.pkg`，历史包可能使用 `buckyos-apple-{aarch64|amd64}-<version>.pkg`。
3. 同时有签名和未签名包时默认选择签名包；签名包不可用时停止或取得明确许可。
4. Build From 中 BuckyOSApp commit 包含目标 PR；BuckyOS、cyfs-gateway commit 同时记录。
5. 一个 pkg 同时安装 `/Applications/BuckyOS.app` 和本机 OOD/BuckyOS Service，不再另装第二份 App 或 OOD 包。

下载后校验：

```bash
shasum -a 256 <pkg-path>
pkgutil --check-signature <pkg-path>
spctl -a -vv -t install <pkg-path>
pkgutil --payload-files <pkg-path>
```

## 3. PLATFORM-PREPARE-FRESH

### 3.1 前置条件

- 使用专用测试账号或允许清理数据的测试 Mac。
- 管理员权限可用。
- Docker 兼容运行环境已经启动；安装器要求 root/LaunchDaemon 上下文可以执行 Docker。
- 真实 SN、Active Code 和 Telegram 本地凭据可用。

不得在承载真实身份或生产 OOD 数据的 Mac 上执行全新安装清理。

### 3.2 恢复全新状态

优先恢复未安装 BuckyOS 的干净测试机快照。没有快照时，只有获得明确的数据删除授权后才能清理。清理前逐项解析并确认目标，禁止对未解析的 home、根目录或通配路径执行递归删除。

需要清理并验证不存在：

- `/Applications/BuckyOS.app`
- `/Library/LaunchDaemons/buckyos.service.plist`
- `/opt/buckyos` 的程序、配置、数据、存储、缓存和日志
- 当前测试用户的 BuckyOS App 数据，包括 `~/Library/Application Support/BuckyOSApp` 和 bundle id `com.buckyos.buckyosapp` 对应目录
- `system/buckyos.service` LaunchDaemon 和 BuckyOS 测试容器/残留进程
- 精确识别出的旧 BuckyOS pkg receipt

任何一项仍保留时不能把本轮标为 `fresh-install`。

### 3.3 安装与版本记录

```bash
sudo installer -pkg <pkg-path> -target /
defaults read /Applications/BuckyOS.app/Contents/Info CFBundleShortVersionString
defaults read /Applications/BuckyOS.app/Contents/Info CFBundleVersion
pkgutil --pkg-info ai.buckyos.pkg.buckyos
```

receipt id 变化时先用 `pkgutil --pkgs` 查找精确 id，并记录实际结果。

### 3.4 App 检查

```bash
test -d /Applications/BuckyOS.app
codesign --verify --deep --strict --verbose=2 /Applications/BuckyOS.app
spctl -a -vv /Applications/BuckyOS.app
open -a BuckyOS
```

要求 App 存在、签名/Gatekeeper 校验通过、首次启动进入欢迎页且不继承旧 DID 或绑定状态。

### 3.5 OOD 检查

```bash
test -x /opt/buckyos/bin/node-daemon/node_daemon
test -f /Library/LaunchDaemons/buckyos.service.plist
sudo launchctl print system/buckyos.service
curl -fsS http://127.0.0.1:3182/index.html
```

要求 LaunchDaemon 已加载、node daemon 不持续崩溃、本地激活入口可访问且 OOD 处于可绑定状态。必要时只读取并脱敏以下日志末尾：

- `/var/log/buckyos.service.out.log`
- `/var/log/buckyos.service.err.log`
- `/opt/buckyos/logs/node_daemon/`

安装器、Desktop App、OOD Service 必须分别给出结果；任一失败都不能把组合包判为通过。

## 4. PLATFORM-DISCOVER-OOD

目标 OOD 是同一 pkg 安装在同一台 Mac 上的 BuckyOS Service：

1. 确认服务除回环入口外，也能通过该 Mac 的有效局域网地址被 App 发现或访问。
2. 从 Desktop App 的 OOD 激活入口扫描并选择本机 OOD。
3. 不能把只有 `127.0.0.1` 可访问当作局域网发现通过。
4. 激活页应在 Desktop App 的 WebView/独立窗口中打开。

额外断言同一窗口 label 重复打开时复用并聚焦已有窗口，主窗口路由不被替换。

## 5. PLATFORM-RESTART-APP

完全退出 BuckyOS App 后重新打开。必须区分关闭窗口、隐藏到菜单栏/托盘和真正退出，不能只刷新 WebView 或关闭子窗口代替。

## 6. macOS App 单例检查

按[共用测试用例 6.4](../测试流程.md#64-windowsmacos-桌面-app-单例)执行，并在目标 Mac 上至少覆盖：

1. App 正常运行时再次从应用入口启动。
2. App 主窗口隐藏或最小化时再次启动。
3. 独立 WebView 子窗口存在时再次启动。
4. 使用 `open -n -a BuckyOS` 或等价方式明确发起新的 App 实例请求，并快速重复至少 3 次。

枚举 `/Applications/BuckyOS.app/Contents/MacOS/` 中主可执行文件对应的进程和 App 顶层窗口；WebKit helper、LaunchDaemon 和本机 OOD 进程不计入 App 实例数。第二次启动请求结束后只能保留原主进程和一个主窗口，原窗口应恢复并聚焦。

该项是 macOS PR 组合包的强制门禁。出现两个长期存活的 App 主进程或两个主窗口时，本轮 macOS 结果必须为 `FAIL`。

## 7. PLATFORM-RESET-OOD

仅在公共 E2E-08 已真实解绑后执行。使用经过确认的 macOS OOD 重置方法将当前 Mac 上的同一 OOD 恢复为可绑定状态，不重新安装另一份不同 Build ID 的 pkg。

当前没有经过确认的 Mac OOD 重置方法时标记 `BLOCKED`；不得通过删除不明路径或只清 App 缓存模拟成功。

## 8. PLATFORM-RESTART-HOST

在测试负责人允许时重启 Mac，登录后检查：

- `system/buckyos.service` 自动恢复。
- `http://127.0.0.1:3182/index.html` 恢复可访问。
- BuckyOS App 可重新打开。
- 公共流程要求的账户和 OOD 状态保持。

未获准重启时标记 `NOT RUN` 并列为剩余风险。

## 9. 证据和 macOS 专项

输出目录：

```text
auto_test/runs/YYYYMMDD-HHMMSS/macos-pr-fresh-{pass|fail|blocked}-{summary}/
```

报告使用 [测试报告模板](../测试报告模板.md)，并填写 macOS 组合包安装检查。除公共 E2E 外，补充：

- Mac 型号、macOS 版本、原生架构和测试用户类型。
- pkg 签名主体、版本、大小、SHA-256 和三个仓库的 Build From commit。
- 干净快照或经授权清理的全新状态证明。
- App、OOD、LaunchDaemon、WebView/独立窗口和主机重启结果。
- App 单例测试的启动前后主 PID、窗口数量、重复启动方式和聚焦结果。

平台文档与公共流程发生冲突时：包选择、系统安装和 macOS 服务规则以本文为准；业务步骤和通过标准以公共流程为准。
