/**
 * task-history-live.ts -- one task's newest page of description history as the version history follows it over the service's held poll: the read declared, and the page as the history's held read answers it.
 *
 * The service answers one statement that delivers the newest revisions as
 * the history's held read of its newest page reads them, newest first, one
 * past the page among them to say whether an older page stands. The desktop
 * follows it while the task's version history stands. The service answers
 * `not-found` for a task the account does not reach; asked with
 * `?poll=true`, the rows inline at the poll address.
 */

import { Schema as EffectSchema } from "effect";
import { refuses } from "./contract/base.js";
import {
  LIVE_MODE,
  LIVE_PARAM,
  type LiveRowOf,
  liveRead,
  liveRows,
  ORDER,
  orderedLiveRows,
} from "./live-read.js";
import { LIVE_USER_QUERY } from "./live-wire.js";
import { HOSTED_SERVICE_PATH } from "./service-paths.js";
import { countedNumber, HOSTED_API_ERROR } from "./service-wire.js";
import {
  DESCRIPTION_ACTOR,
  DESCRIPTION_HISTORY_BOUNDS,
  type DescriptionRevisionLine,
  type DescriptionRevisionsAnswer,
  descriptionRevisionSeqSchema,
  UNKNOWN_AGENT_LABEL,
} from "./task-wire.js";

/** One task's newest page of description history, by the task its query names under `?id=`. */
export const TASK_HISTORY_READ = liveRead({
  name: "taskHistory",
  path: HOSTED_SERVICE_PATH.LIVE_TASK_HISTORY,
  params: { id: LIVE_PARAM.ID, [LIVE_USER_QUERY]: LIVE_PARAM.USER },
  mode: LIVE_MODE.SNAPSHOT,
  parts: {
    revisions: liveRows({
      /**
       * One revision as its row delivers it: who wrote it, the member and
       * the agent as their rows name them now, and its instants in epoch
       * milliseconds. Note that the row still carries `liveSessionId` and
       * `callId`, always null, for a released desktop that decodes them;
       * this build reads neither.
       */
      row: EffectSchema.Struct({
        seq: descriptionRevisionSeqSchema,
        actor: EffectSchema.Literals(Object.values(DESCRIPTION_ACTOR)),
        editorId: EffectSchema.NullOr(EffectSchema.String),
        editorName: EffectSchema.NullOr(EffectSchema.String),
        liveSessionId: EffectSchema.NullOr(EffectSchema.String),
        agentId: EffectSchema.NullOr(EffectSchema.String),
        agentModel: EffectSchema.NullOr(EffectSchema.String),
        agentTitle: EffectSchema.NullOr(EffectSchema.String),
        callId: EffectSchema.NullOr(EffectSchema.String),
        changes: countedNumber,
        restoredFrom: EffectSchema.NullOr(descriptionRevisionSeqSchema),
        at: countedNumber,
        startedAt: countedNumber,
        restoredAt: EffectSchema.NullOr(countedNumber),
      }),
      key: "seq",
      order: [["seq", ORDER.DESC]],
    }),
  },
  refuses: refuses(HOSTED_API_ERROR.NOT_FOUND),
});

type TaskHistoryLiveRow = LiveRowOf<typeof TASK_HISTORY_READ.parts.revisions>;

/** A revision's line as the version history lists it, from its row, a coding agent named as its row names it now. */
function revisionLineOf(row: TaskHistoryLiveRow): DescriptionRevisionLine {
  return {
    seq: row.seq,
    lastEdit: {
      actor: row.actor,
      ...(row.editorId === null || row.editorName === null
        ? undefined
        : { by: { userId: row.editorId, name: row.editorName } }),
      ...(row.actor === DESCRIPTION_ACTOR.AGENT
        ? { label: row.agentTitle ?? row.agentModel ?? UNKNOWN_AGENT_LABEL }
        : undefined),
      ...(row.agentId === null ? undefined : { agentId: row.agentId }),
      at: row.at,
      duringCall: false,
    },
    ...(row.agentId === null ? undefined : { agentId: row.agentId }),
    startedAt: row.startedAt,
    changes: row.changes,
    ...(row.restoredFrom === null || row.restoredAt === null
      ? undefined
      : { restoredFrom: { seq: row.restoredFrom, at: row.restoredAt } }),
  };
}

/**
 * The history's newest page as its held read answers it, from its rows:
 * the newest revisions first, a page of them, and where the next older page
 * is read before where one past the page was delivered.
 */
export function revisionsOfLiveRows(
  rows: typeof TASK_HISTORY_READ.rows.Type,
): DescriptionRevisionsAnswer {
  const newest = orderedLiveRows(TASK_HISTORY_READ.parts.revisions, rows.revisions);
  const page = newest.slice(0, DESCRIPTION_HISTORY_BOUNDS.PAGE);
  const revisions = page.map(revisionLineOf);
  const oldest = page.at(-1);
  return newest.length > page.length && oldest !== undefined
    ? { revisions, earlier: oldest.seq }
    : { revisions };
}
