import type {
  CodingAgentInboxChanged,
  CodingAgentInboxScope,
} from "@luke/features/coding-agent-view";
import type { InboxItem } from "@luke/features/inbox-wire";
import { ACT_KIND } from "@luke/host/acts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type ActHandle, useAct } from "../act";

/**
 * use-followed-inboxes.ts -- the inboxes of the plans, or of the agents with no plan, a surface draws, followed while it draws them and pushed to the window as each changes.
 *
 * The window says which inboxes it draws, one follow per plan or agent,
 * and lets each go as it stops; main follows each at the host and sends
 * every change to the windows following it on `app:inbox` (`main/ipc/inbox-follow-acts.ts`),
 * so nothing here asks again, holds a cursor, or keeps a loop. Each
 * inbox's items are held as they were last pushed, and kept once it is
 * let go, since nothing newer is on its way. One whose last word was that
 * it could not be read is let go, and followed again on Try again; its
 * items as last pushed stand meanwhile.
 */

type ScopeKind = CodingAgentInboxScope["kind"];

/** How the window follows an inbox, lets it go, and hears it pushed. */
export interface InboxFollower {
  readonly follow: (scope: CodingAgentInboxScope) => void;
  readonly unfollow: (scope: CodingAgentInboxScope) => void;
  /** Hears every inbox pushed to the window; the returned call stops hearing. */
  readonly onInbox: (listener: (changed: CodingAgentInboxChanged) => void) => () => void;
}

/** The window's own follower: the follow acts out, and `app:inbox` in. */
export function windowInboxFollower(acts: Pick<ActHandle, "act">): InboxFollower {
  return {
    follow: (scope) =>
      void acts.act(ACT_KIND.CODING_AGENTS_INBOX_FOLLOW, scope).catch(() => undefined),
    unfollow: (scope) =>
      void acts.act(ACT_KIND.CODING_AGENTS_INBOX_UNFOLLOW, scope).catch(() => undefined),
    onInbox: (listener) => window.luke.onInbox(listener),
  };
}

/** The window's own follower, as a surface outside a plan's agents reaches it. */
export function useWindowInboxFollower(): InboxFollower {
  const { act } = useAct();
  return useMemo(() => windowInboxFollower({ act }), [act]);
}

/** The inboxes as last pushed, and which could not be read. */
interface FollowedInboxes {
  /** Each inbox's items as last pushed, by plan or agent; one never pushed is absent. */
  readonly items: ReadonlyMap<string, readonly InboxItem[]>;
  /** The inboxes whose last word was that they could not be read, followed no more until Try again. */
  readonly failed: ReadonlySet<string>;
  /** Follows again every inbox that could not be read. */
  readonly onRetry: () => void;
}

/** The inbox pushed, folded into what is held: its items, or its failure. */
function heard(
  held: { items: ReadonlyMap<string, readonly InboxItem[]>; failed: ReadonlySet<string> },
  { scope, inbox }: CodingAgentInboxChanged,
) {
  if ("failure" in inbox) return { items: held.items, failed: new Set(held.failed).add(scope.id) };
  const failed = new Set(held.failed);
  failed.delete(scope.id);
  return { items: new Map(held.items).set(scope.id, inbox.items), failed };
}

/** Whether two sorted lists name the same inboxes. */
function sameIds(one: readonly string[], other: readonly string[]): boolean {
  return one.length === other.length && one.every((id, at) => id === other[at]);
}

export function useFollowedInboxes(
  kind: ScopeKind,
  ids: readonly string[],
  follower: InboxFollower,
): FollowedInboxes {
  // Note that the follower is read through a ref, so a surface handing a fresh one each render follows nothing anew.
  const latest = useRef(follower);
  latest.current = follower;
  const [held, setHeld] = useState<{
    items: ReadonlyMap<string, readonly InboxItem[]>;
    failed: ReadonlySet<string>;
  }>({ items: new Map(), failed: new Set() });
  // The inboxes followed now, so an inbox pushed for another surface of the window is not kept here.
  const following = useRef(new Set<string>());

  // Note that the wanted ids are kept as they were while they name the same inboxes, so a list
  // drawn again, or in another order, follows nothing anew.
  const wantedNow = [...new Set(ids)].filter((id) => !held.failed.has(id)).toSorted();
  const wantedRef = useRef<readonly string[]>([]);
  if (!sameIds(wantedRef.current, wantedNow)) wantedRef.current = wantedNow;
  const wanted = wantedRef.current;
  // Note that the window is listened to only while something is followed, so a surface drawing no inbox asks nothing of it.
  const listening = wanted.length > 0;
  useEffect(() => {
    if (!listening) return;
    return latest.current.onInbox((changed) => {
      if (changed.scope.kind !== kind || !following.current.has(changed.scope.id)) return;
      setHeld((was) => heard(was, changed));
    });
  }, [kind, listening]);
  useEffect(() => {
    const now = new Set(wanted);
    for (const id of now) {
      if (following.current.has(id)) continue;
      following.current.add(id);
      latest.current.follow({ kind, id });
    }
    for (const id of following.current) {
      if (now.has(id)) continue;
      following.current.delete(id);
      latest.current.unfollow({ kind, id });
    }
  }, [kind, wanted]);
  // Every inbox still followed is let go as the surface goes.
  useEffect(
    () => () => {
      for (const id of following.current) latest.current.unfollow({ kind, id });
      following.current.clear();
    },
    [kind],
  );

  const onRetry = useCallback(() => setHeld((was) => ({ ...was, failed: new Set() })), []);
  return { items: held.items, failed: held.failed, onRetry };
}
