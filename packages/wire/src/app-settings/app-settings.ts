import { Schema } from "effect";

/**
 * The ids the app's own user-facing settings are named by. They live here
 * rather than beside the desktop's settings schema because the product-event
 * vocabulary, which may carry a setting's id but never its value, names the
 * same set and may not depend on the schema. The ids of settings this build no
 * longer offers stay, so a count an older build still sends under one validates.
 */
export const APP_SETTING_ID = {
  VOICE: "voice",
  VOICE_CAPTIONS: "voice_captions",
  VIDEO_AVATAR: "video_avatar",
  DUCK_OTHER_MEDIA: "duck_other_media",
  PREFER_BUILT_IN_MICROPHONE: "prefer_built_in_microphone",
  QUIET_DURING_MEETINGS: "quiet_during_meetings",
  ANNOUNCE_SESSIONS: "announce_sessions",
  SHOW_IN_DOCK: "show_in_dock",
  OPEN_AT_LOGIN: "open_at_login",
  AGENT_NOTIFICATIONS: "agent_notifications",
  MAC_COMMANDS: "mac_commands",
  DEFAULT_WORKSPACE_PROVIDER: "default_workspace_provider",
  WORKSPACE_AGENT_MODEL: "workspace_agent_model",
  WORKSPACE_AGENT_EFFORT: "workspace_agent_effort",
  TALK_HOTKEY: "talk_hotkey",
  STOP_HOTKEY: "stop_hotkey",
  CALENDAR_SELECTED: "calendar_selected",
  THEME: "theme",
  ZOOM: "zoom",
  LINE_NUMBERS: "line_numbers",
  WORD_WRAP: "word_wrap",
  DIFF_LAYOUT: "diff_layout",
  DIFF_INDICATORS: "diff_indicators",
  DIFF_INLINE: "diff_inline",
  DIFF_BACKGROUNDS: "diff_backgrounds",
  DIFF_DARK_THEME: "diff_dark_theme",
  DIFF_LIGHT_THEME: "diff_light_theme",
  DIFF_FONT: "diff_font",
  DIFF_FONT_SIZE: "diff_font_size",
  DIFF_LINE_HEIGHT: "diff_line_height",
  DIFF_LIGATURES: "diff_ligatures",
  DIFF_MINIMIZE_COMMENTS: "diff_minimize_comments",
  LINK_OPEN: "link_open",
} as const;

export type AppSettingId = (typeof APP_SETTING_ID)[keyof typeof APP_SETTING_ID];

const AppSettingIdSchema = Schema.Literals(Object.values(APP_SETTING_ID));

const readsAppSettingId = Schema.is(AppSettingIdSchema);

export function isAppSettingId(value: string): value is AppSettingId {
  return readsAppSettingId(value);
}
