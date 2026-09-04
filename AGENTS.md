# Agent guide

Luke is a macOS-first Electron sidecar that observes coding-agent sessions while
preserving existing provider workflows. Product naming belongs at the app and
packaging boundary; keep reusable implementation types brand-neutral.
Deployable products belong in `apps/`, and reusable packages belong in
`packages/`. Keep Electron main/preload code in `apps/desktop/` thin, keep the
renderer sandboxed, and put platform-independent behavior in
`packages/`.

Canonical commands:

| Command | What it does |
| --- | --- |
| `./scripts/bootstrap.sh` | Install pinned workspace dependencies |
| `./scripts/check.sh` | Run portable repository, type, test, and build checks |
| `./scripts/test-macos.sh` | Package and validate the macOS app |
| `./scripts/verify.sh` | Complete macOS validation plus visual evidence |
| `pnpm release:macos` | Create a local signed, notarized, and verified electron-builder DMG, zip, and update manifest |
| `./scripts/run.sh` | Launch the app against live sessions, replacing any running instance (`--fixture smoke` for fixture data, `--keep-running` to keep the running instance, `--no-trace` to skip the development trace) |
| `./scripts/evidence.sh` | Write the fixture PNG under `artifacts/` |
| `pnpm evidence:record` | Record the fixture transition on a physical Mac |
| `pnpm lint:fix` | Apply repository formatting and safe lint fixes |

Trust constraints:

- Never write provider transcripts or session-state files. Reading them is what
  Luke is for; writing to them is never.
- Never inject terminal input, simulate keystrokes, or request Accessibility.
  A message the developer explicitly sends through Superset's documented
  `terminals send` command is not terminal injection: Superset owns the
  terminal and its authenticated endpoint, the observed binding identifies
  the exact target, and Luke invokes it directly without a shell. It remains
  bound by the same direct-user-act and latest-roster validation as every
  other session message.
- A Superset workspace creation is the same bounded exception at the workspace
  level: only in a developer-opened turn, only on a host, project, and agent
  preset returned by the CLI's latest read, and only through the documented
  `workspaces create` command invoked directly without a shell. Luke supplies
  the developer's opening task and a bounded generated branch, then may call
  `workspaces open` for the identifier that creation returned. Renaming a
  workspace is the same exception narrower still: only in a developer-opened
  turn, only on a workspace behind an observed roster row, and only through
  the documented `workspaces update` command invoked directly without a
  shell, carrying nothing but that workspace's observed id and host and the
  developer's own bounded new name behind `--name`, never the command's
  other flags, which link and unlink tasks this exception does not authorize
  touching. The connection
  itself is bounded the same way at both ends: Connect runs the CLI's own
  `auth login` and Disconnect its documented `auth logout`, each only at the
  developer's press on the Superset row, each invoked directly with arguments
  fixed by the build, and the CLI owns the credential throughout. One deletion
  is authorized, as the control a managed row advertises and nothing wider:
  deleting the workspace behind that row, through the documented
  `workspaces delete` command with the observed workspace id as its single
  argument, invoked directly without a shell, only as the direct product of
  the control's own press or a developer-opened turn, and advertised only on
  a row positively seen settled, never one still working or unreadable,
  because the delete is unrecoverable and takes every sibling chat's terminal
  with it. A managed row here is also the standing row an idle workspace
  earns for itself: a worktree with no agent terminal at all, read from the
  same observed host state, is settled by construction, since there is no agent
  whose turn could be cut, and a workspace whose only terminal Luke cannot
  map draws no row rather than a gamble, while the main checkout and
  anything Superset already archived stand behind no row and can never be
  offered the delete. This does not authorize any other Superset CLI command,
  deletion
  of anything else, tasks, automations, account changes, or settings changes.
- Product behavior must not require provider MCP, plugins, hooks, wrappers,
  credentials, or live sessions. A provider whose sessions exist only in a cloud
  service may read a user-supplied API key, but it must observe nothing until
  the user supplies one and must leave every other provider working without it.
  The one observation that runs on a timer of Luke's own is the service's
  scheduled watch, and it is bounded on every side: it runs only for an
  account that is signed in on a phone and has synced a key, under that same
  key, once a minute, as the same read-only pass the on-demand endpoint
  runs; what it keeps between passes is the account's own memory of where
  each cloud session stood (identifiers, statuses, and when each was last
  spoken of, never a title, activity, or error); and it keeps nothing at all
  for an account with no phone or no key, dropping that memory on the next
  tick. Signing the phone out or deleting the key ends the watch. It exists
  for exactly one act, the phone notification the next rule names, and
  widening what it observes, keeps, or does is a product decision, not an
  implementation detail.
- A cloud surface that documents no key-scoped API and answers only its own
  CLI (Codex cloud today) is observed through that CLI instead, and the rule
  keeps its shape at one remove. Observation runs the provider's own binary
  with a read invocation fixed by the build, under the login the user already
  gave that CLI for its own sake: the credential never passes through Luke,
  no token is read, stored, or forwarded, and the CLI answers exactly as it
  would in the user's own terminal. No shell stands between Luke and the
  binary, nothing enters an invocation's arguments beyond values the build
  fixed (or, for a paged read, the bounded page cursor the same read's
  previous page handed back, as a single token), and a machine whose CLI is
  absent or signed out is observed as having nothing, the same answer a
  key-observed provider gives with no key. The
  login is the consent, given by the user's own hands to the provider itself,
  and signing the CLI out withdraws it on the next pass. Writes keep the shape
  every provider write has, at one remove: the one write Luke makes through a
  provider CLI is a new Codex cloud task the user just asked for, through the
  CLI's own documented creation command, in an environment the latest
  observation pass reported. The ask carries the developer's own task text as
  a single argument behind an end-of-options separator, never through a
  shell, under the same login, probed again at the moment of the act, and
  the one thing read out of the answer is the created task's id, for the next
  pass to report on its own. Codex documents no way to message or steer a
  task already running, so its cloud sessions advertise none, and the honest
  absence stands rather than an improvised control. Widening the invocation
  set further, or observing another provider this way, is a product decision,
  not an implementation detail.
- One registration is the exception the previous rule's word "require" leaves
  room for, and it is bounded on every side: Luke may join an observation
  hook to a provider's own user-level hook surface (today the `settings.json`
  of Claude Code and the `hooks.json` of Codex, and nothing else of any
  provider's) so local rows can tell a turn that just ended from a session
  walked away from, and can see a tool call holding for permission at all. The
  hook itself writes one fixed status token into a spool under Luke's own
  application data, named by the session's id; the envelope the provider hands
  it — piped in or passed as an argument — is read only for that id and never
  reaches disk. The merge preserves the user's own entries and settings as
  parsed, recognizes its own entries by the script's name, refuses to rewrite
  a file it cannot parse, converges at launch rather than accumulating, and
  skips a machine with no provider home to join. The registration is part of
  observing at all, like reading the transcripts, so it converges at every
  launch rather than answering to a preference; an entry outliving Luke is a
  guarded no-op, and everything the hook sharpens still observes from the
  transcripts alone wherever the hook is absent, including behind Codex's own
  review gate, which shows a new entry to the user and runs nothing until they
  trust it. Widening it to another provider or another lifecycle event is a
  product decision, not an implementation detail.
- The one thing Luke may change about a session is what the user just asked to
  send it: a message typed on its row, a control its provider advertised for
  it, or the same two acts asked of Luke, out loud or typed into his own
  composer, in a conversation the user is holding, each through the
  provider's own documented endpoint under the same user-supplied credential,
  and each validated against the observed roster before an adapter sees it.
  Observation passes stay read-only by construction; where a provider's
  documented read answers only a POSTed query (Conductor's transcripts view,
  like Linear's GraphQL), observation sends a read document fixed by the
  build, and nothing enters that document's text but identifiers the same
  pass reported, each validated against the shape its provider documents.
  Nothing that decides on the user's behalf may reach a write path: the
  attention evaluator above all, and every turn Luke opens himself (a
  proactive readout, the reply that voices a tool's outcome) which carries no
  tools, at the API and again at a runtime gate, so a session summary or a tool
  output that reads like an instruction can never become an act. A tool call
  in that conversation runs only in a turn the developer opened themselves, by
  speaking or by typing; a write is the direct product of a turn the developer
  opened, never of anything Luke read or was told. The one act not aimed at an
  existing session keeps the same shape: a new workspace, asked of Luke in
  conversation, lands only in a project its provider reported on the latest
  observation pass and documents a creation endpoint for; the ask names a
  reported project, never a repository URL or path of its own, and a provider
  that documents no such endpoint offers nowhere to create. A local manager's
  documented creation endpoint may be its own deep link rather than a network
  call: for a workspace on this machine (Conductor today) the ask is honored
  by handing that link to the operating system the way an open is, except that
  where an open reaches no provider this one asks the manager to make exactly
  what the developer asked. The project it names is still a reported one — a
  repository that manager's own index listed on the latest pass — and the path
  the create lands on is the one that report carried, read back from the
  offered project rather than composed by the ask; a manager that lists no
  repository offers nowhere to create, and the link carries the opening task
  alone, since Conductor's creation link documents no agent, model, or name.
  The ask may carry
  the new agent's opening task, the developer's own words, bounded and
  delivered like a message to an existing session, through the provider's
  documented endpoints, and each project says whether it takes one, needs
  one, or takes none, so a provider that cannot make an idle workspace is
  offered no task-less ask and one that takes no task is handed none. Another
  agent in a workspace already observed is the same ask at one remove: it
  lands only in the workspace behind a roster row, as one of the agent kinds
  that row's latest observation listed, through the provider's documented
  endpoint; a session whose provider lists none takes no such ask. A session whose provider documents no way in, or whose current state is
  documented for none, advertises nothing and is offered nothing; local
  sessions have no such endpoint and stay entirely read-only. Opening a
  session (its row pressed, the same press asked of Luke in conversation,
  the notice popup announcing it pressed under the housing, or a History
  line's chat chip pressed) is not a write
  and needs no endpoint: the address its provider reported is handed to the
  operating system, and nothing reaches the provider; an open asked of Luke
  still runs only in a developer-opened turn, and a session that reported no
  address is offered nowhere to open; its popup's press opens Luke's own
  panel instead, which touches no provider at all. A History line's chips
  are the one press that outlives a roster row, because the words they were
  recorded beside do: each line draws a chip per chat it attributably named —
  identity, title, and marks read from the roster at the moment of the entry,
  never from a model's words alone — and a chat archived in its provider
  keeps a working deep link, so its chip still opens it, at the last address an
  observation pass itself reported this run — remembered in the main
  process, never carried over the bridge — while a session still reporting
  an address opens at its current one, the remembered address answering
  only where the roster has nothing better, and a chat that never reported
  an address draws no chip at all. A workspace Luke just
  created opens itself the same way: the creation ask, already a
  developer-opened turn, is also the ask to be taken there, so the session id
  the provider's creation response named (the one thing read out of that
  response that outlives the adapter, an identifier and never an address) is
  held briefly, and the first observation pass to report that session with an
  address hands the address to the operating system exactly once, as a row
  press would. Nothing a model decided can start that wait, and a created
  session that reports no address inside its window is left unopened like any
  other row without one. Reading a local session's
  transcript in conversation is the same shape of act: asked of Luke in a
  turn the developer opened, validated against the observed roster in the
  renderer and again in the main process, read from the provider's own file
  on this machine, and rendered into a bounded reply that is kept nowhere:
  the read performs nothing, reaches no provider, and is offered only for a
  local session whose provider's transcript this build documents reading
  (Claude Code, Codex, and OMP today); a cloud session's conversation lives
  with its provider and is never fetched. The read renders only what the
  provider actually wrote down, and a provider whose stored shape this build
  cannot render faithfully keeps the honest refusal instead.
- A session's subject is the one place transcript content reaches a model
  unbidden, and it is bounded on every side. No observed field says what an
  agent is generally working on — a title is the first message, an activity
  is the tool running now — so an
  announcement that named the agent by its title named work it had stopped
  doing. Luke therefore derives one short phrase per local session from the
  same bounded transcript rendering the conversation-tab ask already reads,
  through the same adapter method, bounded only by the file tail the adapter
  reads and its per-line cuts, together with the title as the developer's
  first ask. The
  derivation runs only for a session about to be announced, at the moment the
  announcement is delivered, once per announcement, never in a fixture run,
  under a fixed deadline past which the announcement speaks without it, so
  the transcript it reads is the one holding the turn the announcement is
  about; a cloud session, a provider with no transcript this build reads, a
  closed session, and a session inside a live voice exchange derive nothing. It travels the way an
  attention review travels: directly to OpenAI
  on the developer's own key, or through Luke's own service on the hosted
  tier, where the service validates it against the same bounds, spends the
  attention meter, asks OpenAI not to store it, and keeps and logs none of it.
  The model is offered no tools, the transcript enters as data behind a
  marker, and the answer is a bounded phrase or an honest null, refused when
  it merely echoes the title. The phrase lives only inside the announcement
  payload that carries it and is kept nowhere: it reaches one place, the
  payload's `subject`, in the slot the title no longer travels in. It is not
  drawn on the panel, reaches no write path, never reaches the attention
  evaluator, and never reaches a provider file. It counts no product event,
  because no developer asked. The development trace records each
  derivation's about-fields, answer, and timing, and the transcript's byte
  count, never its text. Widening what it
  reads, where it travels, or where it is shown is a product decision, not an
  implementation detail, and `PRIVACY.md` says the read and the send in as
  many words.
- Counting is three streams with three different guarantees, and the
  difference is the thing to keep straight. Only the first carries the
  guarantee, and the other two must never be described as though they
  borrowed it. The counted event stream may name only what the build
  already fixed: an event is a name from
  `packages/analytics/src/product-events.ts` and properties whose values come
  from `as const` sets in that same file, validated by one reader both the
  desktop and the service run and which builds its output from the allowlist
  rather than from what arrived. No observed value (a title, a branch, a path,
  a prompt, an error line) may reach a property, and no property may
  take free text; counts travel as buckets and versions as release versions.
  That guarantee is structural: there is no shape such a value could travel in.
  The desktop posts events to Luke's own service and never to an analytics
  provider, and the account is the bearer token's, so nothing identifying
  travels with them. The iOS app counts through the same endpoint on the same
  terms: it emits from a hand-kept Swift transcription of the vocabulary whose
  enums make free text unrepresentable, the service reads its batches against
  the TypeScript allowlist exactly as it reads the desktop's, and the one
  thing naming which app posted is a header whose value only selects between
  fixed `$lib` tags — absent or unrecognized means the desktop. The service attaches the account's own name and address to
  the analytics person record, read from its own user row, never from the
  request, and never onto an event, because an event property is what the
  allowlist governs and a person property is not. The renderer has one narrow
  way in — a fixed set of surface events the main process cannot see for itself
  — validated against that same allowlist in the main process before anything is
  queued, and reaching none of the acts. What the allowlist governs is that
  endpoint, `/api/events`, and not the analytics project: the two streams below
  reach the project without passing it, so a claim about the allowlist is a
  claim about Luke's own service alone.
- The other two leave from the renderer, straight to the analytics provider,
  and both come from one client per app —
  `apps/desktop/src/renderer/session-replay.ts` on the desktop,
  `apps/ios/Luke/SessionReplay.swift` on iOS — each configured as its library
  ships rather than hardened. On iOS only the recording and the crash
  reports leave: the SDK's element-interaction autocapture is not the
  desktop's click stream — it copies a text control's live contents on
  end-of-edit, typed text no disclosure covers — so it stays at its off
  default. The first of them is what that client captures
  beside a recording: an autocaptured event names the text of whatever was
  clicked, so pressing a session row sends that row's title and branch.
  Nothing validates it — no allowlist stands between the panel and the
  provider — and `productEventFromWire` never sees it. Autocapture stops with
  the recording switch, because the client opts out
  rather than only stopping the recorder; a switch that named recording and
  left it running would be a consent nobody gave.
- The replay stream has the opposite shape from the counted events. Except for
  the conversation History tab, it records the rendered panel, so everything
  drawn travels: a session's title, branch, and error line, the account's
  own name and address, and any
  screenshot attached to the feedback composer, which is drawn as its own
  bytes and which input masking does not reach. The one thing withheld is what
  is typed into a field, and that is the library's default rather than a
  posture Luke keeps. The one explicit blocked subtree is History: its root
  carries the recording library's fixed blocking class, so neither the
  conversation's words nor the entries Luke was asked to remember leave the
  machine in a recording. That view retains every line the retention policy
  holds, its words whole, including session acts and the lines that outlived
  the last launch, until the developer clears it — the same thread on every
  display's panel, relayed between windows through the main process — while
  only the 20 most recent lines enter model context, each cut there to its
  own length bound. There
  is no general masking module to consult and nothing that makes any other new
  component silent by construction, so what a recording may see is decided by
  what the panel draws or explicitly blocks — which makes drawing something
  new on the panel a decision about what leaves the machine. It is still Luke's
  own panel and never the machine's screen. Recording posts to the provider
  directly, and it begins at the first paint of every ordinary launch, before
  any account exists and through the spoken introduction, because the launch
  is where a first run goes wrong and a recording that waited for a sign-in
  never saw it. Recording is the one place an account id travels to the
  desktop, and it travels for what it does when a sign-in lands: the anonymous
  session already running is joined to that person, so it files with their
  counts and is erased with them. A session that never reaches a sign-in stays
  anonymous and can be erased with no account, which is a thing `PRIVACY.md`
  has to say in as many words rather than leave to be inferred. Deleting an
  account stands recording down for the rest of that run, unlike signing out,
  which leaves an anonymous recording running the way the launch before the
  sign-in was: nothing erased is re-created either way, but a recorder starting
  up again on the panel that just erased everything reads as though something
  were, and deletion is the one act treated here as unrecoverable.
  The iOS app records on the same terms at its own scale: its own screens and
  never the device's, captured as screenshots because that is how the SDK
  sees SwiftUI at all, begun at first paint before any account, joined to the
  person by the same account id at sign-in, and reset to anonymous at
  sign-out; it has no account deletion surface, so the desktop's deletion is
  what erases its recordings too.
  None of the three sends anything in a fixture or evidence run, and nothing
  else stands in front of any of them: there is no switch, and the run mode is
  the whole of the gate. On iOS, which has no fixture runs, the same gate is
  the XCTest host check and the build-injected project key, whose absence
  leaves the recording client unconfigured rather than pointed anywhere else. That is the deliberate posture of an early product
  and it puts the entire weight of disclosure on `PRIVACY.md`, which is where
  a user learns any of this happens — so that file says all three in kind, in
  as many words, and moves whenever one of them changes character. Widening
  the event list, a property's value set, or what the recording client may
  capture is a product decision, not an implementation detail, and each one
  widens what a user was never offered a way to decline.
- Crash reporting is a separate Sentry stream, not one of the three analytics
  streams above. The Electron SDK reports unhandled exceptions from main,
  preload, and renderer code, anonymous main-process session health, and native
  minidumps from Electron's main, renderer, and GPU processes. Its defaults add
  breadcrumbs and Electron, operating-system, runtime, and device context.
  Luke supplies no account or user identity and enables no tracing, Replay,
  screenshots, profiling, PII, or manual handled-error capture. The main
  process owns its baked DSN and initializes only after Luke's custom
  `userData` and `sessionData` paths are set; renderer and context-isolated
  preload events travel through main. The same run-mode network gate keeps
  fixture and evidence runs silent, while deleting a Luke account neither
  stops reporting nor identifies earlier anonymous reports for deletion.
  Widening what Sentry captures is a product decision, not an implementation
  detail.
- The conversation Luke holds outlives the app, and one narrower thing beside
  it does too. The thread itself is words that were already said — the
  developer's asks, what Luke spoke or announced, the acts he carried at their
  ask — each of which reached the voice service once on the call that said it,
  so storing it changes only how long it stands, not what it is. It lives in
  Luke's own application data, never a provider's file, under a real retention
  policy replacing the old "dies with the app": the 200 most recent lines,
  nothing older than a fortnight. What reaches a model is unchanged — the same
  bounded recent slice — and the panel's Clear reaches the file as well as the
  screen, because a Clear that emptied only the view would leave the words on
  the machine with nothing left to draw them. The narrower thing is a durable
  fact about the developer themselves. During a turn the developer opened,
  Luke may silently keep a concise stable preference, personal fact, goal, or
  recurring constraint. He skips transient details and uncertain inferences,
  never stores credentials, and stores a sensitive fact only when explicitly
  asked. The write runs the same act gauntlet as every other write — validated
  in the renderer, validated again in the main process, and armed only by a
  developer-opened turn. A changed fact names the entry it replaces so
  contradictions do not stand together; duplicates add nothing; and a request
  to forget names one of the ids the conversation received. At most 32 bounded
  facts stand in Luke's own application data and the complete list enters each
  conversation as reply context. It is never drawn, never reaches a provider
  file, never reaches a write path, and never reaches the attention evaluator,
  whose input stays what a provider wrote about a session. Widening either —
  what may be stored, how long it stands, or where it may travel — is a
  product decision, not an implementation detail.
- The development trace is the one place Luke's own agent traffic may reach a
  file, and it cannot exist for a user: only an unpackaged, live run whose
  shell set `LUKE_TRACE_DIR` constructs a writer at all, so a packaged build
  carries nothing to switch off and a fixture or evidence run stays silent
  behind the same gate that keeps it off the network. `run.sh` sets the
  variable by default, pointed at the gitignored build directory, so a
  development launch is traced unless `--no-trace` says otherwise — the
  launcher supplies the directory, and the app's own gate still decides
  whether anything is recorded. What it records is the
  desktop's own view of its own conversation — the realtime events already
  crossing the data channel, with an audio append reduced to its byte count
  before it leaves the renderer, and the attention evaluator's update,
  decision, and reviewing model when the desktop knows one — appended as
  JSONL under the developer's chosen directory and
  sent nowhere; `pnpm trace:export` turns one file into a document a local
  viewer opens. The tap only observes: nothing reads its result, and the
  main process drops the renderer's tapped events whenever no writer stands.
  A trace carries real titles, branches, and spoken words, so trace files are
  never committed, for the same reason fixtures stay synthetic. Widening what
  a trace records is a product decision, not an implementation detail.
- The issue tracker follows the same rule at one remove, and is connected the
  way the calendar is rather than the way a cloud provider is. Luke reads the
  issues a tracker lists for the user under a grant the tracker's own consent
  page issued, and observes nothing without one. The integration exists only
  in a build carrying a registered OAuth client; without one it is not drawn.
  Connecting is the tracker's own flow for a public client: PKCE over a
  loopback redirect that never leaves the machine, carrying no client secret,
  asking for the narrowest scopes the acts need. No key is ever typed, and
  none is read from the environment: a tracker connected by consent has no
  environment variable at all. The grant is stored encrypted like a key, is
  renewed before it lapses (the renewal written before it is used, because a
  consumed refresh token is spent) and is deleted only when the tracker
  itself refuses the renewal, never when the network merely could not carry
  it. Disconnecting revokes the grant with the tracker as well as deleting it
  here. The two acts a tracker takes, moving an issue to a state its latest
  observation listed and adding a comment, happen only as the direct product of
  a turn the developer opened themselves, through the tracker's own documented
  endpoint under the same grant, validated against the observed issue roster
  in the renderer and again in the main process before the tracker client sees
  anything. Observation sends only the read document; the write documents are
  fixed by the build and issued only for a validated act.
- The calendar is the same rule with no write path at all. Luke reads when
  the user's meetings start and end, under accounts the user signed in, and
  observes nothing without one. The integration exists only in a build
  carrying a registered OAuth client; without one it is not drawn. Connecting
  is Google's own consent flow for an installed app: PKCE over a
  loopback redirect that never leaves the machine, asking for two read scopes
  alone, availability and the calendar list. Each account's grant is stored
  encrypted like a key, deleted by disconnecting the account, and revocable
  in the user's own Google account; several accounts stand side by side. A
  pass reads each account's calendar list (ids and names, which are what the
  settings rows draw and the user chooses from) and then the Calendar API's
  free/busy query, a POSTed read document fixed by the build that carries the
  window's two instants and only calendar ids the same pass's list reported:
  the user's selection steers it, but never past what the account just
  offered. Google answers free/busy with intervals alone, so an event's title
  cannot even travel, and no event scope is ever held. Only start and end
  instants are kept beyond the pass, and the intervals never leave the
  machine. What the intervals decide is bounded and deterministic: while a
  meeting covers now and the setting is on, spoken announcements are held and
  released once it ends, and the face beside the housing sleeps for as long
  as the hold stands, a clock read against observed intervals, never
  anything a model wrote, and holding is the whole power: a calendar entry
  can delay an announcement and put a drawn face to sleep, never create,
  reword, or act on one. The developer's own Announce when sessions need you
  switch, on by default, raises the same hold by hand when switched off, over
  the same set of speech and nothing wider: replies in a conversation they
  open still speak, and the switch reaches no write path. This Mac's own Calendar is read under the same rule
  with no credential at all, through a native helper behind macOS's own
  consent dialog. The dialog is the connection, and nothing is stored but
  the fact of it and the user's calendar choices. EventKit publishes no
  free/busy, so full calendar access is the grant the system asks for, and
  the helper is where the narrowing happens: an event is read for its start
  and end instants alone, and every other field (title, attendees, notes)
  dies inside the helper process, so intervals and the calendar list are all
  that ever reach Luke. The helper's commands are fixed by the build; nothing
  enters an invocation's arguments beyond the window's two instants and the
  calendar ids the user's stored choice names, intersected inside the helper
  with the list the same read produced; and a read never raises the dialog.
  A grant withdrawn in System Settings empties what Luke holds on the next
  pass, since nothing keeps standing on consent taken back, while a read that
  merely failed stands what it last showed, because a crashed helper says
  nothing about the user's intent. Disconnecting deletes the stored choice, and the
  grant stays the user's own in System Settings, withdrawable there like
  every system permission. The intervals pool with the signed-in accounts'
  and decide nothing more than theirs do.
- Quieting other media is bounded the way the talk key is: a native helper that
  can do one narrow thing. While a spoken exchange is live, Luke may lower the
  volume of the players the helper names (Music and Spotify, through their own
  scripting interfaces, behind the system's per-app consent) and restore it
  afterwards. He never pauses them and reads nothing beyond whether each is
  playing and how loud; a volume the user moved during the duck stays where
  their hand put it; and the whole behavior is a setting. The trigger is the
  exchange itself, a deterministic status edge, never anything Luke read,
  heard, or decided, so no model output can reach it. Each player's consent
  dialog is raised at the last possible moment: macOS's standing answer is
  read before every event without a dialog, and a player never yet asked
  about is sent its first event — the one that raises the dialog — only
  mid-exchange, once the play-state broadcast that player already addresses
  to the whole machine says it is audibly playing. Those broadcasts are read
  for the one state word, and every other field (a track's name, its artist)
  dies inside the helper; the helper stands from the moment the setting is on
  so something is listening, but it writes the players nothing until a duck.
  The introduction reaches no duck at all — only a panel reports a spoken
  exchange, and the takeover is not one — so the dialog can never interrupt
  onboarding. Widening the player
  list is a product decision, not an implementation detail.
- The same shape, smaller still, watches whether Luke can be heard at all: a
  native helper reads the default output device's mute switch and volume,
  nothing else, and can write nothing. What it learns decides only what the
  renderer draws while Luke speaks into that silence: his captions forced on,
  paced for reading rather than for the voice, because into a mute the caption
  is the speech, and a hint asking for volume. Luke never changes the system
  volume himself; turning it up stays the user's own act on their own keys.
- The input side is read the same way: a native helper reports where the
  developer's voice would be captured from: the default input device's
  transport, whether the machine has a built-in microphone and what it is
  named, and whether the lid over it is open. Nothing else, and it can write
  nothing. No audio is ever read. What it learns decides exactly one act:
  which device the renderer asks the browser to open when a press takes a
  turn, so a Bluetooth headset is not pulled onto its call codec while the
  Mac's own microphone can listen, and is listened to itself when a shut lid
  would muffle the Mac's. The capture device itself stays bound to the turn
  the press opened, opened by the press and closed when the exchange settles,
  and never outlives it; typed asks never open one at all. An unreadable
  route means the browser's default device, never a refusal to listen.
- Updating is the one thing Luke does on the network with no user-supplied
  key at all, and it follows the same shape Superset's production updater
  keeps: electron-updater reads this repository's release manifest from a
  feed address fixed by the build, an unauthenticated fetch carrying
  nothing about the user, their sessions, or their keys, on a timer of its
  own and at the press of the Updates row's button; never in a fixture or
  capture run, and never in an unpackaged build. A newer build found by any
  check downloads at once, so the row can offer a restart instead of a wait,
  but what is fetched is only ever what this repository's own release
  pipeline published: the manifest carries the archive's sha512, the archive
  must sit on the same release as the manifest, and Squirrel.Mac refuses one
  whose code signature does not match the running app's. The running build
  is replaced only at a quit (the row's restart press, or whenever the user
  next quits) and an install is asked for at most once, because repeat asks
  race the binary swap. The row's button is also a press that can be asked
  of Luke, only in a turn the developer opened themselves: the ask is
  validated in the renderer against the one act the row currently offers and
  lands on the same main-process guards the button's own press does, so it
  reaches nothing the button does not — the check, the restart, or the fixed
  releases page in the browser. A transient network failure is silence for
  the next timed check; a download refused just after its check found the
  version is a release still publishing, and the same check is retried at a
  few fixed delays against the same fixed feed — nothing new sent or read,
  only the cadence, and a network failure mid-wait spends the same bounded
  budget rather than orphaning it — with the row saying the wait honestly, before the
  schedule ends in the same error row a corrupt release deserves; any other
  failure is an answer on the row whose way forward
  is the browser, at the releases page fixed by the build, the same page
  that serves a build which cannot install in place at all. Widening what
  the updater sends, reads, or does is a product decision, not an
  implementation detail.
- The spoken introduction is the one moment Luke runs before the account gate,
  and it is bounded on every side. It plays on the first interactive launch,
  before any account exists, at most once to the end: a completion on file
  never replays, and it never runs in a fixture or capture run. Its voice is
  the introduction mint, an accountless endpoint on Luke's own service that
  issues one short-lived credential per call, keeps nothing about the caller
  but a hashed network address for its own daily caps (per caller and global
  both), and answers the same pinned OpenAI calls endpoint every minted call
  uses. The call itself is tool-free at the API — no tools declared, every
  scripted turn opened with none — and no carrier is wired behind it, so
  nothing said, heard, or shown during the introduction can become an act.
  What travels on it is the build's own script and one observed thing: the
  detected sessions' titles, as data behind a marker, never as instructions,
  and capped at the panel's own visible depth however many sessions stand on
  screen. Detection is the keyless local peek — the same read-only observe
  every pass runs, once, with no hook registration and no credential, and
  answered only to the takeover window, which draws every fresh session it
  reports in a list that scrolls like the panel's own. The microphone is
  asked for at its own beat through the system's real dialog, the talk key is
  routed to the takeover for the introduction's duration, and the spoken
  sign-off is where the introduction ends: the takeover closes, the ordinary
  signed-out panel stands up with its own gate, and observation,
  announcements, and every other capability still release only through the
  ordinary account gate when the sign-in itself lands. An introduction
  that cannot speak stands down to the ordinary signed-out launch and writes
  nothing. Widening what the introduction reads, sends, or can do is a
  product decision, not an implementation detail.
- Keep unsupported capabilities explicit; do not invent fallback controls.
- Keep Electron renderers sandboxed with context isolation and narrow IPC.
- Commit only synthetic fixtures and repository-relative paths. This binds
  harder as Luke observes more: a fixture copied from a real session now carries
  a real title and branch.

What Luke may show:

- Show whatever the local surface can read. A session's own title, branch,
  model, current tool, and failure all
  belong on the row: a sidecar that cannot tell two sessions apart is not worth
  the space beside the housing. This is the user's own data, on the user's own
  screen, and it is read-only.
- Label a session by what its provider named it, falling back to the workspace
  or repository only when there is no name yet. Do not compose a sentence in an
  adapter; report the fields and let the surface word them.
- A session's conversation itself is read in exactly one place, and the place
  is deliberate: in the open, at the developer's own press, never behind an
  observation pass, which reads no message of any chat. When the developer opens a
  Conductor session's own screen in the iOS app, that screen asks Luke's
  service for the conversation, and the service reads it through Conductor's
  documented transcript endpoint (`GET /v0/sessions/{id}/messages`) under the
  caller's own synced key — after a fresh observation pass on the same
  request has reported that session, so the read lands only on a chat the
  developer was actually shown. The read is bounded on every side:
  user-initiated by the screen's opening, its polling while the screen stays
  open, and its scroll back into history, never issued by an observation
  pass, a timer of Luke's, or anything a model decided; read-only through the
  documented GET, whose only parameters are the fixed page bound, the cursor
  the endpoint's own previous answer handed back, and arithmetic offsets —
  the endpoint pages only forward, so the screen's opening read seeks the
  transcript's end with a bounded round of one-message position probes and
  pages backward from it by offset, numbers the read composes that no stored
  content can steer; paged to fixed budgets per ask; and stored nowhere — the
  service assembles the page, answers, and keeps nothing, and the screen
  holds it only while it stands open. What travels is only what
  Conductor's own store attributes: the developer's sends and the agent's own
  words. A tool call, tool output, harness event, or any message whose author
  the store does not name is dropped whole rather than guessed at, and a
  message that does travel is never truncated — the bounds live on the page,
  because a cut message says something its author did not. On the phone the
  fetched words are masked out of the session recording, the way the desktop
  blocks its History subtree, so the conversation reaches the developer's own
  screen and nothing else. A provider whose API documents no such read
  advertises none, and its screen says so rather than standing in a summary
  of its own; widening this read to another provider, another caller, an unattributed
  message kind, or anything stored is a product decision, not an
  implementation detail.
- Session material leaves the machine unbidden in exactly three places, each
  with its own narrower rule. An evaluator receives `AttentionContext`, what
  a provider wrote *about* a session, and never the transcript behind it: no
  message history, file contents, or command output. A
  spoken announcement (a session that started waiting, stopped on an error,
  or finished, or an evaluator sentence approved for speech) reaches the
  voice service so it can be said aloud. A phone notification is the third,
  and it leaves the service rather than the machine: on the scheduled watch,
  a cloud session that started holding for the developer or stopped on an
  error, judged by the same deterministic notice tracker the desktop runs
  and by nothing else (no evaluator runs on that pass, so nothing a model
  wrote can reach it), is handed to Apple's push service to show on the
  account's registered phones, carrying the session's title, its workspace,
  the one line the provider wrote about what it holds on or why it stopped,
  and its identity for the tap. A finish and a waiting turn the provider did
  not mark as holding are the phone's roster's to show, never a
  notification's. Two onboarding beats are
  the members of that set about no session, and each keeps the same terms:
  worded from a script fixed by the build, speak-only and tool-free like an
  edge announcement, drawing no notice band and claiming none. The arrival
  beat is spoken once per install at the deterministic edge of the account's
  first sign-in, remembered in Luke's own state file, and carrying as
  observed values only one working session's title, read from the same roster
  the rows draw and sent as data behind a marker, and the talk key's own
  name. While the calendar onboarding gate stands, the arrival beat waits —
  "you're all set" over a panel still asking for something would be false —
  and the calendar onboarding beat speaks in its place: triggered by the
  gate's own deterministic standing, once per run, carrying no observed value
  at all, and gone with the gate, whose Done or skip is what lets the waiting
  arrival speak. A moment
  that cannot speak the arrival — no credential, a meeting's quiet, a beat
  dropped before its reply began — leaves it owed for the next signed-in
  launch rather than improvising a substitute; only the voice window
  reporting the reply actually begun settles it. An edge announcement
  sends that update's *about* fields, the same ones the evaluator may see,
  and the voice words the
  sentence said aloud, so it can say what the session is waiting on rather
  than only that it waits. When no conversation is open, Luke opens a call of
  his own to say it, and that call is speak-only by construction: it offers
  no microphone track, carries no tools, and is sent the one update's fields,
  or the one evaluator sentence, alone: never the roster, the guide, or a
  transcript rendering, which travel only on conversations the developer
  opens, and the rendering only in the turn that asked for it. A
  developer-opened conversation also carries a bounded history of the recent
  exchange itself (the developer's own asks, typed or spoken and handed back
  as text by the same service that heard them, the words Luke already spoke
  or announced, and the acts he carried at the developer's ask) so the one
  conversation survives the calls that transport it: an announcement read out
  on Luke's own call, or a call retired idle, is still remembered by the next
  one. Every history line already traveled to the same service once, on the
  call that said it; a transcript reading enters the history only as the fact
  that one was read, never a word of the rendering; each line's identity is
  the roster-validated one the words traveled with, offered only while that
  session is still observed; and the history is stored only where the constraint
  above puts it, on this machine and under its retention policy, and is never
  sent on Luke's speak-only call. Its
  trigger is a deterministic status edge, an onboarding beat's own
  deterministic trigger (the recorded sign-in edge, or the calendar gate
  standing), or the evaluator finding an update worth speaking. The edge
  announcements and approved evaluator sentences speak whenever voice can.
  Widening either set is a product decision, not an implementation detail;
  make it deliberately. While an announcement is being spoken, a notice on
  Luke's own surface under the housing names the session it is about,
  drawn on this machine from the roster and the same roster-validated
  identity the voice was handed, leaving it never, and living exactly as
  long as the spoken reply, so it can never stand for news nobody is
  telling. The notice's press is a row press at one remove: the session's
  reported address goes to the operating system, or Luke's own panel opens
  for a session that reported none. The same band previews tracked issues
  while a spoken reply names them: the reply's own words are matched against
  the identifiers and whole titles the latest tracker observation listed,
  arithmetic against observed state, under the session mentions' own
  minimum-length and ambiguity rules, so nothing a model said can conjure an
  issue the tracker does not track, and each named issue draws a chip
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
evidence from the pull request description. Screenshots and recordings are
never committed, on any platform: a macOS capture, an iOS Simulator
screenshot, and a physical-device recording all reach a pull request through
GitHub's editor, which uploads them to its own attachment host, never through
a file in the tree, under `docs/media/` or anywhere else. A merged PR that
carried one is a mistake to remove, not a precedent to follow. An agent that
cannot use that editor describes what it captured and inspected, and leaves
the attaching to the developer, rather than committing the file so a link can
point at it. Do not commit one-off QA worksheets either, and keep generated
state and private planning files untracked. `docs/media/` is not an exception
for evidence: it holds only the README's own product screenshots, each one
the README references, cut from a fixture capture and replaced whenever the
surface they show has moved on; a file there the README does not reference is
evidence by another name and does not belong.

Biome is the executable style policy for TypeScript, JavaScript, JSON,
Markdown, and CSS. Husky runs the same checks against staged files as a local
convenience; `./scripts/check.sh` and CI remain authoritative.

## Where the rest of the guidance lives

Everything safety-bearing is above: what Luke is, every trust constraint, what
Luke may show, the handoff invariant, and the style rules below. What is scoped
to one part of the tree lives with it, and each of these is loaded when an agent
works in that subtree:

| File | What it governs |
|---|---|
| `apps/desktop/src/renderer/AGENTS.md` | The sandbox rule, panel motion, brand artwork, and Luke's knowledge of himself |
| `packages/AGENTS.md` | The acyclic package graph, the `.js` import rule, the Vercel doors, and how a barrel leaks |
| `packages/providers/AGENTS.md` | Keeping `PRIVACY.md` and the README's agent table true to the adapters |
| `packages/surface/AGENTS.md` | The shared surface vocabulary and its generated outputs |
| `packages/realtime/AGENTS.md` | Why `protocol` and `tools` ship together |
| `packages/analytics/AGENTS.md` | The product-event allowlist and its `PRIVACY.md` obligation |
| `packages/hosted/AGENTS.md` | The hosted wire boundary and its dependency direction |

## Repository shape

`apps/` holds only what is specific to a deployable: the Electron processes, the
React surfaces, and the Vite site. Everything else is a package under
`packages/`, named for the concern it holds, so `ls packages/` answers "what is
this codebase made of" and an import specifier names what it depends on.

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
  (GitHub cannot build the merge commit). Keeping branches rebased is what
  keeps CI running.

## Code comments

No unnecessary comments. Make the code obvious and immediately understandable
on its own, preferring explicit over clever, and let a comment carry only what
the code cannot: a constraint, a boundary, or the reason the obvious
alternative is wrong. The rationale prose already throughout this repository is
the bar; a comment that meets it earns its line, and one that does not is
noise.

- Never narrate. A comment that restates the adjacent code (what the next
  line does, what a function is named, what a parameter takes) repeats what
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
