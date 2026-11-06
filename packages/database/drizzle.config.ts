import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schemas/index.ts",
  out: "./migrations",
  migrations: { schema: "public", table: "__drizzle_migrations" },
  strict: true,
  verbose: true,
});
