/**
 * version-history-route.lazy.tsx -- a task's version history as its routes draw it once their chunk lands, split off the bundle every window parses, since a history is opened seldom.
 *
 * Every page of the history, its list, a version, its sections, and one of
 * them, is drawn by the one layout route (`panel-router.tsx`), so moving
 * between them draws no new history. Until the task it is of has opened
 * under it, its frame stands, as it does while the chunk loads.
 */

import { createLazyRoute } from "@tanstack/react-router";
import {
  useShellPlaces,
  VersionHistoryFrame,
  VersionHistoryRouteLoading,
} from "./desktop-shell.js";
import { TaskVersionHistory } from "./desktop-version-history.js";

/** The open description's version history over the whole window, once its task stands under it. */
function VersionHistoryPlace(): React.JSX.Element {
  const { tasks, sidebar, room, history, settings } = useShellPlaces();
  if (!tasks.history.open) return <VersionHistoryRouteLoading />;
  return (
    <VersionHistoryFrame>
      {(exit) => (
        <TaskVersionHistory
          sidebar={sidebar}
          room={room}
          history={history}
          tasks={tasks}
          account={settings.account}
          onExit={exit}
          onRestored={history.onLeaveVersionHistory}
        />
      )}
    </VersionHistoryFrame>
  );
}

export const versionHistoryLazyRoute = createLazyRoute("/version-history")({
  component: VersionHistoryPlace,
});
