# Agent guide

Luke is a macOS Electron app for working through a task by voice: the
developer talks a task through with Luke, who writes its plan down as they go.

## Commands

| Command | What it does |
| --- | --- |
| `./scripts/bootstrap.sh` | Install pinned workspace dependencies |
| `pnpm check:affected` | The portable checks for what changed since `origin/main`, replayed from cache where they already passed; run before pushing |
| `./scripts/check.sh` | Every portable repository, type, test, and build check: before a release, for a broad refactor, or on request |
| `./scripts/run.sh` | Launch against live sessions, replacing the running plain instance (`--fixture smoke`, `--keep-running`, `--no-trace`); `--instance <name>` runs a named one beside it, with its own profile, and `--preview` is one named for its Preview |
| `./scripts/evidence.sh` | Write the fixture PNG under `artifacts/` |
| `pnpm release:macos` | Local signed, notarized, verified DMG, zip, and update manifest |
| `pnpm lint:fix` | Repository formatting and safe lint fixes |

CI runs the portable check on Linux alone. The release rehearsal
(`release.yml`'s `macos-15` job, run on a `v*` tag push or a manual dispatch)
is the only Mac gate, so a green PR says nothing about the Mac and there is no
macOS check to wait for.

## Layout

Application logic lives in `packages/`. An app holds what is specific to
its platform or deployment and nothing else: Electron's main and preload
processes, the window and page roots, the Vercel function routes under
`apps/web/server/routes/`, the deployment shell beside them, the agents' eve
apps, `apps/luke` and `apps/dev`, and build and release scripts. A React component, hook, or
DOM-free view model lives in `packages/ui` when more than one app can
mount it, the hosted service's logic in `packages/service`, its contract
and clients in `packages/features`, and a wire value in `packages/wire`. A
`.ts` module whose imports name no module of its app and no platform
library (`electron`, `react-dom`, a DOM API, `better-auth`, `eve`,
`@vercel/*`) is logic and belongs in a package. The logic-lives-in-packages
check in `scripts/repository-checks.sh` refuses one under
`apps/desktop/src`, `apps/web/src`, `apps/web/server`, `apps/luke`, or `apps/dev` unless it is shell:
an app entry in `knip.json`, a `runtimeEdges` row in
`tools/anti-slop/effect-edges.json`, or a deployment or test-support file
the check names. A component is placed by review under the same rule.

## Never

- Never let a credential or account secret enter a Gateway answer or event, the
  voice window, a counted event, a trace, or a fixture. The repository check
  (`scripts/repository-checks.sh`) refuses a tracked literal shaped like a
  provider's credential; nothing else scans for secrets, so past that this rule
  is the whole of the check. Two carve-outs,
  approved by Dean on 2026-10-13: the output of `run_on_mac`, a command an agent
  ran on the developer's own Mac, may reach the conversation, the model, and the
  tool's events as it printed; a trace, a counted event, and a fixture still never
  carry it where that can be avoided. And an integration's MCP tool calls and
  results, a credential its provider answers among them, may reach the
  conversation, the model, an agent's transcript, and its traces. And, approved by
  Dean on 2026-10-14, a Terminal tab's bytes go only to the tab that opened
  them: through the terminal relay (`apps/web/server/terminal/`) and the host
  to that panel's window, never into a trace, a counted event, a fixture, app
  state, or the voice window. And, approved by Dean (automations D10), a webhook
  body an automation's caller sends may reach that run's agent task, transcript
  and traces. And, approved by Dean on 2026-10-15, an automation webhook secret
  may be shown once, in the window that minted it, at creation or rotation;
  never anywhere else. And, approved
  on 2026-10-13: the Keyframe session token for a call's own avatar may reach
  the panel window, which runs that session, and never the voice window,
  a Gateway answer or event, app state, a counted event, a trace, or a fixture.
  And, approved by Charles on 2026-10-16: Sentry's SDKs run with their default
  data collection (`packages/service/src/observability/sentry.ts`, the eve
  roots' `instrumentation/sentry.ts`, the desktop's `Sentry.init`), so what a
  request, a log line, a local variable, or an agent's prompt, reply, or tool
  result carries may reach Sentry; a credential among it is replaced only
  where Sentry's denylist catches it by name, and `PRIVACY.md` says so.
  And, approved by Dean on 2026-10-16: a workspace's cloud environment secrets
  reach its coding agents' sandboxes as environment variables
  (`packages/service/src/agents/coder-host/workspace-environment.ts`). Their
  values are masked out of what the agent's shell commands answer where
  found, but a command may still print one transformed, so they may reach the
  conversation, the model, the agent's transcript and traces, and Sentry as the
  carve-out above lets a tool result. Never a counted event or a fixture.
- Session replay records the rendered panel with every word masked
  (`apps/desktop/src/renderer/session-replay.ts`), so what leaves the machine is
  layout, not text; an unmasked attribute or a new way of drawing words is what
  would change that.
- Never push PR media to a branch but `pr-assets`, under `pr-<number>/`
  (`docs/WORKFLOW.md` step 7). A fresh `pr-assets-<topic>` branch mails a
  failed Vercel Preview on every push; a push refused because another workspace
  got there first is fetched, rebased, and pushed again.
- Never add to this file (`AGENTS.md`, which `CLAUDE.md` links to) unless the
  user explicitly approved the addition.

## The scheduled sweep

Vercel's cron calls `/api/maintenance/sweep` once a minute (the root `vercel.json`;
`packages/service/src/maintenance/maintenance-sweep.ts`) under the deployment's own
`CRON_SECRET`, compared in constant time; a deployment missing that secret
answers unavailable and sweeps nothing. Each call purges the conversations
stamped deleted thirty days ago, settles as abandoned every turn still running
past its bound (`packages/database/src/models/abandoned-turns.ts`'s
`TURN_ABANDON`: an hour after it started, or twenty-five hours for a coding
agent's turn, whose one turn is its whole run), and ends on Luke's key every
voice session whose device detached and did not come back within the grace. It
reads no account's words and runs no model.

## Testing

```
pnpm check:affected                      # before pushing: the checks for what changed
./scripts/check.sh                       # CI's checks, bar the Postgres job
pnpm exec vitest run <path>              # one file
pnpm --filter @luke/web test:store       # store tests on a real Postgres (CI's postgres job runs it)
pnpm --filter @luke/web test:agent       # offline brain eval, scripted model, by hand
```

`pnpm check:affected` must exit 0 before a push; then push and let CI, which
runs every check, gate the PR. `check.sh` is the full local run, for a
release, a broad refactor, or on request, and must exit 0 when it is run.

The vendored `testing` skill (`.agents/skills/testing`, lobehub's) is the
testing guide, and the rules below agree with it. Its `bunx vitest` is
`pnpm exec vitest` here.

- Every behavior change ships with a test that fails without it, same PR.
- Use the smallest layer that catches the bug: a type or lint rule, then a
  test through the module's public export, then a real Postgres or child
  process (`test:store`, which CI's postgres job runs).
- Tests are hermetic: one process, `TestClock`, a temp dir they made, PGlite.
  No network, personal data, live provider, or real clock. They pass alone
  and in any order.
- Prefer the real implementation, then a fake, then a stub. Mock at a
  process boundary (provider HTTP, Apple, the model, the OS, the clock), never
  between internal modules. For an Effect service the double is a test
  `Layer` on its `Context.Tag`; elsewhere `vi.spyOn` over `vi.mock`, restored
  with `vi.restoreAllMocks()`.
- Assert what a caller observes, never private state or call counts.
- Use the shared builders before inline setup:
  `apps/web/tests/support/`, `packages/wire/src/testing/`, and
  `temporaryDirectory` from `@luke/runtime/testing`.
- A test that needs a database provides `getTestDB()`
  (`@luke/database/testing`), a migrated database of its own, and a query
  over account rows tests that one user cannot read another's. A model or
  repository under `packages/database/src/` ships with a sibling
  `__tests__/<name>.test.ts` in the same PR.
- Effect tests use `it.effect` and `TestClock.adjust`, rather than running
  an effect themselves (`Effect.run*`, `Runtime.run*`, `ManagedRuntime.make`)
  or waiting on real time (`setTimeout`, `setInterval`, `Effect.sleep`,
  `it.live`). No lint rule holds a test file to this: the Effect edge rules
  exempt one by extension, because a test body is its own edge
  (`tools/anti-slop/shared/effect-edges.ts`), so review is the check.
- Goldens change only under `LUKE_UPDATE_FIXTURES=1` through the shared
  helpers, with the diff explained in the PR.
- Never loosen or skip a test to go green: no `.only`, `.skip`, `.todo`, or
  `it.flakyTest`, which no lint rule refuses either. Fix or delete a flaky
  test. A test that breaks on a refactor because it checks internal
  wiring a behavior test already covers is deleted, not fixed, and the PR
  says which behavior test covers it.
- Do not write change-detector tests: an expected value computed by the code
  under test or pasted from its output; a test of a getter, constant, type,
  re-export, or Schema round-trip on a valid value; a test that only asserts
  a fake was called; a private function exported for a test.

What the checks hold a test to is narrower than the rules above:
`anti-slop/no-node-test` refuses `node:test` in TypeScript, so every test runs
on vitest, and `scripts/repository-checks.sh` refuses a hand-rolled `mkdtemp`
in a desktop or host test (`temporaryDirectory` instead) and a workspace whose
`vitest.config.ts` the root `vitest.config.ts` projects list does not name.

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

An Effect describes work; only a runtime edge runs one. The edges are listed
in `tools/anti-slop/effect-edges.json`'s `runtimeEdges`: `apps/desktop/src/main/main.ts`
(the desktop's one `ManagedRuntime`), `apps/desktop/src/main/services/compose-desktop.ts`
(the layer that runtime is built from), the renderer root
`apps/desktop/src/renderer/index.tsx` (loaded once per window, the panels and
the voice window alike, so no two windows share a browser registry),
`apps/desktop/src/renderer/renderer-runtime.ts` (the module the root's
runtime is built from: `Atom.runtime`'s layer is built, and `AtomRegistry.get`
reads it, the moment the root first reaches it, so the edge is here rather than
at the root that imports it), the renderer's own fiber sites — the
voice window's `apps/desktop/src/renderer/voice/live-call.ts` and
`apps/desktop/src/renderer/voice/use-voice-session.ts` — the web's own
module-scope memoized runtime `apps/web/server/runtime.ts` and the four doors
that hold its `runWeb`: `apps/web/server/route-effect.ts` (the adaptor every
function module under `apps/web/server/routes/**` exports its `HttpRouter`
through, which reads that runtime once per instance and lets the handler it
builds do its own running), `apps/web/server/voice/function.ts`
(the voice service, stood for a function instance's life rather than for a
request, so there is no request fiber to compose it into),
`apps/web/server/terminal/function.ts` (the terminal relay, stood for a
function instance's life on the same terms) and
`apps/web/server/seed-clients.ts` (the OAuth client seeding command, run as
its own process), each eve root's own module-scope memoized runtime,
`apps/luke/runtime.ts` and `apps/dev/runtime.ts`, built over the
same layer (`@luke/service/runtime`'s `webServices`) and holding its
`runAgent`, the eve project's authored files —
`apps/luke/agent.ts`, `apps/luke/channels/eve.ts`,
`apps/luke/hooks/store.ts`, `apps/luke/instructions/prompt.ts`,
`apps/luke/instructions/seed.ts`, and `apps/luke/tools/brain.ts` — each
an edge because eve drives them through promise-shaped hooks of its own and
an authored file is where this deployment runs what it hands eve — and
`apps/luke/host.ts`, the one module those files share their host through,
which composes the production seams over `HostedEnvironment` with
`Effect.runSync` as it loads, because the channel's door takes the
deployment's secret as a value and the environment read suspends on nothing —
and the coding-agent eve project's authored files on the same terms —
`apps/dev/agent.ts`, `apps/dev/channels/eve.ts`,
`apps/dev/hooks/store.ts`, `apps/dev/instructions/prompt.ts`, and
`apps/dev/sandbox.ts` (the sandbox selector, which eve calls as a
promise when a tool first needs the sandbox and which runs the checkout
there), each an edge because eve drives them through promise-shaped hooks of
its own, and `apps/dev/host.ts`, the one module those files share their
host through, composed with `Effect.runSync` as it loads for the same reason
`apps/luke/host.ts` is. Not
every seam in `packages/service/src/` is an effect down to its floor:
`packages/service/src/agents/brain-host/production.ts`'s `spend` is
the AI SDK's async middleware, and `packages/service/src/agents/brain-host/door.ts`'s
`SessionOwnership` speaks eve's own `AuthFn<Request>` — two promise-shaped
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
reading `apps/web/server/runtime.ts`'s own `runWeb` and `webRuntime`, and
each eve root's `runAgent`, as the runs they are, so a module that holds the edge's runner rather than
`Effect.runPromise` itself is no less visible to it;
`no-raw-async-primitives` enforces the equivalent for `setTimeout`,
`setInterval`, `new Promise`, `AbortController`, and `fs.watch` against its
`rawAsyncPrimitives` list. A file on those two run lists that is not a runtime
edge above is a permanent adaptor, listed below with the one thing that keeps
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
- **`apps/desktop/src/main/app-state.ts`** — `AppStateStore`'s `snapshot`,
  `update`, and `touch` run their `SubscriptionRef` operation through
  `Effect.runSyncWith` on the services the launch handed them, never an empty
  context of their own, because every caller but the one production subscriber
  (which forks over the store's `changes` Stream) still holds a synchronous
  object, and the ordering those callers and this file's own tests depend on —
  a listener's patch is not lost, a re-announce lands before the caller's next
  statement — is what turning them into effects a caller awaits would give up.
- **`packages/host/src/update-service.ts`** — synchronous Electron
  IPC/menu callers (start, check, install) bridge into fibers on the services
  the launch handed them, on the same terms as the desktop's `app-state.ts`.
- **`packages/voice/src/orchestrator/live-voice-orchestrator.ts`** — the notice
  strip's two clocks, armed from callbacks belonging to no fiber of their own,
  start on the services the orchestrator was constructed with; the standing
  call's lifecycle is a `forkDetach` and needs no door.
- **The test-support edges** — `packages/database/src/testing/sql-client.ts`,
  `packages/database/src/testing/no-database.ts`,
  `packages/database/src/testing/hosted-store-database.ts`,
  `apps/luke/evals/brain-host.eval.ts`, `apps/dev/evals/coder.eval.ts`, and
  `packages/wire/src/testing/effect.ts` each build a runner (a
  `ManagedRuntime` over a throwaway database, a `SqlClient` that refuses every
  statement) so a suite or an offline eval still written on `node:assert` or a
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
- Drizzle follows the vendored `drizzle` and `db-migrations` skills
  (lobehub's): the `db.select()` builder, never `db.query`; the schema module
  under `packages/database/src/schemas/` first, then
  `pnpm db:generate --name=<what_it_does>` for its migration folder, which
  Drizzle's migrator applies by name and `drizzle-kit check` (run by
  `check.sh`) holds to commuting with every other branch's
  (`packages/database/README.md`). Two things differ from lobehub's examples. A row is decoded
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
- A bundle-budget baseline (`apps/desktop/bundle-budget.json`, checked with 5%
  slack) is re-recorded with `LUKE_UPDATE_BUNDLE_BUDGET=1` by a PR that
  genuinely needs the room, a feature's or a library's, which states the reason
  and the size delta in its body. Drift and accidental growth are not a reason:
  the slack is the speed bump that makes a PR stop and say why.

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

## Commits

Commit messages and PR titles follow Conventional Commits 1.0.0
(https://www.conventionalcommits.org/en/v1.0.0/) and branch names follow
Conventional Branch 1.1.0 (https://conventionalbranch.org/), both exactly.

## Merging

To merge a PR, run `gh pr merge --auto` right away, once any manual pre-merge
step (`docs/WORKFLOW.md` step 3's preview run) is done; the merge queue waits on
CI, so do not, and do not rebase onto `main` unless it conflicts. In a stack,
arm a PR only once it targets `main`.

## TypeScript

- No stringly typed fixed value sets. Use `as const` SCREAMING_SNAKE_CASE objects,
  derive unions with `typeof VALUE_SET[keyof typeof VALUE_SET]`, and use the
  constants at call sites. Raw strings are only for freeform user-facing text.
- Never build a key by concatenating or interpolating identifiers. Use nested
  objects or nested `Map`s keyed by the original identifiers.
