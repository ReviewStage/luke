# `@sidecar/realtime`

## The transport is this package's, and everything above it lives elsewhere

Five files carry what a call speaks. `realtime-events.ts` is the wire grammar
— the statuses, both sides' event names, the outbound builders, and the parser
that reads inbound events so a second file cannot re-encode it.
`voice-scene.ts` is where every scene's rules live, one `SCENE` entry each,
and the two functions that put a scene on the wire: `sessionInstructions`
for what a session is minted with, and `responseTurn` for one speak-only
turn on a standing call, opened without tools and with its input behind the
one marker so nothing a turn carries can become an action. The persona is
prepended there and nowhere else. `realtime-instructions.ts` is the one tool
the desktop's call is configured with, `ask_brain`. `proactive-speech.ts` is
the wire contract for what Luke says first — the words the brain decided to
say and the two onboarding beats — and the two builders that are not a
scene's: an utterance joins the call's own conversation as one marked item,
spoken under the session's standing rule for it rather than instructions on
the response, and the arrival beat composes its data lines and picks its
direction before handing them to `responseTurn`. `conversation-seed.ts` is
what every call is told as it opens: the recent Conversation lines from Luke's
own record, in the conversation's own roles, without the actions or any
session identity, closed by a note saying none of it awaits an answer.

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

`actions.test.ts`, `admit.test.ts`, and `guide.test.ts` there cover the session, issue,
and app tools — `REALTIME_TOOL`, the routing, and each validator's bounds —
against `./actions.js`. The tests here cover only what this package owns: the
protocol's events and parser, the scenes and the two functions that speak
them, the mint, the seed, and the utterance and arrival builders.
