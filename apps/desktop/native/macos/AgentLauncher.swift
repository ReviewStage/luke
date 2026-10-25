import Darwin

/// Starts a local agent's runner as a process macOS holds responsible for
/// itself rather than for Luke.
///
/// macOS charges a child's privacy decisions to the app that started it: a
/// runner Luke spawned directly would reach the microphone and Apple Events
/// under Luke's own grants, and so would every command its agent runs. This
/// helper disclaims that responsibility and then becomes the program it is
/// given, in place, through `posix_spawn` with `POSIX_SPAWN_SETEXEC`: the
/// same process, so its id, its process group, its stdin, and its
/// environment are the ones Luke started it with, and Luke's stop still
/// ends the whole group. The agent then asks the developer for anything
/// private on its own account, as any program run from a terminal does.
///
/// `luke-agent-launcher <program> [arguments...]`. It never returns where the
/// program starts; where it cannot, it says why on stderr and exits 126, as a
/// shell does for a command it cannot execute.

/// `responsibility_spawnattrs_setdisclaim`, which libquarantine exports and
/// no public header declares: the attribute Terminal and other launchers set
/// so the program they start answers for itself.
@_silgen_name("responsibility_spawnattrs_setdisclaim")
private func responsibilitySpawnattrsSetdisclaim(
    _ attributes: UnsafeMutablePointer<posix_spawnattr_t?>,
    _ disclaim: Int32
) -> Int32

private let CANNOT_EXECUTE: Int32 = 126

private func fail(_ message: String) -> Never {
    fputs("luke-agent-launcher: \(message)\n", stderr)
    exit(CANNOT_EXECUTE)
}

@main
enum AgentLauncher {
    static func main() {
        let arguments = CommandLine.arguments
        guard arguments.count >= 2 else { fail("usage: luke-agent-launcher <program> [arguments...]") }
        var attributes: posix_spawnattr_t?
        guard posix_spawnattr_init(&attributes) == 0 else { fail("could not prepare the spawn") }
        guard responsibilitySpawnattrsSetdisclaim(&attributes, 1) == 0 else {
            fail("could not disclaim responsibility")
        }
        guard posix_spawnattr_setflags(&attributes, Int16(POSIX_SPAWN_SETEXEC)) == 0 else {
            fail("could not ask to start in place")
        }
        let program = arguments[1]
        var argv: [UnsafeMutablePointer<CChar>?] = arguments.dropFirst().map { strdup($0) }
        argv.append(nil)
        let status = posix_spawn(nil, program, nil, &attributes, argv, environ)
        fail("could not start \(program): \(String(cString: strerror(status)))")
    }
}
