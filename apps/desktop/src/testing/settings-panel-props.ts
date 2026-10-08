import { ACCOUNT_STATUS } from "@sidecar/credentials/snapshot";
import { settingsView } from "@sidecar/settings/testing";
import { ACTION_RESULT_STATUS } from "@sidecar/wire";
import type { SettingsPanelProps } from "../renderer/settings/settings-panel";
import { SETTINGS_VIEW } from "../renderer/settings-views";
import { MICROPHONE_STATUS } from "../shared/messages/audio";
import { UPDATE_STATUS } from "../shared/messages/update";

const ignore = () => undefined;
const accepted = () => Promise.resolve({ status: ACTION_RESULT_STATUS.ACCEPTED } as const);

/** A signed-out panel on the front page with voice granted, every press ignored or accepted. */
export function settingsPanelProps(
  overrides: Partial<SettingsPanelProps> = {},
): SettingsPanelProps {
  return {
    account: { status: ACCOUNT_STATUS.SIGNED_OUT },
    onSignOut: () => Promise.resolve(),
    onDeleteAccount: accepted,
    view: SETTINGS_VIEW.ROOT,
    onViewChange: ignore,
    microphone: {
      status: MICROPHONE_STATUS.GRANTED,
      voiceAvailable: true,
      onRequest: ignore,
      onOpenSettings: ignore,
    },
    updates: {
      update: {
        status: UPDATE_STATUS.IDLE,
        currentVersion: "0.0.0",
        installSupported: false,
        upToDate: false,
      },
      onCheck: () => Promise.resolve(),
      onInstall: ignore,
      onOpenLatest: ignore,
    },
    settings: settingsView({ voiceAvailable: true }),
    feedback: {
      begin: ignore,
      changeMessage: ignore,
      changeName: ignore,
      changeEmail: ignore,
      attach: ignore,
      removeImage: ignore,
      dismiss: ignore,
      cancel: ignore,
      commit: ignore,
    },
    panelOpen: true,
    onQuit: ignore,
    shortcuts: {
      voiceHotkeyHeld: false,
      voiceChosen: false,
      voiceOff: false,
      onVoiceHotkeyChange: accepted,
      stopChosen: false,
      stopOff: false,
      onStopHotkeyChange: accepted,
      onCapture: ignore,
    },
    ...overrides,
  };
}
