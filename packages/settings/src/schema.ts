import {
  isVideoAvatar,
  VIDEO_AVATAR,
  VIDEO_AVATAR_LIST,
  VIDEO_AVATAR_NAME,
} from "@luke/features/video-avatar";
import { isLiveVoice, LIVE_DEFAULTS, LIVE_VOICE_LIST, type LiveVoice } from "@luke/live";
import type { UnparsedWireValue } from "@luke/wire";
import { APP_SETTING_ID, isAppSettingId } from "@luke/wire/app-settings";
import { EXPERIMENT, experimentOn } from "./experiments.js";
import { choiceSetting, hotkeySetting, optional, toggleSetting } from "./schema-builders.js";
import {
  SETTING_SECTION,
  SETTING_SIDE_EFFECT,
  SETTINGS_PAGE,
  SETTINGS_RESET_SCOPE,
  type SettingsVisibility,
} from "./schema-types.js";
import { isTheme, THEME, THEME_LIST, type Theme } from "./theme.js";
import { isZoomPercent, ZOOM_ACTUAL_SIZE, ZOOM_PERCENTS } from "./zoom.js";

export {
  SETTING_SECTION,
  SETTING_SIDE_EFFECT,
  SETTINGS_PAGE,
  SETTINGS_RESET_SCOPE,
  type SettingSection,
  type SettingSideEffectId,
  type SettingsPage,
  type SettingsResetScope,
} from "./schema-types.js";
// The ids themselves live in core, because the product-event vocabulary names
// the same set and may not depend on anything here.
export { APP_SETTING_ID, isAppSettingId };

/* The voice is an account preference every device applies, and every device
   reads the one Live vocabulary, so the row offers the whole of it. */
const OFFERED_VOICE_LIST: readonly LiveVoice[] = LIVE_VOICE_LIST;

/* The API names its voices in lowercase; on a control they read as names. The
   default carries its status into the menu, so returning to it never needs the
   README or a memory of what shipped. */
function voiceOptionLabel(voice: LiveVoice): string {
  const name = voice.charAt(0).toUpperCase() + voice.slice(1);
  return voice === LIVE_DEFAULTS.VOICE ? `${name} (default)` : name;
}

/* A theme is stored in lowercase; on a control it reads as a name. */
function themeOptionLabel(theme: Theme): string {
  return theme.charAt(0).toUpperCase() + theme.slice(1);
}

/** Voice available and the microphone granted: the whole of what a control needs. */
const voiceControlDrawn = (view: SettingsVisibility): boolean => view.voiceControlsDrawn;

/** Signed in with Video calls on: an avatar is a choice only while calls can show one. */
const videoCallsDrawn = (view: SettingsVisibility): boolean =>
  view.accountDrawn && experimentOn(view.settings.experiments, EXPERIMENT.VIDEO_CALLS);

export const APP_SETTING_SCHEMA = {
  theme: choiceSetting({
    field: "theme",
    id: APP_SETTING_ID.THEME,
    label: "Theme",
    values: THEME_LIST,
    token: (theme) => theme,
    optionLabel: themeOptionLabel,
    guard: (value: UnparsedWireValue) => optional(value, isTheme),
    default: THEME.SYSTEM,
    page: SETTINGS_PAGE.APPEARANCE,
    order: 5,
    resetScope: SETTINGS_RESET_SCOPE.APPEARANCE,
    // Nothing to run per write: main steers the app from every settings
    // snapshot it publishes, so a write that failed steers nothing.
    sideEffect: SETTING_SIDE_EFFECT.NONE,
  }),
  zoom: choiceSetting({
    field: "zoom",
    id: APP_SETTING_ID.ZOOM,
    label: "Zoom",
    detail: "⌘+ and ⌘− step through these sizes, and ⌘0 returns to 100%.",
    values: ZOOM_PERCENTS,
    token: (percent) => String(percent),
    optionLabel: (percent) => `${percent}%`,
    guard: (value: UnparsedWireValue) => optional(value, isZoomPercent),
    default: ZOOM_ACTUAL_SIZE,
    page: SETTINGS_PAGE.APPEARANCE,
    order: 7,
    resetScope: SETTINGS_RESET_SCOPE.APPEARANCE,
    // Nothing to run per write, as for the theme: main zooms the windows
    // from every settings snapshot it publishes.
    sideEffect: SETTING_SIDE_EFFECT.NONE,
  }),
  openAtLogin: toggleSetting({
    field: "openAtLogin",
    id: APP_SETTING_ID.OPEN_AT_LOGIN,
    label: "Open Luke at login",
    default: true,
    page: SETTINGS_PAGE.APPEARANCE,
    order: 10,
    resetScope: SETTINGS_RESET_SCOPE.APPEARANCE,
    sideEffect: SETTING_SIDE_EFFECT.LOGIN_ITEM,
  }),
  macCommands: toggleSetting({
    field: "macCommands",
    id: APP_SETTING_ID.MAC_COMMANDS,
    label: "Let agents run commands on this Mac",
    detail:
      "Luke and coding agents run any shell command here without asking, from your home folder, " +
      "and what it prints goes to the model and is kept with the conversation.",
    default: true,
    page: SETTINGS_PAGE.THIS_MAC,
    order: 2,
    // Nothing to run per write: the host reads the setting before each read for commands.
    sideEffect: SETTING_SIDE_EFFECT.NONE,
  }),
  agentNotifications: toggleSetting({
    field: "agentNotifications",
    id: APP_SETTING_ID.AGENT_NOTIFICATIONS,
    label: "Notify me when a coding agent finishes or needs me",
    detail: "Sent only while Luke's window is in the background.",
    default: true,
    page: SETTINGS_PAGE.NOTIFICATIONS,
    order: 1,
    // Nothing to run per write: main reads the setting as each end or inbox item is announced.
    sideEffect: SETTING_SIDE_EFFECT.NONE,
  }),
  voice: choiceSetting({
    field: "voice",
    id: APP_SETTING_ID.VOICE,
    label: "Voice",
    detail: "Choosing one ends the conversation in progress.",
    values: OFFERED_VOICE_LIST,
    token: (voice) => voice,
    optionLabel: voiceOptionLabel,
    guard: (value: UnparsedWireValue) => optional(value, isLiveVoice),
    default: LIVE_DEFAULTS.VOICE,
    page: SETTINGS_PAGE.VOICE,
    section: SETTING_SECTION.CONTROLS,
    order: 30,
    resetScope: SETTINGS_RESET_SCOPE.VOICE,
    sideEffect: SETTING_SIDE_EFFECT.VOICE,
    visible: voiceControlDrawn,
  }),
  /*
   * Who Luke appears as on video: the deployment's own persona, or one of
   * Keyframe's stock avatars. Kept on this Mac, beside the Video calls switch
   * it belongs to, and read as each avatar starts, so a change shows the next
   * time video does rather than ending the call in progress.
   */
  videoAvatar: choiceSetting({
    field: "videoAvatar",
    id: APP_SETTING_ID.VIDEO_AVATAR,
    label: "Avatar",
    detail: "Who Luke appears as on video. A new choice shows the next time video starts.",
    values: VIDEO_AVATAR_LIST,
    token: (avatar) => avatar,
    optionLabel: (avatar) => VIDEO_AVATAR_NAME[avatar],
    guard: (value: UnparsedWireValue) => optional(value, isVideoAvatar),
    default: VIDEO_AVATAR.DEFAULT,
    page: SETTINGS_PAGE.EXPERIMENTAL,
    section: SETTING_SECTION.VIDEO_CALLS,
    order: 40,
    sideEffect: SETTING_SIDE_EFFECT.NONE,
    visible: videoCallsDrawn,
  }),
  voiceCaptions: toggleSetting({
    field: "voiceCaptions",
    id: APP_SETTING_ID.VOICE_CAPTIONS,
    label: "Captions",
    detail:
      "Shows your words as well as Luke's, and keeps neither. Luke's appear anyway while the Mac's sound is muted or at zero.",
    default: false,
    page: SETTINGS_PAGE.VOICE,
    section: SETTING_SECTION.CONTROLS,
    order: 50,
    resetScope: SETTINGS_RESET_SCOPE.VOICE,
    sideEffect: SETTING_SIDE_EFFECT.NONE,
    visible: voiceControlDrawn,
  }),
  voiceHotkey: hotkeySetting({
    field: "voiceHotkey",
    id: APP_SETTING_ID.TALK_HOTKEY,
    order: 60,
    sideEffect: SETTING_SIDE_EFFECT.TALK_HOTKEY,
  }),
  stopHotkey: hotkeySetting({
    field: "stopHotkey",
    id: APP_SETTING_ID.STOP_HOTKEY,
    order: 80,
    sideEffect: SETTING_SIDE_EFFECT.STOP_HOTKEY,
  }),
  duckOtherMedia: toggleSetting({
    field: "duckOtherMedia",
    id: APP_SETTING_ID.DUCK_OTHER_MEDIA,
    label: "Quiet Music and Spotify",
    default: true,
    page: SETTINGS_PAGE.VOICE,
    section: SETTING_SECTION.CONTROLS,
    order: 90,
    resetScope: SETTINGS_RESET_SCOPE.VOICE,
    sideEffect: SETTING_SIDE_EFFECT.MEDIA_DUCK,
    visible: voiceControlDrawn,
  }),
  preferBuiltInMicrophone: toggleSetting({
    field: "preferBuiltInMicrophone",
    id: APP_SETTING_ID.PREFER_BUILT_IN_MICROPHONE,
    label: "Prefer the Mac's microphone",
    detail:
      "When the input is a Bluetooth headset, so the headset keeps its full sound quality. " +
      "With the lid shut, Luke uses the headset's microphone anyway.",
    default: true,
    page: SETTINGS_PAGE.VOICE,
    section: SETTING_SECTION.CONTROLS,
    order: 110,
    resetScope: SETTINGS_RESET_SCOPE.VOICE,
    sideEffect: SETTING_SIDE_EFFECT.NONE,
    visible: voiceControlDrawn,
  }),
} as const;
