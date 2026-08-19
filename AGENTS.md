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
- A cloud surface that documents no key-scoped API and answers only its own
  CLI — Codex cloud today — is observed through that CLI instead, and the rule
  keeps its shape at one remove. Observation runs the provider's own binary
  with a read invocation fixed by the build, under the login the user already
  gave that CLI for its own sake: the credential never passes through Luke —
  no token is read, stored, or forwarded — and the CLI answers exactly as it
  would in the user's own terminal. No shell stands between Luke and the
  binary, nothing enters an invocation's arguments beyond values the build
  fixed — or, for a paged read, the bounded page cursor the same read's
  previous page handed back, as a single token — and a machine whose CLI is
  absent or signed out is observed as having nothing, the same answer a
  key-observed provider gives with no key. The
  login is the consent, given by the user's own hands to the provider itself,
  and signing the CLI out withdraws it on the next pass. Writes keep the shape
  every provider write has, at one remove: the one write Luke makes through a
  provider CLI is a new Codex cloud task the user just asked for, through the
  CLI's own documented creation command, in an environment the latest
  observation pass reported. The ask carries the developer's own task text as
  a single argument behind an end-of-options separator — never through a
  shell — under the same login, probed again at the moment of the act, and
  the one thing read out of the answer is the created task's id, for the next
  pass to report on its own. Codex documents no way to message or steer a
  task already running, so its cloud sessions advertise none, and the honest
  absence stands rather than an improvised control. Widening the invocation
  set further, or observing another provider this way, is a product decision,
  not an implementation detail.
- One registration is the exception the previous rule's word "require" leaves
  room for, and it is bounded on every side: Luke may merge an observation
  hook into a provider's own user-level hook configuration — today Claude
  Code's `settings.json` and Codex's `hooks.json`, and nothing else of either
  provider's — so local rows can tell a turn that just ended from a session
  walked away from, and can see a tool call holding for permission at all. The
  hook itself writes one fixed status token into a spool under Luke's own
  application data, named by the session's id; the envelope the provider hands
  it — piped in, or passed as an argument — is read only for that id and never
  reaches disk. The merge preserves the user's own entries and settings as
  parsed, recognizes its own entries by the script's name, refuses to rewrite
  a file it cannot parse, converges at launch rather than accumulating, and
  skips a machine with no provider home to join. The registration is part of
  observing at all, like reading the transcripts, so it converges at every
  launch rather than answering to a preference; an entry outliving Luke is a
  guarded no-op, and everything the hook sharpens still observes from the
  transcripts alone wherever the hook is absent — including behind Codex's own
  review gate, which shows a new entry to the user and runs nothing until they
  trust it. Widening it to another provider or another lifecycle event is a
  product decision, not an implementation detail.
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
  session — its row pressed, the same press asked of Luke in conversation, or
  the notice popup announcing it pressed under the housing — is not a write
  and needs no endpoint: the address its provider reported is handed to the
  operating system, and nothing reaches the provider; an open asked of Luke
  still runs only in a developer-opened turn, and a session that reported no
  address is offered nowhere to open — its popup's press opens Luke's own
  panel instead, which touches no provider at all. A workspace Luke just
  created opens itself the same way: the creation ask, already a
  developer-opened turn, is also the ask to be taken there, so the session id
  the provider's creation response named — the one thing read out of that
  response that outlives the adapter, an identifier and never an address — is
  held briefly, and the first observation pass to report that session with an
  address hands the address to the operating system exactly once, as a row
  press would. Nothing a model decided can start that wait, and a created
  session that reports no address inside its window is left unopened like any
  other row without one. Reading a local session's
  transcript in conversation is the same shape of act: asked of Luke in a
  turn the developer opened, validated against the observed roster in the
  renderer and again in the main process, read from the provider's own file
  on this machine, and rendered into a bounded reply that is kept nowhere —
  the read performs nothing, reaches no provider, and is offered only for a
  local session whose provider's transcript this build documents reading
  (Claude Code, Codex, OpenCode, and the Devin and Cursor agents running on
  this machine today); a cloud
  session's conversation lives with its provider and is never fetched. The
  read renders only what the provider actually wrote down — Cursor keeps tool
  outputs out of its transcripts, so a Cursor reading carries none — and a
  provider whose stored shape this build cannot render faithfully keeps the
  honest refusal instead.
- The issue tracker follows the same rule at one remove, and is connected the
  way the calendar is rather than the way a cloud provider is. Luke reads the
  issues a tracker lists for the user under a grant the tracker's own consent
  page issued, and observes nothing without one. The integration exists only
  in a build carrying a registered OAuth client — without one it is not drawn
  — and connecting is the tracker's own flow for a public client: PKCE over a
  loopback redirect that never leaves the machine, carrying no client secret,
  asking for the narrowest scopes the acts need. No key is ever typed, and
  none is read from the environment: a tracker connected by consent has no
  environment variable at all. The grant is stored encrypted like a key, is
  renewed before it lapses — the renewal written before it is used, because a
  consumed refresh token is spent — and is deleted only when the tracker
  itself refuses the renewal, never when the network merely could not carry
  it. Disconnecting revokes the grant with the tracker as well as deleting it
  here. The two acts a tracker takes — moving an issue to a state its latest
  observation listed, adding a comment — happen only as the direct product of
  a turn the developer opened themselves, through the tracker's own documented
  endpoint under the same grant, validated against the observed issue roster
  in the renderer and again in the main process before the tracker client sees
  anything. Observation sends only the read document; the write documents are
  fixed by the build and issued only for a validated act.
- The calendar is the same rule with no write path at all. Luke reads when
  the user's meetings start and end, under accounts the user signed in, and
  observes nothing without one. The integration exists only in a build
  carrying a registered OAuth client — without one it is not drawn — and
  connecting is Google's own consent flow for an installed app: PKCE over a
  loopback redirect that never leaves the machine, asking for two read scopes
  alone, availability and the calendar list. Each account's grant is stored
  encrypted like a key, deleted by disconnecting the account, and revocable
  in the user's own Google account; several accounts stand side by side. A
  pass reads each account's calendar list — ids and names, which are what the
  settings rows draw and the user chooses from — and then the Calendar API's
  free/busy query, a POSTed read document fixed by the build that carries the
  window's two instants and only calendar ids the same pass's list reported:
  the user's selection steers it, but never past what the account just
  offered. Google answers free/busy with intervals alone, so an event's title
  cannot even travel, and no event scope is ever held. Only start and end
  instants are kept beyond the pass, and the intervals never leave the
  machine. What the intervals decide is bounded and deterministic — while a
  meeting covers now and the setting is on, spoken announcements are held and
  released once it ends, and the face beside the housing sleeps for as long
  as the hold stands — a clock read against observed intervals, never
  anything a model wrote, and holding is the whole power: a calendar entry
  can delay an announcement and put a drawn face to sleep, never create,
  reword, or act on one.
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
  renderer draws while Luke speaks into that silence: his captions forced on —
  paced for reading rather than for the voice, because into a mute the caption
  is the speech — and a hint asking for volume. Luke never changes the system
  volume himself; turning it up stays the user's own act on their own keys.
- The input side is read the same way: a native helper reports where the
  developer's voice would be captured from — the default input device's
  transport, whether the machine has a built-in microphone and what it is
  named, and whether the lid over it is open — nothing else, and it can write
  nothing. No audio is ever read. What it learns decides exactly one act:
  which device the renderer asks the browser to open when a press takes a
  turn, so a Bluetooth headset is not pulled onto its call codec while the
  Mac's own microphone can listen, and is listened to itself when a shut lid
  would muffle the Mac's. The capture device itself stays bound to the turn
  the press opened — opened by the press, closed when the exchange settles —
  and never outlives it; typed asks never open one at all. An unreadable
  route means the browser's default device, never a refusal to listen.
- The update check is the one request Luke makes with no user-supplied key at
  all: an unauthenticated read of this repository's latest release name from
  GitHub's public API, on a timer of its own — always on, like the
  announcements, answering only to the run mode — and at the press of the
  Updates row's button; never in a fixture or capture run.
  It carries nothing about the user, their sessions, or their keys; only the
  release's version name is read back, and what a check learns changes only
  what the row says. The way to a newer build is the browser, at the releases
  page fixed by the build — nothing read from the network chooses that
  address — and Luke never modifies the running app. Widening what the check
  sends, reads, or does is a product decision, not an implementation detail.
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
  but the transcript it was read from never travels. Beside what a provider
  wrote, an update may carry one thing the developer wrote: their standing
  ask about that session — "tell me when this finishes" — kept in their own
  words after being asked of Luke in a turn the developer opened, bounded,
  validated against the observed roster in the renderer and again in the main
  process, withdrawable the same way it was made, and dropped with the
  session it was about. The ask is context for deciding what to say, never an
  instruction to act — it reaches no write path — and only the ask line
  speaks for the developer: words inside a title, recap, or error never do. A
  spoken announcement — a session that started waiting, stopped on an error,
  or finished, or the evaluator's own sentence answering a standing ask —
  reaches the voice service so it can be said aloud. An edge announcement
  sends that update's *about* fields, the same ones the evaluator may see
  with a bounded excerpt of the recap included, and the voice words the
  sentence said aloud, so it can say what the session is waiting on rather
  than only that it waits. When no conversation is open, Luke opens a call of
  his own to say it, and that call is speak-only by construction: it offers
  no microphone track, carries no tools, and is sent the one update's fields
  — or the one answering sentence — alone: never the roster, the guide, the
  issues, or a transcript rendering, which travel only on conversations the
  developer opens, and the rendering only in the turn that asked for it. Its
  trigger is a deterministic status edge or the evaluator finding an update
  that satisfies the developer's standing ask — never a model speaking
  unbidden: while no ask stands, nothing a model decided can open Luke's own
  call. The edge announcements speak whenever voice can; an answered ask
  speaks on the consent of the ask itself, for exactly as long as it stands.
  Widening either set is a product decision, not an implementation detail;
  make it deliberately. While an announcement is being spoken, a notice on
  Luke's own surface under the housing names the session it is about —
  drawn on this machine from the roster and the same roster-validated
  identity the voice was handed, leaving it never, and living exactly as
  long as the spoken reply, so it can never stand for news nobody is
  telling. The notice's press is a row press at one remove: the session's
  reported address goes to the operating system, or Luke's own panel opens
  for a session that reported none. The same band previews tracked issues
  while a spoken reply names them: the reply's own words are matched against
  the identifiers and whole titles the latest tracker observation listed —
  arithmetic against observed state, under the session mentions' own
  minimum-length and ambiguity rules, so nothing a model said can conjure an
  issue the tracker does not track — and each named issue draws a chip
  beside the session chips, its identifier and title read on this machine
  from that roster, living exactly as long as the words, with an
  announcement's one session subject still the whole answer. An issue chip's
  press hands the issue's tracker-reported address to the operating system
  exactly as a session's would, validated against the observed roster again
  in the main process; it reaches none of the tracker's write paths, and an
  issue that reported none is taken nowhere, because no panel surface holds
  a row to fall back to.

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

## Provider capability documentation

`PROVIDERS.md` is the one place the per-provider capability surface is written
down for a reader: what each provider connection observes, what a session row
can say, and which acts each provider takes. The code cannot state that in one
place — an adapter has a capability exactly when it overrides the method, so
the truth is spread across every adapter — which is why the document exists,
and why it can drift.

**When you change what a provider can do, update `PROVIDERS.md` in the same
change.** That means adding or removing a provider or tracker, widening or
narrowing what an adapter observes, adding or dropping a control, a message
path, a workspace act, a recap source, or a hook, or changing how a credential
connects. The levers that exist are narrow: `scripts/provider-docs.test.mjs`
refuses a provider or tracker id the document does not name, and
`scripts/repository-checks.sh` requires the file to exist. Everything subtler
— a stale endpoint, a control the document still claims, a boundary the code
no longer keeps — has no lever, so the rule is stated here: a capability the
document does not describe is one a reader will not know Luke has, and a stale
entry describes a Luke that does not exist. `PRIVACY.md` and the README's
integration table cover the same connections at different altitudes; a change
that touches one usually touches all three.

## Code comments

No unnecessary comments. Make the code obvious and immediately understandable
on its own — prefer explicit over clever — and let a comment carry only what
the code cannot: a constraint, a boundary, or the reason the obvious
alternative is wrong. The rationale prose already throughout this repository is
the bar; a comment that meets it earns its line, and one that does not is
noise.

- Never narrate. A comment that restates the adjacent code — what the next
  line does, what a function is named, what a parameter takes — repeats what
  the reader can already see. Delete it, or make the code say what it was
  trying to say.
- Describe the code as it stands, never the edit that produced it. A comment
  about what moved, what it replaced, or why the change is correct is
  addressed to a reviewer and goes stale the moment it lands; that story
  belongs in the commit message.
- No commented-out code. Delete it; history keeps it.
- A comment the toolchain demands must still explain: a `biome-ignore` states
  why the rule is wrong at that line, and a `SETTING_GUIDE` entry returning
  `undefined` states how the guide covers the setting instead.

## TypeScript value sets and keys

- Do not use stringly typed fixed value sets. Define `as const`
  SCREAMING_SNAKE_CASE objects, derive unions with
  `typeof VALUE_SET[keyof typeof VALUE_SET]`, and use the constants at call
  sites. Raw strings are only for freeform, user-facing text.
- Do not construct keys by concatenating or interpolating identifiers. Use
  nested objects or nested `Map` instances keyed by the original identifiers.
