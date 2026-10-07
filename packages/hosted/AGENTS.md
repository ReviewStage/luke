# `@sidecar/hosted`

The desktop-to-service wire boundary: the hosted service paths, one wire module
per domain, and the clients that speak them.

## The dependency direction is the point

It depends only on lower wire vocabulary and on `@sidecar/live`,
which imports nothing of this one, so the edge points down.

A client sits here because it speaks nothing but hosted vocabulary and holds no
credential of its own. **Behavior that needs anything above this boundary belongs
above it**: the hosted live session source in `@sidecar/voice`, the account
preference client in `@sidecar/host` because the snapshot it carries is settings
vocabulary.

**A request frame refuses a key it did not name; an answer ignores one a newer
service added.** Every wire module here keeps that rule.

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

## A turn's events are a projection

**The five run seams and nothing wider — a slow step began, a planning turn
queued a question, every action settled, one sentence of the reply, the turn
ended. No tool part, no reasoning, no message.** A queued question is read off
its `queue_question` call's input, the one call whose words are told, because
that call exists only to hand the voice its words. The kinds are the brain's own run-stream words spelled here because
this package cannot reach the brain; a test in the web app holds the two sets
equal.

Each event is numbered from one inside its turn, so a reader that took some hears
the rest exactly once. The service stores no event of this kind; the voice's live
brain projects them in process from the turn row and its journal.
