# `@luke/features`

The desktop-to-service wire boundary: the hosted service paths, one wire module
per domain, and the clients that speak them.

The view models a desktop surface is drawn from (`turn-rows.ts`,
`integration-health.ts`, `failure-remedy.ts`, the `*-model.ts` files) sit beside
the wire and `*-view.ts` modules they shape, each at a subpath of its own. They
import no React and no DOM, so another app could draw the same surface.

## The dependency direction is the point

It depends only on lower wire vocabulary, on `@luke/live`, and on
`@luke/runtime` (the `effect` door the analytics sender schedules through),
none of which imports this one, so the edge points down.

A client sits here because it speaks nothing but hosted vocabulary and holds no
credential of its own. **Behavior that needs anything above this boundary belongs
above it**: the hosted live session source in `@luke/voice`, the account
preference client in `@luke/host` because the snapshot it carries is settings
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

**The five run seams and nothing wider — a slow step began, a brain turn
queued a question, every action settled, one sentence of the reply, the turn
ended. No tool part, no reasoning, no message.** A queued question is read off
its `queue_question` call's input, because that call exists only to hand the
voice its words; the one other call whose words are told is `show_code`, whose
lines travel on the `plan.code` frame rather than as an event. The kinds are the brain's own run-stream words (`brain/run-events.ts`),
spelled apart from them because the two were separate packages until the brain
joined this one; a test in the web app holds the two sets equal.

Each event is numbered from one inside its turn, so a reader that took some hears
the rest exactly once. The service stores no event of this kind; the voice's live
brain projects them in process from the turn row and its journal.

## The allowlist is the privacy boundary for `/api/events`

An event is a name from `analytics/product-events.ts` and properties whose values come from
`as const` sets in that same file. One reader validates both sides and **builds
its output from the allowlist rather than from what arrived**, so a title, branch,
path, prompt, or anything typed or spoken has no shape it could travel in. Counts
travel as buckets, versions as release versions, and no property takes free text.

**What that boundary encloses is the endpoint, not the analytics project.** The
two streams below reach the project without passing it. So the guarantee is
"nothing observed can travel in a counted event" — never "nothing observed reaches
the project." Do not let this file's promise be read as covering them.

A value set another package already declares is imported where the graph allows
it, so there is no second list to drift. Where the edge would close a loop, a total
`Record` bridge in the package that reads this one closes the gap, so a new member
does not build until this vocabulary has answered for it.

`PRODUCT_SURFACE_EVENT` is the subset the renderer may ask for. It exists to be
the narrowing — main validates a renderer's send against that union before the
allowlist, so a compromised renderer reaches none of the actions.

## Everything outside this package has no such guarantee

The session-replay client in each app runs on its library's own configuration, and
nothing here governs a byte of it. Three things leave that way, none validated
here:

- **The recording** — the rendered panel. The account's name and address, and
  a screenshot attached to the feedback composer travel because they are
  drawn. Only typed-into fields are masked, and that is the library's
  default rather than a posture the app keeps.
- **Autocaptured events** — the text of whatever was clicked. Pressing a row
  sends that row's words.
- **Unhandled exceptions**, with their message and stack.

`productEventFromWire` never sees any of them, so a change here cannot make them
safer and a change there cannot make them unsafe.

`PRIVACY.md` is the whole of what a user is told, since none of the three has a
switch. It moves when any of them stops being true, not when an event is added.
