import { defineConfig } from "drizzle-kit";

const connectionString = process.env.DATABASE_URL_UNPOOLED;

const config = {
  dialect: "postgresql" as const,
  schema: "./server/db/*-schema.ts",
  out: "./drizzle",
  strict: true,
};

export default defineConfig(
  connectionString ? { ...config, dbCredentials: { url: connectionString } } : config,
);
