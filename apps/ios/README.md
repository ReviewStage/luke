# Luke iOS

SwiftUI Hello World for iPhone. Requires Xcode 14+ and an iOS 17 simulator.

## Build

```sh
xcodebuild \
  -project apps/ios/Luke.xcodeproj \
  -scheme Luke \
  -destination 'platform=iOS Simulator,name=iPhone 15 Pro' \
  build
```

## Test

The tests live in two places, and each has its own entry. The Luke scheme runs
the app target's suites on a simulator:

```sh
xcodebuild \
  -project apps/ios/Luke.xcodeproj \
  -scheme Luke \
  -destination 'platform=iOS Simulator,name=iPhone 15 Pro' \
  test
```

The LukeKit package's suites run through SwiftPM, with no simulator:

```sh
cd apps/ios/LukeKit && swift test
```

Both are required. They stay separate because Xcode 26's xcodebuild does not
pick up an SPM test target from this app scheme — neither as a testable
reference nor through a test plan — so a scheme entry would claim coverage the
simulator run does not deliver.

## Voice acts

The voice screen carries the same acts the desktop's conversation does,
minus the ones that have no surface on a phone. The tool list is minted
server-side from `remoteRealtimeToolDefinitions()` in `packages/acts`, and
each call is validated on the phone in `LukeKit`'s `VoiceAsks` against the
roster and projects the conversation was shown before anything is sent:

| Tool | What happens on the phone |
| --- | --- |
| `send_session_message`, `run_session_control`, `add_workspace_agent`, `rename_session`, `rename_workspace`, `create_workspace` | Validated against the observed roster or projects answer, then sent to the hosted act endpoint, which re-observes and validates again |
| `open_session` | Pushes the session's own screen once Luke's reply has finished |
| `show_panel` | Pops to the list and applies the filters, sort, or search the ask named, as the filter sheet and search field would |

The voice settings sheet ends in a Debug section listing every tool the
desktop's conversation carries, marked available or not, with the reason:
read from the tool list the service minted the current call with and from
what the observed roster and projects answer offer right now.

Absent on purpose: `read_session_transcript` (no local sessions on a phone),
the issue acts (no tracker is connected here), `remember_fact` and
`forget_fact` (the phone keeps no memory; Luke's durable facts live on the
Mac), `change_app_setting`, the feedback composer, and the Updates row.

## Analytics

The app runs the desktop's two analytics streams on this platform's terms,
and `PRIVACY.md` at the repository root is the disclosure for both.

Counted product events go to Luke's own service at `/api/events` through
`LukeKit`'s `ProductEventSender`, a Swift transcription of the allowlist in
`packages/analytics/src/product-events.ts`; the service re-validates every
batch against the TypeScript vocabulary, so the transcription must stay a
subset of it. Session replay posts to PostHog directly from
`Luke/SessionReplay.swift` under the `PostHog` SwiftPM package.

The PostHog project key rides the `POSTHOG_PROJECT_API_KEY` build setting into
`Info.plist`, empty by default — and empty means the recording client is never
configured. A distributing build injects it:

```sh
xcodebuild \
  -project apps/ios/Luke.xcodeproj \
  -scheme Luke \
  POSTHOG_PROJECT_API_KEY=phc_your_project_key \
  build
```

A DEBUG run may set `LUKE_POSTHOG_PROJECT_API_KEY` in the scheme's environment
instead, the same door the service address overrides use. XCTest runs neither
record nor count: the app detects its launch as a test host and stands both
streams down.
