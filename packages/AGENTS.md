# Packages

Everything that is application logic lives here; `apps/` holds only what is
specific to a deployable: Electron process wiring, app-specific React surfaces,
and the Vite site. `packages/panel` is the one shared React package: it owns the
panel's React anatomy so the desktop and marketing mock compose the same
components. Each app owns the styling that presents those components. Other
modules belong in an app when they import `electron`, `react`, or a DOM API.
Everything else is logic and can be tested with `node --test` and no harness.
A developer command-line tool lives under `tools/` instead, where what it
reaches cannot become a package's: `tools/trace-export` reads a recorded trace
against `@sidecar/brain`'s hosted tool catalog, which `@sidecar/devtrace` would
otherwise pull into the app that only writes the file.

Whether an act may run is decided once, by `admit()` in `@sidecar/acts`, which
mints the only `ValidatedAct` there is: its brand is `@sidecar/wire`'s
module-private symbol, which nothing anywhere can spell, so `admit` is the one
place the repository enters the admitted set and a signature that takes one says
the gauntlet ran. Everything below it re-shapes what it already holds through
`reshapeAdmitted`, which needs an admitted value to answer at all — which is how
a provider's write signature enforces the requirement rather than
restating it. The direction stays acts → session → wire, and `@sidecar/session`
keeps the narrower act vocabulary an observation advertises with; the two are
proven to be the same strings where `@sidecar/acts` declares the whole of it.

A wire value's rules are declared once, as a `Schema` in `@sidecar/wire`,
which both parses the untrusted value and emits the JSON Schema a model is
shown for it. A hand-written parser beside a hand-written schema is two
statements of the same rule that can drift.

## The graph is acyclic, and stays that way

Every package declares exactly the packages its own sources reach, and the
graph has no cycles, checked by `pnpm --recursive run typecheck` from a clean
`node_modules`, which resolves workspace links strictly.

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

Watch for cycles that exist only in tests. A test that reaches into a package
above its own is still an edge pnpm records, and it usually means the test
belongs with the layer it is really exercising.

## Relative imports carry `.js`

Vercel's builder compiles these packages' TypeScript into the web functions but
leaves the specifiers alone, and Node's ESM loader refuses an extensionless one
at run time, a break no build sees and production reports only as
`FUNCTION_INVOCATION_FAILED`. `repository-checks.sh` enforces it across every
`packages/*/src`.

## The server reaches packages through doors, not by name

`apps/web/server/core.ts` imports each package it reaches by relative path, for
the same reason: Vercel compiles the relative graph but leaves `package.json`
alone. Two halves follow from that, and only both together make a function
load.

Every package in the *transitive* closure needs a door, not only the ones the
server names. The closure crosses package boundaries by bare specifier at
almost every hop, and a package reached only through another package's imports
is one whose sources compilation never visits. Packages the server names get
`export *`; packages reached only through another get a bare side-effect
import, which pulls the file into the compile graph without widening the
export namespace, where `export *` can silently drop a name two doors both
export. Where two doors genuinely both have to carry a name — `ACT_KIND`, which
the act table names in full and the session package names its advertised subset
of — the door that carries the whole of it re-exports the name explicitly,
which takes precedence over both stars.

Every package's `exports` names `./src/index.js`, never `./src/index.ts`. It is
the same rule as the one above, one level up: post-compile the `.js` target is
literally the file, and pre-compile TypeScript, tsx, esbuild, and Vite all
substitute the `.ts` back. A `.ts` target resolves to a file that compilation
has replaced. `exports` is what a runtime resolver follows, so it names the
compiled shape; `types` is what the compiler reads directly and stays `.ts`.

Neither half is reported by anything local. Typecheck, `check.sh`, CI, and
local dev all pass with a door missing or an `exports` target stale; the
failure is a `FUNCTION_INVOCATION_FAILED` on a deployed route.

## A barrel is an all-or-nothing door

Importing a package resolves its whole export graph, not the one name asked
for. A package that holds both a wire vocabulary and a Node flow gives the
vocabulary a subpath of its own (`@sidecar/calendar/vocabulary`,
`@sidecar/credentials/snapshot`,
`@sidecar/providers/superset/sign-in-stage`, `@sidecar/runtime/vocabulary`,
`@sidecar/brain/store`, `@sidecar/brain/store-worker`), or
the renderer bundle fails to resolve `node:http` behind a string constant it
wanted to draw.

A subpath is also how a package keeps something out of a bundle that has no
use for it. `@sidecar/session/fixtures` is the synthetic snapshot the fixture
runs and the marketing mock draw, and it stays off the barrel because three
hundred lines of test data must not ride into a production bundle behind a
session type. `@sidecar/runtime/testing` is the scaffolding every test in this
repository shares — a self-cleaning temporary directory, a stated microtask
drain, and a clock the test drives — behind its own door because it reaches
`node:fs` and `node:os`, and in this package because the clock stands in for
the runtime's own `ScheduledTimer`.

`@sidecar/brain` is the reason the rule exists twice in one package: the barrel
is a door the web functions and the renderer open, and the store beneath it
reaches `node:sqlite`, so the store and its worker entry each get a subpath and
the barrel exports neither. `@sidecar/brain/envelope` is the third: the
envelope's shape and its readings are what everything under `brain/src/store/`
needs, and reaching them through the barrel — or through `state-store.ts`,
which is the store class over them — would pull the whole brain into the module
that only has to read a row back.

`@sidecar/runtime/vocabulary` is the same rule at the bottom of the graph: the
identities, the storage contracts, and the execution seams are Node-free, and
the packages below the runtime import that door so the barrel's `croner` and
`node:fs` never reach a renderer or a web function. Nothing is behind both
doors: the barrel re-exports no vocabulary name, so every symbol has exactly
one way in.

A barrel over modules that are all one vocabulary is written as `export *` per
module (`@sidecar/session`), because a hand-listed re-export of a package whose
every name is public is a second list to forget a name in; a package whose
modules are not all public keeps the explicit list, which is what says so.
