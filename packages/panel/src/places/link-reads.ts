/**
 * link-reads.ts -- whether a link's read of the service, still on its way, is still the window's to act on.
 *
 * A link that names its place by something only the service resolves (an
 * Inbox item by its id alone, a task by its number, an agent with no task
 * named) opens once that read answers. Any move the developer makes before
 * then supersedes it, whatever door made the move: any move of the window's
 * router history to another page, pushed, replaced in the step's place, or
 * Back and Forward. Only the history's own write of the step standing
 * (`navigation-history.ts`), which carries the step it saves and moves no
 * one, supersedes nothing, nor does a move within the same page.
 */

import type { RouterHistory } from "@tanstack/react-router";
import { useRouter } from "@tanstack/react-router";
import { useCallback } from "react";
import { savesStep } from "../navigation-history.js";

/** The developer's moves to another page counted beside each window's router history. */
const movesBeside = new WeakMap<RouterHistory, { count: number }>();

/** The moves counted beside `history`, counted from the moment they are first read. */
function movesOf(history: RouterHistory): { count: number } {
  const kept = movesBeside.get(history);
  if (kept !== undefined) return kept;
  const made = { count: 0 };
  let path = history.location.pathname;
  history.subscribe(({ location, action }) => {
    const before = path;
    path = location.pathname;
    if (location.pathname === before) return;
    if (action.type === "REPLACE" && savesStep(location)) return;
    made.count += 1;
  });
  movesBeside.set(history, made);
  return made;
}

/** Begins a link's read: answers whether the window has made no move to another page since. */
export type LinkRead = () => () => boolean;

/** The window router's link reads (see the module's head). */
export function useLinkReads(): LinkRead {
  const { history } = useRouter();
  return useCallback(() => {
    const moves = movesOf(history);
    const begun = moves.count;
    return () => moves.count === begun;
  }, [history]);
}
