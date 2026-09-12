# Packages

Application logic lives here; `apps/` holds only what is specific to a
deployable. **A module belongs in an app when it imports `electron`, `react`, or
a DOM API** — everything else is logic and tests under vitest with no harness,
registered in the root project list by the package's own `vitest.config.ts`. A
developer command-line tool lives under `tools/` instead, where what it reaches
cannot become a package's.

## A wire value is declared once

A value crossing into the process is declared as an Effect `Schema`, which both
parses it and emits the JSON Schema a model is shown. A hand-written parser
beside a hand-written schema is two statements of one rule that drift.

The node a model is shown comes from wire's own emitter, never Effect's
`JSONSchema.make`, which writes `title` and `description` onto every primitive
and built-in filter.

What a schema emits is pinned as byte goldens under `fixtures/json-schema/`,
re-recorded only with `LUKE_UPDATE_FIXTURES=1`. **The bytes are the point** — a
model provider keys its prompt cache on the text of a request, so a reordered
key, a widened bound, or a reworded description costs every standing conversation
its prefix. If a golden fails, that is what it is telling you. Biome is kept off
those fixture trees for the same reason.

## A cycle means a module is in the wrong package

`pnpm --recursive run typecheck` from a clean `node_modules` fails on a cycle,
and `repository-checks.sh` fails on a `packages/` → `apps/` import. Neither tells
you the fix: put wire vocabulary below behavior, keep behavior out of transport
packages, and move the module rather than adding the edge. A cycle that exists
only in tests is still an edge pnpm records, and usually means the test belongs
with the layer it is really exercising.

## Package exports name `.js`

`repository-checks.sh` enforces the `.js` suffix on relative imports. The same
rule applies one level up, where it does not: every package's `exports` names
`./src/index.js`, never `./src/index.ts`, because `exports` is what a runtime
resolver follows and post-compile the `.js` target is literally the file. `types`
is read by the compiler directly and stays `.ts`.

## Adding a web route needs a regenerated table

After adding or renaming a route under `apps/web/server/routes/`, run:

```
pnpm --filter @luke/web functions:rewrites
```

That rewrites `apps/web/server/api-rewrites.json` and the `vercel.json` built
from it. `repository-checks.sh` checks both sides — the packages `apps/web` names
must be declared in its `package.json`, and every `/api/` path a client spells
must resolve to a rewrite — so skipping this fails the build rather than the
deploy. Nothing is committed under `apps/web/api/`; Vercel's zero-config pass
would build a file there beside the tree.

## A barrel is an all-or-nothing door

Importing a package resolves its whole export graph, not the one name asked for.
Give a subpath of its own to anything the barrel's other callers must not
resolve:

- **Node-reaching behavior behind a vocabulary door**
  (`@sidecar/runtime/vocabulary`, `@sidecar/brain/store`), or the renderer bundle
  fails to resolve `node:http` behind a string constant it wanted to draw.
- **A heavy run-time dependency**, like a reader that calls the AI SDK, where the
  vocabulary beside it reaches the SDK for its types alone.
- **Test data and scaffolding**, which must not ride into a production bundle
  behind a type.

Nothing is behind both doors — a door re-exports no name the barrel exports, so
every symbol has exactly one way in. `repository-checks.sh` keeps that true and
walks a door's own relative-import graph, so a later re-export cannot quietly
carry a Node-reaching layer a few files deep.

A door is not what keeps `effect` out of a bundle generally; `@sidecar/wire`'s
barrel resolves `Schema` beneath it. `docs/adr/0001-effect.md` records that cost
against the renderer bundle budget: one copy per bundle, paid once. What a door
still keeps out is a Node-reaching companion like `@effect/platform`.

A barrel over modules that are all one vocabulary is written as `export *` per
module, because a hand-listed re-export of a package whose every name is public
is a second list to forget a name in.
