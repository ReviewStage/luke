import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/main/session-index/schema.ts",
  out: "./drizzle/session-index",
  dialect: "sqlite",
});
