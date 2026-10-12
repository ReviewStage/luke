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
(`server/auth-database.ts`), not its Kysely one: the migrations declare the
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

Every account has a personal workspace, named for the account, slugged
`personal-<user id>`, with `{"personal":true}` as its metadata text, and named
the account's own by a `personal_workspace` row
(`packages/database/src/schemas/personal-workspace.ts`; its generated migration
is followed by a custom one that backfills one for every account lacking it in
one data-modifying statement). `packages/database/src/models/workspace-store.ts`'s
`ensurePersonalWorkspace` makes it the first time it is asked for, through
`models/workspace-seams.ts`'s
`createOrganization` over the plugin, so its organization and owner rows are
the plugin's own; no transaction encloses it, so two Macs ensuring at once
settle on the unique slug and the row's primary key, and the one the plugin
refuses adopts the workspace under the slug. `listWorkspaces` answers every
workspace the account is a member of, its personal one first and the rest by
name. `tests/workspace-store.test.ts` holds the three. The workspace names the
account rather than being named by it, so the user row's cascade would take
only the `personal_workspace` row and leave the organization, with the
account's name and id, standing: `account-store.ts`'s `deleteAccount` deletes
it first (`deletePersonalWorkspace`), in the same transaction as the user row.
That is a direct delete from the plugin's table, because Better Auth documents
no deletion without a session: `deleteOrganization` requires session cookies
and is off under `disableOrganizationDeletion`, and `user.deleteUser` wants a
fresh session.

Every plan belongs to one workspace: `plan.organization_id`, not null and
cascading with the organization (`20261013231728_plan_organization` adds the
column nullable, the custom `20261013231735_plan_organization_backfill` after
it moves every plan standing into its starter's personal workspace, and
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
`hosted/brain-host/recorded-session.ts` admits the opener, or a member of the
workspace of the plan or coding agent naming the conversation, or naming its
parent one hop up (a subagent's session). The eve doors
(`brain-host/door.ts`), the two hosts' admission (`brain-host/conversation.ts`,
which answers the caller beside the conversation's owner), and the ask door
all read it, so a member speaks into the session a teammate opened. From
there the caller and the owner are two ids: the planning brain's inference
and research are metered to the caller, not the conversation's owner, and
the plan, the board, and every tool binding are read and written as the
caller, while the writer, the seed, and the relay address the owner's rows.
A voice call is the caller's `voice_sessions` row and meter, landing in the
plan's one conversation, which `openPlanConversation` answers with its
opener. A coding agent still runs on its starter's provider keys and GitHub
token, and its steps are its starter's spend, whichever member messages it.

Dynamic client registration stays disabled. One public client is compiled in:
**`luke-desktop`** (`server/oauth-clients.ts`), the macOS companion app. It
accepts loopback callbacks (`http://127.0.0.1/callback`) via a local HTTP server
during sign-in, holds no client secret, requires PKCE, and skips consent as a
trusted first-party app.

Google's callback is `${BETTER_AUTH_URL}/api/auth/callback/google`; GitHub's is
`${BETTER_AUTH_URL}/api/auth/callback/github`. The GitHub provider requests no
OAuth scope (`GITHUB_SIGN_IN` in `server/auth-policy.ts`): it is a GitHub App's
user authorization, and a GitHub App has permissions rather than scopes, the
App's "Email addresses: read" among them, which is what answers the email
read Luke requires for its account snapshot.

## The Luke GitHub App

"Sign in with GitHub" is the Luke GitHub App's user authorization: the
provider's client is the App's (`GITHUB_APP_CLIENT_ID`,
`GITHUB_APP_CLIENT_SECRET`, read by `authSecrets` in `server/auth-deployment.ts`;
the admin dashboard's "GitHub sign-in" row reads the same client), so the
token a sign-in leaves on the `account` row is a GitHub App user token, which
reaches only the repositories where the App is installed and the user
has access, under the App's registered permissions (metadata read, contents
and pull requests read and write, email addresses read). An account that
signed in through the OAuth App before this is the same GitHub user id, so
Better Auth signs it in to the user it already has and
(`updateAccountOnSignIn`) replaces the row's tokens with the App's;
`tests/auth-github-sign-in.test.ts` holds that. The App's user tokens expire
after eight hours and come with a refresh token good for six months; Better
Auth stores both sealed under `BETTER_AUTH_SECRET` (`encryptOAuthTokens`), with
their expiries beside them. Better Auth's own `/get-access-token` and
`/refresh-token` endpoints are not served (`DISABLED_AUTH_PATHS`): nothing
hands a browser the GitHub token, and the one reader of it is the server.

That reader is `server/github/github-app.ts`, the `GitHubApp` service the web
runtime builds beside `HostedEnvironment` from `GITHUB_APP_ID`,
`GITHUB_APP_SLUG`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`,
`GITHUB_APP_PRIVATE_KEY` (the PEM; newlines flattened to `\n` by a dashboard
paste are restored), and `BETTER_AUTH_SECRET`. A deployment missing any of
them still builds the service, and every read of it answers
`GitHubAppNotConfigured` naming what was missing, so a bundle loads with
nothing configured. The service holds no client: its GitHub reads run on the
ambient `HttpClient` and the account row on the ambient `SqlClient`, so
`tests/github-app.test.ts` stands a fake at the GitHub boundary and PGlite
beneath it. It answers three things. `appJwt` is the App speaking as itself,
RS256 under the private key, issued a minute back and good for eight; it is
what `installation(id)` reads `GET /app/installations/{id}` with, so an id
GitHub hands the Setup URL is confirmed as this App's own or answered as none.
`userToken(userId)` is the signed-in user's token off the row, unsealed; a
token within a minute of its expiry is refreshed first at GitHub's token
endpoint on the App's client, and the fresh pair is re-sealed in place. The
read and the refresh run inside one transaction under `FOR UPDATE` on the
row, because GitHub retires a refresh token the moment it is used and two
requests refreshing at once would leave the second holding one GitHub no
longer knows. GitHub answers a refused refresh with status 200 and an `error`
body, which is read as `GitHubSignInRequired`, the same failure a row with no
GitHub account, a row from before the App (no refresh token), an expired
refresh token, or a token that will not open under this deployment's secret
answers: in every case the user mends it by signing in with GitHub again.
`userInstallations(userId)` is `GET /user/installations` on that token, read
a hundred at a time until a page comes back short; a 401 there is a token
GitHub refused before its stored expiry, which is the user having revoked
the App's authorization, and is answered as `GitHubSignInRequired` too. A
failure carries a status or a kind and never the request, since the request
carried the bearer.

What the user reaches through the App is read the same way.
`userRepositories(userId)` pages through the user's installations and, for
each, `GET /user/installations/{id}/repositories`, which is the repositories
the installation covers that the user can also access, and answers them
most recently updated first with whether there was any installation at all;
a listing is paged the same way, and one GitHub is still answering full
pages of at the bound (`PAGING`, fifty pages) is answered as unreadable
rather than as the part that was read; an installation uninstalled between
the two reads reaches nothing rather than failing the whole.
`userRepository(userId, "owner/name")` is the check a plan's repository
passes before it is kept: only the installation on the owner can reach it,
so only that one is paged, and only as far as the page the repository is on,
the name is matched the way GitHub folds case, and what is answered is the
full name as GitHub spells it. `repositoryReadToken(userId, "owner/name")`
is the same check followed by the one token the App mints: `POST
/app/installations/{id}/access_tokens` under the App's JWT, naming that one
repository and `contents: read`, answered sealed beside the repository as
GitHub spells it, or none where the user does not reach it. It is what the
planning sandbox's checkout reads through (`hosted/repository-shell.ts`).
A repository is reachable only through an installation. A public repository
the token could read without one is deliberately not, because what the
repository is for, a coding agent's checkout and pull request, needs the
installation's permissions on it.

`GET /api/github/repositories` (`server/github-repositories-app.ts`) is that
listing under the account bearer, answered as
`packages/hosted/src/github-repositories-wire.ts` declares it: `installed`,
`repositories` (owner, name, full name, default branch, private, and when
GitHub last saw it change), and `installationUrl`, which is where the desktop
sends an account with nothing installed. Nothing is stored. An account whose
token the service cannot use, having never signed in with GitHub, signed in
before the App, or had the token refused or revoked, is `github-sign-in-required`
(403); a GitHub or a store the service could not reach is `unavailable`.
`tests/github-repositories-app.test.ts` holds the route and
`tests/github-app.test.ts` the reads beneath it, over
`tests/support/github-app-fake.ts`.

Installing the App is two browser navigations in `server/github-install-app.ts`,
neither carrying an account bearer. `GET /api/github/install` sends the
browser to `https://github.com/apps/<slug>/installations/new`, where the
developer installs the App on an account or organization and chooses its
repositories. The App's registered Setup URL, with "Redirect on update", is
`https://tryluke.dev/api/github/installed`: GitHub lands the browser there
with `installation_id` and `setup_action`, the route confirms the
installation through `installation(id)`, and sends the browser on to
`/github-installed.html?status=…` with one word from `GITHUB_INSTALL_STATUS`
(`@sidecar/hosted`): `installed`, `updated`, `requested` (a member asked an
organization's owner, so there is no installation yet), `not-found`, or
`unavailable`. The page draws a fixed card per status and interpolates
nothing the address brought it; the desktop's repository chip picks the
installation up by reading the account's repositories again when the window
next takes focus (`apps/desktop/src/renderer/planning/repository-chip.tsx`).
Nothing is stored at install time: which installations a user can reach is
read from GitHub on the user's own token when a repository is chosen.

The App's webhook is `POST /api/github/webhook` (`server/github-webhook-app.ts`),
which keeps what a coding agent published current on the agent's row
(`coding_agent.published`) for the plan list while nobody has the agent's tab
open. GitHub signs every delivery with the App's webhook secret,
`GITHUB_APP_WEBHOOK_SECRET`, and the route compares `X-Hub-Signature-256`
against the HMAC-SHA256 of the body's own bytes in constant time before it
reads anything; a deployment without the secret answers every delivery
`unavailable` (503), and a signature that does not hold is `invalid-token`
(401). Only `pull_request` (opened, reopened, closed, edited, synchronize,
ready_for_review, converted_to_draft), `check_suite`, a completed
`check_run`, and `status` are read, for the repository's full name and the branches they
name, and nothing of a delivery is kept or logged: the branch finds the agents
whose rows stand on it, of whichever account, at most ten, newest first, and
each one's pull request is read again from GitHub on its owner's own token
through `agentPublished`, as the agent's tab reads it, which writes the row.
A redelivery reads the same again. GitHub's `ping` and any other event are
answered and ignored. `tests/github-webhook-app.test.ts` holds it over a
scripted GitHub and PGlite.

A Preview's GitHub sign-in still goes through production's OAuth proxy, and
production is the end that exchanges the code, under its own provider
client: a Preview carrying the App's client id can complete a sign-in only
while production's `GITHUB_APP_CLIENT_ID` and `GITHUB_APP_CLIENT_SECRET`
hold the App's client id and secret, a Vercel project setting rather than anything in
this repository. Nothing on the branch is Preview-specific.

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
`server/db/sql-client.ts`, `core/sql-client.ts`, and `getTestDB()`), and
`queryBuilder`, the session-less builder a subquery or a `with` clause is
rendered with outside any statement. A module reads the database as
`const db = yield* Database` in a generator, or `Database.use((db) => ...)`
where a statement is one expression. It takes no `relations` config, because nothing reaches
Drizzle's relational queries: a statement is the `db.select()` builder, never
`db.query`, as the `drizzle` skill has it. The tables a statement names are
named imports from their own module
(`import { plan } from "@sidecar/database/schemas/plan"`), never the barrel,
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
`HttpClient` over `fetch`, and the `SqlClient` of `server/db/sql-client.ts` over
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

A test reads the same client through `@sidecar/database/testing`, which
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
`server/routes/account/delete.ts`, `preferences.ts`, and `plan-template.ts`,
the plans group's four, and the dashboard's five behind the admin group are
converted this way; the voice route alone exports something else, the
`http.Server` described under "Hosted voice service".

`server/hosted/http-effect.ts` is the response vocabulary that conversion
speaks: one schema per refusal, each annotated with the status it answers, and
`readJsonBodyEffect` reading a bounded body off the request stream. A refusal is declared as its body
rather than as a `Schema.TaggedError`, because `error` is already the
discriminant the desktop's hosted clients read and a `_tag` beside it would be
a byte they never asked for.

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

The organization plugin is served in the group with `ORGANIZATION_OPTIONS`
(`server/auth-policy.ts`): no workspace is deleted, and no signed-in user
creates one (`allowUserToCreateOrganization: false`). Every organization
write a browser could reach is in `DISABLED_AUTH_PATHS` and answers 404,
because a workspace is adopted by its slug, and a session free to create an
organization or rename its own could take a team's slug first. That covers
create, update, delete, check-slug, set-active, member removal, role changes,
leave, every invitation endpoint (Luke sends no invitation mail), and the
team and role endpoints this deployment does not mount. `disabledPaths` is
read by the HTTP router alone, so the server-only `auth.api` calls a hosted
route makes still run, and a create that names a `userId` and carries no
session passes the creation rule as a system action.
`auth-database.test.ts` holds both sides with an account signed up through
`auth.api.signUpEmail`.

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
`HttpServerResponse.raw`.
`server/events-app.ts` holds one query of its own, the events handler's
PostHog person read (`readPerson`), a `SqlSchema` query whose builder renders
against the auth schema module and runs on the ambient `SqlClient`.

## The account group

`server/account-app.ts` is the account route group: the signed-in desktop's
own delete, preferences, and plan template endpoints, described as routes of the group's own
rather than carried as a passthrough, because each answers from this
deployment's own database and none owns a contract of its own the way Better Auth does.
Each endpoint resolves the bearer against the deployment's own account store
before touching anything — root AGENTS.md pins that no credential or account
secret ever travels in an answer — and answers only the boolean or the
snapshot the caller's own account carries. `server/hosted/account-seams.ts` is
the one place that hands the group a real user table and a real preferences
store, so `api/account/delete.ts`, `preferences.ts`, and `plan-template.ts` build
the same group from the same wiring; the reads and the writes themselves are
`packages/database/src/models/account-store.ts`'s effects over the ambient `SqlClient`,
handed to the group as the effects they are rather than run at the seam, and
that store names no database and reaches no auth session, so `tests/hosted-account-store.test.ts`
exercises the erasure's cascade and the snapshot's replacement against a real
dialect; the analytics erasure key and project are
read from `HostedEnvironment` instead, the way the hosted tier's own key is,
and the erasure call itself runs over the ambient
`HttpClient` rather than an injected transport, so nothing in `AccountAppSeams`
carries one — a test provides its own fake `HttpClient` layer instead.

The preferences snapshot carries two parts. `preferences` is the settings
snapshot the desktop syncs, replaced whole by a write that names it.
`codingAgent` is the account's default model and effort for a coding agent —
what a click on Start runs on — as `{ model, effort }` in AI Gateway's catalog
spelling, `anthropic/claude-opus-5.5` at `high` until the account chooses,
with `contextWindow: "standard"` beside them where the smaller context window
of a model offering two was chosen (absent is the model's whole window).
Settings › Coding agents and the Start menu's chevron both write it, as one
value rather than two that could disagree. A PUT carries either part or both;
a part left out stands as it was, so the desktop's settings sync never
resets the chosen model and the Start menu never touches the voice. A
`codingAgent` write is accepted only as the instance's model catalog accepts
it (below): a model it does not offer or an effort that model does not list
is `invalid-request`, and a catalog the instance cannot read is `unavailable`.
The store keeps the columns beside `voice` on `account_preference`, and
reads a half-written pair as the default; `coding_agent_context_window` is
null for the model's whole window (migration 0077). `updated_at` is the preferences
part's own instant, nullable since migration 0062 and left null by a write
that carries only `codingAgent`: the desktop reads the answer's `updatedAt`
as a snapshot to apply over its own settings, so a row a choice alone opened
must answer none, or a Mac that never synced would take an empty snapshot
over the voice it holds.

The plan template is the group's third path, `/api/account/plan-template`:
`GET` answers `{ template, custom }`, the account's own Markdown or
`DEFAULT_PLAN_TEMPLATE` with `custom: false`, and `PUT { template }` keeps a
string verbatim (untrimmed, empty allowed, at most 20,000 characters) or goes
back to the default on null (`@sidecar/hosted/plan-document-template`). It is
a path of its own rather than a third part of the snapshot, because the
desktop syncs the snapshot over its own settings and a long text does not
belong in that loop. It lives in `account_preference.plan_template`
(migration 0087), and a write sets that column alone: `updated_at` stays
the preferences part's own, so a row a template opened answers no snapshot.
`tests/account-plan-template.test.ts` answers the path over a real dialect.

### Accounts' own provider keys

`server/provider-keys-app.ts` answers `/api/account/provider-keys`, the
account's own Anthropic and OpenAI API keys, at most one per provider:
`GET` answers what each is, `PUT` saves one, and `DELETE
?provider=<provider>` removes one, each answered with the keys as they then
stand (`@sidecar/hosted/provider-key-wire`). No answer carries a key: what
the account is shown is the provider, a hint of the key's prefix and last
four characters (`sk-ant-…abcd`), when it was added, and its status —
`verified`, `invalid`, `quota_exceeded`, or `unreadable` where the ring
below can no longer open it. A save asks the provider first, with one read
of its model list, which bills nothing (`server/hosted/provider-key-check.ts`):
a 200 keeps the key as verified, a 401 or 403 keeps nothing and answers
`rejected: invalid`, anything else keeps nothing and answers `unreachable`,
and a key spelled as the other provider's is answered `wrong_provider`
without being sent anywhere. Saves are braked at ten an hour per account
on each instance, so the endpoint is no oracle for keys that are not the
caller's. Neither the key nor what the provider said of it is logged.

A key is kept in `account_provider_key` (migration 0080), sealed by
`packages/database/src/models/provider-key-seal.ts`: AES-256-GCM under a data key drawn
for that save, the data key wrapped under the deployment's key-encryption
key, with the account and provider bound as additional data on both seals
and the version on the wrap, so a sealed key copied onto another row does
not open. The row holds the version, the wrapped data key, the sealed key,
the hint, and the status; it is replaced whole by a save, deleted by a
removal, and cascades with the account. `packages/database/src/models/provider-key-store.ts`
reads and writes the rows and never sees a key in the clear.

The key-encryption keys are `PROVIDER_KEY_ENCRYPTION_KEYS`, read through
`HostedEnvironment`: comma-separated `<version>:<base64 of 32 random
bytes>` entries, the version new saves wrap under first. Production and
Preview each hold their own. A deployment without it, or with a value that
is no list, answers every request on the path `unavailable` and logs which
shape is wrong, never the value. To set one up:

```
openssl rand -base64 32          # one key; repeat for the other environment
vercel env add PROVIDER_KEY_ENCRYPTION_KEYS production   # value: 1:<key>
vercel env add PROVIDER_KEY_ENCRYPTION_KEYS preview      # value: 1:<another key>
```

A rotation is two steps. First put a new version at the head of the list,
`2:<new key>,1:<old key>`, and redeploy: new saves wrap under version 2, and
rows on version 1 still open. Then ask that deployment for the rewrap:

```
CRON_SECRET=<the deployment's own> scripts/rewrap-provider-keys.sh https://tryluke.dev
```

The script is a `POST /api/maintenance/provider-keys-rewrap` under the
deployment's `CRON_SECRET`, compared in constant time as the sweep's is, so
the rewrap (`server/hosted/provider-key-rewrap.ts`) runs on the deployment
over the ring it holds and the key-encryption keys never leave Vercel. It
unwraps each older row's data key and wraps it under the head version,
leaving the sealed key itself untouched, and answers counts: the version,
moved, already current, changed meanwhile, and unreadable. Run it again
until nothing is changed meanwhile; once nothing names the old version,
drop it from the list and redeploy. A row counted unreadable reads
`unreadable` to its account, which is told to replace it. It is not a
migration, since a migration holds no key and runs before the deployment
whose ring it would need.

## The dictation group

`server/dictation-app.ts` answers `POST /api/dictation`: one clip the
developer dictated into a message box, `{ audio, durationMs, keywords }`
(`@sidecar/hosted/dictation-wire`), answered `{ text }`. The clip is WebM
with Opus in base64, held to two minutes and a megabyte and refused past
either as `request_too_large` before anything goes upstream; `keywords` are
up to fifty words the desktop expects to hear (the repository, the plan's
title, the paths it names), each on one line. `server/hosted/transcription.ts`
sends the clip and the words to OpenAI's `gpt-transcribe` on Luke's key as one
multipart `POST /v1/audio/transcriptions`, the words as its `keywords[]`
([OpenAI's speech-to-text guide](https://developers.openai.com/api/docs/guides/speech-to-text)).
Nothing of the clip or the text is stored, logged, traced, or counted as an
event; a failure logs OpenAI's status alone and answers `unavailable`, as a
deployment without `OPENAI_API_KEY` does. The day is metered one call and the
seconds OpenAI billed, or the clip's own length where the answer reports none,
and a meter the database refused is logged while the text is still answered.
There is no path on an account's own key. `tests/dictation-app.test.ts`
answers the route over a scripted OpenAI at its HTTP door.

## Integrations

Every agent Luke runs — the planning assistant, the coding agent, and each
one's declared worker — can use the signed-in account's integrations, each
through the provider's own hosted MCP server with every tool it lists and no
approval step: Linear (`https://mcp.linear.app/mcp`), Notion
(`https://mcp.notion.com/mcp`), Sentry (`https://mcp.sentry.dev/mcp`), and
Slack (`https://mcp.slack.com/mcp`), which is read-only: its entry allows
Slack's search and read tools alone (`ALLOWED_TOOLS`, eve's tool filter). A connection belongs to the account, so it reaches every plan and
project the account has. `server/hosted/integrations.ts` is the one table of
providers: the variable each connector's UID is read from, its MCP server
and what the model is told of it, and the name its nested calls are stored
under. Everything below is the same for every provider.

**Who holds what.** Vercel Connect holds each grant, encrypted, and refreshes
it; Luke never stores a token. Luke holds one row per account and provider
in `integration_connection` (`schemas/integration.ts`), which is its own word
on whether its agents may use the grant: `connected` lets them, anything else
or no row does not. Connect has no way to ask whether a sign-in finished and
its SDK caches tokens in process, so this row is also what makes a Disconnect
take effect regardless of any cache. The migration that made the table copied
every row of Linear's own table in as Linear's, and the one after it dropped
that table.

**The routes** (`server/integrations-app.ts`):

- `GET /api/account/integrations` answers `{ integrations: { <provider>:
  status } }`, each status `connected`, `pending`, `expired`,
  `disconnected`, or `unavailable` (no connector for it on this deployment).
  A sign-in still under way, begun within the last fifteen minutes, is
  settled here by asking Connect for a token afresh.
- `POST /api/account/integrations/{provider}/connect` asks Connect's
  `startAuthorization` for the account, with Luke's own user id as the
  subject and `/api/account/integrations/connected?state=…` as the callback,
  records the sign-in's one-time state, and answers the address. The
  desktop's host opens it through the native node; no window draws it and
  nothing logs it.
- `POST /api/account/integrations/{provider}/disconnect` deletes the row
  first, then asks Connect to revoke the grant. A failed revoke is logged and
  the account is disconnected all the same. Connect revokes at the provider
  where the provider allows it; otherwise its token stands until it expires,
  though Luke no longer uses it. Deleting the account revokes every
  provider's grant the same way.
- `GET /api/account/integrations/{provider}/tools` answers the tools the
  provider's server offers the account's agents, `{ tools: [{ name,
  description }] }`, for the composer's MCP popover. It reads them as an MCP
  client does (`server/hosted/mcp-tools.ts`: `initialize`, then `tools/list`
  page by page, JSON or event-stream answers), with the account's token from
  Connect. The list is narrowed to the provider's `ALLOWED_TOOLS` where it
  has them, and each description is cut to its first line. It is held in the
  instance's memory for five minutes per account and provider. A provider
  the account has not connected is refused as unavailable before any token
  is read.
- `GET /api/account/integrations/connected` is where Connect returns the
  browser from any provider. The state names the account and the provider,
  Connect is asked for a token afresh, and the browser lands on
  `/integration-connected.html` with the provider and one word: `connected`,
  `not-completed` (declined or cancelled), `expired`, or `unavailable`.

The rewrite moves a provider's path segment into the `provider` query
(`function-rewrites.ts`), as a plan's id is moved into `id`.

**The agents** (`server/hosted/integration-connection.ts`,
`server/hosted/agent-runtime/connections.ts`). eve hands a declared subagent
none of its parent's connections, so each of the four agents registers one
`connections/integrations.ts`: a dynamic connection resolved as each turn
starts, which hands the turn every server its role's policy has on
(`agent-runtime/servers.ts`), each the one definition over its provider and
that agent's own ownership check: the root's `admit`, or a worker's
`admitDelegated`. The planning agents are handed every integration; a coding
agent and its worker are handed every one the developer has not switched off
for that agent. The
definition's auth is eve's plain `getToken` form, credentialed as the app,
and the account is the admitted conversation's owner, never the session's
principal. That matters because a spoken planning turn runs as the
deployment acting for the account, and eve's user-scoped auth (`connect()`
from `@vercel/connect/eve`) would refuse it before reading any token. That
form has no interactive half either, so eve never pauses a run for a
sign-in. eve opens the client once per model step: the row is read at each
opening, and again after Connect answers, so a Disconnect takes effect from
the next step. A connection that cannot be used throws one of
`integrationUnavailable`'s fixed sentences, which fails only the call that
tried it; every other tool, and the run, carries on. Workers stay read-only
in the checkout and change an integration only when their task explicitly
asks them to.

**Transcripts** (`server/hosted/connection-tools.ts`). eve offers a
connection through `connection_search` and `connection_execute`, and tells a
remote call as a call of its own nested under the `connection_execute` that
ran it, named `<provider>__<tool>`, with id `<wrapper>:1`. The relay stores
the nested call under the provider's fixed name (`linear_remote` for
Linear), whose input is `{ remoteTool, parentCallId, input }`, and settles it
with what the provider answered, before the wrapper's own result. Every name
is in both agents' tool sets whatever any account's connections stand at, so
a transcript reads back the same after a Disconnect. Rows hold provider
content (Linear's issues and comments, Notion's pages); no token reaches a
row. A turn cancelled while a provider was answering leaves the call's
outcome unknown ("it may have run"), never a failure to retry.

**Provisioning a deployment.** For each provider, from the `apps/web` Vercel
project's directory:

```
vercel link
vercel connect create mcp.linear.app --name linear   # Linear; prints the connector UID
vercel connect create mcp.notion.com --name notion   # Notion
vercel connect create mcp.sentry.dev --name sentry   # Sentry
vercel connect create slack --name slack             # Slack: Vercel's managed Slack app; then its user scopes, below
vercel connect attach <connector-uid> --yes          # production, preview, and development
```

Then set the provider's variable (`LINEAR_CONNECTOR_UID`,
`NOTION_CONNECTOR_UID`, `SENTRY_CONNECTOR_UID`, `SLACK_CONNECTOR_UID`) to that UID in the `luke-web` project for production,
preview, and development. The web, `eve`, and `coder` are services of that
one project (`vercel.json`'s `services`), so its variables and the
connector's link reach all three, which matters because the agents read
tokens too. Asking Connect about an arbitrary user id needs the deployment's
own Vercel OIDC token, which the SDK reads from the request
(`x-vercel-oidc-token`) or `VERCEL_OIDC_TOKEN`. Keep OIDC enabled for the
project. For local development, `vercel env pull` writes a
short-lived `VERCEL_OIDC_TOKEN`. A deployment without a provider's variable
runs every agent without that provider, and Settings shows its row as
unavailable. Every token request is billed by Connect and rate-limited per
team.

**Slack's user scopes.** `vercel connect create slack` makes a Slack bot app
with bot scopes and no user scopes, but Luke asks Connect for the
developer's own grant (`subject: { type: "user" }`, no scopes, so Connect's
default of the app's configured user scopes), and Slack's MCP server serves
user tokens alone. A Connect with no user scopes on the app ends on Slack's
"Invalid permissions requested". `vercel connect update` changes only
branding, so set them through the API, with the connector's `scl_` id
(`vercel connect list`):

```
vercel api /v1/connect/connectors/<connector-id>   # userTokens.scopes, data.botScopes, data.appId
cat > slack-user-scopes.json <<'JSON'
{"data":{"userScopes":["search:read.public","search:read.private","search:read.mpim","search:read.im","search:read.files","search:read.users","channels:history","groups:history","mpim:history","im:history","canvases:read","files:read","users:read","users:read.email"]}}
JSON
vercel api /v2/connect/connectors/<connector-id> -X PATCH --input slack-user-scopes.json
```

Those are what the read and search tools `integrations.ts` offers need, and
none of them writes, so the token is read-only at Slack as well as in the
offer. Carry the GET's `botScopes` in the same `data` object unchanged. The
PATCH answers whether Connect synced the change to the Slack app
(`serviceSync`) and whether a workspace owner must reinstall it
(`reinstallNeeded`); a developer who connected before signs in again to
pick the new scopes up. Slack's MCP server also serves only Marketplace and
internal apps, never an unlisted one, so the app
(`https://api.slack.com/apps/<appId>/distribute`) must not be publicly
distributed.

## The models group

`server/models-app.ts` answers `GET /api/models`: the models a coding agent
may run on, as `{ models: [{ id, name, provider, efforts, contextWindows? }] }`. The list is
`server/hosted/model-catalog.ts`'s read of AI Gateway's public catalog
(`https://ai-gateway.vercel.sh/v1/models`, no key), Schema-decoded at the
boundary and kept to the Anthropic and OpenAI models whose tags carry both
`tool-use` and `reasoning`; each model's efforts are the `values` of the
`effort` entry among its `reasoning_options`, and a model listing none is
left out, since no Start could name an effort for it. A model offers two
context windows, `contextWindows: { standardTokens, longTokens,
longInputPriceFactor?, longOutputPriceFactor? }`, where its `pricing` tiers
its input past a boundary inside its `context_window` — OpenAI's 272K on the
GPT-5.4 line and after, Anthropic's 100K on Claude Haiku 5.5 — and a model
priced the same across its whole window has the one window; the boundary is
the standard window, which a choice opts into, and the whole window is the
long one, which every choice runs on unless it names the standard one, as
every agent did before the choice existed; the factors are what the tier
past the boundary costs beside the first. No offered model needs a request
option for either window, so the choice is the window eve compacts against
and the context ring reads, nothing more. The read is the
`ModelCatalog` service `server/runtime.ts` builds once per instance, cached
for an hour on a success and for no time on a failure, so an outage at the
gateway is retried on the next request rather than answered for the hour.
The bearer is resolved before the read, as every hosted endpoint resolves
it, though the catalog is public and the same for every account.

The same module holds the functions the coding-agent routes and the coder
host stand on: `acceptedModelChoice`, which reads the instance's catalog and,
through `validateModelChoice`, accepts a `(model, effort)` only for an
offered model at an effort it lists, keeping the standard window only for a
model that offers two, and `providerModelOf`, which turns a
catalog id into the id the provider's own API takes — model calls go to
Anthropic and OpenAI directly on Luke's keys, never through the gateway — so
`anthropic/claude-opus-5.5` is `claude-opus-5-5` and an OpenAI id is the
catalog's after its prefix. `tests/model-catalog.test.ts` reads the catalog
through a scripted gateway and the test clock; `tests/models-app.test.ts`
answers the route over a fixed catalog.

## The plans group

`server/plans-app.ts` is the Mac's Plans tab's route group over the account's
named feature plans (`docs/PLANNING.md`): `GET /api/plans` lists them, newest
started first and the archived ones left out unless `?archived=include` asks
for them, so a build from before archiving never draws one, `POST /api/plans`
starts one with its name, the untouched
template as its document, and the repository it is about where one is
chosen, in the workspace its `workspaceId` names, which the account must be
a member of (`isWorkspaceMember`; one it is not in answers `not-found`), or
in the account's personal workspace, ensured first, where it names none,
`GET /api/plans/{id}` opens one with its saved document,
`PATCH /api/plans/{id}` changes its name, its repository, whether it is
pinned, whether it is archived, or several at once, each pin and archive a
stamp on the row (`pinned_at`, `archived_at`) answered as `pinnedAt` and
`archivedAt` only where it stands, and
`DELETE /api/plans/{id}` deletes it, its coding agents' rows going with it
and their conversations stamped deleted beside the plan's own (`deletePlan`),
the id moved into
the query by the rewrite `server/function-rewrites.ts` makes of every
segment-captured id.
Each row of the list carries `agents` where the plan has a coding agent
(`server/hosted/plan-agents.ts`): how many it has and how many are starting
or running, the three it names (those at work first, then the newest), each
with its title, model, effort, status, and since when, and the pull requests
they opened, each number once and at most three, as GitHub last answered a
read of them. Three statements answer the whole list: the agents of every
plan listed with `coding_agent.published` (migration 0078), their newest
turns, and the lines awaiting a turn; the list asks GitHub nothing.
`packages/hosted/src/plan-wire.ts` declares every request and answer. Each
endpoint resolves the bearer first, and every statement in
`packages/database/src/models/plan-store.ts` names the account beside the plan and gates on
its membership of the plan's workspace, so a teammate's plan reads and
writes as the account's own, and a plan of a workspace the account is not in
answers exactly as none does.

`server/repository-pins-app.ts` answers `/api/repository-pins`, the
repositories the account pinned in the sidebar, whose groups of plans stand
above the rest: `GET` reads them newest pinned first, and `PUT` pins or
unpins one and answers them all as they then stand. A pin is a row of
`repository_pin` keyed by the account and the repository's full name
(`packages/database/src/models/repository-pin-store.ts`), stamped the first time it is made,
deleted when it is undone, bounded at fifty an account, and gone with the
account. It names the repository and nothing of it, so it asks GitHub
nothing. It is a path of its own rather than one under `/api/plans/`, whose
rewrite reads the next segment as a plan's id.

`GET /api/plans/{id}/work` reads back what the planning model wrote and
ran on the plan's calls (`server/hosted/plan-work-store.ts`): the plan's
conversation's turns, twenty a page newest first, each read from its
row and journal by the same `voice/plan-work.ts` a live call tells them
through, and `?before=<turn id>` for the page before that turn; the answer
names the turn the next older page is read before while one stands. The
newest page also carries every answered `show_code` call in the
conversation, oldest first, picked by its parts in the statement and read
through `shownCodeOf`, so what the call refused and a secret file are
never read back. `packages/hosted/src/planning-view.ts` declares the
answer (`planWorkAnswerSchema`).

`GET /api/plans/{id}/file?path=&first=&last=` reads a window of one file of
the plan's repository for the Mac's File tab (`server/hosted/plan-file.ts`),
at most 500 lines a window. No sandbox stands outside a planning turn, so it
reads GitHub's contents API at the head of the default branch, not the
session's checkout, or with `ref=` at that commit, a whole 40-character
lowercase SHA and nothing a branch or a path could spell, as an inbox item's
code block pins its lines, on a token `repositoryReadToken` mints for that one
repository with contents read, after the same reach check the checkout
makes. The token is used for the one read and enters no answer, log line,
or trace. What is shown is decided by the rule `show_code` is held to
(`server/hosted/shown-file.ts`): a secret file is refused before GitHub is
asked, and so is a path with an empty, `.`, or `..` segment; a link, a
directory, a missing file, a file past a megabyte, or one with a NUL among
its first bytes is refused by name, a path GitHub finds nothing at with the
branch or the commit it was looked for at; and each line is cut to 400
characters.
`packages/hosted/src/plan-wire.ts` declares the request and the answer
(`planFileRequestSchema`, `planFileAnswerSchema`). The file's `path` query
reaches the route because the grouped function's dispatcher reads its own
path override from `route-path` (`server/function-dispatch.ts`): it once
read `path`, and every File tab read was answered 404.

`GET /api/plans/{id}/revisions` reads the plan's history for the Mac's
version history (`packages/database/src/models/plan-revisions.ts`): fifty revisions a page,
newest first, each its writer as the "Edited by" line names it, when it
began and last moved, how many changes it made, and for a restore the
revision it brought back; `?before=<seq>` reads the page before that
revision, and the answer names the revision the next older page is read
before while one stands. `GET /api/plans/{id}/revisions/{seq}` reads one
revision's content and the content before it, null for the first, each
formatted under the plan's name as it stands now, so a rename since is no
difference between them. `POST /api/plans/{id}/revisions/{seq}/restore`
puts that revision's text back through the plan's one
locked save (`server/hosted/plan-notes.ts`'s `restoreRevision`), kept as a
revision of the developer's naming the one restored, and answers the plan.
It takes no body and no base: what it replaced is the revision before it,
so a restore over a save that landed meanwhile is undone by restoring that.
Every member of the plan's workspace reads the history any of them wrote;
a plan of a workspace the account is not in reads as an empty history and
restores as `not-found`. `packages/hosted/src/plan-wire.ts` declares the answers
(`planRevisionsAnswerSchema`, `planRevisionAnswerSchema`).

A plan's repository is `plan.repository` (migration 0063), the full name
`owner/name` as GitHub spells it, or null for a plan with none, which is
where every plan from before repositories stands and is no error. It is
kept only once `userRepository` on the `GitHubApp` confirms the account
reaches it, read from GitHub on the account's own token before the row is
written, so a plan never names a repository its owner could not reach
through the Luke GitHub App at the moment it was named; the stored spelling
is GitHub's, whatever case the request used. A start or a change naming one
the App reaches no installation of for the account is
`repository-not-reachable` (403) with nothing written, the name beside it
included; an account that must sign in with GitHub again is
`github-sign-in-required` (403); and a GitHub the service could not read is
`unavailable`, the plan standing as it was. A change naming null clears it.

A plan's text has one write, `server/hosted/plan-notes.ts`, and four
writers. `POST /api/plans/{id}/edit` takes the developer's edit of the
whole text against the base it was made on (`saveDeveloperEdit`), saved
where the text still holds that base, laid over what Luke wrote meanwhile
where it can be, and answered as a conflict with the text as it stands, with
nothing saved, where it cannot (`packages/hosted/src/plan-edit.ts`); a
restore above is the second. A planning call's notetaker
(`server/voice/plan-scribe.ts`) and a coding agent's `edit_plan`
(`server/hosted/coder-host/plan-edit.ts`) answer with notes
(`packages/hosted/src/plan-template.ts`): a point added under a heading, a
phrase corrected, or a line struck. `saveNotes` takes them in order over the
text as it stands, passing over a note that names a phrase the plan does not
hold, and saves it under a binding of account and plan the service built
rather than anything the model sends, answering the document as saved or
why nothing was: a text past its bound,
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
research reads beside it, `queue_question`
(`server/hosted/queue-question.ts`), which runs nothing: its journaled call is
how a question reaches the voice while the turn still runs, and the four
tools about the plan's coding agents (`server/hosted/coding-agent-tools.ts`):
a list with each agent's status and what it published, one agent's recent
progress as a bounded tail, a message to one, which takes the message
box's own steer path (`server/hosted/coder-host/steer.ts`), and a start of
a new one on the call's plan, which takes the Start button's own path
(`server/hosted/coder-host/start.ts`) under the tool call's id as its key;
both reach eve as the deployment acting for the account, the two rows the
coder channel's deployment table admits. A resumed session
is seeded with the conversation so far. The writer holds rows to
`HOSTED_TOOL_SET`, which is the planning tools and nothing else, so a turn's
calls are written and read back under the same list it was offered.
Question choice, agreement, assumption flags, and corrections are the
instructions' alone: no code reads the document for meaning.

**One tool registry** (`server/hosted/agent-runtime/tools.ts`). Every tool
Luke offers any of its four agents is named once there, with the roles it
serves: the planner, the planning worker, the coding agent, and its worker.
What each is offered is derived from it: the planning root's hosted resolver
offers the planner's (`PLANNER_TOOL_NAMES`), the planning worker its own
(`WORKER_TOOL_NAMES`), and the coding agent's files under `coder/tools/` and
its worker's are held to their roles by `coder-agent.test.ts`; each role's
stored set names every tool the role is offered. A tool's
module takes its name from the registry, so the registry imports none and
every module may import it. eve's own injected tools (`task_wait`,
`task_cancel`, `connection_search`, `connection_execute`) are eve's, not
listed.

The planning session is offered the skills the plan's repository keeps
(`eve/skills/repository.ts`, `server/hosted/agent-runtime/skills.ts`), read
from GitHub on a read token for that repository as the session starts, which
is the call's warm-up ask, and loaded with eve's own `load_skill`; each body
says where the skill stands in the repository, so its files are read with
`run_in_repository`. A plan with no repository, one the App does not reach,
or a read that fails offers none, and a coding agent's are read the same way
from its own repository, led by where they stand in its checkout. A skill
load reaches the Work tab as `other` named `load_skill`, a kind every desktop
reads, with the skill as its subject.

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
inference on Luke's key, so each one is counted as one of the calling account's
hosted uses before it is sent; a count that cannot be written is logged and stops
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
session onto another plan, and one whose row names no plan is refused. The Mac holds one call at a time, which outlives
the plan on screen and moves only when another plan's Talk press hangs it up
and opens one about that plan, so only one plan is ever spoken. `tests/voice-service-exchange.test.ts` drives both
plans and the re-attach over the real store.

The planning model reads source through one tool,
`run_in_repository({ command })` (`server/hosted/repository-shell.ts`), which
runs the command in the planning session's own Vercel Sandbox, the one eve
opens per session from `eve/sandbox.ts` and hands a tool through
`ctx.getSandbox()`, on a checkout of the plan's repository. The first call
that finds no checkout of the plan's repository makes one, at the
repository's current default branch and one commit deep, and later calls
reuse it; a plan whose repository changed meanwhile is checked out again,
and the worker subagent shares the session's sandbox
(`eve/subagents/worker/sandbox.ts`), so its reads see the same checkout. The
checkout reads through the Luke GitHub App: `repositoryReadToken` confirms
the owner still reaches the repository and mints a token for that one
repository with contents read, which the shell sets as GitHub's `Basic`
header at the sandbox's firewall, on `github.com` under the repository's own
`.git/` endpoint alone, for the clone alone, and sets back to open internet
as the clone ends, in a finalizer, so the token never enters the sandbox's
filesystem or environment and no command or output can carry it. The
command runs from the checkout root under a 60-second bound and a clean
environment (`env -i` with a search path, a home, and git's fixed values,
as the Mac runner once gave one), with its text handed to bash as an
argument rather than spliced into shell text, and answers its exit code and
up to 20,000 characters each of stdout and stderr. Every refusal is
`not-run` with a reason the model can act on, and each is answered ahead of
anything it would need: a plan with no repository yet opens no sandbox; a
developer who must sign in with GitHub again, a repository the App no longer
reaches for them, a GitHub that could not be read, a sandbox that could not
be opened or carries no firewall, and a clone that failed, with git's words,
each check nothing out. `tests/repository-shell.test.ts` holds it over a
sandbox double at eve's boundary (`tests/support/repository-sandbox.ts`), a
scripted GitHub, and PGlite, and `tests/hosted-planning.test.ts` drives the
scripted model's read through the host and the relay, reading the record
back for the listing and never the token. The old `plan_command` table, the
Mac's claim and settle routes, and the Mac's command runner are gone
(migration 0064).

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

Every admin answer is viewer-gated account data, refusals included, so each
one carries `no-store`, the five refusals the group answers itself included,
in the bytes the promise-shaped vocabulary in `server/admin/http.ts` gives.

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
turn) and for a cancel of a turn in a session, which is how the stop key's
`stopAsk` and the hook's carried Stop reach eve, and nothing else: any other
route or kind of turn carrying the secret is refused outright rather than
passed to the account authenticator behind it. Which account a request acts
for is one accessor over both principal types, and the door's ownership
checks and the host's admission read that answer, so the deployment can open
a turn only on a conversation the named account reaches and cancel one only
in a session a conversation that account reaches recorded. Where eve answers is an
origin of this deployment's own, whose rewrites carry `/eve/v1/*` into the
eve service (`deploymentEveOrigin` in `server/hosted/brain-host/eve-origin.ts`):
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
`@sidecar/voice` does the reconnecting: three tries over about ten seconds,
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
`packages/database/src/models/` is the store the brain host composes against; every
module there is an `Effect<A, SqlError | Schema.SchemaError, SqlClient>`
whose rows a `Schema` decodes and whose path rule is that schema too, which
`HostedStore`, the store writer, the voice writer, and the ask record all
answer as it came, and which a route handler composes into the one effect
`runWeb` answers for the request.

`20261013123642_dead_tables_drop` dropped the tables and columns nothing
read or wrote any more — `events`, `provider_cursors`, `provider_key` (not
the BYOK keys, which are `account_provider_key`), `roster_snapshot`,
`transcript_mark`, `observation_pass`, `workspace_file`,
`workspace_embedding`, `devices`, `account_workspace_preference`,
`introduction_usage`, `account_preference.default_workspace_provider`, and
the conversation row's observed-session, event-sequence, completion-sweep,
and memory-flush columns. A child's `parent_conversation_id`, `label`,
`title`, and `expects_completion` are live: a subagent's and a coding
agent's worker's child conversation writes them.

The conversation tables are the shape the LUKE-95 storage plan settled on,
less the `prompts` table it drew and less the `tool_sets` table
`0039_dead_tool_sets` dropped: a turn keeps the composed prompt's hash and the
tool set's and nothing else of either, because nothing replays them, and the
tool set is the build's own and read from the build that offered it. A
conversation row names its kind (`plan`, which `packages/database/src/models/plan-store.ts`
opens, and `coding_agent`, which `packages/database/src/models/coding-agent-store.ts` opens,
are the two any code still opens), the
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

The store writer, `packages/database/src/models/writer.ts`, is the one path by which a
`messages` or `turns` row is written: the writer is the one server module
with an insert, an update, or a delete over `messages` or `turns`, whether as a
Drizzle table imported from the schema or in the text of a statement, and the
modules that name one at all are the writer and the two readers. It
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
`packages/database/src/models/voice-session-record.ts` owns the session row's whole life: it is
inserted when the session is created, found again by `(user_id,
live_session_id)` when a fresh function instance re-attaches to the same
live session, overwritten with each unconfirmed usage snapshot while open,
and closed once with the confirmed seconds, the instant, and the reason. The
voice writer in `packages/database/src/models/voice-writer.ts` only reads that row
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
`check.sh` needs no service; the `postgres` CI job runs the same migrations,
then `test:store`, against a Postgres container. Every one of those is
Postgres 18, the major production runs: Neon serves 18.x, PGlite 0.5.8
embeds PostgreSQL 18.3, and the CI image is `postgres:18`, so a failure in
any of them is about the database the service actually runs, and a local `check.sh` is a reproduction on 18 already. On either
dialect an opening of the test database is a database of that opening's own:
a fresh PGlite, or a clone of the database `LUKE_STORE_TEST_DATABASE_URL`
names, made with `create database ... template ...` on the cluster's
`postgres` maintenance database and dropped when the file closes it
(`@sidecar/database/testing`). Nothing writes to the named
database itself after `db:migrate`, so a statement a test forgets to scope by
account or conversation reaches its own file's rows and no other file's.
Which files `test:store` runs is read from the files, not kept
in a list: `scripts/store-tests.ts` selects every `tests/**/*.test.ts` whose
source imports one of the two doors, `tests/support/hosted-store-database`
or `@sidecar/database/testing` (whose `getTestDB()` is the bare one), because
`LUKE_STORE_TEST_DATABASE_URL` is read there alone and a file that imports no
door cannot meet a Postgres whatever it does. A new store test is therefore
in the set the moment it imports its harness, and `package.json` is not
edited. The runner then reads vitest's JSON report back and fails, naming
each file, when the files vitest ran are not exactly the files selected. A reproduction against a real
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

## The coding-agent service

`coder/` is the second eve app root, built and deployed as the `coder`
service beside `eve` on the same terms (`vercel.json`): its own
`package.json` (`@luke/coder`, whose one dependency is `eve`), a flat layout
eve resolves as an app root, and a build that prewarms its sandbox snapshot
under the same Vercel Sandbox credentials. It stands at eve's named mount:
the public route is `/eve/coder/v1/*`, which the deployment's first rewrite
carries into the service, whose own one `routes` entry turns it back into
`/eve/v1/*` with a `request.path` transform before eve's router reads it,
and whose build exports `EVE_PUBLIC_ROUTE_PREFIX=/eve/coder` so the callback
URLs eve mints resolve to the public path. The web functions reach it through
`server/hosted/brain-host/eve-sessions.ts` with `mount: EVE_MOUNT.CODER`.
`tests/vercel-services.test.ts` holds the three services and that routing.

A coding agent is one eve session over a `coding_agent` conversation
(`packages/database/src/models/coding-agent-store.ts`), and the host behind the authored
files is `server/hosted/coder-host/`: the same door and conversation
admission as the planning brain's (`brain-host/door.ts`,
`brain-host/conversation.ts`), with the developer's own bearer the caller
the channel walks in for the desktop's routes (`coder-host/channel.ts`): a
Start and a Stop come from a route still holding it, and a follow-up
steers; the deployment acting for the account is admitted for the two things
the voice brain does there on the developer's behalf, a typed opening that
starts an agent and a typed line that steers one, each minted as the
developer's own principal with the deployment named as its carrier. The agent (`coder/agent.ts`) runs none of eve's default
tools and authors its own under `coder/tools/`, which is exactly the set the
store writer registers (`coder-host/tool-set.ts`): eve's `bash`, `read_file`,
`write_file`, and `glob`, the code extension's `apply_patch` and `grep` from
`eve/extensions/code/tools`, the planning model's own `search_web` and
`read_web_page` (`public-research.ts`: the search screened, cited, and
budgeted per turn on Luke's key and counted on the account's meter, the page
read refusing any address off the public internet), and two of Luke's own: `delegate`, the hand-off to a worker (below), and
`edit_plan` (`coder-host/plan-edit.ts`), which takes the
notetaker's own notes (`@sidecar/hosted/plan-template`'s `planNotesSchema`)
into the agent's plan through the plan's one write (`plan-notes.ts`): an open
question the agent met with the assumption it goes on under, a fact it
corrected in the code, a decision it made. The save is journaled on the plan
row (`plan.agent_edits`, the last fifty, the agent's id and its notes as
taken) and named from the agent's row at read time, so the window's "Updated
by" line and the planning model's "recent edits by coding agents" say what the
row says now; the developer reads them on their next planning call while the
agent runs on, and a turn may take only so many notes. The
extension itself is not mounted, since its `worker` subagent runs on an AI
Gateway model and its `gh` tool on Vercel Connect, and Luke runs neither.
`gh` and `git` run through the shell, authenticated at the firewall. The
session's input tokens are uncapped and compaction is eve's default.

The worker (`coder/subagents/worker/`) is Luke's own declared subagent, in
the planning worker's shape (`eve/subagents/worker/`): read-only in the
agent's own sandbox and checkout, uncommitted edits included
(`defineParentSandbox`), authored exactly the agent's reads
(`WORKER_TOOL_NAMES`: `bash`, `read_file`, `glob`, `grep`, `search_web`,
`read_web_page`), told to change nothing, and uncapped in tokens, as the
agent it runs under is. It is declared
hidden (`tool: false`), because eve's own subagent tool carries a message
and nothing else, and the agent chooses each worker's model and effort: the
model sees `delegate` (`coder/tools/delegate.ts`), a resumable task
(`serve`, the shape eve gives every agent call) whose input is
`{ task, model?, effort?, background? }`. The call answers with eve's
receipt at once and the worker's answer reaches the agent as a task result,
so the turn stays open while it works; unless the agent sets `background`,
the tool's words have it call `task_wait` right after, which is a foreground
delegation in eve's terms, and a developer's message during the wait reaches
the agent at once without stopping the worker. Several calls in one step run
at once, and a call with the task's id sends the worker more, into the same
session. The planning model delegates through the same shape
(`eve/tools/delegate.ts`, `PLANNER_DELEGATE_TOOL`), always in the background
and on its own model, its worker declared hidden too; the Work tab reads its
calls as worker calls under either name, eve's `worker` in earlier
transcripts (`PLANNER_DELEGATION_TOOLS`). A worker's row in an agent's tab
says where the worker's own session stands (the page's `subagents`), since
the call settles at the receipt.
Its step fills the pair in from the agent's own row, holds it to the same
catalog a Start is held to (`coder-host/delegation.ts`, refusing with the
models offered or the named model's efforts, which the body throws so the
model reads it and tries again), opens the child conversation the call
names (`childConversationId(agent conversation, callId)`, as the planning
worker's is named) and writes the pair under it
(`coding_agent_delegation`, migration 0066); then the body opens the worker
through `ctx.agent("worker")`. eve hands a resolver no lineage, so the
worker's hook (`subagents/worker/hooks/store.ts`) pins the parent call's id
in the worker's own state as the session starts, the model resolver reads
it at every step and is told the recorded pair (`host.delegatedModel`), and
the hook relays the worker's stream into the child conversation as a child
turn naming that pair (`host.relayChild`). The task's result names the pair
and the worker's answer; the starting call's `toolCallId` is what names the
child. `delegate` is not among `SANDBOX_TOOLS`: a refused or web-only
delegation opens no sandbox, and counting it would have the turn's end open
one only to stop it, so a sandbox a worker opened is stopped at the end of
the first turn in which the agent runs a sandbox tool of its own.

The model is chosen at every step (`coder-host/model.ts`): the agent's row
names the catalog id and effort, `providerModelOf` turns the id into the
provider's own, and the step is told `@ai-sdk/anthropic` on
`ANTHROPIC_API_KEY` with `providerOptions.anthropic.effort`, or
`@ai-sdk/openai`'s Responses model on `OPENAI_API_KEY` with
`providerOptions.openai.reasoningEffort`, with the context window the
catalog lists for the model (`CatalogModel.contextWindow`) or a fallback
where it lists none. Each step also asks for its reasoning in words, so the
agent's and each worker's tab show it as the Work tab shows Luke's:
`reasoningSummary: "auto"` on OpenAI, as the planning brain asks, and
adaptive thinking with `display: "summarized"` on a Claude 5 model, which
thinks whether asked or not. An older Claude is not asked, since the ask
would start it thinking. Nothing goes through AI Gateway.

The key a step runs on is read at every step too
(`coder-host/account-keys.ts`): the account's own key for the provider where
it saved one (above, "Accounts' own provider keys"), opened from its row,
and Luke's own `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` only where it saved
none. A row the deployment's ring cannot open, or a deployment holding no
ring, refuses the step with `ACCOUNT_KEY_UNREADABLE` rather than run it on
Luke's key, so nothing the account meant to pay for is quietly billed to
Luke. A step on the account's key goes through a middleware that keeps the
row's status as the provider answers: a 401 marks it `invalid`, OpenAI's
429 `insufficient_quota` or Anthropic's "credit balance" refusal marks it
`quota_exceeded`, and a call that goes through marks it `verified` again,
each written only where the row still holds the key the step ran on. The
first two fail the step with `ACCOUNT_KEY_REFUSED` or
`ACCOUNT_KEY_NO_QUOTA` in place of the provider's own error, and the three
refusals read as the agent's failure `provider_key`, which the desktop
words as a key to replace in Settings. An agent's title stays on Luke's
Anthropic key. Reading the row every
step means a later change to it is the next step's model.

The sandbox (`coder/sandbox.ts`) is one Vercel Sandbox per session at the
platform's 24-hour maximum timeout, prepared with the code extension's
tooling (`gh`, signed commits, TypeScript diagnostics), pnpm, and Python
beside the image's Node and git. As it opens, the agent's repository is
checked out whole at its default branch through the same firewall-scoped
clone the planning checkout makes (`repository-shell.ts`'s
`cloneRepository`), on a token `repositoryWriteToken` mints for that one
repository with contents and pull requests write, plus checks, statuses, and
Actions read where the installation has granted the App those
(`CI_READ_PERMISSIONS`; a mint naming a permission the installation never
granted fails whole, so they are asked only where granted), and the token is
then set at the firewall for the session's own `gh` and `git` through eve's
`authenticateGitHub`; it never enters the sandbox's filesystem or
environment. The session's instructions say whether that read was granted
(`host.prompt`, through `repositoryCiReadable`): where it was, the agent
watches its pull request's checks with `gh pr checks` and fixes what fails
for at most `CODER.CI_FIX_ROUNDS` rounds; where it was not, it says CI was
not watched. A token lasts an hour, so the store hook renews it at the
firewall on the first step past `CODER.GITHUB_TOKEN_REFRESH`.

The store hook (`coder/hooks/store.ts`) relays every event into the store
through the relay the planning brain shares (`brain-host/relay.ts`), composed
with no ask record, so an agent's turns land as `turns` rows naming its
model and effort and its `messages` rows as `UIMessage`s; it also stops the
sandbox the moment a turn ends, completed, failed, or cancelled, where a
sandbox tool ran in the session. The instructions (`coder-host/instructions.ts`)
tell the agent to read `AGENTS.md` and `CLAUDE.md` first, reread the code the
plan names and say where it no longer fits, run the repository's checks,
work on a `luke/<slug>` branch and never push the default branch, and decide
on a pull request and its draft state itself; the plan is the session's
first message, or for an agent started on a developer's task, the task is,
the agent is never handed the plan, and the instructions are worded for a
task in the plan's place. The service needs `ANTHROPIC_API_KEY` and `OPENAI_API_KEY`,
`DATABASE_URL`, the GitHub App's variables, and the Vercel Sandbox
credentials its build prewarms under; `LUKE_CODER_MODEL_FIXTURE=scripted`
selects the scripted model for `coder/evals/coder.eval.ts`, which
`pnpm --filter @luke/web test:agent` runs beside the planning eval and which
runs a turn under the scripted model with no tool call, so no sandbox opens,
and a second turn that delegates to the worker, whose only call is the
delegation, so no sandbox opens there either.

## The coding-agent routes

`server/coding-agents-app.ts` is the group the desktop starts, lists,
reads, messages, re-models, and stops a plan's agents through. An agent
belongs to its plan's workspace: every route reads it through the plan's
membership gate (`coding-agent-store.ts`), so any member lists, reads,
messages, renames, re-models, and stops an agent a teammate started, while
its conversation stays its starter's, the row's `userId`, under which its
turns and lines are read and written, and its Start's retry key stays the
starter's own; `packages/hosted/src/coding-agent-wire.ts`
declares every request and answer, and `service-paths.ts` the addresses.
`POST /api/plans/{id}/agents` takes `{ idempotencyKey, model?, effort?, task? }`:
both of the choice or neither, the account's default (`/api/account/preferences`)
where neither, checked against the catalog with `acceptedModelChoice`, which
also refuses a stored default that has since left the catalog. It refuses a
plan with no repository (`no-repository`, 409), one the account no
longer reaches through the App (`repository-not-reachable`, 403), and an
account that must sign in with GitHub again before the App can read for it
(`github-sign-in-required`, 403), snapshots the
plan's document as the Markdown Copy puts on the clipboard
(`@sidecar/hosted/plan-markdown`), makes the agent and its conversation
(`createCodingAgent`), and opens the eve session under the developer's own
bearer with the snapshot as the first message of a typed turn. A Start
naming a task, the developer's own words bounded as a message is, opens the
session with the task as that first message instead: the agent is never
handed the plan, its row keeps the task and no snapshot, and it still works
in the plan's repository under the same checks; an eve that
did not take it discards the agent again (`discardCodingAgent`) and answers
`unavailable`, so a retry starts afresh. A retry under the same key answers
the agent the first Start made, 200 rather than 201, and opens nothing. A
Start that named a model writes it as the account's default.

`GET /api/plans/{id}/agents` answers each agent's id, model, effort, start
instant, status, `brief` (`plan` or `task`, what it was handed first, so its
tab draws a plan as the plan's card and a task as the developer's message),
and `turnId`, the newest turn the status is read from
(null before the first), so a reader keying an agent's run by agent and
turn sees the run a message opens as its own (`coder-host/status.ts`):
`starting` before one, `running`, `completed`, `failed`, or `cancelled`,
with a running turn carrying a Stop stamp reading as cancelled already, an
agent still without a turn row five minutes after its Start
(`CODER.STARTING_GRACE`) reading as failed rather than starting forever,
and an agent with a message of the developer's still awaiting its turn
(`awaitingLinesOf`) reading as running whatever its newest turn says.
`GET /api/agents/{id}/messages?after=<seq>:<revision>` answers the
conversation's rows past the cursor as `UIMessage`s, the cursor to read on
from, the agent's status as the page was read, and, where that status is
`failed`, `failureReason` as one of the wire's fixed words (`model`,
`sandbox`, `github`, `abandoned`, `other`), mapped by
`coder-host/status.ts`'s `codingAgentFailureOf` from the turn row's failure
word and the host's own refusal sentences in its detail, so nothing eve or
a provider said reaches the desktop
(`coder-host/transcript.ts`): a row is new past a cursor when its sequence
is higher or it was amended in place at a later journal revision, which is
how a turn's journal is heard again as it grows; a read with nothing new is
held open while the agent is starting or its newest turn runs, looked at
every half second and let go at twenty seconds, so the desktop's loop of
held reads ends on the page whose status says the agent ended and a tab on
a starting agent costs one held read per hold; an agent that has ended
answers at once.
`POST /api/agents/{id}/messages` takes `{ text, clientKey }`, the words
trimmed and at most `CODING_AGENT_BOUNDS.MAX_MESSAGE_CHARS` long
(`message-too-long`, 400, past that) and the client's own key for the send,
at most `MAX_KEY_CHARS` long. The message steers the turn under way, which
is the coder channel's own policy (`coder-host/channel.ts`): the model sees
it at its next step, and a call still generating is cut short and run again
with it; an idle agent opens a new turn on it. Nothing is handed to eve to
hold for later, because eve can neither withdraw nor edit a message once it
queues one. The route first reads whether a line already stands under the
key (`sentLineStands`, by the `messages` row's `client_id`, which is
`sentLineId(clientKey)`), and answers the agent as it stands with nothing
sent again where one does, which is what makes a send repeated after a lost
answer safe; then confirms the developer still reaches the repository
(`repository-not-reachable` or `github-sign-in-required`, as a Start does),
hands the words to the agent's eve session under the developer's own
bearer inside the conversation's lock (`writeAwaitingLine`, which reads the
key again under the lock so two sends racing under one key send once), and
writes them as a user row with no turn yet once eve has taken them, so the
transcript shows the line at once and the turn eve opens on it finds the
row standing when its own first write takes the lock; the relay's receipt
of the line (`message.received`) takes the oldest turnless row with those
words into the turn in place, bumping its revision (`takeAwaitingLine`),
rather than writing it again. An agent whose session has not claimed the
conversation, or whose session eve answers is still coming up past the
client's twenty-second loop, is `agent-not-ready` (409, tried again); a
session eve no longer runs is `agent-retired` (409), since the agent's
sandbox lives with its session; any other answer is `unavailable`, and none
of them leaves a row behind.
`GET /api/agents/{id}/subagents/{callId}/messages?after=` reads a worker's
transcript the same way, under the agent and eve's id for the `delegate`
call that started it, which the call's tool part carries as `toolCallId`:
the child conversation is `childConversationId` of the two, and only a
delegation recorded under an agent the account reaches answers, so an agent
of a workspace the account is not in, or a call that made no delegation, is
`not-found`.
`PATCH /api/agents/{id}` takes `{ model, effort }`, checked against the
catalog exactly as a Start checks its own, and writes the choice on the
agent's row (`updateCodingAgentChoice`), answering the agent's summary with
it; the coder agent reads the row at every step (`coder/agent.ts`'s
`defineDynamic`, through `coder-host/host.ts`'s `model`), so a change
mid-turn is the next step's and an idle agent's next turn takes it. It
refuses an agent of a workspace the account is not in as not found and a model or effort the
catalog does not offer as `invalid-request`, and leaves the account's
default as it was.
`POST /api/agents/{id}/stop` is eve's cancel of the turn under way, named by
eve's own id on the row, then the row's stamp; the service's hook stops the
sandbox as the cancelled turn ends, and anything the agent pushed stays.
`GET /api/agents/{id}/pull-request` answers what the agent published
(`coder-host/published.ts`): the repository, the branch it pushed, and the
pull request from it with its state (`open`, `draft`, `merged`, `closed`),
its checks as one word (`pending`, `passing`, `failing`, `none`), and its
additions, deletions, and changed files; null for a branch or a pull
request it has not. The agent reaches GitHub through `git` and `gh` in its
shell alone, and the branch its sandbox stands on as a turn ends is the one
its pull request is on, whatever it cut, switched, or deleted on the way:
the service's hook (`coder/hooks/store.ts`) runs `git branch
--show-current` in the checkout as each turn ends and writes the answer on
the agent's row (`coding_agent.branch`, through `coder-host/host.ts`'s
`recordBranch`), null for a detached HEAD, ahead of relaying the end (a
tab reads the pull request the moment it hears the agent ended, and the
answer is then kept a while) and before it stops the sandbox; a read that
fails is logged and the sandbox stops regardless, and a turn that opened
no sandbox writes nothing. A row with no branch published nothing, and
GitHub is not asked; a row still on the repository's default branch, as
an agent that only read leaves it, published nothing either. GitHub then says what stands, once the
developer's reach of the repository through the App is confirmed as a Start
confirms it (`repository-not-reachable`, 403, otherwise), on the
developer's own App token (`github/pull-requests.ts`): the newest pull
request from the branch, else whether the branch was pushed at all, with
the head's check runs and commit statuses read together for the one word,
and a head whose checks the App may not read reading as `none` with a
warning rather than failing the answer. Every answer read is written on the
agent's row (`coding_agent.published`, the pull request or null), which is
what the plan list's `agents` reads. The answer is kept
per agent for `CODER.PUBLISHED_TTL` (thirty seconds) in an Effect `Cache`
built once with the routes, under a key that says whether the agent had
ended, so the first read after a turn ends is fresh rather than the running
turn's kept answer; a failed read is kept for no time. A tab reading beside
every held page thus asks GitHub a few times a minute at most.
`GET /api/agents/{id}/changes` answers the agent's changes for its Changes
tab: the files of the pull request that kept answer names, with its page,
read from GitHub's `pulls/{n}/files` afresh on each ask on the developer's
own token (`github/pull-requests.ts`), a hundred to a page up to
`CHANGES_BOUNDS.MAX_FILES`, each with its path, the path it moved from,
what became of it, its lines added and removed, and its patch; a file
GitHub sends no patch for, or whose patch runs past
`CHANGES_BOUNDS.MAX_PATCH_CHARS`, says `binary` or `too-large` instead of
reading as unchanged, a file only moved carries an empty patch, and a
list cut at the bound says so. An agent with no pull request yet answers
a null one. The agent's sandbox is no source: nothing outside its session
reaches it and its diff is not kept in the store.
`tests/coding-agents-app.test.ts` answers the routes over a fake eve, a
scripted GitHub, a fixed catalog, and PGlite; `tests/coder-host.test.ts`
drives the host, the shared relay, the branch recorded at a turn's end
over the sandbox double, and the held read on the test clock;
`tests/coder-host-checkout.test.ts` holds the checkout over the sandbox
double, reading every run for the token and never finding it.

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

The sweep needs `CRON_SECRET`, which Vercel sends as the bearer on every
scheduled call once it is set in the project; the same secret is the one the
voice function acts for an account under at eve's door ("The exchange on the
sessions route"). Without it the route answers 503 and the schedule is
simply off, the same kill switch every other hosted endpoint keeps; a wrong
bearer is 401, compared in constant time, and any method but GET is 405.
