# `@sidecar/gateway`

## The vocabulary is the contract

`protocol.ts` says what a request, an answer, and an event are, and refuses
every shape it does not know. Nothing in it performs anything. A method is an
entry in one table that also says whether it mutates, so a method added here
cannot be forgotten in a set beside it: `isMutatingGatewayMethod` reads the
same entry the name came from, and the server demands an idempotency key from
exactly the methods that flag says change something. Widening the method
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

## Three doors, because one of them reaches `ws`

The barrel carries the protocol, the server, the client, the in-process
transport, and the node registry — nothing that reaches a socket.
`./websocket` is the binding that does (`ws`, `node:http`, `node:crypto`), so
a bundle that only wants the vocabulary never has to resolve them, and
`./testing` holds the text transport, which exists to prove the same protocol
answers when every envelope goes through JSON and back.

## Authentication is injected, never spelled here

The handshake decides two things of its own — a host no longer admitting
refuses, and so does a client on another protocol version — and asks
`authenticate` for the third. Who is asking is compared where it is
understood: a shared secret in constant time on a loopback binding, an
account's bearer on a server. This package therefore learns no credential,
and none reaches a log line in it.

## Unavailable and unknown are different answers

A capability no connected node offers answers unavailable: it was never
dispatched. An ask whose connection closed before it answered is unknown: it
may have happened. The two must never collapse into one, because the action
journal above records the first as a refusal and the second as an action whose
effect is uncertain and which Luke never retries on his own initiative.
