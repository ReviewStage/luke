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
 * A surface that forgets an inbox once it lets go of it, and one drawn
 * outside a window's root, holds a set of its own instead, which lets each
 * follow go with its last reader (`use-followed-inboxes.ts`).
 */

import type {
  CodingAgentInboxChanged,
  CodingAgentInboxScope,
} from "@luke/features/coding-agent-view";
import type { InboxItem } from "@luke/features/inbox-wire";
import { Duration, Effect } from "effect";
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { rendererFork } from "../renderer-runtime.js";

type ScopeKind = CodingAgentInboxScope["kind"];

/** A followed inbox as the window hears it: its items whole, or why there are none. */
type Heard = CodingAgentInboxChanged["inbox"];

/** How an inbox is followed: hearing each change until the stop it answers is called. */
type Follow = (scope: CodingAgentInboxScope, hear: (inbox: Heard) => void) => () => void;

/** How long a follow no surface holds is kept, so a surface drawn again finds it standing. */
const LINGER = Duration.minutes(5);

/** The inboxes of one kind as last pushed, and which could not be read. */
interface HeldKind {
  /** Each inbox's items as last pushed, by plan or agent; one never pushed is absent. */
  readonly items: ReadonlyMap<string, readonly InboxItem[]>;
  /** The inboxes whose last word was that they could not be read, followed no more until Try again. */
  readonly failed: ReadonlySet<string>;
}

/** The inboxes a window or a surface holds, and their follows. */
export interface HeldInboxes {
  readonly subscribe: (listener: () => void) => () => void;
  /** The inboxes of `kind` as they stand, the same value until one of them changes. */
  readonly heldOf: (kind: ScopeKind) => HeldKind;
  /** Holds an inbox's follow for one more surface, following it for the first; the release lets it go. */
  readonly hold: (kind: ScopeKind, id: string, follow: Follow) => () => void;
  /** Clears every inbox of `kind` that could not be read, so its surfaces follow it again. */
  readonly retry: (kind: ScopeKind) => void;
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

/** The wait before a follow no surface holds is let go, as a fiber on the renderer's services; the stop cancels it. */
function lingerOnRenderer(letGo: () => void): () => void {
  return rendererFork(Effect.andThen(Effect.sleep(LINGER), Effect.sync(letGo)));
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
  const letGo = (kind: ScopeKind, id: string) => {
    const byId = following.get(kind);
    const standing = byId?.get(id);
    if (byId === undefined || standing === undefined || standing.holders > 0) return;
    standing.stop?.();
    byId.delete(id);
    if (!forget) return;
    const was = heldOf(kind);
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
    if (linger === undefined) letGo(kind, id);
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
      const standing = byId.get(id) ?? { holders: 0, stop: undefined, lingering: undefined };
      byId.set(id, standing);
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
    retry: (kind) => {
      const was = heldOf(kind);
      if (was.failed.size > 0) store(kind, { ...was, failed: new Set() });
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
  return <HeldInboxesContext.Provider value={held}>{children}</HeldInboxesContext.Provider>;
}
