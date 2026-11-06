/**
 * automations-route.lazy.tsx -- the Automations pages as their route draws them once its chunk lands, split off the bundle every window parses, since the pages, their editor and its triggers among them, are opened seldom.
 */

import { createLazyRoute } from "@tanstack/react-router";
import { FIND_PAGE, PageFind } from "../find-in-tab.js";
import { AUTOMATIONS_PAGE, type AutomationsPlace } from "../tasks/use-tasks-tab.js";
import { AutomationsPage } from "./automations-page.js";
import { useShellPlaces } from "./desktop-shell.js";

/** Where on the Automations pages a find stands: its list, its runs, a new automation, or one automation's editor, each a place of its own. */
function automationsPlaceKey(place: AutomationsPlace): string {
  return place.kind === AUTOMATIONS_PAGE.EDIT ? place.automationId : place.kind;
}

/** The Automations pages in the task's place beside the sidebar. */
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
