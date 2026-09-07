# `@sidecar/realtime`

## The protocol is the mouth's, and the acts live below it

`realtime-protocol.ts` carries the wire grammar, the standing instructions,
and the one tool the desktop's call is configured with, `ask_brain`. The acts
themselves — their schemas, validators, and narrations — live in
`@sidecar/acts`, and this package no longer re-exports them: it imports
`actNarration` for the history lines a carried act leaves, and
`remoteRealtimeToolDefinitions` for the phone's mint, which still carries the
roster as context and the session acts as its own tools. Anything else that
wants an act imports `@sidecar/acts` directly rather than reaching it through
this barrel.

## The act and guide validator tests live in `packages/acts`

`acts-validation.test.ts` and `guide.test.ts` there cover the session, issue,
and app tools — `REALTIME_TOOL`, the routing, and each validator's bounds —
against `./acts.js`. The tests here cover only what this package owns: the
protocol's events and parser, the roster and projects context text, the mint,
and the briefing and onboarding speech builders.
