# Packages

Everything that is application logic lives here; `apps/` holds only what is
specific to a deployable: Electron process wiring, the React surfaces, and the
Vite site. The test is mechanical rather than a judgment call: a module belongs
in an app when it imports `electron`, or `react`, or a DOM API. Everything else
is logic, and a logic module can be tested with `node --test` and no harness,
which is the corroborating signal.

## The graph is acyclic, and stays that way

Every package declares exactly the packages its own sources reach, and the
graph has no cycles, checked by `pnpm --recursive run typecheck` from a clean
`node_modules`, which resolves workspace links strictly.

Adding a package means adding a `package.json` and a `tsconfig.json` copied
from any sibling, a barrel at `src/index.ts`, and the dependencies its imports
imply. Adding an *edge* is the part worth thinking about: a cycle usually means
a module is in the wrong package rather than that the graph needs to allow one.
Three of this repository's package boundaries were decided that way. The
credential vocabulary, the hook merge, and the hosted attention evaluator each
sit where they do because putting them anywhere else closed a loop.

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
export.

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
`@sidecar/account/snapshot`, `@sidecar/superset/sign-in-stage`), or the renderer
bundle fails to resolve `node:http` behind a string constant it wanted to draw.
