/**
 * browser-tabs-live.ts -- one task's Browser tabs, every one of its agents', or one coding agent's, as a window's side panel follows them over the service's held poll: the reads declared, and the tabs as the held list answers them.
 *
 * The service answers one statement that delivers every tab the held list
 * of tabs lists the account, the agent's pointer on each among it, the
 * oldest first and then by id, so a window draws the pointer moving within
 * a moment of the agent's action. The service answers `not-found` for a
 * task or an agent the account does not reach; asked with `?poll=true`, the
 * rows inline at the poll address.
 */

import {
  type AgentBrowserTab,
  agentBrowserTabLineSchema,
  agentBrowserTabOf,
} from "./agent-browser-tab-wire.js";
import { refuses } from "./contract/base.js";
import { LIVE_MODE, LIVE_PARAM, liveRead, liveRows, ORDER, orderedLiveRows } from "./live-read.js";
import { LIVE_USER_QUERY } from "./live-wire.js";
import { HOSTED_SERVICE_PATH } from "./service-paths.js";
import { HOSTED_API_ERROR } from "./service-wire.js";

/** Each tab as the service keeps it, the oldest first, then by id. */
const TABS = liveRows({
  row: agentBrowserTabLineSchema,
  key: "id",
  order: [
    ["createdAt", ORDER.ASC],
    ["id", ORDER.ASC],
  ],
});

/** One task's tabs, every one of its agents', by the task its query names under `?id=`. */
export const TASK_BROWSER_TABS_READ = liveRead({
  name: "taskBrowserTabs",
  path: HOSTED_SERVICE_PATH.LIVE_TASK_BROWSER_TABS,
  params: { id: LIVE_PARAM.ID, [LIVE_USER_QUERY]: LIVE_PARAM.USER },
  mode: LIVE_MODE.SNAPSHOT,
  parts: { tabs: TABS },
  refuses: refuses(HOSTED_API_ERROR.NOT_FOUND),
});

/** One coding agent's tabs, on a task or on none, by the agent its query names under `?id=`, on the terms a task's are. */
export const AGENT_BROWSER_TABS_READ = liveRead({
  name: "agentBrowserTabs",
  path: HOSTED_SERVICE_PATH.LIVE_AGENT_BROWSER_TABS,
  params: { id: LIVE_PARAM.ID, [LIVE_USER_QUERY]: LIVE_PARAM.USER },
  mode: LIVE_MODE.SNAPSHOT,
  parts: { tabs: TABS },
  refuses: refuses(HOSTED_API_ERROR.NOT_FOUND),
});

/** A task's or an agent's tabs as Realtime delivers them: none for one the account no longer reaches. */
type BrowserTabsLiveRows = typeof TASK_BROWSER_TABS_READ.rows.Type;

/**
 * The tabs as the held list answers them at the instant given, in epoch
 * milliseconds, from their rows: the oldest first, then by id. Note that a
 * takeover lapses with no row moving, so a reader reads its rows again at
 * `nextBrowserTabLapse`.
 */
export function browserTabsOfLiveRows(
  rows: BrowserTabsLiveRows,
  now: number,
): readonly AgentBrowserTab[] {
  return orderedLiveRows(TABS, rows.tabs).map((line) => agentBrowserTabOf(line, now));
}

/** The next instant, in epoch milliseconds, a takeover the rows hold lapses at after `now`; none where none stands. */
export function nextBrowserTabLapse(rows: BrowserTabsLiveRows, now: number): number | undefined {
  const lapses = rows.tabs.flatMap(({ driverUserId, heldUntil }) =>
    driverUserId !== null && heldUntil !== null && heldUntil > now ? [heldUntil] : [],
  );
  return lapses.length === 0 ? undefined : Math.min(...lapses);
}
