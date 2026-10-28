/**
 * held-inboxes.tsx -- the inboxes a surface follows on its own, and the account's feed of every item the window's root holds for the session, which the Inbox draws from alone.
 *
 * The window's root follows every item the account reaches, pushed by
 * scope over one stream (`codingAgents.accountItemsFollow`), while an
 * account is signed in (`HeldInboxesProvider`), and holds what it pushed
 * for the session, so the Inbox left and opened again, and the person
 * page, draw at once from what the window already holds. Another account,
 * or none, holds a new feed. A feed whose last word is that it is not
 * answering keeps what it held; one that never answered says so.
 *
 * A surface that follows an inbox of its own, the task's own inbox or an
 * item's chip, holds a set of its own (`heldInboxes`), which lets each
 * follow go with its last reader (`use-followed-inboxes.ts`).
 */

import type {
  CodingAgentAccountItems,
  CodingAgentInboxChanged,
  CodingAgentInboxScope,
} from "@luke/features/coding-agent-view";
import type { InboxItem } from "@luke/features/inbox-wire";
import { ACT_KIND } from "@luke/host/acts";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { askAct } from "../act.js";
import { streamFrom } from "../act-stream.js";

type ScopeKind = CodingAgentInboxScope["kind"];

/** A followed inbox as the window hears it: its items whole, or why there are none. */
type Heard = CodingAgentInboxChanged["inbox"];

/** How an inbox is followed: hearing each change until the stop it answers is called. */
type Follow = (scope: CodingAgentInboxScope, hear: (inbox: Heard) => void) => () => void;

/** The inboxes of one kind as last pushed, and which could not be read. */
interface HeldKind {
  /** Each inbox's items as last pushed, by plan or agent; one never pushed is absent. */
  readonly items: ReadonlyMap<string, readonly InboxItem[]>;
  /** The inboxes whose last word was that they could not be read, followed no more until Try again. */
  readonly failed: ReadonlySet<string>;
}

/** The inboxes a surface follows on its own. */
export interface HeldInboxes {
  readonly subscribe: (listener: () => void) => () => void;
  /** The inboxes of `kind` as they stand, the same value until one of them changes. */
  readonly heldOf: (kind: ScopeKind) => HeldKind;
  /** Holds an inbox's follow for one more reader, following it for the first; the release lets it go. */
  readonly hold: (kind: ScopeKind, id: string, follow: Follow) => () => void;
  /** Clears every inbox of `kind` that could not be read, so it is followed again. */
  readonly retry: (kind: ScopeKind) => void;
}

/** Each scope's items as the account's feed last pushed them, by plan or agent. */
type FedKind = ReadonlyMap<string, readonly InboxItem[]>;

/** The account's feed as the window holds it. */
interface AccountFeed {
  readonly subscribe: (listener: () => void) => () => void;
  /** The scopes of `kind` the feed holds, none until it first answers. */
  readonly fedOf: (kind: ScopeKind) => FedKind | undefined;
  /** Whether the feed said it is not answering before it ever answered. */
  readonly failed: () => boolean;
  /** Folds what the feed pushed into what is held. */
  readonly feed: (pushed: CodingAgentAccountItems) => void;
}

/** One inbox's follow: how many readers hold it, and its stop while it stands. */
interface Following {
  holders: number;
  stop: (() => void) | undefined;
}

const NOTHING_HELD: HeldKind = { items: new Map(), failed: new Set() };
const NOTHING_FED: FedKind = new Map();

/** A subscription to nothing, for a surface outside a window's root. */
function subscribeNothing(): () => void {
  return () => undefined;
}

/** The account's feed, holding nothing until it first answers. */
function accountFeed(): AccountFeed {
  let fed: ReadonlyMap<ScopeKind, FedKind> | undefined;
  let failed = false;
  const listeners = new Set<() => void>();
  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    fedOf: (kind) => (fed === undefined ? undefined : (fed.get(kind) ?? NOTHING_FED)),
    failed: () => failed,
    feed: (pushed) => {
      // Note that a feed not answering keeps what it held, since its next answer brings the window up to date.
      if ("failure" in pushed) {
        if (fed !== undefined || failed) return;
        failed = true;
      } else {
        const next = new Map<ScopeKind, Map<string, readonly InboxItem[]>>(
          pushed.whole || fed === undefined
            ? []
            : [...fed].map(([kind, scopes]) => [kind, new Map(scopes)]),
        );
        for (const { scope, items } of pushed.scopes) {
          const scopes = next.get(scope.kind) ?? new Map<string, readonly InboxItem[]>();
          next.set(scope.kind, scopes);
          if (items.length === 0) scopes.delete(scope.id);
          else scopes.set(scope.id, items);
        }
        fed = next;
        failed = false;
      }
      for (const listener of [...listeners]) listener();
    },
  };
}

/**
 * The inboxes one surface follows: each followed while any of its readers
 * holds it, and let go with the last; `forget` lets its items go with it,
 * so one followed again holds nothing until its follow pushes.
 */
export function heldInboxes(options: { readonly forget: boolean }): HeldInboxes {
  const { forget } = options;
  const held = new Map<ScopeKind, HeldKind>();
  const following = new Map<ScopeKind, Map<string, Following>>();
  const listeners = new Set<() => void>();
  const heldOf = (kind: ScopeKind) => held.get(kind) ?? NOTHING_HELD;
  const store = (kind: ScopeKind, next: HeldKind) => {
    held.set(kind, next);
    for (const listener of [...listeners]) listener();
  };
  const heard = (kind: ScopeKind, id: string, inbox: Heard) => {
    const was = heldOf(kind);
    const failed = new Set(was.failed);
    if ("failure" in inbox) {
      // Note that a follow that could not be read is stopped, so a hold after Try again follows it anew.
      const standing = following.get(kind)?.get(id);
      standing?.stop?.();
      if (standing !== undefined) standing.stop = undefined;
      store(kind, { items: was.items, failed: failed.add(id) });
      return;
    }
    failed.delete(id);
    store(kind, { items: new Map(was.items).set(id, inbox.items), failed });
  };
  const release = (kind: ScopeKind, id: string) => {
    const byId = following.get(kind);
    const standing = byId?.get(id);
    if (byId === undefined || standing === undefined) return;
    standing.holders -= 1;
    if (standing.holders > 0) return;
    standing.stop?.();
    byId.delete(id);
    const was = heldOf(kind);
    if (!forget || !was.items.has(id)) return;
    const items = new Map(was.items);
    items.delete(id);
    store(kind, { ...was, items });
  };
  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    heldOf,
    hold: (kind, id, follow) => {
      const byId = following.get(kind) ?? new Map<string, Following>();
      following.set(kind, byId);
      const standing = byId.get(id) ?? { holders: 0, stop: undefined };
      byId.set(id, standing);
      standing.holders += 1;
      standing.stop ??= follow({ kind, id }, (inbox) => heard(kind, id, inbox));
      let released = false;
      return () => {
        if (released) return;
        released = true;
        release(kind, id);
      };
    },
    retry: (kind) => {
      const was = heldOf(kind);
      if (was.failed.size > 0) store(kind, { ...was, failed: new Set() });
    },
  };
}

const AccountFeedContext = createContext<AccountFeed | undefined>(undefined);

/** Whether the surface stands under a window's root, which holds the account's feed. */
export function useUnderWindowRoot(): boolean {
  return useContext(AccountFeedContext) !== undefined;
}

/** The scopes of `kind` the account's feed holds, none outside a window's root or until it first answers. */
export function useFedInboxes(kind: ScopeKind): FedKind | undefined {
  const feed = useContext(AccountFeedContext);
  const fedNow = () => feed?.fedOf(kind);
  return useSyncExternalStore(feed?.subscribe ?? subscribeNothing, fedNow, fedNow);
}

/** Whether the account's feed said it is not answering before it ever answered. */
export function useFeedFailed(): boolean {
  const feed = useContext(AccountFeedContext);
  const failedNow = () => feed?.failed() ?? false;
  return useSyncExternalStore(feed?.subscribe ?? subscribeNothing, failedNow, failedNow);
}

/** Holds the account's feed for the account signed in, a new one for another account or none. */
export function HeldInboxesProvider({
  account,
  children,
}: {
  /** The account signed in, by its id or its address; none while nobody is. */
  readonly account: string | undefined;
  readonly children?: ReactNode;
}): React.JSX.Element {
  const [standing, setStanding] = useState(() => ({ account, feed: accountFeed() }));
  // Note that the feed is the account's, so another account, or none, holds none of the last one's.
  if (standing.account !== account) setStanding({ account, feed: accountFeed() });
  const { feed } = standing;
  // The account's every item, followed while it is signed in, a new stream for each account.
  useEffect(() => {
    if (account === undefined) return undefined;
    return streamFrom(
      () => askAct(ACT_KIND.CODING_AGENTS_ACCOUNT_ITEMS_FOLLOW),
      (pushed) => feed.feed(pushed),
    );
  }, [feed, account]);
  return <AccountFeedContext.Provider value={feed}>{children}</AccountFeedContext.Provider>;
}
