// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "LukeKit",
    // macOS 14 is the Observation framework's floor (@Observable in
    // AccountSession and VaultStore); it exists so `swift test` runs on a Mac,
    // not because any app target builds the package for macOS.
    // watchOS 10 is the minimum that ships @Observable and the Keychain APIs
    // LukeKit uses; the watch app target sets its own deployment floor.
    platforms: [.iOS(.v17), .macOS(.v14), .watchOS(.v10)],
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
