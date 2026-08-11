// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "Sidecar",
    platforms: [
        .macOS(.v14),
    ],
    products: [
        .library(name: "SidecarCore", targets: ["SidecarCore"]),
    ],
    targets: [
        .target(name: "SidecarCore"),
        .testTarget(name: "SidecarCoreTests", dependencies: ["SidecarCore"]),
    ]
)
