import { bigint, pgTable, text } from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";

export const githubRepository = pgTable("github_repository", {
  id: bigint("id", { mode: "number" }).primaryKey(),
  fullName: text("full_name").notNull(),
  githubUpdatedAt: timestamptz("github_updated_at").notNull(),
});
