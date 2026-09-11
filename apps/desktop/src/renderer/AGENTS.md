# The renderer

## It is a sandboxed browser context

The renderer reaches the main process through the preload bridge alone, so
`#shared/bridge`, the domain modules under `#shared/messages/`, and the wire
vocabularies the packages own (`@sidecar/settings/wire`,
`@sidecar/brain/requests-wire`) are the widest
doors it has. A `#main/` import compiles and
bundles happily and then fails in the browser, and a `node:` import does the
same. Neither is a mistake the type checker or esbuild can report, because
both are real modules that simply are not there at run time.
`repository-checks.sh` fails the build on either. A colocated `*.test.ts` is
exempt from the `node:` half: it runs under Node and never enters the bundle.

It reads app state one way: `app:state`, whose first delivery is this window's
bootstrap and whose every later delivery carries a version at least as high,
read through `use-app-state.ts` and never subscribed to twice. A delivery that
repeats the version is this window's own facts having moved — its mode, or the
display under it — which the document does not number. There is no separate
bootstrap call and no per-field push channel, so there is no "which arrived
first" for a component to answer. The channels that remain beside it are
events rather than state: a one-shot addressed to a named receiver that a
late subscriber must not receive and cannot reconstruct, or a reading that
expires before the next version of the document could carry it — which is
what the voice level is, twenty readings a second each good for fifty
milliseconds.

That one subscription is an `Atom` over the stream of the bridge's deliveries,
held in the registry `renderer-runtime.ts` makes and each root provides. The
runtime beside that registry is the bundle's one Effect edge, and not the
atoms' alone: `rendererRuntimeNow` hands it to work that is a fiber of its own
rather than an atom's, run through `Runtime.runFork` or `Runtime.runPromise`
on the value it answers — `use-voice-session.ts`'s remote-audio retry,
`voice/live-call.ts`'s own session-life fiber and its armed bounds,
`LiveVoiceOrchestrator`'s own standing-call lifecycle above it, and
`introduction-takeover.tsx`'s one `runCallEffect` helper, through which every
verb it asks of its own `LiveCall` runs — so nothing here builds a second
runtime to fork on. The
stream's scope is what installs the subscription, before anything is asked
for, so the one read a root awaits is a bootstrap rather than a race, and the
version rule above is a step of the stream rather than a comparison a reader
makes. `useAppState` is the hook over it, `appStateNow` the same value for a
callback that cannot wait a render, and both read the registry the root
provided, so a hook and a callback in the same window cannot disagree. A
component reading state reads one of those two and never the registry.

It causes effects one way: `app:act`, one invoke carrying one `{kind, payload}`
from `ACT_KIND`. The kind's own schema parses the payload here before the
invoke leaves and again in `main/act-router.ts`, that kind's trust checks run
there, and the answer is an `ActOutcome` — done with the kind's value, refused
with a sentence fixed by the build, or a kind this build does not know — so
nothing an exception happened to carry ever crosses back. `renderer/act.ts` is
the only caller: `act` for a row that reads the answer, and `tell` for an
effect whose answer nothing reads, which drops the refusal rather than leaving
it to surface as an unhandled rejection. A new command is a new `ACT_KIND`
entry with its payload schema, its answer's guard, and its one router row;
there is no second write path to add one on. The channel itself is an
`Atom.fn` on the runtime `renderer-runtime.ts` builds, and `useAct()`'s
`useAtomSet` is the only way to it: `act` and `tell` are its bound handle's
members, reached by every component and hook, including
`settings/writes.ts`'s `useSettingsWrites`. The one caller outside any render
tree, `index.tsx`'s bootstrap-failure path, takes the window's own
`window.sidecar.act` directly rather than through a promise door this bundle
no longer keeps.

Two renderers run under the same rule, and they are two bundles rather than
one bundle branching on a role. The panel's is `renderer/index.tsx`, which
draws the panel — or the spoken introduction, a fullscreen mode of the panel
drawn instead of `App` while `state.introduction.playing`, not a window of its
own; the hidden voice window's is
`renderer/voice/index.tsx`, and everything it mounts lives under
`renderer/voice/`: the live peer, the microphone, the level meters, the element
Luke's voice plays through, and the hook that drives `LiveVoiceOrchestrator`
(`@sidecar/voice/orchestrator`) and reports its view to the main process.
It reaches the main process through the same bridge, under the same sandbox,
and it can neither mount `App` nor import `session-replay.ts` — neither is
reachable from its entry, so the bundler is what holds the line rather than a
grep. The panel is the one surface that records, and a recording of a blank
hidden window would be a session nobody consented to. A panel draws the voice
state that arrives in its `app:state` snapshot and forwards its presses back as
acts; it constructs no call of its own.

The policy behind that hook is not the renderer's at all. Whether a session
stands, what the talk key and the stop key do to its microphone — the key is
held to talk: `beginTalk` on the press opens a session if none stands and
unmutes, `endTalk` on the release only mutes, `stopSpeaking` mutes the same way and
asks the host over the bridge to tell the model to stop first only while it is
speaking,
and a release or stop during the press's opening leaves the session muted —
how the host's `voiceLiveSession.changed` is obeyed — wanted opens a session
with no microphone, closing hangs up, a session lost while the key is still
held listens again on the next — and what view the panels draw are
`LiveVoiceOrchestrator` in `@sidecar/voice`, which touches no DOM: what the
hook supplies is the call it drives, and what it takes back is one view to
report and the two streams only a browser can play or meter. The hook
subscribes both talk-key edges, `onVoiceHotkeyPress` and
`onVoiceHotkeyRelease`, from main's native watcher; under the Electron
fallback main alternates the two across presses, since that key reports no
release.

The voice window is a GPT Live peer and nothing more. `voice/live-peer.ts`
builds the `RTCPeerConnection` in the WebRTC guide's order — the audio line
first (for a session a press opened, the preferred microphone track added
with `enabled` false; for one opened for Luke's own speech, the peer's own
silent track, synthesized from an `AudioContext` destination node nothing
feeds, so no capture device stands behind a session nobody pressed for), the
`oai-events` data channel created before the offer,
ICE gathered under a bound, the offer handed to the host through
`ACT_KIND.VOICE_CREATE_LIVE_SESSION`, the host's SDP answer set — and never
sends `session.start`, because the host's request is what started the
session. The line carries a track at every moment of the session's life,
because GPT Live is full duplex and paces its output against the input
timeline: the conversations guide asks that input audio keep running through
silence and that the negotiated WebRTC input track stay active, and a sender
left with no track stalled that timeline, so a reply the host appended while
the talk key was up was held until the next press restored a track and then
unloaded whole. It hands the peer over acquired into the caller's `Scope`
rather than to be closed by hand, so the connection, the silence, and the
device that rode its offer are released when that scope closes, and a scope
closes once. `voice/live-call.ts` is that scope's owner and a table of handlers keyed by
`LIVE_SERVER_EVENT` over `parseLiveServerEvent`. The session's life is one
fiber on the runtime above, holding the scope the peer was acquired into: the
fiber ends when the call does, or when it is interrupted, and either way the
peer is released exactly once. Every bound the call keeps — the start, the
graceful close, the microphone acknowledgment, the speaking hangover, the
caption tick, the idle window — is an `Effect.sleep` forked into that same
scope, so nothing is left armed behind a session that ended and a test drives
all six by advancing a `TestClock` rather than by standing a timer seam in.
The four verbs the policy above the peer holds answer Effects, run on the
fiber the caller already has rather than converted to a promise here. It
waits for
`session.started`, sends only the mute, the unmute, and the close the data
channel permissions allow it, opens the capture device for an unmute when
none stands and puts it on the line before the switch goes, flips the track
only on the `muted` or `unmuted` acknowledgment, and after every mute —
acknowledged, refused, or timed out, in that the key being up is the
developer's decision — swaps the silent track back onto the line with
`replaceTrack` and stops the device, so the microphone is open exactly while
the talk key is held and the model's input timeline never stops; it hangs up
the way the conversations guide says
(`session.closed` registered, `session.close` sent, everything held open
under the bound), reports its transport and its one idle decision to the
host, and reads Luke as speaking from the remote track's level, never from
a transcript event; that level is activity on the session too, so a briefing
the developer only listens to re-arms the idle window rather than being
reported idle under it. `voice/live-captions.ts` draws both speakers from the
transcript deltas over the same `TranscriptLedger` the host groups its record
with, so the captions and the lines agree on what an utterance is. No
credential reaches this window, nothing here appends to the model, and the
window writes no Conversation line: every append and both speakers' lines
are the host's, from the transcript its trusted sideband receives. The
`index.html` CSP's `connect-src` is `'none'`, since the SDP exchange crosses
main and WebRTC media needs no fetch.

The spoken introduction in `renderer/introduction/` is a peer of the same
kind, over the same `LiveCall`, with the introduction's own two acts behind
it: `ACT_KIND.INTRODUCTION_CREATE_SESSION` carries the offer and the detected
titles (bounded to `INTRODUCTION_SEED_BOUNDS`) to the accountless session the
main process holds, and `ACT_KIND.INTRODUCTION_END_SESSION` is the hang-up.
The order is the Live guide's greeting before the caller speaks: the
microphone is asked for first, at the developer's press, and the session
opens only once it is granted; the greeting is the voice service's, the
takeover sends nothing but the microphone switch and the hang-up, and it ends
when Luke's output has gone quiet by the ledger's settle and the remote
track's level (`introduction-quiet.ts`), never by a missing event. The panel
window's `connect-src` names no OpenAI host: nothing in this bundle fetches
one any more.

The same trap arrives through a package barrel, where nothing greps for it.
Importing `@sidecar/calendar` for one string constant resolves that package's
whole export graph, `node:http` included. Packages that hold both a vocabulary
and a Node flow open a door for the vocabulary alone. Import
`@sidecar/calendar/vocabulary`, `@sidecar/credentials/snapshot`,
`@sidecar/providers/superset/sign-in-stage`, not the barrel.

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
it was started in: asking to write one stands the panel down to the slot — one
`SecretSlot` for every secret anyone pastes into Luke, because to a hand a
one-time code and an API key are the same errand with a different word on it —
where the same entry is drawn instead of in the settings row, and the entry
remembers whether the provider's key page was opened, which decides whether giving
up returns you to the panel or leaves the browser alone. Nothing that closes the
panel may discard the entry: the pointer leaving is already refused, and a slot
left alone is the normal case rather than a dismissal, so the settings tab and
the entry both survive a close and the field takes the caret back whenever the
shape it is drawn in comes forward again.

## Connections and confirms

Every connection Luke can hold is one entry in `CONNECTION_SCHEMA`: where its
row stands, its mark, its name, how its status is read off the settings
snapshot, and every action its row offers. `<ConnectionRow>` is the only
component that draws one, so five integrations cannot describe themselves five
ways, and a connection this build cannot offer contributes no row rather than a
row whose one action cannot run. An entry's own `offered` is judged from the
settings snapshot alone, which is what the settings search reads too — so a
result can neither lead to a page without its row nor go missing from a page
that has one, and a row's name in a result is the name the row itself draws.

Any action that cannot be undone from inside the panel asks first, through
`<ConfirmSwap>` over `confirm-state.ts`. Two rules the confirm keeps, and the
reason each is a function rather than a convention: a question does not outlive
its subject — a confirm left standing where a key used to be would be pointed
at whatever is stored there next — and it does not outlive the surface it was
asked on, because one still waiting behind a closed panel would be the first
thing under the pointer the next time it opened, with nobody having asked for
it. An answer already sent is the exception to both: it is no longer a
question, so it finishes wherever it is. `useConfirm` is where all three live;
a row holding a bare `useState(false)` keeps none of them.

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
an `AppGuideSnapshot` from it and reports it to the main process over
`reportAppGuide` whenever it changes; main renders it behind an `[app guide]`
marker into the brain's standing context, the build-fixed prose every turn
reads, and never into a conversation item. The voice is only the brain's
mouth and carries no guide of its own. The brain's `change_app_setting` and
`show_panel` actions are validated against that same snapshot in the renderer, so
the guide is simultaneously what Luke can say about himself and the outer
bound of what an ask can do to him.

**When you add a feature or a setting, teach the guide about it in the same
change.** A stored setting is declared once, in `APP_SETTING_SCHEMA`, through
the builder for its kind: its guard derives the stored and wire value type, its
default feeds the store, its `page`, `section`, and `order` place its row, its
`visible` decides whether that row and its search result stand, its
`sideEffect` names an entry in the host's and the client's side-effect tables —
both `Record`s over every id, so a new effect does not build until both sides
say what it does — and its guide entry feeds Luke's guide and the settings
search. There is no separate renderer record, and no `switch`, whose
completeness the compiler does not check. A setting that deliberately builds no
row says so as `rows: SETTING_ROWS.NONE` rather than as a comment. The settings
half of the guide is generated from those entries and has no hand-written copy
anywhere, so it cannot go stale; the facts half is written by hand, in full, and
always will be — the rule below is the only lever it can have. That lever is a
weak one: a test asserts that a fact exists for every label the guide's own list
names, which fails when a fact is deleted and says nothing about whether one is
true. So the rule is stated here: a capability or action the guide does not
describe is one Luke will deny having, and a stale entry is one he will
misdescribe.
The facts deliberately cover only what Luke needs to hold a conversation and
what a spoken ask may do — capabilities, actions, refusals, and their bounds. A
detail the developer should know but Luke never acts on (the surface's own
mechanics, a connector's internals, what an update check sends) stays with
the surface and the settings entries that already describe it, and the guide's
closing fact has Luke redirect what it leaves out rather than deny it. The
rule still binds in full at the action level: a new capability, action, refusal, or
bound lands here in the same change, as does any change to what a key does or
what a provider connection allows.

Rules the guide must keep:

- A settings change asked of Luke runs only in a turn the developer opened,
  by speaking or by typing, is validated against the guide in the main
  process and again here before any carrier runs, and goes through the same
  `ACT_KIND.SETTING_UPDATE` act the setting's own row mints, never a new
  write path.
- Mark a setting `adjustable` only after wiring its id into
  `applySpokenSetting`; the test suite refuses an adjustable entry no act kind
  can carry. A setting only a hand may change stays in the guide with
  `adjustable: false` and a `manual` path, because the refusal Luke voices is
  itself the guidance.
- Credentials are never adjustable, never spoken, and never described beyond
  whether a provider is connected. The guide leaves the machine, so nothing in
  it may carry a key, a key's shape, or an environment variable's value.
- A setting's page, the section of that page it stands in, its order there, and
  whether its row is drawn are the schema entry's answers and nobody else's. A
  page component that decided for itself which fields it renders is a second
  record of the same fact, and the two will drift; `SchemaSettingRows` is the
  only renderer of a schema row, and a setting whose control cannot be one is
  `rows: SETTING_ROWS.BESPOKE` with the component that draws it named beside
  the declaration.
