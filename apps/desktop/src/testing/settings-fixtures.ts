import { CREDENTIAL_PROVIDER_ID } from "@sidecar/credentials/vocabulary";
import { REALTIME_VOICE, REALTIME_VOICE_SPEED } from "@sidecar/realtime";
import { PANEL_FORM_FACTOR } from "@sidecar/surface";
import { CREDENTIAL_SOURCE, SECRET_STORAGE } from "#shared/messages/account";
import {
  APP_SETTING_DEFAULTS,
  type AppSettingsView,
  CLI_CONNECTION,
  VOICE_SOURCE,
} from "#shared/messages/settings";

/**
 * A settings snapshot with every member at a stated value, so a test is told
 * apart from the next only by what it moves.
 */
export function settingsView(overrides: Partial<AppSettingsView> = {}): AppSettingsView {
  // Object.assign rather than a spread: spreading a Partial marks every key it
  // could carry optional, and the result stops being an AppSettingsView.
  return Object.assign<AppSettingsView, Partial<AppSettingsView>>(
    {
      ...APP_SETTING_DEFAULTS,
      credentialSources: {
        [CREDENTIAL_PROVIDER_ID.CONDUCTOR]: CREDENTIAL_SOURCE.NONE,
        [CREDENTIAL_PROVIDER_ID.LINEAR]: CREDENTIAL_SOURCE.NONE,
        [CREDENTIAL_PROVIDER_ID.OPENAI]: CREDENTIAL_SOURCE.NONE,
      },
      secretStorage: SECRET_STORAGE.UNKNOWN,
      codexCloudConnection: CLI_CONNECTION.UNKNOWN,
      showInDock: false,
      voice: REALTIME_VOICE.CEDAR,
      voiceSpeed: REALTIME_VOICE_SPEED.NORMAL,
      voiceCaptions: false,
      duckOtherMedia: true,
      quietDuringMeetings: true,
      announceSessions: true,
      calendarSignInAvailable: false,
      linearSignInAvailable: false,
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
