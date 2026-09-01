# `@sidecar/analytics`

## The allowlist is the privacy boundary for `/api/events`

An event is a name from `product-events.ts` and properties whose values come
from `as const` sets in that same file. One reader validates both sides and
builds its output from the allowlist rather than from what arrived, so a title,
branch, path, recap, prompt, or anything typed or spoken has no shape it could
travel in. Counts travel as buckets and versions as release versions; no
property takes free text.

What that boundary encloses is the endpoint, not the analytics project. Events
Luke counts are posted to his own service and read against this allowlist a
second time there; everything in the section below reaches the project without
passing it. So the guarantee is "nothing observed can travel in a counted
event", never "nothing observed reaches the project".

The endpoint has two clients, and the second is a transcription. The iOS app
emits through its own Swift sender (`apps/ios/LukeKit/Sources/LukeKit/
ProductEvents.swift` and `ProductEventSender.swift`), a hand-kept subset of
this vocabulary whose enums make free text unrepresentable the way the `as
const` sets do here. This file stays the source of truth: the service reads
every batch against this allowlist regardless of who posted it, so a
transcription that drifts shows up as a refused batch, never as a value that
traveled. Which app posted travels as `PRODUCT_EVENT_CLIENT_HEADER`, a header
whose value only selects between the fixed `$lib` tags in
`PRODUCT_EVENT_CLIENT_LIB` — absent or unrecognized means the desktop, because
desktop builds from before the header already post without one.

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

## Everything outside this package has no such guarantee

`apps/desktop/src/renderer/session-replay.ts` holds the one analytics client
the desktop runs, and `apps/ios/Luke/SessionReplay.swift` its iOS
counterpart — each on its library's own configuration, and nothing in this
package governs a byte of either. Do not let this file's promise be read as
covering them. Three things leave that way and none is validated here:

- The recording itself, which is the rendered panel except for the History
  tab's explicitly blocked `ph-no-capture` subtree — a session's title, branch,
  recap, and error line, the account's name and address, and a screenshot
  attached to the feedback composer all travel because they are drawn. Only
  what is typed into a field is masked, and that is the library's default
  rather than a posture the app keeps. The iOS recording is the app's own
  screens on the same terms, captured as screenshots because that is how the
  SDK records SwiftUI at all.
- Autocaptured events, which name the text of whatever was clicked. Pressing a
  session row sends that row's words. Desktop only: the iOS SDK's equivalent
  copies a text control's live contents on end-of-edit, which is typed text
  and not a click, so it stays at its off default there.
- Unhandled exceptions, with their message and stack — on iOS, a crash sent
  as an exception event on the next launch.

`productEventFromWire` never sees any of them, so a change here cannot make
them safer and a change there cannot make them unsafe — they were never
governed.

`PRIVACY.md` describes all three in kind: fixed names and values with no free
text for the counts, and a recording of Luke's own panel that shows what the
panel showed, with the clicks and errors that ride beside it. None of the
three has a switch, so that file is the whole of what a user is told. It moves
when any of them stops being true, not when an event is added.
