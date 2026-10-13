import { defineConfig } from "drizzle-kit";

/**
 * drizzle-kit's view of the database: the schema modules are the source of
 * truth, `pnpm db:generate --name=…` writes the folder that brings the newest
 * snapshot up to them, and `pnpm check:migrations` refuses two branches'
 * migrations that do not commute. Drizzle's migrator (`src/core/migrator.ts`)
 * applies the folders; drizzle-kit never connects to a database here.
 *
 * `db:generate` runs drizzle-kit under tsx's loader, because drizzle-kit
 * loads the schema modules through jiti, which does not read a workspace
 * package's `exports` target `./src/x.js` as the `./src/x.ts` beside it.
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
