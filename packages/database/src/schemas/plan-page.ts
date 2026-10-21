import type { PageShower } from "@luke/features/page-wire";
import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";
import { codingAgent } from "./coding-agent.js";
import { task } from "./task.js";

/**
 * plan-page.ts -- the pages agents and Luke showed, one row per version of a page, on a task or on a coding agent with no task.
 *
 * A page is an interactive HTML document an agent wrote, and it has no row
 * of its own: its versions share its id, numbered from one, and
 * the newest names it. Each version is written once and never changed, so an
 * earlier one reads as it was shown. A version also has an id of its own, so
 * one version can be named alone, as a link to it would name it, and says who
 * showed it, Luke or a coding agent by its id, named as it is read. The HTML is
 * stored as written, like the plan's own text, readable by an operator and
 * kept the developer's own by what it hangs off.
 *
 * A page stands on a task where whoever showed it worked on one, and is the
 * task's then, read by the task's rule of who may read it, whoever showed
 * it. A coding agent on no task shows its pages on itself: `task_id` null,
 * read by the agent's rule. Every version a coding agent showed names it in
 * `agent_id` as well, on a task or not, so the agent's own work is found by
 * it; one Luke showed, or one shown before the column, names none, and at
 * least one of the two always stands.
 *
 * Rows go with their task, as its agents do (`coding_agent.task_id`). An
 * agent's deletion only clears its name from a task's versions, as a plan
 * revision's and a comment's are cleared, so a task's page never loses a
 * version from the middle of its run; the pages of an agent on no task have
 * no other owner, so whoever deletes the agent deletes them in the same
 * transaction, and the owner check refuses a deletion that forgot rather
 * than leave a page that belongs to nothing.
 */
export const planPageVersion = pgTable(
  "plan_page_version",
  {
    /** The version's own id. */
    id: uuid("id").primaryKey().defaultRandom(),
    /** The task the page stands on; null for a page of a coding agent on no task. */
    taskId: uuid("task_id").references(() => task.id, { onDelete: "cascade" }),
    /** The coding agent that showed the version, on a task or not; null for one Luke showed, or one shown before it was kept. */
    agentId: uuid("agent_id").references(() => codingAgent.id, { onDelete: "set null" }),
    /** The page the version is of, the same on each of its versions. */
    pageId: uuid("page_id").notNull(),
    /** The version's number within its page, from one. */
    version: integer("version").notNull(),
    title: text("title").notNull(),
    /** The page's whole HTML document, as the agent wrote it. */
    html: text("html").notNull(),
    /** Who showed the version, Luke or a coding agent by its id (`PageShower`); null for one shown before it was kept. */
    shownBy: jsonb("shown_by").$type<PageShower>(),
    at: timestamptz("at").notNull(),
  },
  (table) => [
    unique("plan_page_version_page_version").on(table.pageId, table.version),
    // A plan's pages are read together, each by its newest version.
    index("plan_page_version_task").on(table.taskId),
    // An agent's own pages are read together, and its deletion clears its name from the rest.
    index("plan_page_version_agent").on(table.agentId),
    // A page stands on a task or on the agent that showed it, never on nothing.
    check(
      "plan_page_version_owner",
      sql`${table.taskId} is not null or ${table.agentId} is not null`,
    ),
  ],
);
