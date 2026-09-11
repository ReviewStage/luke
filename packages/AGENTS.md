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
the gauntlet ran. Everything below it re-shapes what it already holds through
`reshapeAdmitted`, which needs an admitted value to answer at all — which is how
a provider's write signature enforces the requirement rather than
restating it. The direction stays actions → session → wire, and `@sidecar/session`
keeps the narrower act vocabulary an observation advertises with; the two are
proven to be the same strings where `@sidecar/actions` declares the whole of it.

A wire value's rules are declared once, as a `Schema` in `@sidecar/wire`,
which both parses the untrusted value and emits the JSON Schema a model is
shown for it. A hand-written parser beside a hand-written schema is two
statements of the same rule that can drift. The node a model is shown is
produced by wire's own emitter and never by Effect's `JSONSchema.make`: the
`s.*` builder answers it today, and for an Effect `Schema` it is
`packages/wire/src/effect/json-schema.ts`'s `emitJsonSchema`, which walks the
schema's AST into the same `JsonSchemaNode`, key for key and in the same
order, reading only wire's own annotations — the description `describeWire`
sets under `WireDescriptionAnnotationId`, the refusal word `wireRefusal`
sets on a filter or transformation, and the node `verbatimJsonSchema`
declares beside a reader — and never Effect's `title` or `description`,
which Effect writes on every primitive and every built-in filter. A decode
failure becomes a `SchemaRefusalError` in the same three refusal words the
builder answers, through `readEither`; `toSchemaRead` is the strangler shim
that hands the `Either` to a caller still holding a `SchemaRead`, deleted
with it in P12-07.

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
rewrite the recorded bytes.

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

`apps/web/server/routes/` holds the function sources, and
`apps/web/scripts/bundle-functions.ts` bundles each into a plain ESM file under
`apps/web/dist-functions/` as the last step of the web build, with every
workspace package inlined and only the web app's own declared runtime
dependencies left external. The committed stubs under `apps/web/api/` are what
Vercel discovers, since it registers functions from the uploaded tree before
the build runs; each re-exports its bundle, and `pnpm --filter @luke/web
functions:stubs` regenerates them after a route is added.
Vercel's builder is handed JavaScript and only traces those externals, which is
why server code names packages by bare specifier like everything else and why
`apps/web/package.json` declares each one it names. Handed TypeScript instead,
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

## A barrel is an all-or-nothing door

Importing a package resolves its whole export graph, not the one name asked
for. A package that holds both a wire vocabulary and a Node flow gives the
vocabulary a subpath of its own (`@sidecar/calendar/vocabulary`,
`@sidecar/credentials/snapshot`,
`@sidecar/providers/superset/sign-in-stage`, `@sidecar/runtime/vocabulary`,
`@sidecar/brain/store`, `@sidecar/brain/store-worker`), or
the renderer bundle fails to resolve `node:http` behind a string constant it
wanted to draw.

`@sidecar/wire/effect` is the same door for the Effect bridges that stand
beside the hand-rolled base while both are still in use — the `Scope`,
`Stream`, and `HttpClient` bridges over `IDisposable`, `Event`, and
`CloudFetch`, and the JSON Schema emitter with its `readEither` and
`toSchemaRead` — kept off the main barrel so a caller that only wants the
wire vocabulary never resolves `effect`. `@sidecar/runtime/effect` is that door
one package up: `scheduleOnce` and `scheduleRepeat` fork delayed and repeated
work into a `Scope`, which is what cancels it, and `timersFromRuntime` answers
the old `now`/`schedule`/`cancel` seam from a runtime's own `Clock` so a caller
still injected with those closures reads the clock the rest of the process
reads. Neither the barrel nor the vocabulary door names any of them, so the
packages below the runtime resolve no `effect` either. A door is not what keeps
`effect` out of a bundle generally, and `@sidecar/session` is where that stops
being true: its fixed value sets are declared as `Schema.Literal` beside the
`as const` object they derive from, and each `is*` guard over one is that
schema's own `Schema.is`, so a renderer naming a single guard resolves
`Schema`, `SchemaAST`, and `ParseResult`. That is the deliberate cost
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
with the bridge that answers the seam from a runtime.

`@sidecar/brain` is the reason the rule exists twice in one package: the barrel
is a door the web functions and the renderer open, and the store beneath it
reaches `node:sqlite`, so the store and its worker entry each get a subpath and
the barrel exports neither. `@sidecar/brain/envelope` is the third: the
envelope's shape and its readings are what everything under `brain/src/store/`
needs, and reaching them through the barrel — or through `state-store.ts`,
which is the store class over them — would pull the whole brain into the module
that only has to read a row back. `@sidecar/brain/store-shapes` is the fourth,
in the other direction: the stored shapes and their readings (the envelope
delta a save carries, the transcript payload a row keeps), Node-free, so the
hosted tier's Postgres store under `apps/web/server/hosted/store/` writes and
reads the same rows the SQLite store does without resolving `node:sqlite`.
`@sidecar/brain/ui-message-context` is the fifth, for the same reason
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
one way in.

A barrel over modules that are all one vocabulary is written as `export *` per
module (`@sidecar/session`), because a hand-listed re-export of a package whose
every name is public is a second list to forget a name in; a package whose
modules are not all public keeps the explicit list, which is what says so.
