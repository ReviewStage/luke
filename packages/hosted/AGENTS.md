# `@sidecar/hosted`

This package is the desktop-to-service wire boundary. It owns the hosted
service paths (`service-paths.ts`), one wire module per domain — vault,
device, observe, conversation, projects, mint, act, live, and the service
vocabulary they share — each a `Schema` declaration rather than a hand-written
reader, and the realtime credential contract, and depends only on lower
wire/session vocabulary and `@sidecar/live` for the Live voice set and the
`InitialItem` shape (that package imports nothing of this one, so the edge
points down). The two clients here are `vault-client.ts`, the desktop's side of
the three vault routes, and `device-client.ts`, its side of the one devices
path; each sits in this package because it speaks nothing but hosted
vocabulary and holds no credential of its own. Behavior that needs
anything above this boundary belongs above it: the brain's hosted client lives
in `@sidecar/brain`, the hosted credential minter in `@sidecar/voice`, the
account preference client in `@sidecar/host` because the snapshot it carries is
settings vocabulary, and realtime credential lifecycle depends on this package
rather than being imported by it.

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

## The live contract is a socket's first two frames

`live-contract.ts` is the desktop's contract with the hosted voice service,
the one process on Luke's side that holds a GPT Live project key. The
service is not the account service: it is a long-running process on its own
origin, `HOSTED_VOICE_SERVICE_ORIGIN`, pinned by the build the way
`HOSTED_CALLS_URL` pins the Realtime host and compared as `URL.origin` —
scheme, host, and port, never a path or a query — so nothing a service
answers can send a desktop's socket elsewhere. `hostedVoiceServiceOrigin`
is where a development build's override enters, reduced to its origin and
refused past the packaging boundary, the same rule `LUKE_ACCOUNT_BASE_URL`
follows in the host; the package reads no environment itself and is handed
the value. The socket's own vocabulary is two frames, `VOICE_SERVICE_FRAME`:
the desktop's `session.create` (the SDP offer as written, a voice that is a
member of `LIVE_VOICE`, and a seed of at most 128 `InitialItem`s of one text
part each, bounded per item so a frame the Live API would refuse is refused
before a session is spent on it) and the service's `session.created` (the
opaque session id, the SDP answer, and the quota the session was spent
against, dropped if mis-answered). After those two, GPT Live events pass
through the same socket as themselves and are declared in `@sidecar/live`,
not here. A request frame refuses a key it did not name; an answer ignores
one a newer service added, the rule every wire module here keeps.

`service-paths.ts` carries the two sides of that service: `VOICE_SERVICE_PATH`
for the upgrades on the voice service's origin (`/sessions` under an account
bearer, `/introduction` under none), and under `HOSTED_SERVICE_PATH` the two
internal routes on the account service that only the voice service calls,
`VOICE_AUTHORIZE` and `VOICE_USAGE`, authenticated by the shared secret in
`VOICE_SERVICE_SECRET_HEADER` rather than by any account's bearer. The
Realtime mint paths and `realtime-contract.ts` stand beside it untouched for
the installed desktops and the phone that still speak them.

A renamed wire field keeps its old name on the wire for one iOS release. The
desktop and the service ship together, but an installed phone reads whatever
the service sends until its owner updates it, so the service writes both names
and every reader accepts either; the comment on the legacy field in
`observe-wire.ts` names it and says when it may go. Today that is
`observedAt`, the name `lastActivityAt` traveled under before the rename.
