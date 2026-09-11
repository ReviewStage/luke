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
the app target's own suites on a simulator — the ones that reach inside the app
through `@testable import Luke`, which is what `TEST_HOST` on the test target
buys:

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

A third suite needs no Xcode and runs with the rest of the repository:
`tools/ios-parity` diffs every Swift enum that transcribes a TypeScript
vocabulary against the vocabulary itself, so a value added in `packages/` and
forgotten here fails `./scripts/check.sh` rather than reaching a device as a
refusal the phone cannot name.

```sh
pnpm --filter @luke/ios-parity test
```

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

## Notifications

A briefing nobody is placed to say reaches the phone as a push notification
from the service (`apps/web/server/hosted/speech-push.ts`), carrying Luke's
words and the message's own id and nothing else; `PRIVACY.md` says so in as
many words. The phone's side is `Luke/PushNotifications.swift`, the one door
to Apple's push machinery, and `LukeKit`'s `BriefingPushTap` and
`PushEnvironment.fromProvisioningProfile`:

- **The entitlement.** `Luke/Luke.entitlements` carries `aps-environment`,
  and both app configurations sign with it. The App ID in the developer
  portal needs the Push Notifications capability, which automatic signing
  adds on the first device build. The watch signs with none: a phone
  forwards its notifications to a paired watch itself.
- **The token.** Where alerts are allowed, every signed-in launch and
  foreground calls `registerForRemoteNotifications`, and the token Apple
  hands back reaches this installation's device row through
  `DeviceRegistrar`, named to the gateway the embedded provisioning profile
  says issued it (sandbox for a development build or the simulator,
  production for TestFlight and the App Store). A permission withdrawn in
  Settings clears the token from the row on the next foreground, so no
  briefing is settled as pushed to a phone that would show nothing.
- **The tap.** The Conversation opens at the briefing the payload's message
  id names, the row lifted for a moment; where the message is not in the
  thread, the Conversation opens at its end and says so under the last row.
  A tap on a phone signed out of the account opens nothing.

The simulator receives no real push. To see one land, the service needs the
four `APNS_*` variables set, and a device build signed under the team that
holds the App ID; `xcrun simctl push` can deliver a payload file to the
simulator to exercise the tap alone.

## Voice actions

The voice screen carries the same actions the desktop's conversation does,
minus the ones that have no surface on a phone. A turn is opened by the talk
button or by the keyboard button beside it, which stands a composer up in the
controls' place: a typed ask is the same explicitly opened, tool-armed turn a
press is, with no microphone anywhere in it, mirroring the desktop's Ask Luke
field. The tool list is minted
server-side from `remoteRealtimeToolDefinitions()` in `packages/actions`, and
each call is validated on the phone in `LukeKit`'s `VoiceAsks` against the
roster and projects the conversation was shown before anything is sent:

| Tool | What happens on the phone |
| --- | --- |
| `send_session_message`, `run_session_control`, `add_workspace_agent`, `rename_session`, `rename_workspace`, `create_workspace` | Validated against the observed roster or projects answer, then sent to the hosted action endpoint, which re-observes and validates again |
| `open_session` | Switches to the Sessions tab and pushes the session's own screen once Luke's reply has finished |
| `show_panel` | Switches to the Sessions tab and applies the filters, sort, or search the ask named, as the filter sheet and search field would |

The voice settings sheet ends in a Debug section listing every tool the
desktop's conversation carries, marked available or not, with the reason:
read from the tool list the service minted the current call with and from
what the observed roster and projects answer offer right now.

Absent on purpose: `read_session_transcript` (no local sessions on a phone),
the issue actions (no tracker is connected here), `remember_fact` and
`forget_fact` (the phone keeps no memory; Luke's durable facts live on the
Mac), `change_app_setting`, the feedback composer, and the Updates row.

The watch app's hold-to-talk screen carries the same eight tools. The
dispatcher they run through, `dispatchVoiceToolCall` in `LukeKit`, is shared
with the phone, so a call is validated the same way — against the roster the
watch's sessions page draws and the projects answer fetched beside the mint —
and sent to the same hosted action endpoints. The two that land on a screen land
on the watch's own: `open_session` swipes to the sessions page and pushes the
session's screen once Luke's reply has finished, and `show_panel` narrows,
sorts, or searches the watch list the same way, drawing a Show All row above
the rows a narrowing leaves so a list Luke narrowed never hides a session
without saying so. The watch voice page also has the phone's Settings pattern:
a gear button opens voice and speed controls, plus the Debug tool list read
from the watch call and roster. The voice and speed chosen there are the
phone's own, kept equal through the settings sync described under Watch below,
so the wrist is a quick way to change them and never a second copy.

## Conversation

The Luke tab's toolbar opens the Conversation: the one long thread the
account holds, read from the service's stored messages through the
per-resource reads `packages/hosted`'s `reads-wire.ts` declares
(`/api/conversation/messages`, `/api/conversation/events`,
`/api/brain/turns`) and the change signal (`/api/changes`). It is the same
thread the Mac's Conversation tab draws, selected and grouped by turn on the
service; the phone words its rows itself.

`LukeKit` holds everything but the drawing, so the watch can read the same
thread later:

- `UIMessage.swift` decodes a stored AI SDK `UIMessage` under the metadata
  vocabulary of `@sidecar/wire` and the tool-part states of
  `@sidecar/session`, refusing what `readStoredUIMessages` refuses.
- `ActionOutputEnvelope.swift` reads an action tool's output envelope from
  `@sidecar/actions`.
- `ConversationReads.swift` decodes the four answers; `ConversationReadClient`
  fetches them, echoing each cursor back exactly as the service minted it.
- `ConversationThread` merges pages under the wire's contract: groups by turn
  id, messages replaced by `seq` (a row still being written is answered again
  on every read until it finishes), rows of a conversation no longer listed
  dropped, turns replaced by id, and the latest speech event deciding whether
  a briefing reads as unspoken. `ConversationStore` polls the change signal
  while the screen is in the foreground and reads only the resources whose
  head moved.
- `ConversationToolRow` composes an action's row from the call's arguments
  and the envelope with the phone's own wording; `ConversationTurnRows` turns a
  group into rows — text bubbles, reasoning collapsed, announcements marked
  when unspoken, actions folded under a count once a turn carries two, details
  and refused actions folded under the turn, and a turn Luke opened himself
  marked as his own judgment.

The decoders are tested against the JSON fixtures the TypeScript packages
commit — `packages/session/fixtures/ui-messages/`,
`packages/session/fixtures/conversation-view/`, and
`packages/hosted/fixtures/reads/` — read as the same bytes rather than
Swift-shaped copies, so a shape the phone cannot decode is a finding about the
wire. `tools/ios-parity` holds every enum the screen transcribes — roles,
authors, channels, observation sources, tool-part states, turn origins and
statuses, view sources and tool kinds, action outcomes, event kinds, envelope
statuses, and the session action kinds and tool names a row is drawn for —
equal to the TypeScript sets, which is what keeps the two platforms' rows
saying the same set of things while each words them itself.

Under each of Luke's messages — a reply or a briefing, the assistant rows
the service accepts a verdict on — stand two thumbs. A press is the one
write this screen makes: `MessageRatingClient` puts the verdict and this
device's id to `PUT /api/conversation/messages/{id}/rating` through the same
`authorized()` retry and holder fence every phone client runs under, the
answer is recorded locally as the rating event it made, and the control's
state is the rating the service folded onto the message, amended by any
newer `rating` event read since — this device's own, or another's — so a
verdict given on the Mac shows here and one given here shows there, and a
fresh launch reads no events from the record's beginning: the events cursor
seeds from the change signal's head like the turns'. A second press is a
second event, never an edit. The watch, which draws no control, constructs
the store without a rating client. The developer's own ask and the brain's notes to itself draw no thumbs,
since the service refuses a rating on either; the count that follows a
recorded rating carries the verdict and whether the message was a reply or a
briefing, never the message or its id.

The whole scroll carries PostHog's `postHogMask()`, the way the desktop's
Conversation subtree carries the recording library's blocking class, so the
thread's words, the sessions it names, and a refusal's reason are masked out
of the session recording.

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

`LukeKit` holds every line both apps run, and a watch file exists only where
watchOS draws or routes something differently: the credentials in
`KeychainStore`, parameterized by the service string and the accessibility
class that are the only things the two sandboxes differ on; the voice call's
audio in `PCMAudioPlayer` and `PCMAudioCapturer`, parameterized by who owns
the audio session, since on the watch that is `WatchVoiceAudioSession` for the
whole call; and Luke's own face in `FaceArt` and `LukeMark`, with only the
tab bar's UIKit rasterization left on the phone, where UIKit exists. A copy
kept in step by a "change both" comment is a copy that eventually is not, so
each of those was one file with two callers rather than two files.

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
