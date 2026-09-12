import {
  CREDENTIAL_PROVIDER_ID,
  CREDENTIAL_SOURCE,
  SECRET_STORAGE,
} from "@sidecar/credentials/vocabulary";
import { LIVE_VOICE } from "@sidecar/live";
import { PANEL_FORM_FACTOR } from "@sidecar/surface";
import { VOICE_SOURCE } from "./schema.js";
import { APP_SETTING_DEFAULTS } from "./schema-access.js";
import type { SettingsVisibility } from "./schema-types.js";
import type { AppSettingsView } from "./wire.js";

/**
 * What a case may move, including back to a field's stored default of nothing:
 * the view resolves `voice`, `voiceSource`, and `formFactor` to a value, and a
 * case that moves one to the absence the schema declares says so with
 * `undefined`.
 */
type SettingsViewOverrides = {
  [Field in keyof AppSettingsView]?: AppSettingsView[Field] | undefined;
};

/**
 * A settings snapshot with every member at a stated value, so a test is told
 * apart from the next only by what it moves.
 */
export function settingsView(overrides: SettingsViewOverrides = {}): AppSettingsView {
  // Object.assign rather than a spread: spreading a Partial marks every key it
  // could carry optional, and the result stops being an AppSettingsView.
  return Object.assign<AppSettingsView, SettingsViewOverrides>(
    {
      ...APP_SETTING_DEFAULTS,
      credentialSources: {
        [CREDENTIAL_PROVIDER_ID.CONDUCTOR]: CREDENTIAL_SOURCE.NONE,
        [CREDENTIAL_PROVIDER_ID.OPENAI]: CREDENTIAL_SOURCE.NONE,
      },
      secretStorage: SECRET_STORAGE.UNKNOWN,
      showInDock: false,
      voice: LIVE_VOICE.CEDAR,
      voiceCaptions: false,
      duckOtherMedia: true,
      quietDuringMeetings: true,
      announceSessions: true,
      calendarSignInAvailable: false,
      appleCalendarAvailable: false,
      voiceAvailable: false,
      voiceSource: VOICE_SOURCE.ACCOUNT,
      preferBuiltInMicrophone: false,
      calendarAccounts: [],
      showOnAllDisplays: false,
      formFactor: PANEL_FORM_FACTOR.BUBBLE,
    },
    overrides,
  );
}

/**
 * What a row's own condition is judged from, at a stated resting state: no
 * account, no voice controls, nothing installed and nothing offering projects,
 * so a test says which of those it is about by moving it.
 */
export function settingsVisibility(
  overrides: Partial<Omit<SettingsVisibility, "settings">> & {
    settings?: Partial<AppSettingsView>;
  } = {},
): SettingsVisibility & { settings: AppSettingsView } {
  const { settings, ...rest } = overrides;
  return {
    voiceControlsDrawn: false,
    accountDrawn: false,
    workspaceProviders: [],
    ...rest,
    settings: settingsView(settings),
  };
}
