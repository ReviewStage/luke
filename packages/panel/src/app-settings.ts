/**
 * app-settings.ts -- what the window's Settings and its search are drawn from: the document's settings, account, and platform slices, read where they are drawn rather than by the window.
 *
 * The window hands Settings its doors, which a setting moving changes
 * none of, and the slices are read here, by the component that draws
 * Settings, so a setting that moves draws Settings again and leaves the
 * window, and the tasks it holds, as they were.
 */

import { ACT_KIND } from "@luke/host/acts";
import { VOICE_HOTKEY_NONE } from "@luke/settings";
import type { SettingsView } from "@luke/settings/settings-views";
import { fixtureUpdate } from "@luke/settings/update-row";
import {
  type MicrophoneControl,
  NOTIFICATIONS_GRANTOR,
  type NotificationsControl,
  type ShortcutControl,
  type UpdateControl,
} from "@luke/voice/settings-controls";
import type { ActionResult } from "@luke/wire";
import * as Atom from "effect/reactivity/Atom";
import { useMemo } from "react";
import { useAct } from "./act.js";
import { appPlatform } from "./app-platform.js";
import { testNotifications } from "./settings/notifications-press.js";
import type { SettingsPanelProps } from "./settings/settings-panel.js";
import type { WorkspaceSettingsControl } from "./settings/workspace-page.js";
import { APP_SETTINGS_VIEW, APP_SLICE, useAppSlice } from "./use-app-state.js";

/** What the window hands Settings: the page it shows, and the doors it answers through. */
export interface SettingsDoors {
  /** Which settings page is showing, held by the window because a shortcut or a link elsewhere turns it. */
  view: SettingsView;
  onViewChange: (view: SettingsView) => void;
  onSignOut: () => Promise<void>;
  onDeleteAccount: () => Promise<ActionResult>;
  onRequestMicrophone: () => void;
  onVoiceHotkeyChange: (accelerator: string | undefined) => Promise<ActionResult>;
  onStopHotkeyChange: (accelerator: string | undefined) => Promise<ActionResult>;
  onShortcutCapture: (capturing: boolean) => void;
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
  const { act, tell } = useAct();
  const account = useAppSlice(APP_SLICE.ACCOUNT);
  const run = useAppSlice(APP_SLICE.RUN);
  const settings = useAppSlice(APP_SETTINGS_VIEW);
  const audio = useAppSlice(APP_SLICE.AUDIO);
  const hotkeys = useAppSlice(APP_SLICE.HOTKEYS);
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
              await act(ACT_KIND.UPDATE_CHECK);
            },
            onInstall: () => tell(ACT_KIND.UPDATE_INSTALL),
            onOpenLatest: () => tell(ACT_KIND.UPDATE_OPEN_RELEASE),
          },
    [update, packaged, commit, act, tell],
  );
  return useMemo(() => {
    if (account === undefined || run === undefined || audio === undefined) return undefined;
    if (hotkeys === undefined || notificationsStatus === undefined || updates === undefined) {
      return undefined;
    }
    const microphone: MicrophoneControl = {
      status: audio.microphoneStatus,
      voiceAvailable: settings?.voiceAvailable === true,
      onRequest: doors.onRequestMicrophone,
      onOpenSettings: () => tell(ACT_KIND.MICROPHONE_OPEN_SETTINGS),
    };
    const notifications: NotificationsControl = {
      status: notificationsStatus,
      grantor: appPlatform().notificationsGrantor?.() ?? NOTIFICATIONS_GRANTOR.MACOS,
      packaged: run.packaged,
      onOpenSettings: () => tell(ACT_KIND.NOTIFICATIONS_OPEN_SETTINGS),
      onTest: testNotifications,
    };
    const shortcuts: ShortcutControl = {
      ...(hotkeys.talk ? { voiceHotkey: hotkeys.talk } : undefined),
      voiceHotkeyHeld: hotkeys.talkHeld,
      voiceChosen: settings?.voiceHotkey !== undefined,
      voiceOff: settings?.voiceHotkey === VOICE_HOTKEY_NONE,
      onVoiceHotkeyChange: doors.onVoiceHotkeyChange,
      // Both rows take the accelerator: they draw the keys apart and
      // label the chord whole for the buttons beside them.
      ...(hotkeys.stop ? { stopHotkey: hotkeys.stop } : undefined),
      stopChosen: settings?.stopHotkey !== undefined,
      stopOff: settings?.stopHotkey === VOICE_HOTKEY_NONE,
      onStopHotkeyChange: doors.onStopHotkeyChange,
      onCapture: doors.onShortcutCapture,
    };
    return {
      account,
      onSignOut: doors.onSignOut,
      onDeleteAccount: doors.onDeleteAccount,
      view: doors.view,
      onViewChange: doors.onViewChange,
      microphone,
      notifications,
      updates,
      ...(settings === undefined ? undefined : { settings }),
      shortcuts,
      capabilities: run.capabilities,
      workspace: doors.workspace,
    };
  }, [account, run, settings, audio, hotkeys, notificationsStatus, updates, doors, tell]);
}
