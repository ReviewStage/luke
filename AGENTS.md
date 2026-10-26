# Agent guide

Luke is a macOS Electron app for working through a task by voice: the
developer talks a task through with Luke, who writes its plan down as they go.

## Commands

| Command | What it does |
| --- | --- |
| `./scripts/bootstrap.sh` | Install pinned workspace dependencies |
| `pnpm check:affected` | The portable checks for what changed since `origin/main`, replayed from cache where they already passed; optional before a push, since CI runs every check |
| `./scripts/check.sh` | Every portable repository, migration, lint, type, and test check: before a release, for a broad refactor, or on request |
| `./scripts/run.sh` | Launch against live sessions, replacing the running plain instance (`--fixture smoke`, `--keep-running`, `--no-trace`); `--instance <name>` runs a named one beside it, with its own profile, and `--preview` is one named for its Preview |
| `./scripts/evidence.sh` | Write the fixture PNG under `artifacts/` |
| `pnpm release:macos` | Local signed, notarized, verified DMG, zip, and update manifest |
| `pnpm lint:fix` | Repository formatting and safe lint fixes |

CI runs the portable check on Linux alone, and no workflow runs the tests on a
Mac: the release job (`release.yml`'s `macos-15` job, run on a `v*` tag push or
a manual dispatch) only builds, signs, notarizes, and verifies the app. A green
PR says nothing about the Mac and there is no macOS check to wait for.

## Layout

Application logic lives in `packages/`. An app holds what is specific to
its platform or deployment and nothing else: Electron's main and preload
processes, the window and page roots, the Vercel function routes under
`apps/web/server/routes/`, the deployment shell beside them, the agents' eve
apps, `apps/dev`, and build and release scripts. A React component, control, or
repeated UI shape must live in `packages/ui` whatever app mounts it, even one
app alone, with no exceptions, and a duplicate is folded into one; an app or
`packages/panel` must compose those components and never hand-builds a control
(a raw `<button>`, input, tab, or card with its own press handling) outside
`@luke/ui`: the design system is one rigid set that every agent must use. A hook or DOM-free view
model lives in `packages/ui` when more than one app can mount it, the panel every client mounts, the desktop's panel window and the
web's tab alike, in `packages/panel`, the hosted service's logic in
`packages/service`, its contract and clients in `packages/features`, and a
wire value in `packages/wire`. A
`.ts` module whose imports name no module of its app and no platform
library (`electron`, `react-dom`, a DOM API, `better-auth`, `eve`,
`@vercel/*`) is logic and belongs in a package unless it is shell: an app
entry in `knip.json`, a `runtimeEdges` row in
`tools/anti-slop/effect-edges.json`, or a deployment or test-support file.
Review places a module and a component alike under this rule.

Lint holds the UI half of this (`anti-slop/no-raw-press-outside-ui`): outside
`packages/ui`, every app, test, and the catalog included, an intrinsic
(lowercase) JSX element is never a control. A raw `button`, `input` (bar
`type="hidden"`), `select`, `textarea`, or `summary`, a pressable `role`
(`button`, `tab`, `option`, `menuitem*`, `radio`, `checkbox`, `switch`,
`slider`, `link` off an `<a>`, or one that is no literal), and a press event (`onClick`, `onDoubleClick`,
`onAuxClick`, `onContextMenu`, `onMouseDown`/`Up`, `onPointerDown`/`Up`,
`onTouchStart`/`End`, and their `Capture` forms) are errors, as is
`onKeyDown`/`onKeyUp` on an element with `tabIndex` or `contentEditable`.
Hover, drag and drop, focus, wheel, scroll, and clipboard events, keys on a
container that takes no focus, and a spread from a ui helper
(`menu.contextMenu()`) stay allowed. There is no escape hatch: `pnpm lint` runs
`tools/anti-slop/press-guard-check.ts`, which fails on a disable comment that
would silence the rule and on an `.oxlintrc.json` that weakens it. Where it
fires, use a `@luke/ui` component, or add the component or variant there.

A loading skeleton draws through the components its loaded state draws with,
never a copy of their boxes, and takes its counts, order, and sizes from the
declaration the loaded surface reads, never literals of its own. Lint holds
the first half (`anti-slop/skeleton-through-components`, under the same
no-suppression check): `Skeleton` and `SkeletonRegion` are drawn only by a
component named `*Skeleton`, in which an intrinsic element's class must be a
literal naming itself a skeleton's (`…-skeleton…`); every other box is a
component, factored out of the surface where it builds the box by hand.

## Never

- Never let a credential or account secret enter a Gateway answer or event, the
  voice window, a counted event, a trace, or a fixture. The repository check
  (`scripts/repository-checks.sh`) refuses a tracked literal shaped like a
  provider's credential; nothing else scans for secrets, so past that this rule
  is the whole of the check. The carve-outs: the output of `run_on_mac`, a
  command an agent ran on the developer's own Mac, may reach the conversation,
  the model, and the tool's events as it printed; a trace, a counted event, and
  a fixture still never carry it where that can be avoided. And an integration's
  MCP tool calls and results, a credential its provider answers among them, may
  reach the conversation, the model, an agent's transcript, and its traces. And
  a Terminal tab's bytes go only to the tab that opened them: through the
  terminal relay (`apps/web/server/terminal/`) and the host to that panel's
  window, never into a trace, a counted event, a fixture, app state, or the
  voice window. And a webhook body an automation's caller sends, or an
  integration trigger's event (a Sentry issue or alert as Luke's Sentry
  integration delivers it), may reach that run's agent task, transcript and
  traces. And an automation webhook secret may be shown once, in the window that
  minted it, at creation or rotation; never anywhere else. And the Keyframe
  session token for a call's own avatar may reach the panel window, which runs
  that session, and never the voice window, a Gateway answer or event, app
  state, a counted event, a trace, or a fixture. And an agent's cloud browser, a
  Chromium in that agent's own Vercel Sandbox, shows its pages, their live-view
  frames, address, title, screenshots, and text snapshots to that agent and its
  workers, the model, the agent's transcript, and the panels of the workspace
  members who open the task; the service keeps the tab list, each tab's address
  and title. The model is handed a small copy of each screenshot, whose base64
  is left out of the stored conversation, and the service keeps a full-size copy
  beside the transcript the call is written to, the agent's or its worker's, as
  `show_image`'s pictures are
  (`packages/service/src/agents/browser/browser-tool.ts`), which the stored
  conversation names by id, which that transcript shows to the members who can
  open the task, and which is deleted with the conversation, by its purge seven
  days after a delete or at once with the account. None of it ever goes into a
  trace, a counted event, a fixture, or the voice window, and session replay
  masks the live view and the transcript's screenshots; the cookies a member
  types into it stay in that agent's sandbox, and its snapshots, for the
  sandbox's life. An agent may record its browser as a video (`record` and
  `stop_recording`), whose frames the recorder in its sandbox writes to that
  sandbox's disk until the next recording clears them, and whose WebM the
  service keeps beside the transcript the call is written to as it keeps a
  screenshot (`packages/service/src/agents/browser/browser-tool.ts`), shown and
  deleted on the same terms; the model is never handed the video, the
  transcript's player is left out of session replay, and none of it goes into a
  trace, a counted event, a fixture, or the voice window. An agent may also
  post such a recording, or any WebM it recorded in its sandbox, to a thread in
  one of its workspace's channels
  (`packages/service/src/agents/coder-host/inbox-image.ts`), kept beside the
  thread's message, up to 4 MB, as a picture posted there is, shown to whoever
  may read that thread and deleted with it; the thread's player is left out of
  session replay, and none of it goes into a trace, a counted event, a
  fixture, or the voice window. Such a recording may also be added to its
  task's plan, from the file viewer's Add to plan or an agent's `edit_plan`,
  at most ten to a plan, kept beside the plan as its pictures are
  (`packages/database/src/models/plan-attachments.ts`), shown to the members
  who can open the task and deleted with the plan; `look_at_picture` refuses
  it (`packages/service/src/tasks/picture-look.ts`), so no model is handed it,
  the plan's player is left out of session replay, and none of it goes into a
  trace, a counted event, a fixture, or the voice window. And Sentry's SDKs run
  with their default data collection, but that the service's and the eve roots'
  leave out model inputs and outputs and request bodies
  (`packages/service/src/observability/sentry.ts`, the eve roots'
  `instrumentation/sentry.ts`, the desktop's `Sentry.init`, and the web app's
  browser SDK, `apps/web/src/app/web-sentry-sdk.ts`, with the desktop renderer's
  token filters, `@luke/features/sentry-breadcrumbs`), so what a request, a log
  line, a local variable, or an error's words carries may still reach Sentry
  from the desktop and the browser, and a log line, a local variable, or an
  error's words from any of them; a credential among it is replaced only where
  Sentry's denylist catches it by name, and `PRIVACY.md` says so.
- Session replay records the rendered panel with every word masked
  (`packages/panel/src/session-replay.ts`), so what leaves the machine is
  layout, not text; an unmasked attribute or a new way of drawing words is what
  would change that.
- Never push PR media to a branch but `pr-assets`, under `pr-<number>/`, if
  you add any; a fresh `pr-assets-<topic>` branch mails a failed Vercel Preview
  on every push. PR media is not required.
- Never add to this file (`AGENTS.md`, which `CLAUDE.md` links to) unless the
  user explicitly approved the addition.

## The scheduled sweep

Vercel's cron calls `/api/maintenance/sweep` once a minute (the root `vercel.json`;
`packages/service/src/maintenance/maintenance-sweep.ts`) under the deployment's own
`CRON_SECRET`, compared in constant time; a deployment missing that secret
answers unavailable and sweeps nothing. Each call purges the conversations
stamped deleted seven days ago, settles as abandoned every turn still running
past its bound (`packages/database/src/models/abandoned-turns.ts`'s
`TURN_ABANDON`: an hour after it started, or twenty-five hours for a coding
agent's turn, whose one turn is its whole run), and ends on its owner's own
OpenAI key every voice session whose device detached and did not come back within the grace. It
also starts due automation runs, and for coding agents on a member's GitHub
token it reads their open pull requests' reviews, comments, and checks on that
token and wakes the agent with them, as the webhook does for the App.

## Testing

A test is a cost every push pays for as long as it exists. Write one only
where it pays that back by catching a regression nothing else would catch.

Each rule names what holds it: `[check: …]` is a lint rule or script that
fails the build, so the words are only its reason; `[review]` is held by the
reader alone. Move a rule from `[review]` to a check wherever one can hold it.

### Running tests

```
pnpm exec vitest run <path>              # the file you changed
pnpm check:affected                      # what changed since origin/main, from cache
./scripts/check.sh                       # everything CI runs bar Postgres
pnpm --filter @luke/web test:agent       # offline brain eval, by hand
```

- `[review]` Run the test files you touched, then push: CI runs the rest and
  gates the PR. Never run a whole workspace's suite to check one change.
  `check.sh` is for a release, a broad refactor, or when asked, and must exit
  0 when it runs.
- `[review]` Run a suite once and keep its output in a file to read, rather
  than running it again with a different filter.
- `[review]` Say in the PR which tests you ran and which you left to CI.

### Deciding to add a test

- `[review]` Name the regression first: the change a future author could make
  that this test, and no existing one, would catch. If you cannot name it, do
  not write the test.
- `[review]` Look for the test that already covers the behavior. Extend it,
  or add a row to its `it.each` table, before adding a file or a case.
- `[review]` Test what the diff changes, and only that: not code it leaves
  alone, a dependency, or the platform.
- `[review]` A bug fix comes with the one test that reproduces it. Run it
  before the fix and see it fail; a test that passes without the fix proves
  nothing and is not committed.
- `[review]` One case per behavior. Inputs that take the same path (spellings,
  flags, variants, sizes, themes) are one case, not a matrix.
- `[review]` A test you wrote to explore the code while working is deleted
  before the push unless it passes this section.
- `[check: anti-slop/no-source-read-in-test]` `[review]` Reach for the cheapest guard that holds: a type, then a lint rule
  in `tools/anti-slop/`, then a test. A rule about source text, such as a
  banned class or import, is a lint rule, never a test that reads source
  files.

### What a test checks

- `[review]` Behavior a caller can see through the public export: what it
  returns, renders as text or accessible role, stores, emits, or throws.
- `[review]` The expected value comes from somewhere other than the code under
  test: the requirement, a hand-worked example, or an independent oracle.
  Never compute it with the implementation's own helpers, and never paste it
  from the output.
- `[review]` These are not behavior, so no test asserts them: private state;
  call, render, or redraw counts; that a double was called; constants, token
  tables, getters, types, and re-exports; a Schema round-trip of a valid
  value; class names, stylesheet declarations, `var(--luke-*)` values,
  computed styles, and markup shape. Appearance is held by `@luke/ui`, its
  lint rules, and the catalog.
- `[review]` Nothing is exported only so a test can reach it.

### How a test is written

- `[check: anti-slop/no-node-test]` Tests run on vitest.
- `[review]` A test owns its world: one process, a temp directory it created
  (`temporaryDirectory` from `@luke/runtime/testing`), its own database
  (`getTestDB()` from `@luke/database/testing`), and `TestClock` for time. It
  never touches the network, a live provider, real time, or personal data,
  and passes alone or in any order.
- `[review]` A test finishes in about a second, and a file in about ten, on
  CI. One that cannot says why in a comment.
- `[check: anti-slop/no-internal-vi-mock]` `[review]` Use real code first, then a fake, then a stub, and replace only
  what crosses a process boundary: provider HTTP, Apple, the model, the OS,
  the clock. An Effect service is replaced by a test `Layer` on its tag;
  anything else by `vi.spyOn`, restored with `vi.restoreAllMocks()`. Never
  `vi.mock` a module of this repository.
- `[review]` An Effect test is `it.effect` and moves time with
  `TestClock.adjust`. It never runs an effect itself (`Effect.run*`,
  `Runtime.run*`, `ManagedRuntime.make`) or waits on the clock (`setTimeout`,
  `setInterval`, `Effect.sleep`, `it.live`). The Effect edge lint rules skip
  test files, since a test body is its own edge.
- `[review]` A query over account rows comes with a test that one user cannot
  read another's. A model or repository in `packages/database/src/` has a
  sibling `__tests__/<name>.test.ts` from the PR that adds it.
- `[review]` Set up through the shared builders (`apps/web/tests/support/`,
  `packages/wire/src/testing/`) before writing setup inline. A helper joins
  them once it has a second caller.

### Changing and removing tests

- `[check: anti-slop/no-focused-or-skipped-test]` `[review]` Never make a test pass by weakening it: no `.only`, `.skip`,
  `.todo`, or `it.flakyTest`, no looser assertion, and no longer timeout or
  extra retry without evidence of what was slow. A flaky test is fixed or
  deleted.
- `[review]` A golden is rewritten only by `LUKE_UPDATE_FIXTURES=1` through
  the shared helpers, never by hand, and the PR explains its diff. A JSON
  Schema golden exists only for a schema a model sees as a tool's input.
- `[review]` A test that breaks under a refactor because it pinned wiring is
  deleted, and the PR names the behavior test that still covers it.
- `[review]` A feature's tests leave with the feature. Nothing asserts that a
  removed thing is gone.
- `[check: scripts/repository-checks.sh]` Every workspace with a
  `vitest.config.ts` is on the root `vitest.config.ts` projects list, and each
  workspace's tests run in exactly one CI job.

## Effect idioms

Effect is the repository's infrastructure library, replacing what used to be
hand-rolled: a Schema that both parses and emits JSON Schema, disposables,
an event emitter, independent backoff loops, `setInterval` loops, a
semaphore, single-flight, bounded queues, an idempotency ledger, a worker RPC,
an injected clock seam, and a fake clock beside it. `effect` is pinned at
`4.0.4` through the pnpm catalog in `pnpm-workspace.yaml` and nowhere
else — every workspace that reaches it declares `"effect": "catalog:"`, so one
copy resolves across the repository, which is what keeps a `Context.Service`
minted in one package the same service in another. `@effect/platform`,
`@effect/rpc`, `@effect/sql`, and `@effect/experimental` are consolidated into
`effect` itself and reached at its own subpaths (`effect/http`, `effect/sql`,
`effect/rpc`, `effect/reactivity`, …); `@effect/platform-node`,
`@effect/sql-pg`, `@effect/sql-pglite`, `@effect/atom-react`, and
`@effect/vitest` stay separate, each on the same `4.0.4` through the same
catalog. The pin is an exact release rather than a range, and is moved
deliberately.

### Where an Effect may run

An Effect describes work; only a runtime edge runs one. The edges themselves
are the files listed in `tools/anti-slop/effect-edges.json`'s `runtimeEdges`,
and that file is the source of truth for them.
`Effect.runPromise`, `Effect.runSync`, `Effect.runFork`, their
`runPromiseExit`/`runSyncExit`/`runCallback` siblings, and the `…With` form of
any of them belong nowhere else — everything between the edges returns an
Effect and lets its caller decide — which the oxlint rule
`no-run-promise-outside-edges` enforces against that same file's
`runtimeEdges`, `runShims`, and `runOnHandedRuntime` lists;
`no-raw-async-primitives` enforces the equivalent for `setTimeout`,
`setInterval`, `new Promise`, `AbortController`, and `fs.watch` against its
`rawAsyncPrimitives` list. A file on those two run lists that is not a runtime
edge is a permanent adaptor, listed below with the one thing that keeps
it from ever moving onto the edges themselves; there is no other kind of row
on those lists, because a shim on its way to deletion is deleted in the same
PR that finishes the callers it was for, not left as a name on an allowlist.

### The permanent adaptors

- **`packages/runtime/src/effect/single-flight.ts`** — the check-and-create of
  the one `Deferred` every concurrent caller joins is an uninterruptible step
  that cannot suspend, so it runs synchronously (`Effect.runSync`) and forks
  the flight it decided on as a detached root fiber (`Effect.runFork`) rather
  than a fiber of whoever asked first, because a caller that gives up on its
  own await must not take the flight the other callers are still joined to.
- **`packages/host/src/host-kernel.ts`** — `openExternalThroughNode`, the one
  promise door the kernel keeps over `NodeRegistry#invoke`'s effect: the
  composer that hands it on hands it to a seam outside this repository's host
  package — the account session manager's consent
  (`packages/credentials/src/loopback-consent.ts`, whose `openExternal` is a
  `void | Promise<void>` and whose `reopen()` is synchronous) — so what would
  end this row is a decision about that seam rather than an implementation
  detail of this door.
- **`packages/host/src/client/app-state-store.ts`** — `AppStateStore`'s `snapshot`,
  `update`, and `touch` run their `SubscriptionRef` operation through
  `Effect.runSyncWith` on the services the launch handed them, never an empty
  context of their own, because every caller but the one production subscriber
  (which forks over the store's `changes` Stream) still holds a synchronous
  object, and the ordering those callers and this file's own tests depend on —
  a listener's patch is not lost, a re-announce lands before the caller's next
  statement — is what turning them into effects a caller awaits would give up.
- **`packages/host/src/update-service.ts`** — synchronous Electron
  IPC/menu callers (start, check, install) bridge into fibers on the services
  the launch handed them, on the same terms as the client's `app-state-store.ts`.
- **`packages/voice/src/orchestrator/live-voice-orchestrator.ts`** — the notice
  strip's two clocks, armed from callbacks belonging to no fiber of their own,
  start on the services the orchestrator was constructed with; the standing
  call's lifecycle is a `forkDetach` and needs no door.
- **`packages/features/src/hosted-link.ts`** — oRPC's `OpenAPILink` awaits a promise from its `fetch`, so the account call runs there on the services the asking fiber handed it; what would end this row is an Effect transport in oRPC's link.
- **The test-support edges** — `packages/database/src/testing/sql-client.ts`,
  `packages/database/src/testing/hosted-store-database.ts`,
  `apps/dev/evals/coder.eval.ts`, and
  `packages/wire/src/testing/effect.ts` each build a runner (a
  `ManagedRuntime` over a throwaway database) so a suite or an offline eval still written on `node:assert` or a
  plain fixture can hold a promise where an effect is described; a test body is
  its own edge.

### Vocabulary

`SchemaRead` (`@luke/wire`) is the boundary result vocabulary a Schema
decode answers when the result crosses IPC or the wire — a `Result` inside a
process, a `SchemaRead` where a caller on the other side of a process boundary
reads it: `packages/host/src/acts.ts`,
`packages/wire/src/effect/json-schema.ts`, and
`packages/database/src/models/message-reads.ts` all produce or read it.

### Idioms

- Schema at the boundary a value crosses, never a hand-written parser beside a
  hand-written shape.
- Drizzle: the `db.select()` builder, never `db.query`; the schema module
  under `packages/database/src/schemas/` first, then
  `pnpm db:generate --name=<what_it_does>` for its migration folder, which
  Drizzle's migrator applies by name and `drizzle-kit check` (run by
  `check.sh`) holds to commuting with every other branch's
  (`packages/database/README.md`). Two things differ from stock Drizzle usage. A row is decoded
  by an Effect `Schema` through `SqlSchema`, never `drizzle-zod`, because
  Effect takes no zod schema and a second validation library would split the
  one way a boundary value is declared. A statement is an `Effect` from
  Drizzle's own driver, `drizzle-orm/effect-postgres` over the runtime's
  `PgClient` (`drizzle-orm/effect-pglite` in the store's tests), read off the
  `Database` service in `packages/database/src/core/query.ts`, which every
  layer that provides the `SqlClient` provides beside it; it is yielded, and
  `anti-slop/no-await-drizzle-statement` refuses one awaited.
  `apps/web/server/README.md`'s "The data layer" is the rest.
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
- UI draws with `@luke/ui` (`packages/ui/README.md`): its components, page
  patterns and `--luke-*` tokens; no raw controls where a component exists,
  no literal colours or sizes, no `className` on its controls. A missing
  variant is added to `@luke/ui` as an `as const` option. Third-party engines
  are the exception. `@luke/ui` is built on shadcn/ui over Base UI: its
  controls vendor shadcn's source
  (`packages/ui/src/shadcn/`) and are written in Tailwind utilities over the
  one theme in `@luke/ui/tailwind/theme.css`, which no app restates.

## Commits

Commit messages and PR titles follow Conventional Commits 1.0.0
(https://www.conventionalcommits.org/en/v1.0.0/) and branch names follow
Conventional Branch 1.1.0 (https://conventionalbranch.org/), both exactly.

## Merging

Do not rebase onto or merge in `main` to bring a branch up to date unless the
user asks or the branch cannot go on without it: a conflict GitHub reports,
or a change on `main` the work needs. Being behind `main` is not a reason: CI
runs on the PR's merge with `main`, and the merge queue tests each PR against
the latest `main` before it lands, so an up-to-date branch buys nothing and
costs a rebuild, a re-run of CI, and a force-push. This holds before a push,
while CI runs, before arming auto-merge, and while a PR waits in the queue.
Restacking a stack onto the PR beneath it after that PR changed is the one
routine rebase.

Open a PR ready for review, never as a draft, so CI and review start on it at
once. To merge a PR, run `gh pr merge --auto` right away; the merge queue waits
on CI, so do not wait on it yourself, and do not update the branch first. In a
stack, arm a PR only once it targets `main`.

## TypeScript

- No stringly typed fixed value sets. Use `as const` SCREAMING_SNAKE_CASE objects,
  derive unions with `typeof VALUE_SET[keyof typeof VALUE_SET]`, and use the
  constants at call sites. Raw strings are only for freeform user-facing text.
- Never build a key by concatenating or interpolating identifiers. Use nested
  objects or nested `Map`s keyed by the original identifiers.
