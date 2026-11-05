# Vespin web server

How `apps/web`'s server is built, deployed, and checked: its database, auth, `/api/` routes, and Vercel functions.

## Database and auth workflow

Neon is provisioned through the Vercel integration. It supplies the pooled
`DATABASE_URL` for application traffic and `DATABASE_URL_UNPOOLED` for
migrations; the connection strings live nowhere in this repository. A table is
declared once, in the `packages/database/src/schemas/*.ts` module the query
builder reads it through, and `pnpm db:generate` writes the migration that
builds it from that module. "The data layer" below is the rest.
Better Auth is no exception, reaching its tables through its Drizzle adapter
over `packages/database/src/schemas/auth.ts` (see below), which is in the same barrel as
the Vespin-owned modules, so a migration that changes an auth column's type
changes that declaration too.

Every instant column is `timestamp with time zone` (migration
`20260912073820_instants_timestamptz` moved the last naive ones), so a JavaScript `Date` round-trips losslessly whatever zone
the host or the session sits in; `bigint` epochs stand where a table already
kept them, so a new table declares `timestamptz`.

For a new table or a changed one, edit the `packages/database/src/schemas/*.ts`
module that declares it, run `pnpm db:generate --name=<what_it_does>`, and
commit the folder it writes under `packages/database/migrations/`, its
`migration.sql` and `snapshot.json`, in the same commit, with whatever query modules under `packages/database/src/models/` need it. The
conventions: a text column typed by `$type<>()` rather than a `pgEnum`, a
surrogate key rather than a new composite one, and an online index or a
backfill written as idempotent SQL. Dropping a column means deleting it from that module, and
it takes two deployments, because a build migrates while the deployment
before it still serves and Drizzle names every declared column in an insert.
The first deletes the declaration, runs `pnpm db:generate`, and empties the
`DROP COLUMN` out of the `migration.sql` it writes (its snapshot already
records the column gone). The second, once the first is live, runs
`pnpm db:generate --custom --name=<table>_drop_<column>` and writes
`DROP COLUMN IF EXISTS` into the file it gets.

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
under "The Vespin GitHub App" below.

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
OAuth client compiled into Vespin, which is what makes running it on every build
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
  pnpm --filter @repo/web auth:seed
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
its export's name. A Vespin workspace is an
`organization` and its team the `member` rows, under the plugin's default
roles `owner`, `admin`, and `member`. A desktop caller holds an OAuth token and
no Better Auth session, which every member and organization endpoint requires,
so a hosted route reads membership through Drizzle over these tables and
writes only through the plugin's server-only `auth.api.createOrganization`
(with a `userId` and no headers) and `auth.api.addMember`. Never call either
inside `client.withTransaction`: Better Auth writes over its own pool, outside
the fiber's `SqlClient`. `auth-database.test.ts` creates a workspace and adds a
member through the plugin over PGlite.

The admin plugin's columns (`user.banned`, `ban_reason`, `ban_expires`, and
`session.impersonated_by`, beside the `role` the migrations already held) and
the support-access plugin's `user.support_access_until`
(`packages/service/src/auth/support-access.ts`) are transcribed the same way,
from `auth generate` for 1.7.7, and migration
`20261105011320_admin_impersonation_support_access` is drizzle-kit's from that
module. The admin plugin is there for its impersonation alone: a maintainer
signs in as an account from the web for an hour, only while its member's grant
of support access stands, and every other admin endpoint is shut
(`auth-policy.ts`'s `DISABLED_AUTH_PATHS`). `support-access.test.ts` holds it
over PGlite.

Every account gets a first workspace made for it, named for the account,
slugged `personal-<user id>`, with `{"personal":true}` as its metadata text
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
name. Every read names an account's first workspace by its owner's name as
it stands now (`workspace-store.ts`'s `WORKSPACE_NAME`), to a teammate in it
too, so a renamed account renames it, and the account's name it was made
under stands only once the account is gone. One made as "Personal" on
2026-10-15 holds its owner's name too
(`migrations/20261015131300_personal_workspace_owner_name`), because Better
Auth's own invitation read says the name the organization holds. `tests/workspace-store.test.ts` holds the three. Beyond its name, that row is only how a
task start or a repository listing that names no workspace finds the
account's default; the workspace is otherwise one like any other, but that
it is never renamed: it takes
invitations, its members are read, removed, and left, and it connects GitHub,
on the same rules as every workspace. The user row's cascade takes the
`personal_workspace` row and the account's `member` rows and leaves the
organization standing, as it leaves every workspace the account owned.

Every task belongs to one workspace: `task.organization_id`, not null and
cascading with the organization (`20261013231728_plan_organization` adds the
column nullable, the custom `20261013231735_plan_organization_backfill` after
it moves every task standing into its starter's first workspace, and
`20261013231809_plan_organization_not_null` then sets the column not null). A task's summary on the wire names it as `workspaceId`.
`memberOfWorkspace` is the one membership condition, a `member` row, which a
statement joins into its own where clause. A task is read and written by
every member of its workspace, whichever of them started it:
`taskReachableBy` and `reachableTask` gate every task statement in
`task-store.ts`, `plan-pages.ts`, and `plan-revisions.ts`, on the caller's
membership of the task's workspace rather than on the task's starter.

A plan's pictures are its own rows, `plan_attachment`, with their bytes in a
`bytea` column held to `PICTURE_BOUNDS.MAX_BYTES` (`@repo/features/picture-wire`),
or to `MAX_VIDEO_BYTES` for a WebM an agent recorded
(`packages/database/src/models/plan-attachments.ts`), gated by the same
`taskReachableBy`. `POST /api/plans/<id>/attachments { picture }` keeps one, a
`data:` URL of a PNG, JPEG, WebP, or WebM whose bytes sniff as its label, on a plan
that is not archived and holds fewer than `MAX_PER_PLAN`, and, for a WebM,
fewer than `MAX_VIDEOS_PER_PLAN` videos, answering `{ id }`
or `{ refused: "too-many" }` or `{ refused: "too-many-videos" }`; `GET /api/plans/<id>/attachments/<picture>`
serves the bytes under their sniffed type, `nosniff` and `private, no-store`,
to a member alone, anyone else reading `not-found`. The plan's text names a
picture by its address (`@repo/features/plan-attachment-link`), which
`savePlanText` reads to stamp the picture `saved_at`, and the scheduled sweep
deletes, a day on, a picture no save stamped.

An agent's conversation keeps the member who started it as its
`user_id`, the address its messages, turns, and asks are written under, and
is reached by every member of the agent's workspace: `conversationReachableBy`
in `packages/database/src/models/recorded-session.ts` admits a member of the
workspace of the agent naming the conversation, or naming its standing
parent one hop up (a subagent's session), and the opener alone for a
conversation no agent names, so a member who leaves the workspace leaves its
conversations with it. The MCP door's admission
(`packages/service/src/agents/workspace-mcp/bearer.ts`, which answers the caller
beside the conversation's owner) and the ask door read it, so a member speaks
into the session a teammate opened. From there the caller and the owner are
two ids: the task, every tool binding, and an integration's grant are read,
written, and metered as the caller, while the writer addresses the owner's
rows.
An agent still runs on its starter's provider keys and GitHub
token, and its steps are its starter's spend, whichever member messages it.

A workspace's members are read, removed, and left, and a workspace renamed or given a photo, through
`packages/service/src/accounts/workspaces-procedures.ts`, on the hosted oRPC
router; `workspaces-app.ts` beside it serves only the photo's bytes. `GET /api/workspaces/members?workspaceId=`
answers a workspace's members to a member under the Mac's OAuth token, read
through Drizzle (`packages/service/src/accounts/workspace-members.ts`), owners first, then admins,
then members, since the plugin's own `listMembers` takes a session.
`GET /api/workspaces/<id>/photo` serves a workspace's photo, kept as a
`data:` URL in the organization plugin's own `logo` column, as its bytes under
its type, to a member alone, `nosniff` and `private, no-store`; a non-member,
and a workspace with no PNG, JPEG, or WebP photo, read `not-found`. The list
carries only a digest of it as `photoVersion`, and the account's own first
workspace with none carries the account's sign-in picture as `pictureUrl`
where it is Google's or GitHub's (`@repo/features/account-picture`).
`POST /api/workspaces/members/remove` lets the owner remove an admin or a
member and an admin a member alone, `POST /api/workspaces/members/role
{ workspaceId, userId, role }` lets the owner alone make another member an
admin or an admin a member, and `POST /api/workspaces/transfer { workspaceId,
userId }` lets the owner alone hand the workspace to an admin, becoming an
admin, but for an account's first workspace; each answers `{ members }`, and
none acts on the caller, whose way out is leaving, or on an owner.
A handover is two of the plugin's role writes, the heir made owner first, so
one cut short leaves two owners rather than none, and trying again finishes
it. `POST /api/workspaces/leave` lets anyone but
an owner leave, and `POST /api/workspaces/rename { workspaceId, name }` lets
an owner or an admin rename a workspace, answering `{ workspace }` under its
new name and the slug it already had, but for an account's first workspace,
which the list marks `personal` to every member of it and whose rename is
refused as `not-permitted`, because it is named by its owner's account name, and
`POST /api/workspaces/slug/set { workspaceId, slug }` lets the owner alone
change its slug, under the Mac's OAuth token, answering `{ workspace }` under
the new one, and refusing a slug spelled otherwise as
`workspace-slug-malformed`, one of `RESERVED_WORKSPACE_SLUGS` or opening
`personal-` as `workspace-slug-reserved`, and one another workspace stands
or stood under, whatever its case, as `workspace-slug-taken`; the slug it
leaves stays the workspace's (`workspace-slug-store.ts`), so a link written
under it still names it, and
`POST /api/workspaces/photo/set { workspaceId, photo }` lets an owner or an
admin set its photo, a `data:` URL of a PNG, JPEG, or WebP of at most
`WORKSPACE_PHOTO_BOUNDS.MAX_BYTES` decoded, or remove it with `null`,
answering `{ workspace }` with its new `photoVersion` or none; any other
photo is `invalid-request`. They are the plugin's own
`removeMember`, `updateMemberRole`, `leaveOrganization`, and `updateOrganization` (`memberSeams`
in `workspace-seams.ts`, the last handed the name alone or the logo alone), called with the
request's one credential (`packages/service/src/auth/session-credential.ts`):
its `Authorization` alone wherever it carries one, which carries the Mac's own
Better Auth session as a signed bearer token that the bearer plugin reads as
the session cookie, and the browser's cookie only where it carries none, so a
bearer the plugin did not sign is never read past to a cookie beside it. So these six
paths take the session, not the OAuth token, and the plugin checks the
caller's role and membership again behind Vespin's own rules. A workspace the
account is not in is `not-found`; a role that does not allow it,
`not-permitted`; a session the service does not take,
`invalid-token`, which is the Mac's cue to ask for a new one through the
hand-off page (`desktop-session.html`). `packages/service/src/accounts/workspaces-app.test.ts` holds
each over the plugin on PGlite, and `packages/service/src/accounts/member-seams.test.ts` the
plugin's own refusals.

Dynamic client registration stays disabled. One public client is compiled in:
**`desktop`** (`packages/service/src/auth/oauth-clients.ts`), the macOS companion app. It
accepts loopback callbacks (`http://127.0.0.1/callback`) via a local HTTP server
during sign-in, holds no client secret, requires PKCE, and skips consent as a
trusted first-party app.

Google's callback is `${BETTER_AUTH_URL}/api/auth/callback/google`; GitHub's is
`${BETTER_AUTH_URL}/api/auth/callback/github`. The GitHub provider requests no
OAuth scope (`GITHUB_SIGN_IN` in `packages/service/src/auth/auth-policy.ts`): it is a GitHub App's
user authorization, and a GitHub App has permissions rather than scopes, the
App's "Email addresses: read" among them, which is what answers the email
read Vespin requires for its account snapshot, and what Better Auth's GitHub
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
GitHub user's account row (`github_app_authorization` under "The Vespin GitHub
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
scripts' — and the exports of `@repo/features`'s paths module, evaluated, must
resolve to an extensionless alias the Build Output emits, a rewrite of the
table ahead of its fallback, or a procedure of the hosted oRPC contract, and a
builder the check cannot read is refused by name rather than
skipped, because a path constant that outlives its route otherwise fails
nothing until production answers 404. The same derived list is
what `scripts/preview-probe.ts` (`server/preview-probe.ts`) sends to a
deployment: every caller path, the cron's, and the page, failing
on any answer that is Vercel's own rather than a handler's — the
`x-vercel-error` header the platform puts on its `NOT_FOUND`, which a
function's own 404 never carries — with the requests `EXPECTED_STATUS` names
held to their exact codes besides, an unknown `/api/` path to the router's
JSON 404 body among them, because on 2026-09-11 five production deploys
failed in a row while nothing in CI could see the deployed shape.
Behind Deployment Protection it needs one of two doors, the bypass secret
sent as a header or the OPTIONS allowlist, and names which it relies on.
It runs by hand, against an address or a commit's preview found through its
GitHub deployment record (`server/preview-deployment.ts`); CI does not run
it, since a PR's preview could take twenty minutes to appear or never come. The
table is its own file, and the root `vercel.json` is assembled from it.
`server/feedback.mjs` is the one
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
function loads here and fails on production.

Each bundle's external imports are recorded in `server/function-externals.json`,
generated by `pnpm functions:externals` and compared as data: the test bundles
every function unwritten and asserts the whole map, naming the bundle and the
added or removed package. Under inline-first bundling the map holds Node's builtins and
the three exceptions, and the signal it keeps is a fourth external appearing.
Reachability reads a different field: `bundlesReaching` walks the metafile's
inputs for a module, so an import esbuild inlined counts exactly as one it left
external, and the build (`scripts/bundle-functions.ts`) uses it to ship the
agent runner's bundle beside each function that reaches its reader.

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
served both spellings and the clients use the second: the terminal relay opens
at `/api/terminal/sessions` and the desktop posts feedback to
`/api/feedback`. Reverting the PR that introduced the tree is one
commit with no migration and no dashboard state, and the deploy shape returns
to Vercel's own pass.

The Vercel project is one service, declared under `services` in the
repository root's `vercel.json`, which Vercel reads at the project's Root
Directory (the repository root, so the service's `root` is relative to it)
and only while the project's Framework Preset is Services. `web` is this
app, rooted at `apps/web`, and carries the migrate-and-seed
build, the install filter, the ignore rule, and the `routes` above unchanged.
Public routing is the top-level `rewrites`, which send every request into
the web service, and a
service's own routes run only once a request has entered it. That is why the
generated `/api/` rewrites live under the web service's `routes` and the
generator (`server/function-rewrites.ts`) refuses a `routes` key at the top
level beside `services`: Vercel ignores one there rather than erroring, so a
file generated into the old location would pass every check and 404 every
`/api/` route in production. The project's
environment variables reach the service. The project's Ignored Build
Step (`scripts/vercel-ignore.sh`), not the service's own `ignoreCommand`,
which Vercel does not act on, is what skips the build, so a commit that changes
nothing the service ships (the workspaces it reaches, the workspace manifests,
or `vercel.json`) deploys nothing. A Vercel `vercel.ts` is not used: Vercel's Git builds refuse a
`{ service }` destination in a `vercel.ts` (`rewrites[0].destination should be
string`, #2838) although `vercel.json` takes the same rewrites.

## The local server

`pnpm --filter @repo/web local-server --port <n>` (`scripts/local-server.ts`)
serves the same routes from this machine, on 127.0.0.1 alone, over the
database `DATABASE_URL` names. It builds each grouped function's dispatcher
over the route modules where they stand, as the generated bundle entry does,
and lands each request by `api-rewrites.json` through the same replay the tests
use (`server/local-deployment.ts`, `server/platform-landing.ts`). Every path no
rewrite takes is the site's, which Vite serves in middleware mode from the page
the web service's page routes in `vercel.json` land it on, as `/app` and a
workspace's links land on `app.html`, without those routes' headers. The three
WebSocket functions and the feedback courier are not served, and the scheduled
sweep is called in process on the cron's cadence under `CRON_SECRET`.

It refuses to start beside any `VERCEL*` variable or over a database host off
the loopback (`@repo/service/local/local-server-guard`), and imports no route
until it has, because the auth service reads the environment as it loads. Where
`BETTER_AUTH_URL` is unset it names the server's own address there first. A
route that only the local server answers mounts in the entry's `localRoutes`
and never under `server/routes/`, so no deployed function reaches it.

The one such route is the demo's sign-in (`server/local-sign-in.ts`), which
answers `/sign-in` in the page's place: it mints a session for the member
the demo seed writes, records its way in as a sign-in does (the provider the
desktop's `state` names, or GitHub; the web app reads it to count a session
signed in), sets Better Auth's session cookie, and sends the browser
back to authorize on the query the provider signed, less `prompt=login`, so the
desktop's sign-in completes to its loopback with no provider. A bare
`/sign-in` lands on `/app` signed in. Each request reads the environment
again and is refused where the server would have refused to start, and no
function's bundle may reach the module: `localOnlyReach`
(`server/function-bundles.ts`) fails `tests/vercel-functions.test.ts` and the
deploy's bundle step on one that does.

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
(`import { task } from "@repo/database/schemas/task"`), never the barrel,
which is what makes a renamed column a type error at the call site.

The builder hands back the statement's rows, not a guarantee about them, so a
row is still decoded by an Effect `Schema`, where Drizzle's usual answer is
`drizzle-zod`: Effect takes no zod schema, and every other boundary value here
is declared as a `Schema` already. `SqlSchema`'s `execute` takes the statement
as the Effect the driver's builder already is, read off the service:

```ts
const findTasks = SqlSchema.findAll({
  Request: Schema.String,
  Result: TaskRowSchema,
  execute: (userId) =>
    Database.use((db) =>
      db
        .select(TASK_COLUMNS)
        .from(task)
        .where(eq(task.userId, userId))
        .orderBy(desc(task.createdAt), desc(task.id)),
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
writes the `packages/database/migrations/<UTC timestamp>_<name>/` folder that
brings the newest snapshot up to the modules, which the migrator above
applies; hand-edit the generated SQL only for what drizzle-kit cannot know,
such as a backfill.
`./scripts/check.sh` fails when a module changes without its generated
migration, by running `drizzle-kit generate` and refusing any folder it
writes, and
`tests/drizzle-schema.test.ts` still compares every declared column's type and
nullability against the `information_schema` of a database `runWebMigrations`
has just built, which is what catches a generated migration edited into
disagreement. The `$type<>()` unions name no Postgres type, so the module
itself is the only thing that holds them.

A migration that rewrites data the live release reads is expand and contract,
for the same reason a dropped column takes two deployments: a production build
migrates within seconds of its push and goes live up to an hour later, and the
release before it serves the migrated database all that while. So the first
deployment teaches every read to decode both the old shape and the new one,
and the second, once the first is live, carries the migration that rewrites
the rows. `20261006072320_plan_template_teammate` shipped in one step, and the release
still serving refused every task until its own build went live. Each read
projects only the columns it answers (`task-store.ts`'s list reads no part of
the document), so a rewrite reaches only the reads of what it rewrote.

## Where a function runs an Effect

`server/runtime.ts` holds the one `ManagedRuntime` this app has, memoized at
module scope, and `runWeb(effect)` is the only place `apps/web` runs an effect.
The layer it builds, `webServices`, is `@repo/service/runtime`'s, which runs
nothing.
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
isolation guard proves it loads. A function is handed no shutdown
hook — an instance is frozen between invocations and discarded without notice —
so nothing in production disposes the runtime; `disposeWebRuntime()` exists so a
test can end the one it started.

The `SqlClient` is `PgClient.layer` over the connection string `DATABASE_URL`
names, its pool held to the same `POOL_LIMITS` the `pg.Pool` behind Better
Auth's Drizzle adapter is built to, `DATABASE_POOL_SIZE` (five) connections per
warm instance, so the two pools on the one database cannot drift apart on how much of Neon's pooler
a warm instance holds. The layer opens nothing while it builds: the pool keeps
no minimum and makes its first connection on the first statement, which
matters because this layer stands in the runtime every function shares and an
eager round trip would land on the cold start of the functions that never
query.

Every query module that reads or writes this database, each under
`packages/database/src/models/`, reads the
client out of the fiber it runs on rather than holding one of its own, the
Drizzle `Database` of "The data layer" above included, so the edge serving a
request is the one place the client behind it is provided. The hosted store's
query modules are on it, the store writer and `task-store.ts` among them.
`hostedStore()` takes no argument, and answers an
`Effect<A, SqlError | Schema.SchemaError, SqlClient>` from every method, so
the caller composes a store read into whatever it already runs. A route
group's own seams are effects
over that same ambient client — the account group's reads and writes and the
meter every hosted operation spends — so the group yields the seam on the
request's own fiber and the edge that serves the request is the one place the
client behind it is provided. What still holds a runner is everything a route
composes apart from the store and that still hands a promise up — the
writers — each handed its edge's own, `runWeb` in a
function and the store tests'
runtime in a test; the conversation row lock every write runs under is the
client's own transaction. What the layer does need at build
time is the connection string, so an instance configured without `DATABASE_URL`
is refused at the edge rather than at whichever query ran first.

A test reads the same client through `@repo/database/testing`, which
chooses its dialect the way its `hosted-store-database.ts` does:
PGlite in process, so `check.sh` needs no service, or the Postgres named by
`APP_STORE_TEST_DATABASE_URL`, which the CI job points at its service
container. The Postgres half is the production layer's own client; the PGlite
half is `@effect/sql-pglite`'s `PgliteClient` over `@electric-sql/pglite`,
with Drizzle's PGlite driver beside it
(`packages/database/src/testing/sql-client.ts`).

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
provides per request from the context `runWeb` read. The routes the hosted
oRPC route does not answer are converted this way: auth, the GitHub,
automation, Slack, and Sentry webhooks, the maintenance sweep and key rewrap,
the GitHub, integration, and Sentry redirects, the byte routes, the runner's
routes, the workspace's MCP door, and the page sandbox. The two chapters
routes are the hosted oRPC route itself in a function of its own, and the
WebSocket routes export something else, the `http.Server` described under
"WebSocket functions".

`packages/service/src/http/http-effect.ts` is the response vocabulary that conversion
speaks: one schema per refusal, each annotated with the status it answers, and
`readBodyBytesEffect` reading a bounded body off the request stream. A refusal is declared as its body
rather than as a `Schema.TaggedError`, because `error` is already the
discriminant the desktop's hosted clients read and a `_tag` beside it would be
a byte they never asked for.

Every request meets the cookie origin guard
(`packages/service/src/http/origin-guard.ts`) before the handler is built or
the router reads it. A state-changing request, any method but GET, HEAD, and
OPTIONS, that carries a cookie is refused with the vocabulary's
`not-permitted` (403), its path and `Origin` logged at warn, unless its
`Origin` is one of the deployment's own, `authDeployment`'s `ownOrigins`:
production's registered address, or a Preview's two hostnames, and none at
all for a production or Preview that names no address of its own. Where a
browser names no `Origin`, a `Sec-Fetch-Site` of `same-origin` stands in for
it. A request that carries no cookie goes on untouched, since it holds no
session to ride on: the desktop, which names its account in
`Authorization`, the scheduled sweep, and the webhooks send none. An
`Authorization` header beside a cookie buys nothing, because Better Auth
reads the session from the cookie whenever that header is not a bearer it
signed. The list is the guard's own rather than Better Auth's
`trustedOrigins`, which on production trusts every preview and the dev server
for the OAuth proxy. Only Better Auth's own `/api/auth/*`, which checks a
request's origin itself, is let through from any page; a provider returns
the browser to every other address with a GET, which the guard never
refuses.

Past the guard, an account route reads its caller through
`resolveHostedUserId` (`packages/service/src/auth/bearer.ts`): the OAuth
bearer wherever `Authorization` is present, refused when it does not verify
rather than read past to the cookie, and the browser's session cookie only
where no `Authorization` is carried. `/api/mac-commands` takes the bearer
alone (`resolveHostedBearerUserId`), because its held read claims commands
for the one Mac that asks. Everything else takes either, the work that
reaches an agent's session included, which reaches it for the account the
request resolved to (`packages/service/src/agents/coder-host/runtime-sessions.ts`'s
`routedSessions`), so an agent's Start, message, and Stop, an inbox answer, a manual
automation run, a comment's ask of an agent, and a task's delete and the account's, which
retire the sessions of the agents they delete, all work in a browser. Note that a route
file's choice of resolver is not a boundary, because every function holding
a group answers every path the group declares, the one a client names in the
dispatcher's `route-path` query among them; the account is resolved per
request in the endpoint instead, so where a request lands changes nothing
about it. Every route
that answers bytes rather than JSON (a task's picture, an inbox attachment,
a picture a tool answered, a workspace's photo, and an image an agent's pull
request names, an SVG among them) answers them under `HOSTED_BYTES_HEADERS`:
`nosniff`, `private, no-store`, `default-src 'none'; style-src
'unsafe-inline'; sandbox`, so a tab opened on one runs no script as this
origin, and `Cross-Origin-Resource-Policy: same-origin`, so no other site's
page embeds one under the cookie of whoever is looking. Every reader of them
is same-origin: the web app's tab, and the Mac's host, which fetches them
with its bearer and hands its renderer the bytes.

## The hosted oRPC route

`server/orpc-route.ts` holds `orpcRoute`, the one route every path moved onto
the hosted oRPC router answers through (`packages/service/src/orpc/`, its
contract in `@repo/features/contract`); `/api/models` is the first. It meets
the cookie origin guard, reads the web runtime's services through `runWeb`
once per instance as `routeFromHttpRouter` does, and hands each request to
`OpenAPIHandler` with them as its `effect/context`, so it is a runtime edge
of its own (`tools/anti-slop/effect-edges.json`). The router matches the
public path itself: every `/api/` path no rule ahead of it takes reaches the
route through the one fallback rewrite of `server/function-rewrites.ts`,
which carries the whole path in `route-path` for the dispatcher to restore,
and a path no procedure matches is the router's own JSON 404. Vercel runs the
web service's routes before the filesystem, so the functions that answer by
their own name (the three WebSocket functions and the feedback courier) each
stand on a pass-through rule ahead of the fallback.
Every answer the route gives, a refusal and an unmatched path's 404 among
them, carries `nosniff` and `Cross-Origin-Resource-Policy: same-origin`
(`handler.ts`), since each reader is a same-origin `fetch` or the Mac's host.

## The pages' security headers

Every page the site serves answers with a Content Security Policy, a refusal
to be framed, `nosniff`, a referrer policy, an opener policy, and a
permissions policy, from the web service's routes in `vercel.json`. A route
whose headers differ from the site's comes first with its whole set and ends
routing: the app's two (its own policy, and an opener policy that keeps the
connect tab it opens), the page the app frames (framed by this origin alone,
its one inline style admitted by digest), the pages a connect lands on (no
opener policy, so their tab can close itself), and the admin pages (their
charts' inline styles and accounts' pictures). Then one route lays the site's
headers on every other path and lets routing go on to the page rewrites and
the built files, so no page is ever sent two policies to be enforced
together. It stands after the generated `/api/` table, so an API answer's
headers are only its handler's, and it leaves `/assets/` alone, since a
worker started from a script's address runs under the policy that script is
sent with, and the app's chunks must never carry the site's. The site's policy
admits PostHog's assets as a script source, because the analytics client
(`src/analytics.ts`) loads its configuration and its recorder from there.
`tests/vercel-services.test.ts` holds every page the build emits to these
headers at every address it answers at.

## The sandbox's host

An agent's page runs the script the agent wrote, so the web app draws it from
a registrable domain of its own, `vespin.page`
(`@repo/features/page-frame`'s `PAGE_SANDBOX_ORIGIN`), attached to this
project beside the app's. That host serves one route and nothing else. The
first top-level rewrite sends every request made to it into the web service,
and the web service's first two routes, which the
generator keeps ahead of the `/api/` table (`function-rewrites.ts`), send a
link's `/p/<token>` to the page route with its token in a query and every
other path of the host to a file of the build's own,
`public/sandbox-not-found.txt`, under a forced 404, so a stray request wakes
no function. A host condition is written as an anchored pattern,
`{"re": "^vespin\\.page\\.?$"}`, so the spelling with a trailing dot a
browser may send is held too, and no host that merely holds the name is;
never as a bare string, which Vercel may match anywhere in the host. The page
route
is a function group of its own (`function-durations.ts`), because a
dispatcher holding any other route would hand that route a request whose
query named it, and it refuses any host but the sandbox's, so its own `/api/`
path on the app's host answers 404 too. It answers a frame's load alone, as
the browser names it in `Sec-Fetch-Dest`, and so does the mint below: a page
opened in a whole tab would be free of the app's `frame-src` on a domain of
Vespin's own, so a load that names itself a tab's, or names nothing, is 404.

A frame on the app's host asks the app's own `…/versions/{version}/frame`
procedure under the session cookie, which answers 303 to a link on the
sandbox minted for that account, signed with `AGENT_PAGES_SECRET` and good
for a minute (`packages/service/src/pages/`), or to `/page-in-mac-app`
where the deployment has no sandbox. The app's policy frames the sandbox's
origin by name, because `vercel.json` cannot read the environment; the
service takes `AGENT_PAGES_ORIGIN` only where it names that same origin, so
the environment turns the sandbox on or off but never sends a frame to a
host the routing does not lock. The service reads the two variables on
production alone: a Preview answers on its own hosts and has no sandbox,
even where the variables reach it, and its frames show the page saying pages
open in the Mac app. Vercel's own request
log records the sandbox's paths, a link's token among them, as it records
every path; a token is good for a minute, for one version, to one account.

## Signing in on a Preview deployment

A Preview deployment answers on hostnames minted for the branch, so
`packages/service/src/auth/auth-deployment.ts` reads the deployment's own address rather than
assuming one: on a Preview, `VERCEL_URL` is the base URL and `VERCEL_BRANCH_URL`
joins it as a trusted origin, and `BETTER_AUTH_URL` stays what it has always
been, the production address whose callback the two providers registered.
Without this a preview refuses its own sign-in before it reaches a provider at
all — Better Auth trusts the origin of its own base URL, and the browser on a
preview sends the preview's, which is the 403 behind the admin dashboard's
"Sign-in didn't finish. Try again."

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
the provider secrets in every environment, and Vespin follows it rather than
holding them back from Preview; the preview then builds its own Google URL and production still exchanges the code. `BETTER_AUTH_PROXY_SECRET` has to hold the same dedicated value on both
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
names. Both were accepted on 2026-10-13 in favor of running the
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

The account resource's `delete` procedure
(`packages/service/src/accounts/account-procedures.ts`) erases the signed-in
user on the same bearer resolution. Deleting the `user` row is the heart of
it: sessions, provider accounts, OAuth grants,
and usage counters all reference it with `onDelete: "cascade"`, so nothing of
the account outlives the request.

`POST /api/events` (`packages/service/src/events/events-procedures.ts`) records what a signed-in desktop counted about its own use, on
the same bearer resolution. The desktop never talks to the analytics processor:
it posts an allowlisted batch here, and this is the one place a `distinct_id`
is attached, from the resolved account and never from the body, which has no
place to name one. `productEventBatchFromWire` in `@repo/features/analytics` is the whole
admission policy, and it builds each event from that event's property
allowlist, so nothing outside the vocabulary survives the read.

It needs `POSTHOG_PROJECT_API_KEY`; without it the endpoint answers 503 and
product analytics is simply off, which is the intended state for Preview
deployments. `POSTHOG_HOST` optionally overrides the ingestion host.
`POSTHOG_PERSONAL_API_KEY` and `POSTHOG_PROJECT_ID` are what let
the account `delete` procedure ask PostHog to erase the person before the account row
goes. It is a private endpoint, so it takes a personal key rather than the project
token, and `POSTHOG_API_HOST` overrides *its* host, which is not the ingestion
host. Without that pair the delete simply has no erasure seam to run. Every
forwarded event carries `$geoip_disable`, without which an event arriving with
no address resolves to the data center's own location and the privacy claim in
`PRIVACY.md` becomes false; the project's IP-capture setting should be set to
discard as well, so the guarantee does not rest on one property in one file.

The service counts its own half under the same key: the core loop the desktop
cannot see (a task, workspace, issue, or automation made, an agent
started, an agent's pull request opened, an Inbox answer,
an integration connected or disconnected, and how a team comes together: a
sign-up, an invitation sent and accepted, a member's thread post, plan edit, or
plan comment, an automation run started, the GitHub App connected, a host
enrolled), recorded where each is committed
through `recordServerEvent` in `packages/service/src/events/server-events.ts`.
A sign-up and an accepted invitation commit inside Better Auth, so its hooks
note them (`packages/service/src/auth/auth-counts.ts`) and the auth route
records them once Better Auth has answered. Only a member's own thread post,
plan edit, and plan comment are counted, never an agent's through its tools.
Its vocabulary is typed per event and holds only fixed words, booleans, and
catalog ids, and each event carries the account's id as `distinct_id`, so it
joins the desktop's person and is erased with it. The `ProductAnalytics`
service is read optionally, so a runtime or test without it records nothing,
and a deployment without `POSTHOG_PROJECT_API_KEY` builds one that records
nothing.

The browser half of the funnel is separate and weaker: `VITE_POSTHOG_PROJECT_API_KEY`
is a build-time variable that lets the site's own pages talk to PostHog
through a path of the deployment's own origin (`@repo/features/posthog-proxy`),
which `vercel.json` passes on to PostHog with the request's cookies taken off,
so PostHog is still handed a visitor's address there. A build without it never
loads the library at all.

Use is counted per user per UTC day in the Vespin-owned `hosted_usage` table:
one atomic upsert before each upstream call (`packages/database/src/models/quota.ts`).
A dictated clip is counted once it is transcribed instead, as one call and its
seconds of audio in the row's `dictation_seconds`. Nothing is refused on the count, which the admin pages read; a spend limit on
the OpenAI project behind the key is the backstop and should be configured
with it.

## Invitation email

A workspace invitation made from Settings is emailed to the invited address
as it is made (`packages/service/src/accounts/invitation-mail.ts`), through
Resend, with the accept link the owner can still copy by hand. It needs
`RESEND_API_KEY`, the key the feedback form already sends with, and
`INVITE_FROM`, the sender, such as `Name <invites@notifications.example>`
on a domain Resend has verified. Without either the build logs it once by
the variables' names and nothing is emailed, which is the intended state for
a Preview. A send Resend refuses is logged by its status alone, and the
invitation stands. Canceling an invitation emails nothing.

## Welcome email

A new account is emailed one short note from Charles, one of the founders,
as it signs up (`packages/service/src/accounts/welcome-mail.ts`, sent from
the auth route's sign-up step in `packages/service/src/auth/auth-app.ts`),
through Resend: plain text, no branding, and replies go to the sender. It
needs `RESEND_API_KEY` and `WELCOME_FROM`, the sender, such as
`Charles Pan <charles@vespin.dev>` on a domain Resend has verified. Without
either the build logs it once by the variables' names and nothing is emailed,
which is the intended state for a Preview. Signing in again, or linking
GitHub to an account, emails nothing, and a send Resend refuses is logged by
its status alone while the sign-up stands.

## Sentry

The functions report to Sentry's `vespin-web` project, set
up as Sentry's own guides set it up. `server/runtime.ts` provides
`@repo/service/observability/sentry`'s `sentryLayer()`, which is the Effect
guide's: `Sentry.effectLayer` starts the SDK and registers its
`ErrorReporter`, so a route that fails or dies is captured as the router
answers 500, and the tracer and metrics layers send Effect's spans and
metrics. `webServices` adds `Sentry.SentryEffectLogger` beside the JSON
logger, so every log line is a Sentry log. The scheduled sweep checks in to the `maintenance-sweep` Cron monitor
as a run starts and as it ends, and Sentry creates the monitor from the
first check-in.

The SDK runs with Sentry's default data collection, which `PRIVACY.md` and
root `AGENTS.md`'s "Never" describe. Sentry's Vercel integration, which maps
this Vercel project to the `vespin-web` Sentry project, owns `SENTRY_DSN`,
`SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, and `SENTRY_PROJECT`; a variable of those
names set by hand stops it from syncing. Without `SENTRY_DSN` the SDK starts
disabled. `VERCEL_ENV` names the environment, and the SDK reads
`VERCEL_GIT_COMMIT_SHA` as the release. No build writes or uploads source
maps, so a stack trace in Sentry reads as the minified bundle: uploading the
client's, the functions', and the eve root's maps cost every production build
60 to 75 seconds, and was dropped for it on 2026-10-27. Alert rules are set in
Sentry, not here: a Slack message on more than ten events in five
minutes, and an email to the issue's owners on a high-priority issue.

## WebSocket functions

### Deploying

The terminal relay, the Browser tab's live view, and the live reads' socket
(`/api/live/socket`, which answers a host's live polls) are WebSocket
functions, each exporting the `http.Server` Vercel upgrades into, so enable the
WebSockets feature on the Vercel team and make sure Fluid compute is on for
the project. `PROVIDER_KEY_ENCRYPTION_KEYS` seals each account's own provider
keys. A native agent's runner reports to the deployment's own origin, its
production domain in production and its own host otherwise, unless
`APP_DEPLOYMENT_ORIGIN` names another (`packages/service/src/deployment-origin.ts`).
No separate service is deployed.

## The agents

Every agent runs on Claude Code or Codex in a Vercel Sandbox of its own,
which `packages/service/README.md`'s "The agent service" describes; no agent
is served by an app of its own.
