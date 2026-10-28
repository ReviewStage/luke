import { Schema } from "effect";

/**
 * The ids the app's own user-facing settings are named by. They live here
 * rather than beside the desktop's settings schema because the product-event
 * vocabulary, which may carry a setting's id but never its value, names the
 * same set and may not depend on the schema. The ids of settings this build no
 * longer offers stay, so a count an older build still sends under one validates.
 */
export const APP_SETTING_ID = {
  /** Offered by no build: the voice a call spoke with, removed with calls. */
  VOICE: "voice",
  /** Offered by no build: a call's captions, removed before calls were. */
  VOICE_CAPTIONS: "voice_captions",
  /** Offered by no build: the Video calls experiment's Avatar picker, removed with video calls. */
  VIDEO_AVATAR: "video_avatar",
  /** Offered by no build: Quiet Music and Spotify during a call, removed with calls. */
  DUCK_OTHER_MEDIA: "duck_other_media",
  PREFER_BUILT_IN_MICROPHONE: "prefer_built_in_microphone",
  AGENT_ENTER: "agent_enter",
  QUIET_DURING_MEETINGS: "quiet_during_meetings",
  ANNOUNCE_SESSIONS: "announce_sessions",
  SHOW_IN_DOCK: "show_in_dock",
  OPEN_AT_LOGIN: "open_at_login",
  AGENT_NOTIFICATIONS: "agent_notifications",
  MAC_COMMANDS: "mac_commands",
  /** Offered by no build: Run agents on this Mac, removed since the Local agents experiment is the opt-in and Runs on the choice. */
  LOCAL_AGENTS: "local_agents",
  /** Offered by no build: This Mac's sandbox switch, which never drew a row and runs every agent sandboxed now. */
  LOCAL_AGENTS_SANDBOX: "local_agents_sandbox",
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
  USAGE_DATA: "usage_data",
} as const;

export type AppSettingId = (typeof APP_SETTING_ID)[keyof typeof APP_SETTING_ID];

const AppSettingIdSchema = Schema.Literals(Object.values(APP_SETTING_ID));

const readsAppSettingId = Schema.is(AppSettingIdSchema);

export function isAppSettingId(value: string): value is AppSettingId {
  return readsAppSettingId(value);
}
