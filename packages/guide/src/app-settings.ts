import { Schema } from "effect";

/**
 * The ids the app's own user-facing settings are named by. They live here
 * rather than beside the desktop's settings schema because two things outside
 * that schema have to name the same set: the guide a spoken change is
 * validated against, and the product-event vocabulary, which may carry a
 * setting's id but never its value. The ids of settings this build no longer
 * offers stay, so a count an older build still sends under one validates.
 */
export const APP_SETTING_ID = {
  VOICE: "voice",
  VOICE_CAPTIONS: "voice_captions",
  DUCK_OTHER_MEDIA: "duck_other_media",
  PREFER_BUILT_IN_MICROPHONE: "prefer_built_in_microphone",
  QUIET_DURING_MEETINGS: "quiet_during_meetings",
  ANNOUNCE_SESSIONS: "announce_sessions",
  SHOW_IN_DOCK: "show_in_dock",
  OPEN_AT_LOGIN: "open_at_login",
  DEFAULT_WORKSPACE_PROVIDER: "default_workspace_provider",
  WORKSPACE_AGENT_MODEL: "workspace_agent_model",
  WORKSPACE_AGENT_EFFORT: "workspace_agent_effort",
  TALK_HOTKEY: "talk_hotkey",
  STOP_HOTKEY: "stop_hotkey",
  CALENDAR_SELECTED: "calendar_selected",
} as const;

export type AppSettingId = (typeof APP_SETTING_ID)[keyof typeof APP_SETTING_ID];

export const AppSettingIdSchema = Schema.Literals(Object.values(APP_SETTING_ID));

const readsAppSettingId = Schema.is(AppSettingIdSchema);

export function isAppSettingId(value: string): value is AppSettingId {
  return readsAppSettingId(value);
}
