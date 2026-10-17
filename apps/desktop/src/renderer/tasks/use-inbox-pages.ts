import type { PageLine } from "@luke/features/page-wire";
import { ACT_KIND } from "@luke/host/acts";
import { useCallback, useEffect, useState } from "react";
import { useAct } from "../act";

/**
 * use-inbox-pages.ts -- the pages of the task whose item the window's Inbox shows, for the panel beside it.
 *
 * Main holds the active task's pages alone (`TasksView`'s `pages`), and the
 * Inbox shows items of any task, so the panel beside an item reads its
 * task's own (`ACT_KIND.TASKS_PAGES`): once as the task is chosen, and again
 * when asked, as a link names a page the last read did not hold, one an
 * agent showed since. A read that did not answer, or one another task's
 * choice overtook, is let go, the pages last read standing.
 */

/** The pages of the Inbox's chosen task: none until read, and a way to read them again. */
export interface InboxPages {
  readonly pages: readonly PageLine[] | undefined;
  readonly onReread: () => void;
}

/** Reads the pages of the task given, none where no task is. */
export function useInboxPages(taskId: string | undefined): InboxPages {
  const { act } = useAct();
  const [read, setRead] = useState<{ taskId: string; pages: readonly PageLine[] } | undefined>(
    undefined,
  );
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (taskId === undefined) return;
    let live = true;
    // Note that the attempt is read so Reread asks again of the same task.
    void attempt;
    act(ACT_KIND.TASKS_PAGES, { taskId }).then(
      (answer) => {
        if (live && "pages" in answer) setRead({ taskId, pages: answer.pages });
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [act, taskId, attempt]);
  const onReread = useCallback(() => setAttempt((was) => was + 1), []);
  return { pages: read?.taskId === taskId ? read?.pages : undefined, onReread };
}
