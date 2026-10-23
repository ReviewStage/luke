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
 * A tab the member asks for from the side panel's "+" stands first as a
 * draft in this window alone (`startCloudDraft`), bound to the coding agent
 * whose browser it is to open in, and opens nothing until its bar opens an
 * address (`cloud-browser-pane.tsx`). The tab the service then answers is
 * listed from that moment until the read or the follow first lists it, so
 * the panel lands on it before Realtime has told it.
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

/** Whose browser a cloud Browser tab lives in: its agent's name, or Luke's, and the glyph its strip tab and its card wear. */
export interface CloudBrowserOwner {
  readonly name: string;
  readonly icon: React.JSX.Element;
}

/** What a browser is called by whose it is: "Invite expiry's browser", and "Invite emails' browser" for a name that ends in an s. */
export function browserOf(name: string): string {
  return name.endsWith("s") ? `${name}' browser` : `${name}'s browser`;
}

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

/**
 * A cloud Browser tab the member asked for from the "+" that opens nothing
 * yet: the id the strip draws it under, and the coding agent whose browser
 * it is to open in, which it never leaves.
 */
export interface CloudBrowserDraft {
  readonly id: string;
  readonly agentId: string;
}

/** A task with no draft, the same array every render. */
const NO_DRAFTS: readonly CloudBrowserDraft[] = [];

/** The tabs this window opened, by task, that no read has listed yet; a new map at each change. */
let opened: ReadonlyMap<string, readonly AgentBrowserTab[]> = new Map();

/** The drafts this window holds, by task, in the order asked for; a new map at each change. */
let drafts: ReadonlyMap<string, readonly CloudBrowserDraft[]> = new Map();

const listeners = new Set<() => void>();

function told(): void {
  for (const listener of listeners) listener();
}

function hear(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setOpened(next: ReadonlyMap<string, readonly AgentBrowserTab[]>): void {
  opened = next;
  told();
}

/** Notes a tab the member opened in an agent's browser on the task, listed until a read lists it. */
export function noteOpenedCloudTab(taskId: string, tab: AgentBrowserTab): void {
  const standing = (opened.get(taskId) ?? NO_TABS).filter((each) => each.id !== tab.id);
  setOpened(new Map(opened).set(taskId, [...standing, tab]));
}

/** A draft of a tab in the coding agent's browser on the task, held after any the task holds already. */
export function startCloudDraft(taskId: string, agentId: string): CloudBrowserDraft {
  const draft = { id: crypto.randomUUID(), agentId };
  drafts = new Map(drafts).set(taskId, [...(drafts.get(taskId) ?? NO_DRAFTS), draft]);
  told();
  return draft;
}

/** Lets go of a draft: discarded, or opened as a tab of its own. */
export function discardCloudDraft(taskId: string, draftId: string): void {
  const held = drafts.get(taskId) ?? NO_DRAFTS;
  if (!held.some((each) => each.id === draftId)) return;
  drafts = new Map(drafts).set(
    taskId,
    held.filter((each) => each.id !== draftId),
  );
  told();
}

/** The task's drafts in the order asked for; none where `listing` is off, as for the listed tabs. */
export function useCloudBrowserDrafts(
  taskId: string | undefined,
  listing: boolean,
): readonly CloudBrowserDraft[] {
  const held = () => (taskId === undefined ? NO_DRAFTS : (drafts.get(taskId) ?? NO_DRAFTS));
  const read = useSyncExternalStore(hear, held, held);
  return listing ? read : NO_DRAFTS;
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
  const mine = useSyncExternalStore(hear, openedHere, openedHere);
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
