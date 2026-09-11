# `@sidecar/gateway`

## The vocabulary is the contract

`protocol.ts` says what a request, an answer, and an event are, and refuses
every shape it does not know. Nothing in it performs anything. Each envelope
is one Effect `Schema` (`GatewayRequestSchema`, `GatewayResponseSchema`,
`GatewayEventSchema`, and the reconnect answer and node invocation shapes
beside them) that both reads the envelope off the wire and writes it back, so
the `*FromWire` readers and `*ToWire` writers are that one declaration read in
each direction rather than two statements of it, and a value the type already
guarantees is never revalidated behind them. A method is an
entry in one table that also says whether it mutates, so a method added here
cannot be forgotten in a set beside it: `isMutatingGatewayMethod` reads the
same entry the name came from, and the server demands an idempotency key from
exactly the methods that flag says change something. The same table is what
`rpc.ts` derives the protocol's `RpcGroup` from: `GatewayRpcs` holds one
`Rpc` per entry, named by the entry's wire name, taking a record of
parameters, answering a wire value or nothing, and failing with one of the
refusal family, and each carries its entry's `mutates` flag as the
`GatewayMutates` annotation, which `gatewayRpcMutates` reads back so a server
keys its idempotency ledger on the entry the name came from and never on a
list beside it. The error codes are a family of `Schema.TaggedError` classes,
one per code (`NotFoundRefusal`, `UnsupportedVersionRefusal`, and the rest of
`GATEWAY_REFUSALS`), each fixing its own `code` so a constructor takes the
message alone; `GatewayRefusalSchema` is the family as the wire carries it,
decoding an envelope's `{ code, message }` to the class its code names and
encoding a refusal back to exactly that object, so a class's tag never
reaches the wire. `gatewayVersionRefusal` is the one refusal the protocol
decides before any method is named. Widening the method
vocabulary or the event set is a product decision, not an implementation
detail. What a method's own parameters may say belongs here too, beside the
entry that names it, so the host that answers it and the client that sends it
read the same words from the contract rather than from each other. The live
voice session's vocabulary is declared that way, as `@sidecar/wire` schemas
beside the five methods and the one event that speak it:
`voice.createLiveSession` takes the peer's SDP offer verbatim (SDP is
line-oriented, so nothing trims, collapses, or cuts it) and answers the
session id and the SDP answer; `voice.reportLiveTransport` names one of
`LIVE_TRANSPORT_STATE`; `voice.reportLiveActivity` carries the peer's one idle
boolean; `voice.endLiveSession` carries nothing; `voice.stopSpeaking` carries
nothing and answers one `stopped` boolean, whether a session stood to be told,
because the stop key is its own ask and never inferred from a mute; and
`voiceLiveSession.changed`
names a `LIVE_SESSION_PHASE`, the session id once a provider has named one,
and the reason of a close. Every one of the five mutates, so a retried offer
finds the first session rather than creating and billing a second, and no
credential has a field to travel in. The retired credential-mint path's methods and events
(`voice.mintRealtimeCredential`, `speech.settle`, `receiver.report`, the
delivery claims, `speech.offered`, `speech.withdrawn`, `delivery.offered`) are
gone from the table rather than kept as names no handler answers: a retired
method is refused as unknown exactly like one that never existed.

What an envelope looks like on the wire is recorded rather than described.
`fixtures/protocol/` holds one request and one answer for every method, one
answer for every error code, and the two reconnection answers — a replay from
inside the window and a snapshot from past it — each carried by the text
transport so that a golden is what a socket would have seen rather than what a
reader believed. Key order is part of the contract, so nothing sorts the
recorded keys and the formatter is kept off the tree. One field is not
recorded verbatim: an error's `message` is prose written for a person and
improved like prose, so it travels into a golden as a fixed token while the
exchange asserts that a message was said at all. A rewrite of what composes an
envelope is measured against those bytes, and recording them again
(`LUKE_UPDATE_FIXTURES=1`) is a claim that the protocol itself moved.

`fixtures/socket/` is the same recording one level out, for the frames the
socket binding wraps those envelopes in: one exchange's worth, in the order a
client read them — an answer, a refusal, an unreadable request's refusal, an
event, a node invocation, and a reconnection replayed from inside the window
and answered with a snapshot from past it — each as the frame kind and the one
envelope under it, and each asserted to be a single document, since the
binding wraps one envelope and never several. `socket-frames.test.ts` records
them through a real ephemeral socket on this machine, so a rewrite of the
binding is measured against what a client of an earlier build would have
read.

The Rpc model speaks those same bytes through `gatewayEnvelopeSerialization`,
the `RpcSerialization` in `rpc.ts`, and never through `@effect/rpc`'s own
framings: a request travels as the request envelope, with what the Rpc model
keeps as a request's headers — the protocol version, the idempotency key, the
expected revisions, each under a `GATEWAY_REQUEST_HEADER` name — folded into
the envelope's own fields on the way out and read back into headers on the
way in; an exit travels as the answer envelope, its failure's first typed
refusal as the error object, a defect or an interruption as `internal`, and
the revision stamped from the reader the host hands the serialization, as the
server has always stamped it; and an event travels as its own record, read
back as a chunk of the one event stream under
`GATEWAY_EVENT_STREAM_REQUEST_ID`, since a stream's chunk is the only
unsolicited message the Rpc model has. A frame that carries several chunks
carries one document per line. A message the envelope has no shape for — a
ping, an ack, an interrupt, a defect with no request to answer — is written as
nothing, and a frame the envelope does not read is dropped, as the socket has
always dropped one. Every one of those rules is measured against the same
goldens: `rpc.test.ts` carries a recorded request, answer, error, and event
through the serialization and back to identical bytes.

## The server is an `RpcServer`, and its guarantees are its middleware

`server.ts`, behind the `./server` door, is the host's side of the protocol:
`layerGatewayServer(options)` is `@effect/rpc`'s `RpcServer.layer` over
`GatewayServerRpcs`, which is `GatewayRpcs` under three `RpcMiddleware` tags,
added innermost first so a request meets them in this order. `GatewayAdmission`
refuses a protocol version the host does not speak, a caller its role may not
call the method with, every mutation but the shutdown once `GatewayAdmissions`
has closed the door, and a mutation carrying no idempotency key.
`GatewayRevisionCheck` refuses a request built over a configuration revision
or a conversation lifetime since replaced, reading the `expectedRevision`
headers, before any handler runs. `GatewayLedger` is the idempotency ledger,
and it wraps the handler: one Effect `Cache` per mutating method, keyed by the
idempotency key, holding the answered `Exit` and the parameters it was asked
with, so a retry finds the first answer, a retry that lands while the first is
still deciding joins that one lookup through the cache's own single flight,
and a retry under the same key with other parameters is answered
`idempotency_conflict` once the one answer stands, never a second effect. The
cache's lookup is fixed when the cache is made, so the key carries the
request's own `next` and its parameters while equality and hashing read the
idempotency key alone. Each cache remembers as many keys as
`idempotencyCapacity` and lets the least recently asked go first. Every
middleware fails with the refusal family the envelope already carries, so what
crosses back is the same `{ code, message }` object the goldens hold.

Who is asking is never read from a request. `GatewayClients` is the registry
of connected clients by the number the Rpc runtime knows each as, filled by
the transport at its authenticated handshake; the admission middleware reads
the identity back from that number, and a handler is handed it as its
`client`, with the connection it can be asked back through and, as `request`,
what the envelope said beside its own id — the id is the transport's to echo,
never the handler's to read. A method of the group the host has no handler
for is answered `unknown_method` by the server's own handler, so no tag
without a handler reaches the runtime's defect, and a handler that throws is
the request's own `internal` refusal. Hello and reconnect are the server's
own handlers.

`GatewayEventLog` is the event log: a `Ref` holding a `Chunk` ring of the
newest events, bounded to the replay window, and a `PubSub` every emit
publishes to. The sequence is the newest event's own number, so the ring is
the one record of where the log stands: `replayFrom(lastSequence)` answers
the events after it while the ring still starts at or before the one after
it, a snapshot at the current sequence when the ring has moved past, and an
empty replay to a client already at the sequence. `events` subscribes first
and streams from then on, so a transport that subscribes before it reads
misses none, and `revision()` is a synchronous stamp of the sequence beside
the configuration revision, because `gatewayEnvelopeSerialization` stamps an
answer's revision inside its encoder, which the runtime calls as a plain
function.

The layer takes its `Protocol` from whoever carries the frames, and there are
two. `layerGatewayInProcessProtocol` is the one the desktop reaches, the
client and the host in one process: `GatewayInProcessProtocol.connect` admits
a client
into the registry and answers a door whose `carry` takes one request envelope
as text and answers the response envelope as text, both through the same
serialization a socket would use. The runtime numbers requests itself, so
this seam keeps each envelope's own id against the number it was handed in
under and writes it back onto the answer, which is the one thing it does to a
frame; a client it has closed answers `disconnected`, and a request the
serialization does not read answers `invalid_params`. `server.test.ts` is
where all of this is measured: every recorded request envelope in
`fixtures/protocol/` is carried through that door and its answer compared
byte for byte with the recorded one, including the replayed key, the
conflicting key, the stale revision, and a reconnection inside and past the
window.

The socket's own `Protocol` is the other, behind the `./websocket` door and
described below: the binding provides it and composes `layerGatewayServer`
over it, so the server that answers a socket is the same server, with the same
middleware, that answers the in-process transport. `layerGatewaySocket` is
that whole host end as one layer — the event log, the admissions door, and the
client registry the binding and the server share, the serialization stamping
each answer with the log's own revision, and the server over the socket's
frames — and `GatewaySocketBinding` is what a host holds of it: the port it
bound, how many connections stand, and the one close of admissions that shuts
its own door and the server's together.

The `GatewayServer` class is what `@sidecar/host`'s `GatewayService` and the
in-process transports still hold, and it is a
strangler shim (`@deprecated`, deleted by P7-01 and P7-02, on the ADR's
allowlist): it makes the log, the admissions door, and the registry ahead of
a `ManagedRuntime` over the layers above, runs a request as a promise through
the in-process protocol, and runs an emit, a reconnect, and the close of
admissions synchronously, delivering each emitted event to its own listeners
on the same tick beside the stream the log publishes. The socket binding holds
it no longer: it provides the `Protocol` a server is built over rather than
attaching to one already built, so what it needs of a host is the server's own
layer options, which `GatewayService` hands out as `serverOptions` — a shim of
the same family, deleted with the class.

## Five doors, because three of them reach beyond the vocabulary

The barrel carries the protocol, the handler vocabulary (`./methods`: the
outcome a handler answers, its context, and the table type), the client, the
in-process transport, and the node registry — nothing that reaches a socket,
and nothing that reaches `@effect/rpc`. `./websocket` is the binding that
reaches a socket (`ws`, `node:http`, `node:crypto`, and `@effect/platform`'s
`Socket`, which every admitted connection is one of) and, through the
`Protocol` it provides, the server below it; `./rpc` is the door that
reaches `@effect/rpc` (the `RpcGroup`, the `GatewayMutates` annotation, and
the envelope serialization); and `./server` is the host's server, which
composes that runtime over the group, so a bundle that only wants the
vocabulary — the renderer names the live session's shapes through the barrel
— never has to resolve any of them, and
`./testing` holds the text transport, which exists to prove the same protocol
answers when every envelope goes through JSON and back.

## Authentication is injected, never spelled here

The handshake runs on the binding's own upgrade, before `ws` is handed the
socket and before the client registry has heard of it, and a connection is
served only for a client it admitted. It decides two things of its own — a
host no longer admitting refuses, and so does a client on another protocol
version — and asks `authenticate` for the third. Who is asking is compared
where it is
understood: a shared secret in constant time on a loopback binding, an
account's bearer on a server. This package therefore learns no credential,
and none reaches a log line in it. A host that starts to leave while a
credential is still being checked takes the socket with it rather than holding
its own close open behind an authority that may never answer, and a client
that drops mid-handshake is admitted as nobody.

## Unavailable and unknown are different answers

A capability no connected node offers answers unavailable: it was never
dispatched. An ask whose connection closed before it answered is unknown: it
may have happened. The two must never collapse into one, because the action
journal above records the first as a refusal and the second as an action whose
effect is uncertain and which Luke never retries on his own initiative.
