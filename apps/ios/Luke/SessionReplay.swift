import Foundation
import PostHog

/// The one analytics client this app runs, posting to PostHog directly — the
/// desktop renderer's `session-replay.ts` rebuilt at the app layer, keeping
/// its posture. Recording starts at the first paint of an ordinary launch,
/// before any account exists, because the launch is where a first run goes
/// wrong and a recording that waited for a sign-in never saw it. A sign-in
/// joins the already-running anonymous session to the person, by the same
/// opaque account id the counted events resolve to server-side, which is what
/// lets an account deletion erase these recordings; a session that never
/// reaches a sign-in stays anonymous and can be erased with no account.
/// Signing out drops the person and leaves an anonymous recording running,
/// the way the launch before the sign-in was.
///
/// Everything this app draws travels in a recording — session titles,
/// branches, recaps, error lines, the account's own name and address — and
/// what is typed into a field is withheld by the library's default masking
/// rather than a posture this app keeps. Nothing here is validated by the
/// counted events' allowlist, which never covered this stream on any
/// platform. There is no user-facing switch: an empty project key is the kill
/// switch, never a fallback project, and `PRIVACY.md` is the whole of the
/// disclosure. Widening what this client may capture is a product decision,
/// not an implementation detail.
enum SessionReplay {
    /// The same ingestion host the desktop names — the SDK's own default,
    /// held here so a library upgrade cannot move it quietly.
    private static let host = "https://us.i.posthog.com"

    /// The key the build carried, or empty. A packaged build reads what the
    /// `POSTHOG_PROJECT_API_KEY` build setting resolved to in `Info.plist`; a
    /// development run may hand one in through the environment instead, the
    /// same door the service addresses open through.
    private static var projectKey: String {
        #if DEBUG
        if let override = ProcessInfo.processInfo.environment["LUKE_POSTHOG_PROJECT_API_KEY"] {
            return override.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        #endif
        let carried = Bundle.main.object(forInfoDictionaryKey: "LukePostHogProjectAPIKey") as? String
        return carried?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    }

    /// Configured as the library ships rather than hardened, like the
    /// desktop's client; what is set by hand is each parity the desktop gets
    /// from `posthog-js` defaults but this SDK leaves opt-in.
    static func start() {
        let key = projectKey
        guard !key.isEmpty else { return }
        let config = PostHogConfig(projectToken: key, host: host)
        config.sessionReplay = true
        // Wireframe capture cannot see SwiftUI content; screenshots are how
        // this SDK records a SwiftUI app at all.
        config.sessionReplayConfig.screenshotMode = true
        // `captureElementInteractions` stays off, deliberately: it is not the
        // desktop's click autocapture. This SDK's element interactions copy a
        // text control's live contents on end-of-edit, skipping only secure
        // fields — a composed message or opening task would travel as typed —
        // where the desktop's autocapture names pressed controls and never an
        // input's value. An event stream that carries typed text has no place
        // under a disclosure that says typed text is withheld.
        // The desktop's `capture_exceptions: true`: a crash is sent as an
        // exception event on the next launch.
        config.errorTrackingConfig.autoCapture = true
        // The desktop's `person_profiles: "always"`, so a launch that never
        // reaches a sign-in still files as a person a recording can hang off.
        config.personProfiles = .always
        PostHogSDK.shared.setup(config)
    }

    /// Joins the running anonymous session to the account, so its recordings
    /// file with that account's counts and are erased with them.
    static func identify(accountId: String) {
        PostHogSDK.shared.identify(accountId)
    }

    /// The sign-out edge: the person is dropped and a fresh anonymous
    /// session keeps recording, the way the launch before the sign-in was.
    static func resetPerson() {
        PostHogSDK.shared.reset()
    }
}
