# iOS 容器的模拟器用例

在模拟器里的 **debug 包**上跑：经 Web Inspector 的协议在客户端的页面和 Zone 的页面里执行脚本，不改客户端。只用 Python 标准库。

```bash
pnpm run build:ios-sim
xcrun simctl install <udid> src-tauri/gen/apple/build/arm64-sim/BuckyOS.app
xcrun simctl launch <udid> com.buckyos.buckyosapp
BUCKYOS_SIM=<udid> python3 test/ios/container.py            # 全部
BUCKYOS_SIM=<udid> python3 test/ios/container.py security   # 一组
```

前提：客户端已登录一个 Zone（缺省 `test.buckyos.io`，用 `BUCKYOS_TEST_ZONE_HOST` 改），界面是中文，装了文本编辑器；模拟器信任这个 Zone 的 CA。`crash` 会杀模拟器里的网页进程。`activation` 在本机起一个临时的 http 服务当设备。

没有自动化的（要点原生界面）：返回手势、触摸穿透、键盘、签名和麦克风对话框、选文件、全屏视频、锁屏控制、录音。
