# Luke iOS

Requires Xcode 14+ and an iOS 17 simulator.

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

CI runs the LukeKit suites too, on Linux, where there is no Xcode and no
simulator: the package's one dependency is the WebRTC binary, left out of the
graph on Linux, so everything in it that is neither a drawing, an Apple
framework, nor that binary's one adaptor compiles and runs on a Swift toolchain
alone.

```sh
./apps/ios/LukeKit/scripts/test-linux.sh
```

All the script adds to `swift test` is the pinned toolchain — Swift 6.3.1,
fetched into `~/.cache/luke/` where none is on the PATH — and the suites below.
What Linux leaves out is stated where SwiftPM already reads it, in
`Package.swift`'s own `#if os(Linux)`, so a plain `swift test` on a Linux host
builds the same thing the job does, and a Mac still builds the whole package.

Two things are left out, for two different reasons:

- The files Linux cannot compile, excluded in `Package.swift` with a reason
  each: the keychain and the PKCE challenge (Security, CryptoKit), the call's
  audio (AVFoundation), Luke's face (SwiftUI), Markdown rendering (Apple
  Foundation's `AttributedString` Markdown), the account session that reads the
  keychain, the WebRTC adaptor (the binary has Apple slices alone), and the
  suites over those. A new file importing one of those, or WatchConnectivity,
  UIKit, or a binary framework, belongs there. An exclusion
  is coverage the job no longer has, so a file lands there only when Linux
  cannot compile it at all.
- The suites Linux compiles but cannot answer for, skipped by the script at the
  run rather than excluded from the build, so the compiler still checks them on
  every pull request. There is one: `DeviceSettingsSyncTests`, because
  swift-corelibs-foundation's `UserDefaults` posts no `didChangeNotification`,
  so the sync's local-change relay publishes nothing there and half its cases
  fail on an empty relay rather than on anything the phone does (LUKE-162). A
  Mac runs that suite.

One thing to know before writing a test here: a test whose subject is
`@MainActor` carries `@MainActor` on the test method and is `async`, never on
the `XCTestCase` class. Linux's XCTest dispatches a test through a `() -> ()`
signature it cannot cast an isolated one to, and a class-level attribute traps
the whole run before its first assertion.

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
  SENTRY_DSN=https://public@example.ingest.sentry.io/1 \
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
watch with the iPhone build; it needs no record or upload of its own. The
same archive is where the phone and watch dSYMs come from, and symbol upload
to Sentry is still an operator step rather than a checked-in build phase,
because the Sentry org, project, and auth token are deployment-specific.

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
- **The permission.** The system's dialog is asked at the app's first
  launch, over the sign-in card and before any account (the phone runs no
  introduction, so nothing spoken is interrupted); the system remembers the
  answer, and later launches pass through without one.
- **The token.** Where alerts are allowed, every launch and foreground calls
  `registerForRemoteNotifications`; the token Apple hands back is held by
  `DeviceRegistrar` until a sign-in lands and then reaches this
  installation's device row, named to the gateway the embedded provisioning profile
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

## Voice transport

`LukeKit` links one binary, LiveKit's build of WebRTC
(`livekit/webrtc-xcframework`, pinned to an exact release in
`LukeKit/Package.swift`, with the reasons for the fork and the pin in the
manifest's comment), and links it for the phone alone: the framework has no
watchOS slice, so the watch target never reaches it, which
`ios-project.test.mjs` holds by checking the manifest's platform condition and
that `WebRTCPeer.swift` is the one file that imports it, behind
`#if canImport(LiveKitWebRTC)`. The framework's own privacy manifest declares
the required-reason APIs it calls (system boot time and file timestamps);
the app manifests declare only what the app and `LukeKit` sources call.

`LivePeer` is the phone's counterpart of the desktop's `live-peer.ts` and the
peer half of its `live-call.ts`: a GPT Live WebRTC peer built in the guide's
order (the microphone's track on the one sending line, the `oai-events` data
channel created before the offer, ICE gathered under a bound, the offer
handed to whoever creates the session, the answer applied) and driven through
the only events an untrusted peer may send, the microphone switch and the
hang-up. Press-to-talk enables and disables the one microphone track, never
swapping it: a disabled track is encoded as silence and keeps the model's
input timeline running. Capture and playback are the framework's own audio
device module. The peer reads its own lifecycle and acknowledgments off the
channel and hands every event the device is shown, decoded by
`LiveEvents.swift` under the grammar `packages/live` declares, to whoever
draws the captions. Its seams (the connection, the microphone, the session
creator) are injected, so `LivePeerTests` drive offer, answer, track
toggling, and close through fakes with no device and no binary, on Linux as
on a Mac; `WebRTCPeerFactory` answers the same seams from the framework on a
phone. `tools/ios-parity` holds the event types, close reasons, statuses, and
transport states the peer transcribes equal to the TypeScript sets. The voice
screen drives the peer through `LiveCall`, described under Voice screen.

## Voice screen

The phone's voice screen (`Luke/VoiceView.swift`) is a WebRTC peer with
captions, on the desktop's terms, driven by `LukeKit`'s `LiveCall`: the
policy `live-call.ts` and `LiveVoiceOrchestrator` keep between them on the
Mac, over `LivePeer` and `HostedVoiceSessionClient`. A press mints nothing:
it opens the peer, sends `session.create` over the sessions socket with the
account's synced voice and an empty seed, applies the answer, and unmutes for
exactly as long as the press lasts, or until the next tap after a quick first
one. The service's exchange attaches by build and the hosted brain answers
every ask; the phone sends no context and no instruction text, and no tool
call reaches it. Both speakers' lines are written by the voice writer and
arrive through the Conversation reads the phone already runs, so a spoken
exchange on the phone appears in the Conversation on the phone and on a Mac
signed into the same account. What the screen draws is both speakers'
captions off the data channel's transcript deltas, grouped on the desktop's
gap (`LiveCaptions`, the ledger's `UTTERANCE_GAP_MS`, held equal by
`tools/ios-parity`; the settle margin the phone still waits after it is the
phone's own), rows stable from the moment they open; they stand only while the
call does.

- **Stop and idle.** The stop control, drawn while Luke speaks, sends the
  service's `session.stop` and mutes; the service intercepts the frame and
  turns it into the instruction on its own sideband. Idle is the peer's own
  five-minute window, reported as `session.activity` and taken back on the
  next word; the service decides the close.
- **Speaking.** Luke counts as speaking from his own words arriving on the
  channel, held through his pauses for the desktop's hangover; the phone reads
  no level off his track yet, so the status follows the captions rather than
  the audio.
- **The hang-up.** Leaving the screen or changing the voice sends
  `session.close` over the sessions socket, the one Live client event the
  route forwards from a device, and the peer tears itself down on the
  `session.closed` the session answers on the data channel. The channel
  carries only the microphone switch, and the peer's own close where the
  service's never came back inside the guide's bound or no socket stands to
  carry it.
- **Refusals.** A 401 renews the bearer once through `AuthorizedCall`'s
  rule. No account behind the bearer, a spent allowance, and an unavailable
  service show the desktop's own lines ("Voice is off: sign in to turn it
  on."; "Voice is temporarily unavailable. Try again later."), a quota
  refusal with the allowance where the service said it; every other refusal
  shows the peer's word, "Luke could not open a voice session."
- **Counted.** `voice:call_start` with `session_source: hosted` when
  `session.created` lands, as the desktop counts it.
- **Settings.** The voice, chosen from every Live voice (`LIVE_VOICE`) and
  synced with the account and the watch as before, and a reset. The Live model
  has no speed, so the slider went with the move, and the Debug tool list
  went with the tools.

Gone with the move, by ruling (LUKE-212) or by the route's rule: the
composer and the keyboard button (Luke is voice only on every device), the
phone-side tool dispatch, and the two device-local tools the phone had,
`open_session` and `show_panel`, which have no service counterpart: Luke can
no longer open a session's screen or narrow the list from a spoken ask on the
phone. The legacy Realtime path itself — the remote mint's client, the
Realtime session, the on-device tool dispatch and its validation, the
in-memory voice thread, the context items, and the Realtime voice and pace
settings — is deleted from `LukeKit` (LUKE-219); the service's remote mint
went with it, and the account no longer stores a pace.

## Voice actions

Neither device dispatches a tool: on the hosted exchange the service decides
every action, the phone sends only the microphone switch, the stop, the idle
report, and the hang-up, and no tool call reaches the wrist either (its call
is described under Watch below).

## Voice service socket

The phone's half of the desktop's hosted voice architecture (LUKE-210) lives
in `LukeKit`; the phone's voice screen runs on it through `LiveCall`, and
the watch through `WatchVoiceSessionModel` over the audio route described at
the end of this section. The piece here is the sessions socket client, the
phone's `HostedLiveSessionSource`
(`packages/voice/src/live-session-source.ts`), speaking the vocabulary
`packages/hosted/src/live-contract.ts` declares:

- `VoiceServiceContract.swift` transcribes `VOICE_SERVICE_FRAME`,
  `LIVE_CLIENT_EVENT` whole (as `LiveClientEventName`; `LiveEvents.swift`'s
  `LiveClientEventType` is the data channel's subset of it),
  `VOICE_SERVICE_HEADER`, and `PROACTIVE_SPEECH_KIND`,
  the sessions path, the idle window, and the reattach cadence, each held
  equal to its TypeScript set by `tools/ios-parity`; it writes the four frames
  the phone may send (`session.create` with an empty seed, `session.attach`,
  `session.activity`, `session.stop`) and the one Live client event the route
  forwards (`session.close`), and reads `session.created`,
  `session.attached`, `session.spoken`, and the hosted refusal document, handing
  everything else naming a type up as a relayed Live event. Every frame is
  checked against the JSON Schema goldens
  `packages/hosted/fixtures/json-schema/live-contract-*.json`, read as the
  bytes they are, the way `ConversationReads.swift` is checked against
  `fixtures/reads`.
- `VoiceServiceSocket.swift` is the socket seam, a protocol over
  `URLSessionWebSocketTask` so the client's tests run against a scripted
  socket and on Linux. The production socket sets exactly the two headers the
  contract names, `Authorization` and `x-luke-device-id`, and refuses to build
  a request carrying an `Origin`, because the route answers 403 to one; RFC
  6455 makes `Origin` a browser client's header and Apple documents no default
  for it, and the device pass (LUKE-220) is what confirms the upgrade answers
  101.
- `HostedVoiceSessionClient.swift` opens the socket under the account's
  bearer, read fresh per attempt through `AccountSession`'s token discipline
  (a 401 renews once and retries once under the same holder), and the device
  row id `DeviceRegistrar` holds; sends the offer as the first frame and
  answers with the session or the refusal it read (401, 403, 503, a 429, a
  first frame carrying `{ error }`, a socket closed or silent before it
  answered). The session it hands back re-attaches with `session.attach` on
  `HOSTED_REATTACH_DELAYS_MS` when the service's function invocation ends
  under a standing WebRTC session, restating the last-reported idle first
  and replaying a stop pressed in the gap, and tells its one consumer every
  relayed Live event, the service's `session.spoken`, and the close that ends
  it for good. Its `created` is the `LiveSessionCreated` that
  `LivePeerSeams.createSession` answers with, so the peer and the socket
  client wire together without an adaptor.

The idle report is the call's to make on `LIVE_IDLE_WINDOW_MS`, five minutes,
which replaced the phone's own 180-second idle close; the client only carries
it. Nothing on the phone sends `session.beat`, which is the desktop's, and no
frame of the phone's composing carries instruction text.

The same client speaks the service's third route for the watch, which has no
WebRTC: `createAudio` opens `/api/voice/audio` (`VOICE_SERVICE_PATH.AUDIO`)
under the same handshake, sends `session.create` naming the synced voice and
a `LiveAudioFormat` (`LIVE_AUDIO_FORMAT`, defaulting to
`LIVE_DEFAULT_AUDIO_FORMAT`, PCM16 at 16 kHz, each held equal by
`tools/ios-parity` and to the goldens
`live-contract-sessionAudioCreateFrameSchema.json`,
`live-contract-sessionAudioCreatedFrameSchema.json`, and
`packages/live/fixtures/json-schema/session-LiveAudioFormatSchema.json`), and
reads the route's own `session.created`, which names the session and no SDP
answer. The `HostedAudioSession` it hands back sends the watch's PCM as
`session.input_audio.append` (`LIVE_INPUT_AUDIO_APPEND`, base64 of
little-endian samples, `PCM16Audio`), the same `session.activity`,
`session.stop`, and `session.close` the phone sends, and nothing else the
route would refuse; it hands up Luke's audio as the relayed
`session.output_audio.delta` (`PCM16Audio.samples(in:)`) beside the captions.
A primary socket at OpenAI has no attach, so the session is its one
connection: when the service's function invocation ends, the session is over
and `closed` reaches the consumer at once, with nothing tried again.

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
  on each read that follows a write to it, and once more when it finishes),
  rows of a conversation no longer listed
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

Behind a press and hold on each of Luke's messages — a reply, a briefing, or
his own judgment's words, the assistant rows the service accepts a verdict
on — stand two thumbs, above Copy in the message's menu. A press is the one write this screen makes:
`MessageRatingClient` puts the word and this device's id to
`PUT /api/conversation/messages/{id}/rating` through the same `authorized()`
retry and holder fence every phone client runs under, the answer is recorded
locally as the rating event it made, and the verdict shown — the filled thumb
in the menu, and nothing on the message itself — is the rating the service
folded onto the message, amended by any newer `rating` event read
since — this device's own, or another's — so a verdict given on the Mac shows
here and one given here shows there, and a fresh launch reads no events from
the record's beginning: the events cursor seeds from the change signal's head
like the turns'. A press on the other thumb is a second event, never an edit;
a press on the filled thumb, whose item reads Remove Thumbs Up or Remove
Thumbs Down, writes a third whose word is `withdrawn` (`RatingWord`, the
wire's `RATING_WORD`) and leaves the message unrated, the thread taking a
withdrawal read as the newest word as no verdict at all. The watch,
which draws no menu, hands the store the rating client its constructor asks
for and never calls it: a rating is shown on the wrist and given elsewhere. The
developer's own ask and the brain's notes to itself offer no thumbs, since
the service refuses a rating on either; before this installation's device row
is registered the two items are disabled rather than hidden; the count that
follows a recorded rating carries the verdict and whether the message was a
reply or a briefing, never the message or its id.

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
`Luke/SessionReplay.swift` under the `PostHog` SwiftPM package. Crash and
error reporting start from `LukeKit`'s shared `MobileSentry` helper, which
links Sentry's Cocoa SDK with the desktop's posture: no Sentry Replay, no
tracing, no screenshots, and no default PII collection.

The watch app runs the counted stream alone, through the same sender with
client `watchos` (stamped `luke-watchos` by the service). Replay stays phone
only: the watch does not link PostHog at all. The shared Sentry client is
linked for both apps; on iPhone it reports native crashes on the next launch,
and on watchOS it leaves Sentry's crash handler off because the SDK does not
support native watch crash capture. Account edges are not counted on the watch,
because a sign-in there is the phone's relay and the phone already counted it.

The PostHog project key rides the `POSTHOG_PROJECT_API_KEY` build setting into
`Info.plist`, empty by default — and empty means the recording client is never
configured. The Sentry DSN rides the `SENTRY_DSN` build setting into each app's
`Info.plist`, also empty by default — and empty means `MobileSentry.start()`
never configures the SDK. A distributing build injects both:

```sh
xcodebuild \
  -project apps/ios/Luke.xcodeproj \
  -scheme Luke \
  POSTHOG_PROJECT_API_KEY=phc_your_project_key \
  SENTRY_DSN=https://public@example.ingest.sentry.io/1 \
  build
```

A DEBUG run may set `LUKE_POSTHOG_PROJECT_API_KEY` and `LUKE_SENTRY_DSN` in
the scheme's environment instead, the same door the service address overrides
use. XCTest runs neither record, replay, nor crash reporting: the app detects
its launch as a test host and stands every outbound telemetry stream down.

## Watch

`LukeWatch` is its own client of the hosted service, not a view the iPhone
feeds. The phone hands it the account's tokens over WatchConnectivity, and the
two exchange one more thing over the same channel, described next; the
sessions list, a session's conversation, the messages and controls sent from
the wrist, and the voice call's socket all leave the watch itself, under the
watch's own device row. watchOS chooses the path and prefers the phone:
the paired iPhone's connection tunneled over Bluetooth whenever the phone is
in range, the watch's own Wi-Fi or cellular only when it is not.

`LukeKit` holds every line both apps run, and a watch file exists only where
watchOS draws or routes something differently: the credentials in
`KeychainStore`, parameterized by the service string and the accessibility
class that are the only things the two sandboxes differ on; the voice call's
audio in `PCMAudioPlayer` and `PCMAudioCapturer`, which touch no audio
session of their own (on the watch `WatchVoiceAudioSession` holds it for the
whole call) and speak at the rate the session's format names; and Luke's own
face in `FaceArt` and `LukeMark`, with only the
tab bar's UIKit rasterization left on the phone, where UIKit exists. A copy
kept in step by a "change both" comment is a copy that eventually is not, so
each of those was one file with two callers rather than two files.

The settings the two apps both hold — the voice the next session speaks in,
and the New Workspace choices remembered per provider — are kept equal
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
a provider wrote travels this way, and it leaves neither device. Neither
device holds a pace any more: the Live model has no speed.

The watch speaks to Luke through the service's audio route, the third of the
voice service's routes and the one for a device with no WebRTC: there is no
WebRTC for watchOS, and the GPT Live WebSocket transport takes the project
key alone, which the wrist must never hold (LUKE-211, ruled 2026-09-14). So
the service holds the session's primary socket to OpenAI itself, and the
watch's one socket to the service carries the developer's voice up and
Luke's down, beside the same events and reports the phone's socket carries;
on this route alone both voices transit the service, in both directions.
`WatchVoiceSessionModel` drives it through `HostedVoiceSessionClient`'s
`createAudio` (described under Voice service socket) with the account bearer
the phone handed over and `x-luke-device-id` set to the watch's own device
row, so the session, its transcript, and its turn are written under the
watch's device by the voice writer and read back by the Conversation under
the controls on the watch, the phone, and a Mac alike; the watch writes no
record of its own. Hold to talk opens a session if none stands, in the synced
voice and PCM16 at 16 kHz, and streams the microphone for exactly as long as
the press lasts; between presses the watch streams silence, because the
conversations guide asks that input audio keep running through silence on a
WebSocket, and that silence is what the model reads the end of a turn from.
Luke's reply plays as it arrives, and the status follows the playback queue,
since GPT Live emits no output-audio-done event; his words for the reply
under way are the one caption the call draws. The stop control sends
`session.stop` and drops what of his reply the wrist had not yet played; idle
is the watch's own five-minute window reported as `session.activity`, with
the close the service's decision; leaving the page or changing the voice
sends `session.close`. Nothing on the wrist mints a credential, dispatches a
tool, seeds a context item, or sets a speed: the exchange is the service's,
the brain answers, and the Live model has no speed. A primary socket has no
attach, so a call ends when the service's function invocation does, at its
800-second cap (`VOICE_FUNCTION_MAX_DURATION_SECONDS`) or sooner; the screen
then says the call ended, and the next press opens a new one.

watchOS draws one line through that traffic. HTTP over `URLSession` is open
to every app, and every hosted read and act on the watch travels that way,
through `WatchNetwork.session`, which waits for a path to come up instead of
failing the instant none is up. A WebSocket is low-level networking, which
watchOS grants only to an audio streaming app while its audio session is
active (Apple's TN3135 and WWDC 2019 session 716), and tells anything else
that opens one that the Internet connection appears to be offline, with the
phone in the same pocket. Luke's voice call is a streamed spoken exchange, so
the watch app declares the `audio` background mode in `LukeWatch/Info.plist`
and holds its audio session active from before the voice socket opens until
the call closes, in `WatchVoiceAudioSession`. Two details of that grant are
watchOS's own and are easy to miss: the session must be activated with the
asynchronous `activate(options:)` call, because the synchronous
`setActive(true)` returns without error on a watch and earns nothing, and the
socket must be opened from the app's own process through Network framework,
in `WatchWebSocketChannel`, because URLSession on watchOS does its work in a
system process that never inherits the grant. Network framework hands back no
status for a refused upgrade, so a refusal the service states in its first
frame (no account, a spent allowance, an unavailable service) is shown in the
lines the phone shows, and one it states in the status alone reads as Luke
not reached. The call still opens only at the developer's press; the mode
changes what watchOS lets the socket do, not when Luke listens.
