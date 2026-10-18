# Proposal: move the hosted API and the desktop bridge to oRPC

Status: **approved by Charles Pan on 2026-10-18**, D1–D4 decided as recommended. Written to be rolled
out with `/orchestrate`: §6 is the PR list, §7 the dependency graph, and each
PR's entry is its worker's brief.

The ask: "Can we fully migrate our codebase to use oRPC? Plan out the
implementation so I can use /orchestrate after."

## 1. What we have today

There is no RPC library in the repository. What oRPC would replace is
hand-rolled in three layers.

**The hosted `/api/*` service.** 117 route files under
`apps/web/server/routes/**`, almost all one line:
`export default routeFromHttpRouter(<group>App(seams))`. The handlers are
about 30 Effect `HttpRouter` group factories in
`packages/service/src/**/*-app.ts` (about 11.9k lines). Each endpoint:

- checks its own method (`hostedMethod`, every path registered under `*`, so
  a wrong method is 405 and not 404);
- resolves the caller through a seam taking a web `Request`
  (`resolveHostedUserId`: OAuth bearer or cookie; `resolveHostedBearerUserId`;
  `resolveSessionUserId`: Better Auth session);
- reads its body with `readJsonBodyEffect` and decodes it with an Effect
  Schema from `packages/features/src/*-wire.ts` (`readEither`);
- fails with a `HostedRefusal = { error: slug }`, which
  `HOSTED_REFUSAL_STATUS` (`packages/service/src/http/http-effect.ts`) maps
  to a status (22 slugs), and answers with `hostedJsonResponse`.

Routing on Vercel is one `default` function plus `maintenance-sweep`,
`voice/sessions` and `terminal/sessions`. `function-bundles.ts` generates the
grouped entry, `function-rewrites.ts` writes 117 rewrites (59 of them turn
path segments into query parameters, so `/api/plans/:id/board` reaches the
handler as `/api/plans/board?id=`), and `function-dispatch.ts` restores the
path from `?route=` and `?route-path=`. `api-callers.ts` checks every `/api/`
path a client spells resolves to a rewrite.

The routes, by kind:

| Kind | Count | Routes |
| --- | --- | --- |
| Plain JSON, our own clients | 90 | everything not below |
| Held long-poll reads (JSON) | 10 | `mac-commands`, `inbox`, `plans/inbox`, `agents/inbox`, `agents/messages`, `agents/subagent-messages`, `plans/messages`, `plans/subagent-messages`, `plans/comments`, `workspaces/chat` |
| WebSocket | 2 | `voice/sessions`, `terminal/sessions` |
| External shape | 15 | `auth/[...all]`; `github/webhook`, `automations/webhook`; `maintenance/sweep`, `maintenance/provider-keys-rewrap`; redirects `github/install`, `github/installed`, `github/installed/authorized`, `account/integrations/connected`, `workspaces/linear/connected`; bytes `plans/attachment`, `agents/picture`, `agents/github-image`, `inbox/attachment`, `workspaces/photo` |

**The hosted clients.** Every desktop call goes through `accountCall`
(`packages/features/src/account-call.ts`, over Effect's `HttpClient`): a
`{ method, path, body }` request, a credential read fresh per attempt
(account bearer, session bearer, fixed key, none), one renew-and-retry on a
401, a deadline, and an answer that never throws. Paths come from
`service-paths.ts` (about 70 builders). Each resource has a hand-written
client (`coding-agent-client.ts` 1071 lines, `task-client.ts` 848,
`workspace-client.ts`, `integration-client.ts`, `issue-client.ts`,
`automation-client.ts`, `github-connection-client.ts`,
`factory-world-client.ts`, `mac-command-client.ts`, `terminal-client.ts`,
`analytics/sender.ts`, and `packages/host/src/account-preferences-client.ts`),
each with its own copy of `readAnswer` and a `REFUSALS` table mapping slugs
to domain failures. All are built in `packages/host/src/compose-host.ts`. The
web pages `fetch` a few paths directly (`apps/web/src/accept-invitation.tsx`,
`connect-github.tsx`, `admin/*`). Tests fake the server at the `HttpClient`
layer with `fakeCloudApi({ "GET /api/issues": … })`
(`packages/wire/src/testing/cloud-fake.ts`).

**The desktop bridge.** The renderer reaches main over Electron IPC through
one manifest, `BRIDGE` (`packages/host/src/bridge.ts`): 2 invokes, 7 sends,
24 pushes from main. Almost all of the work rides one invoke, `app:act`,
carrying `{ kind, payload }` for **159 act kinds** (`ACT_KIND`, `ACT` in
`packages/host/src/acts.ts`), each with a payload schema, a hand-written
result guard and a refusal sentence. `createActRouter`
(`packages/host/src/act-router/router.ts`) runs the row and answers a
never-throwing `ActOutcome`. Rows live in `act-router/*-acts.ts` and
`apps/desktop/src/main/ipc/*-acts.ts`. Behind the acts sits the in-process
**Gateway** (`packages/gateway`, 147 methods, no transport), whose handlers
call the hosted clients.

## 2. What oRPC gives us, and its cost

- **One contract per procedure** (`oc.route({ method, path }).input().output().errors()`),
  read by the server's `implement(contract)` and the client's types. Today
  the server endpoint, its path constant, its schema and its client are tied
  only by convention.
- **Effect Schema as is.** `@orpc/experimental-effect`'s input-output
  extension takes an Effect Schema in `.input` / `.output`, so "a wire value is
  declared once" (`packages/AGENTS.md`) holds and the goldens under
  `packages/features/fixtures/json-schema/` do not move.
- **Effect handlers.** `.effect(function* …)`, `middlewareGen`,
  `WithEffectContext` (the request's services passed as `effect/context`),
  `createEffectClient` (each procedure a lazy Effect, interrupt aborts the
  call), typed errors through `.errors()`.
- **Adapters for both our transports:** `OpenAPIHandler` / `OpenAPILink` over
  fetch for the service, and `RPCHandler` / `RPCLink` over a `MessagePort`
  for Electron.

The cost: **that Effect integration exists only in oRPC 2.0, which is in
beta** (`2.0.0-beta.44`, 2026-10-16; `latest` is `1.15.7`, which has no
Effect v4 integration). `@orpc/experimental-effect@2.0.0-beta.44` peers on
`effect >=4.0.0`, so it accepts our pinned `4.0.4`. See D1.

## 3. Decisions

Decided by Charles Pan on 2026-10-18: each as recommended below.

- **D1. Version.** Pin `@orpc/{contract,server,client,openapi,experimental-effect}`
  at exactly `2.0.0-beta.44` in the pnpm catalog, moved deliberately like
  `effect`. *Alternative:* oRPC 1.x with hand-written Effect glue (a promise
  edge per handler, which `no-run-promise-outside-edges` would have to list).
- **D2. Wire format stays byte-compatible.** Use `OpenAPIHandler` with the
  paths and methods the clients call today, the success bodies as they are,
  and an error encoder that answers `{ error: slug }` with today's status.
  Released desktop builds keep working against a migrated service, the
  service can migrate a resource before its client does, and
  `fakeCloudApi`'s `"METHOD /api/path"` tables keep working. *Alternative:*
  oRPC's own `RPCHandler` protocol, which needs every desktop in the field
  upgraded in lockstep and a second endpoint kept for old builds.
- **D3. Scope of "fully".** In: the 100 JSON routes (held reads included,
  kept as long-held procedures, not event iterators, so the wire does not
  change), their clients, the browser pages' calls, and the desktop's
  `app:act` bridge and its 24 pushes. Out, staying as they are beside the oRPC
  handler: the 2 WebSockets (byte pipes over a third party's protocol and
  meaningful close codes), the terminal `MessagePort` streams (byte streams
  with ack flow control), the 15 external-shape routes, the eve agents' tools
  (the model is the caller; there is no transport), and the third-party uses
  of `accountCall` (PostHog, Keyframe, OpenAI).
- **D4. The Gateway.** Leave it. It is an in-process method table with no
  transport, and oRPC would add serialization it deliberately avoids.
  Folding it into the act layer is a separate refactor, worth its own
  proposal. *Alternative:* port it to an in-process oRPC router (`call()`), or
  remove it in this rollout.

## 4. The shape after the rollout

**Contracts** live in `packages/features/src/contract/`, one module per
resource (`issues.ts`, `tasks.ts`, …), each exporting a plain object of
procedures, and `contract/index.ts` merging them into `hostedContract`. A
procedure names its public path with `{param}` segments
(`/api/plans/{id}/board`), its method, its Effect Schema input and output from
the existing `*-wire.ts` modules, and the refusals it can answer, from one
shared `.errors()` map built from `HOSTED_API_ERROR`. `contract/` is a
subpath door of its own, so the panel bundle never resolves the server.

**The server** lives in `packages/service/src/orpc/`:

- `base.ts`: `implement(hostedContract)` with
  `WithEffectContext<WebServices>`, and the three caller middlewares
  (`account`, `bearerOnly`, `session`) wrapping today's resolvers, which add
  `userId` (and the session headers) to the context or fail `INVALID_TOKEN`.
- `errors.ts`: the encoder writing `{ error: slug }` with
  `HOSTED_REFUSAL_STATUS`, and an `effect/wrap` turning a `HostedRefusal` in
  an Effect's failure channel into the declared oRPC error, so endpoint bodies
  move over nearly unchanged. A refusal is not always a bare slug:
  `repositoryNotReachable` (`packages/service/src/http/http-effect.ts`) adds
  an `unreached: { reason, repository }` that `repositoryNotReachableSchema`
  (`packages/features/src/repository-reach-wire.ts`) reads for the failure's
  remedy. Each such refusal is declared with its extra fields as the oRPC
  error's `data` schema, and the encoder writes them beside `error`, at the
  top level, exactly as today.
- `router.ts`: the implemented resources merged into one router.

Each resource's implementation lives beside its old `*-app.ts` as
`*-procedures.ts`, its handlers `.effect(function* …)`, until its `*-app.ts`
has no routes left and is deleted.

**The web shell** gets `apps/web/server/orpc-route.ts`: one `Route` whose
`fetch` runs `cookieOriginGuard`, then `OpenAPIHandler.handle` with
`effect/context` read once per instance through `runWeb`, exactly as
`route-effect.ts` does today. It is a runtime edge, listed in
`tools/anti-slop/effect-edges.json`. Until the routing collapse (W20), a
migrated route file exports this route, and its rewrite must carry the whole
public path in `?route-path=` (the auth catch-all's mechanism in
`function-dispatch.ts`), so the oRPC handler matches `/api/issues/abc` rather
than the flattened `/api/issues/issue?id=abc`. Today's generator does not do
this: a `SEGMENT_REWRITES` row in `function-rewrites.ts` forwards its
segments only as query parameters, so regenerating alone leaves a migrated
parameterized route answering 404. W1 adds the mechanism: a segment rule
marked as oRPC emits `route-path` built from the captured segments (and
still emits the old query parameters, harmlessly), and the generator's tests
drive a parameterized oRPC route end to end through rewrite, dispatcher and
handler.

**The client** gets `packages/features/src/hosted-link.ts`: an `OpenAPILink`
whose `fetch` is `accountCall`'s `send`, so the credential, the 401 renew,
the holder check, the deadline (per procedure, through the link's context),
and the `HttpClient` layer the tests fake all stay as they are; wrapped in
`createEffectClient`. A resource client becomes the contract's client plus
the mapping from declared errors to its domain failures; the hand-written
paths, `readAnswer` copies and request building go.

**The desktop bridge** gets an oRPC `RPCHandler` over a `MessagePort`: the
preload asks main for a port once per window, main upgrades it in
`apps/desktop/src/main/bridge-host.ts` (still the one renderer-to-main door
`repository-checks.sh` allows), and the panel's `act()` door becomes a
`RPCLink` client. The contract lives in `packages/host/src/contract/`, one
module per act domain, with Effect Schema payloads and results replacing the
`WireGuard` result guards. The context carries `ActSender` and the
`trustedSender` check. A refusal is a declared `REFUSED` error carrying the
sentence the act's `refusal` names today, and an unknown act cannot be
spelled. The 24 pushes become event-iterator procedures the renderer
subscribes to.

## 5. Rules for every PR

- Wire stays byte-compatible (D2): same paths, methods, statuses, bodies. A
  golden under `packages/features/fixtures/json-schema/` does not change;
  if one must, stop and ask the orchestrator.
- The behavior tests stay and pass unchanged where they assert what a caller
  observes; a test of wiring a behavior test already covers is deleted and
  the PR says which test covers it (root `AGENTS.md` "Testing"). Each
  migrated resource adds one test through the oRPC route proving a refusal's
  status and body match the old ones.
- A resource PR migrates its server procedures and its client together,
  deletes the old `HttpRouter` endpoints and client code it replaces, marks
  each migrated parameterized route's `SEGMENT_REWRITES` row as oRPC (W1's
  mechanism, §4) and tests one of them through the rewrite and dispatcher,
  and regenerates `apps/web/server/api-rewrites.json` and `vercel.json` with
  `pnpm --filter @luke/web functions:rewrites`. On a rebase conflict in a
  generated file, regenerate rather than merge by hand.
- A refusal carrying more than its slug (`unreached` today) keeps its extra
  fields, declared as the error's `data` (§4); the PR that migrates a route
  answering one tests that refusal through the route, read by the client.
- Shared files many PRs touch (`contract/index.ts`, `orpc/router.ts`,
  `features/src/index.ts`, `service-paths.ts`, `compose-host.ts`): add one
  line per resource, in alphabetical order, so conflicts stay trivial.
- `AGENTS.md` changes only with the developer's explicit approval: W21 and
  B9 propose the text in their PR description and ask.
- `pnpm check:affected` exits 0 before every push; the bundle budget and
  `function-externals.json` are re-recorded only where the PR says why.

## 6. The PRs

### Web track

**W1 — feat(service,web): oRPC foundation and `/api/models` on it.** Add the
five packages to the catalog at `2.0.0-beta.44` (D1) and declare them where
used. Build `features/src/contract/` with the shared errors map and the
`models` procedure; `service/src/orpc/` (`base.ts`, `errors.ts`,
`router.ts`); `apps/web/server/orpc-route.ts` as a runtime edge; move
`/api/models` onto it, its rewrite carrying `route-path`. Teach
`function-rewrites.ts` the oRPC segment rule (§4), proven by a test of a
parameterized procedure through rewrite, dispatcher and handler, since
`/api/models` has no segment. Build the encoder's `data` path for refusals
with extra fields, proven with `repository-not-reachable` and its
`unreached`. Confirm in the PR: Effect 4.0.4 Schema works with the
extension, the function bundle's isolation load test passes, the externals
and bundle budget. Acceptance: `/api/models` answers byte-for-byte what it
did (success, 401, 405), proven by a test through the route; `knip`, effect
edges and repository checks pass.

**W2 — feat(features,host): the hosted oRPC client over `accountCall`.**
`hosted-link.ts` as §4 says, with per-procedure deadlines; switch the
`/api/models` call in `coding-agent-client.ts` to it. Acceptance: the 401
renew, holder change, no-credential and deadline cases of
`account-call.test.ts` hold through the link; existing client tests pass
over `fakeCloudApi` unchanged. Based on W1.

Each PR below migrates the named routes, server and client, as §5 says. All
are based on W2 and independent of each other.

- **W3 — issues, factory, dictation, pins, sections:** `issues`,
  `issues/issue`, `factory/world`, `dictation`, `repository-pins`,
  `task-sections`.
- **W4 — automations:** `automations`, `automations/automation`,
  `automations/run`, `automations/runs` (`automations/webhook` stays).
- **W5 — integrations:** `account/integrations` and its `connect`, `tools`,
  `cancel`, `disconnect`, `rename` (`connected` stays).
- **W6 — account:** `account/preferences`, `account/provider-keys`,
  `account/plan-template` and its `revisions`, `revision`, `restore`,
  `account/delete` (and its caller in `packages/credentials/src/account/client.ts`),
  `packages/host/src/account-preferences-client.ts`.
- **W7 — GitHub:** `github/connect`, `github/connect/claim` (and
  `apps/web/src/connect-github.tsx`), `github/connection`,
  `github/disconnect`, `github/repositories` and its `tree`, `skills`,
  `pull-request`, `issue` (install, installed, webhook stay).
- **W8 — workspaces core:** `workspaces`, `rename`, `transfer`, `leave`,
  `photo/set`, `members`, `members/remove`, `members/role` (`photo` bytes
  stay).
- **W9 — workspace invitations and links:** `invitations`,
  `invitations/cancel`, `invitations/offer` (and
  `apps/web/src/accept-invitation.tsx`), `github/connect`,
  `github/disconnect`, `linear/connect`, `linear/disconnect`, `linear/issues`
  (`linear/connected` stays).
- **W10 — plans core:** `plans`, `plans/plan`, `edit`, `board`,
  `revisions`, `revision`, `restore`, `transcript`, `work`.
- **W11 — plan files and pages:** `plans/code`, `file`, `tree`, `skills`,
  `attachments`, `pages`, `page` (`plans/attachment` bytes stay).
- **W12 — plan comments:** `plans/comments` (held), `plans/comment-thread`.
- **W13 — agents core:** `agents`, `agents/agent`, `stop`, `changes`,
  `review-options`, `sandbox-resume`, `terminals`, `terminal`,
  `plans/agents`, and `terminal-client.ts`.
- **W14 — agents pull request:** `agents/pull-request`,
  `pull-request-action`, `pull-request-viewed`, `overview-pull-request`,
  `overview-checks`, `overview-conversation`.
- **W15 — held message reads:** `agents/messages`,
  `agents/subagent-messages`, `plans/messages`, `plans/subagent-messages`,
  `workspaces/chat`. Kept long-held JSON (D3); the held deadline (35 s)
  moves to the procedure's link context.
- **W16 — inbox:** `inbox`, `inbox/item`, `inbox/messages`, `inbox/read`,
  `plans/inbox`, `agents/inbox` (`inbox/attachment` bytes stay).
- **W17 — mac commands and events:** `mac-commands` (held, bearer only),
  `events` (`analytics/sender.ts`).
- **W18 — admin:** `admin/day`, `favorite`, `metrics`, `user`, `users`, with
  a browser oRPC client (cookie, no `accountCall`) for `apps/web/src/admin/`;
  the admin gate becomes a middleware.

**W19 — test: retire per-path fakes where the contract covers them.**
Optional; only if W3–W18 left `fakeCloudApi` tables that a contract-typed
fake would make shorter. Skip if not.

**W20 — refactor(web): one oRPC function route, fewer rewrites.** Once
every JSON route is oRPC: the oRPC route matches its public paths itself, so
the segment rewrites of **migrated** routes and their route files go, and
one fallback rule sends what is left of `/api/*` to it. The segment rules of
the external-shape routes stay, since their public URLs have variable
segments a literal rule cannot carry (`/api/automations/:id/webhook`,
`/api/plans/:id/attachments/:attachment`, `agents/picture`,
`inbox/attachment`, `workspaces/photo`, …), and they stay ordered before
the fallback so it never shadows them. `function-bundles.ts`,
`function-dispatch.ts`, `function-layout.ts` and `function-rewrites.ts` keep
the 15 external routes, the two WebSockets and the sweep; a test proves every
external route's public URL, parameterized ones included, still reaches its
handler. `api-callers.ts` is replaced by a check that every client path
outside the contract still resolves (the external routes, the WebSockets).
`preview-probe.ts` probes the contract's procedures. Based on all of W3–W18.

**W21 — refactor: delete what the contract replaced.** The emptied
`*-app.ts` groups, `service-paths.ts` builders no caller spells, the
per-client `REFUSALS` and `readAnswer` copies, `HostedRefusal` plumbing the
encoder no longer needs. Propose the `apps/web/server/README.md` and
`AGENTS.md` wording (route layer, runtime edges) and ask before changing
`AGENTS.md`. Based on W20.

### Bridge track (D3; independent of W2–W21)

**B1 — feat(desktop,host,panel): oRPC over a MessagePort for acts; issue
acts on it.** The port handshake in the preload and `bridge-host.ts`; the
`RPCHandler` with `ActSender` context and the `REFUSED` error; Effect rows run
on the desktop's runtime through `effect/context` (edge listed); the panel's
`act()` door routes migrated domains to the `RPCLink` client and the rest to
`app:act`. Move `issue-acts.ts` onto it. Rewrite the `repository-checks.sh`
rule so `bridge-host.ts` stays the only file that opens a renderer door,
port upgrade included. Acceptance: the issue acts' tests pass through the
port; a refusal reaches the panel as the same sentence. Based on W1 (for the
catalog), not on W2.

Then, each based on B1 and independent of each other:

- **B2 — account and settings acts** (`account-acts.ts`, `settings-acts.ts`).
- **B3 — automation, integration and factory acts.**
- **B4 — task acts** (`tasks-acts.ts`).
- **B5 — coding-agent acts** (`coding-agent-acts.ts`).
- **B6 — main's own acts** (`apps/desktop/src/main/ipc/`: avatar, terminal,
  mac-terminal, voice-runtime). The terminal `MessagePort` streams
  themselves stay (D3).
- **B7 — the 24 pushes as event iterators**, replacing `BRIDGE`'s subscribe
  entries and `ipcRenderer.on`.

**B8 — refactor: retire `app:act`.** Delete `ACT`, `ACT_KIND`,
`createActRouter`, `ActOutcome` and the `app:act` and remaining `BRIDGE`
entries the port replaced; `BRIDGE` keeps only what does not ride the port
(the devtrace send, if B7 left it). Based on B2–B7.

**B9 — docs: the bridge's new shape** in the host and panel READMEs; ask
before changing `AGENTS.md`. May fold into B8.

## 7. Dependency graph

```
main ─ W1 ─┬─ W2 ─┬─ W3 … W18 (16 in parallel) ─ W20 ─ W21
           │      └─ (W19, optional, after W3–W18)
           └─ B1 ─┬─ B2 … B7 (6 in parallel) ─ B8 ─ (B9)
```

W1 and B1 are each the base of a tree. Workers for W3–W18 and B2–B7 start
once W2 or B1 has merged, from `main`, rather than stacked: sixteen siblings
stacked on one unmerged PR would mean sixteen restacks for every fix to it.
About 30 PRs in all.

## 8. Risks

- **A beta dependency** under every request (D1). Mitigation: the exact pin,
  and W1 proving the pieces we use before anything else depends on them.
- **Byte compatibility** (D2) rests on the error encoder and on `OpenAPIHandler`
  serializing as `hostedJsonResponse` does (`cache-control: private,
  no-store`, no extra keys). W1's tests pin it before W3–W18 copy it.
- **Held reads** must not be cut by an oRPC or Vercel default timeout; W15
  and W12 test one held past its old deadline under `TestClock`.
- **Bundle size**: oRPC enters both the function bundle and the renderer;
  W1 and B1 record the delta in their descriptions.
- **Parallel conflicts** in generated rewrites and the shared index files
  (§5).
