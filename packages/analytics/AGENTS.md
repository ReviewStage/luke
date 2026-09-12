# `@sidecar/analytics`

## The allowlist is the privacy boundary for `/api/events`

An event is a name from `product-events.ts` and properties whose values come from
`as const` sets in that same file. One reader validates both sides and **builds
its output from the allowlist rather than from what arrived**, so a title, branch,
path, prompt, or anything typed or spoken has no shape it could travel in. Counts
travel as buckets, versions as release versions, and no property takes free text.

**What that boundary encloses is the endpoint, not the analytics project.** The
two streams below reach the project without passing it. So the guarantee is
"nothing observed can travel in a counted event" — never "nothing observed reaches
the project." Do not let this file's promise be read as covering them.

The iOS and watchOS apps emit through a hand-kept Swift transcription of this
vocabulary. **This file stays the source of truth**: the service reads every batch
against this allowlist whoever posted it, so a transcription that drifts shows up
as a refused batch, never as a value that traveled.

A value set another package already declares is imported where the graph allows
it, so there is no second list to drift. Where the edge would close a loop, a total
`Record` bridge in the package that reads this one closes the gap, so a new member
does not build until this vocabulary has answered for it.

`PRODUCT_SURFACE_EVENT` is the subset the renderer may ask for. It exists to be
the narrowing — main validates a renderer's send against that union before the
allowlist, so a compromised renderer reaches none of the actions.

## The one batch that outlives a run

A flush that found no credential writes its queue to the hold the host hands
the sender (`held-product-events.json` under the state root), and the next run
that counts reads it once, ahead of its first flush, and posts it under whichever
account signs in next. **That moves when a count leaves, never whether**: a Mac
that never signs in still posts none, and the bearer is still the only thing
that names an account.

Three things about it are load-bearing and look like accidents:

- **The hold is written ahead of the request, never behind it.** A quit between
  a post and a write can then only lose the batch, never post it twice, which is
  the direction this pipeline already takes.
- **Its age bound is `PRODUCT_EVENT_MAXIMUM_AGE_MS`, read by the service too.**
  The service clamps an older `at` into that window; a held event past it is
  dropped here rather than posted only to be re-dated.
- **Each held event is read back through `productEventFromWire`**, so a build
  that narrowed the vocabulary drops the event instead of posting it.

`PRIVACY.md` says the hold in as many words, since a count standing on disk
between launches is a fact a user should know.

## Everything outside this package has no such guarantee

The session-replay client in each app runs on its library's own configuration, and
nothing here governs a byte of it. Three things leave that way, none validated
here:

- **The recording** — the rendered panel, except the Conversation tab's blocked
  subtree. A session's title, branch, and error line, the account's name and
  address, and a screenshot attached to the feedback composer all travel because
  they are drawn. Only typed-into fields are masked, and that is the library's
  default rather than a posture the app keeps.
- **Autocaptured events** — the text of whatever was clicked. Pressing a session
  row sends that row's words.
- **Unhandled exceptions**, with their message and stack.

`productEventFromWire` never sees any of them, so a change here cannot make them
safer and a change there cannot make them unsafe.

`PRIVACY.md` is the whole of what a user is told, since none of the three has a
switch. It moves when any of them stops being true, not when an event is added.
