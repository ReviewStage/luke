# `@sidecar/hosted`

The desktop-to-service wire boundary: the hosted service paths, one wire module
per domain, and the clients that speak them.

## The dependency direction is the point

It depends only on lower wire and session vocabulary and on `@sidecar/live`,
which imports nothing of this one, so the edge points down.

A client sits here because it speaks nothing but hosted vocabulary and holds no
credential of its own. **Behavior that needs anything above this boundary belongs
above it**: the brain's hosted client in `@sidecar/brain`, the hosted live session
source in `@sidecar/voice`, the account preference client in `@sidecar/host`
because the snapshot it carries is settings vocabulary.

**A request frame refuses a key it did not name; an answer ignores one a newer
service added.** Every wire module here keeps that rule.

A renamed wire field keeps its old name on the wire for one iOS release. The
desktop and service ship together, but an installed phone reads whatever the
service sends until its owner updates it, so the service writes both names and
every reader accepts either.

## One call stands behind all of them

`account-call.ts` is the request every caller to Luke's own service makes. It owns
the base address, the bearer header, the deadline, and **the one reading of a
401 — renew the credential, retry exactly once, only on a credential that changed,
and only while it still answers for the same holder.**

Nothing else is retried. A rate limit, a server error, and a refusal are each the
caller's to read, and no backoff stands behind any of them.

- **It answers rather than fails**, including when the credential could not be
  read, because a caller that took work off a queue to send it has to be able to
  put it back.
- **It holds no credential itself.** A `CallCredential` is handed in, so who may
  renew one and who may say which account it answers for stay their owners'.

## The socket origin is compared whole

The service's socket origin is the service origin with its scheme swapped,
**compared as `URL.origin` — scheme, host, and port, never a path or query — so
nothing a service answers can send a desktop's socket elsewhere.** A development
override enters at one place and is refused past the packaging boundary; the
package reads no environment itself.

The service authorizes and meters a session by direct calls into its own account
code, so **no internal route and no shared secret exist between two deployments.**

## A cursor is minted here and echoed by a device

The per-resource reads stand on opaque strings: a record's JSON, base64url
encoded, read back by the same schema that bounded it, so **a device holds one
string per resource and never composes one.** An answer carries a cursor as the
validated string, not the decoded record, since the string is what goes back on
the wire.

What a read route may answer a message with is `ClientUIMessage` and nothing else,
minted by `clientUIMessage` alone, **which cuts the provider's replay slot — the
opaque reasoning item and its id — from every part.** A device receives the
reasoning's summary text and never the item; the stored row keeps the slot for the
model's own replay.

## A turn's events are a projection

**The four run seams and nothing wider — a slow step began, every action settled,
one sentence of the reply, the turn ended. No tool part, no reasoning, no
message.** The kinds are the brain's own run-stream words spelled here because
this package cannot reach the brain; a test in the web app holds the two sets
equal.

Each event is numbered from one inside its turn, so a client that lost its
connection attaches with the last number as `after` and hears the rest exactly
once. A stream closing without an end is one whose attachment lapsed at the
function's own bound. The service stores no event of this kind.
