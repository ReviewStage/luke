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
