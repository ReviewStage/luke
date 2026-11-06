import { ACT_KIND } from "@repo/host/acts";
import type { AppStateSnapshot } from "@repo/host/app-state";
import type {
  MicrophoneControl,
  NotificationsControl,
  UpdateControl,
} from "@repo/settings/settings-controls";
import type { SettingsView } from "@repo/settings/settings-views";
import { fixtureUpdate } from "@repo/settings/update-row";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { actMutation, pressMutation } from "./act-mutations.js";
import type { SettingsPanelProps } from "./settings/settings-panel.js";
import type { WorkspaceSettingsControl } from "./settings/workspace-page.js";
import {
  appStateQuery,
  selectAccount,
  selectAppSettingsView,
  selectAudio,
  selectNotifications,
  selectRun,
} from "./use-app-state.js";

export interface SettingsDoors {
  view: SettingsView;
  onViewChange: (view: SettingsView) => void;
  onSignOut: () => Promise<void>;
  onRequestMicrophone: () => void | Promise<void>;
  workspace: WorkspaceSettingsControl;
}

const selectShownUpdate = (state: AppStateSnapshot) => fixtureUpdate(state.run, state.update);

export function useShownUpdate(): UpdateControl["update"] | undefined {
  return useQuery({ ...appStateQuery, select: selectShownUpdate }).data;
}

export function useSettingsPanel(doors: SettingsDoors): SettingsPanelProps | undefined {
  const { mutateAsync: checkForUpdate } = useMutation(actMutation(ACT_KIND.UPDATE_CHECK));
  const { mutate: installUpdate } = useMutation(pressMutation(ACT_KIND.UPDATE_INSTALL));
  const { mutate: moveToApplications } = useMutation(
    pressMutation(ACT_KIND.UPDATE_MOVE_TO_APPLICATIONS),
  );
  const { mutate: openRelease } = useMutation(pressMutation(ACT_KIND.UPDATE_OPEN_RELEASE));
  const { mutate: openMicrophoneSettings } = useMutation(
    pressMutation(ACT_KIND.MICROPHONE_OPEN_SETTINGS),
  );
  const { mutate: openNotificationsSettings } = useMutation(
    pressMutation(ACT_KIND.NOTIFICATIONS_OPEN_SETTINGS),
  );
  const account = useQuery({ ...appStateQuery, select: selectAccount }).data;
  const run = useQuery({ ...appStateQuery, select: selectRun }).data;
  const settings = useQuery({ ...appStateQuery, select: selectAppSettingsView }).data;
  const audio = useQuery({ ...appStateQuery, select: selectAudio }).data;
  const notificationsStatus = useQuery({ ...appStateQuery, select: selectNotifications }).data
    ?.status;
  const update = useShownUpdate();
  const packaged = run?.packaged;
  const commit = run?.commit;
  const updates = useMemo<UpdateControl | undefined>(
    () =>
      update === undefined || packaged === undefined
        ? undefined
        : {
            update,
            build: { packaged, ...(commit ? { commit } : undefined) },
            onCheck: async () => {
              await checkForUpdate();
            },
            onInstall: () => installUpdate(),
            onMoveToApplications: () => moveToApplications(),
            onOpenLatest: () => openRelease(),
          },
    [update, packaged, commit, checkForUpdate, installUpdate, moveToApplications, openRelease],
  );
  return useMemo(() => {
    if (account === undefined || run === undefined || audio === undefined) return undefined;
    if (notificationsStatus === undefined || updates === undefined) {
      return undefined;
    }
    const microphone: MicrophoneControl = {
      status: audio.microphoneStatus,
      onRequest: doors.onRequestMicrophone,
      onOpenSettings: () => openMicrophoneSettings(),
    };
    const notifications: NotificationsControl = {
      status: notificationsStatus,
      packaged: run.packaged,
      onOpenSettings: () => openNotificationsSettings(),
    };
    return {
      account,
      onSignOut: doors.onSignOut,
      view: doors.view,
      onViewChange: doors.onViewChange,
      microphone,
      notifications,
      updates,
      ...(settings === undefined ? undefined : { settings }),
      capabilities: run.capabilities,
      workspace: doors.workspace,
    };
  }, [
    account,
    run,
    settings,
    audio,
    notificationsStatus,
    updates,
    doors,
    openMicrophoneSettings,
    openNotificationsSettings,
  ]);
}
