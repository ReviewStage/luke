// swift-tools-version: 5.9
import PackageDescription

// Linux has no copy of the Apple frameworks these reach for, so a Swift
// toolchain alone builds everything but them and CI can compile and run the
// package on every pull request (`scripts/test-linux.sh`). A Mac builds the
// whole of it, and is the only place these compile at all. A file that imports
// AVFoundation, WatchConnectivity, UIKit, SwiftUI, Security, CryptoKit, or a
// binary framework belongs here with its own reason; nothing else does, since
// an exclusion is coverage a pull request no longer has.
#if os(Linux)
let excludedSources = [
    // CryptoKit for the S256 challenge, Security for the random verifier.
    "PKCE.swift",
    // Security: the keychain the phone and the watch hold their tokens in.
    "KeychainStore.swift",
    // Reads and writes KeychainStore, so it follows the keychain off Linux.
    "AccountSession.swift",
    // AVFoundation: the call's own player and capturer.
    "PCMAudio.swift",
    // SwiftUI and CoreGraphics: Luke's face as a shape.
    "Marks.swift",
    // Apple Foundation's Markdown AttributedString: PresentationIntent,
    // inlinePresentationIntent, and AttributedString.MarkdownParsingOptions,
    // none of which swift-corelibs-foundation carries.
    "MarkdownBlock.swift",
]
let excludedTests = [
    // CryptoKit, and its subject is excluded above.
    "PKCETests.swift",
    // Its subject is excluded above.
    "KeychainStoreTests.swift",
    // AVFoundation, and its subject is excluded above.
    "PCMAudioTests.swift",
    // Its subject is excluded above.
    "MarkdownBlockTests.swift",
]
#else
let excludedSources: [String] = []
let excludedTests: [String] = []
#endif

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
            path: "Sources/LukeKit",
            exclude: excludedSources
        ),
        .testTarget(
            name: "LukeKitTests",
            dependencies: ["LukeKit"],
            path: "Tests/LukeKitTests",
            exclude: excludedTests
        ),
    ]
)
