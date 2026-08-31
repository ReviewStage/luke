/**
 * The ids the app's own user-facing settings are named by. They live here
 * rather than beside the desktop's settings schema because two things outside
 * that schema have to name the same set: the guide a spoken change is
 * validated against, and the product-event vocabulary, which may carry a
 * setting's id but never its value.
 */
export const APP_SETTING_ID = {
  VOICE: "voice",
  VOICE_SPEED: "voice_speed",
  VOICE_CAPTIONS: "voice_captions",
  DUCK_OTHER_MEDIA: "duck_other_media",
  PREFER_BUILT_IN_MICROPHONE: "prefer_built_in_microphone",
  QUIET_DURING_MEETINGS: "quiet_during_meetings",
  SHOW_IN_DOCK: "show_in_dock",
  OPEN_AT_LOGIN: "open_at_login",
  SHOW_ON_ALL_DISPLAYS: "show_on_all_displays",
  FORM_FACTOR: "form_factor",
  DEFAULT_WORKSPACE_PROVIDER: "default_workspace_provider",
  WORKSPACE_AGENT_MODEL: "workspace_agent_model",
  WORKSPACE_AGENT_EFFORT: "workspace_agent_effort",
  SUPERSET_AGENT: "superset_agent",
  VOICE_SOURCE: "voice_source",
  TALK_HOTKEY: "talk_hotkey",
  ASK_HOTKEY: "ask_hotkey",
  STOP_HOTKEY: "stop_hotkey",
  CALENDAR_SELECTED: "calendar_selected",
} as const;

export type AppSettingId = (typeof APP_SETTING_ID)[keyof typeof APP_SETTING_ID];

export const APP_SETTING_ID_LIST: readonly AppSettingId[] = Object.values(APP_SETTING_ID);

const APP_SETTING_IDS: ReadonlySet<string> = new Set(APP_SETTING_ID_LIST);

export function isAppSettingId(value: string): value is AppSettingId {
  return APP_SETTING_IDS.has(value);
}
