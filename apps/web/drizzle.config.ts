import { defineConfig } from "drizzle-kit";

const connectionString = process.env.DATABASE_URL;

export default defineConfig({
  dialect: "postgresql",
  schema: "./server/db/schema.ts",
  out: "./drizzle",
  strict: true,
  ...(connectionString ? { dbCredentials: { url: connectionString } } : {}),
});
