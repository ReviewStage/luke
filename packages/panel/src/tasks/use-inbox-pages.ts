import type { PageLine } from "@luke/features/page-wire";
import type { TasksPagesAnswer } from "@luke/features/tasks-view";
import { ACT_KIND } from "@luke/host/acts";
import { useEffect, useState } from "react";
import { useAct } from "../act.js";

/**
 * use-inbox-pages.ts -- the pages of the task whose item the window's Inbox shows, for the panel beside it, as they move.
 *
 * Main holds the active task's pages alone (`TasksView`'s `pages`), and the
 * Inbox shows items of any task, so the panel beside an item reads its
 * task's own once as the task is chosen (`ACT_KIND.TASKS_PAGES`) and follows
 * them while it stays chosen (`ACT_KIND.TASKS_PAGES_FOLLOW`): the host
 * streams them each time they move over Neon Realtime, so a page an agent
 * shows lands as it is shown, and nothing is read again here. A read or a
 * change that did not answer keeps the pages last read; one of a task no
 * longer chosen is let go.
 */

/** The pages of the Inbox's chosen task: none until read. */
export interface InboxPages {
  readonly pages: readonly PageLine[] | undefined;
}

/** Reads and follows the pages of the task given, none where no task is. */
export function useInboxPages(taskId: string | undefined): InboxPages {
  const { act } = useAct();
  const [read, setRead] = useState<{ taskId: string; pages: readonly PageLine[] } | undefined>(
    undefined,
  );
  useEffect(() => {
    if (taskId === undefined) return;
    let live = true;
    let followed = false;
    let stream: AsyncIteratorObject<TasksPagesAnswer> | undefined;
    act(ACT_KIND.TASKS_PAGES, { taskId }).then(
      (answer) => {
        // Note that a change heard first is as new, so the read stands only until one is.
        if (live && !followed && "pages" in answer) setRead({ taskId, pages: answer.pages });
      },
      () => undefined,
    );
    act(ACT_KIND.TASKS_PAGES_FOLLOW, { taskId })
      .then(async (opened) => {
        stream = opened;
        if (!live) {
          await opened.return?.(undefined);
          return;
        }
        for await (const answer of opened) {
          if (!live || !("pages" in answer)) continue;
          followed = true;
          setRead({ taskId, pages: answer.pages });
        }
      })
      .catch(() => undefined);
    return () => {
      live = false;
      void stream?.return?.(undefined);
    };
  }, [act, taskId]);
  return { pages: read?.taskId === taskId ? read?.pages : undefined };
}
