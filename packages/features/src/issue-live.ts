import { Schema as EffectSchema } from "effect";
import { type Issue, issuePrioritySchema, issueStatusSchema } from "./issue-wire.js";
import { sealedLiveQuerySchema } from "./live-wire.js";
import { countedNumber, wireUuidSchema } from "./service-wire.js";

/**
 * issue-live.ts -- a workspace's standing issues, followed over Neon Realtime: the sealed statement the service answers, and the rows it delivers.
 *
 * The service seals one statement of the workspace's standing issues for
 * the account the bearer names (`live-wire.ts` says how a sealed read is
 * followed), and the host builds the list the held read answers from its
 * rows. A row is flat, its creator as two columns, and the reader orders
 * the rows as the held read does, since Realtime keeps no order.
 */

/** A workspace's issues sealed for following: the address to subscribe at, and the one statement. */
export const issuesLiveAnswerSchema = EffectSchema.Struct({
  url: EffectSchema.String,
  queries: EffectSchema.Struct({ issues: sealedLiveQuerySchema }),
});

export type IssuesLiveAnswer = typeof issuesLiveAnswerSchema.Type;

/** One standing issue as its row delivers it: its creator as an id and a name, null where they are gone. */
const issueLiveRowSchema = EffectSchema.Struct({
  id: wireUuidSchema,
  workspaceId: EffectSchema.String,
  number: EffectSchema.Int.check(EffectSchema.isGreaterThanOrEqualTo(1)),
  title: EffectSchema.String,
  description: EffectSchema.String,
  status: issueStatusSchema,
  priority: issuePrioritySchema,
  creatorId: EffectSchema.NullOr(EffectSchema.String),
  creatorName: EffectSchema.NullOr(EffectSchema.String),
  createdAt: countedNumber,
  updatedAt: countedNumber,
});

/** The statement's rows as Realtime delivers them, decoded at the boundary before anything reads them. */
export const issuesLiveRowsSchema = EffectSchema.Struct({
  issues: EffectSchema.Array(issueLiveRowSchema),
});

export type IssuesLiveRows = typeof issuesLiveRowsSchema.Type;

/** The most recently changed first, and the highest number among those changed at one instant, as the held read orders them. */
function latestChangedFirst(a: Issue, b: Issue): number {
  return a.updatedAt !== b.updatedAt ? b.updatedAt - a.updatedAt : b.number - a.number;
}

/** The workspace's standing issues as the held list answers them, built from the live rows. */
export function issuesOfLiveRows(rows: IssuesLiveRows): readonly Issue[] {
  return rows.issues
    .map(
      (row): Issue => ({
        id: row.id,
        workspaceId: row.workspaceId,
        number: row.number,
        title: row.title,
        description: row.description,
        status: row.status,
        priority: row.priority,
        creator:
          row.creatorId === null ? null : { userId: row.creatorId, name: row.creatorName ?? "" },
        archivedAt: null,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }),
    )
    .toSorted(latestChangedFirst);
}
