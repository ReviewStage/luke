# `@sidecar/live`

## The wire grammar of a GPT Live session, and nothing that runs one

This package is the vocabulary a Live session (`gpt-live-1`) is created,
driven, and read with, declared once so no consumer re-encodes it, and it is
Node-free: every module here can ride into the renderer bundle, the host, the
hosted voice service, and a web function alike. Nothing here opens a socket,
creates a session, or holds one; the host and the voice service do that, and
they import their shapes from here.

`events.ts` is the grammar: `LIVE_STATUS`, both sides' event names, the
close reasons and delegation targets, one `@sidecar/wire` `Schema` per server
event unioned into `liveServerEventSchema` behind `parseLiveServerEvent`, and
the builders for the six client events this build sends. An append carries a
required `delegation_id`, `null` included, because the API requires the field
on every append and a builder that defaulted it would hide the one decision an
append turns on: whether it answers a delegation or speaks session-wide. A
transcript delta is admitted untrimmed and may be whitespace, since the
captions recipe forbids trimming a fragment. Reflected audio parses to its
type alone, so a sideband drops it by type before anything reads it.
`RENDERER_CLIENT_EVENTS` and `RENDERER_SERVER_EVENTS` are what an untrusted
window's data channel may send and is shown: the microphone switch, the
hang-up, the lifecycle, both captions, usage, error, and info; every append
and every delegation stays with the trusted side.

`session.ts` is the creation contract: the sessions path and the attach
path, `liveSessionConfig`, which sets the client delegation, `store: false`,
the renderer's channel restrictions, and no field the API does not document
for WebRTC (no `audio.format`, no tools, no speed, no truncation), the
`liveCreateRequest` body, the `liveCreateAnswerSchema` that reads the id and
SDP answer back, and the outcome set and `LiveDiagnostics` shape the host
reports voice's availability with. A diagnostics document carries no
credential material.

`instructions.ts` is the prompt a session is created with, in the Live
prompting guide's shape and no longer: an identity block of a few sentences,
then `Backchannel policy:`, `Interruption policy:`, and `Delegation policy:`
with `Backend tools:`, `Delegate to the backend when:`, and `Do not delegate
to the backend when:`, closed by the guide's two lines about delegating first
and never guessing. The persona is rewritten short here rather than pasted
from `@sidecar/guide`: the guide's persona stays the brain's, whose words the
voice says, and the guide names pasting a long prompt wholesale as the
migration mistake. Two scenes stand, `DESKTOP` with the brain as its backend
and `INTRODUCTION` with none, and `sessionInstructionBlocks` exposes which
sections a scene emits so a test asserts the decision and not the words.
`greetingInstruction` is the introduction's opening, sent as one
instructions append after `session.started` by the voice service, from the
trusted side; `introductionSeedItems` is the one developer message the
introduction's `input` may carry, the detected titles under
`INTRODUCTION_SEED_BOUNDS`, composed by the takeover and admitted by the
service against the same bound. The docs' backend preamble is not here: it is a prompt section
of `@sidecar/brain`, and the roster rendering the voice is shown is the
host's, which already holds the brain's redacted view; neither package
depends on this one and this one depends on neither.

`seed.ts` is what a session is told as it opens: the recent Conversation
lines as `input` messages in their own roles (developer and user as
`input_text`, assistant as `output_text`, no `system`), closed by a developer
note saying nothing above awaits an answer, and held under the API's 128
messages and 8,192 estimated tokens by dropping the oldest lines first. A
caller that puts its own developer message beside the seed passes the budget
that message leaves. `transcript.ts` is the record of what was said on one
session: `TranscriptLedger` keeps every fragment exactly as received with its
place on the session timeline, groups them into utterances by
`UTTERANCE_GAP_MS` per speaker with overlap allowed and late fragments
revising the row they belong to, and answers the captions, the ask context a
delegation is composed from, and the last instant anything was said.
`chunks.ts` cuts a text into appends at sentence ends under the 500-token
bound against `tokens.ts`'s one estimate. `proactive.ts` is what Luke says
first — a briefing the brain decided, the arrival beat, the calendar beat —
as the commentary appends that speak it, observed values bounded and
flattened before they enter one.

## What stays elsewhere

`ConversationEntry` and the retained thread are `@sidecar/session`'s. The
hosted voice service's socket frames and the service paths are
`@sidecar/hosted`'s. The sideband over `ws`, the session service that owns
the one session, and the renderer's peer are the host's and the desktop's.
The phone's Realtime mint document stays in `@sidecar/realtime` until the
phone moves.

## Tests

The tests here cover only what this package owns, as values and structure:
event type membership, `delegation_id` present-and-null against an id,
`client_event_id` correlation, config keys present and absent, the permission
arrays, seed roles and bounds, ledger grouping and ask context since an
offset, chunk bounds and round trips, and which instruction sections a scene
emits. No test reads the prose.
