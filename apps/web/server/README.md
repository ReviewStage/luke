# Luke web server

## Database and auth workflow

Neon is provisioned through the Vercel integration. It supplies the pooled
`DATABASE_URL` for application traffic and `DATABASE_URL_UNPOOLED` for
migrations; the connection strings live nowhere in this repository. A table is
declared twice and in two languages: once in the hand-written migration that
builds it, and once in the `server/db/*-schema.ts` module the query builder
reads it through. "The data layer" below is what holds the two together.
Better Auth is no exception, reaching its tables through its Drizzle adapter
over `server/db/auth-schema.ts` (see below), which is in the same barrel as
the eleven Luke-owned modules, so a migration that changes an auth column's type
changes that declaration too.

Every instant column is `timestamp with time zone` (migration 0026 moved the
last naive ones), so a JavaScript `Date` round-trips losslessly whatever zone
the host or the session sits in; `bigint` epochs stand where a table already
kept them. `tests/instant-columns.test.ts` reads `information_schema` on both
dialects and refuses any `timestamp without time zone` column, so a new table
declares `timestamptz` or fails the store tests.

For a new table or a changed one, write the migration by hand under
`drizzle/` (a plain SQL file plus its `meta/_journal.json` entry, the shape
`drizzle-kit` used to generate before this migration off it; the directory
name is what stands from that era and is not itself a dependency on the
package), fold the change into the `server/db/*-schema.ts` module that
declares the table in the same commit, and add whatever query modules under
`server/` need it. Dropping a column means deleting it from that module: the
drift check reads the database both ways, so a declaration the database no
longer carries fails it exactly as a column no module declares does. It takes
two deployments, because a build migrates while the deployment before it still
serves and Drizzle names every declared column in an insert: the first deletes
the declaration and lists the column in the drift check's `PENDING_DROP`, and
the second, once the first is live, drops it with `DROP COLUMN IF EXISTS` and
deletes the entry.

Vercel runs `pnpm db:migrate` before every deployment build, using the direct
connection Neon supplies for that deployment. The runner holds a PostgreSQL
advisory lock for the migration session, so overlapping builds targeting one
branch cannot apply the same migration concurrently.

What applies them is `effect/unstable/sql`'s own migrator: `server/db/effect-migrator.ts`
reads `drizzle/meta/_journal.json` and the `.sql` file each entry names, in
order, and records what it applied in its own `effect_sql_migrations` table
rather than `drizzle.__drizzle_migrations`, which a database an older
Drizzle-based runner had already migrated is bootstrapped from once rather
than migrated again: that runner stamped every row it wrote with the journal
instant of the migration it had just applied and refused anything at or below
the greatest instant it found, so that greatest instant is read, every journal
entry at or below it is recorded as applied, and the copy runs only into an
empty table, which is what makes a second deploy a no-op. The Neon integration
creates a database branch for each Preview deployment, so its committed schema
changes are applied to the matching branch before Vite builds the application.
No package lifecycle hook runs migrations.

The auth service also needs `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`,
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_ID`, and
`GITHUB_CLIENT_SECRET`.

The web service's `routes` in `vercel.json` carry a legacy entry for
`/api/auth/(.*)` because Vercel's zero-config `api/` detection treats
`[...all].js` as a single dynamic segment and adds a hard 404 for deeper API
paths. A `rewrites` entry runs after that detected filesystem routing phase, so
it cannot reach the Better Auth handler; keep this rule in `routes`, ahead of
the detected routes.

Each deployment build runs `pnpm auth:seed` after the migration and before Vite,
so every database the application reaches already carries the clients, including
the branch database Neon creates for a Preview deployment, which would otherwise
be migrated but empty. The Drizzle seed is idempotent, upserting each public
OAuth client compiled into Luke, which is what makes running it on every build
safe. The same step then deletes every JWKS signing key the deployment's
`BETTER_AUTH_SECRET` cannot open (`dropUnreadableJwks`): Better Auth seals a
private key under the secret of the deployment that minted it and fails the
whole token exchange when the latest key will not open, and a Preview's branch
database arrives carrying production's key under a secret a Preview never
holds, so without this every desktop sign-in against a Preview ended at the
token endpoint. Production's own key opens under its own secret and is left
standing. To apply the seed by hand against production:

```sh
vercel env run --environment production --scope stage-review -- \
  pnpm --filter @luke/web auth:seed
```

Better Auth runs on its Drizzle adapter over `server/db/auth-schema.ts`
(`server/auth-database.ts`), not its Kysely one: the migrations declare the
OAuth tables' `scopes`, `redirect_uris`, `grant_types`, and `response_types`
as `text[]`, which the Drizzle adapter writes as native arrays and the Kysely
adapter as JSON strings Postgres refuses. `auth-database.test.ts` writes an
access token through the adapter over PGlite to hold the two together.

Dynamic client registration stays disabled. One public client is compiled in:
**`luke-desktop`** (`server/oauth-clients.ts`), the macOS companion app. It
accepts loopback callbacks (`http://127.0.0.1/callback`) via a local HTTP server
during sign-in, holds no client secret, requires PKCE, and skips consent as a
trusted first-party app.

Google's callback is `${BETTER_AUTH_URL}/api/auth/callback/google`; GitHub's is
`${BETTER_AUTH_URL}/api/auth/callback/github`. The GitHub provider requests
`user:email`, because Luke requires an email address for its account snapshot.

Every function Vercel deploys is plain ESM. The route sources live under
`server/routes/`, and `scripts/bundle-functions.ts` bundles them into
`dist-functions/**/*.js` (gitignored) as the last step of `pnpm build`, each
bundle inlined whole: the workspace packages and every declared runtime
dependency alike, so a function carries what it loads and nothing is left for
a tracer to find. Handed TypeScript, the builder compiled every function's
whole import graph separately, and those thirty-odd passes were most of a
deploy's build time. Nothing is committed under `api/`: the functions Vercel
deploys are the ones the Build Output tree below emits, and a file under
`api/` would be built by Vercel's zero-config pass beside that tree, two
builders claiming one path. A function's public path is still
`api/<function>.js` (`functionPublicPath` in `server/function-layout.ts`),
because that is the `.func` name in the tree and the destination the `/api/`
rewrites of `vercel.json` carry. Those rewrites are generated into a committed
table, `server/api-rewrites.json`, and `vercel.json` is assembled from the
table: `pnpm functions:rewrites` regenerates both after adding, moving, or
removing a route, and `repository-checks.sh` refuses drift on either half. The
same script reads the other side of the table through `scripts/api-callers.ts`
(`server/api-callers.ts`): every `/api/` literal and path builder a client in
the repository spells — the desktop's, the packages', the
scripts' — and the exports of `@sidecar/hosted`'s paths module, evaluated, must
resolve to a rewrite of the table or to an extensionless alias the Build Output
emits, and a builder the check cannot read is refused by name rather than
skipped, because a path constant that outlives its route otherwise fails
nothing until production answers 404 (LUKE-186). The same derived list is
what `scripts/preview-probe.ts` (`server/preview-probe.ts`) sends to a
deployment: every caller path, the cron's, the page, and eve's health, failing
on any answer that is Vercel's own rather than a handler's — the
`x-vercel-error` header the platform puts on its `NOT_FOUND`, which a
function's own 404 never carries — with seven of those requests held to
their exact codes besides, because on 2026-09-11 five production deploys
failed in a row while nothing in CI could see the deployed shape (LUKE-164).
Behind Deployment Protection it needs one of two doors, the bypass secret
sent as a header or the OPTIONS allowlist, and names which it relies on.
CI's Preview probe job (`.github/workflows/preview-probe.yml`) runs it
against a PR's own preview, found through the head commit's GitHub
deployment record (`server/preview-deployment.ts`), once the repository
variable `PREVIEW_PROBE_DOOR` names the door; until then the job does not
run, since a check that cannot see the deployment would be green over
nothing. The
table is its own file so a `vercel.ts` can one day import it and `vercel.json`
be deleted (LUKE-183); Vercel evaluates a config module in plain Node and
bundles only its relative imports, which takes a JSON table and not this
generator's dependencies. `server/feedback.mjs` is the one
hand-written function, emitted into the tree at `api/feedback.mjs` as it
stands.

Three specifiers stay outside every bundle, named in
`INLINE_EXCEPTION`: `pg-native`, which `pg` tries before its JavaScript
client, and `bufferutil` and `utf-8-validate`, the two native accelerators
`ws` tries before its own; each is a guarded optional `require` esbuild would
leave external anyway, and naming them is what lets the record below say
exactly these and refuse a fourth. Every bundle opens with a `createRequire`
banner, because esbuild turns a CommonJS `require` inside an inlined
dependency into a shim that throws in ES module output unless a `require` is
in scope, and `pg` asks for `events` that way: without the banner every
function loads here and fails on production, which the isolation guard below
is what caught.

Each bundle's external imports are recorded in `server/function-externals.json`,
generated by `pnpm functions:externals` and compared as data: the test bundles
every function unwritten and asserts the whole map, and the bundle step refuses
to ship a bundle whose externals differ from the record, naming the bundle, the
added or removed package, and the import chain from the entry to the module
that carried it. Under inline-first bundling the map holds Node's builtins and
the three exceptions, and the signal it keeps is a fourth external appearing.
Reachability is a different check and reads a different field: `bundlesReaching`
walks the metafile's inputs for the specifier a module wrote, so an import
esbuild inlined counts exactly as one it left external. A guard over externals
alone would have gone blind the moment the dependencies were inlined, since a
reached package then appears in a bundle's inputs and never in its externals;
the inputs form catches the edge under either strategy, and the negative test
adds the value import and asserts the guard names the bundle and the chain
while the externals do not move. The eve package and any other entry of
`FORBIDDEN_FUNCTION_EXTERNALS` may appear in no bundle at all.

The build's last step, `server/build-output.ts`, writes the Build Output tree
Vercel deploys: `.vercel/output/config.json` (version 3), the site under
`static/`, and one `functions/api/<name>.js.func/` per function holding its
bundle as `index.mjs` beside a `.vc-config.json` that names it as `handler`
under the Node launcher with `shouldAddHelpers`, the fields Vercel's own Node
builder writes (`packages/node/src/build.ts`), and the plan's `maxDuration`.
When that tree exists `@vercel/static-build` adopts it as the deployment's
final form instead of serving `dist/`, so this build decides the deploy shape
on every preset: under Vite today, and as the `web` service of a services
deployment, where Vercel builds no `api/` at all (the `api_dir_ignored` warning
of `get-services-builders.ts`), which is the shape that would otherwise serve
a site whose every API route is 404. The `.func` is a mount: what is under it
deploys and nothing above it does, which is why the bundles are inlined whole
and why `tests/build-output.test.ts` holds two claims apart. Structure: every
planned function has a `.func` carrying the plan's configuration and every
`/api/` rewrite names one that exists. Isolation: each `.func` loads with
nothing above it on disk, given only a database URL that connects to nothing,
which is how the platform mounts it. The routes are unchanged byte for byte:
a `.func` named `api/default.js.func` answers at `/api/default.js`, the path
the rewrites already carry. Each function is also emitted at its extensionless
path, as a `.func` that is a symlink onto the first, because Vercel's own pass
served both spellings and the clients use the second: the voice sessions open
at the `VOICE_SERVICE_PATH` path and the desktop posts feedback to
`/api/feedback`. Reverting the PR that introduced the tree is one
commit with no migration and no dashboard state, and the deploy shape returns
to Vercel's own pass.

The Vercel project is two services in one deployment, declared under `services`
in `vercel.json`, which Vercel reads only while the project's Framework Preset
is Services. `web` is this app at its root and carries the migrate-and-seed
build, the install filter, the ignore rule, and the `routes` above unchanged.
`eve` is the hosted brain: its root is `eve/`, the flat eve app root described
below, whose own `package.json` declares `eve`, so the service's install pulls
`@luke/eve` beside this app and its build is a plain `pnpm exec eve build` run
in that root. eve resolves that directory as its app root and writes its Build
Output there, which is where static-build reads a service's output, so nothing
relocates it and no variable of eve's own is set by hand. The block is one
isolated declaration with no shared keys, so replacing it with a generated
service later is removing a block rather than untangling one (LUKE-183).
Public routing is the top-level `rewrites`:
`/eve/v1/*` enters the eve service and everything else the web service, and a
service's own routes run only once a request has entered it. That is why the
generated `/api/` rewrites live under the web service's `routes` and the
generator (`server/function-rewrites.ts`) refuses a `routes` key at the top
level beside `services`: Vercel ignores one there rather than erroring, so a
file generated into the old location would pass every check and 404 every
`/api/` route in production. The project's
environment variables reach both services alike, and each service's own
`ignoreCommand` is what skips its build, so a commit that changes nothing under
`apps/web`, `packages`, or the workspace manifests deploys neither.

## The data layer

Drizzle is the statement layer and nothing else. A query module builds its
statement with the query builder over the tables its own
`server/db/*-schema.ts` module declares, and `server/db/drizzle.ts` — the
bridge ported from `@effect/sql-drizzle`, named in root AGENTS.md as a
permanent adaptor — renders it and runs it on the `SqlClient` the asking fiber
already carries. So a module still answers `Effect<A, SqlError |
Schema.SchemaError, SqlClient>`, a bridged statement lands inside whatever
`client.withTransaction` encloses it rather than beside it on a second
connection, and one module still runs on both dialects. Only
`server/db/effect-migrator.ts` is raw by design: its six statements are
dialect metaprogramming over the journal rather than domain queries. A tagged
template anywhere else is a leftover, not a pattern.

`server/db/query.ts` holds the one shared handle, `db`, built at module scope
and imported wherever a statement is spelled. There is nothing per-module or
per-request to build: the handle carries no connection, no client, and no
context — it reads the `SqlClient` out of the fiber that yields the statement
— so one serves every request and both dialects at once and two callers have
nothing to contend over. It takes no `schema` config, because nothing reaches
Drizzle's relational queries: the tables a statement names are named imports
from their own module (`import { plan } from "../db/plan-schema.js"`), never
the barrel and never a bare specifier,
which is both what makes a renamed column a type error at the call site and
the import `tests/store-writer-boundary.test.ts` resolves.

The builder hands back the statement's rows, not a guarantee about them, so a
row is still decoded by a `Schema`. `SqlSchema`'s `execute` takes the builder
itself — a patched builder already is the `Effect<rows, SqlError, SqlClient>`
that `execute` wants — so no wrapper stands between them:

```ts
const findPlans = SqlSchema.findAll({
  Request: Schema.String,
  Result: PlanRowSchema,
  execute: (userId) =>
    db
      .select(PLAN_COLUMNS)
      .from(plan)
      .where(eq(plan.userId, userId))
      .orderBy(desc(plan.createdAt), desc(plan.id)),
});
```

A projection names its own fields, so a result schema is spelled in the same
camel case the rest of its module is and no `Schema.encodeKeys` stands between
them; that mapping existed only because raw SQL answered `created_at`.
`EpochMillisColumnSchema` and `InstantColumnSchema` stay all the same, since
they reconcile `pg` reading an `int8` as a string against PGlite reading it as
a number and the builder does not close that split. Where Postgres has
something the builder cannot spell — `starts_with`, `collate "C"` — the
fragment is Drizzle's own `sql` inside the builder, still one rendered
statement with its parameters bound by Drizzle, and it is named as a module
constant so the query reads as the query it is. A transaction and a row lock
are the client's own `withTransaction` and a `.for("update")` select inside
it, unchanged.

`drizzle-kit` is not a dependency and no migration is generated from a schema
module. Migrations stay hand-written SQL under `drizzle/`, applied by the
Effect migrator above, and the modules are hand-maintained beside them:
`drizzle/meta/` holds snapshots for `0000`–`0025` alone, from the era when the
modules were `drizzle-kit`'s input and the migrations its output. What stands
in for that lost loop is `tests/drizzle-schema.test.ts`, which compares the
barrel against the `information_schema` of a database `runWebMigrations` has
just built — PGlite in process, or the Postgres `LUKE_STORE_TEST_DATABASE_URL`
names on CI — in both directions over the whole public schema: a column a
module declares and the database has not fails, and so does a column the
database has and no module declares, which is the direction that catches the
migration nobody folded in. Name, type, nullability, and primary key are
compared; defaults, indexes, foreign keys, and the `$type<>()` unions are not.
Those unions name no Postgres type and are the compile-time claim the whole
restoration was for — a text column read back as its own vocabulary rather
than cast by hand under a `// SAFETY:` comment — so the module itself is the
only thing that holds them.

## Where a function runs an Effect

`server/runtime.ts` holds the one `ManagedRuntime` this app has, memoized at
module scope, and `runWeb(effect)` is the only place `apps/web` runs an effect.
Vercel keeps a warm instance's module registry between invocations, so the
first invocation of a cold start builds the layer and every later one on that
instance reuses the services it built; a runtime built where the work lives
would be a second copy of every service a `Context.Service` was supposed to
identify. Root AGENTS.md's "Effect idioms" section names this edge with the
process's others.

The layer carries what a Vercel function's own platform already offers: an
`HttpClient` over `fetch`, and the `SqlClient` of `server/db/sql-client.ts` over
the database `DATABASE_URL` names. `@effect/platform-node` is not on it, and
`repository-checks.sh` refuses that specifier and `effect/unstable/sql` in the
renderer, where there is no Node; a function inlines its whole graph and the
isolation guard proves it loads. The layer itself is behind
`server/`, which is what the builder traces. A function is handed no shutdown
hook — an instance is frozen between invocations and discarded without notice —
so nothing in production disposes the runtime; `disposeWebRuntime()` exists so a
test can end the one it started.

The `SqlClient` is `PgClient.layer` over the connection string `DATABASE_URL`
names, its pool held to the same `POOL_LIMITS` the `pg.Pool` behind Better
Auth's Drizzle adapter is built to, one connection per warm instance, so the
two pools on the one database cannot drift apart on how much of Neon's pooler
a warm instance holds. The layer opens nothing while it builds: the pool keeps
no minimum and makes its first connection on the first statement, which
matters because this layer stands in the runtime every function shares and an
eager round trip would land on the cold start of the functions that never
query.

Every module under `server/` that reads or writes this database reads the
client out of the fiber it runs on rather than holding one of its own, the
bridged statements of "The data layer" above included, so the edge serving a
request is the one place the client behind it is provided. The hosted store's
query modules are on it, the store writer and the voice writer among them.
Outside `server/hosted/store/`, `server/hosted/plan-store.ts` is on the same
client, and `server/voice/session-record.ts` is on it whole, each of its five methods
answering an effect over the live session row rather than running one.
`VoiceService` yields those five
directly: one upgrade is one `Scope` and one effect run on the `WebStoreRun`
`voice/function.ts` hands it, so the registration, the usage snapshot, and the
close are steps of that effect rather than promises a callback awaited. The
two meters of `server/voice/accounts.ts` — the account's spend and a closed
session's seconds — are on it on the same terms,
so the session yields each on its own fiber and a statement any of them was
refused on ends that session the way its own row failing does, rather than
becoming a rejected promise the service had to catch.
`hostedStore()` takes no argument, and answers an
`Effect<A, SqlError | Schema.SchemaError, SqlClient>` from every method, so
the caller composes a store read into whatever it already runs. A route
group's own seams are effects
over that same ambient client — the account group's reads and writes and the
meter every brain operation spends — so the group yields the seam on the
request's own fiber and the edge that serves the request is the one place the
client behind it is provided. What still holds a runner is everything a route
composes apart from the store and that still hands a promise up — the
writers, the ask record, and the brain host's two seams
the eve project reaches through a promise of its own — each handed its
edge's own, `runWeb` in a
function and the store tests'
runtime in a test; the conversation row lock every write runs under is the
client's own transaction. What the layer does need at build
time is the connection string, so an instance configured without `DATABASE_URL`
is refused at the edge rather than at whichever query ran first.

`effect` and `@effect/sql-pg` are declared dependencies of this app, which is
what leaves them external to the bundles rather than inlined into each of them,
so Vercel's builder traces one copy from `apps/web/node_modules`. `@effect/sql-pg` reaches
`pg`, which is external on the same terms and already was.

A test reads the same client through `tests/support/sql-client.ts`, which
chooses its dialect the way `tests/support/hosted-store-database.ts` does:
PGlite in process, so `check.sh` needs no service, or the Postgres named by
`LUKE_STORE_TEST_DATABASE_URL`, which the CI job points at its service
container. The Postgres half is the production layer's own client; the PGlite
half is a small `SqlClient` over `@electric-sql/pglite`, because no
`@effect/sql-pglite` ships against the 3.x Effect line.

## The bearer's resolution

`server/hosted/bearer.ts` answers effects. `hostedUserId(request, userInfo)`
and `userIdForAuthorization(authorization, userInfo)` each answer
`Effect<string | undefined>`, and a `UserInfoEndpoint` answers
`Effect<OAuthUserInfo | undefined, UnknownException>`: the auth service's own
`oauth2UserInfo` is a promise of Better Auth's, so it is wrapped with
`Effect.tryPromise` once where an endpoint is constructed —
`hostedUserInfo` in `server/hosted/bearer.ts` itself, the brain host's seam,
and the events group's inline one — and nowhere else. What that
call throws is still one indistinguishable nothing: the resolution recovers
it, so a missing header, an expired token, and a refusing auth service are
the same 401 they always were, and no route repeats the recovery.

Every caller yields it. `resolveHostedUserId`, which the account and plans
groups are handed as their `resolveUserId`, and the voice function's own
resolver are Effect-shaped, so each reads the bearer on its own fiber instead
of wrapping a promise in `Effect.promise`. One caller is a
promise of somebody else's: eve's `AuthFn`, which
`apps/web/eve/channels/eve.ts` satisfies by running the resolution once at
that authored file — eve's own edge — rather than keeping a promise-shaped
door beside the effect under `server/hosted/`. `lukeAccount` takes the
resolved account as a `BearerAccount` promise and reaches no userinfo
endpoint of its own.

## A route built from a route layer

`server/route-effect.ts` holds `routeFromHttpRouter(routes)`, which turns the
route layer a group registers its paths with — `WebRoutes<R>`, the same file's
own name for it — into the one fetch handler a function default-exports. It
reads the runtime through `runWeb` and then holds the handler for the
instance's life, so it is a caller of the edge rather than a second one, and a
warm invocation reaches the services the cold one built. A group's routes are
a layer rather than a value because that is what an `HttpRouter` registration
is: the router is a service the layer writes each path into, and the
requirements a route's own handler has travel as request markers the handler
provides per request from the context `runWeb` read. The auth group, the
events and maintenance groups below, the account group's
`server/routes/account/delete.ts` and `server/routes/account/preferences.ts`,
the plans group's four, and the dashboard's five behind the admin group are
converted this way; the voice route alone exports something else, the
`http.Server` described under "Hosted voice service".

`server/hosted/http-effect.ts` is the response vocabulary that conversion
speaks: one schema per refusal, each annotated with the status it answers, and
`readJsonBodyEffect` reading a bounded body off the request stream the way
`readJsonBody` reads it off a `Request`. A refusal is declared as its body
rather than as a `Schema.TaggedError`, because `error` is already the
discriminant the desktop's hosted clients read and a `_tag` beside it would be
a byte they never asked for. `fixtures/hosted-refusal/` records the status,
content type, and body bytes of each one, and `tests/hosted-refusal.test.ts`
holds both shapes to them; `LUKE_UPDATE_FIXTURES=1` records.

## The auth group

`server/auth-app.ts` is the auth route group: Better Auth's own `fetch`
handler on the path set `vercel.json` routes here, and the hosted
vocabulary's `not-found` on any other path, which nothing routes to this
function. The handler is held as a passthrough rather than described as
endpoints — an `HttpApi` declaring them would be a second copy of a contract
Better Auth already versions, and the first to drift would be the one Luke
ships. The request handed over is the very `Request` the function was invoked
with, and the answer travels back as a raw body, so the status, the headers,
every `set-cookie`, and the bytes are the handler's own. Nothing is mirrored
onto the `HttpServerResponse` beside it, because the platform writes such a
record onto the answer's own `Headers` and a redirect's are immutable; a HEAD
is the exception, where that record is all the web handler reads, and there
the status and headers are carried and the body dropped.
`fixtures/auth-route/` records what the group answers for a sign-in, a
provider redirect, an unknown endpoint, a refused method, a HEAD, and a path
outside the group, and `tests/auth-app.test.ts` answers each twice — through
the group and by calling the handler the way the route called it before — and
compares the two.

## The events and maintenance groups

`server/events-app.ts` and `server/maintenance-app.ts` are two route groups of
one path each — `server/routes/events.ts` mounts `eventsApp()` and
`server/routes/maintenance/sweep.ts` mounts `maintenanceApp()` — since
`vercel.json` already sends each function only the requests for its own path.
Each path is declared with `HttpRouter.add` under `ANY_METHOD` rather than a
method-specific builder, because each handler still enforces its own method
and answers its own 405 exactly as it did before conversion; only a path
neither declares reaches the group's own wildcard route, `hostedNotFoundRoute`,
and the hosted vocabulary's `not-found`. Each handler's own logic is carried
unchanged — `server/hosted/events.ts` and `server/hosted/maintenance-sweep.ts` —
behind a passthrough shaped like the auth group's (`effectPassthrough` in
`server/hosted/http-effect.ts`): the `HttpServerRequest` becomes the `Request`
the handler always took, and its `Response` is carried back with
`HttpServerResponse.raw`. `fixtures/events-maintenance-route/` records one
answer per route, a wrong method on a declared path, and a path outside each
group, and `tests/events-maintenance-app.test.ts` answers each twice —
through the group and by calling the handler directly — and compares the two.
`server/events-app.ts` holds one query of its own, the events handler's
PostHog person read (`readPerson`), a `SqlSchema` query whose builder renders
against the auth schema module and runs on the ambient `SqlClient`;
`tests/events-app-queries.test.ts` covers it.

## The account group

`server/account-app.ts` is the account route group: the signed-in desktop's
own delete and preferences endpoints, described as routes of the group's own
rather than carried as a passthrough, because both answer from this
deployment's own database and neither owns a contract of its own the way Better Auth does.
Each endpoint resolves the bearer against the deployment's own account store
before touching anything — root AGENTS.md pins that no credential or account
secret ever travels in an answer — and answers only the boolean or the
snapshot the caller's own account carries. `server/hosted/account-seams.ts` is
the one place that hands the group a real user table and a real preferences
store, so both `api/account/delete.ts` and `api/account/preferences.ts` build
the same group from the same wiring; the reads and the writes themselves are
`server/hosted/account-store.ts`'s effects over the ambient `SqlClient`,
handed to the group as the effects they are rather than run at the seam, and
that store names no database and reaches no auth session, so `tests/hosted-account-store.test.ts`
exercises the erasure's cascade and the snapshot's replacement against a real
dialect; the analytics erasure key and project are
read from `HostedEnvironment` instead, the way the hosted tier's own key is,
and the erasure call itself runs over the ambient
`HttpClient` rather than an injected transport, so nothing in `AccountAppSeams`
carries one — a test provides its own fake `HttpClient` layer instead.
`fixtures/account-route/` records what the group answers for a delete, a read,
a write, a refused method, an invalid token, an invalid body, and a path
outside the group, with `content-length` checked against the body it frames and
then dropped before comparing.

The preferences snapshot carries two parts. `preferences` is the settings
snapshot the desktop syncs, replaced whole by a write that names it.
`codingAgent` is the account's default model and effort for a coding agent —
what a click on Start runs on — as `{ model, effort }` in AI Gateway's catalog
spelling, `anthropic/claude-opus-5.5` at `high` until the account chooses.
Settings › Coding agents and the Start menu's chevron both write it, as one
value rather than two that could disagree. A PUT carries either part or both;
a part left out stands as it was, so the desktop's settings sync never
resets the chosen model and the Start menu never touches the voice. A
`codingAgent` write is accepted only as the instance's model catalog accepts
it (below): a model it does not offer or an effort that model does not list
is `invalid-request`, and a catalog the instance cannot read is `unavailable`.
The store keeps the two columns beside `voice` on `account_preference`, and
reads a half-written pair as the default. `updated_at` is the preferences
part's own instant, nullable since migration 0062 and left null by a write
that carries only `codingAgent`: the desktop reads the answer's `updatedAt`
as a snapshot to apply over its own settings, so a row a choice alone opened
must answer none, or a Mac that never synced would take an empty snapshot
over the voice it holds.

## The models group

`server/models-app.ts` answers `GET /api/models`: the models a coding agent
may run on, as `{ models: [{ id, name, provider, efforts }] }`. The list is
`server/hosted/model-catalog.ts`'s read of AI Gateway's public catalog
(`https://ai-gateway.vercel.sh/v1/models`, no key), Schema-decoded at the
boundary and kept to the Anthropic and OpenAI models whose tags carry both
`tool-use` and `reasoning`; each model's efforts are the `values` of the
`effort` entry among its `reasoning_options`, and a model listing none is
left out, since no Start could name an effort for it. The read is the
`ModelCatalog` service `server/runtime.ts` builds once per instance, cached
for an hour on a success and for no time on a failure, so an outage at the
gateway is retried on the next request rather than answered for the hour.
The bearer is resolved before the read, as every hosted endpoint resolves
it, though the catalog is public and the same for every account.

The same module holds the two functions the coding-agent routes will stand
on: `validateModelChoice`, which accepts a `(model, effort)` only for an
offered model at an effort it lists, and `providerModelOf`, which turns a
catalog id into the id the provider's own API takes — model calls go to
Anthropic and OpenAI directly on Luke's keys, never through the gateway — so
`anthropic/claude-opus-5.5` is `claude-opus-5-5` and an OpenAI id is the
catalog's after its prefix. `tests/model-catalog.test.ts` reads the catalog
through a scripted gateway and the test clock; `tests/models-app.test.ts`
answers the route over a fixed catalog.

## The plans group

`server/plans-app.ts` is the Mac's Plans tab's route group over the account's
named feature plans (`docs/PLANNING.md`): `GET /api/plans` lists them, most
recently opened first, `POST /api/plans` starts one with its name and the
untouched template as its document,
`GET /api/plans/{id}` opens one with its saved document and moves it to the
head of the list, and `DELETE /api/plans/{id}` deletes it, the id moved into
the query by the rewrite `server/function-rewrites.ts` makes of every
segment-captured id.
`packages/hosted/src/plan-wire.ts` declares every request and answer. Each
endpoint resolves the bearer first, and every statement in
`server/hosted/plan-store.ts` names the account beside the plan, so another
account's plan answers exactly as none does.

Nothing in the group writes a document. The one writer is a planning call's
notetaker (`server/voice/plan-scribe.ts`), whose model answers with notes on
the fixed template (`packages/hosted/src/plan-template.ts`): a point added
under a field, an example added to a rule, a phrase corrected, or a line
struck. `saveNotes` (`server/hosted/plan-notes.ts`) takes them in order over
the fields the plan holds, passing over a note that names a phrase the plan
does not hold, formats the body, and saves it under a binding of account and
plan the service built rather than anything the model sends, answering the
document as saved or why nothing was: a body past its bound once formatted,
a plan deleted meanwhile, which a save never recreates because it is an
`update` over the row that stands, and a store that could not be reached,
each leaving the prior document in place.
`readPlan` is the read the planning model starts and resumes from, with the
conversation `attachPlanConversation` associated, and it moves nothing.
`tests/hosted-plans.test.ts` and `tests/plans-app.test.ts` hold both halves
against a real dialect.

The planning model is the hosted brain run over a `plan` conversation, which
`openPlanConversation` opens once per plan and attaches; deleting the plan
stamps it cleared, so the purge takes its words thirty days on. A plan's is
the only conversation any code still opens, and the host runs every
conversation it admits as one, which fixes three things
(`server/hosted/brain-host/planning.ts`): the prompt is the
authored planning instructions, the standing context each turn opens with is
the plan's name and saved document read again from the row,
and the tools are the planning list alone: `run_in_repository` bound to the
plan the conversation belongs to (`readPlanOfConversation`), the two public
research reads beside it, and `queue_question`
(`server/hosted/queue-question.ts`), which runs nothing: its journaled call is
how a question reaches the voice while the turn still runs. A resumed session
is seeded with the conversation so far. The writer holds rows to
`HOSTED_TOOL_SET`, which is the planning tools and nothing else, so a turn's
calls are written and read back under the same list it was offered.
Question choice, agreement, assumption flags, and corrections are the
instructions' alone: no code reads the document for meaning.

The research reads (`server/hosted/public-research.ts`) are `search_web`,
one query sent to OpenAI's Responses API with its own `web_search` tool on
Luke's key and the brain's model at low reasoning effort and low search
context, since the planning turn waits on it, asked to store nothing, and
`read_web_page`, one public HTTPS page fetched and reduced to its text.
Neither knows the account or the plan: what leaves is the query and fixed
instructions, or a GET for one URL with no credential of the account's, and
the result goes back only to the call that asked. A query is one line of at
most 200 characters with nothing shaped like a credential; keeping private
repository text out of it is the planning instructions' rule, since plain
words cannot be told apart by code. A search is `found` only with a cited
public URL, each with the answer's words that cited it; a finished uncited
answer is `no-results` and its words go no further, one the token bound cut
short before it cited anything is `not-searched`, and every failure is `not-searched`
or `not-read` in words that say nothing was found. A page read refuses any
host whose address, resolved before each request and again on every redirect
hop it follows by hand, is private, loopback, link-local, CGNAT, unique-local,
or reserved; the check is a lookup ahead of the request, so a DNS answer that
changes between the two is the case it does not cover. A turn gets at most
4 searches and 6 page reads, 5 sources a search, and 20,000 characters of a
page from at most 1 MB read (`PUBLIC_RESEARCH_BOUNDS`). A search is a paid
inference on Luke's key, so each one is counted as one of the account's hosted
uses before it is sent; a count that cannot be written is logged and stops
nothing.
`tests/public-research.test.ts` holds both against scripted HTTP and DNS.
`tests/hosted-planning.test.ts` runs the scripted model through the host and
the relay, and the `brain-host` eval runs a plan conversation through eve.

The developer talks to the planning model through the ordinary voice
session. Every call is a `/api/voice/sessions` session whose
`session.create` names the plan (`planId`), which the service checks the
account holds before anything is spent; a create naming none is refused. It is created under
the planning call's instructions (`sessionInstructions()` in
`@sidecar/live`), whose delegation policy hands the developer's planning words to the backend and says back the
finding and its one next question. A call just created speaks first: on
`session.started` the service sends `planningOpeningInstruction()` and, once
it is acknowledged, a cue to begin (`greetingCue`), so Luke
opens the conversation rather than waiting for the developer, and a
re-attach opens nothing again. The plan seed's first line says whether the
plan is new (the untouched template and no assumption) or under way, which
is what the opening picks its first question from. The exchange lands every spoken ask and
the session's record in the plan's conversation (`openPlanConversation`),
so the delegation reaches the
planning model with its document, its tools, and the conversation so far.
The recent words ride the delegation as context, and whether an answer
agrees to anything is the planning instructions' to judge. The binding is the session's for life. It is written on
the `voice_sessions` row as a plain `plan_id`,
and a re-attach reads it from there, so a later connection cannot move a
session onto another plan, and one whose row names no plan is refused. The Mac holds one call at a time and ends a plan's
call when the window opens another plan, starts one, or closes, so only one
plan is ever spoken. `tests/voice-service-exchange.test.ts` drives both
plans and the re-attach over the real store.

A start names the plan and nothing more: the folder it reads stays on the
developer's Mac, and the service never learns its path. The planning model
reads source through one tool, `run_in_repository({ command })`
(`server/hosted/repository-shell.ts`), which runs nothing on the service: a
call is a `plan_command` row the tool inserts and reads until the Mac has
answered, and the Mac, while the plan is open in its Plans panel, claims the
oldest unclaimed row through a held request
(`POST /api/plans/{id}/commands/claim`), runs it in the plan's folder, and
settles it (`POST /api/plans/{id}/commands/{command}`). Every claim and
settle names the account beside the plan, so another account's plan answers
as none, and a command no Mac answers by the deadline answers `not-run`.
`tests/repository-shell.test.ts` holds it.

## The admin group

`server/admin-app.ts` is the dashboard's route group: its four reads and the
Users tab's one star write, each its own function, with the group declaring
all five addresses from `ADMIN_ROUTE_PATH` in `server/admin/http.ts` — the
same constants the page composes its calls from, so an address cannot drift
between the two ends. A path the group declares no route for is the admin
vocabulary's own `not-found`; nothing routes one there, since each address is
its own exact-path function, so that refusal is what the group says about
itself.

What the group owns is the gate, and only the gate: `server/admin/gate.ts`
keeps the order the pages depend on — a method the address does not answer is
a 405 before a session is even looked for, an auth seam that throws is a 503
rather than a crash, an anonymous request is a 401 the page answers with a
sign-in, and a signed-in non-admin is a 403 it answers with a plain refusal —
and takes the resolver rather than reaching for it, because the real one is
Better Auth and a gate this much depends on has to be exercisable without a
database. The resolver answers an effect, so the one promise behind it is
`getSession`'s own, wrapped with `Effect.tryPromise` where
`server/admin/admin-route.ts` builds the seam and nowhere in the gate; a
resolution that failed, however it failed, is the same 503. Each read still answers for its own parameters and its own body,
and the group carries that answer as it came, status, headers, and bytes, the
way the auth group carries Better Auth's. `server/admin/admin-route.ts` is
the one place that hands the group this deployment's real session resolver,
database, and integration presence booleans. Every query behind it is an
effect over the ambient `SqlClient`, and so is every seam the group is handed
(`AdminSeamEffect` in `server/admin/seam.ts`): each read composes its query
into the answer it is already building, and the edge serving the request is
the one place the client behind it is provided, so the file names no database
and runs nothing at all: the roster's scope and
search conditions are builder predicates and Drizzle `sql` fragments rather
than concatenated text, and the search term stays a bound parameter with its
own wildcards escaped.
`tests/admin-metrics-queries.test.ts` pins the overview's aggregates for a
seeded window under both scopes, and `tests/admin-roster-queries.test.ts` the
roster, the day detail, the account page, and the star.

Every admin answer is viewer-gated account data, refusals included, so each
one carries `no-store`; `fixtures/admin-refusal/` records the five the group
answers itself and `tests/admin-refusal.test.ts` holds them to the bytes the
promise-shaped vocabulary in `server/admin/http.ts` gives.

## Signing in on a Preview deployment

A Preview deployment answers on hostnames minted for the branch, so
`server/auth-deployment.ts` reads the deployment's own address rather than
assuming one: on a Preview, `VERCEL_URL` is the base URL and `VERCEL_BRANCH_URL`
joins it as a trusted origin, and `BETTER_AUTH_URL` stays what it has always
been, the production address whose callback the two providers registered.
Without this a preview refuses its own sign-in before it reaches a provider at
all — Better Auth trusts the origin of its own base URL, and the browser on a
preview sends the preview's, which is the 403 behind the admin dashboard's
"Sign-in could not start. Try again."

On a Preview the desktop's pending authorization also has to be resumed by
hand: production's provider plugin resumes it from the state it stored at
sign-in, but a Preview's state is consumed by the proxy callback, which then
redirects to the sign-in's `callbackURL`, and the page sends none. So a
Preview's `authProxy` adds one sign-in hook ahead of the plugin's that names
the authorize request itself as that callback (`resumeAuthorizeURL`), and the
plugin issues the code to the desktop's loopback from there.

Better Auth's `oAuthProxy` plugin carries the rest: the preview hands the
provider production's registered redirect URI, production exchanges the code and
redirects the profile back to the preview encrypted, and the preview creates the
session in its own Neon branch database. Production keeps the plugin's callback
hooks because it is the relay that exchanges the provider code, but drops the
plugin's `/oauth-proxy-callback` endpoint. That endpoint creates a session from
any profile encrypted with the shared proxy key; leaving it on production would
turn a Preview-held credential into authority over production sessions. A
preview therefore signs in only against a production deployment that already
carries the relay hooks, while only a positively identified Preview accepts the
returned profile.

The Preview environment needs `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`,
`BETTER_AUTH_PROXY_SECRET`, and both providers' `CLIENT_ID` and
`CLIENT_SECRET`, the same values production holds. Production is the end that
exchanges the code, but Better Auth's Google provider refuses to build the
authorization URL without a client secret, so a Preview without
`GOOGLE_CLIENT_SECRET` answers 500 to every Google sign-in before the browser
leaves for Google (found 2026-09-18); Better Auth's own oauth-proxy setup sets
the provider secrets in every environment, and Charles chose on 2026-09-18 to
follow it rather than hold them back from Preview; the preview then builds its own Google URL and production still exchanges the code. `BETTER_AUTH_PROXY_SECRET` has to hold the same dedicated value on both
ends, or the profile arrives undecryptable. A Preview without it does not expose
the profile-accepting endpoint at all: falling back to `BETTER_AUTH_SECRET`
would require putting production's session-signing and provider-token key into
Preview. The dedicated key does not make the shared credential harmless. A
profile encrypted with the proxy secret is what a Preview's
`/api/auth/oauth-proxy-callback` trusts, so a leak can hijack a proxied OAuth
flow and mint sessions on deployments that accept proxy profiles. Production
deliberately does not. Treat the proxy secret as sensitive everywhere it is
stored, especially in Preview.

Production also needs `BETTER_AUTH_PROXY_TRUSTED_ORIGINS`, a comma-separated
allowlist of this project's protected Preview origins. A single `*` may stand
for characters within one hostname label; for this Vercel project that is
`https://luke-web-*-stage-review.vercel.app`. Before production spends a
provider code, it decrypts the proxy state and requires both the profile-return
endpoint and its final page to match that allowlist. A Preview-held key therefore
cannot turn production into a token relay to an origin outside the project.

Vercel Deployment Protection sits in front of all of this. The redirect back
from production lands on the protected preview like any other request, so the
browser needs that deployment's access cookie already; without it the dashboard
reports the intercepted API call rather than the metrics.

`server/routes/account/delete.ts` erases the signed-in user on the same bearer
resolution: the desktop's Delete account confirm is the only caller. Deleting
the `user` row is the entire act: sessions, provider accounts, OAuth grants,
and usage counters all reference it with `onDelete: "cascade"`, so nothing of
the account outlives the request.

`server/routes/events.ts` records what a signed-in desktop counted about its own use, on
the same bearer resolution. The desktop never talks to the analytics processor:
it posts an allowlisted batch here, and this is the one place a `distinct_id`
is attached, from the resolved account and never from the body, which has no
place to name one. `productEventBatchFromWire` in `@sidecar/analytics` is the whole
admission policy, and it builds each event from that event's property
allowlist, so nothing outside the vocabulary survives the read.

It needs `POSTHOG_PROJECT_API_KEY`; without it the endpoint answers 503 and
product analytics is simply off, which is the intended state for Preview
deployments. `POSTHOG_HOST` optionally overrides the ingestion host.
`POSTHOG_PERSONAL_API_KEY` and `POSTHOG_PROJECT_ID` are what let
`server/routes/account/delete.ts` ask PostHog to erase the person before the account row
goes. It is a private endpoint, so it takes a personal key rather than the project
token, and `POSTHOG_API_HOST` overrides *its* host, which is not the ingestion
host. Without that pair the delete simply has no erasure seam to run. Every
forwarded event carries `$geoip_disable`, without which an event arriving with
no address resolves to the data centre's own location and the privacy claim in
`PRIVACY.md` becomes false; the project's IP-capture setting should be set to
discard as well, so the guarantee does not rest on one property in one file.

The browser half of the funnel is separate and weaker: `VITE_POSTHOG_PROJECT_API_KEY`
is a build-time variable that lets the site's own pages talk to PostHog
directly, so PostHog sees a visitor's address there. A build without it never
loads the library at all.

Use is counted per user per UTC day in the Luke-owned `hosted_usage` table:
one atomic upsert before each upstream call (`server/hosted/quota.ts`).
Nothing is refused on the count, which the admin pages read; a spend limit on
the OpenAI project behind the key is the backstop and should be configured
with it.

## Hosted voice service

`server/routes/voice/sessions.ts` is the hosted voice service: one Vercel
Function serving WebSockets on Fluid compute, the part of this deployment
that holds the GPT Live project key and owns each hosted voice session
(`live-contract.ts` in `@sidecar/hosted` is the Mac's contract with it). The
file exports the `http.Server` that `server/voice/service.ts`'s
`voiceServer()` builds, with `ws` handling the upgrade on it, exactly as
Vercel's WebSocket guide has it; the Mac opens `wss://` on this deployment's own origin,
`HOSTED_VOICE_SERVICE_ORIGIN` in `@sidecar/hosted`, at `VOICE_SERVICE_PATH`.
A plain request to the path answers 426, since the path is a socket's.

On `/api/voice/sessions` a signed-in Mac's handshake carries its account
bearer, resolved through the same in-process `/oauth2/userinfo` seam every
hosted route uses, and one session is counted against it by the same
`hosted_usage` meter before any session exists. The
socket's first frame is `session.create` (the SDP offer, a voice, the seed,
and the id of the plan the call is about); the opener
(`server/voice/opening.ts`, which is where the first frame becomes a session
or a refusal) checks the account holds that plan, and
the function creates the session at OpenAI on the deployment's key, writes
down the session's `voice_sessions` row (the account, the live session id,
client delegation, and the plan the call is bound to), attaches the trusted sideband, stands the hosted
exchange on it (below), and answers `session.created` with the id, the SDP
answer, and the store's own id for the `voice_sessions` row
(`voiceSessionId`), which is what a stored spoken row names as its
`voice_session_id`. From then on the relay is a pipe: OpenAI frames to the
device untouched except `session.input_audio.append` and
`session.output_audio.delta`, dropped by type so the developer's voice and
Luke's never transit the service; and from the device nothing forwarded at
all (`frames.ts`): the hang-up (`SESSIONS_HANG_UP_FRAMES`), the Mac's
`session.hangup` or an older build's own `session.close`, is read as an ask
for the close the exchange sends itself (below), and two frames in the
service's own vocabulary (`SESSIONS_REPORT_FRAMES`) are read here and handed
to the exchange rather than forwarded: `session.activity`, the peer's idle
report, and `session.stop`, the stop key, which the exchange answers with the
one instruction it appends itself (`STOP_SPEAKING_INSTRUCTION`, which stands
on the service alone) and by blocking every exchange of the session: no reply
delegated before the press is spoken, and each run still under way is
cancelled through `stopAsk`, the voice told silently (`STOPPED_RUN_NOTE`)
only once the cancel was taken. So no device appends anything to a session,
and no sentence of a device's composing reaches one through this route. Any other device frame — an older build's own append, the
microphone switch that never crosses this socket, an unreadable frame —
closes that device's socket with a policy violation (`UNPERMITTED_FRAME_REASON`)
rather than dropping it, so a device still running an exchange of its own is
refused where it can be seen and never doubles the one standing here; the
session then ends as a hang-up does, seconds recorded. The relay keeps no
conversation, reads no frame past its `type` but those reports, and logs
status codes, outcome names, and counts.

The service itself is a scope. `VoiceService.make(options)` answers
`Effect<VoiceService, never, Scope>`, and that scope owns the `ws` server, the
`FiberSet` each session's fiber joins, and the claim on the server the function
exported; closing it gives up the claim, closes every device socket so each
relay detaches, leaving the WebRTC session for the device to
re-attach to on another instance, drains those fibers under their own timeouts, and only then closes the `ws` server. Nothing calls a `close` beside
it, because a Vercel function is frozen between invocations and discarded with
no shutdown hook: `voice/function.ts` stands the service on `runWeb` in a scope
held open by `Effect.never` and a test is the only caller that ever ends one.
Until a service stands, and again once its scope closes, the server refuses
every upgrade with the same 503 a deployment missing the project key answers
with.

One upgrade is one `Scope` and one effect run on the `WebStoreRun` the
function hands the service. Both sockets are the platform's:
`server/voice/socket.ts` reads a `ws` socket through
`effect/unstable/socket`'s `Socket`, a fiber of that scope filling a mailbox with
every frame in arrival order, so the opening frame is taken from the same
reader the relay then streams the rest from and nothing between the two lands
nowhere. `server/voice/relay.ts` pipes the two streams, settles on a
`Deferred`, and arms its graceful-close and opening waits as `Effect.sleep`
forked into that scope; `server/voice/openai.ts` answers effects for the
session create and the sideband attach, each socket acquired with `Effect.acquireRelease` so a session
that ends, however it ends, leaves no socket standing. A socket handed over by
`ws` is paused until its reader stands, because `ws` emits a frame to whoever
listens at that instant and the reader is a fiber away.

A device's socket is bounded to `SOCKET_BYTE_BUDGET`, eight mebibytes the
caller may send before the service closes the socket, since its account is
spent per session and answers for what it sends. The socket's own reader
counts it, from its first frame rather than from whenever the pipe stood, so
what a caller sends while its session is being stood up is spent as much as
what the pipe later carries, and a frame past the budget is not read at all —
what the relay sees is the peer going, which is a hangup it already knows how
to end. The voice never travels here: it is WebRTC's.

### The live session service, attached to the sessions route

The machinery that owns a session's exchange — the delegation adapter that
hands each ask to the brain and speaks the reply as commentary once the run's
actions settle, the append channel, idle, and the
graceful close — is `@sidecar/voice`'s `LiveSessionService`, behind that
package's `./live-session` door, which names no socket library so a function
bundle takes it without `ws`. This service composes it for every signed-in
session (`server/voice/live-exchange.ts`, adopted over the same socket the
relay pipes by `exchange-attachment.ts`, composed over the deployment's seams
by `deployment-exchange.ts`, and passed by `function.ts`): the exchange stands
before the desktop is answered, and a deployment missing the deployment
secret or eve's origin composes none and refuses every
session as `unavailable`, since a session with no exchange behind it has no
one to answer its asks. The desktop composes no exchange of its own since
E5-3; what it holds is `LiveSessionHolder`, which seeds the session at
creation, ends it, and reports its idle and its stop. What stops the
model's output from becoming an action is not the attachment and not the
sideband but the brain's own gauntlet: `acceptAsk` on every spoken ask, and
the host's admission of the conversation again on every tool call a turn
makes.

What stands: `server/voice/live-record.ts` is the `LiveRecord` door over the
voice writer (`server/hosted/store/voice-writer.ts`). Every server event is
handed to `observe` in arrival order and the writer takes what it keeps —
each transcript delta a segment, and, through the one row door the service
calls behind each fragment (`upsertSpokenRow`, debounced 300 ms a row and
flushed at once on a delegation and on the session's close), each speaker's
utterance as a row under the id the service's ledger minted when it opened,
inserted on first sight and grown in place after, its words cut from those
segments over the span the ledger holds it at: the developer's line, and
every utterance of Luke's as an assistant row authored by the voice model,
whatever prompted it — an answer it gave itself, what it said around an ask
handed to the brain, the brain's reply read aloud, the opening — so the
record shows what the developer actually heard, and a reading stands beside the message it was read
from rather than in place of it. A delegation cuts nothing and re-keys
nothing: the stream's `session.delegation.created` is consumed like any other
event and leaves nothing, and what puts an ask on record is the service's
attach: every developer row of its ledger since the previous ask's end that
starts at or before the delegation's offset, the row containing the offset
among them, each handed over as the ledger holds it then, so a last fragment
the API delivered after the delegation is on the row, and each written and
then given the delegation in one turn at the writer (`attachSpokenAsk`), its
`client_id` the ledger's still and `metadata.delegation_id` naming the ask,
which is where the received-message attach and Luke's rows already look for
it. The ask's rows keep growing under their own ids after the handover, and
the store keeps the delegation on a row through every later write of it.
That order is a queue's:
one fiber of the socket's scope makes every write, taking them from a queue
each arrival puts one on, so where an event lands in the sequence is decided
where it arrives rather than by whichever fiber reached the store first. The write answers true
only when the ask is on record, which is what keeps the service's own rule —
the record precedes the speech — over Postgres. `server/voice/live-sideband.ts`
reads the upstream socket as the `LiveSideband` the service consumes — the
`ws` listeners it registers are the acquire of the session's own scope and are
taken off at its close — and `observedSideband` hands each event to the record
once, on its way past the one reader that runs the sideband's arrivals, replay
included.

### The brain answered in process

`server/voice/live-brain.ts` is the `LiveBrain` the hosted composition hands
the live session service, and it reaches Luke's judgment in process and never
over HTTP. The voice function resolved the account at its handshake and
dropped the bearer there, so it holds nothing eve's door or this deployment's
routes would take; what it holds is the ask door itself, `acceptAsk` in
`server/hosted/brain-ask.ts`, called with the resolved account, the spoken origin, and the
service's submission id as the client id, under the eve client the
composition built for the account as the deployment acting for it
(admitted for spoken turns by `DEPLOYMENT_TURNS`, below).
The run the service keys an exchange by is the ask's id, since eve names a
turn only once it starts; the brain follows the ask through `askStanding` on
a schedule, projects its turn's events with `projectTurnEvents`
(`server/hosted/turn-events.ts`), and translates each back to the ask's id. There is no HTTP hop
and so no second function ceiling to re-attach across. Each follow is a fiber of the socket's own scope, so
the socket detaching interrupts it and nothing is emitted after. What the
detach cut short is not lost with it: a spoken ask's row carries the voice
session it was delegated in and its revision there, how far its turn was told
(`told_seq`, short of the end), and when its end was told (`end_told_at`), each
written before the voice hears it. A connection that re-attaches to the session
adopts it as started and asks the brain to recover it (`recoverRuns`): every
ask of that session whose end was not told comes back as its exchange, under
its own delegation and revision, and is followed again from the event after
the last one told. The session's revisions go on from the newest recorded, so
an older run stays superseded; a run whose turn carries a Stop comes back
silenced; and so does one whose turn settled more than `VOICE_DETACH_GRACE_MS`
before the re-attach, past which the reply is no longer news. Written before it
is told, a telling the detach cut between the write and the voice is lost and
never said twice. A turn that
does not end inside the follow bound, or an ask the record no longer holds,
is told as a failed end so the exchange settles rather than waiting forever. On the eve
path the reply arrives whole at the turn's end; what the follow carries
mid-turn is the slow step, each question a planning turn queued, the
actions settling, and, as the live brain's own and no event of the stream,
each look's count of the turn's settled calls with the kind of the latest
(`STEP_SETTLED`), never a call's input or output, which the service words as
a build-fixed quiet progress note no sooner than `PROGRESS_NOTE_BOUNDS.GAP_MS`
after the exchange's last and at most `PER_EXCHANGE` times. A reply's
commentary the voice session refused is sent once more under a fresh id and,
refused again, reported; one left unanswered is reported and never resent,
since a pending append may still reach the timeline. eve folds asks that waited together into one turn, so
several follows can project one turn: the newest ask tells it, since the
service speaks only the newest request's reply, and the rest tell only its
end, so a reply is never said once per folded ask. Each delegation is an
exchange of its own in the service, a revision of the request: a newer one
silences the older exchange's reply, slow-step note, and end note, and leaves
its run to finish rather than cancelling it, because a planning call
delegates every answer while the exploration it began still runs; the
questions a silenced run queues are still handed on. A refusal at the door is
spoken as the build's own note for it, never composed with the ask. One
spoken ask leaves one developer line: the transcript's row, cut at the
delegation by the voice writer under the delegation's id. Eve's received
message for a spoken turn is the question the service composed around those
words, which is not written as a user row, where a typed ask's is;
`BRAIN_HOST_TURN_KIND` says for each kind whose row the received message is,
so the relay consults the table rather than a branch. The line and the ask
share one id, the delegation's, which the service submits the ask under, so
the line is tied to the turn the ask ran whichever write lands second: the
voice writer reads the ask's turn under the conversation's lock as it writes
the row, and the relay, at a spoken turn's received message, takes into the
turn any row of the turn's asks still standing without one, and behind it
any row of Luke's about that ask — his "checking now", said the moment the
voice handed the question over and written while the dispatch was still under
way — under the same lock, in the order said. The race is removed rather than
won, and no line of his is left as a group of its own to be placed by its
instant after the whole turn it belongs to. The store owns the order inside
the group as it owns the order of the conversation, so the writer places the
developer's line ahead of the turn's work by sequence rather than leaving a
reader to sort it. A line the turn takes at its received message moves to a
fresh position, ahead of the journal the first step is about to open; a line
that lands after the first step, the voice writer's cut racing eve, is placed
at a fresh position and the journal moved behind it to another; and a line
the turn takes with a journal already open — a received message eve told
again after the step — moves the journal behind it the same way, so the
developer's line precedes the turn's work on every path a line enters a turn
by. The turn's answer closes the journal behind whatever landed after
it while the turn ran — Luke's words said around the ask as the brain worked,
an aside, a second line of the developer's — by moving it to a fresh position
where any row stands past it, and leaves it where it opened where none does,
so the thread reads as it was heard: what was said while he worked, then what
he did and thought, then what was said of it.

`server/voice/live-exchange.ts` composes the whole for one account's one
live session — the brain answered in process, the record over the voice
writer with the sideband observed once ahead of the service — over one
store context, with the eve client handed in as the caller composed it. The
brain's asks are pinned to the conversation the record writes, the plan's,
so an ask and the lines it leaves cannot name two conversations: once the
plan's deletion has stamped it, the ask is refused at the door and eve is
not reached, rather than eve taking a turn the record cannot write. The
composition is a scope's:
`hostedLiveExchange` answers an effect built in the `Scope` its caller opened
for the socket, and every fiber the session runs is forked into that scope —
the one that reports what the record made of each live event, the one that
makes every record write in arrival order, the brain's follow of each
accepted ask — so closing the scope
interrupts each of them. The session's graceful close (its release with
nothing said, `LiveSessionService.release`, where the relay settled detached)
and the wait on every record write already started are finalizers of the same
scope, added so their
reverse order is the order the exchange's old `stop` ran them. No composition
below the exchange holds a runner, and none of them runs an effect at all:
`LiveRecord`'s two utterance writes and `LiveBrain`'s submission answer
effects themselves, the record's on the fiber that makes every write in
arrival order and the brain's with the `SqlClient` the scope was built on
provided to it, as `runTool` provides it to the brain's seams.

### The exchange on the sessions route

`server/voice/service.ts` takes one more seam, `VoiceServiceOptions.exchange`:
the composition's exchange for a signed-in session, offered once the session
stands and before the desktop is answered, and adopted over the same sideband
the relay pipes. The service hands the attachment the socket and reaches
nothing of the exchange or the live-session door itself; the attachment
builds the sideband over that socket and adopts. One
socket, one scope: the attachment is an effect the service runs in a scope
forked from the session's own, building the plan's conversation, the
exchange, and its adoption of the sideband in it, and the
service's stop is that scope's close; a standing that could not be reached
has the scope closed by the service before the session is refused, so nothing
an attempt acquired outlives it. The
socket admits many listeners, so the relay keeps piping raw frames to the
desktop unchanged while the exchange reads parsed events through its
record-observing sideband. The upstream hands the sideband over paused,
inside its own open handler, because the bytes after the handshake response
are re-queued and flushed on the next tick, before any fiber continuation;
the service resumes it once both consumers listen, so what the session spoke
while the exchange stood is read then, by both, in order, and a desktop that
went meanwhile is answered nothing, its exchange stopped and its sideband
left to the session's scope rather than standing for the invocation. The exchange adopts rather than
creates (`LiveSessionService.adoptSession`): the desktop's create frame
seeded the session, and a second seed would put the recent lines into the
conversation twice. A fresh connection re-attached to a running session
adopts it as started, since the session spoke its start to an earlier
connection and speaks it to no later one. An exchange offered that cannot stand refuses the session
as unavailable rather than running it with no one to answer its asks. When
the relay settles, the exchange ends its follows, closes the
session it holds (already gone, which its sideband reports as the close it
held), and waits for every record write already started, so no line begun
before the settle is cut; an append not yet sent is dropped with the session
and never re-sent, and a write that fails after the socket closed is
reported. `server/voice/exchange-attachment.ts` is what the function passes:
the plan's conversation resolved at the session's start, the function's
writer, eve reached as the deployment for the account, and the plan's
notetaker (`server/voice/plan-scribe.ts`), which runs only where the
deployment holds the OpenAI key.

eve is reached as the deployment acting for the one account the session
resolved at its handshake, since the function holds no bearer of the
account's by the time a delegation arrives. It calls eve's session routes
under the deployment's `CRON_SECRET` as its bearer with the account in
`x-luke-account`, and the eve door's first authenticator admits that pair as
a principal of the deployment's own type — the deployment's one id, the
account as its attribute — for a message naming a kind of turn its table,
`DEPLOYMENT_TURNS` in `server/hosted/brain-host/channel.ts`, admits (a spoken
turn) and nothing else: any other route or kind of turn carrying the secret
is refused outright rather than passed to the account authenticator behind
it. Which account a request acts for is one accessor over both principal
types, and the door's ownership checks and the host's admission read that
answer, so the deployment can open a turn only on a conversation the named
account owns. Where eve answers is an origin of this deployment's own, whose
rewrites carry `/eve/v1/*` into the eve service (`deploymentEveOrigin` in
`server/hosted/brain-host/eve-origin.ts`): `LUKE_EVE_ORIGIN` where it is set,
otherwise the project's production domain in production and the
deployment's own host on any other deployment. Production names the custom
domain rather than the generated `*.vercel.app` host because that host
carries the project's Vercel Authentication, which answers a
server-to-server POST at the edge and never reaches eve (LUKE-250).

### One connection is one invocation

A WebSocket connection to a Vercel Function closes when the function reaches
its maximum duration — `server/function-durations.ts` gives the function
800 seconds, the longest generally available — while the WebRTC session between the device
and OpenAI stands on. A device socket that closes without the
device's own `session.close` is therefore a detach and not a hang-up: the
relay sends nothing upstream, settles `detached` at once, closes only its
sideband, records no close, and the exchange lets go of the session with
nothing said to it. The row is stamped `detached_at` (migration 0052) where it
is still open, and a re-attach clears the stamp, so a session no device came
back for is visible as an open row stamped longer ago than the grace, which
the scheduled sweep ends (below). Each connection names itself on the row
with an `attach_id` (migration 0058), written at creation and at every
re-attach, and a stamp lands only where the row still names the connection
writing it: the Mac re-attaches within seconds, so the connection it replaced
can write its detach after the new one attached, and that late stamp would
otherwise hand a live call to the sweep. A device that goes while its session
is being created or re-attached leaves the session stamped the same way, since
no connection is left to end it. So a socket may also open with `session.attach` naming
a session id. The function resolves the bearer, checks that this account is
the one the session was created for (the `voice_sessions` row written at
creation, indexed over the owner and the live session id for this lookup),
reads the plan the call was bound to off the same row, refusing a row that
names none, attaches a fresh
sideband to OpenAI's `/v1/live/sessions/{id}/attach`, answers
`session.attached`, and pipes as before. Nothing the session said between the
two connections is replayed. The desktop's `HostedLiveSessionSource` in
`@sidecar/voice` does the reconnecting: three tries over about ten seconds,
sends made in the gap held for the next connection, and only after the last
failure does the host see the loss it already handles as `connection_lost`.

### How a session ends

While a signed-in session runs, every `session.usage.updated` overwrites the
row's `usage` with `{ seconds, confirmed: false }`, a snapshot and never a
sum. `session.closed` is finalization. Whichever connection sees it forwards
it, writes the row's `closed_at`, `close_reason`, and
`usage { seconds, confirmed: true }`, records `usage.seconds` through
`recordVoiceSeconds` in `server/hosted/quota.ts`
— the session row is the idempotency ledger: the seconds land only where none
stand yet, so a report seen by two connections adds nothing — and closes both
ends. The session's one `session.close` is the exchange's, as the
server-controls guide asks one owner per action ("Assign one owner for each
action"): a device hangs up by asking for it, and the relay hands the ask to
the exchange's graceful close, the same one its idle decision runs, which
registers for `session.closed` before it sends and holds the sideband for it
for 15 seconds, the docs' close sequence. Neither the Mac's voice window, nor
its host, nor the relay sends a close of its own; the window stops its
microphone at the hang-up and keeps its peer up for `session.closed` under
the same bound, then closes the peer, which OpenAI ends as `remote_hangup`
where no close reached it. A device socket that goes after a hang-up, or
after a refused frame, asks the same owner once more, which sends nothing
twice. A socket that goes with neither is a
detach (above): nothing is sent, nothing is recorded, and the unconfirmed
snapshot stands until a re-attached connection reads `session.closed`. A
detached session is bounded all the same, since a caller can drop the socket
and keep its WebRTC up with nothing left to send `session.close`: once a
minute the maintenance sweep (`server/voice/orphan-sweep.ts`) takes up to 20
open rows stamped detached more than `VOICE_DETACH_GRACE_MS` (60 seconds)
ago, oldest first and ten at a time, attaches a fresh sideband to each through
the same upstream, sends `session.close` through the same graceful close the
exchange runs, and on `session.closed` writes the close and records the
seconds through the same ledger; each attach and each wait for the final event
is bounded at five seconds. A session OpenAI refuses the attach for as gone
(404 or 410) is closed as `connection_lost` with the last unconfirmed snapshot
standing, so no row is swept twice. Anything less conclusive — an attach that
timed out, was throttled, or failed at OpenAI, or a close never confirmed —
says nothing of whether the call still runs, so the row is left stamped for
the next sweep, unless the session started more than
`VOICE_SESSION_LIMIT_MS` (60 minutes, OpenAI's own duration limit) ago, when it
is closed as `expired`. The sweep answers how many it `closed`, how many were
`lost`, how many stand `pending` for the next sweep, and how many `failed` a
write. A deployment without the voice key sweeps nothing. Every connection
that ends without `session.closed` stamps the row the way a detach does, so
the sweep closes the session and records its seconds unless a device comes
back: a hang-up whose close OpenAI never confirmed within the 15 seconds, a
sideband that ended first (which also closes the device's socket with code
1001 and reason `upstream-closed`), and a session refused after it was
created — its sideband not attached, or its exchange unable to stand. A close
writes only an open row, so a second `session.closed` changes nothing. Only the voice
function and the maintenance sweep write `voice_sessions`; the seconds ledger and it both cascade with
the user row. The seconds ledger meters nothing on its own: a session still
counts one call when it opens.

### How a refusal looks

Before any socket stands, an HTTP status on the upgrade: `401` for
`/api/voice/sessions` without a bearer, `403` for a handshake carrying a
browser `Origin` header (the caller is no page: the desktop connects from
its main process), `503` while
`OPENAI_API_KEY` is absent. Once a socket stands, one frame `{ "error": <reason> }`
in `hostedErrorSchema`'s vocabulary, then a close with code 1008 and the same
reason: `invalid-request` for a first frame that is not a valid `session.create`
or `session.attach`, a create naming no plan, or an attach to a session bound
to none; `invalid-token` for a
bearer no account stands behind, and for an attach to a session this account
did not create; `not-found` for a call naming a plan the account
does not hold, refused before the session is counted; `upstream-error` when OpenAI refused the
creation or the sideband could not attach; `upstream-throttled` when OpenAI
answered 429.

### Deploying

Enable the WebSockets feature on the Vercel team, make sure Fluid compute is
on for the project, and set `OPENAI_API_KEY`; `LUKE_LIVE_MODEL` optionally pins
the model. The exchange also needs `CRON_SECRET`, the deployment's secret at
eve's door, and without it every session is refused as unavailable; eve's
origin is the deployment's own unless `LUKE_EVE_ORIGIN` names another. No
separate service is deployed. Tests run against a fake OpenAI on loopback and an in-memory account side
(`tests/voice-service.test.ts`, `tests/support/voice-fakes.ts`).

## The turn event projection

`server/hosted/turn-events.ts`'s `projectTurnEvents` is what the voice's live
brain hears of a turn while it runs, in process (above). Nothing is stored for
it: the five events — a slow step began, a planning turn queued a question,
every action settled, one sentence of the reply, the turn ended — are a
projection over the turn row and the turn's journal, the assistant message the
store writer opens under the turn's id and amends as each call is written
ahead of its run, read again on every poll, and the projection only grows
while the turn runs, so each event keeps the number it was first told under
and a reader that has heard some hears the rest and the end exactly once.

## Hosted conversation store

The `conversations`, `messages`, `turns`, and `asks` tables hold the hosted
brain's conversations per account: a plan's conversation, its messages, the
turns that ran over it, and the asks handed to it. Every row is keyed by
`user_id` and cascades with the user row, so
`server/routes/account/delete.ts` erases them with the account.
`server/hosted/store/` is the store the brain host composes against; every
module there is an `Effect<A, SqlError | Schema.SchemaError, SqlClient>`
whose rows a `Schema` decodes and whose path rule is that schema too, which
`HostedStore`, the store writer, the voice writer, and the ask record all
answer as it came, and which a route handler composes into the one effect
`runWeb` answers for the request.

The database still carries tables and columns nothing reads or writes any
more — `events`, `provider_cursors`, `provider_key`, `roster_snapshot`,
`transcript_mark`, `observation_pass`, `workspace_file`,
`workspace_embedding`, `devices`, `account_workspace_preference`, and
`introduction_usage`, and the conversation row's observed-session and child
columns — and their schema modules still declare them, so the drift check
holds; they go with the migration that drops them.

The conversation tables are the shape the LUKE-95 storage plan settled on,
less the `prompts` table it drew and less the `tool_sets` table
`0039_dead_tool_sets` dropped: a turn keeps the composed prompt's hash and the
tool set's and nothing else of either, because nothing replays them, and the
tool set is the build's own and read from the build that offered it. A
conversation row names its kind (`plan` is the one any code still opens), the
runtime's own session id, its soft-delete instant, and the counter that
numbers its messages. A message is one AI SDK `UIMessage`, its parts and
metadata as plain `jsonb`, unique on `(conversation_id, client_id)` as its
idempotency key; a turn is one run's origin, status, model, prompt and
tool-set hashes, response ids, usage, timings, and failure, with why the
runtime failed one in `failure_detail`: eve's failure code, the key names of
its details, the error's class name, eve's catalog id, and status codes where
eve's details carry them, and eve's message cut to 200 characters with every
credential-shaped run replaced by `[redacted]`, no other value of the
details, cut to 500 characters by the writer and read by nothing but a
query. A prompt and a tool set are content-addressed, the hash of the text or
the schemas as the key, and the turn row carries that hash and nothing else
of either, naming no row and holding no foreign key. Nothing in these tables
is sealed: the content is readable by an operator.

The store writer, `server/hosted/store/writer.ts`, is the one path by which a
`messages` or `turns` row is written, and
`tests/store-writer-boundary.test.ts` holds the server's own sources to that:
the writer is the one server module with an insert, an update, or a delete over
`messages`, `turns`, or `events`, whether as a Drizzle table imported from the schema or in the
text of a statement, and the modules that name one at all are the writer and
the two readers, each listed there by name. It
consumes the brain's run event stream (`BrainRunEvent`, every kind of turn)
for a conversation the caller names by its row id and account. A turn row
goes from queued (written ahead of the stream by `enqueueTurn`, or at the
turn's start where nothing queued it) through running to settled, cancelled,
or failed, carrying the origin it was queued under, eve's own id for the turn
where the relay queued it (the store's id is a digest of it that nothing
reverses, and a Stop on the row is scoped to eve's turn by reading it back),
its usage split four ways, its response ids where the runtime has them, and
its failure word. Each user
message the turn opened with lands as its own row by the message's id. The
turn's answer is one assistant message keyed by the turn's id, and while the
turn runs that row is its journal: a tool call is written in `input-available`
before it executes and moved to `output-available` or `output-error` as its
result lands, a reasoning summary is written as it completes, and the turn's
completed message replaces the journal's parts whole and sets `finished_at`
once, after which the row is immutable and a late event for it is refused. A
turn that ends with a call still unanswered settles the call as an answer
whose envelope says its effect is unknown, since the call was dispatched and
nothing will answer it now, and closes the row; a writer that dies between
the call and its result leaves the part in `input-available`, which is what
a resume reads. Only a refusal — a call the tool or the host's admission
refused — is an `output-error` part; an unknown outcome is an
`output-available` part carrying its envelope, so the record can tell "Luke
declined" from "Luke does not know", which are opposite claims. Because any
call may answer with that envelope, a tool's declared output schema has to
admit it, and the writer holds the catalog to that once, when it is
composed, refusing to exist over a catalog that fails it rather than leaving
a row nothing could read back. Every write is
idempotent — a message by `(conversation_id, client_id)`, a turn by its id, a
tool part by its call id, a reasoning part by its item's id — so an event
delivered twice writes one row and a replayed stream changes nothing, and
every message is held to the vocabulary before it lands, through the same
`readStoredUIMessages` a read goes through, so no row can carry a tool the
catalog does not register, an input its schema refuses, or metadata outside
the set; a message the reader would refuse is refused whole and reported,
never cut down to the parts that would pass. Every write runs under a lock on
the conversation row, which no write reaches once it is stamped deleted; the
sequence comes from the row's counter, each allocation landing on the first
position no row holds, so the unique `(conversation_id, seq)` constraint is
the backstop for a writer outside the lock and nothing the writer retries.

Voice is stored beside them the way a call platform stores a call, in
`voice_sessions` and `voice_transcript_segments`.
A session row is one live session — the Live API's own session id, unique so
a re-attach on a fresh function instance finds the row it had rather than
forking it, and indexed with the user so an ownership check is one lookup —
with its delegation mode, when it started and
closed, the API's own close reason, and a `usage` payload of billed seconds
with a flag saying whether the API confirmed them or a lost connection left
them estimated. A segment is one span of what was actually said, by whom, in
milliseconds on the session's clock. What is spoken becomes a message as each
utterance settles: the developer's line and every utterance of Luke's are each
cut from these segments into a finished row of the conversation, so the
record keeps the words the developer actually heard. A delegated
exchange's reply is also the assistant message the brain wrote, and Luke's
reading of it stands beside that message as its own row, whose metadata names
the voice session and span it was cut from, the delegation it followed, and,
where the store could tell, `read_from`: the message the words were read
aloud from — the delegation's turn's journal where that turn had settled
within two minutes of the write, in which case the row joins the turn. No
audio is ever stored.

Two writers share those tables and never a column. The voice service's own
`server/voice/session-record.ts` owns the session row's whole life: it is
inserted when the session is created, found again by `(user_id,
live_session_id)` when a fresh function instance re-attaches to the same
live session, overwritten with each unconfirmed usage snapshot while open,
and closed once with the confirmed seconds, the instant, and the reason. The
voice writer in `server/hosted/store/voice-writer.ts` only reads that row
for its id and hangs everything else off it: a segment per transcript delta
at the next position of the session's own sequence, and the developer's spoken ask as a
user message on the voice channel, cut from the stored user segments between
the previous ask's end and the delegation's offset or the end of the
utterance the service's ledger grouped the ask as, whichever is later, and
named with the session, the delegation, and the span. A row whose `closed_at` is still
null may keep gaining segments, because an instance that dies at its
duration bound never sends `session.closed`, its relay detaches rather than
closing, and the re-attach lands on the same row; the writer reads nothing from the row's state but its id
and reads everything else back from the record, so a
fresh instance continues a session where the last one stopped.

The store tests run the generated migrations on PGlite in process, so
`check.sh` needs no service; the `postgres` CI job runs the same migrations
and tests against a Postgres service container. Every one of those is
Postgres 18, the major production runs: Neon serves 18.x, PGlite 0.5.8
embeds PostgreSQL 18.3, and the CI service image is `postgres:18`, so a test
that fails in any of them fails about the database the service actually
runs, and a local `check.sh` is a reproduction on 18 already. On either
dialect an opening of the test database is a database of that opening's own:
a fresh PGlite, or a clone of the database `LUKE_STORE_TEST_DATABASE_URL`
names, made with `create database ... template ...` on the cluster's
`postgres` maintenance database and dropped when the file closes it
(`tests/support/store-test-postgres.ts`). Nothing writes to the named
database itself after `db:migrate`, so a statement a test forgets to scope by
account or conversation reaches its own file's rows and no other file's,
which is the property `tests/store-database-isolation.test.ts` holds the
harness to. Which files `test:store` runs is read from the files, not kept
in a list: `scripts/store-tests.ts` selects every `tests/**/*.test.ts` whose
source imports one of the three doors under `tests/support`
(`hosted-store-database`, `sql-client`, `store-test-postgres`), because
`LUKE_STORE_TEST_DATABASE_URL` is read there alone and a file that imports no
door cannot meet a Postgres whatever it does. A new store test is therefore
in the set the moment it imports its harness, and `package.json` is not
edited. The runner then reads vitest's JSON report back and fails, naming
each file, when the files vitest ran are not exactly the files selected;
`tests/store-tests.test.ts` holds the selection to the files that use a
door's exports, so a file reaching a door by some other path is a named
difference rather than a quiet absence. A reproduction against a real
Postgres needs an 18 of your own whose role may `create database`, migrated
by `db:migrate` alone, because that is the runner which records what it
applied and the tests copy what it recorded, so run it first:

```sh
DATABASE_URL_UNPOOLED=postgresql://... pnpm --filter @luke/web db:migrate
LUKE_STORE_TEST_DATABASE_URL=postgresql://... pnpm --filter @luke/web test:store
```

## The eve app root

The hosted brain's eve agent lives in `eve/`, beside `server/`, as a flat eve
app root with its own `package.json` (`@luke/eve`, a workspace member whose one
dependency is `eve`) and its evals under `eve/evals/`. The layout is
load-bearing for the deployment: eve resolves the directory that holds
`agent.ts` and declares `eve` as its app root, and writes its build output
there (`.vercel/output` under Vercel, `.output` locally), so the eve service's
root is `eve` and its build command is a plain `pnpm exec eve build`, run by
static-build in that root and read back from it. A directory named `agent`
under `apps/web` would resolve as eve's nested layout instead, with the app
root at `apps/web` and the output one level above where the service reads it,
which an earlier shape of this block relocated by hand through eve's internal
environment variables. The
agent still reaches `server/` by relative import and nothing else: neither
package depends on the other, so `pnpm install --filter @luke/web...` pulls
nothing of eve's and the web build never traces into `eve/` (the function
bundle guard refuses it). `tests/eve-layout.test.ts` runs the real build under
Vercel's marker and asserts where the output landed, so a dependency bump that
changed discovery fails the check rather than the deploy.

`eve/evals/brain-host.eval.ts` is the one end-to-end eval, and nothing local
runs it. `./scripts/check.sh` runs vitest over the workspaces
`vitest.config.ts` lists, and `@luke/eve` is not one of them; the eval is
`pnpm --filter @luke/web test:agent`, which writes through the real store
writer against the database `DATABASE_URL` names and so runs on CI's "Postgres
migrations and store" job alone, beside `test:store`, against that job's own
Postgres service container. A green `check.sh` says nothing about it, which is
worth knowing before a change to the brain host, the writer, or a schema
module it reads back through.

## The scheduled sweep

`server/routes/maintenance/sweep.ts` is what Vercel's cron calls:
`vercel.json` schedules it every minute (`* * * * *`) and
`server/function-durations.ts` gives its function group, `maintenance-sweep`,
a 60-second duration (`MAINTENANCE_SWEEP.MAX_DURATION_SECONDS` in
`server/hosted/maintenance-bounds.ts`). The logic lives in
`server/hosted/maintenance-sweep.ts`; the route, through
`server/maintenance-app.ts`, hands it the deployment's seams. Vercel crons run
only on production deployments.

The sweep ends what no request will, and it reads no word of any account.
It runs three things in turn and answers what each did: the purge of
conversations stamped deleted more than thirty days ago, which is what a
deleted plan's conversation comes to, counted as `purged`; the sweep over
turns still running an hour after they started
(`server/hosted/store/abandoned-turns.ts`, `TURN_ABANDON.AFTER_MS`), whose end
the relay never heard and which are settled as failed for `abandoned`
through the same write the relay's own end takes, at most fifty a sweep and
counted as `abandoned`; and the bound on a detached voice session described
under "How a session ends", which ends every open session whose device went
without a hang-up more than a minute ago on Luke's key, at most 20 a sweep and
each inside ten seconds, counted as `voice`. A deployment without the OpenAI
key opened no voice session and sweeps none.

The sweep needs `CRON_SECRET`, which Vercel sends as the bearer on every
scheduled call once it is set in the project; the same secret is the one the
voice function acts for an account under at eve's door ("The exchange on the
sessions route"). Without it the route answers 503 and the schedule is
simply off, the same kill switch every other hosted endpoint keeps; a wrong
bearer is 401, compared in constant time, and any method but GET is 405.
