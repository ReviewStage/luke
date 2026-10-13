import type { ContextWindow } from "@sidecar/hosted/coding-agent-wire";
import { pgTable, primaryKey, text } from "drizzle-orm/pg-core";
import { createdAt, timestamps, timestamptz } from "./_helpers.js";
import { user } from "./auth.js";

/**
 * One row per account for scalar cross-device preferences. Platform-local
 * settings stay in each app's own store; only preferences that should follow
 * the signed-in account belong here.
 */
export const accountPreference = pgTable("account_preference", {
  userId: text("user_id")
    .primaryKey()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  voice: text("voice"),
  defaultWorkspaceProvider: text("default_workspace_provider"),
  /**
   * The model and effort a coding agent starts on when Start is clicked, as
   * AI Gateway's catalog names them (`hosted/model-catalog.ts`); null on both
   * means the account has never chosen and starts on the catalog's default.
   * The context window beside them is null for the model's whole window,
   * which is also what a choice written before the window could be chosen
   * reads as, and `standard` where the smaller window was chosen.
   */
  codingAgentModel: text("coding_agent_model"),
  codingAgentEffort: text("coding_agent_effort"),
  codingAgentContextWindow: text("coding_agent_context_window").$type<ContextWindow>(),
  /**
   * The Markdown a new plan of this account starts from, kept verbatim as
   * Settings wrote it; null means the built-in `DEFAULT_PLAN_TEMPLATE`
   * (`@sidecar/hosted/plan-document-template`). Its own path writes it
   * (`/api/account/plan-template`), apart from the preferences snapshot.
   */
  planTemplate: text("plan_template"),
  createdAt: createdAt(),
  /**
   * When the preferences part was last written; null on a row only a
   * coding-agent choice or a plan template opened. The desktop reads the instant's presence as
   * a snapshot to apply over its own settings, so a row with none written
   * must answer none, or a never-synced Mac would take an empty snapshot
   * over the voice it holds.
   */
  updatedAt: timestamptz("updated_at"),
});

/**
 * Workspace creation defaults are keyed by provider. Keeping them as rows
 * avoids turning account preferences into an open-ended JSON settings bag.
 */
export const accountWorkspacePreference = pgTable(
  "account_workspace_preference",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    providerId: text("provider_id").notNull(),
    defaultProjectId: text("default_project_id"),
    agent: text("agent"),
    model: text("model"),
    effort: text("effort"),
    ...timestamps,
  },
  (table) => [primaryKey({ columns: [table.userId, table.providerId] })],
);
