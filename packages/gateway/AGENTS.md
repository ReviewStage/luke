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
entry that names it: `RECEIVER_REPORT_KIND` is the vocabulary of
`receiver.report`, so the host that answers it and the client that sends it
read the same three words from the contract rather than from each other.
The live voice session's vocabulary is declared the same way, as `@sidecar/wire`
schemas beside the four methods and the one event that speak it:
`voice.createLiveSession` takes the peer's SDP offer verbatim (SDP is
line-oriented, so nothing trims, collapses, or cuts it) and answers the
session id and the SDP answer; `voice.reportLiveTransport` names one of
`LIVE_TRANSPORT_STATE`; `voice.reportLiveActivity` carries the peer's one idle
boolean; `voice.endLiveSession` carries nothing; and `voiceLiveSession.changed`
names a `LIVE_SESSION_PHASE`, the session id once a provider has named one,
and the reason of a close. Every one of the four mutates, so a retried offer
finds the first session rather than creating and billing a second, and no
credential has a field to travel in.

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
