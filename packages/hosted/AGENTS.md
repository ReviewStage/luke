# `@sidecar/hosted`

This package is the desktop-to-service wire boundary. It owns the hosted
service paths (`service-paths.ts`), one wire module per domain — vault,
device, observe, conversation, projects, mint, act, and the service vocabulary
they share — each a `Schema` declaration rather than a hand-written reader,
and the realtime credential contract, and depends only on lower wire/session
vocabulary. Behavior belongs above it: the
brain's hosted client lives in `@sidecar/brain`, the hosted credential minter
in `@sidecar/voice`, and realtime credential lifecycle depends on this package
rather than being imported by it.

A renamed wire field keeps its old name on the wire for one iOS release. The
desktop and the service ship together, but an installed phone reads whatever
the service sends until its owner updates it, so the service writes both names
and every reader accepts either; the comment on the legacy field in
`observe-wire.ts` names it and says when it may go. Today that is
`observedAt`, the name `lastActivityAt` traveled under before the rename.
