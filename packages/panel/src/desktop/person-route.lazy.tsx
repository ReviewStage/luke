import { createLazyRoute } from "@tanstack/react-router";
import { FIND_PAGE, PageFind } from "../find-in-tab.js";
import { SHELL_ROOM } from "../shell-room.js";
import { useShellPlaces } from "./desktop-shell.js";
import { PersonPage } from "./person-page.js";

function PersonRoutePlace(): React.JSX.Element | null {
  const { tasks, room, sidebar, away } = useShellPlaces();
  const { userId, name } = tasks.personView;
  if (userId === undefined) return null;
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
