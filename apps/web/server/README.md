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

On a Preview, `pnpm db:migrate` then switches off the work in flight the
branch database copied from production, on every build
(`apps/web/server/db/migrate.ts`; `packages/service/src/maintenance/preview-database.ts`
decides on `VERCEL_ENV`, `packages/database/src/models/preview-copy.ts` runs).
Neon branches it off production with every row production held, so it holds
turns still running, coding agents at work, open calls, commands queued for a
Mac, and sandboxes queued to stop. Each names a live thing in production that
the Preview can neither finish nor reach, and no cron runs on a Preview to
settle it. So the step settles every queued or running turn as failed for its
session's end, archives every coding agent, closes open calls, pauses
automations and skips their queued runs, and empties the Mac command queue and
the sandbox deletion and terminal lease queues. It keeps no record of having
run, so work started on the Preview itself is switched off too by the next
build of its branch.

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
`task-store.ts`, `board-store.ts`, `plan-pages.ts`, `transcript-store.ts`,
and `plan-revisions.ts`, and the voice door's `heldTask`, on the caller's
membership of the task's workspace rather than on the task's starter. Past
that gate a shared task's transcript and a new call's earlier calls are
every member's calls about it.

A plan's pictures are its own rows, `plan_attachment`, with their bytes in a
`bytea` column held to `PICTURE_BOUNDS.MAX_BYTES` (`@luke/features/picture-wire`)
(`packages/database/src/models/plan-attachments.ts`), gated by the same
`planReachableBy`. `POST /api/plans/<id>/attachments { picture }` keeps one, a
`data:` URL of a PNG, JPEG, or WebP whose bytes sniff as its label, on a plan
that is not archived and holds fewer than `MAX_PER_PLAN`, answering `{ id }`
or `{ refused: "too-many" }`; `GET /api/plans/<id>/attachments/<picture>`
serves the bytes under their sniffed type, `nosniff` and `private, no-store`,
to a member alone, anyone else reading `not-found`. The plan's text names a
picture by its address (`@luke/features/plan-attachment-link`), which
`savePlanText` reads to stamp the picture `saved_at`, and the scheduled sweep
deletes, a day on, a picture no save stamped.

A task's conversation keeps the member who opened it as its `user_id`, the
address its messages, turns, and asks are written under, and is reached by
every member of the task's workspace: `conversationReachableBy` in
`packages/database/src/models/recorded-session.ts` admits a member of the
workspace of the task or coding agent naming the conversation, or naming its
standing parent one hop up (a subagent's session), and the opener alone for a
conversation no task or agent names, so a member who leaves the workspace
leaves its conversations with it. The eve doors
(`brain-host/door.ts`), the two hosts' admission (`brain-host/conversation.ts`,
which answers the caller beside the conversation's owner), and the ask door
all read it, so a member speaks into the session a teammate opened. From
there the caller and the owner are two ids: the brain's inference
and research are metered to the caller, not the conversation's owner, and
the task, the board, every tool binding, an integration's grant, and a
worker's title are read, written, and metered as the caller, while the
writer, the seed, and the relay address the owner's rows.
A voice call is the caller's `voice_sessions` row and meter, landing in the
task's one conversation, which `openTaskConversation` answers with its
opener. A coding agent still runs on its starter's provider keys and GitHub
token, and its steps are its starter's spend, whichever member messages it.

A workspace's members are read, removed, and left, and a workspace renamed or given a photo, through
`packages/service/src/accounts/workspaces-app.ts`. `GET /api/workspaces/members?workspaceId=`
answers a workspace's members to a member under the Mac's OAuth token, read
through Drizzle (`packages/service/src/accounts/workspace-members.ts`), owners first, then admins,
then members, since the plugin's own `listMembers` takes a session.
`GET /api/workspaces/<id>/photo` serves a workspace's photo, kept as a
`data:` URL in the organization plugin's own `logo` column, as its bytes under
its type, to a member alone, `nosniff` and `private, no-store`; a non-member,
and a workspace with no PNG, JPEG, or WebP photo, read `not-found`. The list
carries only a digest of it as `photoVersion`, and the account's own first
workspace with none carries the account's sign-in picture as `pictureUrl`
where it is Google's or GitHub's (`@luke/features/account-picture`).
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
`POST /api/workspaces/photo/set { workspaceId, photo }` lets an owner or an
admin set its photo, a `data:` URL of a PNG, JPEG, or WebP of at most
`WORKSPACE_PHOTO_BOUNDS.MAX_BYTES` decoded, or remove it with `null`,
answering `{ workspace }` with its new `photoVersion` or none; any other
photo is `invalid-request`. They are the plugin's own
`removeMember`, `updateMemberRole`, `leaveOrganization`, and `updateOrganization` (`memberSeams`
in `workspace-seams.ts`, the last handed the name alone or the logo alone), called with the
request's headers, which carry the Mac's own Better Auth session as a signed
bearer token that the bearer plugin reads as the session cookie. So these six
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
table is its own file, and the root `vercel.json` is assembled from it
(LUKE-183). `server/feedback.mjs` is the one
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
in the repository root's `vercel.json`, which Vercel reads at the project's
Root Directory (the repository root, so each service's `root` is relative to
it) and only while the project's Framework Preset is Services. `web` is this
app, rooted at `apps/web`, and carries the migrate-and-seed
build, the install filter, the ignore rule, and the `routes` above unchanged.
`luke` is the hosted brain, the standalone eve app at `apps/luke`
(`apps/luke/README.md`), built by a plain `pnpm exec eve build` in that root,
which writes the Build Output static-build reads back from it, so nothing
relocates it and no variable of eve's own is set by hand.
`dev` is the coding-agent service, a second standalone eve app at `apps/dev`
built and deployed on the same terms (`packages/service/README.md`'s "The
coding-agent service").
Public routing is the top-level `rewrites`:
`/eve/coder/v1/*` enters the dev service, `/eve/v1/*` the luke service, and
everything else the web service, and a
service's own routes run only once a request has entered it. That is why the
generated `/api/` rewrites live under the web service's `routes` and the
generator (`server/function-rewrites.ts`) refuses a `routes` key at the top
level beside `services`: Vercel ignores one there rather than erroring, so a
file generated into the old location would pass every check and 404 every
`/api/` route in production. The project's
environment variables reach all three services alike, and each service's own
`ignoreCommand` is what skips its build, so a commit that changes nothing under
`apps/web`, `packages`, the workspace manifests, or `vercel.json` deploys none
of them. A Vercel `vercel.ts` is not used: Vercel's Git builds refuse a
`{ service }` destination in a `vercel.ts` (`rewrites[0].destination should be
string`, #2838) although `vercel.json` takes the same rewrites.

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
(`import { task } from "@luke/database/schemas/task"`), never the barrel,
which is what makes a renamed column a type error at the call site.

The builder hands back the statement's rows, not a guarantee about them, so a
row is still decoded by an Effect `Schema`, where lobehub's examples reach for
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
writes the migration that brings the newest snapshot under
`packages/database/migrations/meta/` up to the modules, which the Effect
migrator above applies; hand-edit the generated SQL only for what drizzle-kit
cannot know, such as a backfill. `0095_snapshot.json` is the baseline the loop
restarted from: `0026`–`0094` were hand-written and carry no snapshot.
`./scripts/check.sh` fails when a module changes without its generated
migration, by running `drizzle-kit generate` and refusing any folder it
writes, and
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
still serving refused every task until its own build went live. Each read
projects only the columns it answers (`task-store.ts`'s list reads no part of
the document), so a rewrite reaches only the reads of what it rewrote.

## Where a function runs an Effect

`server/runtime.ts` holds the one `ManagedRuntime` this app has, memoized at
module scope, and `runWeb(effect)` is the only place `apps/web` runs an effect.
The layer it builds, `webServices`, is `@luke/service/runtime`'s, which runs
nothing; each eve root builds its own runtime over the same layer in its own
`runtime.ts` and runs through its `runAgent`, so no agent file reaches into
`server/`.
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
Outside `packages/database/src/models/`, `packages/database/src/models/task-store.ts` is on the same
client, and `packages/database/src/models/voice-session-record.ts` is on it whole, each of its five methods
answering an effect over the live session row rather than running one.
`VoiceService` yields those five
directly: one upgrade is one `Scope` and one effect run on the `WebStoreRun`
`voice/function.ts` hands it, so the registration, the usage snapshot, and the
close are steps of that effect rather than promises a callback awaited. The
two meters of `packages/service/src/voice/accounts.ts` — the account's spend and a closed
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
the tasks group's four, and the dashboard's five behind the admin group are
converted this way; the voice route alone exports something else, the
`http.Server` described under "Hosted voice service".

`packages/service/src/http/http-effect.ts` is the response vocabulary that conversion
speaks: one schema per refusal, each annotated with the status it answers, and
`readJsonBodyEffect` reading a bounded body off the request stream. A refusal is declared as its body
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
for the one Mac that asks. A task's delete and the account's take the bearer
alone too, asked in the endpoint itself (`hostedBearerOnly`) rather than by
the route file's resolver, because every function holding a group answers
every path the group declares, the one a client names in the dispatcher's
`route-path` query among them: each ends the eve sessions of what it deletes
over that bearer. The rest of what reaches eve over the caller's bearer (an
agent's Start, message, and Stop) is refused at eve for a cookie. The eve
services under `/eve/v1/*` and
`/eve/coder/v1/*` share the origin but never pass through this adaptor; they
resolve the bearer alone (`hostedUserId`) and take no cookie. Every route
that answers bytes rather than JSON (a task's picture, an inbox attachment,
a picture a tool answered, a workspace's photo, and an image an agent's pull
request names, an SVG among them) answers them under `HOSTED_BYTES_HEADERS`:
`nosniff`, `private, no-store`, and `default-src 'none'; style-src
'unsafe-inline'; sandbox`, so a tab opened on one runs no script as this
origin.

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

The service counts its own half under the same key: the core loop the desktop
cannot see (a task, workspace, issue, or automation made, a coding agent
started, an agent's pull request opened, an Inbox answer, a member's Chat post,
an integration connected or disconnected), recorded where each is committed
through `recordServerEvent` in `packages/service/src/events/server-events.ts`.
Its vocabulary is typed per event and holds only fixed words, booleans, and
catalog ids, and each event carries the account's id as `distinct_id`, so it
joins the desktop's person and is erased with it. The `ProductAnalytics`
service is read optionally, so a runtime or test without it records nothing,
and a deployment without `POSTHOG_PROJECT_API_KEY` builds one that records
nothing.

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

## Sentry

The functions and both eve roots report to Sentry's `luke-web` project, set
up as Sentry's own guides set it up. `server/runtime.ts` provides
`@luke/service/observability/sentry`'s `sentryLayer()`, which is the Effect
guide's: `Sentry.effectLayer` starts the SDK and registers its
`ErrorReporter`, so a route that fails or dies is captured as the router
answers 500, and the tracer and metrics layers send Effect's spans and
metrics. `webServices` adds `Sentry.SentryEffectLogger` beside the JSON
logger, so every log line is a Sentry log. Each eve root starts Sentry in
`instrumentation/sentry.ts` with `Sentry.eveInstrumentation`, the eve guide's,
which eve runs before it loads the agent and which traces every turn, model
call, and tool call; its `runtime.ts` adds the same reporting without a second
start. The scheduled sweep checks in to the `maintenance-sweep` Cron monitor
as a run starts and as it ends, and Sentry creates the monitor from the
first check-in.

The SDK runs with Sentry's default data collection, which `PRIVACY.md` and
root `AGENTS.md`'s "Never" describe. Sentry's Vercel integration, which maps
this Vercel project to the `luke-web` Sentry project, owns `SENTRY_DSN`,
`SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, and `SENTRY_PROJECT`; a variable of those
names set by hand stops it from syncing. Without `SENTRY_DSN` the SDK starts
disabled. `VERCEL_ENV` names the environment. `scripts/bundle-functions.ts`
uploads the function bundles' source maps when the build holds
`SENTRY_AUTH_TOKEN`, under the release the plugin writes into each bundle from
the deployment's commit. The eve roots' builds do the same after `eve build`:
each root's `nitro.config.ts` has Nitro write hidden maps when the build holds
the token, and `scripts/eve-source-maps.sh` gives the bundles debug IDs,
uploads the maps to `luke-web` under `VERCEL_GIT_COMMIT_SHA`, and deletes them
from the output. Alert rules are set in Sentry, not here: a Slack
`#alerts` message on more than ten events in five minutes, and an email to
the issue's owners on a high-priority issue.

## Hosted voice service

### Deploying

Enable the WebSockets feature on the Vercel team, make sure Fluid compute is
on for the project, and set `OPENAI_API_KEY`; `LUKE_LIVE_MODEL` optionally pins
the model. The exchange also needs `CRON_SECRET`, the deployment's secret at
eve's door, and without it every session is refused as unavailable; eve's
origin is the deployment's own unless `LUKE_EVE_ORIGIN` names another. Luke's
avatar needs `KEYFRAME_API_KEY` and `LUKE_KEYFRAME_PERSONA_ID` as well; without
either, a call asking for video goes on as voice. No
separate service is deployed. Tests run against a fake OpenAI on loopback and an in-memory account side
(`packages/service/src/voice/service.test.ts`, `packages/service/src/testing/voice-fakes.ts`).

## The agents

Luke's planning brain is its own eve app, `apps/luke`, and the coding agent
is another, `apps/dev`; their layout, deployment, and evals are in
`apps/luke/README.md`, which `apps/dev` follows, and `packages/service/README.md`'s
"The coding-agent service".
