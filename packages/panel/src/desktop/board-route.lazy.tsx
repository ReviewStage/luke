/**
 * board-route.lazy.tsx -- a workspace's Board as its route draws it once its chunk lands, split off the bundle every window parses and read ahead as the pointer comes to its row.
 *
 * What the page holds across a visit is kept outside it, its view,
 * filters, display, folds, and scroll on this Mac (`tasks-page.tsx`) and
 * what the reader was in the middle of by the shell, per workspace
 * (`tasks-page-held.ts`), so the page drawn anew as the window comes back
 * finds it as it stood.
 */

import { createLazyRoute } from "@tanstack/react-router";
import { useShellPlaces } from "./desktop-shell.js";
import { mobileBarShown } from "./mobile-bar.js";
import { TasksPage } from "./tasks-page.js";

/** The Tasks page in the task's place beside the sidebar; nothing on a phone, whose Tasks page is the sidebar's tree pinned in the work's place (`mobile-bar.tsx`). */
function BoardRoutePlace(): React.JSX.Element | null {
  const { tasks, room, tasksPagesHeld } = useShellPlaces();
  if (mobileBarShown(room, tasks)) return null;
  const workspaceId = tasks.workspace?.id;
  const held = workspaceId === undefined ? undefined : tasksPagesHeld.of(workspaceId);
  return <TasksPage tasks={tasks} room={room} held={held} />;
}

export const boardLazyRoute = createLazyRoute("/places/$workspace/tasks")({
  component: BoardRoutePlace,
});
