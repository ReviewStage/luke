import { createLazyRoute } from "@tanstack/react-router";
import { DesktopSettings } from "./desktop-settings.js";
import { SettingsFrame, useShellPlaces } from "./desktop-shell.js";

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
