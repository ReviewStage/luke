# `@sidecar/gateway`

## The vocabulary is the contract

`protocol.ts` says what a method, an event, and a refusal are. Nothing in it
performs anything.

**A method is an entry in one table**, `GATEWAY_METHOD`.

A method's own parameters belong here too, beside the entry that names it, so the
host that answers it and the client that sends it read the same words from the
contract rather than from each other.

A retired method is removed from the table rather than kept as a name no handler
answers — it is then refused as unknown exactly like one that never existed. An
event kind no host emits leaves `GATEWAY_EVENT` the same way, and the tests speak
names the host answers rather than a vocabulary kept for them.

## Unavailable and unknown are different answers

A capability no connected node offers answers unavailable: never dispatched. An
ask whose connection closed before it answered is unknown: it may have happened.

**The two must never collapse into one**, because the action journal records the
first as a refusal and the second as an action whose effect is uncertain and which
Luke never retries on his own initiative.
