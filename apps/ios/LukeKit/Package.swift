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
    // LiveKitWebRTC: the WebRTC binary, an xcframework with Apple slices
    // alone, so the dependency is left out of the graph below and the one
    // file that imports it goes with it. LivePeer, the state machine it
    // answers, stays and is what LivePeerTests drive.
    "WebRTCPeer.swift",
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
let webRTCPackages: [Package.Dependency] = []
let webRTCProducts: [Target.Dependency] = []
#else
let excludedSources: [String] = []
let excludedTests: [String] = []
let webRTCPackages: [Package.Dependency] = [
    // The one binary LukeKit links: LiveKit's build of WebRTC, chosen over
    // stasel/WebRTC for two additions of LiveKit's fork that the watch's
    // relay (LUKE-211, H5) is expected to need and mainline libwebrtc lacks:
    // `RTCAudioRenderer` (`render(pcmBuffer:)`, added to a remote
    // `RTCAudioTrack` with `addRenderer`) taps a remote track's PCM, and
    // `RTCPeerConnectionFactory`'s
    // `initWithEncoderFactory:decoderFactory:audioDevice:` takes an
    // `id<RTCAudioDevice>` for external capture. MIT licensed; the zip is
    // 69 MB and carries ios, ios-simulator, maccatalyst, macos, tvos,
    // tvos-simulator, xros, and xros-simulator slices and no watchOS one, so
    // the watch target must never link it. Pinned to the exact release the
    // LUKE-211 spike read, because the WebRTC ABI moves with every milestone
    // and the checksum SwiftPM verifies is that release's.
    .package(url: "https://github.com/livekit/webrtc-xcframework.git", exact: "150.7871.02"),
]
let webRTCProducts: [Target.Dependency] = [
    // Linked for the phone, and for macOS so `swift test` on a Mac compiles
    // WebRTCPeer.swift against the framework's own headers; never for the
    // watch, which has no slice to link. WebRTCPeer.swift is behind
    // `#if canImport(LiveKitWebRTC)`, so a build without the framework
    // compiles everything else.
    .product(
        name: "LiveKitWebRTC",
        package: "webrtc-xcframework",
        condition: .when(platforms: [.iOS, .macOS])
    ),
]
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
    dependencies: webRTCPackages,
    targets: [
        .target(
            name: "LukeKit",
            dependencies: webRTCProducts,
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
