import {
  ISSUE_PRIORITY,
  ISSUE_STATUS,
  type IssuePriority,
  type IssueStatus,
} from "@luke/features/issue-wire";
import { index, integer, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, timestamptz, updatedAt } from "./_helpers.js";
import { organization, user } from "./auth.js";

/**
 * issue.ts -- a workspace's issues, each a title, a Markdown description, a status, and a priority.
 *
 * An issue is its workspace's (`organization_id`), and goes with it.
 * `number` counts a workspace's issues from one in the order they were
 * filed, unique inside the workspace and never reused, which the identifier
 * a window draws is read from. Status and priority are the wire's own words
 * (`@luke/features/issue-wire`). `creator_id` is the member who filed it,
 * kept where they leave the workspace and null once their account is gone.
 * `archived_at` stamps an issue archived; null while it is not.
 */
export const issue = pgTable(
  "issue",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    status: text("status").$type<IssueStatus>().notNull().default(ISSUE_STATUS.BACKLOG),
    priority: text("priority").$type<IssuePriority>().notNull().default(ISSUE_PRIORITY.NONE),
    creatorId: text("creator_id").references(() => user.id, { onDelete: "set null" }),
    archivedAt: timestamptz("archived_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    // The identifier names one issue of its workspace, and a filing takes the next number.
    uniqueIndex("issue_org_number").on(table.organizationId, table.number),
    // The list reads a workspace's issues newest changed first.
    index("issue_org_updated").on(table.organizationId, table.updatedAt),
  ],
);
