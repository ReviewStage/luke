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

## TestFlight

The iPhone app and the Watch app inside it ship as one archive, and the
project keeps everything the archive needs that does not name a team:

- **One version for both apps.** `MARKETING_VERSION` and
  `CURRENT_PROJECT_VERSION` are set once, on the project, and inherited by
  every target, because watchOS refuses an embedded Watch app whose version
  differs from its companion's. The marketing version is the phone's own,
  independent of the desktop's, and is bumped by hand in the project. The
  build number checked in is `1` and is meant to be overridden at archive time,
  since App Store Connect refuses a build number it has already seen under
  the same version, and `ExportOptions.plist` tells it not to rewrite the one
  the archive carries.
- **Export compliance answered in the build.** Both apps set
  `ITSAppUsesNonExemptEncryption` to `NO`: they use only TLS through the
  system's own networking, which is exempt, and without the key every upload
  waits on the same question in App Store Connect before anyone can install
  it.
- **A privacy manifest in each app.** `Luke/PrivacyInfo.xcprivacy` and
  `LukeWatch/PrivacyInfo.xcprivacy` declare the required-reason APIs the apps
  and `LukeKit` call, and `ios-project.test.mjs` holds the
  declarations equal to what the sources actually call.

What the archive still needs from outside the tree is the team: the
`DEVELOPMENT_TEAM` in the project must be the team that holds the App Store
Connect record for `dev.tryluke.ios`, and the upload is authorized by an App
Store Connect API key of that team with the App Manager role, passed on the
command line and never committed. With Xcode 26 selected, from the repository
root:

```sh
xcodebuild \
  -project apps/ios/Luke.xcodeproj \
  -scheme Luke \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath artifacts/ios/Luke.xcarchive \
  -allowProvisioningUpdates \
  -authenticationKeyPath /path/to/AuthKey_KEYID.p8 \
  -authenticationKeyID KEYID \
  -authenticationKeyIssuerID ISSUER_UUID \
  CURRENT_PROJECT_VERSION=42 \
  POSTHOG_PROJECT_API_KEY=phc_your_project_key \
  archive

xcodebuild -exportArchive \
  -archivePath artifacts/ios/Luke.xcarchive \
  -exportOptionsPlist apps/ios/ExportOptions.plist \
  -exportPath artifacts/ios/export \
  -allowProvisioningUpdates \
  -authenticationKeyPath /path/to/AuthKey_KEYID.p8 \
  -authenticationKeyID KEYID \
  -authenticationKeyIssuerID ISSUER_UUID
```

The first command builds and signs the archive, creating the distribution
certificate and profiles through the API key if the team has none yet. The
second signs it for App Store Connect and uploads it. Once App Store Connect
finishes processing, the build is offered to internal testers at once and to
external groups after Beta App Review. The Watch app installs on a paired
watch with the iPhone build; it needs no record or upload of its own.

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
from the watch call and roster. The voice and speed chosen there are the
phone's own, kept equal through the settings sync described under Watch below,
so the wrist is a quick way to change them and never a second copy.

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
feeds. The phone hands it the account's tokens over WatchConnectivity, and the
two exchange one more thing over the same channel, described next; the
sessions list, a session's conversation, the messages and controls sent from
the wrist, and the voice call's mint and Realtime socket all leave the watch
itself. watchOS chooses the path and prefers the phone:
the paired iPhone's connection tunneled over Bluetooth whenever the phone is
in range, the watch's own Wi-Fi or cellular only when it is not.

The settings the two apps both hold — the voice and speed the next mint asks
for, and the New Workspace choices remembered per provider — are kept equal
through WatchConnectivity's application context, in `DeviceSettingsSync` in
`LukeKit` with `PhoneSessionRelay` and `WatchConnectivityReceiver` as its two
ends. Each app keeps reading and writing its own UserDefaults keys; the sync
follows those keys, sends one whole snapshot on every local change and at
activation, and applies an arriving snapshot only when it is newer than the
last change made on the receiving device, so a choice made while the pair was
apart is never undone by the other device's older copy. Settings changed before
a device ever synced carry no stamp, so those copies are ranked by role
instead, the phone's over the watch's, and both lose to any change made once
syncing. The application
context is the right channel because it holds only the latest snapshot,
delivers it whenever the pair next connects, and keeps the last one received
across a relaunch. Nothing in it is account data: no token, key, or anything
a provider wrote travels this way, and it leaves neither device.

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
