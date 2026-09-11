# Packages

Everything that is application logic lives here; `apps/` holds only what is
specific to a deployable: Electron process wiring, app-specific React surfaces,
and the Vite site. `packages/panel` is the one shared React package: it owns the
panel's React anatomy so the desktop and marketing mock compose the same
components. Each app owns the styling that presents those components. Other
modules belong in an app when they import `electron`, `react`, or a DOM API.
Everything else is logic and can be tested with vitest and no harness; a
package's own `vitest.config.ts` registers it in the root's project list.
A developer command-line tool lives under `tools/` instead, where what it
reaches cannot become a package's: `tools/trace-export` reads a recorded trace
against `@sidecar/brain`'s hosted tool catalog, which `@sidecar/devtrace` would
otherwise pull into the app that only writes the file.

Whether an action may run is decided once, by `admit()` in `@sidecar/actions`, which
mints the only `ValidatedAction` there is: its brand is `@sidecar/wire`'s
module-private symbol, which nothing anywhere can spell, so `admit` is the one
place the repository enters the admitted set and a signature that takes one says
the gauntlet ran. The gauntlet itself is `admitEffect()`, an Effect that
succeeds with the minted action or fails with an `AdmitRefusal` carrying the
same sentence a `Refusal` does, and reads the roster for itself inside the
effect; `admit()` is the Promise door over it, the strangler shim that runs
the effect for the callers still holding a Promise — the brain's tool modules,
the hosted action endpoint, the provider contract — until P7's composers and
the turn runner they compose call `admitEffect()` themselves, and P12-02
deletes the door with the `Settled` Promise signatures.
`repository-checks.sh` fences both names to the brain's tool modules alike. Everything below it re-shapes what it
already holds through `reshapeAdmitted`, which needs an admitted value to
answer at all — which is how a provider's write signature enforces the
requirement rather than restating it. The direction stays actions → session →
wire, and `@sidecar/session` keeps the narrower act vocabulary an observation
advertises with; the two are proven to be the same strings where
`@sidecar/actions` declares the whole of it.

A wire value's rules are declared once, as a `Schema` in `@sidecar/wire`,
which both parses the untrusted value and emits the JSON Schema a model is
shown for it. A hand-written parser beside a hand-written schema is two
statements of the same rule that can drift. Every declaration is an Effect
`Schema` underneath: the `s.*` builder in `packages/wire/src/schema.ts` is a
facade whose every combinator constructs one, reads through `readEither`,
and shows the node `emitJsonSchema` walks out of that schema's AST, so what a
declaration parses and what it shows are one AST, and `effectSchema(declaration)`
hands the Effect schema out of a facade value, typed as the declaration types
itself, for a caller that declares directly. The node a model is shown is
produced by wire's own emitter, `packages/wire/src/effect/json-schema.ts`'s
`emitJsonSchema`, and never by Effect's `JSONSchema.make`: it writes the same
`JsonSchemaNode` the builder always answered, key for key and in the same
order, reading only wire's own annotations — the description `describeWire`
sets under `WireDescriptionAnnotationId`, the refusal word `wireRefusal` sets
on a filter, a transformation, or a union, and the node `verbatimJsonSchema`
declares beside a reader, where `declareReader` is a reader as an Effect
declaration, failing with the issue `refusalIssue` writes for the word and
path the reader decided — and never Effect's `title` or `description`, which
Effect writes on every primitive and every built-in filter. A decode failure
becomes a `SchemaRefusalError` in the same three refusal words the builder
answers, through `readEither`; `toSchemaRead` is the strangler shim that
hands the `Either` to a caller still holding a `SchemaRead`, deleted with it
in P12-07, and the facade itself is the shim P12-08 deletes once every caller
declares directly.

What a schema emits is recorded rather than described. Every tool definition
the action catalog produces, every schema the hosted wire and the live
vocabulary declare, and the protocol's own declared shapes are held as byte
goldens under each package's `fixtures/json-schema/`, written and compared by
`@sidecar/wire/testing`'s `settleJsonSchemaGolden` and re-recorded only under
`LUKE_UPDATE_FIXTURES=1`. The bytes are the point: a model provider keys its
prompt cache on the text of a request, so a reordered key, a widened bound, or
a reworded description costs every standing conversation its prefix, and
nothing sorts the keys because their order is part of what is being held
still. A module's recorded set is typed against the module itself, so a schema
added beside one already recorded does not compile until it is recorded too,
and Biome is kept off those fixture trees because its JSON formatting would
rewrite the recorded bytes. A module that has moved off the facade records
through `RecordedEffectJsonSchemas` instead, and `jsonSchemaOf` emits either
kind: the two tables are separate because a module holds Effect schemas that
show no node to any model — a fixed value set beside its `as const` object, a
refusal declared as a tagged error — and those are not bytes a golden pins.

Anything that carries identity — a `Context.Tag`, a schema brand — has exactly
one copy across the whole install, which the `pnpm-workspace.yaml` catalog
guarantees by pinning every package to the same resolved version of the
dependency that defines it.

`@sidecar/wire` is also the base every layer's lifecycle is written in —
`IDisposable`, `DisposableStore`, `toDisposable`, `Event`, and `Emitter` — so a
listener's unsubscribe, a watcher's teardown, and the store that ends both are
one shape wherever they are held, and adopting it adds no edge: every package
but `packages/panel` already depends on wire. That base is being replaced by
Effect's own, and while both stand `packages/wire/src/effect/scope.ts` is the
bridge: `addDisposable` carries a disposable into a `Scope`,
`disposableFromScope` carries a scope back to a caller that speaks only
`dispose()`, and `layerFromDisposable` builds a service that its layer's scope
ends. A `Scope` closing already guarantees what `DisposableStore` was written
for — the reverse order and the failures aggregated into one shape — so the
store, `toDisposable`, and `disposeAll` are deprecated in place and P12-06
deletes them with the bridge. `packages/wire/src/effect/event.ts` is the same
bridge for the other half: `streamFromEvent` subscribes when a stream's scope
opens and unsubscribes when it closes, buffering without a bound because a
listener cannot refuse a value and a `fire` returns having delivered, and
`eventFromStream` answers an `Event` pumped by a fiber forked into the scope,
which keeps every rule a listener can observe — the subscription order, a
listener subscribed mid-round hearing the next value rather than that one, a
thrower stopping none of the rest — and can only differ in having nobody above
the pump to throw a failed round at, so that round is logged instead. `Event`
and `Emitter` are deprecated in place and P12-06 deletes them too.

Every tool the brain's catalog lists is a module under
`packages/brain/src/tools/` (the memory provider's two reads are declared in
`@sidecar/memory` in the same shape), each declaring its `description`, its
`inputSchema` (the wire `Schema` its fields are declared in once, which
parses a call and emits what the model is shown; the AI SDK's `tool()` takes
it through `jsonSchema()`), and one `execute(input, ctx)`, where `ctx`
carries the conversation, the turn, the run, who opened it, the abort signal,
and the seams that kind of tool needs and no others — the shape eve's
`defineTool` and the AI SDK's `tool()` both take. An action tool's `execute`
is the whole gauntlet: `admit()` first, over the readers the host hands it in
`ctx` (admission reads the roster for itself through them and is never handed
a copy), then `ctx.carry`, which takes only the `ValidatedAction` admission
minted, so nothing reaches a carrier without admission having run; the
notebook's two writes are action tools like the rest, so the host has no
seam that takes a raw call. The briefing's module is handed a way to hand its
words on and neither admission nor a carrier, so what it says can become
speech and nothing else; a workspace or session module is handed the journal
so its one write is recorded before it runs, after the module has refused
arguments that are not the strings it takes. A module imports the packages
below the brain and its own directory and nothing else of the brain, and
`admit` is imported in the brain only under that directory and nowhere in the
host's brain wiring or the memory package; `repository-checks.sh` refuses
both, so a tool stays readable, testable, and movable without the agent that
runs it, and admission cannot quietly regain a second home. The catalog and
the effective tool policy are unchanged by this: the policy still fixes both
the schemas a turn is offered and the gate every emitted call meets at
dispatch.

## The graph is acyclic, and stays that way

Every package declares exactly the packages its own sources reach by bare
specifier, and the graph has no cycles, checked by
`pnpm --recursive run typecheck` from a clean `node_modules`, which resolves
workspace links strictly.

Adding a package means adding a `package.json` and a `tsconfig.json` copied
from any sibling, a barrel at `src/index.ts`, and the dependencies its imports
imply. Adding an *edge* is the part worth thinking about: a cycle usually means
a module is in the wrong package rather than that the graph needs to allow one.
Package boundaries should put wire vocabulary below behavior and keep behavior
out of transport packages. The credential vocabulary and hook merge sit where
they do because putting them elsewhere would close a loop.

The store used to depend on the brain it stores; folding it into
`brain/src/store/` is what removed that edge, and nothing under
`brain/src/store/` may import `../index.js`.

The Conversation view's selection (`@sidecar/session`'s
`selectConversationView`) is the same rule in the other direction. Which tool
names are announcements and which are actions is the brain catalog's
knowledge, and the catalog sits above the session package, so the selection
takes that classification as an input rather than importing it; a tool the
caller did not classify is a collapsed detail of its turn, never a row, so an
observed conversation's message crosses into the view only under a name the
caller positively named.

Watch for cycles that exist only in tests. A test that reaches into a package
above its own is still an edge pnpm records, and it usually means the test
belongs with the layer it is really exercising.

## Relative imports carry `.js`

Vercel's builder compiles these packages' TypeScript into the web functions but
leaves the specifiers alone, and Node's ESM loader refuses an extensionless one
at run time, a break no build sees and production reports only as
`FUNCTION_INVOCATION_FAILED`. `repository-checks.sh` enforces it across every
`packages/*/src`.

## The server's functions are bundled, and reach packages by name

`apps/web/server/routes/` holds the route sources, and
`apps/web/scripts/bundle-functions.ts` bundles them into a few functions under
`apps/web/dist-functions/` as the last step of the web build, with every
workspace package inlined and only the web app's own declared runtime
dependencies inlined whole beside them, with three guarded optional requires
left outside and named (`INLINE_EXCEPTION` in `apps/web/server/function-bundles.ts`).
Vercel's builder detects, traces, and uploads each
function separately and in series, at several seconds apiece, so the routes
share one function per duration bound (`apps/web/server/function-durations.ts`)
behind a generated dispatcher that restores each request's own path; the two
voice routes, which export the server Vercel upgrades WebSockets into, stay
functions of their own. The build's last step writes the Build Output tree
(`apps/web/server/build-output.ts`): `.vercel/output` with the site and one
`.func` per function, which static-build adopts as the deployment when present,
so the deploy shape is the build's own on every preset and nothing is committed
under `apps/web/api/` (Vercel's zero-config pass would build a file there beside
the tree). The `/api/` rewrites of `apps/web/vercel.json` land each route on its
function's public path, and `pnpm --filter @luke/web functions:rewrites`
regenerates them after a route is added. Reachability into a package is read from the bundles' inputs,
not their externals, because an inlined import leaves no external behind.
Server code still names packages by bare specifier like everything else, and
`apps/web/package.json` declares each one it names: the bundle step refuses an
external that no declared package or named exception accounts for.
Handed TypeScript instead,
the builder runs its own compiler over every function's whole import graph
separately, under options that are not this repository's, and that pass was
most of a deploy's build time.

Every package's `exports` names `./src/index.js`, never `./src/index.ts`. It is
the same rule as the one above, one level up: post-compile the `.js` target is
literally the file, and pre-compile TypeScript, tsx, esbuild, and Vite all
substitute the `.ts` back. A `.ts` target resolves to a file that compilation
has replaced. `exports` is what a runtime resolver follows, so it names the
compiled shape; `types` is what the compiler reads directly and stays `.ts`.

A dependency a bundled package reaches that the web app never declared would
resolve nowhere at run time, so the bundle step refuses any import that
resolved external and is not one of those declared dependencies or a Node
builtin.

Vercel roots its install at `apps/web`, so a package the web compiles by
relative door must be declared there too. `server/hosted/` names
`@sidecar/providers` by path rather than by specifier, and while everything
that package reached from inside its own directory was another workspace
package, the omission cost nothing; the first third-party dependency it
needed resolved from there — `@effect/platform`, when the cloud pass moved
onto `HttpClient` — failed the deploy and nothing else, because an undeclared
package is not part of what Vercel installs where a whole-workspace install
would have had it. The declaration is what the app owes for a package it
compiles at all, however it names it, and `knip` is told to ignore that one
because the name never appears as a specifier. Giving `@sidecar/providers`
export subpaths so those imports could be specifiers is the better shape and
a decision about that package's doors.

## A barrel is an all-or-nothing door

Importing a package resolves its whole export graph, not the one name asked
for. A package that holds both a wire vocabulary and a Node flow gives the
vocabulary a subpath of its own (`@sidecar/calendar/vocabulary`,
`@sidecar/credentials/snapshot`,
`@sidecar/providers/superset/sign-in-stage`, `@sidecar/runtime/vocabulary`,
`@sidecar/brain/store`), or
the renderer bundle fails to resolve `node:http` behind a string constant it
wanted to draw. What that door holds back has since grown: the loopback
consent trip behind `@sidecar/credentials`'s barrel serves its landing page on
`@effect/platform-node`'s own HTTP server, so the vocabulary subpath is what
keeps that layer out of a bundle as much as `node:http` itself.
`@sidecar/voice/live-session` is the same door for behavior rather than
vocabulary: the live session service and its parts are
transport-neutral, composed by whoever holds a session's sideband — the
desktop's host today, the hosted voice service's web function next — so they
stand behind an entry of their own, and the package names no socket library
anywhere: its sources open connections through the injected `openSocket`
seam, and each composition binds `ws` on its own side.

`@sidecar/voice/effect` is the same package's door for the Effect tags
beside those plain seams: `LiveBrainTag`, `LiveRecordTag`,
`LiveSessionSourceTag`, `IntroductionSessionSourceTag`, and
`LiveVoiceBridgeTag`, each with a `Layer.succeed` adaptor over the plain
object a caller still holds. Every adaptor is a strangler shim standing
until the class it feeds — `LiveSessionService` or `LiveVoiceOrchestrator` —
reads the tag itself rather than taking the value as a constructor argument,
and `docs/adr/0001-effect.md` names which caller and which PR for each.

`@sidecar/wire/effect` is the same door for the Effect bridges that stand
beside the hand-rolled base while both are still in use — the `Scope`,
`Stream`, and `HttpClient` bridges over `IDisposable`, `Event`, and
`CloudFetch`, and the JSON Schema emitter with its `readEither` and
`toSchemaRead` — kept off the main barrel so a caller that only wants the
wire vocabulary never resolves `@effect/platform`. `@sidecar/runtime/effect` is
that door one package up: `scheduleOnce` and `scheduleRepeat` fork delayed and
repeated work into a `Scope`, which is what cancels it, `timersFromRuntime`
answers the old `now`/`schedule`/`cancel` seam from a runtime's own `Clock` so
a caller still injected with those closures reads the clock the rest of the
process reads, `makePendingInputQueue` with `admitInput` and
`queueDebounceSchedule` are the reply queue's Effect surface, `withLane` and
`acquireLane` are the execution lanes' — a lane's slot as a scoped,
`Semaphore`-shaped resource admitted in the port's own arrival order —
`makeChildRunService` with `spawnChild`, `cancelChild`, `cancelDescendantsOf`,
`retryChildDelivery`, `dismissChildCompletion`, `childLines`, and
`childDeliveryBackoffSchedule` are delegation's, `gatherPromptFactsEffect`,
`discoverSkillsEffect` with `loadSkillEffect`, and the workspace file effects
(`seedWorkspaceEffect`, `readBootstrapFilesEffect`, `recentDailyNotesEffect`,
`readWorkspaceFileEffect`, `writeWorkspaceFileEffect`) are the identity
workspace's, and `resolvePolicy` and `requireAllowed` restate the tool
policy's dispatch door as an `Either` that tells a name outside the catalog
apart from one a layer denied, while `decodeConversationRecord` and
`decodeConversationArchiveRecord` restate the storage contracts' wire readers
as effects that fail with a typed refusal rather than answering `undefined`.
The vocabulary door names none of them, so a package that opens only it
resolves no `effect`, while the barrel now does: `ObservationLoop` keeps its
cadence on a `Schedule` forked into a `Scope` of its own rather than on an
interval, so a caller that opens the barrel resolves `effect` behind it.
`@sidecar/providers/effect` is that door one package further up, and holds one
thing: `providersLayer` with its `Providers` tag and the
`DuplicateProviderRegistration` a merged build refuses a repeated id with, so
which providers stand is decided where their layers are merged. `builtProviders`
beside it is that registry read out of a build for a caller holding a `Scope`,
which is what `providerRegistrations` still is a Promise door over. The
package's shared mechanics stay on the barrel beside the promise faces they
replace — `observationSpoolEvents`, the hook spool as a `Stream` over
`FileSystem.watch`, and `scopedReadOnlyDatabase`, a provider's own database
open inside a `Scope` — and each takes the `FileSystem` or the `Scope` it
needs from whoever runs it, so the package names `@effect/platform` and no
`@effect/platform-node` layer of its own.
`@sidecar/memory/effect` is the same door one package over: `housekeepingEffect`
reads a completed or nothing-to-store result as a success and an interrupted
or failed one as a `MemoryHousekeepingFellShort` carrying the outcome's own
code, and `markerWriteSchedule` states the port's marker-write attempt bound
as a `Schedule` a caller composes with `Effect.retry` rather than counting
attempts by hand; the ranking and chunking ports beside it stay untouched,
since neither reaches outside its own arguments or fails in a way Effect's
channel would change.

A file ported from OpenClaw `b7528507` imports nothing from `effect`, so a
later port of an upstream change stays a diff of that source; Effect reaches
it through a sibling named for it (`queue.ts` and `queue.effect.ts`, `lanes.ts`
and `lanes.effect.ts`, `children.ts` and `children.effect.ts`; `workspace.ts`,
`prompt.ts`, and `skills.ts` the same way; `tool-policy.ts` and
`tool-policy.effect.ts`; `storage.ts` and `storage.effect.ts`; `@sidecar/brain`'s
`compaction.ts`, `context-engine.ts`, and `state-store.ts` the same way, and
its `store/maintenance-run.ts`, `store/archives.ts`, and `store/compression.ts`
beside them, behind the store's own door rather than the barrel), which wraps
the ported exports, states the port's refusals as tagged errors carrying the
codes it already decides — reusing the port's own `as const` refusal set
where it has one (`WORKSPACE_FILE_REFUSAL`, `CHILD_SPAWN_REFUSAL`), and
stating a fresh one in the sibling where the port only decides the
distinction without naming it (`QUEUE_REFUSAL`, `SKILL_LOAD_REFUSAL`,
`TOOL_CALL_REFUSAL`, `STORAGE_DECODE_REFUSAL`, `CHILD_COMPLETION_REFUSAL`,
`CompactionDeclined`, `CheckpointRefused`, `BrainStateWriteRefused`,
`ARCHIVE_REFUSAL`, `ZstdUnsupported`) —
and hands a caller any delay table the port states as a `Schedule` —
`children.ts`'s own formula for its delivery backoff becomes
`childDeliveryBackoffSchedule`'s `Schedule.exponential` clamped to the same
cap, since the port never held that cadence as a literal list to begin with.
A pure function with no file, clock, or failure mode, like
`buildSystemPrompt`, gets no sibling: an `Effect.sync` around it would wrap
nothing, which is why `loop-guard.ts` — a sliding window read entirely
synchronously, with no file, clock, or caller that can fail — and
`store/maintenance.ts` — a set of victim-selection functions that read
records and answer victims, touching no file, clock, or caller that can fail —
each stand with no sibling of their own, and
`store/maintenance-run.ts`'s own `runConversationMaintenanceEffect` wraps the
pass's I/O with no refusal of its own to carry, since every boundary it runs
already reports what it did rather than failing. `repository-checks.sh` names
the ported files and refuses an `effect` import in any of them. A door is not
what keeps `effect`
out of a bundle generally: `@sidecar/wire`'s own barrel resolves `Schema`,
`SchemaAST`, and `ParseResult` beneath the `s.*` builder, and
`@sidecar/session`'s fixed value sets are declared as `Schema.Literal` beside
the `as const` object they derive from, each `is*` guard over one that
schema's own `Schema.is`, so a renderer naming a single declaration or a
single guard resolves all three. That is the deliberate cost
`docs/adr/0001-effect.md` records against the desktop's bundle budget: one copy
per bundle, paid once, and what the door still keeps out is a Node-reaching
companion like `@effect/platform`.

A subpath is also how a package keeps something out of a bundle that has no
use for it. `@sidecar/session/fixtures` is the synthetic snapshot the fixture
runs and the marketing mock draw, and it stays off the barrel because three
hundred lines of test data must not ride into a production bundle behind a
session type. `@sidecar/session/ui-messages` is the reader that holds stored
`UIMessage` rows to the vocabulary, behind its own door because it calls the
AI SDK's `validateUIMessages` at run time, where the vocabulary itself — the
message metadata schemas in `@sidecar/wire` and the tool-part states on the
session barrel — reaches the SDK for its types alone, so a renderer that only
names a state pulls none of it. `@sidecar/runtime/testing` is the scaffolding
every test in this repository shares — a self-cleaning temporary directory, a
stated microtask drain, and a clock the test drives — behind its own door
because it reaches `node:fs` and `node:os`, and in this package because the
clock stands in for the runtime's own `ScheduledTimer`. Both of those are
deprecated in place, since a `TestClock` advanced by hand is the same thing
said in the library every other seam is moving to, and P12-03 deletes them
with the bridge that answers the seam from a runtime. A test written on
`it.effect` reaches for `TestClock` directly rather than a wrapper of its own —
`../effect/timers.test.ts` is the pattern — and for `temporaryDirectoryScoped`,
an `Effect` over `@effect/platform`'s `FileSystem` that is this same
guarantee stated as an `acquireRelease` rather than a `TestContext` callback.
`@sidecar/analytics/sender` is the same door the other way around: the
package's barrel is vocabulary only, read by the renderer for the event names
and value sets it may ask the main process to record, while `ProductEventSender`
— which flushes on a `Schedule` over `@sidecar/runtime/effect`'s
`scheduleRepeat`, and so resolves that door's whole `effect` surface, `node:fs`
included — stands behind its own subpath the renderer never opens.

`@sidecar/brain` is the reason the rule exists twice in one package: the barrel
is a door the web functions and the renderer open, and the store beneath it
reaches `node:sqlite` — and, through `store/sql-node-sqlite.ts`'s `SqlClient`
over that same handle, `@effect/sql` and `@effect/experimental` — so the store
gets a subpath of its own and the barrel exports none of it. A
table module under `brain/src/store/` is an `Effect` over that client and
nothing else — it takes no handle, reads its rows through `@effect/sql`'s
`SqlSchema` against a schema declared beside it rather than a cast, and
derives a row that is a shared shape from that shape's own declaration
instead of stating it twice. The worker over those modules is an
`@effect/rpc` server: `store/store-operations.ts` declares every operation
once as an `RpcGroup`, `store/worker-host.ts` answers it one request at a
time on the worker-runner protocol with the table effects run over the one
client the open built, `apps/desktop/src/main/store-worker.ts` is the
runtime edge that launches it in production, `store/worker-entry.ts` is the
same launch spawned directly by the store-client test, and
`store/store-client.ts` is the main thread's `RpcClient`
over a one-worker `NodeWorker` pool behind the Promise face the host still
holds; `inProcessStoreTransport` serves the same handlers in the calling
thread for a test. The synchronous function a table module still exports is
`StoreDatabase#run` wearing its old signature, for the two OpenClaw ports
(`store/archives.ts`, `store/maintenance-run.ts`) that hold a handle rather
than a client and import nothing from `effect`, and for the suites beside
them; the children, notebook, and memory index tables, which no port reads,
export none. `store/workspace-files.ts`
touches no client at all — the notebook's own files are read and written
synchronously by hand because they run inside the worker's own sync
transactions — so its sibling, `workspace-files.effect.ts`, states what
either can throw as a typed `WorkspaceFileIOError` instead of wrapping a
client this file never holds.
`@sidecar/brain/envelope` is the third: the envelope's shape and its readings
are what everything under `brain/src/store/` needs, and reaching them through
the barrel — or through `state-store.ts`, which is the store class over them —
would pull the whole brain into the module that only has to read a row back.
`@sidecar/brain/ui-message-context` is the fourth, for the same reason
`@sidecar/session/ui-messages` has a door: the context engine over stored
`UIMessage` rows calls the AI SDK's `convertToModelMessages` at run time, and
a bundle that only names the engine's id from the runtime's `BUILTINS` table
must not resolve the SDK behind it.

`@sidecar/runtime/vocabulary` is the same rule at the bottom of the graph: the
identities, the storage contracts, the execution seams, and the memory
provider contract are Node-free, and
the packages below the runtime import that door so the barrel's `node:fs`
never reaches a renderer or a web function. Nothing is behind both
doors: the barrel re-exports no vocabulary name, so every symbol has exactly
one way in. Its fixed value sets carry the same `Schema.Literal` declarations
`@sidecar/session`'s do: `execution.ts` and `identifiers.ts` are not OpenClaw
ports, so each `is*` guard becomes that schema's own `Schema.is` right beside
the `as const` set it derives from, the same as everywhere else, and `effect`
itself is Node-free, so declaring it here costs the door nothing the rule
above did not already pay for `@sidecar/runtime/effect`'s bridges. `child-records.ts`
and `storage.ts` are OpenClaw ports, so neither gains an `effect` import or
loses a line: each keeps its own hand-rolled `is*` guard exactly as it stood,
which is still what the vocabulary door re-exports, and the schema beside its
`as const` set lives in the sibling instead — `child-records.effect.ts`, and
`storage.effect.ts` beside its wire codecs — importing the port's object
rather than declaring a second one. The vocabulary door re-exports that
schema from the sibling in a block of its own, so a schema this way in is the
only thing that leaves through both the vocabulary door and the `effect`
door; the guard itself still has exactly one way in, which is what
`repository-checks.sh`'s barrel/vocabulary check keeps true. A second check
beside it walks the vocabulary door's own relative-import graph rather than
its export list, so a later re-export cannot quietly carry
`@effect/platform-node` or `@effect/sql*` in a few files deep the way a grep
scoped to one directory would miss.

A barrel over modules that are all one vocabulary is written as `export *` per
module (`@sidecar/session`), because a hand-listed re-export of a package whose
every name is public is a second list to forget a name in; a package whose
modules are not all public keeps the explicit list, which is what says so.
