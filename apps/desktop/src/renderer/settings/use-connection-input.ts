import type { AccountSnapshot } from "@sidecar/credentials/snapshot";
import { ACCOUNT_STATUS } from "@sidecar/credentials/snapshot";
import type { SettingsRowsInput } from "@sidecar/settings";
import type { AppSettingsView } from "@sidecar/settings/wire";
import { useState } from "react";
import type { CredentialEntryControl } from "../credential-entry";
import { microphoneAccessRow } from "../microphone-access";
import type { ConnectionInput } from "./connection-schema";
import type {
  AppleCalendarControl,
  CalendarControl,
  LinearControl,
  MicrophoneControl,
  SupersetControl,
  WorkspaceProviderOption,
} from "./controls";
import { SETTINGS_WRITES } from "./writes";

/**
 * Everything the connection rows are judged from and acted through, assembled
 * once wherever they are drawn — the Connections page, the Voice page, and the
 * calendar block the onboarding gate borrows. The one thing held here rather
 * than passed in is the calendar refresh: it is a pass asked for by hand, so
 * the glyph that asked has to be the thing that says it is turning.
 */
/**
 * What the pages currently offer, read afresh each render: every row's own
 * condition is judged from this one record, by the rows the pages draw and by
 * the search corpus alike, so a result never leads to a page without its row.
 */
export function settingsRowsInput(input: {
  settings: AppSettingsView;
  account: AccountSnapshot;
  microphone: MicrophoneControl;
  superset: SupersetControl;
  workspaceProviders: readonly WorkspaceProviderOption[];
}): SettingsRowsInput {
  return {
    settings: input.settings,
    voiceControlsDrawn: microphoneAccessRow({
      voiceAvailable: input.microphone.voiceAvailable,
      status: input.microphone.status,
    }).ready,
    accountDrawn: input.account.status === ACCOUNT_STATUS.SIGNED_IN,
    superset: {
      installed: input.superset.installed,
      connected: input.superset.connected,
      agents: input.superset.agents,
    },
    workspaceProviders: input.workspaceProviders.map((option) => ({
      id: option.id,
      name: option.name,
      offersProjects: option.projects.length > 0,
    })),
  };
}

export function useConnectionInput(input: {
  /** Absent until the first settings snapshot has arrived, which draws no rows. */
  view?: SettingsRowsInput;
  settings?: AppSettingsView;
  account: AccountSnapshot;
  credentials: CredentialEntryControl;
  calendar: CalendarControl;
  appleCalendar: AppleCalendarControl;
  linear: LinearControl;
  superset: SupersetControl;
  workspaceProviders: readonly WorkspaceProviderOption[];
  panelOpen: boolean;
}): ConnectionInput | undefined {
  const [refreshing, setRefreshing] = useState(false);
  const { view, settings } = input;
  if (!view || !settings) return undefined;
  return {
    visibility: {
      settings: view.settings,
      accountDrawn: input.account.status === ACCOUNT_STATUS.SIGNED_IN,
      supersetInstalled: input.superset.installed,
      workspaceProjects: input.workspaceProviders
        .filter((option) => option.projects.length > 0)
        .map((option) => ({ id: option.id, name: option.name })),
    },
    settings,
    credentials: input.credentials,
    calendar: input.calendar,
    appleCalendar: input.appleCalendar,
    linear: input.linear,
    superset: input.superset,
    workspaceProviders: input.workspaceProviders,
    writes: SETTINGS_WRITES,
    panelOpen: input.panelOpen,
    refreshing,
    onRefreshCalendars: () => {
      setRefreshing(true);
      void input.calendar.onRefresh().finally(() => setRefreshing(false));
    },
  };
}
