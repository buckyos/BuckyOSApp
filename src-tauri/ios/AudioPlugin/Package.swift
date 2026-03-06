// swift-tools-version:5.3

import PackageDescription

let package = Package(
  name: "AudioPlugin",
  platforms: [
    .iOS(.v13),
  ],
  products: [
    .library(
      name: "AudioPlugin",
      type: .static,
      targets: ["AudioPlugin"])
  ],
  dependencies: [
    .package(name: "Tauri", path: ".tauri/tauri-api")
  ],
  targets: [
    .target(
      name: "AudioPlugin",
      dependencies: [
        .byName(name: "Tauri")
      ],
      path: "Sources")
  ]
)
