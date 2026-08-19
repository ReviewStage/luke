# Effect migration plan

This document is the phased plan for migrating the Luke monorepo from
Promise-based async to [Effect](https://effect.website/) (`effect@3.22.1`). It
names what moves when, what stays put, and how parallel work stays safe while
trust constraints from AGENTS.md remain binding throughout.

## Executive summary

**Feasible: yes.** The codebase is already structured for a gradual migration:
platform-independent domain lives in `packages/sidecar-core`, I/O is injected
(`CloudFetch`, `CliRun`), IPC failures map to typed status unions rather than
throws, and wire parsing is defensive rather than exception-driven. None of that
has to be discarded — Effect replaces the plumbing around it.

**Scope:** roughly **214 source TypeScript files** across `apps/` and
`packages/` (excluding tests), of which **~163 are non-UI** — main process,
preload, IPC, adapters, and `@sidecar/core`. The renderer (`apps/desktop/src/renderer/`, ~51 files) stays Promise-first at the IPC boundary for as long as React hooks and Electron preload do; only shared logic that already lives outside the renderer is a migration candidate there.

**Tests:** ~120 files using `node:test` and `tsx --test`. They migrate with
their modules; the harness does not switch to Vitest.

**Timeline shape:** multi-phase, not a flag day. Each phase lands behavior-identical
diffs `./scripts/check.sh` can gate. macOS UI validation (`./scripts/verify.sh`)
applies only when a phase touches motion or renderer wiring.

**Foundation already started:** `effect@3.22.1` is declared on
`@sidecar/core`, `createEffectActionHandler` exists beside
`createActionHandler`, and `anti-slop-effect` is registered in
`.oxlintrc.json`. Phase 1 completes and wires what those pieces assume.

---

## Goals

- **Typed effects at composition roots.** Main process startup, observation
  loops, and IPC handlers compose through `Layer` and `Effect`; requirements
  propagate to the root rather than hiding in constructor options bags.
- **Services for injectable I/O.** `CloudFetch`, `CliRun`, filesystem reads,
  OAuth loopback, and settings persistence become Effect services with test
  Layers, not ad-hoc function parameters threaded through adapters.
- **Schema at wire boundaries.** JSON and IPC payloads gain `Schema` decoders
  alongside — and eventually in place of — hand-written guards in `json.ts` and
  `wire-boundary.ts`, without changing what invalid input means (undefined or a
  typed refusal, not a throw).
- **Preserve trust constraints.** Observation stays read-only; writes remain
  the direct product of a developer-opened turn; credentials never widen their
  reach; provider transcripts are never written. Effect models *how* those
  rules are enforced, not *what* they are.
- **Preserve status unions at the IPC boundary (initially).** `ProviderActResult`,
  `TrackerActionResult`, `SessionOpenResult`, and their siblings stay the wire
  answer. Effect failures inside main process code map to those statuses at the
  IPC edge — the renderer does not learn `Either` first.
- **No behavior changes during migration.** A phase that refactors async shape
  must not change roster contents, refusal reasons, timing guarantees, or trust
  gates. Tests and fixtures are the arbiter.

## Non-goals

- **Replacing status unions with `Either` on the wire.** Unsupported and
  rejected are answers, not defects. They stay explicit status fields until a
  separate product decision says otherwise.
- **Migrating the renderer to Effect.** React hooks, WebRTC, and browser APIs
  stay Promise- and callback-native. Shared domain already in `@sidecar/core`
  may use Effect; the renderer consumes it through IPC or thin Promise wrappers.
- **Rewriting tests onto Vitest or `@effect/vitest`.** `node:test` remains;
  helpers wrap `Effect.runPromise` / `Effect.runPromiseExit` where needed.
- **Effect in generated or hand-edited artwork.** `luke-face-art.ts`,
  `motion-tokens.ts`, and outputs of the design generators are out of scope.
- **Widening provider capabilities.** Migration must not add endpoints, hooks,
  or write paths that AGENTS.md does not already authorize.

---

## Architecture principles

### Layer at composition roots

`main.ts`, observation supervisor wiring, and IPC registration are the only
places that call `Layer.launch` / `Effect.runPromise` on the full application
graph. Capability modules export `Layer` values and `Effect` programs; they do
not run themselves.

`make<Capability>` constructors (Effect service tags) stay in their owning
modules. Runtime code imports the `Layer`, not the constructor — enforced by
`anti-slop-effect/no-service-constructor-imports`. Tests import constructors
freely.

### Schema at wire boundaries

Hand-written guards in `packages/sidecar-core/src/json.ts` and
`apps/desktop/src/wire-boundary.ts` remain authoritative until a boundary file
explicitly switches. Where `Schema` is introduced:

- decode with `Schema.decodeUnknownEither` or `decodeUnknownOption`;
- a decode miss is still **no value**, not an exception — matching today's
  `undefined` returns from `text()`, `isRecord()`, and friends;
- encode only at outbound boundaries that already serialize JSON.

IPC validate functions stay pure and synchronous; they run before any `Effect`.

### Status unions preserved at the IPC boundary

Inside main process code, a provider act may be `Effect<ProviderActResult,
CloudError, HttpClient>`. The IPC handler runs it and returns
`ProviderActResult` directly on success. Unexpected defects map through
`failure()` to the same typed refusal the Promise path would have produced —
never an uncaught rejection to the renderer.

### No behavior changes during migration

- Observation passes still commit whole-provider snapshots.
- Adapter injectables (`CloudFetch`, `CliRun`) keep the same default
  implementations until their service Layer replaces them in the same PR series.
- `./scripts/check.sh` is green at every phase boundary; `./scripts/verify.sh`
  when UI-adjacent files move.

### Trust constraints carry over

Effect services do not relax AGENTS.md rules:

| Constraint | Effect shape |
| --- | --- |
| Observation read-only | `observe(): Effect<…>` has no write methods on the same service |
| User-initiated writes only | IPC `act` Effects run only from validated invoke handlers |
| No shell between Luke and provider CLIs | `CliRun` service wraps `execFile` directly; no `Command` through `/bin/sh` |
| Credentials bounded | Key stores are services; they never appear in logs, Schema, or guide snapshots |
| No transcript writes | Filesystem service exposes read paths used by transcript adapters only |

---

## Phased plan

File counts are approximate inventories at plan time; they shift as the tree
grows. Counts exclude tests unless noted.

### Phase 1 — Foundation

| | |
| --- | --- |
| **Scope** | Dependencies, IPC bridge, test helpers, lint, empty service skeletons |
| **File areas** | Root and package manifests, `apps/desktop/src/effect-action-handler.ts`, new `packages/sidecar-core/src/effect/` (or equivalent) for shared helpers, `scripts/check.sh` path |
| **Parallel streams** | See [Phase 1 detail](#phase-1-foundation-detail) |
| **Exit criteria** | `effect@3.22.1` on every package that imports it; `createEffectActionHandler` tested; shared `runEffect` test helper; `./scripts/check.sh` green; no production call sites migrated yet |
| **~Files** | **~8–12** new or touched |

### Phase 2 — `@sidecar/core` domain and wire

| | |
| --- | --- |
| **Scope** | Pure domain unchanged; async registry and attention paths become Effects; optional Schema twins for hosted wire types |
| **File areas** | `packages/sidecar-core/src/json.ts`, `session-registry.ts`, `attention.ts`, `attention-openai.ts`, `issues.ts`, `calendar.ts`, `composite-provider-adapter.ts`, `hosted-service.ts` |
| **Parallel streams** | (A) Schema for `hosted-service` wire shapes; (B) `session-registry` Effect API behind Promise wrapper; (C) attention evaluator Effect pipeline |
| **Exit criteria** | Core tests pass with `tsx --test`; public exports still include Promise aliases where desktop imports them; no desktop adapter changes required |
| **~Files** | **~12–15** of 31 |

### Phase 3 — Injectable I/O services

| | |
| --- | --- |
| **Scope** | `CloudFetch`, `CliRun`, local read, settings store, and SQLite as Effect services with test Layers |
| **File areas** | `cloud-session-adapter.ts`, `cli-session-adapter.ts`, `local-session-adapter.ts`, `local-sqlite.ts`, `settings-store.ts`, `apps/desktop/tests/support/http-fake.ts` |
| **Parallel streams** | (A) `HttpClient` service + fake Layer; (B) `CliRun` service + fake Layer; (C) `SettingsStore` service |
| **Exit criteria** | Adapters compile against either injectable fn or service (dual support); adapter unit tests run against fake Layers; defaults unchanged |
| **~Files** | **~10–14** |

### Phase 4 — Provider and tracker adapters

| | |
| **Scope** | All session provider adapters, transcript readers, composite adapter, Linear tracker |
| **File areas** | `*-adapter.ts`, `*-transcript.ts`, `linear-tracker.ts`, `provider-registrations.ts`, `observation-hooks.ts` |
| **Parallel streams** | One stream per provider family: cloud API, CLI/local, transcript-only |
| **Exit criteria** | Full adapter test suite green; observation loop still calls `observe()` through Promise facade or Effect at loop boundary; roster snapshots byte-identical on fixtures |
| **~Files** | **~35–40** |

### Phase 5 — Main-process orchestration

| | |
| --- | --- |
| **Scope** | Observation loops, account/OAuth, hosted clients, Superset CLI, calendar, update check |
| **File areas** | `observation-loop.ts`, `account-*.ts`, `hosted-*.ts`, `superset-*.ts`, `google-calendar*.ts`, `linear-oauth.ts`, `update-service.ts`, `realtime-minter.ts`, `voice-capability-assembler.ts` |
| **Parallel streams** | (A) observation + account; (B) hosted + voice; (C) calendar + tracker OAuth |
| **Exit criteria** | `./scripts/check.sh` green; fixture run (`./scripts/run.sh --fixture smoke`) produces identical roster; no new network or credential behavior |
| **~Files** | **~35–45** |

### Phase 6 — IPC and preload bridge

| | |
| --- | --- |
| **Scope** | Migrate `registerSessionActsIpc` and sibling IPC modules to `createEffectActionHandler`; `main.ts` Layer launch |
| **File areas** | `ipc/session-acts.ts`, `ipc/*.ts`, `action-handler.ts` (deprecate), `main.ts`, `preload.ts` (types only if needed) |
| **Parallel streams** | (A) session acts; (B) settings/account IPC; (C) voice/window IPC |
| **Exit criteria** | All IPC tests pass; renderer unchanged; `createActionHandler` unused in production paths; status unions on the wire unchanged |
| **~Files** | **~10–12** |

### Phase 7 — Hosted web API (`apps/web`)

| | |
| --- | --- |
| **Scope** | Server handlers and DB access for the hosted tier |
| **File areas** | `apps/web/server/**`, `apps/web/api/**` |
| **Parallel streams** | (A) auth + DB; (B) voice mint + attention review; (C) usage/quota/account delete |
| **Exit criteria** | `apps/web` tests green; HTTP responses match `hosted-service` wire contract; desktop hosted clients need no changes |
| **~Files** | **~20–25** |

### Phase 8 — Cleanup and Promise removal

| | |
| --- | --- |
| **Scope** | Remove Promise facades, delete `createActionHandler`, drop dual injectable/service support, document final Layer graph |
| **File areas** | Touch points across prior phases; renderer stays Promise at IPC |
| **Parallel streams** | Mechanical removal after all call sites migrated |
| **Exit criteria** | No `Promise` return types on adapter interfaces unless they wrap Effect for external API; grep-clean for deprecated helpers; `./scripts/check.sh` and CI green |
| **~Files** | **~20–30** churn, mostly deletions |

**Renderer (~51 files):** not scheduled in Phases 2–7. Revisit only if shared
logic moves into `@sidecar/core` with Effect implementations the renderer must
call directly (unlikely while IPC remains the boundary).

---

## Phase 1 foundation detail

Phase 1 is deliberately parallelizable. Other agents can land these work
streams independently if they agree on export paths and do not migrate call
sites early.

### Stream A — Package graph and versions

- Pin `effect@3.22.1` on `@sidecar/core` (done) and add the same pin to
  `@luke/desktop` and `@luke/web` when those packages first import Effect.
- Re-export shared Effect helpers from `@sidecar/core` only if desktop and web
  both need them; otherwise keep helpers package-local until duplication hurts.
- `./scripts/bootstrap.sh` and lockfile updated; CI cache sees the new dep.

### Stream B — IPC Effect bridge

- `apps/desktop/src/effect-action-handler.ts` — `createEffectActionHandler`
  (done): runs `Effect.runPromiseExit`, maps defects through `failure()`,
  preserves untrusted-sender throw.
- Add a sibling helper or generic for mapping **typed error channels** to status
  unions (e.g. `CloudFailure` → `ProviderActResult`) without throwing.
- Document the pairing: validate sync → `act` as Effect → wire status on exit.
- Tests in `apps/desktop/tests/effect-action-handler.test.ts` (done); extend for
  status-union mappers when they land.

### Stream C — Test harness helpers

- `packages/sidecar-core/tests/support/effect.ts` (or similar):
  - `runEffect<A, E>(effect: Effect.Effect<A, E, never>): Promise<A>` —
    fails the test on defect;
  - `runEffectEither` for assertions on expected failures.
- Keep helpers thin; do not introduce `@effect/vitest`.
- Document pattern in this file: tests stay `node:test`, async tests `await`
  `runEffect(...)`.

### Stream D — Service skeletons (no production wiring)

- Stub `Layer` modules with types only:
  - `HttpClient` (wraps today's `CloudFetch` shape);
  - `CliRun` (wraps today's `CliRun` shape);
  - `SettingsStore` (read/write settings JSON);
  - optional `Clock` and `Random` if attention tests need determinism.
- Each exports `make*` in its module, `layer` for tests, `layerLive` for
  production defaults — but **nothing in `main.ts` provides them yet**.

### Stream E — Lint and tooling

- `anti-slop-effect` already enabled globally in `.oxlintrc.json`.
- Phase 1 exit: `./scripts/oxlint.sh` passes with Effect imports in foundation
  files only.
- Optional: add a CI grep or oxlint override that warns on `from "effect"` in
  renderer paths until explicitly allowed.

### Stream F — Schema scaffolding (optional in Phase 1)

- Add `@effect/schema` only when a Phase 2 boundary file needs it; same version
  alignment as `effect@3.22.1`.
- First candidate: `HostedQuota`, `HostedMintAnswer` in `hosted-service.ts` —
  decode-only Schema beside existing guards.

### Phase 1 coordination rules

- No stream migrates production adapter or IPC call sites.
- New files follow existing comment bar: rationale for constraints, not narration.
- Trust-sensitive code paths (`cli-session-adapter`, `session-acts`) are
  read-only for Phase 1 agents unless explicitly assigned Phase 6.

---

## Pattern mapping

| Current pattern | Effect equivalent | Notes |
| --- | --- | --- |
| `async function …(): Promise<A>` | `Effect.Effect<A, E, R>` | `E` typed per boundary; use `never` only when defects are truly impossible |
| `try { … } catch { … }` in IPC | `Effect.runPromiseExit` + `failure()` | Untrusted sender stays a throw — outside Effect |
| `ProviderActResult` / status unions | Same unions on the wire; internal `Effect.map` / `match` to produce them | Do not replace with `Either` in IPC types |
| `CloudFetch` injectable | `HttpClient` service + `Layer.succeed` fake in tests | Default layer wraps existing fetch logic verbatim |
| `CliRun` injectable | `CliRun` service; `Layer` provides `defaultRun` | No shell; same argv and timeout bounds |
| `createActionHandler` | `createEffectActionHandler` | Validate stays sync; `act` returns Effect |
| `json.ts` guards (`text`, `isRecord`, …) | `Schema` decode to same outputs; guards remain until cutover | Miss → `Option.none` / `undefined`, not fail |
| `wire-boundary.ts` `unparsedWire` | Unchanged at IPC edge; Schema decodes after `unparsedWire` | Structured-clone cast stays one step in |
| `Promise.all` in composite adapter | `Effect.all` with `{ concurrency: "unbounded" }` | Preserve fail-whole observation semantics |
| `ObservationLoop` `run: () => Promise<void>` | `run: Effect.Effect<void, never, R>` composed at root | Loop class can stay Promise internally until Phase 5 |
| `node:test` + `async` test | `await runEffect(program)` helper | No Vitest; no `@effect/vitest` |
| `new Error(…)` for expected refusal | `Effect.succeed({ status: REJECTED, reason })` | Expected business refusals are not defects |
| `CliCommandError` / `CloudFailure` | Typed `E` channel or tagged error type | Map to status union at adapter boundary |
| Constructor option bags (`deps: { fetch, … }`) | `R` requirements + `Layer.provide` at root | Reduces threading through every factory |

---

## Risk register

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| **Behavior drift** during refactor | Medium | High | Fixture snapshots and adapter tests before/after each phase; `./scripts/run.sh --fixture smoke` |
| **Trust boundary regression** (shell injection, transcript write) | Low | Critical | Code review against AGENTS.md; CliRun service keeps `execFile` only; no new FS write APIs on observation services |
| **IPC contract change** | Medium | High | Status unions frozen at preload types; renderer unchanged until explicit version bump |
| **Layer sprawl** — too many small services | Medium | Medium | Start with I/O and settings; merge services that always co-provide; document Layer graph |
| **Effect / Schema version skew** | Low | Medium | Single pinned version monorepo-wide; one lockfile bump per phase |
| **Test flakiness** from runtime timing | Low | Medium | Keep `ObservationLoop` semantics; use test Layers with deterministic clocks where needed |
| **Parallel agent conflicts** | Medium | Medium | Phase 1 coordination rules; one owner per provider adapter stream in Phase 4 |
| **Renderer accidentally imports Effect** | Low | Low | Oxlint path override optional; review `apps/desktop/src/renderer/**` |
| **macOS-only paths untested in CI** | Medium | Medium | Portable checks in CI; `./scripts/verify.sh` on UI phases before merge |
| **Migration stall** at dual Promise/Effect APIs | High | Medium | Phase 8 deadline; Promise facades marked `@deprecated` after Phase 6 |

---

## Lint and tooling

### Current state

- Generic `anti-slop` rules: enabled in `.oxlintrc.json`.
- `anti-slop-effect/no-service-constructor-imports`: enabled globally; test
  files exempt for chained-assertions and service constructor imports.

### When Effect lands in a package

1. Ensure `effect` is a **direct** dependency in that package's manifest (not
   only transitive through `@sidecar/core`).
2. `./scripts/oxlint.sh` must pass with Effect imports in that package.
3. Do not disable `anti-slop-effect` to unblock migration; fix imports to use
   `Layer` at the root.

### Optional additions (product decision)

- Renderer ignore for `effect` imports until Phase 8 review.
- `repository-checks.sh` grep: fail if `createActionHandler` is imported after
  Phase 6 exit criteria met.

### Install reference

The `install-anti-slop` skill documents copying and registering both plugins.
Effect rules activate when `effect` appears in a package manifest — already
true for `@sidecar/core`.

---

## Verification checklist (every phase)

1. `./scripts/check.sh` — portable repository, type, test, build.
2. Phase touches adapters or observation → fixture roster comparison.
3. Phase touches renderer or motion → `./scripts/verify.sh` and visual evidence
   per AGENTS.md.
4. Phase touches provider capabilities → `PROVIDERS.md` unchanged unless
   capability changed (migration alone does not).
5. No new writes to provider transcript paths; no new shell invocations.

---

## Related documents

- AGENTS.md — trust constraints and canonical commands (binding through migration).
- PROVIDERS.md — per-provider capability surface (unchanged by async shape alone).
- DESIGN.md — panel motion (unaffected unless renderer IPC timing changes).
- `.agents/skills/install-anti-slop/SKILL.md` — anti-slop and anti-slop-effect setup.
