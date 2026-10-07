import { APP_SETTING_ID, isAppSettingId } from "@sidecar/guide";
import { isLiveVoice, LIVE_DEFAULTS, LIVE_VOICE_LIST, type LiveVoice } from "@sidecar/live";
import {
  isProviderId,
  isWorkspaceProviderId,
  type ProviderId,
  parseWorkspaceAgentSelection,
  type WorkspaceAgentDefaults,
  type WorkspaceAgentSelection,
  type WorkspaceProviderId,
} from "@sidecar/session";
import { isRecord, isWireString, type UnparsedWireValue } from "@sidecar/wire";
import { Result } from "effect";
import {
  choiceSetting,
  hotkeySetting,
  optional,
  settingGuardFromEither,
  storedSetting,
  toggleSetting,
} from "./schema-builders.js";
import {
  SETTING_ROWS,
  SETTING_SECTION,
  SETTING_SIDE_EFFECT,
  SETTINGS_PAGE,
  SETTINGS_RESET_SCOPE,
  type SettingGuardResult,
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

function workspaceAgentDefaultsGuard(
  value: UnparsedWireValue,
): SettingGuardResult<WorkspaceAgentDefaults | undefined> {
  if (value === undefined) return settingGuardFromEither(Result.succeed(undefined));
  if (!isRecord(value)) {
    return settingGuardFromEither(Result.fail(undefined));
  }
  const defaults: Partial<Record<ProviderId, WorkspaceAgentSelection>> = {};
  for (const [providerId, selection] of Object.entries(value)) {
    const parsed = parseWorkspaceAgentSelection(providerId, selection);
    if (!isProviderId(providerId) || !parsed) continue;
    defaults[providerId] = parsed;
  }
  return settingGuardFromEither(
    Result.succeed(Object.keys(defaults).length > 0 ? defaults : undefined),
  );
}

const MAXIMUM_WORKSPACE_PROJECT_ID_LENGTH = 500;

function workspaceProjectDefaultsGuard(
  value: UnparsedWireValue,
): SettingGuardResult<Readonly<Partial<Record<WorkspaceProviderId, string>>> | undefined> {
  if (value === undefined) return settingGuardFromEither(Result.succeed(undefined));
  if (!isRecord(value)) {
    return settingGuardFromEither(Result.fail(undefined));
  }
  const defaults: Partial<Record<WorkspaceProviderId, string>> = {};
  for (const [providerId, candidate] of Object.entries(value)) {
    if (!isWorkspaceProviderId(providerId) || !isWireString(candidate)) continue;
    const providerProjectId = candidate.trim();
    if (!providerProjectId || providerProjectId.length > MAXIMUM_WORKSPACE_PROJECT_ID_LENGTH) {
      continue;
    }
    defaults[providerId] = providerProjectId;
  }
  return settingGuardFromEither(
    Result.succeed(Object.keys(defaults).length > 0 ? defaults : undefined),
  );
}

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
  // The three below are account preferences the service still stores for the
  // builds that drew a Connections page. This build draws no row for them and
  // writes none of them; it carries what the account holds, and nothing more.
  defaultWorkspaceProvider: storedSetting({
    field: "defaultWorkspaceProvider",
    default: undefined,
    guard: (value: UnparsedWireValue) =>
      optional(
        value,
        (candidate): candidate is WorkspaceProviderId =>
          isWireString(candidate) && isWorkspaceProviderId(candidate),
      ),
    page: SETTINGS_PAGE.ROOT,
    section: SETTING_SECTION.MAIN,
    order: 190,
    sideEffect: SETTING_SIDE_EFFECT.NONE,
    rows: SETTING_ROWS.NONE,
    ids: [],
    guide: () => undefined,
  }),
  workspaceAgentDefaults: storedSetting({
    field: "workspaceAgentDefaults",
    default: undefined,
    guard: workspaceAgentDefaultsGuard,
    page: SETTINGS_PAGE.ROOT,
    section: SETTING_SECTION.MAIN,
    order: 200,
    sideEffect: SETTING_SIDE_EFFECT.NONE,
    rows: SETTING_ROWS.NONE,
    ids: [],
    guide: () => undefined,
  }),
  workspaceProjectDefaults: storedSetting({
    field: "workspaceProjectDefaults",
    default: undefined,
    guard: workspaceProjectDefaultsGuard,
    page: SETTINGS_PAGE.ROOT,
    section: SETTING_SECTION.MAIN,
    order: 210,
    sideEffect: SETTING_SIDE_EFFECT.NONE,
    rows: SETTING_ROWS.NONE,
    ids: [],
    guide: () => undefined,
  }),
} as const;
