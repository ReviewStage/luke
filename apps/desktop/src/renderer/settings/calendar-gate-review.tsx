import { CalendarIntegrations } from "./connections-page";
import type { SettingsPanelProps } from "./settings-panel";
import { settingsRowsInput, useConnectionInput } from "./use-connection-input";
import { SETTINGS_WRITES } from "./writes";

/**
 * The calendar block the onboarding gate borrows: the same rows the Connections
 * page draws, from the same table, so the calendars read exactly as they do
 * everywhere else — without the quiet switch, because the setting defaults on
 * and a switch offered before the first calendar is even confirmed reads as one
 * more demand rather than a choice.
 */
export function CalendarGateReview({
  settings,
}: {
  settings: SettingsPanelProps;
}): React.JSX.Element | null {
  const snapshot = settings.settings;
  const connections = useConnectionInput({
    ...(snapshot
      ? {
          settings: snapshot,
          view: settingsRowsInput({ ...settings, settings: snapshot }),
        }
      : undefined),
    account: settings.account,
    credentials: settings.credentials,
    calendar: settings.calendar,
    appleCalendar: settings.appleCalendar,
    linear: settings.linear,
    superset: settings.superset,
    workspaceProviders: settings.workspaceProviders,
    panelOpen: settings.panelOpen,
  });
  if (!connections) return null;
  return <CalendarIntegrations input={connections} writes={SETTINGS_WRITES} />;
}
