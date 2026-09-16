# Agent guide

Luke is a macOS-first Electron sidecar that observes coding-agent sessions while
preserving existing provider workflows.

## Commands

| Command | What it does |
| --- | --- |
| `./scripts/bootstrap.sh` | Install pinned workspace dependencies |
| `./scripts/check.sh` | Portable repository, type, test, and build checks |
| `./scripts/verify.sh` | Complete macOS validation plus visual evidence |
| `./scripts/run.sh` | Launch against live sessions, replacing any running instance (`--fixture smoke`, `--keep-running`, `--no-trace`) |
| `./scripts/evidence.sh` | Write the fixture PNG under `artifacts/` |
| `pnpm evidence:record` | Record the fixture transition on a physical Mac |
| `pnpm release:macos` | Local signed, notarized, verified DMG, zip, and update manifest |
| `pnpm lint:fix` | Repository formatting and safe lint fixes |

`./scripts/verify.sh` is the completion invariant for any macOS or UI change. CI
runs the portable check on Linux alone, and no macOS job is coming back: Dean
ruled on 2026-09-11 that the release rehearsal (`release.yml`'s `macos-15` job,
run on a `v*` tag push or a manual dispatch) is the only Mac gate, recorded on
`orchestration/storage-plan` at `e7b57a9a` in `plan/decisions.md`. A pull
request builds nothing for the Mac and produces no visual evidence, so a green
PR says nothing about the Mac and there is no macOS check to wait for. A UI
PR's evidence is the developer's own `verify.sh` run, its body must say CI could
not verify it, and a Mac break that lands anyway is caught at the rehearsal on a
tag, not at review. LUKE-159 is the manual `verify.sh` pass on a Mac that stands
in for the missing job before the first release.

## Never

- Never let a credential or account secret enter a Gateway answer or event, the
  voice window, a counted event, a trace, or a fixture. Nothing in this repository
  scans for secrets, so this rule is the whole of the check.
- Session replay records the rendered panel with every word masked
  (`apps/desktop/src/renderer/session-replay.ts`), so what leaves the machine is
  layout, not text; an unmasked attribute or a new way of drawing words is what
  would change that.
- Never add to this file (`AGENTS.md`, which `CLAUDE.md` links to) unless the
  user explicitly approved the addition.

## The scheduled pass and the briefing push

- The one observation that runs on a clock of Luke's own is the service's
  scheduled pass, and it is bounded on every side. Vercel's cron calls
  `/api/observation/tick` once a minute (`apps/web/vercel.json`;
  `apps/web/server/hosted/observation-tick.ts`) under the deployment's own
  `CRON_SECRET`, compared in constant time, and a deployment missing that secret
  or the key-encryption secret answers unavailable and observes nothing, since a
  pass that could read no key would be written down as an account with nothing.
  It runs only for an account that holds a synced cloud provider key and has a
  device row seen within the last 7 days
  (`OBSERVATION_TICK.ACCOUNT_SEEN_WITHIN_MS`; `listEligibleAccounts` in
  `apps/web/server/observation-app.ts`), at most 200 accounts a tick, least
  recently attempted first, four at a time inside a 50-second budget with a
  25-second deadline per account; and every tick begins by dropping the
  snapshot, the brain's bookmark, and the pass record of every account no
  longer eligible, so a deleted key or a week's silence ends the observation
  and empties what it kept. One account's pass is the same
  read-only fan-out the on-demand endpoint runs, on a plugin built for that
  pass alone under the account's decrypted key (`observation-pass.ts` over
  `cloud-observe.ts`): the workspaces, the chats, each chat's status, the agent
  kinds, and the projects the provider reports, and no chat's messages. A pass
  every provider answered whole replaces the account's one `roster_snapshot`
  row, sealed under the same server-only secret as the keys and stamped with a
  fingerprint of the key it was observed under, so a snapshot observed under
  another key is neither served, admitted against, nor diffed from; a pass any
  provider refused, rate limited, or failed leaves the previous snapshot
  standing and is recorded as failed. Nothing in the pass decides anything: no
  model runs in it, and nothing leaves it. What the snapshot is kept for is the
  opener (`apps/web/server/hosted/brain-host/opener.ts`), which runs for the
  same account right after its pass and under the same deadline: it derives
  what changed by diffing the snapshot the pass just wrote against the bookmark
  it last kept level with a snapshot (`roster_consumed`), and hands the hosted
  brain one observation turn per session the diff named, at most eight turns an
  account a tick with a hold's releases counted among them, as the deployment
  acting for that one account under the tick's own secret
  (`EVE_CALLER.DEPLOYMENT`), so the account named to the brain is only ever one
  this tick enumerated, and nothing but such a diff or a hold's release opens a
  scheduled turn. A visit that could not hand its change over leaves the
  bookmark where it was, and the next visit derives the same change again,
  wider by whatever moved since, until the two rows stand more than five
  minutes apart on their own instants (`OBSERVATION_TICK.STALE_GAP_MS`), which
  means no visit has caught the brain up for that long (a paused cron, a deploy
  gap, a rotated secret, a provider refusing every pass, or the brain refusing
  every turn): the visit then reseeds the bookmark from the snapshot as it
  stands, wakes nothing from the gap, and counts the reseed in the tick's
  answer as `turns.reseeded`, because what changed in between is history the
  roster already shows and not news. A visit with nothing to wake keeps the
  bookmark level with the snapshot all the same, so an idle roster never reads
  as a gap, and the next change under a reseeded bookmark wakes as usual. The
  wake carries the session as the snapshot holds it and its change in words
  rendered as data, and, for a chat the diff named, what its transcript gained
  since the cursor kept for it, read through the provider's documented
  incremental read (Conductor's `transcriptSince`) under the same synced key,
  cut from the front to 20,000 characters (`BRAIN_HOST.TRANSCRIPT_DELTA_CHARS`),
  its cursor advanced only past one the provider handed back and only once the
  brain has accepted the turn. That read is the one place a scheduled turn
  reads a message; the pass itself never does. Widening what the pass reads,
  who it runs for, how long a snapshot stands, how wide a gap still wakes, or
  what a wake carries is a product decision, not an implementation detail, and
  `PRIVACY.md` discloses the pass under "Scheduled observation of your
  Conductor sessions".
- Luke's words leave his own service unbidden in one place, and it is the
  service rather than this Mac they leave from: the briefing push to a phone
  (`apps/web/server/hosted/speech-push.ts`), run on the scheduled tick after the
  speech sweep and by nothing else. What it may carry is only a briefing the
  brain has already decided, the settled `announce` call's own words read back
  from the announcing row under the tool's 200-character bound
  (`briefing-words.ts`; `maximumBriefingLength`), and it decides from two things
  it reads and nothing it infers: how the offer stands, and what the account's
  devices last reported of themselves. No Mac reporting itself active means the
  words are pushed now; a Mac active but not claiming within two minutes of the
  offer (`SPEECH_PUSH.GRACE_MS`) means they are pushed anyway; a claim means a
  device is saying them and the offer is never pushed, whatever became of the
  claim; a quiet instant standing on any device of the account (a meeting its
  calendar hold observes, or the announcements switch off or the spoken
  introduction owed on a Mac, each restated by its heartbeat as an instant one
  to two hours ahead so it lapses with the Mac that asserts it), means nothing
  is pushed and nothing expires until it lifts; and an offer past its own instant is the sweep's to end, never pushed
  stale. A phone or watch reporting itself present is no reason to wait, since
  neither opens a session for an offer (`SPEAKING_PLATFORMS`, still
  `{ macos }`); but a phone's or a watch's call that already stands claims a
  briefing and speaks it exactly as a Mac's session does, since the exchange
  behind the sessions and audio routes claims as the session's device and never
  asks its platform, so such an offer is claimed and never pushed. Those are
  two of the voice service's three routes (`apps/web/server/voice/frames.ts`
  holds each route's frame policy; `apps/web/server/voice/opening.ts` holds
  the openings): the sessions route, `/api/voice/sessions`, is a signed-in
  device's WebRTC session, a Mac's or a phone's, created and relayed by the
  service with the developer's voice and Luke's never transiting it; the
  audio route, `/api/voice/audio`, is the third, where the service holds the
  Live primary WebSocket on its own key for a device without WebRTC (the
  watch) and relays PCM both ways, the one route on which audio transits the
  service. The mark precedes the send:
  `markSpeechPushed` settles the offer under the conversation's lock, only a
  mark that landed is sent, and the next tick finds it settled, so what is
  guaranteed is at most one push per briefing, never that it arrived; a send
  Apple refused or the network dropped is counted, ends the pass, and is retried
  nowhere, and a token Apple reports gone deletes that device's row. One device
  is addressed, the account's most recently seen device holding a push token,
  because a phone forwards to its paired watch itself and two pushes would be
  one briefing told twice. The notification (`briefingNotification`) is the
  words as the alert body, the default sound, the ordinary interruption level
  that breaks through no Focus, and one custom key, the pushed message's id
  (`BRIEFING_PUSH_PAYLOAD_KEY.MESSAGE_ID` in
  `packages/hosted/src/device-wire.ts`), an opaque UUID of Luke's own that the
  phone's tap opens the Conversation at; no title, subtitle, thread, or collapse
  key, and no session title, branch, path, error line, or identity beyond what
  the words themselves contain. It is readable on a locked screen and Apple
  carries it under its own terms, which is why the words and that id are the
  whole payload. A deployment without the Apple credential (`APNS_ENVIRONMENT`)
  constructs no sender and pushes nothing, the same kill switch every hosted
  endpoint keeps. Widening what a push carries, when it is sent, or which
  platforms it waits for is a product decision, not an implementation detail,
  and `PRIVACY.md` says each in as many words under "Briefing notifications" and
  the Apple line of "Who we send it to".

## Effect idioms

Effect is the repository's infrastructure library, replacing what used to be
hand-rolled: a Schema that both parses and emits JSON Schema, disposables,
an event emitter, independent backoff loops, `setInterval` loops, a
semaphore, single-flight, bounded queues, an idempotency ledger, a worker RPC,
an injected clock seam, and a fake clock beside it. `effect` is pinned at
`4.0.0-rc.115` through the pnpm catalog in `pnpm-workspace.yaml` and nowhere
else — every workspace that reaches it declares `"effect": "catalog:"`, so one
copy resolves across the repository, which is what keeps a `Context.Service`
minted in one package the same service in another. `@effect/platform`,
`@effect/rpc`, `@effect/sql`, and `@effect/experimental` are consolidated into
`effect` itself and reached at `effect/unstable/*`; `@effect/platform-node`,
`@effect/sql-pg`, `@effect/atom-react`, and `@effect/vitest` stay separate, each
on the same `4.0.0-rc.115` through the same catalog. The pin is an exact release
candidate rather than a range, moved deliberately, and re-evaluated once Effect
ships `4.0.0` stable.

### Where an Effect may run

An Effect describes work; only a runtime edge runs one. The edges are listed
in `tools/oxlint/anti-slop/effect-edges.json`'s `runtimeEdges`: `apps/desktop/src/main/main.ts`
(the desktop's one `ManagedRuntime`), `apps/desktop/src/main/services/compose-desktop.ts`
(the layer that runtime is built from), the renderer root
`apps/desktop/src/renderer/index.tsx` (loaded once per window, the panels and
the voice window alike, so no two windows share a browser registry),
`apps/desktop/src/renderer/renderer-runtime.ts` (the module the root's
runtime is built from: `Atom.runtime`'s layer is built, and `AtomRegistry.get`
reads it, the moment the root first reaches it, so the edge is here rather than
at the root that imports it), the renderer's own fiber sites —
`apps/desktop/src/renderer/introduction/introduction-takeover.tsx`, the
panel's own `apps/desktop/src/renderer/use-voice-view.ts` (the panel's notice
strip forks its own clock the same way the voice window's does), and the
voice window's `apps/desktop/src/renderer/voice/live-call.ts` and
`apps/desktop/src/renderer/voice/use-voice-session.ts` — the web's own
module-scope memoized runtime `apps/web/server/runtime.ts` and the four doors
that hold its `runWeb`: `apps/web/server/route-effect.ts` (the adaptor every
function module under `apps/web/server/routes/**` exports its `HttpRouter`
through, which reads that runtime once per instance and lets the handler it
builds do its own running), `apps/web/server/hosted/store-route.ts` (the same
door for a hosted store route, whose handler is composed over the ambient
`SqlClient` rather than a router), `apps/web/server/voice/function.ts`
(the voice service, stood for a function instance's life rather than for a
request, so there is no request fiber to compose it into) and
`apps/web/server/seed-clients.ts` (the OAuth client seeding command, run as
its own process), the eve project's authored files —
`apps/web/eve/agent.ts`, `apps/web/eve/channels/eve.ts`,
`apps/web/eve/hooks/store.ts`, `apps/web/eve/instructions/prompt.ts`,
`apps/web/eve/instructions/seed.ts`, `apps/web/eve/memory/notebook.ts` (the
memory slot whose `compaction.requested` capture runs the pre-compaction
memory flush), and `apps/web/eve/tools/brain.ts` — each
an edge because eve drives them through promise-shaped hooks of its own and
an authored file is where this deployment runs what it hands eve. Not
every seam under `apps/web/server/hosted/` is an effect down to its floor:
`hosted/store/asks.ts`'s `dispatchAskOnce` awaits eve's own HTTP client
inside an `Effect.promise`, `hosted/brain-host/production.ts`'s `spend` is
the AI SDK's async middleware, and `hosted/brain-host/door.ts`'s
`SessionOwnership` speaks eve's own `AuthFn<Request>` — three promise-shaped
foreign boundaries the effects around them compose over rather than
replace, `apps/web/server/db/migrate.ts` (the migration command, through
`NodeRuntime.runMain`), `apps/web/scripts/preview-probe.ts` (the deployed-shape
probe, same terms), and `tools/trace-export/src/cli.ts` (the trace command).
`Effect.runPromise`, `Effect.runSync`, `Effect.runFork`, their
`runPromiseExit`/`runSyncExit`/`runCallback` siblings, and the `…With` form of
any of them — which is where a `Runtime<R>` went, v4 having removed the type —
belong nowhere else — everything between the edges returns an Effect and lets its caller
decide — which the oxlint rule `no-run-promise-outside-edges` enforces against
that same file's `runtimeEdges`, `runShims`, and `runOnHandedRuntime` lists,
reading `apps/web/server/runtime.ts`'s own `runWeb` and `webRuntime` as the
runs they are, so a module that holds the edge's runner rather than
`Effect.runPromise` itself is no less visible to it;
`no-raw-async-primitives` enforces the equivalent for `setTimeout`,
`setInterval`, `new Promise`, `AbortController`, and `fs.watch` against its
`rawAsyncPrimitives` list. A file on those two run lists that is not a runtime
edge above is a permanent adaptor, listed below with the one thing that keeps
it from ever moving onto the edges themselves; there is no other kind of row
on those lists, because a shim on its way to deletion is deleted in the same
PR that finishes the callers it was for, not left as a name on an allowlist.

### The permanent adaptors

- **`packages/credentials/src/single-flight.ts`** — the check-and-create of
  the one `Deferred` every concurrent caller joins is an uninterruptible step
  that cannot suspend, so it runs synchronously (`Effect.runSync`) and forks
  the flight it decided on as a detached root fiber (`Effect.runFork`) rather
  than a fiber of whoever asked first, because a caller that gives up on its
  own await must not take the flight the other callers are still joined to.
- **`packages/host/src/host-kernel.ts`** — `openExternalThroughNode`, the one
  promise door the kernel keeps over `NodeRegistry#invoke`'s effect: the two
  composers that hand it on hand it to seams outside this repository's host
  package — the account session manager's consent
  (`packages/credentials/src/loopback-consent.ts`, whose `openExternal` is a
  `void | Promise<void>` and whose `reopen()` is synchronous) and the calendar
  sign-in's page (`packages/calendar/src/oauth.ts`) — and the session opens a
  row press reaches wrap the same door in `Effect.tryPromise`; so what would
  end this row is a decision about those two seams rather than an
  implementation detail of this door.
- **`apps/desktop/src/main/app-state.ts`** — `AppStateStore`'s `snapshot`,
  `update`, and `touch` run their `SubscriptionRef` operation through
  `Effect.runSyncWith` on the services the launch handed them, never an empty
  context of their own, because every caller but the one production subscriber
  (which forks over the store's `changes` Stream) still holds a synchronous
  object, and the ordering those callers and this file's own tests depend on —
  a listener's patch is not lost, a re-announce lands before the caller's next
  statement — is what turning them into effects a caller awaits would give up.
- **`apps/desktop/src/main/update-service.ts`** — synchronous Electron
  IPC/menu callers (start, check, install) bridge into fibers on the services
  the launch handed them, on the same terms as `app-state.ts` beside it.
- **`packages/gateway/src/client.ts`** — `GatewayClient#take` forks its
  reconnection with `Effect.runForkWith` on the calling stack, because a gap
  must open its reconnection on the tick that found it: `take` is the
  transport's own synchronous callback with no fiber to fork from, and a
  scheduler-deferred fork would move the in-flight count
  `node-invocations.test.ts` asserts on the statement right after a publish.
- **`packages/voice/src/orchestrator/live-voice-orchestrator.ts`** — the notice
  strip's two clocks, armed from callbacks belonging to no fiber of their own,
  start on the services the orchestrator was constructed with; the standing
  call's lifecycle is a `forkDetach` and needs no door.
- **The test-support edges** — `apps/web/tests/support/sql-client.ts`,
  `apps/web/tests/support/no-database.ts`,
  `apps/web/tests/support/hosted-store-database.ts`,
  `apps/web/eve/evals/brain-host.eval.ts`, and
  `packages/wire/src/testing/effect.ts` each build a runner (a
  `ManagedRuntime` over a throwaway database, a `SqlClient` that refuses every
  statement) so a suite or an offline eval still written on `node:assert` or a
  plain fixture can hold a promise where an effect is described; a test body is
  its own edge.

### Vocabulary

`SchemaRead` (`@sidecar/wire`) is the boundary result vocabulary a Schema
decode answers when the result crosses IPC or the wire — a `Result` inside a
process, a `SchemaRead` where a caller on the other side of a process boundary
reads it: `apps/desktop/src/shared/messages/acts.ts`,
`packages/hosted/src/reads-wire.ts`, `packages/wire/src/effect/json-schema.ts`,
and `apps/web/server/hosted/store/message-reads.ts` all produce or read it.

### Idioms

- Schema at the boundary a value crosses, never a hand-written parser beside a
  hand-written shape.
- Runtime only at an edge above; everywhere else returns an Effect.
- `Scope`, not a `dispose()` a caller must remember to call.
- `Schedule`, not a hand-rolled interval or backoff loop.
- `TestClock`, not a fake clock: a test that waits on time advances the clock
  rather than arming a real `setTimeout` its own runner has to outlive.
- `MutableRef` for a synchronous facade over state a synchronous caller reads
  and writes as statements, when the fence it stands for must be up before the
  caller's next statement.
- `Effect.runPromiseExit` and `Cause.squash` at a promise door, so a caller
  still holding a `Promise` sees the same rejection shape an `Effect.tryPromise`
  would have caught, not a fiber's own defect representation.
- No `Effect.raceFirst` over an uninterruptible region: a race that loses
  interrupts the loser, and a fiber inside an uninterruptible region cannot be
  interrupted, so the race never resolves.
- `Effect.forkDetach` and a join for a deadline that must run inside an
  uninterruptible region, since the fork itself has to survive the region even
  when its result does not.
- A fork does not inherit the interrupt status of whoever forked it, so a body
  forked from inside an `Effect.acquireRelease` acquire, a finalizer, or any
  other uninterruptible region is interruptible unless it asks not to be.
- A discarded Effect, Stream, or Layer statement is a bug, not a fire-and-forget:
  `pnpm discarded-effect` refuses an expression statement of one of those
  types, `void` and `await` included, because an Effect is not thenable and a
  description a caller walks past runs nothing.
- Effect's `Clock` does not unref its timer: a wait armed on it references the
  host's event loop for as long as it stands, so a store with an automatic
  reset enabled holds its host open for as long as its generation does: mind
  this when the caller is a process that would otherwise exit.
- A bundle-budget baseline moves only for a deliberate library adoption, never
  for drift a deletion happened to leave behind (`apps/desktop/bundle-budget.json`,
  checked with 5% slack).

## Code style

The model is Redis. Full rules with sources and examples in `docs/STYLE.md`.

- Fight complexity by not creating it. Every dependency, layer, and
  abstraction earns its lines or is refused.
- Order a file: header, imports, constants, private helpers, public API,
  entry points last. Line one: `name.ts -- one line of purpose.`
- Name by layer then verb. Guard early, one exit. Assert invariants.
- A function is read in one pass. Files may be long; functions may not.
- One-line guide comments inside functions. Why comments talk: "Note that
  we X, because Y." Design comments sit above the function. No trivial
  comments.

## TypeScript

- No stringly typed fixed value sets. Use `as const` SCREAMING_SNAKE_CASE objects,
  derive unions with `typeof VALUE_SET[keyof typeof VALUE_SET]`, and use the
  constants at call sites. Raw strings are only for freeform user-facing text.
- Never build a key by concatenating or interpolating identifiers. Use nested
  objects or nested `Map`s keyed by the original identifiers.
