import { RegistryContext } from "@effect/atom-react/RegistryContext";
import * as Atom from "effect/reactivity/Atom";
import { useCallback, useContext, useEffect } from "react";

/**
 * sidebar-walk.ts -- the tasks the sidebar draws, in the order it draws them, for what moves along the list from outside it.
 *
 * The sidebar alone knows which rows it draws: its folds, its view's grouping,
 * order, and filters, its sections, and whether it shows the archived tasks
 * are its own state. It publishes the walk's task ids here as it draws, so
 * archiving the open task (`use-tasks-tab.ts`) can open the task drawn after
 * it rather than leave the list. An agent's row is no task, so the walk skips
 * it. A sidebar not drawn publishes nothing, and a reader then finds no
 * neighbour and does what it did before the walk.
 */

/** No tasks drawn: before the sidebar draws, after it goes, or while it lists no tasks. */
export const NO_SIDEBAR_WALK: readonly string[] = [];

/** The ids of the tasks the window's sidebar draws, top to bottom. One for the window, as its sidebar is. */
const sidebarWalkAtom = Atom.keepAlive(Atom.make<readonly string[]>(NO_SIDEBAR_WALK));

/** Whether two walks name the same tasks in the same order. */
function sameWalk(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((taskId, index) => taskId === b[index]);
}

/**
 * The task to open in the place of `taskId` as it leaves the list: the first
 * task drawn after it that `gone` does not take away too, else the nearest
 * drawn before it; none where the walk does not hold it or nothing is left.
 */
export function walkSuccessor(
  walk: readonly string[],
  taskId: string,
  gone: (taskId: string) => boolean,
): string | undefined {
  const at = walk.indexOf(taskId);
  if (at < 0) return undefined;
  const after = walk.slice(at + 1).find((each) => !gone(each));
  return after ?? walk.slice(0, at).findLast((each) => !gone(each));
}

/**
 * Publishes the sidebar's walk while it is drawn, and lets it go when the
 * sidebar goes. Note that it writes only a walk that changed, because the
 * sidebar draws far more often than its rows move.
 */
export function usePublishSidebarWalk(walk: readonly string[]): void {
  const registry = useContext(RegistryContext);
  useEffect(() => {
    if (!sameWalk(registry.get(sidebarWalkAtom), walk)) registry.set(sidebarWalkAtom, walk);
  });
  useEffect(() => () => registry.set(sidebarWalkAtom, NO_SIDEBAR_WALK), [registry]);
}

/** Reads the walk as it stands at the moment of a press, without drawing again as it changes. */
export function useSidebarWalkNow(): () => readonly string[] {
  const registry = useContext(RegistryContext);
  return useCallback(() => registry.get(sidebarWalkAtom), [registry]);
}
