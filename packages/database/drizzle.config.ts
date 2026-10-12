import { defineConfig } from "drizzle-kit";

/**
 * drizzle-kit's view of the database: the schema modules are the source of
 * truth and `pnpm db:generate` writes the migration that brings the last
 * snapshot up to them. The Effect migrator (`src/core/migrator.ts`) applies
 * what it writes; drizzle-kit never connects to a database here.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schemas/index.ts",
  out: "./migrations",
  strict: true,
  verbose: true,
});
