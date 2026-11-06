import { index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type {
  PullRequestChaptersFailure,
  PullRequestChaptersStatus,
} from "../pull-request-chapters-vocabulary.js";
import { createdAt, timestamptz, updatedAt } from "./_helpers.js";
import { organization, user } from "./auth.js";

export const pullRequestChapters = pgTable(
  "pull_request_chapters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    repository: text("repository").notNull(),
    pullRequestNumber: integer("pull_request_number").notNull(),
    baseSha: text("base_sha").notNull(),
    headSha: text("head_sha").notNull(),
    status: text("status").$type<PullRequestChaptersStatus>().notNull(),
    failureKind: text("failure_kind").$type<PullRequestChaptersFailure>(),
    model: text("model"),
    chapters: jsonb("chapters").$type<unknown>(),
    claim: uuid("claim").notNull().defaultRandom(),
    requestedBy: text("requested_by").references(() => user.id, { onDelete: "set null" }),
    startedAt: timestamptz("started_at").notNull(),
    finishedAt: timestamptz("finished_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("pull_request_chapters_head").on(
      table.organizationId,
      table.repository,
      table.pullRequestNumber,
      table.headSha,
    ),
    index("pull_request_chapters_latest").on(
      table.organizationId,
      table.repository,
      table.pullRequestNumber,
      table.startedAt,
    ),
  ],
);
