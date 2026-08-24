# 共用账户与 OOD 生命周期

本文档是 Android 和 macOS 端到端测试的唯一业务主链路。它定义创建账户、首次绑定 OOD、删除并导入账户、解绑、重置和重新绑定的执行顺序与通过标准，但不规定 APK/pkg 来源、安装命令、设备控制方式或 OOD 的平台重置实现。

执行前必须先选择一份平台文档：

- [Android 执行流程](./Android执行流程.md)
- [macOS 执行流程](./macOS执行流程.md)

平台文档负责完成本文使用的 `PLATFORM-*` 动作。功能异常分支、Runtime、BuckyApi、安全和持久化专项用例继续由 [共用测试用例与验收标准](../测试流程.md) 维护。

## 1. 共用输入

执行前必须记录：

- 测试平台和安装模式。
- 被测版本、目标 PR/commit 和包的 SHA-256。
- 真实 SN 环境是否可用。
- 一个未使用的 Active Code；完整值不得进入报告和截图。
- 本轮用户名，推荐 `ad-autotest-${随机6个字母}-${时间戳}`。
- 本轮统一测试密码 `111111`；报告只写 `<已设置>`。
- `doc/test/telegram-ood-credentials.local` 是否存在并包含 `TELEGRAM_BOT_API_TOKEN`、`TELEGRAM_ACCOUNT_ID`。文件受 `*.local` 忽略规则保护，不得提交或输出完整值。
- 是否允许执行平台定义的 OOD 重置动作。

完整助记词只允许在本轮执行期间临时保留，用于 E2E-07 导入；不得进入报告、截图、日志、UI tree 或持久化测试文件，测试结束后必须清理临时记录。

## 2. 结果与证据约定

每个步骤记录 `PASS / FAIL / BLOCKED / NOT RUN`。报告使用 [测试报告模板](../测试报告模板.md)，平台文档补充版本和安装证据。

截图使用带时间戳文件名：

```text
screenshots/YYYYMMDD-HHMMSS-E2E-<步骤编号>-<说明>.png
```

如果某一步失败或被阻塞：

1. 停在失败现场，不通过写内部状态、替换接口或清本地缓存伪造后续成功。
2. 记录步骤编号、实际现象、正在等待的结果、依赖的外部环境和是否可重试。
3. 后续依赖该状态的步骤标记 `BLOCKED`，已经独立完成的前序步骤保留原结论。

## 3. E2E-01 准备平台全新状态

平台动作：执行所选平台文档的 `PLATFORM-PREPARE-FRESH`。

验证：

- 被测 App 与 OOD 来源、架构和版本可追溯。
- App 没有本地 DID、Active DID、SN 缓存或上一轮 localStorage。
- OOD 已处于可绑定状态，不继承上一轮用户、Zone 或激活状态。
- 启动 App 后进入欢迎页，显示“创建账户”和“导入账户”。

通过标准：

- 平台安装和 OOD 基础健康检查通过。
- 欢迎页稳定显示。
- 保存 `E2E-01-welcome.png`。

## 4. E2E-02 生成并确认助记词

操作：

1. 从欢迎页进入创建账户说明页。
2. 检查 DID 与 SN 说明，确认当前阶段尚未要求输入密码、用户名或 Active Code。
3. 生成助记词并进入展示页。
4. 临时备份 12 个助记词。
5. 进入确认页，先验证错误顺序不能继续，再按正确顺序完成。
6. 进入绑定 SN 页面。

验证：

- 助记词为 12 个英文 BIP-39 单词。
- 错误顺序不会进入绑定 SN 页面。
- 未完成创建前不生成半成品本地 DID。

通过标准：

- 正确确认后进入绑定 SN 页面。
- 报告和截图不包含完整助记词。
- 保存 `E2E-02-create-intro.png`、`E2E-02-mnemonic-confirm.png`。

## 5. E2E-03 注册 SN 并创建账户

操作：

1. 输入非法用户名 `ad_autotest_bad`，确认本地格式校验失败。
2. 输入合法的本轮用户名和无效 Active Code `BAD_ACTIVE_CODE`，确认远端校验失败。
3. 输入本轮密码、确认密码和测试负责人提供的有效 Active Code。
4. 等待用户名和 Active Code 远端校验成功。
5. 提交创建账户。
6. 等待 SN 注册、owner key 绑定、SN 记录可见和本地 DID 创建完成。

验证：

- 非法输入不能提交，修改后可以重试。
- 本地 DID 只在 SN 主链路成功后创建。
- 创建成功页展示用户名、BuckyOS DID 和当前版本支持的钱包地址。
- 新 DID 自动成为 Active DID。

通过标准：

- 创建成功并进入 OOD 激活入口。
- 保存 `E2E-03-invalid-username.png`、`E2E-03-invalid-active-code.png`、`E2E-03-create-success.png`。

## 6. E2E-04 首次扫描并绑定 OOD

操作：

1. 确认当前 Active DID 的 OOD 状态为未绑定。
2. 执行平台文档的 `PLATFORM-DISCOVER-OOD`，扫描并选择目标 OOD。
3. 在 App 承载的 OOD 激活页继续向导。
4. 如页面要求确认身份，核对当前用户名或 DID 与 E2E-03 一致。
5. AI Provider Token 按本轮目标填写或留空。
6. 到达 Agent Jarvis Msg-Tunnel 时，从本地 `.local` 文件填写 Telegram Bot API Token 和 Account ID，不得跳过。
7. 如要求签名或密码确认，使用当前 Active DID 和本轮密码。
8. 完成最终确认并返回 App。

验证：

- 目标 OOD 由平台定义的有效地址发现，不把不可访问地址当作成功。
- 激活页由当前 App 正确承载，不错误跳转到无关应用。
- Telegram 两项配置被接受，敏感值没有进入截图或报告。
- 签名使用当前 Active DID。
- 返回后 App 显示 OOD 已绑定。

通过标准：

- 首次绑定成功，当前 DID 的 OOD 状态可刷新。
- 保存 `E2E-04-ood-scan.png`、`E2E-04-ood-bind-success.png`、`E2E-04-ood-bound.png`。

## 7. E2E-05 App 重启复核

平台动作：执行 `PLATFORM-RESTART-APP`。

验证：

- App 不返回欢迎页。
- E2E-03 创建的 DID 仍为 Active DID。
- 首页用户名、SN 状态与 `BuckyApi.getCurrentUser()` 一致。
- OOD 状态仍为已绑定。

通过标准：

- App 重启后账户与绑定状态保持。
- 保存 `E2E-05-after-app-restart.png`。

## 8. E2E-06 删除当前本地账户

操作：

1. 进入删除账户流程。
2. 在风险确认弹窗中先取消一次，确认账户与 OOD 状态不变化。
3. 再次进入并确认删除。
4. 输入本轮密码，等待删除完成。

验证：

- 取消不会删除账户。
- 删除最后一个本地 DID 后回到欢迎页。
- 删除只影响本地账户，不删除真实 SN 记录，也不使已备份助记词失效。

通过标准：

- 当前本地账户已删除，欢迎页入口可用。
- 保存 `E2E-06-delete-cancel.png`、`E2E-06-delete-welcome.png`。

## 9. E2E-07 导入同一账户

操作：

1. 从欢迎页进入导入账户。
2. 输入 E2E-02 临时保存的助记词、本轮密码和确认密码。
3. 提交并等待 BNS/SN 身份查询和本地 DID 导入完成。

验证：

- 导入页不要求输入 SN 用户名或 Active Code。
- 导入后恢复 E2E-03 的用户名，DID 自动成为 Active DID。
- `sn_status.username` 可用，不出现“当前 DID 缺少 SN 用户名”。
- OOD 已绑定状态可以从真实状态恢复，或刷新后显示为已绑定。

通过标准：

- 同一账户导入成功，用户名、DID 和 OOD 状态一致。
- 保存 `E2E-07-import-form.png`、`E2E-07-import-success.png`、`E2E-07-import-ood-bound.png`。

## 10. E2E-08 解除 OOD 绑定

操作：

1. 在已绑定状态点击解绑。
2. 先取消确认，验证状态不变化。
3. 再次解绑并确认；如要求本地认证，使用当前 Active DID。
4. 等待服务端确认解绑后再刷新本地状态。

验证：

- 取消解绑不改变状态。
- 解绑失败不会把本地 UI 或缓存错误清成未绑定。
- 成功解绑只解除当前 DID 与 OOD 的关系，不删除本地账户。
- 不调用已经移除的旧 `zone.unbind_config` 后仅靠清本地状态伪造成功。

通过标准：

- 只有服务端提供并成功执行正式解绑能力时才可标记 `PASS`。
- 当前环境没有正式解绑接口时标记 `BLOCKED`，并停止依赖解绑结果的 E2E-09。
- 保存 `E2E-08-unbind-cancel.png`；实际成功时再保存 `E2E-08-unbind-success.png`。

## 11. E2E-09 重置并重新绑定同一 OOD

前置条件：E2E-08 已真实成功。

操作：

1. 执行平台文档的 `PLATFORM-RESET-OOD`，将同一 OOD 恢复为可绑定状态。
2. 重新扫描并选择该 OOD。
3. 再次完成完整激活向导，包括 Telegram、签名和最终确认，不能点击跳过代替。
4. 返回 App 并刷新绑定状态。

验证：

- 平台重置只按经过确认的方法执行；报告记录结果，不展开敏感内部细节。
- 重置后仍能发现同一 OOD。
- 当前绑定身份是 E2E-07 导入后的 Active DID。
- 第二次 Telegram 配置和签名成功。

通过标准：

- 同一 OOD 重新绑定成功，App 再次显示已绑定。
- 平台没有安全重置能力时标记 `BLOCKED`，不得删除不明路径模拟成功。
- 保存 `E2E-09-rebind-scan.png`、`E2E-09-rebind-success.png`、`E2E-09-final-bound.png`。

## 12. E2E-10 最终重启复核

平台动作：执行 `PLATFORM-RESTART-APP`；平台文档要求主机级复核且获得授权时，再执行 `PLATFORM-RESTART-HOST`。

验证：

- App 使用 E2E-07 导入后的 Active DID。
- 用户名、DID 和 SN 状态正确。
- E2E-09 的重新绑定状态保持。
- 平台 OOD 服务在主机重启后按预期恢复。

通过标准：

- App 重启复核通过。
- 获准执行的主机重启复核通过；未获准时标记 `NOT RUN` 并列为剩余风险。
- 保存 `E2E-10-final-after-restart.png`。

## 13. 最终结论

全流程只有 E2E-01 至 E2E-10 中本轮要求的步骤全部通过时才能记为 `PASS`。任何必须步骤失败则为 `FAIL`；正式解绑接口、平台 OOD 重置能力或真实外部环境缺失导致无法继续时为 `BLOCKED`。

报告必须分别给出：

- 安装/平台准备结果。
- App 功能结果。
- SN/BNS 集成结果。
- OOD 首次绑定结果。
- 导入账户恢复结果。
- OOD 解绑与重新绑定结果。
- App/主机重启结果。
- 未执行项、workaround 和剩余风险。
