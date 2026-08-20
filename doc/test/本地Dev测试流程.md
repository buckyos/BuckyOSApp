# BuckyOSApp 本地 Dev 测试流程

本文档用于验证当前工作区代码。被测版本必须由当前代码直接构建，目标是尽快发现编译、单元测试、平台集成和改动区域回归问题。

功能用例和 Android 完整操作步骤分别引用 [测试流程](./测试流程.md) 与 [Android 端到端测试流程](./安卓端到端测试流程.md)，本文档不复制这些步骤。

## 1. 适用范围

- 开发过程中验证尚未提交或尚未进入 PR 构建的改动。
- 修复缺陷后执行针对性回归。
- 调试 Android、Windows、Tauri、WebView、SN 或 OOD 集成问题。
- 在提交 PR 前执行本地质量门禁。

本流程允许使用 DevTools、调试日志和开发配置帮助定位问题，但所有 workaround 必须写入报告；使用 workaround 得到的结果不能记为无条件通过。

## 2. 版本与环境记录

构建前记录：

- 当前分支和 Git commit。
- `git status --short`，明确工作区是否 dirty。
- Node、包管理器、Rust、Tauri CLI 和目标平台版本。
- 实际构建命令。
- Android 设备序列号、型号、系统版本和 ABI，或桌面系统版本。

本地 Dev 测试不得从 `pvehost.local` 下载 App 包作为被测版本。

## 3. 构建 Dev 版本

### 3.1 前端和源码门禁

按改动范围执行：

1. 前端单元测试：`npm test`。
2. TypeScript 与前端构建：`npm run build`。
3. Rust 单元测试：在 `src-tauri` 下执行 `cargo test`。
4. 任一命令因测试基础设施或本机依赖无法执行时，报告为 `BLOCKED`，并区分产品失败与环境失败。

### 3.2 Windows/Desktop

- 交互调试默认使用 `npm run tauri dev`。
- 需要验证独立可执行文件或安装行为时，再构建对应 Dev/debug 产物，并记录产物路径。

### 3.3 Android

- 交互调试可使用 `npm run tauri android dev`。
- 需要安装并重复执行 UI 流程时，使用当前代码构建 debug APK，例如：

  ```text
  npm run tauri -- android build --debug --apk
  ```

- 报告记录 APK 路径、文件大小和 SHA-256。
- 先尝试覆盖安装；需要验证全新状态时清理 App 数据。卸载会改变升级测试语义，必须在报告中注明。

构建失败直接判定本地 Dev 测试失败，不得改用 PVE 包继续冒充当前代码测试。

## 4. 测试范围

每轮至少执行：

1. 源码门禁中与当前平台相关的命令。
2. 清理数据后的启动冒烟。
3. 本次改动直接影响的功能和异常分支。
4. 相关持久化、日志和敏感信息检查。
5. App 重启后的状态复核。

以下改动需要追加 [Android 端到端测试流程](./安卓端到端测试流程.md) 中相关阶段或全流程：

- DID 创建、导入、删除、备份或 Active DID 切换。
- SN 注册、BNS 查询、用户名或 Active Code 处理。
- OOD 扫描、绑定、解绑或绑定状态缓存；此类改动必须继续覆盖解绑后重置同一 OOD、重新绑定和最终重启复核。
- WebView、iframe bridge、签名弹窗或移动端路由。

与上述流程无关的小改动不要求每轮消耗真实 Active Code 或重置真实 OOD，但剩余风险必须写入报告。

## 5. 结果与证据

输出到：

```text
auto_test/runs/YYYYMMDD-HHMMSS/local-dev-{pass|fail|blocked}-{summary}/
```

报告必须包含：

- `测试类型：local-dev`。
- 分支、commit 和 dirty 状态。
- 构建命令、构建结果和产物 SHA-256。
- 执行的共用测试用例编号。
- 调试开关、开发配置和 workaround。
- `PASS / FAIL / BLOCKED / NOT RUN` 结果及证据路径。
