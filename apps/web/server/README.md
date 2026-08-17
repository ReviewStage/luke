# Database workflow

Neon is provisioned through the Vercel integration. It supplies the pooled
`DATABASE_URL` for application traffic and direct `DATABASE_URL_UNPOOLED` for
migrations; the connection strings live nowhere in this repository.
`server/db/schema.ts` is the source of truth for database structure owned by
Luke.

Run `pnpm db:generate` after changing the schema, review the generated migration,
and commit it. Vercel runs `pnpm db:migrate` before every deployment build, using
the direct connection Neon supplies for that deployment. The Neon integration
creates a database branch for each Preview deployment, so its committed schema
changes are applied to the matching branch before Vite builds the application.
No package lifecycle hook runs migrations. This foundation creates no Luke
application tables; Drizzle maintains only its own migration ledger until the
first real migration arrives with the account and authentication work.

With the empty schema and no migrations, `pnpm db:check` reports that everything
is fine. `pnpm db:generate` reports no schema changes and maintains Drizzle
Kit's empty migration journal. The journal contains no application SQL.

`api/feedback.mjs` deliberately remains plain ESM so Vercel's builder has nothing
to transpile. Nothing imports the TypeScript database module yet; the first
function that consumes `server/db/` will decide that build boundary.
