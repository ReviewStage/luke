/**
 * cloud-browser-tabs.ts -- the Browser tabs open in a task's agents' cloud browsers, as the side panel lists them: read from the service while the task is open, then followed live.
 *
 * The service keeps every tab of the task (`@luke/features/agent-browser-tab-wire`),
 * so the panel lists them on any client and after a relaunch. The tabs are
 * read once, then followed over Neon Realtime through the host
 * (`TASKS_BROWSER_TABS_FOLLOW`), which polls the read where Realtime fails it
 * and tells the tabs again as a takeover lapses, so the agent's pointer on a
 * tab is drawn within a moment of its move. A follow the host refused, or
 * one that ended, is read and followed afresh `CLOUD_BROWSER_TABS_AGAIN`
 * later, so a panel whose follow broke reads the tabs on that beat as it
 * once did. Every reader of the task shares one read and one follow; a read
 * or a follow the host did not answer keeps the list as it last stood. What a tab says (its address and title) is
 * drawn and held nowhere past the read: no trace, count, or app state (root
 * `AGENTS.md`'s cloud browser line).
 *
 * A tab the member opened from this window (`cloud-browser-open.tsx`) is
 * listed from the moment the service answered it, until the read or the
 * follow first lists it, so the panel lands on it before Realtime has told
 * it; and its pane takes it over once its view opens (`claimTakeOver`),
 * since the service's takeover is the member's but not yet their view's.
 */

import { useAtomValue } from "@effect/atom-react";
import type { AgentBrowserTab } from "@luke/features/agent-browser-tab-wire";
import { ACT_KIND } from "@luke/host/acts";
import { Duration, Effect, Schedule, Stream } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import { useEffect, useSyncExternalStore } from "react";
import { askAct } from "../act.js";
import { rendererRuntime } from "../renderer-runtime.js";

/** How long after a follow broke or ended the tabs are read and followed again. */
export const CLOUD_BROWSER_TABS_AGAIN = Duration.seconds(5);

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

/**
 * The task's tabs as a read answers them, then as each change the follow
 * tells; read and followed again on the beat once the follow ends.
 */
const tabsAtom = Atom.family((taskId: string) =>
  rendererRuntime.atom(
    Stream.concat(Stream.fromEffect(readTabs(taskId)), followedTabs(taskId)).pipe(
      Stream.repeat(Schedule.spaced(CLOUD_BROWSER_TABS_AGAIN)),
      Stream.filter((tabs): tabs is readonly AgentBrowserTab[] => tabs !== undefined),
    ),
  ),
);

/** Reads nothing, for a panel that lists no cloud Browser tab. */
const unreadAtom = Atom.make<AsyncResult.AsyncResult<readonly AgentBrowserTab[]>>(
  AsyncResult.initial(),
);

/** The tabs this window opened, by task, that no read has listed yet; a new map at each change. */
let opened: ReadonlyMap<string, readonly AgentBrowserTab[]> = new Map();

/** The tabs opened here whose view has yet to take them over, by the id the service keeps each under. */
const takingOver = new Set<string>();

const openedListeners = new Set<() => void>();

function setOpened(next: ReadonlyMap<string, readonly AgentBrowserTab[]>): void {
  opened = next;
  for (const listener of openedListeners) listener();
}

function hearOpened(listener: () => void): () => void {
  openedListeners.add(listener);
  return () => openedListeners.delete(listener);
}

/** Notes a tab the member opened in an agent's browser on the task, listed until a read lists it, and taken over once its view opens. */
export function noteOpenedCloudTab(taskId: string, tab: AgentBrowserTab): void {
  const standing = (opened.get(taskId) ?? NO_TABS).filter((each) => each.id !== tab.id);
  takingOver.add(tab.id);
  setOpened(new Map(opened).set(taskId, [...standing, tab]));
}

/** Whether the tab's view is to take it over now, as one this window opened is once; asking answers it once. */
export function claimTakeOver(tabId: string): boolean {
  return takingOver.delete(tabId);
}

/** The listed tabs, then those opened here that no read has listed yet. */
function withOpened(
  listed: readonly AgentBrowserTab[],
  mine: readonly AgentBrowserTab[],
): readonly AgentBrowserTab[] {
  const pending = mine.filter((tab) => !listed.some((each) => each.id === tab.id));
  return pending.length === 0 ? listed : [...listed, ...pending];
}

/**
 * The open task's cloud Browser tabs, the oldest first; none while unread,
 * and none at all where `listing` is off: the Browser tab experiment off, or
 * no task open. A tab opened here stands from its open, and is let go of
 * once a read lists it, so one its agent closes afterwards goes.
 */
export function useCloudBrowserTabs(
  taskId: string | undefined,
  listing: boolean,
): readonly AgentBrowserTab[] | undefined {
  const read = useAtomValue(listing && taskId !== undefined ? tabsAtom(taskId) : unreadAtom);
  const openedHere = () => (taskId === undefined ? NO_TABS : (opened.get(taskId) ?? NO_TABS));
  const mine = useSyncExternalStore(hearOpened, openedHere, openedHere);
  const listed = AsyncResult.isSuccess(read) ? read.value : undefined;
  useEffect(() => {
    if (taskId === undefined || listed === undefined || mine.length === 0) return;
    const left = mine.filter((tab) => !listed.some((each) => each.id === tab.id));
    if (left.length < mine.length) setOpened(new Map(opened).set(taskId, left));
  }, [taskId, listed, mine]);
  if (!listing) return NO_TABS;
  if (listed === undefined) return mine.length === 0 ? undefined : mine;
  return withOpened(listed, mine);
}
