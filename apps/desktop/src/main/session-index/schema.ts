import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const observedSessions = sqliteTable(
  "observed_sessions",
  {
    providerId: text("provider_id").notNull(),
    providerSessionId: text("provider_session_id").notNull(),
    title: text("title").notNull(),
    branch: text("branch"),
    recap: text("recap"),
    status: text("status").notNull(),
    observedAt: integer("observed_at").notNull(),
    providerLabel: text("provider_label").notNull(),
    location: text("location").notNull(),
    repositoryLabel: text("repository_label"),
    workspaceLabel: text("workspace_label"),
    standing: integer("standing", { mode: "boolean" }).notNull(),
    holdingForDeveloper: integer("holding_for_developer", { mode: "boolean" }).notNull(),
    aboutHash: text("about_hash").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.providerId, table.providerSessionId],
    }),
  ],
);

export type ObservedSessionRow = typeof observedSessions.$inferInsert;
