// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "LukeKit",
    platforms: [.iOS(.v17)],
    products: [
        .library(name: "LukeKit", targets: ["LukeKit"]),
    ],
    targets: [
        .target(
            name: "LukeKit",
            path: "Sources/LukeKit"
        ),
        .testTarget(
            name: "LukeKitTests",
            dependencies: ["LukeKit"],
            path: "Tests/LukeKitTests"
        ),
    ]
)
