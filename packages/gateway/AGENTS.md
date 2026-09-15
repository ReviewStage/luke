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
answers — it is then refused as unknown exactly like one that never existed. An
event kind no host emits leaves `GATEWAY_EVENT` the same way, and the tests speak
names the host answers rather than a vocabulary kept for them.

## The goldens are the envelope

`fixtures/protocol/` holds one recording per method and error code, carried
through the text transport. **Key order is part of the contract**, so nothing
sorts the recorded keys and the formatter is kept off the tree. An error's
`message` is prose and travels into a golden as a fixed token.

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

## The node's ledger is one scope

`serveInvocations` opens one `InvocationMemory` for the scope it is served in,
holding a `Deferred` per invocation id: a frame the wire repeated joins the
performance the first frame opened rather than opening a second, and that
performance is a fiber of the memory's own set rather than of whoever the frame
arrived on, so a frame whose reader gave up never takes the answer the
duplicates are joined to. **The native effect runs at most once per id**,
whatever the wire did.

## Unavailable and unknown are different answers

A capability no connected node offers answers unavailable: never dispatched. An
ask whose connection closed before it answered is unknown: it may have happened.

**The two must never collapse into one**, because the action journal records the
first as a refusal and the second as an action whose effect is uncertain and which
Luke never retries on his own initiative.
