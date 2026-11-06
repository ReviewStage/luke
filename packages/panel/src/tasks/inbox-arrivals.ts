import type { InboxItem } from "@repo/features/inbox-wire";
import { inboxArrivalWords } from "@repo/features/words";
import { ANNOUNCE, announce } from "@repo/ui";
import { useEffect, useRef } from "react";

const saidRevisions = new Map<string, number>();

function saidBefore(item: InboxItem): boolean {
  return (saidRevisions.get(item.id) ?? 0) >= item.revision;
}

interface ArrivalsHeld {
  readonly taskId: string | undefined;
  readonly items: readonly InboxItem[];
  readonly read: boolean;
}

export function useInboxArrivals(held: ArrivalsHeld, onScreen: boolean): void {
  const known = useRef<{ taskId: string | undefined; ids: ReadonlySet<string> } | undefined>(
    undefined,
  );
  useEffect(() => {
    if (!held.read) return;
    const ids = new Set(held.items.map((item) => item.id));
    const was = known.current;
    known.current = { taskId: held.taskId, ids };
    if (was === undefined || was.taskId !== held.taskId || !onScreen) return;
    const landed = held.items.filter(
      (item) => !was.ids.has(item.id) && item.unread === true && !saidBefore(item),
    );
    if (landed.length === 0) return;
    for (const item of landed) saidRevisions.set(item.id, item.revision);
    announce(ANNOUNCE.POLITE, inboxArrivalWords(landed.map((item) => item.title)));
  }, [held, onScreen]);
}
