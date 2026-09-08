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
  Nothing deterministic that decides on the user's behalf may reach a write
  path: the attention evaluator above all, and the speak-only calls that voice
  a briefing or a reply, which carry no tools at the API and again at a
  runtime gate, so a session summary or a tool output that reads like an
  instruction can never become an act there. What the brain itself may call
  in any of its turns is decided by the effective tool policy, resolved from
  the configuration's layers (global, agent, provider, session, and the
  child restriction where a run is a child's, in OpenClaw's order, deny
  winning at every layer) over the registered catalog, before the model reads
  a word: the same policy fixes the schemas the model is offered and the gate
  every emitted call meets at dispatch, so nothing the model reads can widen
  either. Who opened a turn — the developer's ask, a provider's hook, the
  roster look, a hold's release, a heartbeat — is its origin, recorded on the
  run and in History, and never by itself a permission: a turn Luke opened
  himself may carry the acts the policy allows, and an act it takes is
  journaled before its effect exactly as an ask's and narrated as Luke's own
  judgment, never as something the developer asked. Every act still runs the
  same validation whoever opened the turn: a cancellation or a revoked run
  refuses it, a fresh roster read precedes it, its target has to be one the
  roster holds, and the provider's documented adapter requirements stand. The
  one act not aimed at an
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
  session (its row pressed, or the same press asked of Luke in conversation)
  is not a write
  and needs no endpoint: the address its provider reported is handed to the
  operating system, and nothing reaches the provider; an open asked of Luke
  still runs only under the effective tool policy, and a session that reported
  no address is offered nowhere to open. A History line records the acts Luke
  carried and the sessions they named, but draws no press of its own: a
  session's address is reached by its row's press or by a validated ask in a
  developer-opened turn, and by nothing else. A workspace Luke just
  created opens itself the same way: the creation ask, already a
  developer-opened turn, is also the ask to be taken there, so the session id
  the provider's creation response named (the one thing read out of that
  response that outlives the adapter, an identifier and never an address) is
  held briefly, and the first observation pass to report that session with an
  address hands the address to the operating system exactly once, as a row
  press would. Nothing a model decided can start that wait, and a created
  session that reports no address inside its window is left unopened like any
  other row without one. Reading a local session's
  transcript at the developer's ask is the brain's own read, not an act: the
  brain's `read_transcript` tool, offered in every kind of turn, names a
  session by the identity the standing context lists, is refused in the
  agent for any identity the roster does not hold, is refused again in the
  main process for a session whose location is not this machine or whose
  provider is not connected, and reads the provider's own file through that
  provider's adapter, bounded as the next rule says. The read performs
  nothing, reaches no provider, and answers only for a local session whose
  provider's transcript this build documents reading (Claude Code, Codex,
  and OMP today); a cloud session's conversation lives with its provider and
  is never fetched. The read renders only what the provider actually wrote
  down, and a provider whose stored shape this build cannot render
  faithfully keeps the honest refusal instead. What the read rendered enters
  the brain's working memory like every other tool answer, and lives and dies
  with its generation under the next rule; what reaches the developer is the
  reply the brain writes from it, which may quote or summarize the reading
  and which History keeps as Luke's words under the thread's own retention.
- The brain's transcript reads are the one place transcript content reaches
  a model unbidden, and both the read and what it leaves behind are bounded
  on every side. Luke's judgment is one agent with several conversations in
  the main process: main (`agent:main:main`), the developer's private
  threads, and one conversation per observed coding session
  (`agent:main:observed:<provider>:<session>`, each provider id run through
  the reversible component encoder in `runtime-contracts`, never
  concatenated raw). A provider's hook and the roster look on the
  observation pass route to the observed session's own conversation, which
  keeps its own transcript cursor, context, and generation; main is woken by
  a developer's ask, by the scheduled heartbeat (every thirty minutes by
  default, on the ordinary main conversation under `HEARTBEAT.md`, normally
  briefing nothing), and by a hold's release of a briefing it decided, and
  is handed no transcript on any look. What main learns of the observed
  conversations is a compact notice in the host's own counts and Luke's own
  briefing words, consumed on its next turn and never a transcript's text.
  An observed conversation's wake or roster look reads only what its one
  session's transcript gained since the capture cursor it last kept, cut
  from the front to 20,000 characters, and writes it down before any turn is
  scheduled: the observation entry and the advanced capture cursor land in
  one save into the conversation's durable inbox, and the turn that follows
  consumes the entries it opened with at its checkpoint, moving the consumed
  cursor there and only there. The two cursors are two on purpose: a
  throttled or failed inference leaves every entry standing for the next
  turn, a crash between capture and run loses nothing and reads nothing
  twice, and a relaunch runs what was captured without touching a
  transcript. A repeated look that finds nothing gained and the session
  unchanged captures nothing and opens no inference, a hook delivered twice
  is one entry, and the inbox holds at most 20 entries. The conversation
  may also read one observed session's whole
  tail, cut from the front to 60,000 characters, through the same read tool
  a developer's ask is offered; a cloud session, and a provider whose
  transcript this build does not read, are read from roster fields alone.
  An observed conversation's `announce` reaches the voice directly; main
  neither approves nor rewords it. Any conversation may delegate: the brain's
  `sessions_spawn` tool records a child (`agent:main:subagent:<uuid>`, kind
  automation) in the runtime store before its receipt is answered, and the
  child runs in a conversation of its own on the child lane, under the
  minimal prompt profile and OpenClaw `b7528507`'s child tool exclusions at
  its depth (delegation and session inspection go too at depth five), its
  provider acts still governed by the configured policy and `announce`
  denied as in an ask. The receipt says accepted, never done. A child starts
  isolated unless the spawn asked to fork, in which case the requester's
  active context is adopted whole as the child's opening history and
  recorded as a fork boundary, or starts isolated with the receipt saying so
  when that context exceeds 100,000 estimated tokens. Five children may be
  active per requester, eight overall; a parent's turn ends as usual after a
  spawn and its completion never ends a child; an explicit cancel cascades
  through descendants; and Start fresh cancels a conversation's descendants
  first and refuses while one cannot be. A child's end is persisted as a
  completion before delivery is tried and is delivered to the conversation
  that asked, whichever kind, by steering its run under way or opening a
  child-completion turn there; the same completion id is taken once; blocked
  delivery retries from fifteen seconds to five minutes inside a thirty-minute
  window, is retained blocked seven days, warns the host at 25 and refuses
  spawns at 50. A relaunch adopts an unfinished child through its own record,
  marked interrupted and never replayed, under a budget of three
  backend-start failures reset only when a backend starts; completed children
  are archived after an hour. Every conversation runs one execution at
  a time and all of them share the execution lanes ported from OpenClaw
  `b7528507` (`packages/runtime/src/lanes.ts`: an agent lane of
  `min(16, max(8, availableParallelism()))`, a hook-dispatch lane sharing
  the cron inner budget of 8 with one slot reserved, and the rest as that
  source has them), separate budgets and never one cap over Luke. An ask
  that arrives while a conversation's turn is under way is taken under the
  queue mode (steer by default: the run reads it at its next model boundary
  after every emitted tool call has its result, and answers both; follow-up,
  collect, and interrupt as OpenClaw names them). An ask past the queue's
  own depth of twenty is not dropped: the oldest waiting is folded into a
  summary line the next turn opens with, and settles with that turn, while
  the words the developer typed stand on their own record uncut, because the
  summary bounds what the model reads and rewrites no history. A relaunch runs
  nothing that was only queued or steered: such records read interrupted,
  and wakes that only waited in memory are gone. The conversation an ask is
  for is captured at the submission and never retargeted; the existing
  composer and talk key submit to main, and no conversation, selector,
  control, or label is drawn for any of this. The provider's file is only ever read. Everything a turn reads and
  says travels as the Responses input the agent keeps — behind a marker, as
  data — directly to OpenAI on the developer's own key, or through Luke's own
  service on the hosted tier, where the service performs one model inference
  per request, asks OpenAI not to store it, and keeps and logs none of the
  request body, the output, or the compaction inside it. The development
  trace records a turn's about-fields and byte counts under its own gate,
  never a transcript's text.
- The judgment is a host over replaceable parts, and the seams are the
  contracts in `packages/runtime-contracts`. The host (`BrainAgent`) owns the
  conversation's standing — accepting asks into runs, queueing turns, the
  journal that records an act before its effect and its result before the
  next inference, the transcript cursors, the checkpoint — and reaches a
  model only through an `AgentRuntime` over a `ModelAdapter`, a
  `ContextEngine`, and the `ToolExecutor` the host itself supplies. Nothing in
  the host reads inside a provider's item. Which parts stand is a
  configuration, not a construction: `packages/runtime` holds registries for
  agent runtimes, model adapters, context engines, memory providers, tools,
  skills, and lifecycle services, each refusing a duplicate id and the
  capability pairings it rules out; the build registers its own parts as
  built-ins and loads nothing dynamically; an agent's configuration names
  entries by id and its credential by reference alone (the value stays in the
  encrypted credential store), resolves against the registries into a frozen
  snapshot each turn reads whole, and is republished atomically or not at all.
  One agent is configured today; two isolated agents are two stores over the
  same registries. The runtime this build ships is
  the tool loop over the OpenAI Responses context engine, on the keyed
  adapter or the hosted one; it ends a run only through completion,
  cancellation, its deadline, a throttle, a provider failure, an answer that
  stopped short, or the loop guard ported from OpenClaw `b7528507` (MIT;
  `THIRD_PARTY_NOTICES.md`), which is off unless configured, exactly as the
  pinned source has it. There is no count of tool iterations that ends a
  run. A checkpoint is stamped with the runtime that wrote it, its version,
  and the provider item format (`tool-loop@1:openai-responses-input/1`
  today), carried on the generation so an empty checkpoint keeps it too; a
  runtime loads only its own stamp, and a valid checkpoint of another stamp
  is not corruption: it is kept whole, beside the requests and the journal,
  every turn over it is refused as incompatible, and the way forward is a
  runtime that reads it or the developer's Start fresh. Corrupt rows are
  replaced by the store that observed them. Every hook of an engine may be
  asynchronous and is
  awaited only until the run's signal fires, like every wait on the model.
  Compaction has exactly one owner, the host's `compaction.ts`, reached
  through the runtime's own `compact` and `capabilities` seams so the host
  still touches no model directly: the request asks the provider for no
  automatic compaction, and the host folds the context under OpenClaw's
  reserve policy — 20,000 tokens, capped at a
  quarter of the model's window — by asking the provider for an explicit
  compaction and adopting the answered window whole, or, on a transport that
  cannot compact, by folding the older items behind a summary the model
  writes tool-free, cut at a user message so no tool call is parted from its
  result. Transport size is a separate admission constraint: a hosted request
  is prepared before it would cross the 2 MiB envelope, and never by deleting
  stored history or cutting an opaque item. A compaction the next turn needs
  that fails ends the run as a recoverable failure with the context exactly
  as it was; the optional one runs after a reply is persisted and its
  deliveries have settled, and a new ask cancels it.
- The prompt a turn runs under is composed, not fixed, and composed in three
  stages the diagnostics view shares with the live run: the configuration
  resolved, the runtime facts gathered under it, and a pure builder that turns
  facts into ordered sections, a stable prefix, a dynamic suffix, and
  diagnostics. The facts come from the agent's identity workspace under its
  own directory (`agents/main/workspace`): `AGENTS.md` for operating
  instructions and tool notes, `SOUL.md` for the persona, `IDENTITY.md`,
  `USER.md` for stable facts about the developer, `MEMORY.md` for curated
  memory, `BOOTSTRAP.md` for first-time setup, and `HEARTBEAT.md` for the
  scheduled review, following OpenClaw `b7528507`'s prompt composition. A
  missing file is seeded once at launch; an existing one, edited or not, is
  never rewritten by an upgrade. Each file is cut to 20,000 characters and
  the set to 60,000, and a cut is named in the prompt and the diagnostics
  rather than hidden. Ordinary conversation, observation, and heartbeat runs
  use the full profile; a child run gets the minimal one, `AGENTS.md` alone
  and none of the parent's persona or notebook files; the none profile is an
  identity line. Daily notes under `memory/` are never in an ordinary prompt:
  they are read on demand and primed when a conversation starts fresh.
  Skills are listed by name, description, and location, and a skill's
  instructions are loaded on demand from a listed location and no other.
  Notes found where a run executes are a section of their own, apart from the
  identity workspace. The brain's workspace tools read and write these files
  and nothing outside the workspace directory, and are the one place the
  brain writes a file at all: a provider's transcript or session state is
  still never written. A workspace call whose arguments are not the strings
  the tool takes is refused before anything is journaled, never filled in,
  so a malformed write can empty no file. There is no prompt without the
  workspace: a host prepares every turn from the resolved configuration and
  the workspace files, and the runtime package that composes it knows the
  files' names and bounds but none of their words, which the brain supplies.
- The desktop reaches the judgment through one boundary, the Gateway
  protocol in `runtime-contracts` (`protocol.ts`): versioned request,
  response, and event envelopes, a fixed method vocabulary, and typed error
  codes. The host side (`GatewayServer` in `packages/runtime`, composed as the
  desktop's `GatewayService`) owns the idempotency ledger (every mutating
  method carries an idempotency key; the same key finds the first answer, the
  same key with other parameters is a conflict, never a second effect), the
  revision checks (a request built over a replaced conversation lifetime or
  configuration is refused before its handler runs), and the event log,
  numbered from one, whose bounded replay window a reconnecting client is
  replayed from or, past it, handed a fresh snapshot rather than a silent
  skip. The client side (`GatewayClient`, the desktop's operator) mints
  request ids, keys mutations, follows the sequence, and fills a gap from the
  host's log before delivering anything later. Desktop main is the one
  operator client; the renderer and voice windows keep the narrow preload
  bridge and never speak the protocol. The native capabilities the brain's
  own acts reach (opening an address a validated act named with the
  operating system, carrying an app act to the panel) are registered as one
  node's capabilities and asked for by name; a capability no connected node
  offers answers a typed unavailable, and the act that needed it is left
  undone and recorded as such, never as carried. An open the desktop performs for itself (the microphone or calendar
  privacy pane, a provider's API-keys page, the releases page, the
  changelog) reaches the operating system directly, as the client's own
  act, and crosses no node; an open a host-owned flow needs (a session's
  address, an OAuth consent page, a Superset or Conductor link) crosses the
  native node, because the flow that asks for it runs in the Gateway.
  Microphone, playback, window control, and OS opening stay the client's;
  scheduling, tool decisions, history, provider operations, and delivery
  policy stay the host's. Replies to the ear keep the reply-grant ledger's
  guarantee with its states named (queued, offered, claimed, acknowledged,
  granted on call, withdrawn): the History write precedes any offer, the
  generation and the one current receiver epoch are checked at the grant, an
  offer a vanished renderer never claimed is offered again to the next epoch,
  a claimed one never is, and what is guaranteed is at most one authorization
  to speak per run, never that the words were heard. Meeting and pause holds
  stay in the host's speech arbiter, and a held observation briefing is
  re-decided in the conversation that decided it, never through main. The boundary has a process on each side of it. The one signed
  executable runs in two modes decided by its arguments: the desktop, which
  draws, and the Gateway (`--gateway`), which draws nothing, keeps a distinct
  Electron profile and single-instance lock under `gateway-profile/`, and is
  handed Luke's existing state root explicitly (`--state-root=`), so what it
  owns is the state the desktop always kept and nothing of it derives from
  the profile directory. The Gateway process composes and owns the runtime:
  the settings store and its `safeStorage` cipher (so the credentials are
  decrypted in the Gateway, under the same app name and Keychain entry, with
  no desktop-side owner to fall back to), the account session and its
  refresh, the provider-key vault sync, the counted events, every provider
  registration and the roster and observation loops, Superset and Conductor,
  the hook registration and spool watchers under that state root, Linear,
  the calendar readers and their holds, the speech arbiter, the reply
  deliveries and the receiver epochs, the runtime store worker, the notebook
  and its maintenance, the brain, the conversation operations, history
  maintenance, the scheduler, the development trace, and the arrival and
  calendar-onboarding records. The desktop keeps the windows, the keys, the
  Dock, the login item, the media duck, the output and microphone watchers,
  the microphone permission, the updater, the feedback courier, and the
  introduction; every bridge handler proxies to the host through one
  operator client, so the renderer and preload contract is unchanged. A
  fixture or capture run composes the same host in the desktop process,
  memory-only and network-silent, over the in-process transport, and starts
  no Gateway. A live desktop launch finds a healthy Gateway of its own build
  through an owner-only discovery record (`gateway/` `discovery.json`:
  loopback port, per-process token, pid) and reattaches, or starts one,
  detached, so a client that crashes or reloads leaves the Gateway standing
  and the next client finds it; a Gateway of another build is asked to shut
  down and drained before this build starts its own, never run beside; and
  at most three automatic restarts a minute are made while a client is
  attached, after which the typed disconnected error stands on the existing
  path and nothing new is drawn. Every attachment adopts the host's event
  stream anew (its sequence and snapshot), so a replaced host's events are
  never dropped against the old host's count, registers the desktop's node
  on the connection that now stands, and reads one bootstrap before the
  launch decides anything from it. The transport between them is a
  WebSocket on `127.0.0.1` at an ephemeral port, the token compared in
  constant time on the handshake's authorization header and never in an
  address, the protocol version refused when it differs, and a build that
  differs admitted drain-only (hello, reconnect, shutdown). A node's
  capabilities are invoked on that node's own authenticated connection as
  transport frames, never as events, so no reconnection can replay an ask
  to act; the host settles an ask whose connection closed before it
  answered as unknown (dispatched, effect uncertain), answers an ask made
  after as unavailable (never dispatched), and the two reach the act
  journal as an unknown act and a refusal respectively, an unknown act never
  retried on Luke's own initiative; the node performs each invocation id
  once, answering a repeated frame from the first performance. The Gateway
  leaves only at the explicit Quit, or the updater's restart into a
  downloaded build, each of which asks it to shut down and waits, bounded
  even under a host that stops answering: admissions closed, every run and
  child under way cancelled, the publication drained, ten seconds for it to
  settle, and whatever did not settle counted from the persisted envelopes
  and left for recovery, which marks it interrupted and replays nothing.
  Nothing installs it at login and nothing restarts it after an intentional
  quit. The same protocol suite runs over the in-process transport, the
  loopback text transport, and the socket. The method vocabulary the split
  needed is additive and named in `protocol.ts` (`client.bootstrap`, the
  `settings`, `credential`, `account`, `calendar`, `tracker`, `superset`,
  `session`, `workspace`, `speech`, `receiver`, `voice`, `guide`,
  `analytics`, `conversation.append`, and `onboarding` methods, and the
  change events beside them; `voice.recordTrace` carries the renderer's
  tapped realtime events to the development trace writer the Gateway owns,
  under the same gate, so an untraced run drops them at the host); no
  credential or account secret travels in any answer or event, and the one
  secret that reaches the voice client is the
  ephemeral realtime credential the host minted. Widening the method
  vocabulary, the event set, or what a node may be asked is a product
  decision, not an implementation detail. The same protocol suite runs over the in-process transport, the
  loopback text transport, and the socket; widening the method vocabulary,
  the event set, or what a node may be asked is a product decision, not an
  implementation detail.
- The hosted tier speaks two brain contracts. The first, kept for installed
  clients, carries the input array and a turn authority and lets the service
  derive everything else. The second (`/api/brain/capabilities`,
  `/api/brain/v2/respond`, `/api/brain/v2/count-tokens`,
  `/api/brain/v2/compact`) lets the desktop prepare the prompt — bounded to
  its own 200,000-character envelope, refused past it, never cut — and name
  the tools it offers, each a registered name the service holds a schema
  for; a caller can never upload a schema, and an unregistered name refuses
  the request. The service still fixes the model, the upstream, its
  credential, the refusal to store, the output budget's ceiling, and the
  2 MiB body bound, spends the same review allowance per operation, keeps
  no conversation, executes no tool, and answers an explicit compaction's
  whole window for the desktop to adopt as it came. A desktop built on the
  second contract reads the capabilities first and fails with a
  compatibility error when the service lacks them; it never falls back to
  the first. The service therefore deploys before such a desktop ships, and
  widening either contract is a product decision, not an implementation
  detail.
- What the brain keeps is one generation per conversation, in one database
  under one writer, and the generation's shape is the retention rule for the
  model's context alone. The database is the runtime store: one SQLite file
  per agent under Luke's own application data (`agents/main/agent.sqlite`),
  written only from its own worker thread, with a table for each kind of
  thing the envelope holds — the model's checkpoint items, the transcript
  cursors, the requests, the action receipts — beside each conversation's
  own lines, its retained transcript, the recovery archives of deleted
  history, and the facts Luke remembers, so the main thread never waits on
  the disk and no second writer exists. The files an earlier build kept
  beside `settings.json` are left in place and never read: nothing draws or
  writes them any more. Every save is a compare-and-set against the
  generation the writer last observed standing, so a stale writer can
  neither refill nor replace a newer generation, and a generation whose rows
  this build cannot read is replaced by the store that observed it and by
  nothing else. The envelope holds the Responses input from the latest
  compaction onward — the API's encrypted compaction item included, which is
  user-derived data however opaque — the transcript cursors, the record of
  every developer ask and how it ended, and the action journal that pairs
  each act with its outcome. What is stored, what the model is shown, and
  starting fresh are three different things. The transcript table keeps
  every input the context engine ingested and every point the projection
  folded, written in the same transaction as the checkpoint that carries
  them, attributed to the lifetime that wrote them and cascading with none:
  a compaction changes the projection and erases nothing on record, and the
  record stays searchable. A generation does not reset on its own: the
  default reset policy is none, as the pinned OpenClaw has it, so a
  generation stands until Clear or Start fresh replaces it, however old its
  checkpoint. Every generation is still stamped with a deadline fourteen
  days from its creation, kept as the stored envelope's shape: no write,
  checkpoint, or compaction moves it, a file claiming any other span reads
  as nothing, and a checkpoint loaded past it keeps its identity and its
  context whole. Only a store whose automatic reset was explicitly enabled
  enforces that deadline, at load, at the door of every turn and
  submission, and by a timer armed at the instant itself; the store this
  build wires enables none, so the clock arms nothing. Where a generation
  does end, by that opt-in expiry or by an explicit replacement, the fence
  is synchronous: the store forgets the dead generation
  and announces the successor before any disk is waited on, so a turn
  holding a model answer, a transcript read, or an act's preparation is
  revoked at once, a write landing afterwards installs nothing, and the late
  result lands nowhere. The conversation's lines answer to their own
  retention, not the generation's: each line is stamped with the generation
  that stood when it was written, for attribution alone, and a generation's
  end erases no line. A generation's end revokes its runs and, through
  the host's own listener, withdraws every briefing it had queued or offered
  but not yet spoken; a version-1 file, of unknown age, reads as nothing
  rather than as a fresh lifetime; a generation found unreadable or past its
  bounds at load (or expired, under the opt-in policy) is replaced on disk
  in the same load rather than left for a later write; and the empty
  generation that follows may
  observe the same provider files again, because the rule bounds how long a
  reading stands, not whether the source can be read. Within its life a
  generation holds at most 200 records and its serialized file stays under 8
  MiB: ended runs whose ends History has taken go first, each with its
  journal, a new ask is refused at the door when nothing can go, and a write
  that would still grow an envelope past a bound is refused rather than
  dropping a run still going or its journal.
- The conversations are a directory, and the main process carries five
  distinct operations over it, none of which a window can name: no bridge
  entry lists, creates, resets, archives, or restores a conversation. The
  History tab draws exactly what it drew before — one thread and its Clear —
  and the Clear is Delete history on main; the selector, threads, Start
  fresh, Archive, and Restore reach no control and no bridge until a product
  decision draws them, and stand exercised by their tests. Main is the
  agent's ordinary conversation, the one the talk key, both composers, and
  every observation reach; a private thread (`agent:<agentId>:thread:<uuid>`)
  is another logical conversation of the same agent with its own generation,
  history, and transcript, and only main's thread is relayed to a window. A
  temporary thread is held in memory alone — its history and its envelope
  both — and is gone at the next launch; nothing said in it is remembered
  automatically, and its explicit `remember` writes are the same act as
  anywhere. **Start fresh** replaces a conversation's generation with an
  empty one under the same synchronous fence, with no marker, because
  nothing is erased: the history and transcript stand, attributed to the
  lifetime that wrote them, and the facts Luke remembers are untouched;
  resetting never means forgetting the notebook, and the control says so.
  **Archive** takes a thread off the active list, retires its brain, and
  keeps everything; main cannot be archived. **Delete history** is the
  recoverable deletion, in a fixed order: the relayed thread is fenced and
  every window told, the conversation's brain retired and its publication
  drained, and then the store removes the conversation's lines, transcript,
  boundaries, and standing lifetime in one transaction with a compressed
  recovery archive of them all — zstd through `node:zlib` where the runtime
  has it, plain JSONL otherwise — committed into the archive registry and the
  conversation's cutoff raised to the deletion's instant; only then is the
  archive published under `archives/` as
  `<conversation>.jsonl.deleted.<timestamp>.<id>[.zst]`, written exclusively,
  synced, linked into place, and read back against its hash, and only a
  verified publication reports the deletion complete; a payload not yet
  published stays in the registry and every launch retries it. The cutoff on
  the conversation's row outlives any generation and is only ever raised by
  a deletion, so a late line from before it is refused whatever the disk did;
  the main process's thread carries an epoch the fence moves, so a store
  answer still out installs nothing. **Restore** brings an archive back
  into its own conversation with the same key, creation instant, and line
  ids, releasing the cutoff the deletion raised to what stood before it, and
  refuses when the conversation already holds newer lines: a live
  conversation is never overwritten by an older copy of itself. A deletion
  reaches neither the facts Luke separately remembers nor any provider's
  file.
- History maintenance is OpenClaw's, ported from `store-maintenance.ts` at
  the pinned `b7528507` (MIT; `THIRD_PARTY_NOTICES.md`) and run at every
  live launch and hourly after, with interrupted archive publications retried
  first. Its defaults are the pinned ones — enforce mode, a 30-day stale
  threshold, a 7-day idle threshold for private threads, 5,000 unarchived
  conversations, a 10 GiB physical budget cleaned to 8 GiB, automatic reset
  off, archive age expiry off — and its rules are the source's: ordinary age
  and count maintenance never touches an archived conversation; a
  conversation is archived in place and never removed outright, since every
  kind this build makes is durable; main, a pinned conversation, one with a
  run under way, and any
  key this build cannot classify are never victims; the cap counts only
  unarchived rows, takes the longest untouched first with later insertion
  winning a tie, and leaves the directory above the cap when protected rows
  alone exceed it. The disk budget measures the database, its WAL, and the
  published archives, never a serialized estimate and never a staging file
  still being written; over budget it removes stale staging, then the oldest
  archive files, then permanently deletes conversations the cap itself
  archived, oldest first and each through the recoverable archive, and
  never one still protected; what protected data leaves above the target is
  reported, not deleted. Widening what the brain reads, where it travels,
  how long a generation stands, what a deletion leaves, or what maintenance
  may remove is a product decision, not an implementation detail, and
  `PRIVACY.md` says each in as many words.
- The notebook maintains itself, and every maintenance write is bounded,
  reviewable, and reversible. Three things write it without an ask. The
  pre-compaction flush, following OpenClaw `b7528507`'s memory flush: once
  per compaction cycle, 4,000 tokens under the compaction threshold or once
  the retained transcript crosses 2 MiB, an eligible conversation (main or a
  durable private thread; never a temporary thread, an observed session, or
  a child) runs one housekeeping turn over a private copy of its context,
  offered the workspace read and a write narrowed to today's dated note (or
  a slugged variant of it) and to appending, so no bootstrap file and no
  earlier entry can be overwritten; the copy is disposed at the turn's end
  and nothing it said enters the conversation; a write stands as soon as it
  is made, and only a turn that ran to its end marks the cycle flushed, so
  an interrupted flush runs again. The cycle is durable, with one owner for
  each half: the compaction count is the generation's own and rides on its
  envelope with every checkpoint, and the marker saying which count was
  flushed is maintenance state in the store's flush-state table, keyed by
  the generation's id, read once per generation before its first assessment
  and written after each completed flush, so a relaunch neither flushes a
  cycle twice nor skips one, and Clear, Start fresh, and Delete history
  begin a lifetime at cycle zero that consults no earlier marker. A marker
  that cannot be read defers the flush; one that cannot be written after
  three attempts is reported and leaves the cycle unflushed, never silently
  done, and the housekeeping turn itself is never rerun to retry a write.
  The reset capture: Start fresh on an
  eligible conversation runs the same turn first, its outcome reported
  honestly and never deciding the reset, which proceeds either way; Clear,
  Delete history, Archive, and a forget run no capture. The consolidation
  sweep: one managed daily job at 03:00 local time, on the background lane,
  runs light, REM, and deep phases following OpenClaw's dreaming design.
  Light stages the History lines of eligible conversations since each
  conversation's cursor, each line hashed so it is learned once, recalled
  context stripped and secrets and identifiers redacted first, with its
  origin kept (the developer's ask, Luke's reply, or system: an act's
  narration or a child's relayed words), beside the lines of the recent
  dated notes; REM reflects on recurring themes and writes nothing durable;
  deep ranks the staged candidates by the pinned six weighted signals and
  gates (score 0.75, three recalls, three distinct queries, at most ten
  promotions, 14-day recency half-life, 30-day maximum age), re-reads each
  candidate's source immediately before publishing and skips one that is
  gone, asks one tool-free model call for additions, merges, and
  supersessions, validates the answer (one operation per candidate, prior
  entries exact and unique, a merge only of an entry saying the same thing,
  a supersession only along a named lineage, every candidate's source
  reference present, at most 25% of prior entries lost, the file within its
  20,000-character bootstrap budget), and falls back to the deterministic
  append-only path when the model is unavailable or the plan fails. An
  external or system origin never promotes however often it recurs. Only
  `MEMORY.md` takes promotions, written on the store's worker behind a check
  that the file still reads as the plan was built over it, with the preimage
  recorded first, and the Dream Diary goes to `DREAMS.md`, which is never a
  promotion source. Candidates, cursors, seen hashes, tombstones, rewrite
  preimages, and flush state live in the runtime store's own tables.
  Forgetting is source-aware: naming notebook entries, candidate keys, or
  conversations removes the entries, the candidates, the `MEMORY.md`
  promotions their markers attribute to them, and the index rows, tombstones
  the sources so no later scan relearns them, and clears the recall caches;
  a promoted entry whose marker a hand edit removed cannot be attributed and
  is reported as a limitation rather than claimed erased. Deleting a
  conversation's history stays the separate, recoverable operation. Widening
  what the flush may write, what consolidation ingests or promotes, or what
  a forget reaches is a product decision, not an implementation detail, and
  `PRIVACY.md` says each in as many words.
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
  fixed `$lib` tags — absent or unrecognized means the desktop. The watch app
  counts through the same Swift sender under its own fixed client value and
  runs no other stream: the SDK's replay and crash autocapture do not build
  for watchOS, so the watch posts nothing to the analytics provider directly.
  The service attaches the account's own name and address to
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
  the 20 most recent lines enter model context, each cut there to its own
  length bound, beside the brain's own working memory of its turns. There
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
  what erases its recordings too. The watch app does not record at all.
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
  policy replacing the old "dies with the app": every admitted line stands
  in the runtime store's own table until Delete history or the conversation
  maintenance below removes it, and what the panel draws and the model is
  handed is a projection over that record, the 200 most recent lines and
  nothing older than a fortnight. Each line
  carries an id its writer minted, and the store's append is idempotent on
  it: a window reports only the lines it added, never the whole thread, so a
  report can add to the thread and never replace it, a line delivered twice
  is one line, and two deliberate identical utterances are two. What the
  thread hands a model is the same bounded recent slice, riding beside the
  brain's own working memory, and History's Delete history reaches the
  stored lines as well as the screen, behind the recovery archive the rule
  above describes, because a deletion that emptied only the view would leave
  the words on the machine with nothing left to draw them. The narrower thing is a durable
  fact about the developer themselves. During a turn the developer opened,
  Luke may silently keep a concise stable preference, personal fact, goal, or
  recurring constraint. He skips transient details and uncertain inferences,
  never stores credentials, and stores a sensitive fact only when explicitly
  asked. The canonical record is the notebook: one bullet line of `USER.md`
  under its remembered heading, human-readable and editable, and the runtime
  store keeps only provenance beside it (the entry's id, when it was written,
  whether it came from the developer's hand, Luke's tool, or the fact table an
  earlier build kept, and the file hash last reconciled). The write runs the
  same act gauntlet as every other write — validated in the renderer,
  validated again in the main process, and admitted by the effective tool
  policy — and every mutation of the notebook is one request to the store's
  worker, which answers one at a time per workspace and reads the file again
  before writing it, so two conversations or a child remembering at once
  cannot drop each other's entry and a line edited by hand is folded in rather
  than overwritten. A changed fact names the entry it replaces so
  contradictions do not stand together; duplicates add nothing; a request to
  forget names one of the ids the conversation received; and at most 32 lines
  stand. The `personal_facts` table is migrated into `USER.md` under the same
  ids at the first open that finds rows and has no writer after that. The
  complete list enters each conversation as reply context. It is never drawn,
  never reaches a provider file, never reaches a write path, and never
  reaches the attention evaluator, whose input stays what a provider wrote
  about a session. Widening either — what may be stored, how long it stands,
  or where it may travel — is a product decision, not an implementation
  detail.
- The notebook is searchable, and the index is derived. The runtime store
  keeps a disposable search index over `MEMORY.md`, `USER.md`, and the
  Markdown notes under `memory/` — sources, chunks of 400 tokens with 80 of
  overlap, an FTS5 shadow, and an embedding cache of at most 50,000 entries —
  following OpenClaw `b7528507`'s memory-search defaults (six results, 0.35
  minimum score, 0.7/0.3 vector and keyword weights, four candidates per
  result, MMR at λ 0.7, a 30-day half-life on dated notes and none on the
  evergreen files). A sync is planned and applied on the database worker,
  which also runs the cosine similarity; only the chunks with no cached vector
  travel to the embedding adapter, OpenAI's embeddings on the developer's own
  key or the hosted contract's `embed` operation on the account, and a sync
  or search that cannot have embeddings degrades to keyword-only under the
  automatic provider selection and says so, while an explicitly selected
  provider's failure reads as unavailable. The files are watched and
  reconciled 1,500 ms after a change, and a rebuild drops every derived row.
  The brain reads the index through `memory_search` and `memory_get`, reads
  answering only for paths inside the notebook root, each result carrying
  its path, line range, score, and provenance. A developer's ask in main or a
  private thread first consults trusted memory deterministically and, when it
  reads like a question about the past, runs one bounded recall subrun — the
  two memory tools and nothing else, 15 seconds, a summary cut to 220
  characters, two recent asks and one reply as input, cached 15 seconds, and
  stood down for a minute after three consecutive timeouts — whose summary is
  ephemeral context for that one turn and is written nowhere, so recall never
  promotes its own output into memory. Past-conversation recall reads the
  retained History lines of eligible conversations (main and the developer's
  private threads of the same agent, never the asking conversation, a
  temporary thread, an observed session's conversation, a child, a cron or
  heartbeat conversation, or another agent's) and indexes no transcript.
  Widening what is indexed, what recall may read, or where an embedding
  travels is a product decision, not an implementation detail, and
  `PRIVACY.md` says each in as many words.
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
  before it leaves the renderer; each brain turn and request as its
  about-fields and counts (trigger, authority, input item kinds, transcript
  bytes, tool names, token and briefing character counts, model, timing)
  and never a transcript's text; and each speech decision the arbiter took,
  as the turn's kind, the decision, and how many requests still stood, never
  the briefing's words — appended as
  JSONL under the developer's chosen directory and
  sent nowhere; `pnpm trace:export` turns one file into a document a local
  viewer opens. The tap only observes: nothing reads its result, and the
  Gateway drops the renderer's tapped events whenever no writer stands.
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
  consent dialog. The helper is a device capability, so it runs in the
  desktop process at the Gateway's ask through the native node
  (`appleCalendar.runHelper`), each invocation a command fixed by the build
  with the window's instants and the chosen calendar ids; the calendar
  policy, the stored connection, and the intervals stay the Gateway's, and a
  desktop that is not connected is a failed read that keeps the last
  intervals standing. The dialog is the connection, and nothing is stored but
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
- On the brain and speech paths, session material leaves the machine
  unbidden in exactly two places, each with its own narrower rule; the
  analytics, replay, and crash streams above are disclosed on their own terms
  and are not counted here. The brain's own turns are the first, under the
  transcript-read rule above: what a local session's transcript gained since
  the brain last looked, bounded and behind a marker, on the developer's own
  key or through Luke's own service. The second is a briefing the brain
  decided to give — its own words about what changed, under the briefing
  bound — which reaches the voice service so it can be said aloud, as the one
  input of a call that carries no tools and no conversation, behind a marker
  that says it is data, so nothing in a briefing can become an act or inherit
  an earlier question. Nothing decides an announcement deterministically any
  more: no status edge speaks on its own, and no evaluator sentence stands
  between the transcript and the voice. The hosted service still answers an
  older installed desktop's attention review and subject derivation under the
  frozen released persona; the current desktop calls neither. Two onboarding
  beats are
  the members of that set about no session, and each keeps the same terms:
  worded from a script fixed by the build, speak-only and tool-free like a
  briefing, drawing no notice band and claiming none. The arrival
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
  reporting the reply actually begun settles it. When no conversation is
  open, Luke opens a call of
  his own to say a briefing, and that call is speak-only by construction: it
  offers no microphone track, carries no tools, and is sent the one briefing
  alone: never the roster, the guide, or a
  transcript, which reach only the brain, and the voice only as the words the
  brain chose to say. The desktop's voice knows no roster, guide, or history
  of its own: a developer-opened conversation hands their words to the brain
  through the voice's one tool and says the brain's reply whole. It is the
  brain whose standing context carries the recent exchange — the 20 most
  recent History lines, each cut to its own length bound (the developer's
  asks, typed or spoken and handed back as text by the service that heard
  them, the words Luke spoke or announced, and the acts he carried at their
  ask), beside the brain's own working memory of its turns — so the one
  conversation survives the calls that transport it: a briefing read out on
  Luke's own call, or a call retired idle, is still remembered on the next
  ask. A reply that quoted or summarized a transcript read is History like
  any other reply, and enters that context under the same bounds. Each
  History line's session identity is the roster-validated one its act
  traveled with, and the history is stored only where the constraint above
  puts it, on this machine and under its retention policy, and is never sent
  on Luke's speak-only call. The phone's call keeps the older shape: it
  carries the roster it was shown as context and the session acts as its own
  tools, and no History. A
  briefing's trigger is an observation turn of the brain — a provider's hook,
  the brain's own look at the roster on the observation pass, or a hold's
  release — and the brain's `announce` call inside it, offered in no other
  kind of turn; an onboarding beat's trigger is its own deterministic one
  (the recorded sign-in edge, or the calendar gate standing). A briefing
  speaks whenever voice can, through the speech arbiter, which holds it while
  a meeting or the pause stands and lets a held briefing be decided again
  against the roster as it then is rather than spoken stale. Widening either
  set is a product decision, not an implementation detail; make it
  deliberately. While a briefing is being spoken, its words are captioned on
  Luke's own surface under the housing, and nothing else is drawn about it:
  no notice names a session, no chip previews an issue, and no press under
  the housing opens anything, so the words are the whole of what an
  announcement puts on screen, and a session's address is still reached only
  by its row's press or a validated ask in a developer-opened turn.

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
