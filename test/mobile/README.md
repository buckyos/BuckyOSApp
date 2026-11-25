# 手机容器的模拟器用例

在模拟器里的 **debug 包**上跑，iOS 和 Android 是同一套：在客户端的页面和 Zone 的页面里执行脚本（iOS 经 Web Inspector 的协议，Android 经 adb 转出来的 Chrome DevTools 协议），不改客户端。只用 Python 标准库。

iOS：

```bash
pnpm run build:ios-sim
xcrun simctl install <udid> src-tauri/gen/apple/build/arm64-sim/BuckyOS.app
xcrun simctl launch <udid> com.buckyos.buckyosapp
BUCKYOS_SIM=<udid> python3 test/mobile/container.py            # 全部
BUCKYOS_SIM=<udid> python3 test/mobile/container.py security   # 一组
```

Android（模拟器要能 `adb root`，即 google_apis 的镜像，不是 google_apis_playstore）：

```bash
pnpm tauri android build --debug --apk --target aarch64
adb -s <serial> install -r src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk
adb -s <serial> reverse tcp:443 tcp:443    # Zone 的域名解析到 127.0.0.1 时
adb -s <serial> shell am start -n com.buckyos.buckyosapp/.MainActivity
BUCKYOS_ADB=<serial> python3 test/mobile/container.py
```

前提：客户端已登录一个 Zone（缺省 `test.buckyos.io`，用 `BUCKYOS_TEST_ZONE_HOST` 改），界面是中文，装了文本编辑器；模拟器信任这个 Zone 的 CA（Android 14 起系统证书在 `/apex/com.android.conscrypt/cacerts`，要盖一层再挂进 zygote）。`crash` 会杀模拟器里的网页进程。`activation` 在本机起一个临时的 http 服务当设备。

没有自动化的（要点原生界面）：返回手势、触摸穿透、键盘、签名和麦克风对话框、选文件、全屏视频、锁屏控制、录音。
