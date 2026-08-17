# Database workflow

Neon is provisioned through the Vercel integration. It supplies `DATABASE_URL`
to the deployment environment; the connection string lives nowhere in this
repository. `server/db/schema.ts` is the source of truth for database structure
owned by Luke.

Run `pnpm db:generate` after changing the schema, review the generated migration,
and commit it. Applying migrations to production is an explicit operator action:

```sh
vercel env run --environment production --scope stage-review -- pnpm --filter @luke/web db:migrate
```

Vercel builds do not run migrations, and no repository lifecycle hook runs them
automatically. This foundation intentionally creates no tables; the first real
migration arrives with the account and authentication work.

With the empty schema and no migrations, `pnpm db:check` reports that everything
is fine. `pnpm db:generate` reports no schema changes and maintains Drizzle
Kit's empty migration journal. The journal contains no SQL and creates no tables.

`api/feedback.mjs` deliberately remains plain ESM so Vercel's builder has nothing
to transpile. Nothing imports the TypeScript database module yet; the first
function that consumes `server/db/` will decide that build boundary.
