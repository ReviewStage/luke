/**
 * settings-route.lazy.tsx -- Settings as its routes draw it once their chunk lands, split off the bundle every window parses because Settings is opened seldom.
 *
 * Both Settings routes, under a workspace and under `/app`, draw it
 * (`panel-router.tsx`); what stands while the chunk loads is their own
 * frame (`SettingsRouteLoading`).
 */

import { createLazyRoute } from "@tanstack/react-router";
import { DesktopSettings } from "./desktop-settings.js";
import { SettingsFrame, useShellPlaces } from "./desktop-shell.js";

/** Settings, its pages listed where the tasks were. */
function SettingsPlace(): React.JSX.Element {
  const { sidebar, room, settingsStep, history, settings } = useShellPlaces();
  return (
    <SettingsFrame>
      {(exit) => (
        <DesktopSettings
          sidebar={sidebar}
          room={room}
          step={settingsStep}
          history={history}
          settings={settings}
          onExit={exit}
        />
      )}
    </SettingsFrame>
  );
}

export const settingsLazyRoute = createLazyRoute("/$workspace/settings")({
  component: SettingsPlace,
});

export const appSettingsLazyRoute = createLazyRoute("/app/settings")({
  component: SettingsPlace,
});
