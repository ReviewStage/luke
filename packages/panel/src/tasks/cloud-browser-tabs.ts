/**
 * cloud-browser-tabs.ts -- the Browser tabs open in a task's agents' cloud browsers, as the side panel lists them: read from the service while the task is open, then followed live.
 *
 * The service keeps every tab of the task (`@luke/features/agent-browser-tab-wire`),
 * so the panel lists them on any client and after a relaunch. The tabs are
 * read once, then followed over Neon Realtime through the host
 * (`TASKS_BROWSER_TABS_FOLLOW`), which polls the read where Realtime fails it
 * and tells the tabs again as a takeover lapses, so the agent's pointer on a
 * tab is drawn within a moment of its move. Every reader of the task shares
 * one read and one follow; a read or a follow the host did not answer keeps
 * the list as it last stood. What a tab says (its address and title) is
 * drawn and held nowhere past the read: no trace, count, or app state (root
 * `AGENTS.md`'s cloud browser line).
 */

import { useAtomValue } from "@effect/atom-react";
import type { AgentBrowserTab } from "@luke/features/agent-browser-tab-wire";
import { ACT_KIND } from "@luke/host/acts";
import { Duration, Effect, Stream } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import { askAct } from "../act.js";
import { rendererRuntime } from "../renderer-runtime.js";

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

/**
 * The task's tabs as the host's follow tells them, none for a change it
 * could not read; the follow ends quietly where the host refused it, and is
 * let go as the stream is.
 */
function followedTabs(taskId: string): Stream.Stream<readonly AgentBrowserTab[] | undefined> {
  return Stream.unwrap(
    Effect.map(
      Effect.tryPromise(() => askAct(ACT_KIND.TASKS_BROWSER_TABS_FOLLOW, { taskId })),
      (opened) => Stream.fromAsyncIterable(opened, (cause) => cause),
    ),
  ).pipe(
    Stream.map((answer) => ("tabs" in answer ? answer.tabs : undefined)),
    Stream.ignore,
  );
}

/** The task's tabs as the first read answers them, then as each change the follow tells. */
const tabsAtom = Atom.family((taskId: string) =>
  rendererRuntime.atom(
    Stream.concat(Stream.fromEffect(readTabs(taskId)), followedTabs(taskId)).pipe(
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
