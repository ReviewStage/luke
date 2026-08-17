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
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_ID`,
`GITHUB_CLIENT_SECRET`, and optionally `POSTHOG_API_KEY`.

Each deployment build runs `pnpm auth:seed` after the migration and before Vite,
so every database the application reaches already carries the client — including
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
