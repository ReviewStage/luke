import { index, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";
import { organization, user } from "./auth.js";

/**
 * memory.ts -- one memory of a workspace: a settled fact or convention a coding agent kept for the workspace's later work.
 *
 * A memory is the workspace's, shared by every member, never a task's or a
 * repository's, so every agent working in the workspace may recall it and no
 * agent of another workspace ever does. A coding agent writes it through the
 * remember tool (`packages/service/src/agents/memory-tools.ts`), and corrects
 * it in place, so a newer fact replaces the older one's text under the same
 * id and the workspace never holds both. `user_id` names the member whose
 * words it holds: the starter of the agent that kept it, or of the one that
 * last corrected it. The memory is the workspace's knowledge, as its git
 * history is, so it outlives the member who said it: one who leaves the
 * workspace leaves their memories with it, and deleting their account leaves
 * them too, `user_id` null, read as nobody the service can name, as
 * `plan_revision` keeps its writer. Forgetting one, from Settings, deletes the
 * row, and the row leaves with its workspace.
 *
 * A private memory is the one exception to all of that: `private_to` names
 * the one member whose operator recalls it, the member's own preferences and
 * what they are juggling, and no teammate reads, corrects, or forgets it. It
 * is that member's, not the workspace's, so it leaves with their account.
 */
export const memory = pgTable(
  "memory",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** Null once the member's account is gone, which reads as nobody the service can name. */
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    text: text("text").notNull(),
    /** The one member who recalls it, null for a memory shared by the workspace; gone with that member's account. */
    privateTo: text("private_to").references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamptz("created_at").notNull(),
    updatedAt: timestamptz("updated_at").notNull(),
  },
  (table) => [index("memory_organization_updated").on(table.organizationId, table.updatedAt)],
);
