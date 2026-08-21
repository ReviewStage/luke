# `@sidecar/analytics`

## The allowlist is the privacy boundary

An event is a name from `product-events.ts` and properties whose values come
from `as const` sets in that same file. One reader validates both sides and
builds its output from the allowlist rather than from what arrived, so a title,
branch, path, recap, prompt, or anything typed or spoken has no shape it could
travel in. Counts travel as buckets and versions as release versions; no
property takes free text.

Widening the event list or a property's value set is a product decision, not an
implementation detail, and **moves `PRIVACY.md` in the same change**. That
document names every event and every property by name, and nothing but this rule
holds the two together. An event added, renamed, or given a wider value set
leaves `PRIVACY.md` describing a Luke that no longer exists.
