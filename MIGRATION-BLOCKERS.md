# Effect migration blockers

## Completed in this branch

- Merged `effect-runtime.ts` into `desktop-app.ts`; deleted `effect-runtime.ts`
- `services/http.ts`: `makeHttpLive(runRequestEffect)` — no `runPromise` in loopback handler
- `account-loopback.ts`, `google-calendar-oauth.ts`: removed `Effect.runPromise` from timeouts/cancel
- `account-token-lifecycle.ts`: `singleFlight` / `singleFlightResult`; removed `Effect.runSync`
- `settings-store.ts`: full Effect conversion with `Files` service
- `superset-cli.ts`, `superset-sign-in.ts`: Effect + `Cli`/`Files` services
- `update-service.ts`, `product-event-sender.ts`: Effect-based deduplication (no `#inFlight` Promise)
- `openai-attention-evaluator.ts`, `hosted-attention-evaluator.ts`: removed `#quietUntil` Ref; `AttentionRateLimited` + `Effect.retry`
- `account-session-manager.ts`: `signOut()` returns Effect; `refreshOnce` is Effect
- `sidecar-core` test mocks: `Effect<_, never, never>` requirement types
- `tools/oxlint/anti-slop/effect`: allow `tests/support/**` for `runPromise`
- TypeScript: `pnpm exec tsc --noEmit` in `apps/desktop` passes

## Remaining DoD gaps

### `async`/`Promise<` grep (in-scope files still matching)

- `account-session-manager.ts` — `beginSignIn` / `deleteEverywhere` IPC boundaries still use Promise
- `ipc/session-acts.ts`, `ipc/account-session.ts`, `ipc/settings-rows.ts`, `ipc/voice-runtime.ts`, `ipc/window-surface.ts`
- `cloud-session-adapter.ts`, `observation-hooks.ts` (`files.bridge` callback)
- `settings-handler.ts` — edge file (Electron IPC handler signatures)
- Edge files `desktop-app.ts`, `action-handler.ts` — allowed `runPromise`; grep still counts `Promise<` in IPC types

### Out of scope (grep matches expected until excluded or later pass)

- `renderer/**`, `talk-key.ts`, `dock-presence.ts`, `hotkey-registrar.ts`, `shared/contracts.ts`
- I/O services `services/cli.ts`, `services/files.ts`, `services/http.ts` (`Effect.async` / internal Promise helpers)

### `runPromise|runSync|ManagedRuntime` grep

Passes: only `action-handler.ts`, `desktop-app.ts`, `observation-loop.ts` (settings-handler.ts and `ipc/window-surface.ts` should be verified)

### `./scripts/check.sh`

Fails on `pnpm oxlint` (~75 `require-safety-comment-for-type-assertion` findings across migration-touched files). Biome and TypeScript pass.

### Not yet converted

- `provider-registrations.ts` (partial)
- `feedback-delivery.ts`, `observation-hooks.ts` (bridge callback)
- Full `ipc/session-acts.ts` → `registerEffectInvoke` for all handlers
- `ipc/window-surface.ts`, `settings-handler.ts` edge alignment
