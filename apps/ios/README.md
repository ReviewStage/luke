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
minus the ones that have no surface on a phone. A turn is opened by the talk
button or by the keyboard button beside it, which stands a composer up in the
controls' place: a typed ask is the same explicitly opened, tool-armed turn a
press is, with no microphone anywhere in it, mirroring the desktop's Ask Luke
field. The tool list is minted
server-side from `remoteRealtimeToolDefinitions()` in `packages/acts`, and
each call is validated on the phone in `LukeKit`'s `VoiceAsks` against the
roster and projects the conversation was shown before anything is sent:

| Tool | What happens on the phone |
| --- | --- |
| `send_session_message`, `run_session_control`, `add_workspace_agent`, `rename_session`, `rename_workspace`, `create_workspace` | Validated against the observed roster or projects answer, then sent to the hosted act endpoint, which re-observes and validates again |
| `open_session` | Switches to the Sessions tab and pushes the session's own screen once Luke's reply has finished |
| `show_panel` | Switches to the Sessions tab and applies the filters, sort, or search the ask named, as the filter sheet and search field would |

The voice settings sheet ends in a Debug section listing every tool the
desktop's conversation carries, marked available or not, with the reason:
read from the tool list the service minted the current call with and from
what the observed roster and projects answer offer right now.

Absent on purpose: `read_session_transcript` (no local sessions on a phone),
the issue acts (no tracker is connected here), `remember_fact` and
`forget_fact` (the phone keeps no memory; Luke's durable facts live on the
Mac), `change_app_setting`, the feedback composer, and the Updates row.

The watch app's hold-to-talk screen carries the same eight tools. The
dispatcher they run through, `dispatchVoiceToolCall` in `LukeKit`, is shared
with the phone, so a call is validated the same way — against the roster the
watch's sessions page draws and the projects answer fetched beside the mint —
and sent to the same hosted act endpoints. The two that land on a screen land
on the watch's own: `open_session` swipes to the sessions page and pushes the
session's screen once Luke's reply has finished, and `show_panel` narrows,
sorts, or searches the watch list the same way, drawing a Show All row above
the rows a narrowing leaves so a list Luke narrowed never hides a session
without saying so. The watch voice page also has the phone's Settings pattern:
a gear button opens voice and speed controls, plus the Debug tool list read
from the watch call and roster.

## Analytics

The app runs the desktop's two analytics streams on this platform's terms,
and `PRIVACY.md` at the repository root is the disclosure for both.

Counted product events go to Luke's own service at `/api/events` through
`LukeKit`'s `ProductEventSender`, a Swift transcription of the allowlist in
`packages/analytics/src/product-events.ts`; the service re-validates every
batch against the TypeScript vocabulary, so the transcription must stay a
subset of it. Session replay posts to PostHog directly from
`Luke/SessionReplay.swift` under the `PostHog` SwiftPM package.

The watch app runs the counted stream alone, through the same sender with
client `watchos` (stamped `luke-watchos` by the service). It does not link the
PostHog SDK: `posthog-ios` builds session replay only for iOS and crash
autocapture only for iOS, macOS, and tvOS, so there is no watch recording and
no watch crash reporting. Account edges are not counted on the watch, because
a sign-in there is the phone's relay and the phone already counted it.

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

## Watch

`LukeWatch` is its own client of the hosted service, not a view the iPhone
feeds. The phone hands it the account's tokens over WatchConnectivity and
nothing else; the sessions list, a session's conversation, the messages and
controls sent from the wrist, and the voice call's mint and Realtime socket
all leave the watch itself. watchOS chooses the path and prefers the phone:
the paired iPhone's connection tunneled over Bluetooth whenever the phone is
in range, the watch's own Wi-Fi or cellular only when it is not.

watchOS draws one line through that traffic. HTTP over `URLSession` is open
to every app, and every hosted read and act on the watch travels that way,
through `WatchNetwork.session`, which waits for a path to come up instead of
failing the instant none is up. A WebSocket is low-level networking, which
watchOS grants only to an audio streaming app while its audio session is
active (Apple's TN3135 and WWDC 2019 session 716), and tells anything else
that opens one that the Internet connection appears to be offline, with the
phone in the same pocket. Luke's voice call is a streamed spoken exchange, so
the watch app declares the `audio` background mode in `LukeWatch/Info.plist`
and holds its audio session active from before the Realtime socket opens
until the call closes, in `WatchVoiceAudioSession`. Two details of that grant
are watchOS's own and are easy to miss: the session must be activated with
the asynchronous `activate(options:)` call, because the synchronous
`setActive(true)` returns without error on a watch and earns nothing, and the
socket must be opened from the app's own process through Network framework,
in `WatchWebSocketChannel`, because URLSession on watchOS does its work in a
system process that never inherits the grant. The call still opens only at
the developer's press and closes on the same idle timer as before; the mode
changes what watchOS lets the socket do, not when Luke listens.
