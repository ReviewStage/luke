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
 * lands on it before Realtime has told it. Both are the account's signed in
 * as they were made (`window-account.ts`), so another account signing in
 * finds none of them, and the first finds its own again.
 */

import {
  type AgentBrowserTab,
  type BrowserTabsPlace,
  browserTabsPlaceId,
} from "@repo/features/agent-browser-tab-wire";
import { useQuery } from "@tanstack/react-query";
import { Store, useSelector } from "@tanstack/react-store";
import { Duration } from "effect";
import { useEffect } from "react";
import { browserTabsQuery } from "../live-reads.js";
import { useWindowAccount } from "./window-account.js";

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

/** One account's tabs this window opened that the held list has not listed yet, and its drafts, each by the holder's id; a new map at each change. */
interface AccountTabs {
  readonly opened: ReadonlyMap<string, readonly AgentBrowserTab[]>;
  readonly drafts: ReadonlyMap<string, readonly CloudBrowserDraft[]>;
}

/** An account that opened nothing here. */
const NOTHING_HERE: AccountTabs = { opened: new Map(), drafts: new Map() };

/** Every account's tabs and drafts, by the account signed in as they were made, none for no account; a new map at each change. */
const held = new Store<ReadonlyMap<string | undefined, AccountTabs>>(new Map());

/** One account's tabs and drafts. */
function ownedOf(
  all: ReadonlyMap<string | undefined, AccountTabs>,
  account: string | undefined,
): AccountTabs {
  return all.get(account) ?? NOTHING_HERE;
}

/** Changes one account's tabs and drafts. */
function changeOwned(
  account: string | undefined,
  change: (owned: AccountTabs) => AccountTabs,
): void {
  held.setState((all) => new Map(all).set(account, change(ownedOf(all, account))));
}

/** Notes a tab the member opened in an agent's browser from the holder's panel under the account, listed until the held list lists it. */
export function noteOpenedCloudTab(
  account: string | undefined,
  place: BrowserTabsPlace,
  tab: AgentBrowserTab,
): void {
  const key = browserTabsPlaceId(place);
  changeOwned(account, (owned) => {
    const standing = (owned.opened.get(key) ?? NO_TABS).filter((each) => each.id !== tab.id);
    return { ...owned, opened: new Map(owned.opened).set(key, [...standing, tab]) };
  });
}

/** A draft of a tab in the coding agent's browser on the holder's panel under the account, held after any it holds already. */
export function startCloudDraft(
  account: string | undefined,
  place: BrowserTabsPlace,
  agentId: string,
): CloudBrowserDraft {
  const key = browserTabsPlaceId(place);
  const draft = { id: crypto.randomUUID(), agentId };
  changeOwned(account, (owned) => ({
    ...owned,
    drafts: new Map(owned.drafts).set(key, [...(owned.drafts.get(key) ?? NO_DRAFTS), draft]),
  }));
  return draft;
}

/** Lets go of one of the account's drafts: discarded, or opened as a tab of its own. */
export function discardCloudDraft(
  account: string | undefined,
  place: BrowserTabsPlace,
  draftId: string,
): void {
  const key = browserTabsPlaceId(place);
  const drafts = ownedOf(held.state, account).drafts.get(key) ?? NO_DRAFTS;
  if (!drafts.some((each) => each.id === draftId)) return;
  changeOwned(account, (owned) => ({
    ...owned,
    drafts: new Map(owned.drafts).set(
      key,
      drafts.filter((each) => each.id !== draftId),
    ),
  }));
}

/** The holder's drafts in the order asked for; none where `listing` is off, as for the listed tabs. */
export function useCloudBrowserDrafts(
  place: BrowserTabsPlace | undefined,
  listing: boolean,
): readonly CloudBrowserDraft[] {
  const account = useWindowAccount();
  const key = place === undefined ? undefined : browserTabsPlaceId(place);
  const read = useSelector(held, (all) =>
    key === undefined ? NO_DRAFTS : (ownedOf(all, account).drafts.get(key) ?? NO_DRAFTS),
  );
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
 * this panel while it lists them (`browserTabsQuery`). A tab opened here stands
 * from its open, and is let go of once the held list lists it, so one its
 * agent closes afterwards goes.
 */
export function useCloudBrowserTabs(
  place: BrowserTabsPlace | undefined,
  listing: boolean,
): readonly AgentBrowserTab[] | undefined {
  const listed = useQuery(browserTabsQuery(listing ? place : undefined)).data;
  const account = useWindowAccount();
  const key = place === undefined ? undefined : browserTabsPlaceId(place);
  const mine = useSelector(held, (all) =>
    key === undefined ? NO_TABS : (ownedOf(all, account).opened.get(key) ?? NO_TABS),
  );
  useEffect(() => {
    if (key === undefined || listed === undefined || mine.length === 0) return;
    const left = mine.filter((tab) => !listed.some((each) => each.id === tab.id));
    if (left.length < mine.length) {
      changeOwned(account, (owned) => ({ ...owned, opened: new Map(owned.opened).set(key, left) }));
    }
  }, [account, key, listed, mine]);
  if (!listing) return NO_TABS;
  if (listed === undefined) return mine.length === 0 ? undefined : mine;
  return withOpened(listed, mine);
}
