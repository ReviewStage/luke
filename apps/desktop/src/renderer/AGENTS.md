# The renderer

## It is a sandboxed browser context

The renderer reaches the main process through the preload bridge alone, so
`#shared/bridge` and the domain modules under `#shared/wire/` are the widest
doors it has. A `#main/` import compiles and
bundles happily and then fails in the browser, and a `node:` import does the
same. Neither is a mistake the type checker or esbuild can report, because
both are real modules that simply are not there at run time.
`repository-checks.sh` fails the build on either. A colocated `*.test.ts` is
exempt from the `node:` half: it runs under Node and never enters the bundle.

Two renderers load this bundle under the same rule. The panel is one; the
hidden voice window under `WINDOW_ROLE.VOICE` is the other, and everything it
mounts lives under `renderer/voice/`: the realtime session, the microphone,
the mouth, and the hook that reports the conversation back to the main process
as one `VoiceView`. It reaches the main process through the same bridge, under
the same sandbox, and it must never mount `App` or import `session-replay.ts`:
the panel is the one surface that records, and a recording of a blank hidden
window would be a session nobody consented to. `repository-checks.sh` fails the
build on a `session-replay` import anywhere under `renderer/voice/`. A panel
draws the voice state the main process forwards and forwards its presses back;
it constructs no session of its own.

The same trap arrives through a package barrel, where nothing greps for it.
Importing `@sidecar/calendar` for one string constant resolves that package's
whole export graph, `node:http` included. Packages that hold both a vocabulary
and a Node flow open a door for the vocabulary alone. Import
`@sidecar/calendar/vocabulary`, `@sidecar/account/snapshot`,
`@sidecar/superset/sign-in-stage`, not the barrel.

## Panel motion

`docs/DESIGN.md` is the binding contract for how anything drawn on the surface may
move: the spring vocabulary, how content joins and leaves a resizing shape,
and how a motion change is proven. Read it before adding or altering any
animation; this section covers only the window and the surface themselves.

The window is a stage; the drawn surface is the shape. Every window holds the
width of the widest shape any mode can draw (the panel, and the peek where a
housing outgrows it), so hovering and the slot cost no IPC and a mode change
never moves the window: macOS lands a window's move and its content's relayout
on different frames, so a mode change that also recentred a narrower window
flashed the capsule against the old origin before the move caught up. Only the
height changes between modes, anchored to the top edge, where everything a
shorter frame crops is margin below a shape that has already closed. The stage
carries `SURFACE_MARGIN` on every side, which is what the spring overshoots
into and the shadow falls in. Anything the shape does not cover is transparent
and must stay click-through, so hit regions track the shape rather than the
window.

The shape's depth is the menu bar's painted depth, not the safe-area inset. The
inset is the region apps must avoid; macOS may paint the bar deeper than it, and
a shape built on the inset stops short of the strip it has to pass for.

The window never animates its own frame. An animated `setBounds` re-lays out
the whole renderer on every frame, because the panel is anchored to the
viewport's centre. Everything layered on the surface must move with `transform`
and `opacity` only. Animating width, height, padding, or font-size on the
wings, the sign-in label, or the rows re-shapes text on every frame and is what
makes the motion stutter.

The surface is opaque in every state, because it has to pass for part of a
physical object and nothing behind the window may show through it. It takes its
shadow and hairline edge once it has grown past the housing. The panel's
shadow is delayed until the shape settles, because a blurred shadow repaints on
every frame that resizes the element; the peek's is small enough to ride along.
`backdrop-filter` is not an option: a transparent window has no backdrop to
sample, so it would buy a render surface on the animating element and return
nothing.

One spring for everything that moves. `--spring` drives the surface;
`--spring-fast` is the same damping ratio at a higher frequency for small
elements like switch thumbs, so the bounce profile is identical and only the
scale differs. Settings pages and the tab selection indicator change at once;
task navigation does not travel. Panel content arrives as one stack: the tab
bar is index 0 and each row below it starts further up, so the gaps spring open
rather than the rows sliding in as a block. The fan and the stagger stop
accumulating past `--row-fan-limit`, because only about five rows are ever on
screen.

In either direction the shape and its content must not cross, or content is
left drawn on the desktop: growing, the surface leads and content follows;
shrinking, content leaves over `--duration-exit` before the surface moves.
`setWindowMode` owns the ordering for every caller: the panel, the tray, and
the motion recorder alike. `COLLAPSE_ANIMATION_MS` is the sum of
`--duration-exit` and `--duration-shape`, taken from `MOTION_DURATION_MS` so
the three cannot drift.

A key being entered is app state, not field state, because it outlives the panel
it was started in: asking to write one stands the panel down to the slot, where
the same entry is drawn instead of in the settings row, and the entry remembers
whether the provider's key page was opened, which decides whether giving
up returns you to the panel or leaves the browser alone. Nothing that closes the
panel may discard the entry: the pointer leaving is already refused, and a slot
left alone is the normal case rather than a dismissal, so the settings tab and
the entry both survive a close and the field takes the caret back whenever the
shape it is drawn in comes forward again.

## Brand artwork

`design/generate-brand-assets.mjs` is the only place the artwork is described.
It writes three sets of committed outputs from that one description: the SVGs in
`design/brand/`, `packages/surface/src/generated/face-art.ts`, and
`apps/desktop/src/renderer/styles/generated/face-motion.css`. None of the three may be
hand-edited. Change the parameters or the motion table in the script, re-run it,
and commit what it writes. `repository-checks.sh` runs it with `--check`, which
compares every output without writing and fails on any drift.

The app draws the face rather than loading the SVGs because it needs
`currentColor` and CSS animation: `--face-motion` is what holds every loop still
for a capture run and for reduced motion, and SMIL answers to neither.

The face is still unless something is happening to it, and what is happening is
chosen in `luke-face-mood.ts`. A gesture plays once and a rest repeats, so only
a motion that stays true for as long as it holds may be a rest: speech, an open
microphone, and nothing whatever to watch. Everything else is a gesture, fired
at a change or drawn by weight from the pool between stillnesses, and a
gesture that carries meaning may only be offered while its meaning is true.

Two rules follow from playing a motion once, and both belong to the artwork
table rather than the app. Every motion the app plays begins and ends at the
resting pose, because one that starts elsewhere snaps there on the way in and
back out of it on the way out. Every layer of a gesture shares a period,
because the app hands the face back after the longest of them and a layer on
its own period would be cut wherever it had got to. A rest is under no such
rule: it is cut whenever its meaning stops being true rather than at any
boundary of its own, so its layers may run on offset periods. `talking` bobs
against its rock deliberately, like a person mid-sentence.

## Luke's knowledge of himself

`apps/desktop/src/renderer/luke-guide.ts` is the one place Luke's
self-knowledge is described: what Luke is on screen, every user-facing setting
with its current value, and where each is changed by hand. The renderer builds
an `AppGuideSnapshot` from it and sends it into the voice conversation inside
the session's own instructions, behind an `[app guide]` marker — build-fixed
prose belongs on the cacheable prefix rather than in a conversation item —
refreshed by a `session.update` on the same economy the roster items keep: at
the turn that reads it, only on the developer's call, and never re-sent
unchanged. The spoken
`change_app_setting` and `show_panel` tools are validated against that
snapshot, so the guide is simultaneously what Luke can say about himself and
the outer bound of what a spoken ask can do to him.

**When you add a feature or a setting, teach the guide about it in the same
change.** Stored settings are declared once, in `APP_SETTING_SCHEMA`: its guard
derives the stored and wire value type, its default feeds the store, and its
guide entry feeds Luke's guide, settings search, and the ordinary switch or
choice row on the page the entry names. There is no separate renderer record
whose completeness the compiler checks. A guide entry that deliberately
builds no row still needs a comment saying which fact or special control covers
it. The facts half has no compile lever either, so the rule is stated here: a
capability or act the guide does not describe is one Luke will deny having,
and a stale entry is one he will misdescribe.
The facts deliberately cover only what Luke needs to hold a conversation and
what a spoken ask may do — capabilities, acts, refusals, and their bounds. A
detail the developer should know but Luke never acts on (the surface's own
mechanics, a connector's internals, what an update check sends) stays with
the surface and the settings entries that already describe it, and the guide's
closing fact has Luke redirect what it leaves out rather than deny it. The
rule still binds in full at the act level: a new capability, act, refusal, or
bound lands here in the same change, as does any change to what a key does or
what a provider connection allows.

Rules the guide must keep:

- A spoken settings change runs only in a turn the developer opened by
  speaking, is validated against the guide before any carrier runs, and goes
  through the same bridge call the setting's own row uses, never a new write
  path.
- Mark a setting `adjustable` only after wiring its id into
  `applySpokenSetting`; the test suite refuses an adjustable entry the bridge
  cannot carry. A setting only a hand may change stays in the guide with
  `adjustable: false` and a `manual` path, because the refusal Luke voices is
  itself the guidance.
- Credentials are never adjustable, never spoken, and never described beyond
  whether a provider is connected. The guide leaves the machine, so nothing in
  it may carry a key, a key's shape, or an environment variable's value.
