import { index, integer, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";
import { task } from "./plan.js";

/**
 * plan-page.ts -- a plan's pages, one row per version of a page.
 *
 * A page is an interactive HTML document an agent wrote for the plan, and it
 * has no row of its own: its versions share its id, numbered from one, and
 * the newest names it. Each version is written once and never changed, so an
 * earlier one reads as it was shown. A version also has an id of its own, so
 * one version can be named alone, as a link to it would name it. The HTML is
 * stored as written, like the plan's own text, readable by an operator and
 * kept the developer's own by the plan it hangs off. Rows go with their plan.
 */
export const planPageVersion = pgTable(
  "plan_page_version",
  {
    /** The version's own id. */
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("plan_id")
      .notNull()
      .references(() => task.id, { onDelete: "cascade" }),
    /** The page the version is of, the same on each of its versions. */
    pageId: uuid("page_id").notNull(),
    /** The version's number within its page, from one. */
    version: integer("version").notNull(),
    title: text("title").notNull(),
    /** The page's whole HTML document, as the agent wrote it. */
    html: text("html").notNull(),
    at: timestamptz("at").notNull(),
  },
  (table) => [
    unique("plan_page_version_page_version").on(table.pageId, table.version),
    // A plan's pages are read together, each by its newest version.
    index("plan_page_version_plan").on(table.taskId),
  ],
);
