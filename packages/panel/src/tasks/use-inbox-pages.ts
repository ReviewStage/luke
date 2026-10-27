import { type PageLine, type PagePlace, pagePlaceId } from "@luke/features/page-wire";
import { ACT_KIND } from "@luke/host/acts";
import { useEffect, useState } from "react";
import { useAct } from "../act.js";
import { streamFrom } from "../act-stream.js";

/**
 * use-inbox-pages.ts -- the pages of the task whose item the window's Inbox shows, or of the agent on no task whose page stands, for the panel beside it, as they move.
 *
 * Main holds the active task's pages alone (`TasksView`'s `pages`), and the
 * Inbox shows items of any task, so the panel beside an item reads its
 * task's own once as the task is chosen (`ACT_KIND.TASKS_PAGES`) and follows
 * them while it stays chosen (`ACT_KIND.TASKS_PAGES_FOLLOW`): the host
 * streams them each time they move over Neon Realtime, so a page an agent
 * shows lands as it is shown. A read that did not answer keeps the pages
 * last read, and a follow that broke is opened again (`act-stream.ts`),
 * which lands what moved meanwhile; one of a task no longer chosen is let
 * go. An agent on no task holds pages of its own,
 * which its page's panel reads and follows on the same terms.
 */

/** The pages of the Inbox's chosen task, or of the agent whose page stands: none until read. */
export interface InboxPages {
  readonly pages: readonly PageLine[] | undefined;
}

/** Reads and follows the pages of the task or the agent on no task given, none where neither is. */
export function useInboxPages(place: PagePlace | undefined): InboxPages {
  const { act } = useAct();
  const [read, setRead] = useState<{ id: string; pages: readonly PageLine[] } | undefined>(
    undefined,
  );
  // Note that the place is followed by its id and kind, so a new object naming the same one follows nothing again.
  const id = place === undefined ? undefined : pagePlaceId(place);
  const onAgent = place !== undefined && "agentId" in place;
  useEffect(() => {
    if (id === undefined) return;
    const asked: PagePlace = onAgent ? { agentId: id } : { taskId: id };
    let live = true;
    let followed = false;
    act(ACT_KIND.TASKS_PAGES, asked).then(
      (answer) => {
        // Note that a change heard first is as new, so the read stands only until one is.
        if (live && !followed && "pages" in answer) setRead({ id, pages: answer.pages });
      },
      () => undefined,
    );
    const stop = streamFrom(
      () => act(ACT_KIND.TASKS_PAGES_FOLLOW, asked),
      (answer) => {
        if (!live || !("pages" in answer)) return;
        followed = true;
        setRead({ id, pages: answer.pages });
      },
    );
    return () => {
      live = false;
      stop();
    };
  }, [act, id, onAgent]);
  return { pages: read?.id === id ? read?.pages : undefined };
}
