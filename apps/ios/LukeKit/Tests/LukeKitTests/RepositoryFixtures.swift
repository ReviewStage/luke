import Foundation
import XCTest

/// The synthetic JSON fixtures the TypeScript packages commit, read as the
/// same bytes: `packages/session/fixtures/ui-messages/` (one stored message
/// each), `packages/session/fixtures/conversation-view/` (a view selection's
/// input), and `packages/hosted/fixtures/reads/` (one answer of each read
/// route). Both languages decode the same files, so a shape the phone cannot
/// read is a finding about the wire rather than a second fixture. The
/// repository root is found by walking up from this file, or named by
/// `LUKE_REPO_ROOT` where the tests run from a copy.
enum RepositoryFixtures {
    static let uiMessages = "packages/session/fixtures/ui-messages"
    static let conversationView = "packages/session/fixtures/conversation-view"
    static let reads = "packages/hosted/fixtures/reads"

    static let root: URL = {
        if let named = ProcessInfo.processInfo.environment["LUKE_REPO_ROOT"] {
            return URL(fileURLWithPath: named, isDirectory: true)
        }
        var candidate = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        while candidate.path != "/" {
            let marker = candidate.appendingPathComponent(uiMessages, isDirectory: true)
            if FileManager.default.fileExists(atPath: marker.path) { return candidate }
            candidate.deleteLastPathComponent()
        }
        preconditionFailure("the repository root holds no \(uiMessages)")
    }()

    static func data(_ directory: String, _ name: String) throws -> Data {
        try Data(contentsOf: root.appendingPathComponent(directory).appendingPathComponent(name))
    }

    static func names(in directory: String) throws -> [String] {
        try FileManager.default
            .contentsOfDirectory(atPath: root.appendingPathComponent(directory).path)
            .filter { $0.hasSuffix(".json") }
            .sorted()
    }

    static func json(_ directory: String, _ name: String) throws -> [String: Any] {
        let value = try JSONSerialization.jsonObject(with: data(directory, name))
        return try XCTUnwrap(value as? [String: Any])
    }
}
