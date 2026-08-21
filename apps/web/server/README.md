# Database and auth workflow

Neon is provisioned through the Vercel integration. It supplies the pooled
`DATABASE_URL` for application traffic and `DATABASE_URL_UNPOOLED` for
migrations; the connection strings live nowhere in this repository.
`server/db/schema.ts` is the aggregate source of truth for database structure
owned by Luke. Better Auth generates its portion into `server/db/auth-schema.ts`;
do not hand-edit that generated module.

After changing Better Auth or one of its plugins, run `pnpm auth:generate`, then
run `pnpm db:generate`, review the generated migration, and commit both outputs.
Schema generation uses a local placeholder connection string when `DATABASE_URL`
is absent; `pg.Pool` is lazy, so the command never connects to that placeholder.
For a Luke-owned table, add its own schema module and export it from
`server/db/schema.ts` before running `pnpm db:generate`. Name every schema module
`*-schema.ts` so Drizzle Kit includes it.

Vercel runs `pnpm db:migrate` before every deployment build, using the direct
connection Neon supplies for that deployment. The runner holds a PostgreSQL
advisory lock for the migration session, so overlapping builds targeting one
branch cannot apply the same migration concurrently. The Neon integration creates
a database branch for each Preview deployment, so its committed schema changes
are applied to the matching branch before Vite builds the application. No package
lifecycle hook runs migrations.

The auth service also needs `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`,
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_ID`, and
`GITHUB_CLIENT_SECRET`.

`vercel.json` uses a legacy `routes` entry for `/api/auth/(.*)` because Vercel's
zero-config `api/` detection treats `[...all].ts` as a single dynamic segment and
adds a hard 404 for deeper API paths. A `rewrites` entry runs after that detected
filesystem routing phase, so it cannot reach the Better Auth handler; keep this
rule in `routes`, ahead of the detected routes.

Each deployment build runs `pnpm auth:seed` after the migration and before Vite,
so every database the application reaches already carries the client, including
the branch database Neon creates for a Preview deployment, which would otherwise
be migrated but empty. The Drizzle seed is idempotent, upserting the one public
OAuth client compiled into Luke, which is what makes running it on every build
safe. To apply it by hand against production:

```sh
vercel env run --environment production --scope stage-review -- \
  pnpm --filter @luke/web auth:seed
``` Dynamic client registration stays disabled; the client has no secret,
requires PKCE, accepts loopback callbacks, and skips consent as a trusted
first-party app.

Google's callback is `${BETTER_AUTH_URL}/api/auth/callback/google`; GitHub's is
`${BETTER_AUTH_URL}/api/auth/callback/github`. The GitHub provider requests
`user:email`, because Luke requires an email address for its account snapshot.

`api/feedback.mjs` deliberately remains plain ESM so Vercel's builder has nothing
to transpile.

# Hosted voice and attention

`api/voice/mint.ts` and `api/attention/review.ts` run Luke's voice and
attention review on the deployment's own OpenAI key for a signed-in desktop.
Both are exact-path files, so Vercel's zero-config `api/` detection routes
them without a `routes` entry; only the bracketed auth catch-all needs one.
The logic lives in `server/hosted/` behind injected seams, and each request is
resolved to a user through the auth service's own `/oauth2/userinfo` endpoint,
called in process.

The endpoints need one secret: `OPENAI_API_KEY`. Without it both answer 503
and the hosted tier is simply off, the same kill switch as the feedback
endpoint, which is the intended state for Preview deployments, so a preview
never spends the production key. `LUKE_REALTIME_MODEL` and
`LUKE_ATTENTION_MODEL` optionally override the models, under the same names
the desktop honours; a blank value is treated as absent.

`api/account/delete.ts` erases the signed-in user on the same bearer
resolution: the desktop's Delete account confirm is the only caller. Deleting
the `user` row is the entire act: sessions, provider accounts, OAuth grants,
and usage counters all reference it with `onDelete: "cascade"`, so nothing of
the account outlives the request.

`api/events.ts` records what a signed-in desktop counted about its own use, on
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
`api/account/delete.ts` ask PostHog to erase the person before the account row
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

Use is metered per user per UTC day in the Luke-owned `hosted_usage` table:
one atomic upsert before each upstream call, checked against the ceilings in
`server/hosted/quota.ts`. The ceilings bound how often calls open, not how
long they run; a spend limit on the OpenAI project behind the key is the
backstop and should be configured with it.

# Admin dashboard

`api/admin/metrics.ts` answers `/api/admin` (served by `admin.html`), a
maintainer-only view of the service's own operational tables. Its logic lives in
`server/admin/` behind injected seams, the same shape the hosted endpoints keep,
but its response vocabulary is its own — deliberately not `server/hosted/http.ts`,
whose slugs are the desktop's wire contract in `@sidecar/hosted`. This surface is
browser-only and the desktop never validates it.

Authorization is two steps and fails closed. The gate is a first-party browser
session — resolved through Better Auth's own `getSession`, the cookie a
maintainer signs in for on this site, not the desktop's bearer token — and then
the presence of that account's row in the Luke-owned `admin_user` table
(`server/db/admin-schema.ts`). An anonymous request is `401 not-signed-in` (the
page offers sign-in), a signed-in account with no admin row is `403
not-authorized`, and the metrics are read only past both. A seam that throws —
auth or the database not answering — is a `503 unavailable` JSON refusal rather
than an unhandled crash, so the page says "try again" instead of failing to
parse a platform error page.

**Admin status lives in the database, not the codebase.** A row in `admin_user`
is the whole grant; it cascades away with the account it names. Who holds one is
managed by inserting and deleting rows, not by editing and redeploying. The
bootstrap is `LUKE_ADMIN_EMAILS`, a comma-separated list read from the
environment (never committed, blank/absent = empty set, never a wildcard):

- On the sign-in that creates a session, an account whose address is on the list
  is granted its admin row by the `databaseHooks.session.create` hook in
  `auth.ts` — the one place an admin grant is written. It is idempotent and a
  no-op when the list is empty, so ordinary sign-ins pay nothing and the
  dashboard read stays entirely read-only.
- `pnpm admin:seed` (run in the Vercel build after `auth:seed`) grants the row to
  accounts on the list that already had a user row before being added, so a
  maintainer who signed in earlier is promoted without signing in again.
- To grant or revoke by hand, insert or delete an `admin_user` row directly
  (`insert into admin_user (user_id) select id from "user" where email = '…';`).

To sign in: open `/admin`, use the sign-in card (GitHub or Google), and — with
your address on `LUKE_ADMIN_EMAILS` or an `admin_user` row already present — the
dashboard loads. A Vercel **preview** deployment additionally sits behind
Deployment Protection, which redirects the dashboard's own `/api/admin/metrics`
fetch to Vercel's SSO; the page reports that redirect explicitly. Disable
protection for the deployment (or use a protection-bypass token) to exercise the
dashboard against a preview.

Everything the dashboard shows is an aggregate of rows Luke already stores for
its own operation, read by a maintainer on their own service — it is not the
desktop observing sessions, and it widens no analytics event, so it moves
neither the product-event allowlist nor `PRIVACY.md`. The data sources are:

- **User activity** — the `user` table (total accounts, rolling 7- and 30-day
  signups, and a daily signup series) and the `session` table (sessions whose
  `expires_at` is still in the future, and the distinct accounts behind them).
  Linked sign-in methods are counted from the `account` table's `provider_id`.
- **Feature usage** — the `hosted_usage` table: voice calls and attention
  reviews, today and across the 30-day window, the daily series, the accounts
  active today, and the heaviest accounts. The heaviest-accounts table is the
  one place an individual is named, from the service's own user row, to the
  maintainer who operates it.
- **Reliability** — `hosted_usage` rows that reached a daily ceiling, the
  closest rejection signal these tables hold. Per-request error rates and
  client failures are product-analytics events and live with the analytics
  processor, not in this database; the dashboard says so rather than inventing
  a number.
- **System health** — a `select 1` probe (reachability and its round-trip) and
  which integrations the deployment has keys for, reported as presence booleans
  only. No secret value crosses into the response.

The shaping that has off-by-one risk — the trailing day window and its
zero-filled series — lives in the pure `buildAdminMetrics` in
`server/admin/admin-metrics.ts`, tested without a database; the Drizzle
aggregation is in `server/admin/admin-queries.ts`. A database that fails the
probe short-circuits to an empty source whose health card reports the outage,
rather than a page of zeros under a green light.

The dashboard needs no secret of its own. It reuses the auth service's
configuration (`BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, and at least one social
provider) and reads `LUKE_ADMIN_EMAILS` for the bootstrap. With no `admin_user`
row and no matching seed address, no one is admitted.
