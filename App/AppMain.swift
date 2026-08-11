import AppKit
import SidecarCore
import SwiftUI

@main
struct SidecarApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    var body: some Scene {
        WindowGroup {
            DevelopmentSurface(snapshot: .development)
                .frame(width: DevelopmentSurface.canvasSize.width, height: DevelopmentSurface.canvasSize.height)
                .preferredColorScheme(.dark)
        }
        .defaultSize(
            width: DevelopmentSurface.canvasSize.width,
            height: DevelopmentSurface.canvasSize.height
        )
        .windowResizability(.contentSize)
        .windowStyle(.hiddenTitleBar)
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        let options = LaunchOptions()
        guard let evidenceURL = options.evidenceOutputURL else { return }

        do {
            try EvidenceRenderer.render(snapshot: .development, to: evidenceURL)
            NSApplication.shared.terminate(nil)
        } catch {
            let message = "Luke evidence rendering failed: \(error)\n"
            FileHandle.standardError.write(Data(message.utf8))
            exit(EXIT_FAILURE)
        }
    }

    func applicationShouldSaveSecureApplicationState(_ app: NSApplication) -> Bool {
        false
    }

    func applicationShouldRestoreSecureApplicationState(_ app: NSApplication) -> Bool {
        false
    }
}

struct LaunchOptions: Equatable {
    let isFixtureMode: Bool
    let evidenceOutputURL: URL?

    init(
        arguments: [String] = CommandLine.arguments,
        environment: [String: String] = ProcessInfo.processInfo.environment
    ) {
        isFixtureMode = arguments.contains("--fixture") || environment["SIDECAR_FIXTURE_MODE"] == "1"

        if let flagIndex = arguments.firstIndex(of: "--render-evidence"),
            arguments.indices.contains(flagIndex + 1)
        {
            evidenceOutputURL = URL(fileURLWithPath: arguments[flagIndex + 1])
        } else {
            evidenceOutputURL = nil
        }
    }
}
