import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentInboxChanged,
  type CodingAgentInboxScope,
} from "@luke/features/coding-agent-view";
import type { InboxItem } from "@luke/features/inbox-wire";
import { ACT_KIND } from "@luke/host/acts";
import { useCallback, useEffect, useRef, useState } from "react";
import { askAct } from "../act.js";

/**
 * use-followed-inboxes.ts -- the inboxes of the plans, or of the agents with no plan, a surface draws, followed while it draws them and pushed to the window as each changes.
 *
 * The window holds one stream open on its act port per plan or agent it
 * draws (`codingAgents.inboxFollow`), and closes it as it stops; the host
 * follows each inbox while any stream of it stands and sends every change
 * down each, so nothing here asks again, holds a cursor, or keeps a loop.
 * Each inbox's items are held as they were last pushed, and kept once it is
 * let go, since nothing newer is on its way, unless the surface asks to
 * forget them: one followed again then starts from nothing until it is
 * pushed anew, rather than from a push older than its follow. One whose last word was that
 * it could not be read is let go, and followed again on Try again; its
 * items as last pushed stand meanwhile.
 */

type ScopeKind = CodingAgentInboxScope["kind"];

/** A followed inbox as the window hears it: its items whole, or why there are none. */
type Heard = CodingAgentInboxChanged["inbox"];

/** How the window follows an inbox: hearing each change until the stop it answers is called. */
export interface InboxFollower {
  readonly follow: (scope: CodingAgentInboxScope, hear: (inbox: Heard) => void) => () => void;
}

const UNANSWERED: Heard = { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED };

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
      stream = await askAct(ACT_KIND.CODING_AGENTS_INBOX_FOLLOW, scope);
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

/** The inbox pushed, folded into what is held: its items, or its failure. */
function heard(
  held: { items: ReadonlyMap<string, readonly InboxItem[]>; failed: ReadonlySet<string> },
  id: string,
  inbox: Heard,
) {
  if ("failure" in inbox) return { items: held.items, failed: new Set(held.failed).add(id) };
  const failed = new Set(held.failed);
  failed.delete(id);
  return { items: new Map(held.items).set(id, inbox.items), failed };
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
  const [held, setHeld] = useState<{
    items: ReadonlyMap<string, readonly InboxItem[]>;
    failed: ReadonlySet<string>;
  }>({ items: new Map(), failed: new Set() });
  // The stop of each inbox followed now, by its id.
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
      const stop = latest.current.follow({ kind, id }, (inbox) =>
        setHeld((was) => heard(was, id, inbox)),
      );
      following.current.set(id, stop);
    }
    const letGo: string[] = [];
    for (const [id, stop] of following.current) {
      if (now.has(id)) continue;
      following.current.delete(id);
      stop();
      letGo.push(id);
    }
    if (!forget || letGo.length === 0) return;
    setHeld((was) => {
      if (!letGo.some((id) => was.items.has(id))) return was;
      const items = new Map(was.items);
      for (const id of letGo) items.delete(id);
      return { ...was, items };
    });
  }, [kind, wanted, forget]);
  // Every inbox still followed is let go as the surface goes.
  useEffect(
    () => () => {
      for (const stop of following.current.values()) stop();
      following.current.clear();
    },
    [kind],
  );

  const onRetry = useCallback(() => setHeld((was) => ({ ...was, failed: new Set() })), []);
  return { items: held.items, failed: held.failed, onRetry };
}
