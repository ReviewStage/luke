# `@sidecar/gateway`

## The vocabulary is the contract

`protocol.ts` says what a request, an answer, and an event are, and refuses every
shape it does not know. Nothing in it performs anything.

**A method is an entry in one table that also says whether it mutates**, so a
method added here cannot be forgotten in a set beside it: `isMutatingGatewayMethod`
reads the same entry the name came from, the server demands an idempotency key
from exactly the methods that flag says change something, and `rpc.ts` derives the
`RpcGroup` from the same table.

A method's own parameters belong here too, beside the entry that names it, so the
host that answers it and the client that sends it read the same words from the
contract rather than from each other.

A retired method is removed from the table rather than kept as a name no handler
answers — it is then refused as unknown exactly like one that never existed.

## The goldens are the envelope

`fixtures/protocol/` and `fixtures/socket/` hold one recording per method, error
code, and frame kind, carried through the text transport and a real ephemeral
socket. **Key order is part of the contract**, so nothing sorts the recorded keys
and the formatter is kept off the tree. An error's `message` is prose and travels
into a golden as a fixed token, while the exchange asserts a message was said at
all.

Re-recording with `LUKE_UPDATE_FIXTURES=1` is a claim that the protocol moved.

## The server's guarantees are its middleware

Three `RpcMiddleware` tags, innermost first: admission (version, role, closed
door, missing idempotency key), revision check (a request built over a replaced
configuration or lifetime), and the ledger.

The ledger is the one worth knowing: one cache per mutating method keyed by the
idempotency key, holding the answered `Exit` and the parameters it was asked
with — so a retry finds the first answer, a retry landing mid-decision joins that
decision through the cache's single flight, and the same key with other
parameters is an `idempotency_conflict`. **Never a second effect.**

**Who is asking is never read from a request.** `GatewayClients` is filled by the
transport at its authenticated handshake, and a request's own id is the
transport's to echo, never the handler's to read.

## Authentication is injected, never spelled here

The handshake runs on the binding's own upgrade, before `ws` is handed the socket
and before the client registry has heard of it. Who is asking is compared where it
is understood: a shared secret in constant time on a loopback binding, an
account's bearer on a server. **This package learns no credential, and none
reaches a log line in it.**

A host that starts to leave mid-check takes the socket with it rather than holding
its close open behind an authority that may never answer, and a client that drops
mid-handshake is admitted as nobody.

## Unavailable and unknown are different answers

A capability no connected node offers answers unavailable: never dispatched. An
ask whose connection closed before it answered is unknown: it may have happened.

**The two must never collapse into one**, because the action journal records the
first as a refusal and the second as an action whose effect is uncertain and which
Luke never retries on his own initiative.
