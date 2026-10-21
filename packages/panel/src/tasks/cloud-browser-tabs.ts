/**
 * cloud-browser-tabs.ts -- the Browser tabs open in a task's agents' cloud browsers, as the side panel lists them: read from the service while the task is open, every few seconds.
 *
 * The service keeps every tab of the task (`@luke/features/agent-browser-tab-wire`),
 * so the panel lists them on any client and after a relaunch. No live read
 * of the task's record carries them, so the list is read again on a short
 * beat while one reader stands, every reader of the task sharing one read;
 * a read the host refused keeps the list as it last stood. What a tab says
 * (its address and title) is drawn and held nowhere past the read: no
 * trace, count, or app state (root `AGENTS.md`'s cloud browser line).
 */

import { useAtomValue } from "@effect/atom-react";
import type { AgentBrowserTab } from "@luke/features/agent-browser-tab-wire";
import { ACT_KIND } from "@luke/host/acts";
import { Duration, Effect, Schedule, Stream } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import { askAct } from "../act.js";
import { rendererRuntime } from "../renderer-runtime.js";

/** How often a task's tabs are read again while it is open. */
export const CLOUD_BROWSER_TABS_EVERY = Duration.seconds(5);

/** How long after its agent last acted on a tab the tab says the agent is using it. */
export const CLOUD_BROWSER_AGENT_RECENT = Duration.seconds(15);

/** A task with no cloud Browser tab, the same array every render. */
const NO_TABS: readonly AgentBrowserTab[] = [];

/** One read of the task's tabs; none where the host refused it. */
function readTabs(taskId: string): Effect.Effect<readonly AgentBrowserTab[] | undefined> {
  return Effect.promise(() =>
    askAct(ACT_KIND.TASKS_BROWSER_TABS, { taskId }).then(
      (answer) => answer.tabs,
      () => undefined,
    ),
  );
}

/** The task's tabs as each read answers them, read again on the beat while a reader stands. */
const tabsAtom = Atom.family((taskId: string) =>
  rendererRuntime.atom(
    Stream.fromEffectSchedule(readTabs(taskId), Schedule.spaced(CLOUD_BROWSER_TABS_EVERY)).pipe(
      Stream.filter((tabs): tabs is readonly AgentBrowserTab[] => tabs !== undefined),
    ),
  ),
);

/** Reads nothing, for a panel that lists no cloud Browser tab. */
const unreadAtom = Atom.make<AsyncResult.AsyncResult<readonly AgentBrowserTab[]>>(
  AsyncResult.initial(),
);

/**
 * The open task's cloud Browser tabs, the oldest first; none while unread,
 * and none at all where `listing` is off: the Browser tab experiment off, or
 * no task open.
 */
export function useCloudBrowserTabs(
  taskId: string | undefined,
  listing: boolean,
): readonly AgentBrowserTab[] | undefined {
  const read = useAtomValue(listing && taskId !== undefined ? tabsAtom(taskId) : unreadAtom);
  if (!listing) return NO_TABS;
  return AsyncResult.isSuccess(read) ? read.value : undefined;
}
