/**
 * cloud-browser-tabs.ts -- the Browser tabs open in coding agents' cloud browsers, as the side panel lists them: one agent's on its page, or a task's agents' on the task's, held by the host while the panel lists them.
 *
 * The service keeps every tab of every agent's browser
 * (`@repo/features/agent-browser-tab-wire`), so the panel lists them on any
 * client and after a relaunch. What the panel lists them for is its holder
 * (`BrowserTabsPlace`): the agent an agent's page shows, on a task or on
 * none, or the task a task's panel stands beside, every one of its agents'
 * tabs together. The host holds the tabs in app state while a panel lists
 * them (`LIVE_READ.BROWSER_TABS`), followed over Neon Realtime and told
 * again as a takeover lapses, so the agent's pointer on a tab is drawn
 * within a moment of its move; and it keeps them among the eight let go
 * latest, so a panel listing them again draws them at once. Every panel on
 * one holder shares the host's one follow. A tab's address and title reach
 * this member's windows alone, and never a trace, a counted event, or a
 * fixture.
 *
 * A tab the member asks for from the side panel's "+" stands first as a
 * draft in this window alone (`startCloudDraft`), bound to the coding agent
 * whose browser it is to open in, and opens nothing until its bar opens an
 * address (`cloud-browser-pane.tsx`). The tab the service then answers is
 * listed from that moment until the held list first lists it, so the panel
 * lands on it before Realtime has told it.
 */

import {
  type AgentBrowserTab,
  type BrowserTabsPlace,
  browserTabsPlaceId,
} from "@repo/features/agent-browser-tab-wire";
import { LIVE_READ } from "@repo/features/live-wire";
import { Duration } from "effect";
import { useEffect, useSyncExternalStore } from "react";
import { useHostRead } from "../use-host-read.js";

/** How long after its agent last acted on a tab the tab says the agent is using it. */
export const CLOUD_BROWSER_AGENT_RECENT = Duration.seconds(15);

/** A holder with no cloud Browser tab, the same array every render. */
const NO_TABS: readonly AgentBrowserTab[] = [];

/**
 * A cloud Browser tab the member asked for from the "+" that opens nothing
 * yet: the id the strip draws it under, and the coding agent whose browser
 * it is to open in, which it never leaves.
 */
export interface CloudBrowserDraft {
  readonly id: string;
  readonly agentId: string;
}

/** A holder with no draft, the same array every render. */
const NO_DRAFTS: readonly CloudBrowserDraft[] = [];

/** The tabs this window opened, by the holder's id, that the held list has not listed yet; a new map at each change. */
let opened: ReadonlyMap<string, readonly AgentBrowserTab[]> = new Map();

/** The drafts this window holds, by the holder's id, in the order asked for; a new map at each change. */
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

/** Notes a tab the member opened in an agent's browser from the holder's panel, listed until the held list lists it. */
export function noteOpenedCloudTab(place: BrowserTabsPlace, tab: AgentBrowserTab): void {
  const key = browserTabsPlaceId(place);
  const standing = (opened.get(key) ?? NO_TABS).filter((each) => each.id !== tab.id);
  setOpened(new Map(opened).set(key, [...standing, tab]));
}

/** A draft of a tab in the coding agent's browser on the holder's panel, held after any it holds already. */
export function startCloudDraft(place: BrowserTabsPlace, agentId: string): CloudBrowserDraft {
  const key = browserTabsPlaceId(place);
  const draft = { id: crypto.randomUUID(), agentId };
  drafts = new Map(drafts).set(key, [...(drafts.get(key) ?? NO_DRAFTS), draft]);
  told();
  return draft;
}

/** Lets go of a draft: discarded, or opened as a tab of its own. */
export function discardCloudDraft(place: BrowserTabsPlace, draftId: string): void {
  const key = browserTabsPlaceId(place);
  const held = drafts.get(key) ?? NO_DRAFTS;
  if (!held.some((each) => each.id === draftId)) return;
  drafts = new Map(drafts).set(
    key,
    held.filter((each) => each.id !== draftId),
  );
  told();
}

/** The holder's drafts in the order asked for; none where `listing` is off, as for the listed tabs. */
export function useCloudBrowserDrafts(
  place: BrowserTabsPlace | undefined,
  listing: boolean,
): readonly CloudBrowserDraft[] {
  const key = place === undefined ? undefined : browserTabsPlaceId(place);
  const held = () => (key === undefined ? NO_DRAFTS : (drafts.get(key) ?? NO_DRAFTS));
  const read = useSyncExternalStore(hear, held, held);
  return listing ? read : NO_DRAFTS;
}

/** The listed tabs, then those opened here that the held list has not listed yet. */
function withOpened(
  listed: readonly AgentBrowserTab[],
  mine: readonly AgentBrowserTab[],
): readonly AgentBrowserTab[] {
  const pending = mine.filter((tab) => !listed.some((each) => each.id === tab.id));
  return pending.length === 0 ? listed : [...listed, ...pending];
}

/**
 * The holder's cloud Browser tabs, the oldest first: the agent's its page
 * shows, or the open task's agents'; none while unread, and none at all
 * where `listing` is off: no holder, or a panel that draws none. Held by
 * this panel while it lists them (`useHostRead`). A tab opened here stands
 * from its open, and is let go of once the held list lists it, so one its
 * agent closes afterwards goes.
 */
export function useCloudBrowserTabs(
  place: BrowserTabsPlace | undefined,
  listing: boolean,
): readonly AgentBrowserTab[] | undefined {
  const listed = useHostRead(LIVE_READ.BROWSER_TABS, listing ? place : undefined).rows;
  const key = place === undefined ? undefined : browserTabsPlaceId(place);
  const openedHere = () => (key === undefined ? NO_TABS : (opened.get(key) ?? NO_TABS));
  const mine = useSyncExternalStore(hear, openedHere, openedHere);
  useEffect(() => {
    if (key === undefined || listed === undefined || mine.length === 0) return;
    const left = mine.filter((tab) => !listed.some((each) => each.id === tab.id));
    if (left.length < mine.length) setOpened(new Map(opened).set(key, left));
  }, [key, listed, mine]);
  if (!listing) return NO_TABS;
  if (listed === undefined) return mine.length === 0 ? undefined : mine;
  return withOpened(listed, mine);
}
