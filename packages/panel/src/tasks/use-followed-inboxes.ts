import {
  AGENT_CALL_FAILURE,
  type AgentInboxChanged,
  type AgentInboxScope,
} from "@luke/features/agent-view";
import type { InboxItem } from "@luke/features/inbox-wire";
import { ACT_KIND } from "@luke/host/acts";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { askAct } from "../act.js";

/**
 * use-followed-inboxes.ts -- the inboxes of the plans, or of the agents with no plan, a surface draws, followed while it draws them and pushed to the window as each changes.
 *
 * The window holds one stream open on its act port per plan or agent it
 * draws (`agents.inboxFollow`), and closes it as it stops; the host
 * follows each inbox while any stream of it stands and sends every change
 * down each, so nothing here asks again, holds a cursor, or keeps a loop.
 * Each inbox's items are held by the surface (`heldInboxes`) as they
 * were last pushed, and kept once it is let go, since nothing newer is on
 * its way, unless the surface asks to forget them: one followed again then
 * starts from nothing until it is pushed anew, rather than from a push older
 * than its follow. One whose last word was that it could not be read is let
 * go, and followed again on Try again; its items as last pushed stand
 * meanwhile. The window's Inbox follows none of its own: it draws the
 * account's feed of every item (`use-holder-inbox-items.ts`).
 */

type ScopeKind = AgentInboxScope["kind"];

/** A followed inbox as the window hears it: its items whole, or why there are none. */
type Heard = AgentInboxChanged["inbox"];

/** How the window follows an inbox: hearing each change until the stop it answers is called. */
export interface InboxFollower {
  readonly follow: (scope: AgentInboxScope, hear: (inbox: Heard) => void) => () => void;
}

/** The inboxes of one kind as last pushed, and which could not be read. */
interface HeldKind {
  /** Each inbox's items as last pushed, by plan or agent; one never pushed is absent. */
  readonly items: ReadonlyMap<string, readonly InboxItem[]>;
  /** The inboxes whose last word was that they could not be read, followed no more until Try again. */
  readonly failed: ReadonlySet<string>;
}

/** The inboxes a surface follows on its own. */
interface HeldInboxes {
  readonly subscribe: (listener: () => void) => () => void;
  /** The inboxes of `kind` as they stand, the same value until one of them changes. */
  readonly heldOf: (kind: ScopeKind) => HeldKind;
  /** Holds an inbox's follow for one more reader, following it for the first; the release lets it go. */
  readonly hold: (kind: ScopeKind, id: string, follow: InboxFollower["follow"]) => () => void;
  /** Clears every inbox of `kind` that could not be read, so it is followed again. */
  readonly retry: (kind: ScopeKind) => void;
}

/** One inbox's follow: how many readers hold it, and its stop while it stands. */
interface Following {
  holders: number;
  stop: (() => void) | undefined;
}

const NOTHING_HELD: HeldKind = { items: new Map(), failed: new Set() };

/**
 * The inboxes one surface follows: each followed while any of its readers
 * holds it, and let go with the last; `forget` lets its items go with it,
 * so one followed again holds nothing until its follow pushes.
 */
function heldInboxes(options: { readonly forget: boolean }): HeldInboxes {
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

const UNANSWERED: Heard = { failure: AGENT_CALL_FAILURE.UNANSWERED };

/**
 * The window's own follower: one stream on its act port per follow, closed
 * by the stop it answers. A stream that could not open, or broke, is heard
 * as unanswered, unless it was stopped first. Note that it opens through the
 * act door, so a fixture run's Inbox profile pushes its staged items
 * (`inbox-fixture.ts`) where main would push nothing.
 */
export const windowInboxFollower: InboxFollower = {
  follow: (scope, hear) => {
    let stopped = false;
    let stream: AsyncIteratorObject<Heard, unknown, unknown> | undefined;
    void (async () => {
      stream = await askAct(ACT_KIND.AGENTS_INBOX_FOLLOW, scope);
      if (stopped) {
        await stream.return?.(undefined);
        return;
      }
      for await (const inbox of stream) hear(inbox);
    })().catch((_error: unknown) => {
      if (!stopped) hear(UNANSWERED);
    });
    return () => {
      stopped = true;
      void stream?.return?.(undefined);
    };
  },
};

/** The inboxes as last pushed, and which could not be read. */
interface FollowedInboxes {
  /** Each inbox's items as last pushed, by plan or agent; one never pushed is absent. */
  readonly items: ReadonlyMap<string, readonly InboxItem[]>;
  /** The inboxes whose last word was that they could not be read, followed no more until Try again. */
  readonly failed: ReadonlySet<string>;
  /** Follows again every inbox that could not be read. */
  readonly onRetry: () => void;
}

/** Whether two sorted lists name the same inboxes. */
function sameIds(one: readonly string[], other: readonly string[]): boolean {
  return one.length === other.length && one.every((id, at) => id === other[at]);
}

export function useFollowedInboxes(
  kind: ScopeKind,
  ids: readonly string[],
  follower: InboxFollower,
  /** Whether an inbox's items are let go with it, so one followed again holds nothing until its follow pushes. */
  options: { readonly forget?: boolean } = {},
): FollowedInboxes {
  const forget = options.forget === true;
  // Note that the follower is read through a ref, so a surface handing a fresh one each render follows nothing anew.
  const latest = useRef(follower);
  latest.current = follower;
  const [store] = useState(() => heldInboxes({ forget }));
  const heldNow = () => store.heldOf(kind);
  const held = useSyncExternalStore(store.subscribe, heldNow, heldNow);
  // The release of each inbox this surface holds now, by its id.
  const following = useRef(new Map<string, () => void>());

  // Note that the wanted ids are kept as they were while they name the same inboxes, so a list
  // drawn again, or in another order, follows nothing anew.
  const wantedNow = [...new Set(ids)].filter((id) => !held.failed.has(id)).toSorted();
  const wantedRef = useRef<readonly string[]>([]);
  if (!sameIds(wantedRef.current, wantedNow)) wantedRef.current = wantedNow;
  const wanted = wantedRef.current;
  useEffect(() => {
    const now = new Set(wanted);
    for (const id of now) {
      if (following.current.has(id)) continue;
      const release = store.hold(kind, id, (scope, hear) => latest.current.follow(scope, hear));
      following.current.set(id, release);
    }
    for (const [id, release] of following.current) {
      if (now.has(id)) continue;
      following.current.delete(id);
      release();
    }
  }, [store, kind, wanted]);
  // Every inbox this surface holds is let go as the surface goes.
  useEffect(
    () => () => {
      for (const release of following.current.values()) release();
      following.current.clear();
    },
    [store, kind],
  );

  const onRetry = useCallback(() => store.retry(kind), [store, kind]);
  return { items: held.items, failed: held.failed, onRetry };
}
