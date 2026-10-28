/**
 * held-inboxes.tsx -- the inboxes the window holds for the session: each plan's or agent's items as last pushed, kept once every surface drawing them has gone, and each follow kept a while after its last reader, so a surface drawn again draws what was held at once and its follow refreshes it in place.
 *
 * The window's root holds one for the account signed in
 * (`HeldInboxesProvider`), so the Inbox left and opened again, the person
 * page, and an item's chip draw the same items, and none waits on a read the
 * window already made. Each inbox is followed while any surface holds it and
 * for `LINGER` after the last lets go, so a surface drawn again within it
 * finds its follow standing and its items current; one drawn after it draws
 * the items as last pushed until its follow pushes anew. Another account, or
 * none, holds a new set, and lets go of every follow of the last.
 *
 * The root also follows every item the account reaches, pushed by scope
 * over one stream (`codingAgents.accountItemsFollow`), while it is signed
 * in. A scope the feed holds is drawn from it, an inbox's own follow
 * standing over it where one stands, since the feed leaves out settled
 * items past its bound; once the feed is not answering, every inbox is
 * drawn from its own follow again.
 *
 * A surface that forgets an inbox once it lets go of it, and one drawn
 * outside a window's root, holds a set of its own instead, which lets each
 * follow go with its last reader (`use-followed-inboxes.ts`).
 */

import type {
  AgentAccountItems,
  AgentInboxChanged,
  AgentInboxScope,
} from "@luke/features/agent-view";
import type { InboxItem } from "@luke/features/inbox-wire";
import { ACT_KIND } from "@luke/host/acts";
import { Duration, Effect } from "effect";
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
import { rendererFork } from "../renderer-runtime.js";

type ScopeKind = AgentInboxScope["kind"];

/** A followed inbox as the window hears it: its items whole, or why there are none. */
type Heard = AgentInboxChanged["inbox"];

/** How an inbox is followed: hearing each change until the stop it answers is called. */
type Follow = (scope: AgentInboxScope, hear: (inbox: Heard) => void) => () => void;

/** How long a follow no surface holds is kept, so a surface drawn again finds it standing. */
const LINGER = Duration.minutes(5);

/** The inboxes of one kind as last pushed, and which could not be read. */
interface HeldKind {
  /** Each inbox's items as last pushed, by plan or agent; one never pushed is absent. */
  readonly items: ReadonlyMap<string, readonly InboxItem[]>;
  /** The inboxes whose last word was that they could not be read, followed no more until Try again. */
  readonly failed: ReadonlySet<string>;
}

/** Each scope's items as the account's feed last pushed them, by plan or agent. */
type FedKind = ReadonlyMap<string, readonly InboxItem[]>;

/** The inboxes a window or a surface holds, and their follows. */
export interface HeldInboxes {
  readonly subscribe: (listener: () => void) => () => void;
  /** The inboxes of `kind` as they stand, an inbox's own follow over the account's feed, the same value until one of them changes. */
  readonly heldOf: (kind: ScopeKind) => HeldKind;
  /** The scopes of `kind` the account's feed holds, none while it is not answering. */
  readonly fedOf: (kind: ScopeKind) => FedKind | undefined;
  /** Folds what the account's feed pushed into what is held. */
  readonly feed: (pushed: AgentAccountItems) => void;
  /** Holds an inbox's follow for one more surface, following it for the first; the release lets it go. */
  readonly hold: (kind: ScopeKind, id: string, follow: Follow) => () => void;
  /** Clears the inboxes of `kind` named, or every one, that could not be read, so their surfaces follow them again. */
  readonly retry: (kind: ScopeKind, ids?: readonly string[]) => void;
  /** Lets go of every follow at once, keeping the items as last pushed. */
  readonly letGoAll: () => void;
}

/** One inbox's follow: how many surfaces hold it, its stop while it stands, and the stop of the wait before it is let go. */
interface Following {
  holders: number;
  stop: (() => void) | undefined;
  lingering: (() => void) | undefined;
}

const NOTHING_HELD: HeldKind = { items: new Map(), failed: new Set() };
const NOTHING_FED: FedKind = new Map();

/** The wait before a follow no surface holds is let go, as a fiber on the renderer's services; the stop cancels it. */
function lingerOnRenderer(letGo: () => void): () => void {
  return rendererFork(Effect.andThen(Effect.sleep(LINGER), Effect.sync(letGo)));
}

/** A subscription to nothing, for a surface outside a window's root. */
function subscribeNothing(): () => void {
  return () => undefined;
}

/**
 * A set of held inboxes: `linger` arms the wait before a follow no surface
 * holds is let go, none letting it go at once; `forget` lets its items go
 * with it, so one followed again holds nothing until its follow pushes.
 */
export function heldInboxes(options: {
  readonly linger: ((letGo: () => void) => () => void) | undefined;
  readonly forget: boolean;
}): HeldInboxes {
  const { linger, forget } = options;
  const followed = new Map<ScopeKind, HeldKind>();
  // The account's feed by kind, none while it is not answering, and each kind's view over both.
  let fed: Map<ScopeKind, FedKind> | undefined;
  const merged = new Map<ScopeKind, HeldKind>();
  const following = new Map<ScopeKind, Map<string, Following>>();
  const listeners = new Set<() => void>();
  const followedOf = (kind: ScopeKind) => followed.get(kind) ?? NOTHING_HELD;
  const fedOf = (kind: ScopeKind) =>
    fed === undefined ? undefined : (fed.get(kind) ?? NOTHING_FED);
  const heldOf = (kind: ScopeKind) => {
    const standing = merged.get(kind);
    if (standing !== undefined) return standing;
    const own = followedOf(kind);
    const fromFeed = fedOf(kind);
    const standingFollows = following.get(kind);
    // Note that an inbox's own follow stands over the feed while it stands, since it reads settled items the feed's
    // bound leaves out, and its items kept once it is let go stand only where the feed holds nothing of that inbox.
    const ownOver = [...own.items].filter(
      ([id]) => standingFollows?.has(id) === true || fromFeed?.has(id) !== true,
    );
    const view =
      fromFeed === undefined || fromFeed.size === 0
        ? own
        : { items: new Map([...fromFeed, ...ownOver]), failed: own.failed };
    merged.set(kind, view);
    return view;
  };
  const told = () => {
    for (const listener of [...listeners]) listener();
  };
  const store = (kind: ScopeKind, next: HeldKind) => {
    followed.set(kind, next);
    merged.delete(kind);
    told();
  };
  const heard = (kind: ScopeKind, id: string, inbox: Heard) => {
    const was = followedOf(kind);
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
  const letGo = (kind: ScopeKind, id: string) => {
    const byId = following.get(kind);
    const standing = byId?.get(id);
    if (byId === undefined || standing === undefined || standing.holders > 0) return;
    standing.stop?.();
    byId.delete(id);
    // Note that the view is drawn anew, since an inbox let go may give way to the feed.
    merged.delete(kind);
    told();
    // Note that an inbox the feed holds gives its own follow's items up with it, so the feed's newer word is drawn,
    // while one the feed holds nothing of, its items all settled past the feed's bound, keeps them.
    if (!forget && fedOf(kind)?.has(id) !== true) return;
    const was = followedOf(kind);
    if (!was.items.has(id)) return;
    const items = new Map(was.items);
    items.delete(id);
    store(kind, { ...was, items });
  };
  const release = (kind: ScopeKind, id: string) => {
    const standing = following.get(kind)?.get(id);
    if (standing === undefined) return;
    standing.holders -= 1;
    if (standing.holders > 0) return;
    // Note that an inbox the feed holds is let go at once, since the feed keeps it current with no follow of its own.
    if (linger === undefined || fedOf(kind)?.has(id) === true) letGo(kind, id);
    else standing.lingering = linger(() => letGo(kind, id));
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
      const was = byId.get(id);
      const standing = was ?? { holders: 0, stop: undefined, lingering: undefined };
      byId.set(id, standing);
      // Note that a follow just begun stands over the feed, so the view is drawn anew.
      if (was === undefined) {
        merged.delete(kind);
        told();
      }
      standing.lingering?.();
      standing.lingering = undefined;
      standing.holders += 1;
      standing.stop ??= follow({ kind, id }, (inbox) => heard(kind, id, inbox));
      let released = false;
      return () => {
        if (released) return;
        released = true;
        release(kind, id);
      };
    },
    fedOf,
    feed: (pushed) => {
      if ("failure" in pushed) {
        fed = undefined;
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
      }
      merged.clear();
      told();
    },
    retry: (kind, ids) => {
      const was = followedOf(kind);
      const failed =
        ids === undefined
          ? new Set<string>()
          : new Set([...was.failed].filter((id) => !ids.includes(id)));
      if (failed.size !== was.failed.size) store(kind, { ...was, failed });
    },
    letGoAll: () => {
      for (const byId of following.values()) {
        for (const standing of byId.values()) {
          standing.stop?.();
          standing.lingering?.();
        }
      }
      following.clear();
    },
  };
}

const HeldInboxesContext = createContext<HeldInboxes | undefined>(undefined);

/** The window's held inboxes, none outside a window's root. */
export function useWindowHeldInboxes(): HeldInboxes | undefined {
  return useContext(HeldInboxesContext);
}

/** The scopes of `kind` the account's feed holds, none outside a window's root or while it is not answering. */
export function useFedInboxes(kind: ScopeKind): FedKind | undefined {
  const held = useWindowHeldInboxes();
  const fedNow = () => held?.fedOf(kind);
  return useSyncExternalStore(held?.subscribe ?? subscribeNothing, fedNow, fedNow);
}

/** Holds the window's inboxes for the account signed in, a new set for another account or none. */
export function HeldInboxesProvider({
  account,
  children,
}: {
  /** The account signed in, by its id or its address; none while nobody is. */
  readonly account: string | undefined;
  readonly children?: ReactNode;
}): React.JSX.Element {
  const [standing, setStanding] = useState(() => ({
    account,
    held: heldInboxes({ linger: lingerOnRenderer, forget: false }),
  }));
  // Note that the inboxes are the account's, so another account, or none, holds none of the last one's.
  if (standing.account !== account) {
    setStanding({ account, held: heldInboxes({ linger: lingerOnRenderer, forget: false }) });
  }
  const { held } = standing;
  useEffect(() => () => held.letGoAll(), [held]);
  // The account's every item, followed while it is signed in, a new stream for each account.
  useEffect(() => {
    if (account === undefined) return undefined;
    return streamFrom(
      () => askAct(ACT_KIND.CODING_AGENTS_ACCOUNT_ITEMS_FOLLOW),
      (pushed) => held.feed(pushed),
    );
  }, [held, account]);
  return <HeldInboxesContext.Provider value={held}>{children}</HeldInboxesContext.Provider>;
}
