# `@sidecar/realtime`

## The transport is this package's, and everything above it lives elsewhere

Three files carry what a call speaks. `realtime-events.ts` is the wire grammar
— the statuses, both sides' event names, the outbound builders, and the parser
that reads inbound events so a second file cannot re-encode it.
`realtime-instructions.ts` is what a voice is told before it hears anything,
and the one tool the desktop's call is configured with, `ask_brain`.
`proactive-speech.ts` is what Luke says first: the briefing the brain decided
to give and the two onboarding beats, each turn built without tools so nothing
a beat carries can become an action.

Two things a transport does not own left. `ConversationEntry` and the retained
thread are `@sidecar/session`'s: they are what a line of the conversation is,
and the memory index and the brain both hold them without transporting
anything. The bounded, redacted roster and projects view a model is shown is
`@sidecar/brain`'s `standing-context.ts`: it is a view composed for a window
rather than the roster itself. `SESSION_NO_LONGER_OBSERVED_NOTE` went with the
conversation model and is imported back here, because the words the standing
instructions teach and the words a history line renders have to be one string.

The actions themselves — their schemas, validators, and narrations — live in
`@sidecar/actions`, and this package no longer re-exports them: it imports
`remoteRealtimeToolDefinitions` for the phone's mint, which still carries the
roster as context and the session actions as its own tools. Anything else that
wants an action imports `@sidecar/actions` directly rather than reaching it through
this barrel.

## The action and guide validator tests live in `packages/actions`

`actions-validation.test.ts` and `guide.test.ts` there cover the session, issue,
and app tools — `REALTIME_TOOL`, the routing, and each validator's bounds —
against `./actions.js`. The tests here cover only what this package owns: the
protocol's events and parser, the standing instructions, the mint, and the
briefing and onboarding speech builders.
