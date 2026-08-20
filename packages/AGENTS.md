# Packages

Everything that is application logic lives here; `apps/` holds only what is
specific to a deployable — Electron process wiring, the React surfaces, and the
Vite site. The test is mechanical rather than a judgment call: a module belongs
in an app when it imports `electron`, or `react`, or a DOM API. Everything else
is logic, and a logic module can be tested with `node --test` and no harness,
which is the corroborating signal.

## The graph is acyclic, and stays that way

Every package declares exactly the packages its own sources reach, and the
graph has no cycles — checked by `pnpm --recursive run typecheck` from a clean
`node_modules`, which resolves workspace links strictly.

Adding a package means adding a `package.json` and a `tsconfig.json` copied
from any sibling, a barrel at `src/index.ts`, and the dependencies its imports
imply. Adding an *edge* is the part worth thinking about: a cycle usually means
a module is in the wrong package rather than that the graph needs to allow one.
Three of this repository's package boundaries were decided that way — the
credential vocabulary, the hook merge, and the hosted attention evaluator each
sit where they do because putting them anywhere else closed a loop.

Watch for cycles that exist only in tests. A test that reaches into a package
above its own is still an edge pnpm records, and it usually means the test
belongs with the layer it is really exercising.

## Relative imports carry `.js`

Vercel's builder compiles these packages' TypeScript into the web functions but
leaves the specifiers alone, and Node's ESM loader refuses an extensionless one
at run time — a break no build sees and production reports only as
`FUNCTION_INVOCATION_FAILED`. `repository-checks.sh` enforces it across every
`packages/*/src`.

## The server reaches packages through doors, not by name

`apps/web/server/core.ts` imports each package it reaches by relative path, one
`export *` per package, for the same reason: Vercel compiles the relative graph
but leaves `package.json` alone, so a bare `@sidecar/*` specifier resolves to a
`./src/index.ts` that compilation has replaced with `index.js`. A package added
to the server's import graph needs its door there, and nothing local reports its
absence.

## A barrel is an all-or-nothing door

Importing a package resolves its whole export graph, not the one name asked
for. A package that holds both a wire vocabulary and a Node flow gives the
vocabulary a subpath of its own — `@sidecar/calendar/vocabulary`,
`@sidecar/account/snapshot`, `@sidecar/superset/sign-in-stage` — or the renderer
bundle fails to resolve `node:http` behind a string constant it wanted to draw.
