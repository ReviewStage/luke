# `@sidecar/analytics`

## The allowlist is the privacy boundary

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

`PRIVACY.md` describes analytics in kind: fixed names and values, no free text,
no identity from the desktop, on by default. It moves when one of those stops
being true, not when an event is added.
