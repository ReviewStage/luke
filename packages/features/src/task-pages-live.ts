/**
 * task-pages-live.ts -- one task's pages, or one coding agent's on no task, as a window follows them over the service's held poll: the reads declared, and the pages as the held list answers them.
 *
 * The service answers one statement, each page at its newest version, as
 * the task's held list of pages reads it, the most recently written first
 * and then by id. The window's Inbox shows the pages of whichever task its
 * item is of, so the desktop follows them while that panel reads them. The
 * service answers `not-found` for a task or an agent the account does not
 * reach; asked with `?poll=true`, the rows inline at the poll address.
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
import { type PageLine, pageLineSchema, pageShowerSchema } from "./page-wire.js";
import { HOSTED_SERVICE_PATH } from "./service-paths.js";
import { HOSTED_API_ERROR } from "./service-wire.js";

/** Each page at its newest version, as its row delivers it: the page's line, with who showed it null where none was kept; the most recently written first, then by id. */
const PAGES = liveRows({
  row: EffectSchema.Struct({
    id: pageLineSchema.fields.id,
    title: pageLineSchema.fields.title,
    version: pageLineSchema.fields.version,
    at: pageLineSchema.fields.at,
    shownBy: EffectSchema.NullOr(pageShowerSchema),
  }),
  key: "id",
  order: [
    ["at", ORDER.DESC],
    ["id", ORDER.ASC],
  ],
});

/** One task's pages, by the task its query names under `?id=`. */
export const TASK_PAGES_READ = liveRead({
  name: "taskPages",
  path: HOSTED_SERVICE_PATH.LIVE_TASK_PAGES,
  params: { id: LIVE_PARAM.ID, [LIVE_USER_QUERY]: LIVE_PARAM.USER },
  mode: LIVE_MODE.SNAPSHOT,
  parts: { pages: PAGES },
  refuses: refuses(HOSTED_API_ERROR.NOT_FOUND),
});

/** One coding agent's own pages on no task, by the agent its query names under `?id=`, on the terms a task's are. */
export const AGENT_PAGES_READ = liveRead({
  name: "agentPages",
  path: HOSTED_SERVICE_PATH.LIVE_AGENT_PAGES,
  params: { id: LIVE_PARAM.ID, [LIVE_USER_QUERY]: LIVE_PARAM.USER },
  mode: LIVE_MODE.SNAPSHOT,
  parts: { pages: PAGES },
  refuses: refuses(HOSTED_API_ERROR.NOT_FOUND),
});

/** The pages as the held list answers them, from their rows: the most recently written first, then by id. */
export function pagesOfLiveRows(rows: typeof TASK_PAGES_READ.rows.Type): readonly PageLine[] {
  return orderedLiveRows(PAGES, rows.pages).map(
    ({ shownBy, ...line }: LiveRowOf<typeof PAGES>): PageLine =>
      shownBy === null ? line : { ...line, shownBy },
  );
}
