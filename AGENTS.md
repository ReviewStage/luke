# Agent guide

Luke is a macOS-first Electron sidecar that observes coding-agent sessions while
preserving existing provider workflows. Product naming belongs at the app and
packaging boundary; keep reusable implementation types brand-neutral.
Deployable products belong in `apps/`, and reusable packages belong in
`packages/`. Keep Electron main/preload code in `apps/desktop/` thin, keep the
renderer sandboxed, and put platform-independent behavior in
`packages/sidecar-core/`.

Canonical commands:

- `./scripts/bootstrap.sh` — install pinned workspace dependencies
- `./scripts/check.sh` — run portable repository, type, test, and build checks
- `./scripts/test-macos.sh` — package and validate the macOS app
- `./scripts/verify.sh` — complete macOS validation plus visual evidence
- `pnpm release:macos` — create a local signed, notarized, and verified DMG
- `./scripts/run.sh` — launch the app against live sessions, replacing any
  running instance (`--fixture smoke` for fixture data, `--keep-running` to keep
  the running instance)
- `./scripts/evidence.sh` — write the fixture PNG under `artifacts/`
- `pnpm evidence:record` — record the fixture transition on a physical Mac
- `pnpm lint:fix` — apply repository formatting and safe lint fixes

Trust constraints:

- Never write provider transcripts or session-state files. Reading them is what
  Luke is for; writing to them is never.
- Never inject terminal input, simulate keystrokes, or request Accessibility.
- Product behavior must not require provider MCP, plugins, hooks, wrappers,
  credentials, or live sessions. A provider whose sessions exist only in a cloud
  service may read a user-supplied API key, but it must observe nothing until
  the user supplies one and must leave every other provider working without it.
- The one thing Luke may change about a session is what the user just asked to
  send it: a message typed on its row, a control its provider advertised for
  it, or the same two acts asked of Luke — out loud, or typed into his own
  composer — in a conversation the user is holding — each through the
  provider's own documented endpoint under the same user-supplied credential,
  and each validated against the observed roster before an adapter sees it.
  Observation passes stay read-only by construction; where a provider's
  documented read answers only a POSTed query — Conductor's transcripts view,
  like Linear's GraphQL — observation sends a read document fixed by the
  build, and nothing enters that document's text but identifiers the same
  pass reported, each validated against the shape its provider documents.
  Nothing that decides on the user's behalf may reach a write path: the
  attention evaluator above all, and every turn Luke opens himself — a
  proactive readout, the reply that voices a tool's outcome — which carries no
  tools, at the API and again at a runtime gate, so a session summary or a tool
  output that reads like an instruction can never become an act. A tool call
  in that conversation runs only in a turn the developer opened themselves, by
  speaking or by typing; a write is the direct product of a turn the developer
  opened, never of anything Luke read or was told. The one act not aimed at an
  existing session keeps the same shape: a new workspace, asked of Luke in
  conversation, lands only in a project its provider reported on the latest
  observation pass and documents a creation endpoint for — the ask names a
  reported project, never a repository URL or path of its own, and a provider
  that documents no such endpoint offers nowhere to create. The ask may carry
  the new agent's opening task — the developer's own words, bounded and
  delivered like a message to an existing session, through the provider's
  documented endpoints — and each project says whether it takes one, needs
  one, or takes none, so a provider that cannot make an idle workspace is
  offered no task-less ask and one that takes no task is handed none. Another
  agent in a workspace already observed is the same ask at one remove: it
  lands only in the workspace behind a roster row, as one of the agent kinds
  that row's latest observation listed, through the provider's documented
  endpoint — a session whose provider lists none takes no such ask. A session whose provider documents no way in, or whose current state is
  documented for none, advertises nothing and is offered nothing; local
  sessions have no such endpoint and stay entirely read-only. Opening a
  session — its row pressed, or the same press asked of Luke in conversation —
  is not a write and needs no endpoint: the address its provider reported is
  handed to the operating system, and nothing reaches the provider; an open
  asked of Luke still runs only in a developer-opened turn, and a session that
  reported no address is offered nowhere to open.
- The issue tracker follows the same rule at one remove. Luke reads the issues
  a tracker lists for the user under a user-supplied key and observes nothing
  without one, exactly like a cloud session provider. The two acts a tracker
  takes — moving an issue to a state its latest observation listed, adding a
  comment — happen only as the direct product of a turn the developer opened
  themselves, through the tracker's own documented endpoint under the same
  key, validated against the observed issue roster in the renderer and again
  in the main process before the tracker client sees anything. Observation
  sends only the read document; the write documents are fixed by the build and
  issued only for a validated act.
- Quieting other media is bounded the way the talk key is: a native helper that
  can do one narrow thing. While a spoken exchange is live, Luke may lower the
  volume of the players the helper names — Music and Spotify, through their own
  scripting interfaces, behind the system's per-app consent — and restore it
  afterwards. He never pauses them and reads nothing beyond whether each is
  playing and how loud; a volume the user moved during the duck stays where
  their hand put it; and the whole behavior is a setting. The trigger is the
  exchange itself — a deterministic status edge, never anything Luke read,
  heard, or decided — so no model output can reach it. Widening the player
  list is a product decision, not an implementation detail.
- The same shape, smaller still, watches whether Luke can be heard at all: a
  native helper reads the default output device's mute switch and volume —
  nothing else — and can write nothing. What it learns decides only what the
  renderer draws while Luke speaks into that silence: his captions forced on,
  and a hint asking for volume. Luke never changes the system volume himself;
  turning it up stays the user's own act on their own keys.
- Keep unsupported capabilities explicit; do not invent fallback controls.
- Keep Electron renderers sandboxed with context isolation and narrow IPC.
- Commit only synthetic fixtures and repository-relative paths. This binds
  harder as Luke observes more: a fixture copied from a real session now carries
  a real title, branch, and recap.

What Luke may show:

- Show whatever the local surface can read. A session's own title, branch,
  model, current tool, failure, and the recap a provider wrote about it all
  belong on the row: a sidecar that cannot tell two sessions apart is not worth
  the space beside the housing. This is the user's own data, on the user's own
  screen, and it is read-only.
- Label a session by what its provider named it, falling back to the workspace
  or repository only when there is no name yet. Do not compose a sentence in an
  adapter; report the fields and let the surface word them.
- A recap may be the agent's own parting words. A provider that designates no
  recap field but hands over the conversation itself — Conductor's transcripts
  view — is read for a bounded tail of its transcript, and the last message's
  words become the recap only when that message is attributably the agent's
  and the chat is idle or closed: a settled turn's parting words say where the
  work stands, where half a sentence mid-turn poses as an outcome. The tail is
  inspected in memory and discarded — the bounded recap is all that is ever
  reported, and the history behind it is never read at all.
- Session material leaves the machine unbidden in exactly two places, each
  with its own narrower rule. An evaluator receives `AttentionContext` — what
  a provider wrote *about* a session — and never the transcript behind it: no
  message history, file contents, or command output. A recap counts as *about*
  even when it is the agent's own parting words — the one bounded line saying
  where the turn ended, the same standing as a recap a provider designated —
  but the transcript it was read from never travels. A spoken announcement — a
  session that started waiting, stopped on an error, or finished, worded on
  this machine — reaches the voice service so it can be said aloud; when no
  conversation is open, Luke opens a call of his own to say it, and that call
  is speak-only by construction: it offers no microphone track, carries no
  tools, and is sent the announcement sentence alone — never the roster, the
  guide, or the issues, which travel only on conversations the developer
  opens. Its trigger is a deterministic status edge, never anything a model
  decided, and the whole behavior is a setting. Widening either set is a
  product decision, not an implementation detail; make it deliberately.

Before handoff, run `./scripts/check.sh` for portable-only changes. For any
macOS or UI change, `./scripts/verify.sh` is the completion invariant. Report
exact results; UI changes also require inspection of the visual evidence and a
note stating whether a physical-notch check was performed. CI links generated
evidence from the pull request description. Attach physical-device screenshots
or recordings through GitHub's PR editor; do not commit generated evidence or
one-off QA worksheets. Keep generated state and private planning files
untracked.

Biome is the executable style policy for TypeScript, JavaScript, JSON,
Markdown, and CSS. Husky runs the same checks against staged files as a local
convenience; `./scripts/check.sh` and CI remain authoritative.

## Git workflow

- Follow [Conventional Commits
  1.0.0](https://www.conventionalcommits.org/en/v1.0.0/) for commit messages.
- Format PR titles as `type[(scope)]: description`, using the matching type
  (`feat`, `fix`, `docs`, `chore`, etc.).
- For Linear work, use its suggested branch name when available and the ticket
  ID as the scope: `feat(LUKE-123): add Codex support`.
- When a PR branch falls behind or conflicts with origin/main, run
  `git rebase origin/main` and force-push (`git push --force-with-lease`); do
  not create merge commits from main on the branch. Main squash-merges
  through a merge queue, so merge commits never survive to main anyway, and a
  branch left conflicting with main silently stops all `pull_request` CI runs
  (GitHub cannot build the merge commit) — keeping branches rebased is what
  keeps CI running.

## Panel motion

DESIGN.md is the binding contract for how anything drawn on the surface may
move — the spring vocabulary, how content joins and leaves a resizing shape,
and how a motion change is proven. Read it before adding or altering any
animation; this section covers only the window and the surface themselves.

The window is a stage; the drawn surface is the shape. A window therefore holds
the largest shape its mode can draw — a compact window holds the peek and an
expanded one holds the slot as well as the panel, so neither hovering nor
stepping aside for a browser costs any IPC — plus `SURFACE_MARGIN` on every
side, which is what the spring overshoots into and the shadow falls in. Anything the shape does not cover is
transparent and must stay click-through, so hit regions track the shape rather
than the window.

The shape's depth is the menu bar's painted depth, not the safe-area inset. The
inset is the region apps must avoid; macOS may paint the bar deeper than it, and
a shape built on the inset stops short of the strip it has to pass for.

The window never animates its own frame. An animated `setBounds` re-lays out
the whole renderer on every frame, because the panel is anchored to the
viewport's centre. Everything layered on the surface must move with `transform`
and `opacity` only — animating width, height, padding, or font-size on the
wings, the count badge, or the rows re-shapes text on every frame and is what
makes the motion stutter.

The surface is opaque in every state — it has to pass for part of a physical
object, and nothing behind the window may show through it — and takes its
shadow and hairline edge once it has grown past the housing. The panel's
shadow is delayed until the shape settles, because a blurred shadow repaints on
every frame that resizes the element; the peek's is small enough to ride along.
`backdrop-filter` is not an option: a transparent window has no backdrop to
sample, so it would buy a render surface on the animating element and return
nothing.

One spring for everything that moves. `--spring` drives the surface;
`--spring-fast` is the same damping ratio at a higher frequency for small
elements like the tab thumb, so the bounce profile is identical and only the
scale differs. Panel content arrives as one stack: the tab bar is index 0 and
each row below it starts further up, so the gaps spring open rather than the
rows sliding in as a block. The fan and the stagger stop accumulating past
`--row-fan-limit`, because only about five rows are ever on screen.

In either direction the shape and its content must not cross, or content is
left drawn on the desktop: growing, the surface leads and content follows;
shrinking, content leaves over `--duration-exit` before the surface moves.
`setWindowMode` owns the ordering for every caller — the panel, the tray, and
the motion recorder alike. `COLLAPSE_ANIMATION_MS` is the sum of
`--duration-exit` and `--duration-shape`, taken from `MOTION_DURATION_MS` so
the three cannot drift.

A key being entered is app state, not field state, because it outlives the panel
it was started in: asking to write one stands the panel down to the slot, where
the same entry is drawn instead of in the settings row, and the entry remembers
whether the provider's key page was opened — that is what decides whether giving
up returns you to the panel or leaves the browser alone. Nothing that closes the
panel may discard the entry: the pointer leaving is already refused, and a slot
left alone is the normal case rather than a dismissal, so the settings tab and
the entry both survive a close and the field takes the caret back whenever the
shape it is drawn in comes forward again.

## Brand artwork

`design/generate-brand-assets.mjs` is the only place the artwork is described.
It writes three sets of committed outputs from that one description: the SVGs in
`design/brand/`, `apps/desktop/src/renderer/luke-face-art.ts`, and
`apps/desktop/src/renderer/styles/face-motion.css`. None of the three may be
hand-edited — change the parameters or the motion table in the script, re-run it,
and commit what it writes. `repository-checks.sh` runs it with `--check`, which
compares every output without writing and fails on any drift.

The app draws the face rather than loading the SVGs because it needs
`currentColor` and CSS animation: `--face-motion` is what holds every loop still
for a capture run and for reduced motion, and SMIL answers to neither.

The face is still unless something is happening to it, and what is happening is
chosen in `luke-face-mood.ts`. A gesture plays once and a rest repeats, so only
a motion that stays true for as long as it holds may be a rest: speech, an open
microphone, and nothing whatever to watch. Everything else is a gesture — fired
at a change, or drawn by weight from the pool between stillnesses — and a
gesture that carries meaning may only be offered while its meaning is true.

Two rules follow from playing a motion once, and both belong to the artwork
table rather than the app. Every motion the app plays begins and ends at the
resting pose, because one that starts elsewhere snaps there on the way in and
back out of it on the way out. Every layer of a gesture shares a period,
because the app hands the face back after the longest of them and a layer on
its own period would be cut wherever it had got to. A rest is under no such
rule: it is cut whenever its meaning stops being true rather than at any
boundary of its own, so its layers may run on offset periods — `talking` bobs
against its rock deliberately, like a person mid-sentence.

## Shared surface vocabulary

`design/generate-surface-shared.mjs` is the only place the motion tokens, the
layout sizes the window and the drawing share, the provider-mark path data,
and the session urgency value set, labels, and order are described. It writes
four committed outputs into `packages/sidecar-core/src/`: `motion-tokens.css`,
`motion-tokens.ts`, `provider-mark-paths.ts`, and `session-display.ts`. None of
the four may be hand-edited — change the tables in the script, re-run it, and
commit what it writes. `repository-checks.sh` runs it with `--check`.

The desktop renderer and the marketing mock both consume those outputs. The
React that traces a mark stays in each app, because the desktop ships marks
the mock does not, and a shared component would pull that into the web bundle.

## Luke's knowledge of himself

`apps/desktop/src/renderer/luke-guide.ts` is the one place Luke's
self-knowledge is described: what Luke is on screen, every user-facing setting
with its current value, and where each is changed by hand. The renderer builds
an `AppGuideSnapshot` from it and sends it into the voice conversation as
`[app guide]` context, the same way the session roster travels; the spoken
`change_app_setting` and `show_panel` tools are validated against that
snapshot, so the guide is simultaneously what Luke can say about himself and
the outer bound of what a spoken ask can do to him.

**When you add a feature or a setting, teach the guide about it in the same
change.** The settings half is compile-enforced: `SETTING_GUIDE` is a `Record`
over every key of `AppSettings`, so a new settings field does not build until
you either write its guide entry or return `undefined` with a comment saying
how the guide covers it instead. The facts half has no such lever, so the rule
is stated here: a capability, surface, or shortcut the guide does not describe
is one Luke will deny having, and a stale entry is one he will misdescribe.
Update the facts whenever you change what the panel holds, what a key does, or
what a provider connection means.

Rules the guide must keep:

- A spoken settings change runs only in a turn the developer opened by
  speaking, is validated against the guide before any carrier runs, and goes
  through the same bridge call the setting's own row uses — never a new write
  path.
- Mark a setting `adjustable` only after wiring its id into
  `applySpokenSetting`; the test suite refuses an adjustable entry the bridge
  cannot carry. A setting only a hand may change stays in the guide with
  `adjustable: false` and a `manual` path, because the refusal Luke voices is
  itself the guidance.
- Credentials are never adjustable, never spoken, and never described beyond
  whether a provider is connected. The guide leaves the machine, so nothing in
  it may carry a key, a key's shape, or an environment variable's value.

## TypeScript value sets and keys

- Do not use stringly typed fixed value sets. Define `as const`
  SCREAMING_SNAKE_CASE objects, derive unions with
  `typeof VALUE_SET[keyof typeof VALUE_SET]`, and use the constants at call
  sites. Raw strings are only for freeform, user-facing text.
- Do not construct keys by concatenating or interpolating identifiers. Use
  nested objects or nested `Map` instances keyed by the original identifiers.
