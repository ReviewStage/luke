import { defineConfig } from "drizzle-kit";

/**
 * drizzle-kit's view of the database: the schema modules are the source of
 * truth, `pnpm db:generate --name=…` writes the folder that brings the newest
 * snapshot up to them, and `pnpm check:migrations` refuses two branches'
 * migrations that do not commute. Drizzle's migrator (`src/core/migrator.ts`)
 * applies the folders; drizzle-kit never connects to a database here.
 *
 * `db:generate` runs drizzle-kit under tsx's loader (`NODE_OPTIONS='--import
 * tsx'`). Note that we need it because rc.4 loads the schema modules through
 * jiti, which resolves a workspace package's `exports` target `./src/x.js` to
 * that missing file and never to the `./src/x.ts` beside it, so the first
 * `@luke/features/*` import fails. The workaround is the one in
 * drizzle-team/drizzle-orm#849; #6384 is the open plan to replace jiti.
 * Delete it once drizzle-kit resolves workspace exports on its own.
 *
 * The history table is the migrator's, named here so a kit command that reads
 * it reads the same one: `public`, not Drizzle's default `drizzle` schema,
 * which an old migration drops (`DRIZZLE_MIGRATIONS` says why).
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schemas/index.ts",
  out: "./migrations",
  migrations: { schema: "public", table: "__drizzle_migrations" },
  strict: true,
  verbose: true,
});
