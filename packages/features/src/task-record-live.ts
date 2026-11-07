/**
 * task-record-live.ts -- where an open task's description, pages, calls, and agents' code stand, as the desktop follows them over the service's held poll: the read declared.
 *
 * The service answers one statement a part, each a mark that moves as its
 * rows do and carries none of their words: the description's last save
 * (`description`), the pages agents showed (`pages`), the calls about the
 * task (`calls`), and the code its agents showed (`code`). The last two
 * answer no rows now that we take no calls and no agent shows code, but a
 * released desktop still requires them, and this build no longer reads
 * pages here, since it holds a task's pages on their own read
 * (`LIVE_READ.PAGES`). The desktop reads the description again once its
 * mark moves. The service answers `not-found` for a task the account does
 * not reach, and `unavailable` where its deployment's Realtime is
 * misconfigured, which the desktop answers by asking again.
 */

import { Schema as EffectSchema } from "effect";
import { refuses } from "./contract/base.js";
import {
  LIVE_MODE,
  LIVE_PARAM,
  type LiveReadAnswer,
  liveRead,
  liveRows,
  ORDER,
} from "./live-read.js";
import { LIVE_USER_QUERY } from "./live-wire.js";
import { HOSTED_SERVICE_PATH } from "./service-paths.js";
import { HOSTED_API_ERROR } from "./service-wire.js";

/** A part that answers no rows now, which a released desktop still follows: each row its id alone. */
const NO_ROWS = liveRows({
  row: EffectSchema.Struct({ id: EffectSchema.String }),
  key: "id",
  order: [["id", ORDER.ASC]],
});

/** An open task's record, by the task its query names under `?id=`. */
export const TASK_RECORD_READ = liveRead({
  name: "taskRecord",
  path: HOSTED_SERVICE_PATH.LIVE_TASK_RECORD,
  params: { id: LIVE_PARAM.ID, [LIVE_USER_QUERY]: LIVE_PARAM.USER },
  mode: LIVE_MODE.SNAPSHOT,
  parts: {
    /** The task's description as its row delivers it: when its text was last saved, epoch milliseconds, as the open document's `updatedAt` reads it. */
    description: liveRows({
      row: EffectSchema.Struct({ taskId: EffectSchema.String, savedAt: EffectSchema.Finite }),
      key: "taskId",
      order: [["taskId", ORDER.ASC]],
    }),
    /** One page shown on the task as its row delivers it: its newest version's number. */
    pages: liveRows({
      row: EffectSchema.Struct({ pageId: EffectSchema.String, version: EffectSchema.Finite }),
      key: "pageId",
      order: [["pageId", ORDER.ASC]],
    }),
    calls: NO_ROWS,
    code: NO_ROWS,
  },
  refuses: refuses(HOSTED_API_ERROR.NOT_FOUND),
});

export type TaskRecordLiveAnswer = LiveReadAnswer<typeof TASK_RECORD_READ>;

/** The task's record as Realtime delivers it, a part's rows each, of which this build compares the description's alone: none of any for a task the account no longer reaches. */
export type TaskRecordLiveRows = typeof TASK_RECORD_READ.rows.Type;
