# `@sidecar/host`

## Everything of the machine arrives as a seam

`composeHost` is handed the state root, the version, the environment, the
cipher, the store worker, the clock, and the id source, and derives none of
them. Nothing here reads the hosting process's own profile, so a validation
run on a temporary state root is the same composition as a live one, and a
process on the other side of a socket is too. A seam that would be easier to
read directly — `app.getPath`, `process.cwd`, `Date.now` at a call site — is
the one thing that would make this package the desktop's again.

Each of those seams is a `Context.Tag` behind `@sidecar/host/effect`, and the
kernel is a `Layer` over them: the state root, the run mode, this build's
identity, the environment as a `ConfigProvider` a development override is read
out of by the variable's own name, the cipher, the store worker, the id source,
and the reporter, whose `Logger` writes where a reported line goes so an
`Effect.log*` and a `report(line)` land in one sink. A composition states the
seams it reaches and cannot build without them. `hostSeamLayers` stands every
tag up from the one `HostSeams` object the desktop builds today,
`createHostKernel` is the adaptor beside it, and `hostLayerFromSeams` and
`composeHost`'s `start()`/`stop()` face are the same shim one level up, each
a named shim the migration's last host PR deletes; the clock seam stays the
injected reading for as long as a test drives a `FakeClock`.

Every override that seam holds is a `Config` read of the variable's own name,
and the settings store's are read together (`effect/settings-overrides.ts`):
the launch voice, the two registrations a development run points the Google
Calendar and Linear sign-ins at, and each credential provider's own key
variables, the keys as `Config.redacted` because the store hands one on to
that provider's adapter and to nothing else. The store itself reads no
environment any more — it is handed what was resolved — so nothing it answers
can depend on a variable this composition was not given. Which packaged build
honours which override stays with the override rather than with the provider:
the account service's is refused at the packaging boundary by
`accountBaseUrlFor`, and a key this machine's shell exported is read in a
packaged build exactly as it always was.
The settings composer reads these through the `Environment` seam directly, as
`settingsOverrides`; its own tests read the same effect over a `ConfigProvider`
built from the environment record they still hand in, and
`settingsOverridesFromEnvironment`, the record face beside the effect, is gone
with that last caller.

## It draws nothing, and imports no Electron

What a window must learn leaves as a host event; what only the machine a
client runs on can do is asked of the native node by name, and answers a
typed unavailable when no node offers it. There is no `electron`, `react`, or
DOM import in this package, and the two files that needed one were split at
that line: the ipcMain registrations stayed in `apps/desktop/src/main/ipc/`,
and resolving this Mac's EventKit helper bundle stayed in
`apps/desktop/src/main/native/`.

## One composition, nine concerns

The host is one `Layer` (`hostLayer`, behind `@sidecar/host/effect`) over the
kernel: `hostAssemblyLayer` constructs, links, and merges, holding no state of
a concern's own and beginning nothing, and `hostStandingLayer` over it starts
every concern in the launch's order (`HOST_START_ORDER`), arms the loops after
the last of them, and registers the drain last of all. The Gateway's own
layers are built in the assembly's scope: `createGatewayService` is an
`Effect` that folds the merged methods into `layerGatewayInProcess`'s options
and answers the `GatewayInProcessHost` every transport in this process is
bound to, so the server's fiber stands exactly as long as the assembly does
and nothing composes a runtime of its own behind it. What the composers still
hold is a synchronous `emit` over that host's event log, run on the assembly's
own runtime, because a change is reported to the service from a callback
rather than from an effect. Each concern is a
composer — settings, account, devices,
conversation, issues, observation, calendars, brain, live — that owns its own mutable
state, its own timers, and the Gateway methods of its domain, and answers
`start()` and `stop()` for exactly what it began; `composerLayer` is that
composer as a scoped layer whose build runs `start` and whose scope closing
runs `stop`, so the scope a composer was built in is its lifetime and nothing
else stops it. The stop is registered before the start runs rather than as
the release of a successful acquire, because a composer's `stop` is written
to give back what a partial or failed `start` allocated. The layers
are built one after another in one sequential scope (`layersInOrder`), never
merged, because `Layer.merge` builds its sides concurrently and closes them in
parallel, and a start that fails releases what began — the failed composer
included — at once, in reverse, leaving nothing for the close. The devices composer answers
no method at all: it is this installation's device row on the service,
registered when the account gate opens, kept warm by the change-signal poll,
and forgotten at sign-out on the departing account's own token. The poll's
cadence is a `Schedule` on a fiber forked into a `Scope` the registration
forks at its start from the one the composer was built in, so the sign-out's
stop closes that scope and no handle is kept only to be handed back, and the
host's own close ends the poll whatever became of the stop; `Effect.schedule`
and not `Effect.repeat`,
because the beat the start awaited is the first one and the cadence stands
one interval on from it. Each poll
restates two facts of this machine and decides nothing from them: the instant
its presence holds until, from the idle time and lock state the client reads
off the machine and hands in as the `machinePresence` seam, and the instant
the calendar's meeting hold ends, asked of the calendars composer; `null`
where neither holds, so a registration that cleared them is never followed
by a stale hold restated from memory. The brain composer is an effect over
the kernel's own tag, and what it reads out of the build is the runtime it is
being built on: the store's asks and every run of a conversation's tool loop
are fibers of that one runtime, never of a default one built where the work
lives. The calendars composer holds three
observation-driven timers of its own — the held-notice release, the Apple
access poll, and the meeting-boundary wake — each forked into one `Scope`
`startObservation` forks from the composer's own and `stopObservation` closes,
so a sign-out's stop ends all three at once; the first two are fixed `Schedule`s on
that scope, exactly as the devices composer's poll is, and the third is a
one-shot fiber the composer re-arms itself, because its delay is recomputed
from the meetings every observation pass just read rather than held fixed.
Both the calendars and issues composers carry the runtime the layer they were
built under is running on into the classes that still answer a promise —
`GoogleCalendarReader`, `googleCalendarSignIn`, `LinearCredentials`'s renewal,
and `linearSignIn` — so each runs its request or its consent trip there
instead of on the ambient default runtime. The conversation composer is the
Conversation as the service holds it: on its own five-second loop it asks the
change signal where each resource stands, reads only what moved behind the
cursors this device holds, folds the pages into one picture
(`conversation-view-sync.ts`), tells every client when it moved, and answers
the tab's two writes: Clear as the service's soft delete, and a thumb on one
of Luke's messages as the service's rating event, written only for a message
the picture holds and Luke authored, taken into the picture from the answer
so the verdict shows before the next poll, and counted as the verdict and the
message's kind read from the held row; nothing of the local store is read
for it. The assembly folds their
method tables into one (`mergedMethods`) and a method two of them claim fails
the build with `DuplicateGatewayMethod`, so which concern answers a method is
checked before anything starts rather than left to the fold's order. `client.bootstrap` is the one method no composer owns: it reads
six of them, and giving it to any would hand that composer references to the
other five. The service the merge composes is itself read late: on the
kernel's own layer it is a `Deferred` set once — a second write answers `false`
and the first service stands, so which service a concern holds cannot depend on
the order the merge folded it in — and a reader that has migrated awaits it
rather than holding a getter that throws.

The concerns depend on each other in both directions in six places — the
account's capability gate starts the loops whose owners read that gate, the
calendars hold the speech that reconciles against them, the live session
hands a held briefing back to the brain that decided it — so those edges are
`link()`'s, listed once in the merge and held in `@sidecar/wire`'s `LateRef`
where the concern is still built as a plain object, and in the kernel's own
set-once `Deferred` (`lateService`) where it is built as an effect, as the
account's and the calendars' both are; either throws by name when read before `link()` has run, since
what holds the link is a callback the session manager and the Gateway
handlers answer synchronously. The desktop's own
composition closes its cycles the same way, which is why the holder lives in
the package below both rather than in either. Everything else is a constructor
argument, in the order the composers are built.

## One drain, in one place

The quit is the closing of the one scope `hostLayer` was built in, and the
scope's finalizers are its order: the drain first, registered last of all
(`hostDrain` over `@sidecar/gateway`'s `shutdownGatewayEffect`, on the clock
of whoever asked rather than through a promise door of its own: admissions
closed, everything under way cancelled, a bounded wait for it to settle,
whatever did not settle written down as unresolved for
the next launch's recovery), then the loops disarmed, then every composer's
stop in the reverse of its start, and only then the store closed. A step that
threw is the drain's own named refusal rather than a defect the close carries.
A stop
that fails strands none of its siblings and surfaces in the close's own
`Cause`. What a stop misses the close still ends: every cadence a composer
arms at the account gate's own edges — the observation loops, the device
poll, the calendars' three timers, the hourly conversation maintenance —
forks its scope from the one that composer was built in
(`@sidecar/runtime/effect`'s `cadenceHome`), so those fibers run on the host's
own runtime rather than an ambient default one and are interrupted by the same
close, and one armed after it forks from a scope already closed, which
interrupts what it forked at once. Their `start` and `stop` stay, because what
arms them is the gate opening and closing rather than the composer's own
lifetime: a sign-out disarms them while the host still stands. The drain runs once whichever door asks for it — `Host.stop()` under
the caller's own deadline, or the scope closing with the defaults — and every
later ask is answered with that outcome, so the admissions close and the runs
are cancelled once however many times the quit arrives. `Host.stop()` is
that close bounded: it interrupts a standup still under way, so no composer
after the one starting begins and nothing is armed behind the quit, then
drains, closes the scope, waits a fixed time for the close, and reports what
did not close rather than waiting on it, leaving it to the exit. A caller that ran the
steps itself would be a second order for the same quit, and there is none to
run; a shutdown never
fabricates a completion for work it cut off. The live voice session's
graceful close rides inside the same drain (`lifecycle.ts`): it begins with
the cancellations and is waited for beside them under the one deadline, so a
quit mid-call ends the session within the window and never after it, and a
final event that never comes leaves the usage unconfirmed exactly as a lost
connection would.

## The live session reaches the brain through one door

The one GPT Live session is owned by `@sidecar/voice`'s `LiveSessionService`
(`packages/voice/src/live-session/`), behind that package's `./live-session`
door: seeding the session from the record alone, the delegation
adapter, the transcript ledger's settled utterances, idle, and the graceful
close, over two units of its own — `append-channel.ts`, one session's sends in
order, each awaiting its acknowledgment or the error naming it and settled
spoken by the output transcript, and `proactive-queue.ts`, the briefings and
beats waiting for a session under the announcement hold. The machinery is
transport-neutral and lives in a package because two compositions hold a
sideband: this host's, over main's agent and the desktop's Conversation
writer, and the hosted voice service's in `apps/web/server/voice/`, over the
Postgres record. It reaches Luke's judgment only through `LiveBrain`: a
transport-neutral contract of ids and plain data — submit a spoken ask under
the service's own submission id and hear the run seams by name, and nothing
wider, because the roster stays with the brain and never reaches a session —
and nothing in the service imports `@sidecar/brain`.
This host's implementation adapts main's in-process `BrainAgent` in
`voice/live-brain-adapter.ts`; the hosted brain is another implementation of
the same contract, and the service moves with it. The run event kinds are
read by name and never assumed exhaustive: a brain that fires kinds this
build does not know leaves the adapter and every test standing. The record is
behind its own door too, `LiveRecord`, with a developer utterance and a Luke
utterance as two distinct writes — one table takes both here, and the hosted
record keeps the brain's reply and Luke's spoken words apart — and this
host's implementation is the desktop's Conversation writer in
`voice/conversation-live-record.ts`. The trusted sideband's socket seam is
implemented over `ws` in `voice/socket-over-ws.ts`, so `@sidecar/voice`
stays free of it and the live-session door can be bundled into a web
function. `compose-live.ts` is over the kernel as a tag rather than a constructor
argument, like every converted composer; the sibling composers it still
reaches — settings, account, calendars, observation, brain — stay
constructor arguments, since the cycles between them forbid tags. The one
brain and the one record it hands `LiveSessionService` are built in
`compose-host.ts`, where the brain composer stands, and handed in as
`@sidecar/voice/effect`'s `LiveBrainTag`/`LiveRecordTag` layers rather than
through `compose-live.ts`'s own constructor arguments; its idle, settle, and
finalize timers are `@sidecar/runtime/effect`'s `timersFromRuntime` over the
Effect runtime the composition runs on, in place of Node's own `setTimeout`.
The live service is the one sink for
everything Luke says unprompted: `compose-live.ts` takes every briefing from
the brain, every run's streamed reply to speak, and the two onboarding
beats. A briefing or reply with no session standing makes the service say it
wants one, and the voice window opens it muted. The one instruction the
service sends on the developer's behalf is the stop key's, through
`voice.stopSpeaking`: one `session.instructions.append` telling the model to
stop and then wait, into the standing session's own queue, and asked for only
while Luke is speaking, since the append is standing text a silent model would
read as a rule for its next answer. A muted microphone is
read as nothing but `micLive = false`; under hold-to-talk the talk key's
release mutes while Luke is still answering, so no recency of his output
turns a mute into a stop. Nothing else in the host
speaks: the earlier speech arbiter, reply ledger, and receiver epochs
are gone, and the guarantee they carried — at most one spoken reply per run —
now holds by construction, since a run's sentences reach the voice only as
the run's own events arriving at this one service, each appended once in
order and none after the run's end.

## The account preference client is here for the graph's sake

`account-preferences-client.ts` speaks two hosted routes and would otherwise
belong beside the vault client in `@sidecar/hosted`. It cannot: the snapshot
it reads and writes is `AccountPreferences`, which is `@sidecar/settings`
vocabulary, and `settings` already reaches `hosted`. This package is the
lowest one that holds both.

## The test scaffolding is behind its own door

`@sidecar/host/testing` holds the brain composition and the operator a
window's ask crosses, so nothing that ships can reach them. The three
fixtures every test in the repository shares — a temporary directory, a
stated microtask drain, a clock the test drives — are in
`@sidecar/runtime/testing`.
