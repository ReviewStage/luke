# The renderer

`repository-checks.sh` already fails the build on a `#main/` or `node:` import
here. What it cannot see is the same trap arriving through a package barrel:
importing a package for one string constant resolves its whole export graph,
`node:http` included. **Import the vocabulary door, not the barrel.**

## One state channel in, one act channel out

State arrives on `app:state` alone, read through `use-app-state.ts` and never
subscribed to twice. Read it with `useAppState`, or `appStateNow` for a callback
that cannot wait a render — never the registry directly, so a hook and a callback
cannot disagree. The channels beside it carry events rather than state: a one-shot
to a named receiver a late subscriber must not receive, or a reading that expires
before the next version could carry it.

The runtime beside that registry is **the bundle's one Effect edge**. Work that is
a fiber of its own runs under the services it was built over, read through
`rendererServicesNow`, so nothing here builds a second runtime to fork on.

Effects leave on `app:act` alone, one invoke carrying one `{kind, payload}` from
`ACT_KIND`, parsed here and again in `main/act-router.ts`, answered as an
`ActOutcome` so nothing an exception happened to carry ever crosses back.
`renderer/act.ts` is the only caller — `act` when a row reads the answer, `tell`
when nothing does. **A new command is a new `ACT_KIND` entry with its payload
schema, its answer's guard, and its one router row. There is no second write path
to add one on.**

## One bundle, two documents, one role branch

The panels and the hidden voice window load the same `renderer.js`;
`src/renderer/index.tsx` mounts `VoiceHost` or the panel's `Surface` by the role
main decided for the window that asked. **The panel is the one surface that
records**: `App` is where `applySessionReplay` is called and the voice role never
mounts it, `voice.html` is `connect-src 'none'`, and the recording carries no
words in any case (`session-replay.ts`).

No credential reaches the voice window, nothing there appends to the model, and it
writes no Conversation line. The policy — whether a session stands, what the keys
do — is `LiveVoiceOrchestrator` in `@sidecar/voice`. Two constraints are this
bundle's own and are easy to undo:

- The audio line carries a track at every moment of the session's life. GPT Live
  paces output against the input timeline, so a sender left with no track stalls
  it — a reply appended while the talk key was up was held until the next press,
  then unloaded whole. A muted session, or one whose microphone the system
  refused, carries synthesized silence that the next press swaps a device onto.
- The peer is acquired into a `Scope`, not closed by hand, and every bound is an
  `Effect.sleep` forked into that same scope — so nothing is left armed behind an
  ended session, and a test drives them with `TestClock`.

## Panel motion

`docs/DESIGN.md` is the binding contract and states the motion tokens, the
transform-and-opacity rule, and how the window's panes open, close, and fill it.
Read it first. What it does not cover is the Electron window under the surface:

- **The window never animates its own frame.** Main sets its bounds once, at
  creation, and moves it no further; a pane makes its room inside the window,
  because an animated `setBounds` re-lays out the whole renderer every frame.
- **A pane never animates a width.** It lands in the layout at once, and
  `pane-motion.tsx` replays what it displaced, FLIP-style, on `transform` and
  `clip-path` from a snapshot taken in `getSnapshotBeforeUpdate`. Content a pane
  change moves joins its `GLIDERS`, or it jumps while the rest glides.
- **The shell never scrolls sideways.** Whatever slides past its edges is clipped
  with `overflow: clip`, never `hidden`: `hidden` makes a scroll container, and
  `scrollIntoView` or a focus then scrolls the whole window into the room a
  sliding pane stands in, and leaves it there. Inside a pane that may still be
  sliding in, scroll its own scroller rather than call `scrollIntoView`, which
  scrolls every box around the element (`code-pane.tsx`'s `centreWithin`).
- **Title-bar controls stand still while the panes slide beneath them.** They come
  after the drag strips in DOM order, because a later drag region wins, and draw
  their fills over an opaque `--title-bar-ground`, because a translucent fill
  shows the pane passing under it.
- Reduced motion and a capture run hold motion still at the tokens (`base.css`),
  and `pane-motion.tsx` reads its timing from those same tokens, so a pane
  answers both without a check of its own.

## Confirms

Any action that cannot be undone asks first, over `confirm-state.ts`. In the
desktop window it asks through `<ConfirmDialog>`, a modal over the window held by
`useConfirmDialog`: title, what goes, Cancel focused and the act in red. A
settings row still asks in place through `<ConfirmSwap>`. A question does not
outlive its subject — one left standing where a key used to be would point at
whatever is stored there next — and does not outlive the surface it was asked on.
`useConfirm` keeps both, and `useConfirmDialog` keeps them for the refusal the
dialog goes on showing; a row holding a bare `useState(false)` keeps neither.

## Brand artwork

`repository-checks.sh` runs `design/generate-brand-assets.mjs --check` and fails
on drift, so the generated outputs cannot be hand-edited. What the check does not
say is why the app draws the face rather than loading the SVGs: it needs
`currentColor` and CSS animation, and `--face-motion` is what holds every loop
still for a capture run and for reduced motion. SMIL answers to neither.

The face is still unless something is happening. A gesture plays once and a rest
repeats, so only a motion that stays true for as long as it holds may be a rest.
Every motion begins and ends at the resting pose, or it snaps there on the way in
and out; every layer of a gesture shares a period, because the app hands the face
back after the longest of them.

## Luke's knowledge of himself

The guide is the one place Luke's self-knowledge is described, so it is what
Luke can say about himself.

**When you add a feature or a setting, teach the guide about it in the same
change.** A capability the guide does not describe is one Luke will deny having,
and a stale entry is one he will misdescribe. The settings half is generated from
`APP_SETTING_SCHEMA` and cannot go stale; the facts half is hand-written, and its
only test asserts a fact *exists* for every label — never that one is true.

- A setting only a hand may change stays `adjustable: false` with a `manual` path,
  because the refusal Luke voices is itself the guidance.
- Credentials are never adjustable, never spoken, and never described beyond
  whether a provider is connected. The guide leaves the machine, so nothing in it
  may carry a key, a key's shape, or an environment variable's value.
- A setting's page, section, order, and whether its row is drawn are the schema
  entry's answers and nobody else's. `SchemaSettingRows` is the only renderer of a
  schema row; a control that cannot be one is `rows: SETTING_ROWS.BESPOKE`.
