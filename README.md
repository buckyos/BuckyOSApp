# Tauri + React + Typescript

This template should help get you started developing with Tauri, React and Typescript in Vite.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

## Windows & MacOS:
pnpm i

pnpm run tauri dev

## Android:
pnpm run tauri android init

pnpm run tauri android dev

## Shared sources

The client uses some sources of the [buckyos](https://github.com/buckyos/buckyos) Desktop as they are (Zone API wrappers, Activity, appearance, design tokens): `@buckyos-desktop/*` is `src/frame/desktop/src/shared/*` of a buckyos checkout next to this repository (branch `main`), or of `.buckyos/` inside it, which is what CI checks out. They are referenced, never copied; change them in buckyos. The WebSDK (npm package `buckyos`) both sides import is this project's copy. Building fails with a message when no checkout is found.

Order of releases: the WebSDK is published first, then buckyos, then this repository.

## 应用图标

矢量源文件为 `src/assets/app-icon.svg`。启动页、欢迎页和关于页使用 `src/assets/app-icon.png`，桌面安装包与托盘使用 `src-tauri/icons/` 下的对应尺寸资源。

使用项目已有的 Tauri CLI 重新生成平台图标：

```bash
pnpm exec tauri icon src/assets/app-icon.svg --ios-color '#5267DB'
magick mogrify -background '#5267DB' -alpha remove -alpha off src-tauri/icons/ios/*.png
magick src-tauri/icons/android/mipmap-xxxhdpi/ic_launcher.png -resize 72x72 src-tauri/icons/android/mipmap-hdpi/ic_launcher.png
magick src-tauri/icons/android/mipmap-xxxhdpi/ic_launcher_round.png -resize 72x72 src-tauri/icons/android/mipmap-hdpi/ic_launcher_round.png
```

ImageMagick 命令移除 iOS 图标的 alpha 通道，并确保 Android hdpi 启动图为 72×72。生成后，将 `src-tauri/icons/icon.png` 同步到 `src/assets/app-icon.png`；将 `src-tauri/icons/ios/` 中的 PNG 同步到 `src-tauri/gen/apple/Assets.xcassets/AppIcon.appiconset/`；将 `src-tauri/icons/android/` 同步到 `src-tauri/gen/android/app/src/main/res/`，并将其中 `mipmap-xxxhdpi/ic_launcher.png` 同步到 `src-tauri/icons/ic_launcher.png`。iOS 和 Android 自适应图标使用蓝色背景填充透明区域。

## License

BuckyOSApp first-party code is licensed under the GNU Affero General Public License, version 3 only (`AGPL-3.0-only`), the same license as [BuckyOS](https://github.com/buckyos/buckyos); see [LICENSE](LICENSE). See [NOTICE](NOTICE) for retained notices. Third-party dependencies and bundled assets keep their own licenses; the BuckyOS WebSDK (npm package `buckyos`) stays Apache-2.0.

When distributing binaries, provide the corresponding source and build materials required by the applicable licenses.
