import { Schema } from "effect";
import { refuses } from "./contract/base.js";
import {
  LIVE_MODE,
  LIVE_PARAM,
  type LiveReadAnswer,
  type LiveRowOf,
  liveRead,
  liveRows,
  ORDER,
  orderedLiveRows,
} from "./live-read.js";
import { LIVE_READ, LIVE_USER_QUERY } from "./live-wire.js";
import { type MemorySummary, memoryIdSchema } from "./memory-wire.js";
import { HOSTED_SERVICE_PATH } from "./service-paths.js";
import { countedNumber, HOSTED_API_ERROR } from "./service-wire.js";

/**
 * memory-live.ts -- one workspace's memories as the host follows them over the service's held poll: the read declared, and the memories as Settings › Memory draws them.
 *
 * The service answers one statement, every memory of the workspace while the
 * reader is a member of it, each with the name of the member whose words it
 * holds and whether the reader may forget it, both worked out in the
 * statement itself. The rows come in no order, so the reader orders them as
 * the memories read answers them (`memory-wire.ts`): most recently kept or
 * corrected first.
 */

/**
 * One workspace's memories as the host follows them: one part, every memory
 * of the workspace while the reader is a member of it, each with its
 * keeper's id and name, each null once that account is gone, most recently
 * kept or corrected first, then the newest kept, then by id. The service
 * answers `not-found` for a workspace the account is no member of.
 */
export const WORKSPACE_MEMORIES_READ = liveRead({
  name: LIVE_READ.MEMORIES,
  path: HOSTED_SERVICE_PATH.LIVE_WORKSPACE_MEMORIES,
  params: { [LIVE_USER_QUERY]: LIVE_PARAM.USER, workspaceId: LIVE_PARAM.TEXT },
  mode: LIVE_MODE.SNAPSHOT,
  parts: {
    memories: liveRows({
      row: Schema.Struct({
        id: memoryIdSchema,
        text: Schema.String,
        keeperId: Schema.NullOr(Schema.String),
        keeperName: Schema.NullOr(Schema.String),
        forgettable: Schema.Boolean,
        createdAt: countedNumber,
        updatedAt: countedNumber,
      }),
      key: "id",
      order: [
        ["updatedAt", ORDER.DESC],
        ["createdAt", ORDER.DESC],
        ["id", ORDER.ASC],
      ],
    }),
  },
  refuses: refuses(HOSTED_API_ERROR.NOT_FOUND),
});

export type WorkspaceMemoriesLiveAnswer = LiveReadAnswer<typeof WORKSPACE_MEMORIES_READ>;

/** One memory as the statement delivers it. */
export type MemoryLiveRow = LiveRowOf<typeof WORKSPACE_MEMORIES_READ.parts.memories>;

/** The member whose words a row holds, as the reader is told; nobody for an account that is gone. */
function keeperOf(row: MemoryLiveRow): MemorySummary["keptBy"] {
  return row.keeperId === null || row.keeperName === null
    ? null
    : { userId: row.keeperId, name: row.keeperName };
}

/** A workspace's memories as the held read answers them, most recently kept or corrected first. */
export function memoriesOfLiveRows(rows: readonly MemoryLiveRow[]): readonly MemorySummary[] {
  return orderedLiveRows(WORKSPACE_MEMORIES_READ.parts.memories, rows).map((row) => ({
    id: row.id,
    text: row.text,
    keptBy: keeperOf(row),
    forgettable: row.forgettable,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}
