import { createLazyRoute } from "@tanstack/react-router";
import { useShellPlaces } from "./desktop-shell.js";
import { mobileBarShown } from "./mobile-bar.js";
import { TasksPage } from "./tasks-page.js";

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
