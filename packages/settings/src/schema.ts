import { APP_SETTING_ID, isAppSettingId } from "@sidecar/guide";
import { isLiveVoice, LIVE_DEFAULTS, LIVE_VOICE_LIST, type LiveVoice } from "@sidecar/live";
import type { UnparsedWireValue } from "@sidecar/wire";
import { choiceSetting, hotkeySetting, optional, toggleSetting } from "./schema-builders.js";
import {
  SETTING_SECTION,
  SETTING_SIDE_EFFECT,
  SETTINGS_PAGE,
  SETTINGS_RESET_SCOPE,
  type SettingsVisibility,
} from "./schema-types.js";
import { APPEARANCE_PAGE, VOICE_PAGE } from "./settings-paths.js";

export {
  SETTING_ROWS,
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

/** Voice available and the microphone granted: the whole of what a control needs. */
const voiceControlDrawn = (view: SettingsVisibility): boolean => view.voiceControlsDrawn;

export const APP_SETTING_SCHEMA = {
  openAtLogin: toggleSetting({
    field: "openAtLogin",
    id: APP_SETTING_ID.OPEN_AT_LOGIN,
    label: "Open Luke at login",
    description: "Whether Luke starts on his own when this Mac signs in.",
    default: true,
    page: SETTINGS_PAGE.APPEARANCE,
    order: 10,
    resetScope: SETTINGS_RESET_SCOPE.APPEARANCE,
    manual: APPEARANCE_PAGE,
    sideEffect: SETTING_SIDE_EFFECT.LOGIN_ITEM,
    adjustable: true,
  }),
  showInDock: toggleSetting({
    field: "showInDock",
    id: APP_SETTING_ID.SHOW_IN_DOCK,
    label: "Show Luke in the Dock",
    description: "Whether Luke also stands in the Dock as an app icon.",
    default: false,
    page: SETTINGS_PAGE.APPEARANCE,
    order: 20,
    resetScope: SETTINGS_RESET_SCOPE.APPEARANCE,
    manual: APPEARANCE_PAGE,
    sideEffect: SETTING_SIDE_EFFECT.DOCK,
    adjustable: true,
  }),
  voice: choiceSetting({
    field: "voice",
    id: APP_SETTING_ID.VOICE,
    label: "Voice",
    description:
      "Which voice Luke speaks with. A conversation keeps the voice it opened with, so choosing one ends the conversation standing, and the next opens in the new voice.",
    values: OFFERED_VOICE_LIST,
    say: (voice) => voice,
    optionLabel: voiceOptionLabel,
    guard: (value: UnparsedWireValue) => optional(value, isLiveVoice),
    default: LIVE_DEFAULTS.VOICE,
    page: SETTINGS_PAGE.VOICE,
    section: SETTING_SECTION.CONTROLS,
    order: 30,
    resetScope: SETTINGS_RESET_SCOPE.VOICE,
    manual: VOICE_PAGE,
    sideEffect: SETTING_SIDE_EFFECT.VOICE,
    adjustable: true,
    visible: voiceControlDrawn,
  }),
  voiceCaptions: toggleSetting({
    field: "voiceCaptions",
    id: APP_SETTING_ID.VOICE_CAPTIONS,
    label: "Captions",
    description:
      "Luke's words on screen while he speaks, and yours while you speak to him; nothing is kept. " +
      "His also appear on their own, whatever this says, while the Mac's output is muted or at zero.",
    default: false,
    page: SETTINGS_PAGE.VOICE,
    section: SETTING_SECTION.CONTROLS,
    order: 50,
    resetScope: SETTINGS_RESET_SCOPE.VOICE,
    manual: VOICE_PAGE,
    sideEffect: SETTING_SIDE_EFFECT.NONE,
    adjustable: true,
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
    description:
      "Whether Music and Spotify are turned down while a spoken exchange is live, and back up after.",
    default: true,
    page: SETTINGS_PAGE.VOICE,
    section: SETTING_SECTION.CONTROLS,
    order: 90,
    resetScope: SETTINGS_RESET_SCOPE.VOICE,
    manual: VOICE_PAGE,
    sideEffect: SETTING_SIDE_EFFECT.MEDIA_DUCK,
    adjustable: true,
    visible: voiceControlDrawn,
  }),
  preferBuiltInMicrophone: toggleSetting({
    field: "preferBuiltInMicrophone",
    id: APP_SETTING_ID.PREFER_BUILT_IN_MICROPHONE,
    label: "Prefer the Mac's microphone",
    description:
      "Whether Luke listens through the Mac's own microphone when the system input is a " +
      "Bluetooth headset, so the headset keeps its full music quality. A shut lid keeps the " +
      "headset's microphone either way.",
    default: true,
    page: SETTINGS_PAGE.VOICE,
    section: SETTING_SECTION.CONTROLS,
    order: 110,
    resetScope: SETTINGS_RESET_SCOPE.VOICE,
    manual: VOICE_PAGE,
    sideEffect: SETTING_SIDE_EFFECT.NONE,
    adjustable: true,
    visible: voiceControlDrawn,
  }),
} as const;
