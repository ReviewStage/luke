# `@sidecar/hosted`

This package is the desktop-to-service wire boundary. It owns the hosted
service paths (`service-paths.ts`), one wire module per domain — vault,
device, observe, conversation, projects, mint, act, live, the per-resource
reads and their change signal (`reads-wire.ts`, whose answers are pinned by
the synthetic fixtures under `fixtures/reads/` the Swift mirror reads
against), and the service vocabulary they share — each a `Schema`
declaration rather than a hand-written reader, and the phone's Realtime
credential contract (`realtime-contract.ts`, with the reader of a mint
response into it), and depends only on lower wire/session vocabulary and `@sidecar/live`
for the Live voice set and the
`InitialItem` shape (that package imports nothing of this one, so the edge
points down). Every module here states its declarations as Effect `Schema`s
directly: each reads through `readEither`, shows what `emitJsonSchema` walks
out of the same AST, and keeps the reader `declareReader` states for the rule
no combinator can declare — a frame's one part read as its tuple in
`live-contract.ts`, a credential's `wsUrl` read against the record it arrived
in in `mint-wire.ts`, a row's dropped field or skipped array entry in
`observe-wire.ts` and `projects-wire.ts` — so the bytes a model or a device is
shown are the same bytes the goldens under `fixtures/json-schema/` hold. A
caller reads one of these schemas through `readEither` and shows it through
`emitJsonSchema`, both from `@sidecar/wire/effect`, and every recorded golden
in `hosted-wire-schemas.test.ts` is typed against its module through
`RecordedEffectJsonSchemas`, exhaustive by construction. The clients here are `vault-client.ts`, the desktop's side of
the three vault routes, `device-client.ts`, its side of the one devices
path, `changes-client.ts`, its side of the change-signal poll that carries
the device's presence and quiet instants, `roster-client.ts`, its read of the
stored roster the observe path answers and of the projects the same snapshot
lists for the account's keys, beside the mapping of that wire's
rows onto the session vocabulary's observations (advertisements as presence
alone, since what a control targets never travels), `action-client.ts`,
its side of every session action the service carries — the two a row asks
for and the four the brain asks for at the developer's word (a new workspace,
another agent, and the two renames), `session-messages-client.ts`, its
read of one observed session's own conversation for the brain's transcript
reads, and
`conversation-client.ts`, its side of the Conversation's per-resource reads,
Clear, and the rating write (`PUT` on `conversationMessageRatingPath`, the
request held to `rating-wire.ts`'s schema before it travels and the two
refusals the service names, not found and not rateable, answered apart from
every other end), which holds no cursor or row either — what a device keeps
of the Conversation is its caller's; each sits in this package because it speaks
nothing but hosted vocabulary and holds no credential of its own. Behavior
that needs
anything above this boundary belongs above it: the brain's hosted client lives
in `@sidecar/brain`, the hosted live session source in `@sidecar/voice`, the
account preference client in `@sidecar/host` because the snapshot it carries is
settings vocabulary, and the phone's mint document in `@sidecar/actions`
depends on this package rather than being imported by it.

## One call stands behind all of them

`account-call.ts` is the request every caller to Luke's own service makes,
here rather than beside any one of them because this is the lowest package
they all reach. It owns what each of them used to restate: the base address
trimmed once, the bearer header written once, the request carried by the
ambient `HttpClient` under the call's own deadline, a client that could not
carry it read as a fault by the error's kind alone, and the one reading of a
401 — renew the credential, retry exactly once, only on a credential that
changed, and only while it still answers for the same holder. Nothing else is
retried: a rate limit, a server error, and a refusal are each the caller's to
read, and no backoff stands behind any of them. It answers rather than fails,
including when the credential itself could not be read: a caller that took
work off a queue to send it has to be able to put it back. It holds no
credential itself: a `CallCredential` is handed in (`accountBearer` for the
signed-in account, `fixedBearer` for a key, `NO_CREDENTIAL` for an endpoint
that takes no identity at all), so who may renew a credential and who may say
which account it answers for stay their owners' to know. What a caller keeps
is its own vocabulary and its own reading of a status: `ask` for a caller that
wants a body the answer's own Effect schema admitted or nothing, `read` for
one that hands its own reader function over directly rather than a schema
(unused outside its own test now that every client here reads through `ask`),
and `send` for one that reads the status itself. Every caller in this package
now makes that call, `device-client.ts` included, and so do the two hosted
endpoints that reach a third party on a key the deployment fixed: a
`fixedBearer` for OpenAI, and `NO_CREDENTIAL` for the analytics batch, whose
project token travels in the document itself.

`accountCall` is that call as effects over `@effect/platform`'s `HttpClient`
tag, so what carries a request is a layer a caller provides and a test hands
the same fake behind (`fakeCloudApi`'s own `layer`, or `layerFromCloudFetch`
over a recorder for a route whose status moves between attempts). The
deadline is the runtime's own timeout rather than an `AbortSignal.timeout`,
and it ends a request under the name that signal's reason carried, so a
caller reporting an end reports the word it always did. `createAccountCall`
is the promise face the migration keeps: it provides the caller's own
`httpClient` layer, or `FetchHttpClient.layer` for the ambient ones, runs the
effect, and is the one place a caller's `AbortSignal` is read at all — it
joins the signal to the run, and the interruption it raises is the network
fault that signal's reason names. Every client in this package now holds
`accountCall` directly instead: none of their methods takes a caller's own
`AbortSignal`, so each builds the `HttpClient` layer once, from its own
`httpClient` option (a test's fake) or `FetchHttpClient.layer` (the ambient
fetch client), and each Promise-returning method provides that layer to the
effect it built and runs it with `Effect.runPromise`, so a caller of any of
these six classes still awaits a promise and the Effect face never crosses
their boundary. `device-client.ts`, `vault-client.ts`, `changes-client.ts`'s
`poll`, and `conversation-client.ts`'s `clear`, `messages`, `events`, and
`turns` all read their answers with `ask` directly against the Effect schema
each wire module declares (`changesAnswerSchema`, `conversationClearAnswerSchema`,
and so on); `action-client.ts` keeps reading its answer by hand off the
`send`ed response, unchanged, because what it distinguishes is the status a
fault or a refusal left the call in rather than a validated body, and
`roster-client.ts`'s `observe` reads `observe-wire.ts`'s own
`observeAnswerSchema` the same way `ask` does. `conversation-client.ts`'s
per-resource reads and its rating still read the raw `Response` through
`send`, because the unreadable-row refusal and the two rating refusals need
the body under a status `ask` would already have discarded. `createAccountCall`
itself stands only for its two remaining callers outside this package — the
web app's hosted PostHog batch and its voice session mint — and is deleted
once both take `accountCall` instead. Both are on the barrel, because a
caller outside this package can hold one too: `@sidecar/analytics`'s
`ProductEventSender` is the first, its own flush cadence an effect over
`accountCall` rather than the promise face.

## The live contract is a socket's opening frames

`live-contract.ts` is the desktop's contract with the hosted voice service:
the two Vercel Functions of Luke's own service that hold the GPT Live project
key. They live on the service's own origin, so `HOSTED_VOICE_SERVICE_ORIGIN`
is `HOSTED_SERVICE_ORIGIN` in socket form (`webSocketOrigin` swaps the
scheme and nothing else) and is compared as `URL.origin` — scheme, host, and
port, never a path or a query — so nothing a service answers can send a
desktop's socket elsewhere. `hostedVoiceServiceOrigin` is where a development
build's override enters, reduced to its socket origin (an `http://localhost`
account override reaches the functions `vercel dev` serves beside it) and
refused past the packaging boundary, the same rule `LUKE_ACCOUNT_BASE_URL`
follows in the host; the package reads no environment itself and is handed
the value. The socket's own vocabulary is `VOICE_SERVICE_FRAME`, two pairs:
the desktop's `session.create` (the SDP offer as written, a voice that is a
member of `LIVE_VOICE`, and a seed of at most 128 `InitialItem`s of one text
part each, bounded per item so a frame the Live API would refuse is refused
before a session is spent on it) answered by `session.created` (the opaque
session id, the SDP answer, and the quota the session was spent against,
dropped if mis-answered); and the desktop's `session.attach` (one session id)
answered by `session.attached`, for a fresh connection to a session that
stands, because a connection to a Vercel Function ends at the function's
maximum duration while the WebRTC session does not. `sessionOpeningFrameSchema`
reads either opener. Beside the frames, `VOICE_SERVICE_HEADER` names the one
header the desktop adds to a `session.create` handshake next to its bearer:
its own `devices` row id, so the session the service records names the
installation that opened it and a briefing claimed by that device speaks
into it; the service admits the header only in a device id's shape, refuses
a creation naming a row the account does not hold before a session is spent,
and a `session.attach` carries none. After the opening pair, GPT Live events
pass through the same socket as themselves and are declared in
`@sidecar/live`, not here. A
request frame refuses a key it did not name; an answer ignores one a newer
service added, the rule every wire module here keeps.

`service-paths.ts` carries `VOICE_SERVICE_PATH`, the two function routes the
upgrades stand on (`/api/voice/sessions` under an account bearer,
`/api/voice/introduction` under none). The service authorizes and meters a
session by direct calls into its own account code, so no internal route and
no shared secret exist between two deployments. The legacy mint paths and
`realtime-contract.ts` stand beside it untouched for the phone, and for the
installed desktops that predate the live session, until each has moved.

A capability the service gains is advertised by a field of its own, never
by a new member of a list a shipped client decodes against a fixed literal
set. `hostedBrainCapabilitiesSchema`'s `operations` is such a list: a desktop
already installed reads it against the operation names its build knew, and a
name it never knew fails the whole capabilities read and takes the brain with
it. The prefetch is the first capability added this way — it stands in
`HOSTED_BRAIN_OPERATION` for the transports that address it, is kept out of
`HOSTED_BRAIN_LISTED_OPERATIONS`, which is what the service answers, and is
advertised by the optional `prefetch` field, which a tolerant record lets an
older desktop ignore.

A renamed wire field keeps its old name on the wire for one iOS release. The
desktop and the service ship together, but an installed phone reads whatever
the service sends until its owner updates it, so the service writes both names
and every reader accepts either; the comment on the legacy field in
`observe-wire.ts` names it and says when it may go. Today that is
`observedAt`, the name `lastActivityAt` traveled under before the rename.

## A cursor is minted here and echoed by a device

`reads-wire.ts` declares the cursors the per-resource reads stand on as
opaque strings: a record's JSON, base64url-encoded, read back by the same
schema that bounded it, so a device holds one string per resource and never
composes one. The sequence cursor positions every conversation the view
stood on, in conversation-id order, which is what makes two cursors over the
same positions one string and lets the change signal's head be compared by
equality; the turn cursor carries the store's own microsecond instant as
text beside the id, because a millisecond number cannot tell two stamps in
the same millisecond apart. An answer carries a cursor as the validated
string, not the decoded record, since the string is what goes back on the
wire. The message inside a group is admitted as a record and nothing
narrower: holding it to the vocabulary is `readStoredUIMessages`'s step,
above this package, under the registry the reader holds. What the route
puts in that record is `@sidecar/session/ui-messages`'s `ClientUIMessage`,
the one shape a read route may answer with: minted by `clientUIMessage`
alone, which cuts the provider's replay slot (`providerMetadata.openai`, the
opaque reasoning item and its id) from every part, so a device receives the
reasoning's summary text and never the item, whichever route carries the
message. The stored row keeps the slot for the model's own replay.

## A turn's events are a projection, streamed

`turn-events-wire.ts` declares what a client that just asked a turn hears of
it while it runs, over `GET /api/brain/turns/{id}/events`
(`brainTurnEventsPath`) as Server-Sent Events: the four run seams the live
session service consumes — a slow step began, every action settled, one
sentence of the reply, the turn ended — and nothing wider, no tool part, no
reasoning, no message. The kinds and the slow-step kinds are the brain's own
run-stream words spelled here, because this package cannot reach the brain; a
test in the web app holds the two sets equal. Each event is numbered from one
inside its turn and the number is the frame's `id`, so a client that lost its
connection attaches again with the last number it took as `after` and hears
the rest exactly once; the end is the last event of every turn and the stream
closes after it, while a stream that closes without an end is one whose
attachment lapsed at the function's own bound. `encodeTurnEventFrame` and
`decodeTurnEventFrame` are the framing, so the service and a client read one
frame the same way and a heartbeat frame decodes to nothing. The service
stores no event of this kind: the stream is a projection over the turn row
and the turn's journal, and the wire declares only what travels.
