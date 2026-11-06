import {
  type AgentBrowserTab,
  type BrowserTabsPlace,
  browserTabsPlaceId,
} from "@repo/features/agent-browser-tab-wire";
import { useQuery } from "@tanstack/react-query";
import { Duration } from "effect";
import { useEffect, useSyncExternalStore } from "react";
import { browserTabsQuery } from "../live-reads.js";

export const CLOUD_BROWSER_AGENT_RECENT = Duration.seconds(15);

const NO_TABS: readonly AgentBrowserTab[] = [];

export interface CloudBrowserDraft {
  readonly id: string;
  readonly agentId: string;
}

const NO_DRAFTS: readonly CloudBrowserDraft[] = [];

let opened: ReadonlyMap<string, readonly AgentBrowserTab[]> = new Map();

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

export function noteOpenedCloudTab(place: BrowserTabsPlace, tab: AgentBrowserTab): void {
  const key = browserTabsPlaceId(place);
  const standing = (opened.get(key) ?? NO_TABS).filter((each) => each.id !== tab.id);
  setOpened(new Map(opened).set(key, [...standing, tab]));
}

export function startCloudDraft(place: BrowserTabsPlace, agentId: string): CloudBrowserDraft {
  const key = browserTabsPlaceId(place);
  const draft = { id: crypto.randomUUID(), agentId };
  drafts = new Map(drafts).set(key, [...(drafts.get(key) ?? NO_DRAFTS), draft]);
  told();
  return draft;
}

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

export function useCloudBrowserDrafts(
  place: BrowserTabsPlace | undefined,
  listing: boolean,
): readonly CloudBrowserDraft[] {
  const key = place === undefined ? undefined : browserTabsPlaceId(place);
  const held = () => (key === undefined ? NO_DRAFTS : (drafts.get(key) ?? NO_DRAFTS));
  const read = useSyncExternalStore(hear, held, held);
  return listing ? read : NO_DRAFTS;
}

function withOpened(
  listed: readonly AgentBrowserTab[],
  mine: readonly AgentBrowserTab[],
): readonly AgentBrowserTab[] {
  const pending = mine.filter((tab) => !listed.some((each) => each.id === tab.id));
  return pending.length === 0 ? listed : [...listed, ...pending];
}

export function useCloudBrowserTabs(
  place: BrowserTabsPlace | undefined,
  listing: boolean,
): readonly AgentBrowserTab[] | undefined {
  const listed = useQuery(browserTabsQuery(listing ? place : undefined)).data;
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
