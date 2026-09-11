# `@sidecar/host`

## Everything of the machine arrives as a seam

`composeHost` is handed the state root, the version, the environment, the
cipher, the store worker, the clock, and the id source, and derives none of
them. Nothing here reads the hosting process's own profile, so a validation
run on a temporary state root is the same composition as a live one, and a
process on the other side of a socket is too. A seam that would be easier to
read directly — `app.getPath`, `process.cwd`, `Date.now` at a call site — is
the one thing that would make this package the desktop's again.

## It draws nothing, and imports no Electron

What a window must learn leaves as a host event; what only the machine a
client runs on can do is asked of the native node by name, and answers a
typed unavailable when no node offers it. There is no `electron`, `react`, or
DOM import in this package, and the two files that needed one were split at
that line: the ipcMain registrations stayed in `apps/desktop/src/main/ipc/`,
and resolving this Mac's EventKit helper bundle stayed in
`apps/desktop/src/main/native/`.

## One composition, eight concerns

`composeHost` constructs, links, merges, and starts; it holds no state of a
concern's own. Each concern is a composer — settings, account, devices,
issues, observation, calendars, brain, live — that owns its own mutable
state, its own timers, and the Gateway methods of its domain, and answers
`start()` and `stop()` for exactly what it began. The devices composer answers
no method at all: it is this installation's device row on the service,
registered when the account gate opens, kept warm by a timer, and forgotten
at sign-out on the departing account's own token. The merge folds their
method tables into one and refuses a method two of them claim, so which
concern answers a method is checked at construction rather than left to the
fold's order. `client.bootstrap` is the one method no composer owns: it reads
six of them, and giving it to any would hand that composer references to the
other five.

The concerns depend on each other in both directions in six places — the
account's capability gate starts the loops whose owners read that gate, the
calendars hold the speech that reconciles against them, the live session
hands a held briefing back to the brain that decided it — so those edges are
`link()`'s, listed once in the merge and held in `@sidecar/wire`'s `LateRef`,
which throws by name when read before `link()` has run. The desktop's own
composition closes its cycles the same way, which is why the holder lives in
the package below both rather than in either. Everything else is a constructor
argument, in the order the composers are built.

## One drain, in one place

`Host.stop()` is the whole quit, in the coordinator's fixed order:
admissions closed, everything under way cancelled, a bounded wait for it to
settle, whatever did not settle written down as unresolved for the next
launch's recovery, and only then the store closed. A caller that ran the
steps itself would be a second order for the same quit; a shutdown never
fabricates a completion for work it cut off. The live voice session's
graceful close rides inside the same drain (`lifecycle.ts`): it begins with
the cancellations and is waited for beside them under the one deadline, so a
quit mid-call ends the session within the window and never after it, and a
final event that never comes leaves the usage unconfirmed exactly as a lost
connection would.

## The live session reaches the brain through one door

`voice/live-session-service.ts` owns the one GPT Live session: seeding it
from the record and the roster, the delegation adapter, the transcript
ledger's settled utterances, idle, and the graceful close, over two units of
its own — `voice/append-channel.ts`, one session's sends in order, each
awaiting its acknowledgment or the error naming it and settled spoken by the
output transcript, and `voice/proactive-queue.ts`, the briefings and beats
waiting for a session under the announcement hold. It reaches Luke's judgment
only through `LiveBrain` (`voice/live-brain.ts`): a transport-neutral
contract of ids and plain data — submit a spoken ask under the service's own
submission id, hear the run seams by name, read the redacted roster view — and
nothing in the service imports `@sidecar/brain`. Today's one implementation adapts main's
in-process `BrainAgent` in `voice/live-brain-adapter.ts`; a hosted brain
reached over HTTP is another implementation of the same contract, and the
service moves with it. The run event kinds are read by name and never assumed
exhaustive: a brain that fires kinds this build does not know leaves the
adapter and every test standing. The record is behind its own door too,
`LiveRecord` (`voice/live-record.ts`), with a developer utterance and a Luke
utterance as two distinct writes — one table takes both today, and a later
record keeps the brain's reply and Luke's spoken words apart — and the
desktop's Conversation writer is its only implementation. The trusted
sideband's socket seam is implemented over `ws` in `voice/live-sideband.ts`,
so `@sidecar/voice` stays free of it, beside the graceful close the
conversations guide prescribes. The live service is the one sink for
everything Luke says unprompted: `compose-live.ts` takes every briefing from
the brain, every typed ask's run to speak its reply, and the two onboarding
beats. A briefing or reply with no session standing makes the service say it
wants one, and the voice window opens it muted. Nothing else in the host
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
