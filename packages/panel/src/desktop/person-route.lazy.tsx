/**
 * person-route.lazy.tsx -- a person's page as its route draws it once its chunk lands, split off the bundle every window parses and read ahead as the pointer comes to a person's name.
 */

import { createLazyRoute } from "@tanstack/react-router";
import { FIND_PAGE, PageFind } from "../find-in-tab.js";
import { SHELL_ROOM } from "../shell-room.js";
import { useShellPlaces } from "./desktop-shell.js";
import { PersonPage } from "./person-page.js";

/** The person's page in the task's place beside the sidebar. */
function PersonRoutePlace(): React.JSX.Element | null {
  const { tasks, room, sidebar, away } = useShellPlaces();
  const { userId, name } = tasks.personView;
  if (userId === undefined) return null;
  // Keyed by the person, so another person's page holds nothing of the last, its find among it.
  return (
    <PageFind key={userId} page={FIND_PAGE.PERSON} at={userId} active={tasks.shown}>
      <PersonPage
        tasks={tasks}
        userId={userId}
        name={name}
        staged={sidebar.staged}
        away={room === SHELL_ROOM.NARROW ? away : undefined}
      />
    </PageFind>
  );
}

export const personLazyRoute = createLazyRoute("/places/$workspace/person/$userId")({
  component: PersonRoutePlace,
});
