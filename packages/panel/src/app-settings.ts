/**
 * app-settings.ts -- what the window's Settings and its search are drawn from: the document's settings, account, and platform slices, read where they are drawn rather than by the window.
 *
 * The window hands Settings its doors, which a setting moving changes
 * none of, and the slices are read here, by the component that draws
 * Settings, so a setting that moves draws Settings again and leaves the
 * window, and the tasks it holds, as they were.
 */

import { ACT_KIND } from "@repo/host/acts";
import type {
  MicrophoneControl,
  NotificationsControl,
  UpdateControl,
} from "@repo/settings/settings-controls";
import type { SettingsView } from "@repo/settings/settings-views";
import { fixtureUpdate } from "@repo/settings/update-row";
import { useMutation } from "@tanstack/react-query";
import * as Atom from "effect/reactivity/Atom";
import { useMemo } from "react";
import { actMutation, pressMutation } from "./act-mutations.js";
import type { SettingsPanelProps } from "./settings/settings-panel.js";
import type { WorkspaceSettingsControl } from "./settings/workspace-page.js";
import { APP_SETTINGS_VIEW, APP_SLICE, useAppSlice } from "./use-app-state.js";

/** What the window hands Settings: the page it shows, and the doors it answers through. */
export interface SettingsDoors {
  /** Which settings page is showing, held by the window because a shortcut or a link elsewhere turns it. */
  view: SettingsView;
  onViewChange: (view: SettingsView) => void;
  onSignOut: () => Promise<void>;
  onRequestMicrophone: () => void | Promise<void>;
  workspace: WorkspaceSettingsControl;
}

/** The update the window shows: the document's, or a fixture run's staged one, made once per change to either slice. */
const SHOWN_UPDATE = Atom.make((get) => {
  const run = get(APP_SLICE.RUN);
  const update = get(APP_SLICE.UPDATE);
  return run === undefined || update === undefined ? undefined : fixtureUpdate(run, update);
});

/** The update the window shows, redrawn only as the update or the run moves. */
export function useShownUpdate(): UpdateControl["update"] | undefined {
  return useAppSlice(SHOWN_UPDATE);
}

/**
 * Settings as the document holds it, around the doors the window hands it;
 * none before the first read. The update row stands apart from the rest,
 * because the sidebar draws it too, and a setting moving is no reason to
 * draw the sidebar again.
 */
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
  const account = useAppSlice(APP_SLICE.ACCOUNT);
  const run = useAppSlice(APP_SLICE.RUN);
  const settings = useAppSlice(APP_SETTINGS_VIEW);
  const audio = useAppSlice(APP_SLICE.AUDIO);
  const notificationsStatus = useAppSlice(APP_SLICE.NOTIFICATIONS)?.status;
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
            // Answered rather than fire-and-forget so the row that asked redraws from
            // the same snapshot the broadcast carries to every other window.
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
