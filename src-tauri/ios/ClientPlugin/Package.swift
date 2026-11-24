// swift-tools-version:5.9

import PackageDescription

let package = Package(
  name: "ClientPlugin",
  platforms: [.iOS(.v17)],
  products: [
    .library(name: "ClientPlugin", type: .static, targets: ["ClientPlugin"])
  ],
  dependencies: [
    // Copied here by build.rs from the tauri crate.
    .package(name: "Tauri", path: ".tauri/tauri-api")
  ],
  targets: [
    .target(name: "ClientBridge"),
    .target(
      name: "ClientPlugin",
      dependencies: ["ClientBridge", .product(name: "Tauri", package: "Tauri")]
    ),
  ]
)
