/**
 * inbox-arrivals.ts -- says what lands in the Inbox on screen, politely, once: one item by its title, several that landed together by their count.
 *
 * Main tells the window nothing of an item that opens while it is focused
 * (`@luke/host/agent-notices`), since a sighted reader sees it land in the
 * list, and elsewhere the Inbox's count says it. So a screen reader hears
 * the Inbox on screen from here: the items a push
 * of it holds that the one before did not, said together. The first push
 * of a task's Inbox is where it stands, and none of it is news, nor is an
 * item that lands read, as a thread the reader opened with New thread is
 * read for them; and what lands while the Inbox is not on screen is let
 * by unsaid, the Inbox's count having said it. Every Inbox the window reads one
 * task through hears the same push, so an item is said once at each
 * revision whichever of them said it first.
 */

import type { InboxItem } from "@luke/features/inbox-wire";
import { inboxArrivalWords } from "@luke/features/words";
import { ANNOUNCE, announce } from "@luke/ui";
import { useEffect, useRef } from "react";

/**
 * The newest revision of each item any Inbox of the window said, so a
 * second reader of the same task says it no more, while an item its agent
 * posted again under the same key, at a newer revision, is said again.
 */
const saidRevisions = new Map<string, number>();

/** Whether some Inbox of the window said `item` at its revision already. */
function saidBefore(item: InboxItem): boolean {
  return (saidRevisions.get(item.id) ?? 0) >= item.revision;
}

/** One task's Inbox as its hook last read it: the task, and its items once a read has answered. */
interface ArrivalsHeld {
  readonly taskId: string | undefined;
  readonly items: readonly InboxItem[];
  readonly read: boolean;
}

/** Says what lands in `held`'s Inbox while `onScreen`; see the module's head. */
export function useInboxArrivals(held: ArrivalsHeld, onScreen: boolean): void {
  const known = useRef<{ taskId: string | undefined; ids: ReadonlySet<string> } | undefined>(
    undefined,
  );
  useEffect(() => {
    if (!held.read) return;
    const ids = new Set(held.items.map((item) => item.id));
    const was = known.current;
    known.current = { taskId: held.taskId, ids };
    // Note that a task's first read is where its Inbox stands, so nothing in it is news.
    if (was === undefined || was.taskId !== held.taskId || !onScreen) return;
    const landed = held.items.filter(
      (item) => !was.ids.has(item.id) && item.unread === true && !saidBefore(item),
    );
    if (landed.length === 0) return;
    for (const item of landed) saidRevisions.set(item.id, item.revision);
    announce(ANNOUNCE.POLITE, inboxArrivalWords(landed.map((item) => item.title)));
  }, [held, onScreen]);
}
