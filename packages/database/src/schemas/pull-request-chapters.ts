import { index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type {
  PullRequestChaptersFailure,
  PullRequestChaptersStatus,
} from "../pull-request-chapters-vocabulary.js";
import { createdAt, timestamptz, updatedAt } from "./_helpers.js";
import { organization, user } from "./auth.js";

/**
 * pull-request-chapters.ts -- the chapters a pull request's diff was split into, made once per head commit and shared by its workspace.
 *
 * One row per workspace (`organization_id`), repository (`owner/name`, as
 * `coding_agent.repository` names one), pull request number, and head
 * commit: a member pressing Generate claims the row, and every member of the
 * workspace reads what it made. A newer head commit is a new row, so the
 * newest row of a pull request may stand on an older head than GitHub's,
 * which the panel draws as stale. `status` is where the generation stands
 * (`PULL_REQUEST_CHAPTERS_STATUS`); `chapters` and `model` stand only while
 * it is `ready`, and `failure_kind` only while it is `failed`. `claim` is
 * the generation that holds the row, a fresh value at every claim, so a
 * writer whose claim was taken over writes nothing. The row goes with its
 * workspace, and stays where the member who asked for it is gone.
 */
export const pullRequestChapters = pgTable(
  "pull_request_chapters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** The GitHub repository the pull request is in, as `owner/name`. */
    repository: text("repository").notNull(),
    pullRequestNumber: integer("pull_request_number").notNull(),
    /** The base commit the diff was read against at the latest claim. */
    baseSha: text("base_sha").notNull(),
    /** The head commit the chapters split; a newer head is a row of its own. */
    headSha: text("head_sha").notNull(),
    status: text("status").$type<PullRequestChaptersStatus>().notNull(),
    /** Why the latest generation failed; null unless `status` is `failed`. */
    failureKind: text("failure_kind").$type<PullRequestChaptersFailure>(),
    /** The id of the model that answered, as the generator called it; null unless `status` is `ready`. */
    model: text("model"),
    /**
     * The chapters as the generator answered them, which the endpoint decodes
     * with the chapters' wire schema on the way out, so the store holds them
     * as JSON alone; null unless `status` is `ready`.
     */
    chapters: jsonb("chapters").$type<unknown>(),
    /** The generation that holds the row, fresh at every claim; a finish or a failure names it to land. */
    claim: uuid("claim").notNull().defaultRandom(),
    /** The member who pressed Generate for the latest claim; null once their account is gone. */
    requestedBy: text("requested_by").references(() => user.id, { onDelete: "set null" }),
    /** When the latest claim was taken; a `generating` row claimed longer ago than the bound is taken over. */
    startedAt: timestamptz("started_at").notNull(),
    /** When the latest generation finished or failed; null while it is generating. */
    finishedAt: timestamptz("finished_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    // One generation per head commit of a pull request in a workspace: the claim's conflict target.
    uniqueIndex("pull_request_chapters_head").on(
      table.organizationId,
      table.repository,
      table.pullRequestNumber,
      table.headSha,
    ),
    // The panel reads a pull request's newest claim in its workspace, whatever its head.
    index("pull_request_chapters_latest").on(
      table.organizationId,
      table.repository,
      table.pullRequestNumber,
      table.startedAt,
    ),
  ],
);
