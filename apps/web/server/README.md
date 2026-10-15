# Luke web server

## Database and auth workflow

Neon is provisioned through the Vercel integration. It supplies the pooled
`DATABASE_URL` for application traffic and `DATABASE_URL_UNPOOLED` for
migrations; the connection strings live nowhere in this repository. A table is
declared once, in the `packages/database/src/schemas/*.ts` module the query
builder reads it through, and `pnpm db:generate` writes the migration that
builds it from that module. "The data layer" below is the rest.
Better Auth is no exception, reaching its tables through its Drizzle adapter
over `packages/database/src/schemas/auth.ts` (see below), which is in the same barrel as
the eleven Luke-owned modules, so a migration that changes an auth column's type
changes that declaration too.

Every instant column is `timestamp with time zone` (migration 0026 moved the
last naive ones), so a JavaScript `Date` round-trips losslessly whatever zone
the host or the session sits in; `bigint` epochs stand where a table already
kept them, so a new table declares `timestamptz`.

For a new table or a changed one, edit the `packages/database/src/schemas/*.ts`
module that declares it, run `pnpm db:generate`, and commit the SQL file,
snapshot, and journal entry it writes under `packages/database/migrations/`
in the same commit, with whatever query modules under `server/` need it. The
vendored `drizzle` and `db-migrations` skills are the conventions: a text
column typed by `$type<>()` rather than a `pgEnum`, a surrogate key rather
than a new composite one, and an online index or a backfill handled the way
`db-migrations` lays out. Dropping a column means deleting it from that module: the
drift check reads the database both ways, so a declaration the database no
longer carries fails it exactly as a column no module declares does. It takes
two deployments, because a build migrates while the deployment before it still
serves and Drizzle names every declared column in an insert. The first
deletes the declaration, runs `pnpm db:generate`, empties the `DROP COLUMN`
out of the SQL file it writes (its snapshot already records the column gone),
and lists the column in the drift check's `PENDING_DROP`. The second, once the
first is live, runs `pnpm db:generate --custom --name=<table>_drop_<column>`,
writes `DROP COLUMN IF EXISTS` into the file it gets, and deletes the entry.

Vercel runs `pnpm db:migrate` before every deployment build, using the direct
connection Neon supplies for that deployment. No lock of its own: Drizzle's
batch of migrations is one transaction (the one-time history transfer before
it commits in its own), nothing serializes two runs, and running one
migration process per branch database at a time is the deploy's to keep.

What applies them is Drizzle's own Effect migrator, through
`packages/database/src/core/migrator.ts`: it applies every folder under
`packages/database/migrations/` that `public.__drizzle_migrations` does not
name, in folder-name order, and records each by name, which is what makes a
second deploy a no-op and a branch's older migration still apply after main's
newer ones. Before it runs, a database the old `effect/sql` runner migrated has
that runner's `effect_sql_migrations` history copied across once, under the
folder each old tag moved to (`packages/database/README.md`). The table sits
in `public` because `20261013123642_dead_tables_drop` drops the `drizzle`
schema, where an earlier Drizzle runner kept it. The Neon integration
creates a database branch for each Preview deployment, so its committed schema
changes are applied to the matching branch before Vite builds the application.
No package lifecycle hook runs migrations.

The auth service also needs `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`,
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GITHUB_APP_CLIENT_ID`, and
`GITHUB_APP_CLIENT_SECRET`; the GitHub App beneath the last two is described
under "The Luke GitHub App" below.

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

Better Auth runs on its Drizzle adapter over `packages/database/src/schemas/auth.ts`
(`packages/service/src/auth/auth-database.ts`), not its Kysely one: the migrations declare the
OAuth tables' `scopes`, `redirect_uris`, `grant_types`, and `response_types`
as `text[]`, which the Drizzle adapter writes as native arrays and the Kysely
adapter as JSON strings Postgres refuses. `auth-database.test.ts` writes an
access token through the adapter over PGlite to hold the two together.

The organization plugin's tables (`organization`, `member`, `invitation`, and
`session.active_organization_id`) are transcribed into
`packages/database/src/schemas/auth.ts` from `auth generate` for 1.6.29 with
one edit, instants through `timestamptz()`, and migration
`20261013230002_organization` is drizzle-kit's from that module. They keep
Better Auth's default model names, since the Drizzle adapter finds a model by
its export's name. A Luke workspace is an
`organization` and its team the `member` rows, under the plugin's default
roles `owner`, `admin`, and `member`. A desktop caller holds an OAuth token and
no Better Auth session, which every member and organization endpoint requires,
so a hosted route reads membership through Drizzle over these tables and
writes only through the plugin's server-only `auth.api.createOrganization`
(with a `userId` and no headers) and `auth.api.addMember`. Never call either
inside `client.withTransaction`: Better Auth writes over its own pool, outside
the fiber's `SqlClient`. `auth-database.test.ts` creates a workspace and adds a
member through the plugin over PGlite.

Every account gets a first workspace made for it, called "Personal" (one
made before 2026-10-15 kept the account's name), slugged `personal-<user id>`, with `{"personal":true}` as its metadata text
(stored only; nothing reads it to behave differently), and named the
account's by a `personal_workspace` row
(`packages/database/src/schemas/personal-workspace.ts`; its generated migration
is followed by a custom one that backfills one for every account lacking it in
one data-modifying statement). `packages/database/src/models/workspace-store.ts`'s
`ensurePersonalWorkspace` makes it the first time it is asked for, through
`models/workspace-seams.ts`'s
`createOrganization` over the plugin, so its organization and owner rows are
the plugin's own; no transaction encloses it, so two Macs ensuring at once
settle on the unique slug and the row's primary key, and the one the plugin
refuses adopts the workspace under the slug. `listWorkspaces` answers every
workspace the account is a member of, its first one first and the rest by
name. `tests/workspace-store.test.ts` holds the three. That row is only how a
plan start or a repository listing that names no workspace finds the
account's default; the workspace is otherwise one like any other: it takes
invitations, its members are read, removed, and left, and it connects GitHub,
on the same rules as every workspace. The user row's cascade takes the
`personal_workspace` row and the account's `member` rows and leaves the
organization standing, as it leaves every workspace the account owned.

Every plan belongs to one workspace: `plan.organization_id`, not null and
cascading with the organization (`20261013231728_plan_organization` adds the
column nullable, the custom `20261013231735_plan_organization_backfill` after
it moves every plan standing into its starter's first workspace, and
`20261013231809_plan_organization_not_null` then sets the column not null). A plan's summary on the wire names it as `workspaceId`.
`memberOfWorkspace` is the one membership condition, a `member` row, which a
statement joins into its own where clause. A plan is read and written by
every member of its workspace, whichever of them started it:
`planReachableBy` and `reachablePlan` gate every plan statement in
`plan-store.ts`, `board-store.ts`, `plan-pages.ts`, `transcript-store.ts`,
and `plan-revisions.ts`, and the voice door's `heldPlan`, on the caller's
membership of the plan's workspace rather than on the plan's starter. Past
that gate a shared plan's transcript and a new call's earlier calls are
every member's calls about it.

A plan's conversation keeps the member who opened it as its `user_id`, the
address its messages, turns, and asks are written under, and is reached by
every member of the plan's workspace: `conversationReachableBy` in
`packages/database/src/models/recorded-session.ts` admits a member of the
workspace of the plan or coding agent naming the conversation, or naming its
standing parent one hop up (a subagent's session), and the opener alone for a
conversation no plan or agent names, so a member who leaves the workspace
leaves its conversations with it. The eve doors
(`brain-host/door.ts`), the two hosts' admission (`brain-host/conversation.ts`,
which answers the caller beside the conversation's owner), and the ask door
all read it, so a member speaks into the session a teammate opened. From
there the caller and the owner are two ids: the planning brain's inference
and research are metered to the caller, not the conversation's owner, and
the plan, the board, every tool binding, an integration's grant, and a
worker's title are read, written, and metered as the caller, while the
writer, the seed, and the relay address the owner's rows.
A voice call is the caller's `voice_sessions` row and meter, landing in the
plan's one conversation, which `openPlanConversation` answers with its
opener. A coding agent still runs on its starter's provider keys and GitHub
token, and its steps are its starter's spend, whichever member messages it.

A workspace's members are read, removed, and left through
`packages/service/src/accounts/workspaces-app.ts`. `GET /api/workspaces/members?workspaceId=`
answers a workspace's members to a member under the Mac's OAuth token, read
through Drizzle (`packages/service/src/accounts/workspace-members.ts`), owners first, then admins,
then members, since the plugin's own `listMembers` takes a session.
`POST /api/workspaces/members/remove` lets an owner or an admin remove a
member who is not an owner, and `POST /api/workspaces/leave` lets anyone but
an owner leave. Both are the plugin's own `removeMember` and
`leaveOrganization` (`memberSeams` in `workspace-seams.ts`), called with the
request's headers, which carry the Mac's own Better Auth session as a signed
bearer token that the bearer plugin reads as the session cookie. So these two
paths take the session, not the OAuth token, and the plugin checks the
caller's role and membership again behind Luke's own rules. A workspace the
account is not in is `not-found`; a role that does not allow it,
`not-permitted`; a session the service does not take,
`invalid-token`, which is the Mac's cue to ask for a new one through the
hand-off page (`desktop-session.html`). `packages/service/src/accounts/workspaces-app.test.ts` holds
each over the plugin on PGlite, and `packages/service/src/accounts/member-seams.test.ts` the
plugin's own refusals.

Dynamic client registration stays disabled. One public client is compiled in:
**`luke-desktop`** (`packages/service/src/auth/oauth-clients.ts`), the macOS companion app. It
accepts loopback callbacks (`http://127.0.0.1/callback`) via a local HTTP server
during sign-in, holds no client secret, requires PKCE, and skips consent as a
trusted first-party app.

Google's callback is `${BETTER_AUTH_URL}/api/auth/callback/google`; GitHub's is
`${BETTER_AUTH_URL}/api/auth/callback/github`. The GitHub provider requests no
OAuth scope (`GITHUB_SIGN_IN` in `packages/service/src/auth/auth-policy.ts`): it is a GitHub App's
user authorization, and a GitHub App has permissions rather than scopes, the
App's "Email addresses: read" among them, which is what answers the email
read Luke requires for its account snapshot, and what Better Auth's GitHub
provider reads to link the account at all.

Accounts link (`accountLinking` in `ACCOUNT_TOKEN_STORAGE`,
[Better Auth: account linking](https://www.better-auth.com/docs/concepts/users-accounts#account-linking)).
A sign-in through a provider that verified the same email address as an
existing account joins that account, Better Auth's default, and no provider
is trusted beyond that (`trustedProviders` stays unset; the docs warn it
risks account takeover). A signed-in account may also link GitHub to itself
through Better Auth's own `/link-social`, whatever email address GitHub holds
(`allowDifferentEmails`), which is how an account made with Google comes to
hold the GitHub its workspaces and repositories need; `/link-social`,
`/unlink-account`, and `/list-accounts` stay open, since none of them answers
a token. A user revoking the App's authorization on GitHub deletes that
GitHub user's account row (`github_app_authorization` under "The Luke GitHub
App" below).

## How the functions deploy

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
scripts' — and the exports of `@luke/features`'s paths module, evaluated, must
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
It runs by hand, against an address or a commit's preview found through its
GitHub deployment record (`server/preview-deployment.ts`); CI does not run
it, since a PR's preview could take twenty minutes to appear or never come. The
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

The Vercel project is three services in one deployment, declared under `services`
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
`coder` is the coding-agent service, a second eve app root at `coder/` built
and deployed on the same terms ("The coding-agent service" below).
Public routing is the top-level `rewrites`:
`/eve/coder/v1/*` enters the coder service, `/eve/v1/*` the eve service, and
everything else the web service, and a
service's own routes run only once a request has entered it. That is why the
generated `/api/` rewrites live under the web service's `routes` and the
generator (`server/function-rewrites.ts`) refuses a `routes` key at the top
level beside `services`: Vercel ignores one there rather than erroring, so a
file generated into the old location would pass every check and 404 every
`/api/` route in production. The project's
environment variables reach all three services alike, and each service's own
`ignoreCommand` is what skips its build, so a commit that changes nothing under
`apps/web`, `packages`, or the workspace manifests deploys none of them.

## The data layer

Drizzle is the statement layer and nothing else. A query module builds its
statement with the query builder over the tables its own
`packages/database/src/schemas/*.ts` module declares, on the `Database`
service `packages/database/src/core/query.ts` names: Drizzle's own Effect
driver, `drizzle-orm/effect-postgres` over the same `PgClient` a raw `sql`
statement runs on (`drizzle-orm/effect-pglite` over `@effect/sql-pglite` in
the store's tests). So a module answers `Effect<A, QueryError |
Schema.SchemaError, DatabaseServices>` — `QueryError` being a raw statement's
`SqlError` or the driver's `EffectDrizzleQueryError` around one — a Drizzle
statement lands inside whatever `client.withTransaction` encloses it rather
than beside it on a second connection, and one module still runs on both
dialects. Only
`packages/database/src/core/migrator.ts` is raw by design: its six statements are
dialect metaprogramming over the journal rather than domain queries. A tagged
template anywhere else is a leftover, not a pattern.

`packages/database/src/core/query.ts` holds the `Database` service, its
layer over the runtime's `PgClient` (provided beside the `SqlClient` by
`packages/service/src/db/sql-client.ts`, `core/sql-client.ts`, and `getTestDB()`), and
`queryBuilder`, the session-less builder a subquery or a `with` clause is
rendered with outside any statement. A module reads the database as
`const db = yield* Database` in a generator, or `Database.use((db) => ...)`
where a statement is one expression. It takes no `relations` config, because nothing reaches
Drizzle's relational queries: a statement is the `db.select()` builder, never
`db.query`, as the `drizzle` skill has it. The tables a statement names are
named imports from their own module
(`import { plan } from "@luke/database/schemas/plan"`), never the barrel,
which is what makes a renamed column a type error at the call site.

The builder hands back the statement's rows, not a guarantee about them, so a
row is still decoded by an Effect `Schema`, where lobehub's examples reach for
`drizzle-zod`: Effect takes no zod schema, and every other boundary value here
is declared as a `Schema` already. `SqlSchema`'s `execute` takes the statement
as the Effect the driver's builder already is, read off the service:

```ts
const findPlans = SqlSchema.findAll({
  Request: Schema.String,
  Result: PlanRowSchema,
  execute: (userId) =>
    Database.use((db) =>
      db
        .select(PLAN_COLUMNS)
        .from(plan)
        .where(eq(plan.userId, userId))
        .orderBy(desc(plan.createdAt), desc(plan.id)),
    ),
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

The schema modules are the source of truth. `pnpm db:generate` runs
`drizzle-kit generate` (`packages/database/drizzle.config.ts`, `strict`) and
writes the migration that brings the newest snapshot under
`packages/database/migrations/meta/` up to the modules, which the Effect
migrator above applies; hand-edit the generated SQL only for what drizzle-kit
cannot know, such as a backfill. `0095_snapshot.json` is the baseline the loop
restarted from: `0026`–`0094` were hand-written and carry no snapshot.
`packages/database/src/schemas/__tests__/migrations.test.ts` fails when a
module changes without its generated migration, and
`tests/drizzle-schema.test.ts` still compares the barrel against the
`information_schema` of a database `runWebMigrations` has just built, in both
directions, which is what catches a generated migration edited into
disagreement. The `$type<>()` unions name no Postgres type, so the module
itself is the only thing that holds them.

A migration that rewrites data the live release reads is expand and contract,
for the same reason a dropped column takes two deployments: a production build
migrates within seconds of its push and goes live up to an hour later, and the
release before it serves the migrated database all that while. So the first
deployment teaches every read to decode both the old shape and the new one,
and the second, once the first is live, carries the migration that rewrites
the rows. `0082_plan_template_teammate` shipped in one step, and the release
still serving refused every plan until its own build went live. Each read
projects only the columns it answers (`plan-store.ts`'s list reads no part of
the document), so a rewrite reaches only the reads of what it rewrote.

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
`HttpClient` over `fetch`, and the `SqlClient` of `packages/service/src/db/sql-client.ts` over
the database `DATABASE_URL` names. `@effect/platform-node` is not on it, and
`repository-checks.sh` refuses that specifier and `effect/sql` in the
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
Drizzle `Database` of "The data layer" above included, so the edge serving a
request is the one place the client behind it is provided. The hosted store's
query modules are on it, the store writer and the voice writer among them.
Outside `packages/database/src/models/`, `packages/database/src/models/plan-store.ts` is on the same
client, and `packages/database/src/models/voice-session-record.ts` is on it whole, each of its five methods
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

A test reads the same client through `@luke/database/testing`, which
chooses its dialect the way its `hosted-store-database.ts` does:
PGlite in process, so `check.sh` needs no service, or the Postgres named by
`LUKE_STORE_TEST_DATABASE_URL`, which the CI job points at its service
container. The Postgres half is the production layer's own client; the PGlite
half is a small `SqlClient` over `@electric-sql/pglite`, because no
`@effect/sql-pglite` ships against the 3.x Effect line.

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
`server/routes/account/delete.ts`, `preferences.ts`, and `plan-template.ts`,
the plans group's four, and the dashboard's five behind the admin group are
converted this way; the voice route alone exports something else, the
`http.Server` described under "Hosted voice service".

`packages/service/src/http/http-effect.ts` is the response vocabulary that conversion
speaks: one schema per refusal, each annotated with the status it answers, and
`readJsonBodyEffect` reading a bounded body off the request stream. A refusal is declared as its body
rather than as a `Schema.TaggedError`, because `error` is already the
discriminant the desktop's hosted clients read and a `_tag` beside it would be
a byte they never asked for.

## The events and maintenance groups

`packages/service/src/events/events-app.ts` and `server/maintenance-app.ts` are two route groups of
one path each — `server/routes/events.ts` mounts `eventsApp()` and
`server/routes/maintenance/sweep.ts` mounts `maintenanceApp()` — since
`vercel.json` already sends each function only the requests for its own path.
Each path is declared with `HttpRouter.add` under `ANY_METHOD` rather than a
method-specific builder, because each handler still enforces its own method
and answers its own 405 exactly as it did before conversion; only a path
neither declares reaches the group's own wildcard route, `hostedNotFoundRoute`,
and the hosted vocabulary's `not-found`. Each handler's own logic is carried
unchanged — `packages/service/src/events/events.ts` and `server/hosted/maintenance-sweep.ts` —
behind a passthrough shaped like the auth group's (`effectPassthrough` in
`packages/service/src/http/http-effect.ts`): the `HttpServerRequest` becomes the `Request`
the handler always took, and its `Response` is carried back with
`HttpServerResponse.raw`.
`packages/service/src/events/events-app.ts` holds one query of its own, the events handler's
PostHog person read (`readPerson`), a `SqlSchema` query whose builder renders
against the auth schema module and runs on the ambient `SqlClient`.

## Signing in on a Preview deployment

A Preview deployment answers on hostnames minted for the branch, so
`packages/service/src/auth/auth-deployment.ts` reads the deployment's own address rather than
assuming one: on a Preview, `VERCEL_URL` is the base URL and `VERCEL_BRANCH_URL`
joins it as a trusted origin, and `BETTER_AUTH_URL` stays what it has always
been, the production address whose callback the two providers registered.
Without this a preview refuses its own sign-in before it reaches a provider at
all — Better Auth trusts the origin of its own base URL, and the browser on a
preview sends the preview's, which is the 403 behind the admin dashboard's
"Sign-in could not start. Try again."

On a Preview the desktop's pending authorization resumes on its own: the
provider plugin stores the desktop's signed authorize request with the sign-in's
OAuth state, the proxy restores that state when the profile lands, and the
provider plugin then issues the code to the desktop's loopback.

Better Auth's `oAuthProxy` plugin carries the rest, installed on every
deployment exactly as its docs configure it (`productionURL` and the shared
`secret`): the preview hands the provider production's registered redirect URI,
production exchanges the code and redirects the profile back to the preview
encrypted, and the preview creates the session in its own Neon branch database.

The Preview environment needs `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`,
`BETTER_AUTH_PROXY_SECRET`, Google's `GOOGLE_CLIENT_ID` and
`GOOGLE_CLIENT_SECRET`, and the GitHub App's `GITHUB_APP_ID`,
`GITHUB_APP_SLUG`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, and
`GITHUB_APP_PRIVATE_KEY`, the same values production holds. Production is the end that
exchanges the code, but Better Auth's Google provider refuses to build the
authorization URL without a client secret, so a Preview without
`GOOGLE_CLIENT_SECRET` answers 500 to every Google sign-in before the browser
leaves for Google (found 2026-09-18); Better Auth's own oauth-proxy setup sets
the provider secrets in every environment, and Charles chose on 2026-09-18 to
follow it rather than hold them back from Preview; the preview then builds its own Google URL and production still exchanges the code. `BETTER_AUTH_PROXY_SECRET` has to hold the same dedicated value on both
ends, or the profile arrives undecryptable; without it Better Auth derives the
proxy's keys from `BETTER_AUTH_SECRET`, which differs per deployment, so a
proxied sign-in cannot complete.

The proxy secret is an authentication credential for every deployment that
holds it, production included, as Better Auth's own model says: the plugin
treats every holder of the secret as trusted. Every deployment, production too,
answers the plugin's profile-return endpoint (`/callback/:id/oauth-proxy`),
which creates a session from any profile encrypted with that secret, so the
secret every Preview holds can mint production sessions; and production relays
a profile and its provider tokens to whatever return the encrypted proxy state
names. Both were accepted for the MVP on 2026-10-13 in favour of running the
plugin as Better Auth prescribes. Treat the proxy secret as sensitive everywhere
it is stored, especially in Preview.

Every participant in the relay runs one Better Auth version. Better Auth 1.7
derives the proxy's keys from the secret per purpose and keys OAuth state rows
differently from 1.6, so a Preview on one cannot sign in through a production on
the other, and a sign-in begun before production's own upgrade must be started
again.

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
place to name one. `productEventBatchFromWire` in `@luke/features/analytics` is the whole
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
one atomic upsert before each upstream call (`packages/database/src/models/quota.ts`).
A dictated clip is counted once it is transcribed instead, as one call and its
seconds of audio in the row's `dictation_seconds`, beside the voice seconds
`voice_session_usage` keeps. Nothing is refused on the count, which the admin pages read; a spend limit on
the OpenAI project behind the key is the backstop and should be configured
with it.

## Hosted voice service

`server/routes/voice/sessions.ts` is the hosted voice service: one Vercel
Function serving WebSockets on Fluid compute, the part of this deployment
that holds the GPT Live project key and owns each hosted voice session
(`live-contract.ts` in `@luke/features` is the Mac's contract with it). The
file exports the `http.Server` that `server/voice/service.ts`'s
`voiceServer()` builds, with `ws` handling the upgrade on it, exactly as
Vercel's WebSocket guide has it; the Mac opens `wss://` on this deployment's own origin,
`HOSTED_VOICE_SERVICE_ORIGIN` in `@luke/features`, at `VOICE_SERVICE_PATH`.
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
client delegation, the plan the call is bound to, and the model it was
created on), attaches the trusted sideband, stands the hosted
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
`effect/socket`'s `Socket`, a fiber of that scope filling a mailbox with
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
graceful close — is `@luke/voice`'s `LiveSessionService`, behind that
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
voice writer (`packages/database/src/models/voice-writer.ts`). Every server event is
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
`packages/service/src/agents/brain-host/brain-ask.ts`, called with the resolved account, the spoken origin, and the
service's submission id as the client id, under the eve client the
composition built for the account as the deployment acting for it
(admitted for spoken turns by `DEPLOYMENT_TURNS`, below).
The run the service keys an exchange by is the ask's id, since eve names a
turn only once it starts; the brain follows the ask through `askStanding` on
a schedule, projects its turn's events with `projectTurnEvents`
(`packages/service/src/agents/turn-events.ts`), and translates each back to the ask's id. There is no HTTP hop
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
is told as a failed end so the exchange settles rather than waiting forever.
The bound is `LIVE_BRAIN_FOLLOW_BOUNDS` in `server/voice/live-brain.ts`: the
plain `FOLLOW`, ten minutes, past eve's own turn deadline with room for one
queued turn ahead, until the journal shows the turn handed work to the
`worker`, which eve runs as a task the planning turn parks on (`turn.waiting`)
and resumes from in the same turn once the findings land, minutes or longer
later. From that call on the follow runs under `PARKED_FOLLOW` instead: the
plain bound plus the sweep's `TURN_ABANDON.AFTER_MS`, an hour, at which a turn
still running is settled as failed on the record and the follow hears that end,
so following longer could hear nothing more. The record does not say when the
task settles — the relay tells nothing for the park and the findings reach the
journal as the steps after them — so the parked bound covers the turn from its
delegation, and the follow still stops the moment the turn completes, fails, or
is cancelled, or the socket's scope closes. On the eve
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
the plan's conversation resolved at the session's start, under whichever
member of its workspace opened it, the function's writer, eve reached as the
deployment for the calling account, and the plan's
notetaker (`packages/service/src/plans/plan-scribe.ts`), which runs only where the
deployment holds the OpenAI key.

eve is reached as the deployment acting for the one account the session
resolved at its handshake, since the function holds no bearer of the
account's by the time a delegation arrives. It calls eve's session routes
under the deployment's `CRON_SECRET` as its bearer with the account in
`x-luke-account`, and the eve door's first authenticator admits that pair as
a principal of the deployment's own type — the deployment's one id, the
account as its attribute — for a message naming a kind of turn its table,
`DEPLOYMENT_TURNS` in `packages/service/src/agents/brain-host/channel.ts`, admits (a spoken
turn) and for a cancel of a turn in a session, which is how the stop key's
`stopAsk` and the hook's carried Stop reach eve, and nothing else: any other
route or kind of turn carrying the secret is refused outright rather than
passed to the account authenticator behind it. Which account a request acts
for is one accessor over both principal types, and the door's ownership
checks and the host's admission read that answer, so the deployment can open
a turn only on a conversation the named account reaches and cancel one only
in a session a conversation that account reaches recorded. Where eve answers is an
origin of this deployment's own, whose rewrites carry `/eve/v1/*` into the
eve service (`deploymentEveOrigin` in `packages/service/src/agents/brain-host/eve-origin.ts`):
`LUKE_EVE_ORIGIN` where it is set, otherwise the project's production domain
in production and the deployment's own host on any other deployment.
Production names the custom domain rather than the generated `*.vercel.app`
host because that host carries the project's Vercel Authentication, which
answers a server-to-server POST at the edge and never reaches eve (LUKE-250).

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
`@luke/voice` does the reconnecting: three tries over about ten seconds,
sends made in the gap held for the next connection, and only after the last
failure does the host see the loss it already handles as `connection_lost`.

### How a session ends

While a signed-in session runs, every `session.usage.updated` overwrites the
row's `usage` with `{ seconds, confirmed: false }`, a snapshot and never a
sum. `session.closed` is finalization. Whichever connection sees it forwards
it, writes the row's `closed_at`, `close_reason`, and
`usage { seconds, confirmed: true }`, records `usage.seconds` through
`recordVoiceSeconds` in `packages/database/src/models/quota.ts`
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
bundle guard refuses it).

`eve/sandbox.ts` is the session's sandbox, a `VercelSandbox.environment`
whose `prepare` holds the one thing the checkout needs of eve's base image,
git; `eve build` prewarms its snapshot on Vercel, so the eve service's build
needs Vercel Sandbox credentials (the build's own `VERCEL_OIDC_TOKEN`, or
`VERCEL_TOKEN` with `VERCEL_TEAM_ID` and `VERCEL_PROJECT_ID`) and a prewarm
that fails stops the deployment. The running
service needs the GitHub App's five variables and `BETTER_AUTH_SECRET` as the
web functions do: `run_in_repository`'s checkout confirms the plan's
repository is reachable and mints its token through `GitHubApp`, which the
shared runtime builds from them (`server/runtime.ts`,
`githubAppFromEnvironment`), the session secret being what the account's
user token is sealed under.

`eve/evals/brain-host.eval.ts` is the planning brain's end-to-end eval, and nothing local
runs it. `./scripts/check.sh` runs vitest over the workspaces
`vitest.config.ts` lists, and `@luke/eve` is not one of them; the eval is
`pnpm --filter @luke/web test:agent`, which writes through the real store
writer against the database `DATABASE_URL` names. CI does not run it either, so
run it by hand before a change to the brain host, the writer, or a schema
module it reads back through.

## The scheduled sweep

`server/routes/maintenance/sweep.ts` is what Vercel's cron calls:
`vercel.json` schedules it every minute (`* * * * *`) and
`server/function-durations.ts` gives its function group, `maintenance-sweep`,
a 60-second duration (`MAINTENANCE_SWEEP.MAX_DURATION_SECONDS` in
`packages/service/src/maintenance/maintenance-bounds.ts`). The logic lives in
`server/hosted/maintenance-sweep.ts`; the route, through
`server/maintenance-app.ts`, hands it the deployment's seams. Vercel crons run
only on production deployments.

The sweep ends what no request will, and it reads no word of any account.
It runs three things in turn and answers what each did: the purge of
conversations stamped deleted more than thirty days ago, which is what a
deleted plan's conversation comes to, counted as `purged`; the sweep over
turns still running past their kind's bound, an hour for a planning turn
and a day and an hour for a coding agent's
(`packages/database/src/models/abandoned-turns.ts`, `TURN_ABANDON.AFTER_MS` and
`TURN_ABANDON.CODING_AGENT_AFTER_MS`), whose end
the relay never heard and which are settled as failed for `abandoned`
through the same write the relay's own end takes, at most fifty a sweep and
counted as `abandoned`; and the bound on a detached voice session described
under "How a session ends", which ends every open session whose device went
without a hang-up more than a minute ago on Luke's key, at most 20 a sweep and
each inside ten seconds, counted as `voice`. A deployment without the OpenAI
key opened no voice session and sweeps none.

It then fires the automations whose schedule is due ("Automations" below),
at most twenty-five a sweep, counted as `automations.fired`, and acts on
the runs still queued from the last hour, at most twelve a sweep and four
at once, counted as `automations.started`, `skipped`, and `failed`.

The sweep needs `CRON_SECRET`, which Vercel sends as the bearer on every
scheduled call once it is set in the project; the same secret is the one the
voice function acts for an account under at eve's door ("The exchange on the
sessions route"). Without it the route answers 503 and the schedule is
simply off, the same kill switch every other hosted endpoint keeps; a wrong
bearer is 401, compared in constant time, and any method but GET is 405.

