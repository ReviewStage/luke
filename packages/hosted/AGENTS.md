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
points down). The clients here are `vault-client.ts`, the desktop's side of
the three vault routes, `device-client.ts`, its side of the one devices
path, `roster-client.ts`, its read of the stored roster the observe path
answers, beside the mapping of that wire's rows onto the session
vocabulary's observations (advertisements as presence alone, since what a
control targets never travels), and `action-client.ts`, its side of the two
session actions a row asks for; each sits in this package because it speaks
nothing but hosted vocabulary and holds no credential of its own. Behavior that needs
anything above this boundary belongs above it: the brain's hosted client lives
in `@sidecar/brain`, the hosted live session source in `@sidecar/voice`, the
account preference client in `@sidecar/host` because the snapshot it carries is
settings vocabulary, and the phone's mint document in `@sidecar/actions`
depends on this package rather than being imported by it.

## One call stands behind all of them

`account-call.ts` is the request every caller to Luke's own service makes,
here rather than beside any one of them because this is the lowest package
they all reach. It owns what each of them used to restate: the base address
trimmed once, the bearer header written once, the deadline joined with the
caller's own cancellation, a fetch that threw read as a fault by the error's
kind alone, and the one reading of a 401 — renew the credential, retry
exactly once, only on a credential that changed, and only while it still
answers for the same holder. It answers rather than throws, including when
the credential itself could not be read: a caller that took work off a queue
to send it has to be able to put it back. It holds no credential itself: a
`CallCredential` is handed in (`accountBearer` for the signed-in account,
`fixedBearer` for a key, `NO_CREDENTIAL` for an endpoint that takes no
identity at all), so who may renew a credential and who may say which account
it answers for stay their owners' to know. What a caller keeps is its own
vocabulary and its own reading of a status: `ask` for a caller that wants a
validated body or nothing, `send` for one that reads the status itself.
Every caller in this package now makes that call, `device-client.ts`
included, and so do the two hosted endpoints that reach a third party on a
key the deployment fixed: a `fixedBearer` for OpenAI, and `NO_CREDENTIAL` for
the analytics batch, whose project token travels in the document itself.

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
reads either opener. After the opening pair, GPT Live events pass through the
same socket as themselves and are declared in `@sidecar/live`, not here. A
request frame refuses a key it did not name; an answer ignores one a newer
service added, the rule every wire module here keeps.

`service-paths.ts` carries `VOICE_SERVICE_PATH`, the two function routes the
upgrades stand on (`/api/voice/sessions` under an account bearer,
`/api/voice/introduction` under none). The service authorizes and meters a
session by direct calls into its own account code, so no internal route and
no shared secret exist between two deployments. The legacy mint paths and
`realtime-contract.ts` stand beside it untouched for the phone, and for the
installed desktops that predate the live session, until each has moved.

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
above this package, under the registry the reader holds.
