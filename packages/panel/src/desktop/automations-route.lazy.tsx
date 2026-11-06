import { createLazyRoute } from "@tanstack/react-router";
import { FIND_PAGE, PageFind } from "../find-in-tab.js";
import { AUTOMATIONS_PAGE, type AutomationsPlace } from "../tasks/use-tasks-tab.js";
import { AutomationsPage } from "./automations-page.js";
import { useShellPlaces } from "./desktop-shell.js";

function automationsPlaceKey(place: AutomationsPlace): string {
  return place.kind === AUTOMATIONS_PAGE.EDIT ? place.automationId : place.kind;
}

function AutomationsRoutePlace(): React.JSX.Element {
  const { tasks, room } = useShellPlaces();
  return (
    <PageFind
      page={FIND_PAGE.AUTOMATIONS}
      at={automationsPlaceKey(tasks.automationsView.place)}
      active={tasks.shown}
    >
      <AutomationsPage tasks={tasks} room={room} />
    </PageFind>
  );
}

export const automationsLazyRoute = createLazyRoute("/places/$workspace/automation-pages")({
  component: AutomationsRoutePlace,
});
