# `@sidecar/analytics`

## The allowlist is the privacy boundary for events

An event is a name from `product-events.ts` and properties whose values come
from `as const` sets in that same file. One reader validates both sides and
builds its output from the allowlist rather than from what arrived, so a title,
branch, path, recap, prompt, or anything typed or spoken has no shape it could
travel in. Counts travel as buckets and versions as release versions; no
property takes free text.

That construction is the guard, not a document that lists the events. Widening
the event list or a property's value set is still a product decision rather
than an implementation detail, because it changes what a user consented to when
they left the switch on.

A value set that repeats another package's — the connection ids, the settings
pages — repeats it rather than importing it, because that package reads this
one and the edge would close a loop. The desktop closes each gap with a total
`Record` bridge in `apps/desktop/src/shared/product-vocabulary.ts`, so a new
member does not build until this vocabulary has answered for it.

`PRODUCT_SURFACE_EVENT` is the subset the renderer may ask for: surface motion
the main process cannot see. It exists to be the narrowing — the main process
validates a renderer's send against that union before the allowlist, so a
compromised renderer reaches none of the acts.

## Replay is the other stream, and it has no such guarantee

Screen recording lives in `apps/desktop/src/renderer/session-replay.ts`, not
here, and nothing in this package governs it. Do not let this file's promise be
read as covering both: an event cannot express a session title, and a recording
would show one if it were not masked. What keeps a recording offerable is that
module's masking, which is an allowlist and must stay one.

`PRIVACY.md` describes both in kind: fixed names and values with no free text
for the counts, a masked recording of Luke's own panel for the replay, each
with its own switch and both on by default. It moves when either stops being
true, not when an event is added.
