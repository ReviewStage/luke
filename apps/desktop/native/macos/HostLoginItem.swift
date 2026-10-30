import Darwin
import Foundation
import ServiceManagement

/// This Mac's `luke-host` command, inside the app at `Contents/MacOS/luke-host`:
/// the login item that runs Luke's host daemon as the member, at login,
/// whether or not the app is open, and the way the app registers it.
///
/// `register`, `unregister`, and `status` act on the login item through
/// `SMAppService`, which reads its launchd job from the app's own
/// `Contents/Library/LaunchAgents/dev.reviewstage.luke.host.plist`; each
/// prints where it then stands as one word on stdout (`HostLoginItemStatus`),
/// which the main process reads (`src/main/native/host-login-item.ts`).
/// Note that it lives in `Contents/MacOS` rather than beside the other
/// helpers in `Resources`, because that is where `Bundle.main` is the app,
/// which `SMAppService` registers the job for.
///
/// `service` is what the job runs: the daemon's `run`, with its output
/// appended to `~/Library/Logs/Luke/luke-host.log`. Every other command is
/// the daemon's own (`version`, `run`), run in place on the Node
/// the app carries (`Resources/luke-host/node/bin/node`) with its bundle
/// (`Resources/luke-host/lib/luke-host.mjs`): the same process, so launchd's
/// stop and its restart after a crash reach the daemon itself.
///
/// `luke-host register | unregister | status | service | <daemon command>`.
/// Where it cannot do what it was asked it says why on stderr and exits 1;
/// where the daemon cannot start, 126, as a shell does.

/// The job's plist, under the app's `Contents/Library/LaunchAgents`.
private let PLIST_NAME = "dev.reviewstage.luke.host.plist"

/// The log the job's output is appended to, under the member's home, and how large it grows before it is set aside once.
private let LOG_FOLDER = "Library/Logs/Luke"
private let LOG_FILE = "luke-host.log"
private let LOG_LIMIT: UInt64 = 10 * 1024 * 1024

private let FAILED: Int32 = 1
private let CANNOT_EXECUTE: Int32 = 126

/// Where the login item stands, as `status` and the acts print it.
private enum HostLoginItemStatus: String {
    case enabled = "enabled"
    case notRegistered = "not-registered"
    case requiresApproval = "requires-approval"
    case notFound = "not-found"
}

private func fail(_ message: String, _ code: Int32 = FAILED) -> Never {
    fputs("luke-host: \(message)\n", stderr)
    exit(code)
}

private func statusOf(_ service: SMAppService) -> HostLoginItemStatus {
    switch service.status {
    case .enabled: return .enabled
    case .requiresApproval: return .requiresApproval
    case .notFound: return .notFound
    default: return .notRegistered
    }
}

/// The login item asked to stand as the act given, and where it then stands.
private func act(_ command: String) -> Never {
    let service = SMAppService.agent(plistName: PLIST_NAME)
    do {
        switch command {
        case "register":
            // Note that a job already registered is left as it is, since registering it again would restart nothing and may refuse.
            if service.status != .enabled { try service.register() }
        case "unregister":
            if service.status != .notRegistered { try service.unregister() }
        default:
            break
        }
    } catch {
        fail("could not \(command) the login item: \(error.localizedDescription)")
    }
    print(statusOf(service).rawValue)
    exit(0)
}

/// This executable's own path, its links resolved: `Contents/MacOS/luke-host`.
private func ownPath() -> URL {
    var size: UInt32 = 0
    _ = _NSGetExecutablePath(nil, &size)
    var buffer = [CChar](repeating: 0, count: Int(size))
    guard _NSGetExecutablePath(&buffer, &size) == 0 else { fail("could not find itself", CANNOT_EXECUTE) }
    return URL(fileURLWithPath: String(cString: buffer)).resolvingSymlinksInPath()
}

/// The member's home, from their account rather than the environment, which launchd may hand without it.
private func home() -> String {
    guard let entry = getpwuid(getuid()), let directory = entry.pointee.pw_dir else {
        fail("could not read the home of uid \(getuid())", CANNOT_EXECUTE)
    }
    return String(cString: directory)
}

/// Stdout and stderr appended to the log, the last one set aside once it grew past its limit.
private func logToFile(home: String) {
    let folder = URL(fileURLWithPath: home).appendingPathComponent(LOG_FOLDER)
    try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    let log = folder.appendingPathComponent(LOG_FILE)
    let attributes = try? FileManager.default.attributesOfItem(atPath: log.path)
    let size = (attributes?[.size] as? NSNumber)?.uint64Value ?? 0
    if size > LOG_LIMIT {
        let previous = folder.appendingPathComponent("\(LOG_FILE).1")
        try? FileManager.default.removeItem(at: previous)
        try? FileManager.default.moveItem(at: log, to: previous)
    }
    let descriptor = open(log.path, O_WRONLY | O_CREAT | O_APPEND, 0o600)
    guard descriptor >= 0 else { return }
    dup2(descriptor, STDOUT_FILENO)
    dup2(descriptor, STDERR_FILENO)
    close(descriptor)
}

/// The daemon's command given, run in place on the Node the app carries.
private func daemon(_ arguments: [String]) -> Never {
    let release = ownPath()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .appendingPathComponent("Resources/luke-host")
    let node = release.appendingPathComponent("node/bin/node").path
    let bundle = release.appendingPathComponent("lib/luke-host.mjs").path
    let memberHome = home()
    // Note that HOME is set from the member's account where launchd handed none, since the daemon's state is under it.
    if getenv("HOME") == nil { setenv("HOME", memberHome, 1) }
    var command = arguments
    if command.first == "service" {
        logToFile(home: memberHome)
        command[0] = "run"
    }
    var argv: [UnsafeMutablePointer<CChar>?] = ([node, bundle] + command).map { strdup($0) }
    argv.append(nil)
    execv(node, &argv)
    fail("could not start \(node): \(String(cString: strerror(errno)))", CANNOT_EXECUTE)
}

@main
enum HostLoginItem {
    static func main() {
        let arguments = Array(CommandLine.arguments.dropFirst())
        guard let command = arguments.first else {
            fail("usage: luke-host register | unregister | status | service | version")
        }
        switch command {
        case "register", "unregister", "status":
            act(command)
        default:
            daemon(arguments)
        }
    }
}
