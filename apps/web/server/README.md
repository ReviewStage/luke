# Database and auth workflow

Neon is provisioned through the Vercel integration. It supplies the pooled
`DATABASE_URL` for application traffic and `DATABASE_URL_UNPOOLED` for
migrations; the connection strings live nowhere in this repository.
`server/db/schema.ts` is the source of truth for database structure owned by
Luke.

Run `pnpm db:generate` after changing the schema, review the generated migration,
and commit it. Vercel runs `pnpm db:migrate` before every deployment build, using
the direct connection Neon supplies for that deployment. The Neon integration
creates a database branch for each Preview deployment, so its committed schema
changes are applied to the matching branch before Vite builds the application.
No package lifecycle hook runs migrations.

The auth service also needs `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`,
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_ID`,
`GITHUB_CLIENT_SECRET`, and optionally `POSTHOG_API_KEY`.

After the auth migration has been applied, run
`pnpm --filter @luke/web auth:seed`. The seed is idempotent and installs the one
public OAuth client compiled into Luke. Dynamic client registration stays
disabled; the client has no secret, requires PKCE, accepts loopback callbacks,
and skips consent as a trusted first-party app.

Google's callback is `${BETTER_AUTH_URL}/api/auth/callback/google`; GitHub's is
`${BETTER_AUTH_URL}/api/auth/callback/github`. The GitHub provider requests
`user:email`, because Luke requires an email address for its account snapshot.

`api/feedback.mjs` deliberately remains plain ESM so Vercel's builder has nothing
to transpile.
