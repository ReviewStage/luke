import { PRODUCT_SETTING_VALUE, type ProductSettingValue } from "@sidecar/analytics";
import { CREDENTIAL_PROVIDERS, isCredentialProviderId } from "@sidecar/credentials/vocabulary";
import {
  APP_SETTING_ID,
  APP_SETTING_KIND,
  APP_TOGGLE_VALUE,
  type AppGuideSetting,
  type AppSettingId,
  appToggleText,
  isAppSettingId,
} from "@sidecar/guide";
import {
  isRealtimeVoice,
  isRealtimeVoiceSpeed,
  REALTIME_DEFAULTS,
  REALTIME_VOICE_LIST,
  REALTIME_VOICE_SPEED,
  type RealtimeVoice,
  type RealtimeVoiceSpeed,
} from "@sidecar/realtime";
import {
  CONDUCTOR_LOCAL_WORKSPACE_PROVIDER_ID,
  isProviderId,
  isSessionFilter,
  isWorkspaceProviderId,
  PROVIDER_ID,
  PROVIDER_IDENTITY_BY_ID,
  type ProviderId,
  parseWorkspaceAgentKindSelection,
  parseWorkspaceAgentSelection,
  type SessionFilter,
  SUPERSET_WORKSPACE_PROVIDER_ID,
  type WorkspaceAgentDefaults,
  type WorkspaceAgentKindSelection,
  type WorkspaceAgentSelection,
  type WorkspaceProviderId,
  workspaceAgentModelLabel,
  workspaceAgentModels,
} from "@sidecar/session";
import {
  DEFAULT_PANEL_FORM_FACTOR,
  isPanelFormFactor,
  PANEL_FORM_FACTOR_LIST,
  type PanelFormFactor,
} from "@sidecar/surface";
import { isRecord, isWireString, type UnparsedWireValue, type WireRecord } from "@sidecar/wire";
import { parseVoiceHotkey, VOICE_HOTKEY_NONE } from "./voice-hotkey.js";

// The ids themselves live in core, because the product-event vocabulary names
// the same set and may not depend on anything here.
export { APP_SETTING_ID, type AppSettingId, isAppSettingId };

export const VOICE_SOURCE = {
  ACCOUNT: "account",
  KEY: "key",
} as const;

export type VoiceSource = (typeof VOICE_SOURCE)[keyof typeof VOICE_SOURCE];

export function isVoiceSource(value: UnparsedWireValue): value is VoiceSource {
  return value === VOICE_SOURCE.ACCOUNT || value === VOICE_SOURCE.KEY;
}

export const SETTINGS_PAGE = {
  ROOT: "root",
  VOICE: "voice",
  APPEARANCE: "appearance",
  SHORTCUTS: "shortcuts",
  CONNECTIONS: "connections",
} as const;

export type SettingsPage = (typeof SETTINGS_PAGE)[keyof typeof SETTINGS_PAGE];

export const SETTINGS_RESET_SCOPE = {
  VOICE: "voice",
  APPEARANCE: "appearance",
  SHORTCUTS: "shortcuts",
  WORKSPACES: "workspaces",
} as const;

export type SettingsResetScope = (typeof SETTINGS_RESET_SCOPE)[keyof typeof SETTINGS_RESET_SCOPE];

export const SETTING_SIDE_EFFECT = {
  NONE: "none",
  DOCK: "dock",
  LOGIN_ITEM: "login-item",
  DISPLAYS: "displays",
  FORM_FACTOR: "form-factor",
  VOICE: "voice",
  VOICE_SPEED: "voice-speed",
  TALK_HOTKEY: "talk-hotkey",
  ASK_HOTKEY: "ask-hotkey",
  STOP_HOTKEY: "stop-hotkey",
  MEDIA_DUCK: "media-duck",
  VOICE_SOURCE: "voice-source",
  MEETING_QUIET: "meeting-quiet",
  VAULT_SYNC: "vault-sync",
  DEVELOPER_MODE: "developer-mode",
} as const;

export type SettingSideEffect = (typeof SETTING_SIDE_EFFECT)[keyof typeof SETTING_SIDE_EFFECT];

/** The concrete runtime families a stored setting may use after its schema guard. */
type StoredSettingValue =
  | string
  | number
  | boolean
  | readonly SessionFilter[]
  | WorkspaceAgentDefaults
  | Readonly<Partial<Record<WorkspaceProviderId, string>>>
  | undefined;

type AppSettingGuideSettings = (field: string) => StoredSettingValue;

export interface SettingGuardResult<Value> {
  valid: boolean;
  value: Value;
}

/** What one key of a map-valued setting holds. */
export type SettingEntryValue<Field extends AppSettingField> = NonNullable<
  NonNullable<AppSettingValue<Field>>[keyof NonNullable<AppSettingValue<Field>>]
>;

/**
 * Declares a setting whose value is a map of per-key entries, so one entry can
 * be written under the store's own lock. A caller that read the map, merged an
 * entry, and wrote the whole thing back would drop any entry saved while its
 * write was in flight — the lost update `#serialize` exists to prevent.
 */
interface SettingEntryDefinition<Value> {
  isKey(value: UnparsedWireValue): boolean;
  /** Whether the stored entry already says what a write would say. */
  same(current: Value | undefined, next: Value | undefined): boolean;
}

const SETTINGS_TAB = "the panel's Settings tab";
const VOICE_PAGE = `${SETTINGS_TAB}, on its Voice page`;
const VOICE_SOURCE_SECTION = `${SETTINGS_TAB}, on its front page, in the What Luke runs on section at the top`;
const APPEARANCE_PAGE = `${SETTINGS_TAB}, on its Appearance page`;
const CONNECTIONS_PAGE = `${SETTINGS_TAB}, on its Connections page`;
const CONDUCTOR_ROW_PATH = `the Conductor row under Providers, in ${CONNECTIONS_PAGE} — drawn once Conductor is connected`;
const CONDUCTOR_DEFAULT_CHOICE = "Conductor's default";
const ASK_EACH_TIME_CHOICE = "ask each time";

const VOICE_SOURCE_CHOICE = {
  [VOICE_SOURCE.ACCOUNT]: "your Luke account",
  [VOICE_SOURCE.KEY]: "your OpenAI key",
};

const VOICE_SPEED_WORD = {
  SLOW: "slow",
  NORMAL: "normal",
  QUICK: "quick",
  FAST: "fast",
} as const;

const VOICE_SPEED_WORDS = [
  { word: VOICE_SPEED_WORD.SLOW, speed: REALTIME_VOICE_SPEED.SLOW },
  { word: VOICE_SPEED_WORD.NORMAL, speed: REALTIME_VOICE_SPEED.NORMAL },
  { word: VOICE_SPEED_WORD.QUICK, speed: REALTIME_VOICE_SPEED.QUICK },
  { word: VOICE_SPEED_WORD.FAST, speed: REALTIME_VOICE_SPEED.FAST },
] as const;

const VOICE_SPEED_BY_SPOKEN_VALUE: Readonly<Record<string, RealtimeVoiceSpeed>> =
  Object.fromEntries(
    VOICE_SPEED_WORDS.flatMap(({ word, speed }) => [
      [word, speed],
      [`${speed}×`, speed],
    ]),
  );

function voiceSpeedMultiple(speed: RealtimeVoiceSpeed): string {
  return `${speed}×`;
}

function voiceSpeedWord(speed: RealtimeVoiceSpeed | undefined): string {
  return (
    VOICE_SPEED_WORDS.find((candidate) => candidate.speed === speed)?.word ??
    VOICE_SPEED_WORD.NORMAL
  );
}

function workspaceProviderName(providerId: WorkspaceProviderId): string {
  if (providerId === SUPERSET_WORKSPACE_PROVIDER_ID) return "Superset";
  if (providerId === CONDUCTOR_LOCAL_WORKSPACE_PROVIDER_ID) {
    return `${PROVIDER_IDENTITY_BY_ID[PROVIDER_ID.CONDUCTOR].displayName} (local)`;
  }
  if (isCredentialProviderId(providerId)) return CREDENTIAL_PROVIDERS[providerId].displayName;
  // The one workspace-capable provider with no credential row to take a
  // display name from.
  return isProviderId(providerId) ? PROVIDER_IDENTITY_BY_ID[providerId].displayName : providerId;
}

function settingGuideEntry<Field extends string>(
  _field: Field,
  ids: readonly string[],
  build: (
    settings: AppSettingGuideSettings,
    defaultValue: never,
  ) => AppGuideSetting | readonly AppGuideSetting[] | undefined,
) {
  return { ids, build };
}

function guideValue<Value extends StoredSettingValue>(
  settings: AppSettingGuideSettings,
  field: string,
): Value {
  // SAFETY: Each guide builder asks for its own schema field in the value type that field's guard returns.
  return settings(field) as Value;
}

const valid = <Value>(value: Value): SettingGuardResult<Value> => ({ valid: true, value });
const invalid = <Value>(value: Value): SettingGuardResult<Value> => ({ valid: false, value });

function optional<Value extends UnparsedWireValue>(
  value: UnparsedWireValue,
  guard: (candidate: UnparsedWireValue) => candidate is Value,
): SettingGuardResult<Value | undefined> {
  if (value === undefined) return valid(undefined);
  return guard(value) ? valid(value) : invalid(undefined);
}

const toggleAnalytics = (value: StoredSettingValue): ProductSettingValue =>
  value ? PRODUCT_SETTING_VALUE.ON : PRODUCT_SETTING_VALUE.OFF;

const choiceAnalytics = (value: StoredSettingValue): ProductSettingValue =>
  value === undefined ? PRODUCT_SETTING_VALUE.CLEARED : PRODUCT_SETTING_VALUE.SET;

function boolean(defaultValue: boolean) {
  return (value: UnparsedWireValue): SettingGuardResult<boolean> =>
    value === true || value === false ? valid(value) : invalid(defaultValue);
}

function hotkey(value: UnparsedWireValue): SettingGuardResult<string | undefined> {
  if (value === undefined) return valid(undefined);
  if (!isWireString(value)) return invalid(undefined);
  // A deletion is a choice the parser cannot spell: no chord at all, with no
  // default standing in behind the absence.
  if (value === VOICE_HOTKEY_NONE) return valid(VOICE_HOTKEY_NONE);
  const parsed = parseVoiceHotkey(value);
  return parsed ? valid(parsed) : invalid(undefined);
}

// A deleted key counts as off rather than set: a stored value stands either
// way, and the count is the one reader of the difference. The chord itself
// never travels, whichever shape is reported.
const hotkeyAnalytics = (value: StoredSettingValue): ProductSettingValue =>
  value === VOICE_HOTKEY_NONE ? PRODUCT_SETTING_VALUE.OFF : choiceAnalytics(value);

function workspaceAgentDefaults(
  value: UnparsedWireValue,
): SettingGuardResult<WorkspaceAgentDefaults | undefined> {
  if (value === undefined) return valid(undefined);
  if (!isRecord(value)) {
    return invalid(undefined);
  }
  const defaults: Partial<Record<ProviderId, WorkspaceAgentSelection>> &
    Partial<Record<typeof SUPERSET_WORKSPACE_PROVIDER_ID, WorkspaceAgentKindSelection>> = {};
  for (const [providerId, selection] of Object.entries(value)) {
    if (providerId === SUPERSET_WORKSPACE_PROVIDER_ID) {
      const parsed = parseWorkspaceAgentKindSelection(selection);
      if (parsed) defaults[SUPERSET_WORKSPACE_PROVIDER_ID] = parsed;
      continue;
    }
    const parsed = parseWorkspaceAgentSelection(providerId, selection);
    if (!isProviderId(providerId) || !parsed) continue;
    defaults[providerId] = parsed;
  }
  return valid(Object.keys(defaults).length > 0 ? defaults : undefined);
}

/**
 * The stored chips come back only as far as this build still recognizes them:
 * a value that names no place, kind, app, or agent here — another build's
 * vocabulary, or a corrupted file — is dropped rather than held dormant, a
 * repeated value narrows no further than its first, and a selection left with
 * nothing reads as unset, which is the unnarrowed list.
 */
function sessionFilters(
  value: UnparsedWireValue,
): SettingGuardResult<readonly SessionFilter[] | undefined> {
  if (value === undefined) return valid(undefined);
  if (!Array.isArray(value)) return invalid(undefined);
  const filters: SessionFilter[] = [];
  for (const candidate of value) {
    if (!isWireString(candidate) || !isSessionFilter(candidate)) continue;
    if (filters.includes(candidate)) continue;
    filters.push(candidate);
  }
  return valid(filters.length > 0 ? filters : undefined);
}

const MAXIMUM_SESSION_SEARCH_QUERY_LENGTH = 500;

/**
 * The stored words come back exactly as typed, because the field they refill
 * is the developer's own text. Only a value that could not be a held search
 * reads as unset instead: words that are all whitespace narrow nothing, and a
 * value past any typeable length is a corrupted file rather than a question
 * someone is still asking.
 */
function sessionSearchQuery(value: UnparsedWireValue): SettingGuardResult<string | undefined> {
  if (value === undefined) return valid(undefined);
  if (!isWireString(value)) return invalid(undefined);
  if (value.trim() === "" || value.length > MAXIMUM_SESSION_SEARCH_QUERY_LENGTH) {
    return valid(undefined);
  }
  return valid(value);
}

const MAXIMUM_WORKSPACE_PROJECT_ID_LENGTH = 500;

function workspaceProjectDefaults(
  value: UnparsedWireValue,
): SettingGuardResult<Readonly<Partial<Record<WorkspaceProviderId, string>>> | undefined> {
  if (value === undefined) return valid(undefined);
  if (!isRecord(value)) {
    return invalid(undefined);
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
  return valid(Object.keys(defaults).length > 0 ? defaults : undefined);
}

export const APP_SETTING_SCHEMA = {
  openAtLogin: {
    field: "openAtLogin",
    default: true,
    guard: boolean(true),
    settingsPage: SETTINGS_PAGE.APPEARANCE,
    resetScope: SETTINGS_RESET_SCOPE.APPEARANCE,
    guideEntry: settingGuideEntry(
      "openAtLogin",
      [APP_SETTING_ID.OPEN_AT_LOGIN],
      (settings, defaultValue) => ({
        id: APP_SETTING_ID.OPEN_AT_LOGIN,
        label: "Open Luke at login",
        description: "Whether Luke starts on his own when this Mac signs in.",
        kind: APP_SETTING_KIND.TOGGLE,
        value: appToggleText(guideValue<boolean>(settings, "openAtLogin")),
        defaultValue: appToggleText(defaultValue),
        adjustable: true,
        manual: APPEARANCE_PAGE,
      }),
    ),
    mainProcessSideEffect: SETTING_SIDE_EFFECT.LOGIN_ITEM,
    spokenValue: (value: string) => value === APP_TOGGLE_VALUE.ON,
    analytics: { id: APP_SETTING_ID.OPEN_AT_LOGIN, value: toggleAnalytics },
  },
  showInDock: {
    field: "showInDock",
    default: false,
    guard: boolean(false),
    settingsPage: SETTINGS_PAGE.APPEARANCE,
    resetScope: SETTINGS_RESET_SCOPE.APPEARANCE,
    guideEntry: settingGuideEntry(
      "showInDock",
      [APP_SETTING_ID.SHOW_IN_DOCK],
      (settings, defaultValue) => ({
        id: APP_SETTING_ID.SHOW_IN_DOCK,
        label: "Show Luke in the Dock",
        description: "Whether Luke also stands in the Dock as an app icon.",
        kind: APP_SETTING_KIND.TOGGLE,
        value: appToggleText(guideValue<boolean>(settings, "showInDock")),
        defaultValue: appToggleText(defaultValue),
        adjustable: true,
        manual: APPEARANCE_PAGE,
      }),
    ),
    mainProcessSideEffect: SETTING_SIDE_EFFECT.DOCK,
    spokenValue: (value: string) => value === APP_TOGGLE_VALUE.ON,
    analytics: { id: APP_SETTING_ID.SHOW_IN_DOCK, value: toggleAnalytics },
  },
  voice: {
    field: "voice",
    default: REALTIME_DEFAULTS.VOICE,
    guard: (value: UnparsedWireValue) => optional(value, isRealtimeVoice),
    settingsPage: SETTINGS_PAGE.VOICE,
    resetScope: SETTINGS_RESET_SCOPE.VOICE,
    guideEntry: settingGuideEntry("voice", [APP_SETTING_ID.VOICE], (settings, defaultValue) => ({
      id: APP_SETTING_ID.VOICE,
      label: "Voice",
      description:
        "Which voice Luke speaks with; a change is heard right away — a conversation under way starts afresh in the new voice.",
      kind: APP_SETTING_KIND.CHOICE,
      value: guideValue<RealtimeVoice>(settings, "voice"),
      defaultValue,
      choices: REALTIME_VOICE_LIST,
      adjustable: true,
      manual: VOICE_PAGE,
    })),
    mainProcessSideEffect: SETTING_SIDE_EFFECT.VOICE,
    spokenValue: (value: string) => (isRealtimeVoice(value) ? value : undefined),
    analytics: { id: APP_SETTING_ID.VOICE, value: choiceAnalytics },
  },
  voiceSpeed: {
    field: "voiceSpeed",
    default: REALTIME_DEFAULTS.SPEED,
    guard: (value: UnparsedWireValue) => optional(value, isRealtimeVoiceSpeed),
    settingsPage: SETTINGS_PAGE.VOICE,
    resetScope: SETTINGS_RESET_SCOPE.VOICE,
    guideEntry: settingGuideEntry(
      "voiceSpeed",
      [APP_SETTING_ID.VOICE_SPEED],
      (settings, defaultValue) => ({
        id: APP_SETTING_ID.VOICE_SPEED,
        label: "Speed",
        description:
          "How fast Luke talks: slow 0.75×, normal 1×, quick 1.25×, fast 1.5× the voice's natural rate. An ask may use the word or the multiple. A change is heard from the next reply on.",
        kind: APP_SETTING_KIND.CHOICE,
        value: voiceSpeedWord(guideValue<RealtimeVoiceSpeed>(settings, "voiceSpeed")),
        defaultValue: voiceSpeedWord(defaultValue),
        choices: VOICE_SPEED_WORDS.flatMap((candidate) => [
          candidate.word,
          voiceSpeedMultiple(candidate.speed),
        ]),
        adjustable: true,
        manual: VOICE_PAGE,
      }),
    ),
    mainProcessSideEffect: SETTING_SIDE_EFFECT.VOICE_SPEED,
    spokenValue: (value: string) => {
      return VOICE_SPEED_BY_SPOKEN_VALUE[value];
    },
    analytics: { id: APP_SETTING_ID.VOICE_SPEED, value: choiceAnalytics },
  },
  voiceCaptions: {
    field: "voiceCaptions",
    default: false,
    guard: boolean(false),
    settingsPage: SETTINGS_PAGE.VOICE,
    resetScope: SETTINGS_RESET_SCOPE.VOICE,
    guideEntry: settingGuideEntry(
      "voiceCaptions",
      [APP_SETTING_ID.VOICE_CAPTIONS],
      (settings, defaultValue) => ({
        id: APP_SETTING_ID.VOICE_CAPTIONS,
        label: "Captions",
        description:
          "Luke's words on screen while he speaks; nothing is kept. They also appear on their own, " +
          "whatever this says, for a reply answering a typed ask and while the Mac's output is " +
          "muted or at zero.",
        kind: APP_SETTING_KIND.TOGGLE,
        value: appToggleText(guideValue<boolean>(settings, "voiceCaptions")),
        defaultValue: appToggleText(defaultValue),
        adjustable: true,
        manual: VOICE_PAGE,
      }),
    ),
    mainProcessSideEffect: SETTING_SIDE_EFFECT.NONE,
    spokenValue: (value: string) => value === APP_TOGGLE_VALUE.ON,
    analytics: { id: APP_SETTING_ID.VOICE_CAPTIONS, value: toggleAnalytics },
  },
  voiceHotkey: {
    field: "voiceHotkey",
    default: undefined,
    guard: hotkey,
    settingsPage: SETTINGS_PAGE.SHORTCUTS,
    resetScope: SETTINGS_RESET_SCOPE.SHORTCUTS,
    // The talk-key fact reports the registered chord and its manual path, so
    // the guide builds no setting for it; the id is listed all the same, so
    // the chord's page is named and a change to it can be counted.
    guideEntry: settingGuideEntry("voiceHotkey", [APP_SETTING_ID.TALK_HOTKEY], () => undefined),
    mainProcessSideEffect: SETTING_SIDE_EFFECT.TALK_HOTKEY,
    analytics: { id: APP_SETTING_ID.TALK_HOTKEY, value: hotkeyAnalytics },
  },
  askHotkey: {
    field: "askHotkey",
    default: undefined,
    guard: hotkey,
    settingsPage: SETTINGS_PAGE.SHORTCUTS,
    resetScope: SETTINGS_RESET_SCOPE.SHORTCUTS,
    // The ask-key fact reports the registered chord and its manual path, so
    // the guide builds no setting for it; the id is listed all the same, so
    // the chord's page is named and a change to it can be counted.
    guideEntry: settingGuideEntry("askHotkey", [APP_SETTING_ID.ASK_HOTKEY], () => undefined),
    mainProcessSideEffect: SETTING_SIDE_EFFECT.ASK_HOTKEY,
    analytics: { id: APP_SETTING_ID.ASK_HOTKEY, value: hotkeyAnalytics },
  },
  stopHotkey: {
    field: "stopHotkey",
    default: undefined,
    guard: hotkey,
    settingsPage: SETTINGS_PAGE.SHORTCUTS,
    resetScope: SETTINGS_RESET_SCOPE.SHORTCUTS,
    // The stop-key fact reports the registered chord and its manual path, so
    // the guide builds no setting for it; the id is listed all the same, so
    // the chord's page is named and a change to it can be counted.
    guideEntry: settingGuideEntry("stopHotkey", [APP_SETTING_ID.STOP_HOTKEY], () => undefined),
    mainProcessSideEffect: SETTING_SIDE_EFFECT.STOP_HOTKEY,
    analytics: { id: APP_SETTING_ID.STOP_HOTKEY, value: hotkeyAnalytics },
  },
  duckOtherMedia: {
    field: "duckOtherMedia",
    default: true,
    guard: boolean(true),
    settingsPage: SETTINGS_PAGE.VOICE,
    resetScope: SETTINGS_RESET_SCOPE.VOICE,
    guideEntry: settingGuideEntry(
      "duckOtherMedia",
      [APP_SETTING_ID.DUCK_OTHER_MEDIA],
      (settings, defaultValue) => ({
        id: APP_SETTING_ID.DUCK_OTHER_MEDIA,
        label: "Quiet Music and Spotify",
        description:
          "Whether Music and Spotify are turned down while a spoken exchange is live, and back up after.",
        kind: APP_SETTING_KIND.TOGGLE,
        value: appToggleText(guideValue<boolean>(settings, "duckOtherMedia")),
        defaultValue: appToggleText(defaultValue),
        adjustable: true,
        manual: VOICE_PAGE,
      }),
    ),
    mainProcessSideEffect: SETTING_SIDE_EFFECT.MEDIA_DUCK,
    spokenValue: (value: string) => value === APP_TOGGLE_VALUE.ON,
    analytics: { id: APP_SETTING_ID.DUCK_OTHER_MEDIA, value: toggleAnalytics },
  },
  voiceSource: {
    field: "voiceSource",
    default: undefined,
    guard: (value: UnparsedWireValue) => optional(value, isVoiceSource),
    settingsPage: SETTINGS_PAGE.ROOT,
    guideEntry: settingGuideEntry("voiceSource", [APP_SETTING_ID.VOICE_SOURCE], (settings) => ({
      id: APP_SETTING_ID.VOICE_SOURCE,
      label: "What Luke runs on",
      description:
        "Which credential Luke speaks and reviews sessions on: the signed-in Luke account, " +
        "metered daily, or the developer's own OpenAI key, unmetered and billed by OpenAI. A " +
        "key stays stored either way.",
      kind: APP_SETTING_KIND.CHOICE,
      value: VOICE_SOURCE_CHOICE[guideValue<VoiceSource>(settings, "voiceSource")],
      defaultValue: VOICE_SOURCE_CHOICE[VOICE_SOURCE.ACCOUNT],
      choices: Object.values(VOICE_SOURCE_CHOICE),
      adjustable: false,
      manual: VOICE_SOURCE_SECTION,
    })),
    mainProcessSideEffect: SETTING_SIDE_EFFECT.VOICE_SOURCE,
    analytics: { id: APP_SETTING_ID.VOICE_SOURCE, value: choiceAnalytics },
  },
  preferBuiltInMicrophone: {
    field: "preferBuiltInMicrophone",
    default: true,
    guard: boolean(true),
    settingsPage: SETTINGS_PAGE.VOICE,
    resetScope: SETTINGS_RESET_SCOPE.VOICE,
    guideEntry: settingGuideEntry(
      "preferBuiltInMicrophone",
      [APP_SETTING_ID.PREFER_BUILT_IN_MICROPHONE],
      (settings, defaultValue) => ({
        id: APP_SETTING_ID.PREFER_BUILT_IN_MICROPHONE,
        label: "Prefer the Mac's microphone",
        description:
          "Whether Luke listens through the Mac's own microphone when the system input is a " +
          "Bluetooth headset, so the headset keeps its full music quality. A shut lid keeps the " +
          "headset's microphone either way.",
        kind: APP_SETTING_KIND.TOGGLE,
        value: appToggleText(guideValue<boolean>(settings, "preferBuiltInMicrophone")),
        defaultValue: appToggleText(defaultValue),
        adjustable: true,
        manual: VOICE_PAGE,
      }),
    ),
    mainProcessSideEffect: SETTING_SIDE_EFFECT.NONE,
    spokenValue: (value: string) => value === APP_TOGGLE_VALUE.ON,
    analytics: { id: APP_SETTING_ID.PREFER_BUILT_IN_MICROPHONE, value: toggleAnalytics },
  },
  quietDuringMeetings: {
    field: "quietDuringMeetings",
    default: true,
    guard: boolean(true),
    settingsPage: SETTINGS_PAGE.CONNECTIONS,
    guideEntry: settingGuideEntry(
      "quietDuringMeetings",
      [APP_SETTING_ID.QUIET_DURING_MEETINGS],
      (settings, defaultValue) => ({
        id: APP_SETTING_ID.QUIET_DURING_MEETINGS,
        label: "Quiet during meetings",
        description:
          "Whether spoken announcements wait while a connected calendar shows a meeting on, then read out together once it ends. Switched on mid-meeting it takes hold at once. It changes nothing until a calendar — a Google Calendar account, or this Mac's Apple Calendar — is connected.",
        kind: APP_SETTING_KIND.TOGGLE,
        value: appToggleText(guideValue<boolean>(settings, "quietDuringMeetings")),
        defaultValue: appToggleText(defaultValue),
        adjustable: true,
        manual: `${CONNECTIONS_PAGE} — drawn once a calendar is connected`,
      }),
    ),
    mainProcessSideEffect: SETTING_SIDE_EFFECT.MEETING_QUIET,
    spokenValue: (value: string) => value === APP_TOGGLE_VALUE.ON,
    analytics: { id: APP_SETTING_ID.QUIET_DURING_MEETINGS, value: toggleAnalytics },
  },
  syncProviderKeys: {
    field: "syncProviderKeys",
    default: true,
    guard: boolean(true),
    settingsPage: SETTINGS_PAGE.CONNECTIONS,
    guideEntry: settingGuideEntry(
      "syncProviderKeys",
      [APP_SETTING_ID.SYNC_PROVIDER_KEYS],
      (settings, defaultValue) => ({
        id: APP_SETTING_ID.SYNC_PROVIDER_KEYS,
        label: "Sync provider keys",
        description:
          "Whether provider API keys are also stored, encrypted, with Luke's own service for the account's other Luke devices. While on, the keys stored here are kept synced: a key saved while signed in syncs in the same press, and Luke re-syncs the stored keys when he starts signed in, at a sign-in, and when the switch turns on — automatically only for the account they were last synced for; another account signing in syncs nothing until it saves a key or flips the switch itself. Turning it off deletes every synced copy while the keys on this Mac stay. The service never sends a key back.",
        kind: APP_SETTING_KIND.TOGGLE,
        value: appToggleText(guideValue<boolean>(settings, "syncProviderKeys")),
        defaultValue: appToggleText(defaultValue),
        // Not adjustable by a spoken ask, deliberately: flipping it moves
        // credentials to and from Luke's service, and a credential act is
        // taken by hand alone.
        adjustable: false,
        manual: `${CONNECTIONS_PAGE}, in its Sync section`,
      }),
    ),
    mainProcessSideEffect: SETTING_SIDE_EFFECT.VAULT_SYNC,
    spokenValue: (value: string) => value === APP_TOGGLE_VALUE.ON,
    analytics: { id: APP_SETTING_ID.SYNC_PROVIDER_KEYS, value: toggleAnalytics },
  },
  showOnAllDisplays: {
    field: "showOnAllDisplays",
    default: false,
    guard: boolean(false),
    settingsPage: SETTINGS_PAGE.APPEARANCE,
    resetScope: SETTINGS_RESET_SCOPE.APPEARANCE,
    guideEntry: settingGuideEntry(
      "showOnAllDisplays",
      [APP_SETTING_ID.SHOW_ON_ALL_DISPLAYS],
      (settings, defaultValue) => ({
        id: APP_SETTING_ID.SHOW_ON_ALL_DISPLAYS,
        label: "Show Luke on all displays",
        description:
          "Whether Luke stands on every connected display at once; off keeps him to the main display alone.",
        kind: APP_SETTING_KIND.TOGGLE,
        value: appToggleText(guideValue<boolean>(settings, "showOnAllDisplays")),
        defaultValue: appToggleText(defaultValue),
        adjustable: true,
        manual: APPEARANCE_PAGE,
      }),
    ),
    mainProcessSideEffect: SETTING_SIDE_EFFECT.DISPLAYS,
    spokenValue: (value: string) => value === APP_TOGGLE_VALUE.ON,
    analytics: { id: APP_SETTING_ID.SHOW_ON_ALL_DISPLAYS, value: toggleAnalytics },
  },
  formFactor: {
    field: "formFactor",
    default: DEFAULT_PANEL_FORM_FACTOR,
    guard: (value: UnparsedWireValue) => optional(value, isPanelFormFactor),
    settingsPage: SETTINGS_PAGE.APPEARANCE,
    resetScope: SETTINGS_RESET_SCOPE.APPEARANCE,
    guideEntry: settingGuideEntry(
      "formFactor",
      [APP_SETTING_ID.FORM_FACTOR],
      (settings, defaultValue) => ({
        id: APP_SETTING_ID.FORM_FACTOR,
        label: "Form factor",
        description:
          "How Luke stands on a display without a camera housing — notch draws him one pressed into the top edge, bubble floats him just under it. A display with a real notch ignores this.",
        kind: APP_SETTING_KIND.CHOICE,
        value: guideValue<PanelFormFactor>(settings, "formFactor"),
        defaultValue,
        choices: PANEL_FORM_FACTOR_LIST,
        adjustable: true,
        manual: APPEARANCE_PAGE,
      }),
    ),
    mainProcessSideEffect: SETTING_SIDE_EFFECT.FORM_FACTOR,
    spokenValue: (value: string) => (isPanelFormFactor(value) ? value : undefined),
    analytics: { id: APP_SETTING_ID.FORM_FACTOR, value: choiceAnalytics },
  },
  // Carries no reset scope on purpose: an Appearance reset flipping this off
  // would stand a development instance back onto the released app's surface,
  // keys, and voice mid-run, which is not what resetting appearance means.
  // The schema default is the release channel's; a development-channel run
  // resolves an unset value to on in the settings snapshot instead, because a
  // schema in a reusable package cannot know which build is reading it.
  developerMode: {
    field: "developerMode",
    default: false,
    // Optional rather than defaulted at the guard, so an unset value stays
    // distinguishable from a chosen "off": the snapshot resolves the absence
    // to the channel's own default, and only the user's hand writes a value.
    guard: (value: UnparsedWireValue) =>
      optional(
        value,
        (candidate): candidate is boolean => candidate === true || candidate === false,
      ),
    settingsPage: SETTINGS_PAGE.APPEARANCE,
    guideEntry: settingGuideEntry(
      "developerMode",
      [APP_SETTING_ID.DEVELOPER_MODE],
      (settings, defaultValue) => ({
        id: APP_SETTING_ID.DEVELOPER_MODE,
        label: "Developer mode",
        description:
          "Whether this instance stands out of the released app's way: the panel floats as a bubble below the housing, spoken announcements stay silent, and the global keys are left to the released app. On by default in a development build, so running one never talks over — or draws over — the Luke already installed.",
        kind: APP_SETTING_KIND.TOGGLE,
        value: appToggleText(guideValue<boolean>(settings, "developerMode")),
        defaultValue: appToggleText(defaultValue),
        adjustable: true,
        manual: APPEARANCE_PAGE,
      }),
    ),
    mainProcessSideEffect: SETTING_SIDE_EFFECT.DEVELOPER_MODE,
    spokenValue: (value: string) => value === APP_TOGGLE_VALUE.ON,
    analytics: { id: APP_SETTING_ID.DEVELOPER_MODE, value: toggleAnalytics },
  },
  sessionFilters: {
    field: "sessionFilters",
    default: undefined,
    guard: sessionFilters,
    // The selection backs no settings row — it is the session list's own view
    // state, stored so the chips survive the panel closing and the app
    // restarting. With no guide ids the page below is inert; the root page is
    // named only because a definition must name one.
    settingsPage: SETTINGS_PAGE.ROOT,
    // The guide covers narrowing the list through the session-filter facts and
    // the spoken filter tool's own vocabulary; the stored selection is what
    // those already changed, not a setting of its own to describe.
    guideEntry: settingGuideEntry("sessionFilters", [], () => undefined),
    mainProcessSideEffect: SETTING_SIDE_EFFECT.NONE,
  },
  sessionSearchQuery: {
    field: "sessionSearchQuery",
    default: undefined,
    guard: sessionSearchQuery,
    // The query backs no settings row, on the filter selection's own terms: it
    // is the session list's view state, stored so a held search survives the
    // panel closing and the app restarting. With no guide ids the page below
    // is inert; the root page is named only because a definition must name one.
    settingsPage: SETTINGS_PAGE.ROOT,
    // The guide covers searching through the session-search facts and the
    // spoken search tool's own vocabulary; the stored words are what those
    // already typed, not a setting of their own to describe. No analytics
    // either: the value is the developer's own text, which never travels.
    guideEntry: settingGuideEntry("sessionSearchQuery", [], () => undefined),
    mainProcessSideEffect: SETTING_SIDE_EFFECT.NONE,
  },
  defaultWorkspaceProvider: {
    field: "defaultWorkspaceProvider",
    default: undefined,
    guard: (value: UnparsedWireValue) =>
      optional(
        value,
        (candidate): candidate is WorkspaceProviderId =>
          isWireString(candidate) && isWorkspaceProviderId(candidate),
      ),
    settingsPage: SETTINGS_PAGE.CONNECTIONS,
    resetScope: SETTINGS_RESET_SCOPE.WORKSPACES,
    guideEntry: settingGuideEntry(
      "defaultWorkspaceProvider",
      [APP_SETTING_ID.DEFAULT_WORKSPACE_PROVIDER],
      (settings) => ({
        id: APP_SETTING_ID.DEFAULT_WORKSPACE_PROVIDER,
        label: "Default workspace provider",
        description:
          "Which provider a conversational ask creates a new workspace in when the ask names none. " +
          "Until one is chosen Luke asks when more than one provider could take it, and the first " +
          "workspace created saves its provider as the default.",
        kind: APP_SETTING_KIND.CHOICE,
        value: guideValue<WorkspaceProviderId | undefined>(settings, "defaultWorkspaceProvider")
          ? workspaceProviderName(
              guideValue<WorkspaceProviderId>(settings, "defaultWorkspaceProvider"),
            )
          : ASK_EACH_TIME_CHOICE,
        choices: [
          ASK_EACH_TIME_CHOICE,
          workspaceProviderName(PROVIDER_ID.CODEX),
          // Both Conductors, or the guide would read the stored cloud
          // default's plain "Conductor" as the only Conductor there is.
          workspaceProviderName(PROVIDER_ID.CONDUCTOR),
          workspaceProviderName(CONDUCTOR_LOCAL_WORKSPACE_PROVIDER_ID),
          workspaceProviderName(PROVIDER_ID.CURSOR),
          "Superset",
        ],
        defaultValue: ASK_EACH_TIME_CHOICE,
        adjustable: false,
        manual: `${CONNECTIONS_PAGE}, under Workspaces`,
      }),
    ),
    mainProcessSideEffect: SETTING_SIDE_EFFECT.NONE,
    analytics: { id: APP_SETTING_ID.DEFAULT_WORKSPACE_PROVIDER, value: choiceAnalytics },
  },
  workspaceAgentDefaults: {
    field: "workspaceAgentDefaults",
    default: undefined,
    guard: workspaceAgentDefaults,
    entry: {
      // Local Conductor is deliberately not a key: its creation link
      // documents no agent choice, so no entry could ever steer one.
      isKey: (
        value: UnparsedWireValue,
      ): value is ProviderId | typeof SUPERSET_WORKSPACE_PROVIDER_ID =>
        isWireString(value) && (value === SUPERSET_WORKSPACE_PROVIDER_ID || isProviderId(value)),
      same: (
        current: WorkspaceAgentSelection | WorkspaceAgentKindSelection | undefined,
        next: WorkspaceAgentSelection | WorkspaceAgentKindSelection | undefined,
      ) =>
        current?.agent === next?.agent &&
        current?.model === next?.model &&
        current?.effort === next?.effort,
    },
    settingsPage: SETTINGS_PAGE.CONNECTIONS,
    guideEntry: settingGuideEntry(
      "workspaceAgentDefaults",
      [
        APP_SETTING_ID.WORKSPACE_AGENT_MODEL,
        APP_SETTING_ID.WORKSPACE_AGENT_EFFORT,
        APP_SETTING_ID.SUPERSET_AGENT,
      ],
      (settings) => {
        const defaults = guideValue<WorkspaceAgentDefaults | undefined>(
          settings,
          "workspaceAgentDefaults",
        );
        const chosen = defaults?.[PROVIDER_ID.CONDUCTOR];
        const supersetAgent = defaults?.[SUPERSET_WORKSPACE_PROVIDER_ID]?.agent;
        const chosenAgent = chosen
          ? workspaceAgentModels(PROVIDER_ID.CONDUCTOR).find(
              (entry) => entry.agent === chosen.agent,
            )
          : undefined;
        return [
          {
            id: APP_SETTING_ID.WORKSPACE_AGENT_MODEL,
            label: "New Conductor agents run",
            description:
              "Which model a Conductor workspace or agent created through Luke starts with. Unset, " +
              "Conductor's own defaults decide. An effort the model's agent documents may be named " +
              "in the same change.",
            kind: APP_SETTING_KIND.CHOICE,
            value: chosen
              ? workspaceAgentModelLabel(PROVIDER_ID.CONDUCTOR, chosen)
              : CONDUCTOR_DEFAULT_CHOICE,
            choices: [
              CONDUCTOR_DEFAULT_CHOICE,
              ...workspaceAgentModels(PROVIDER_ID.CONDUCTOR).flatMap((entry) =>
                entry.models.map((model) => model.label),
              ),
            ],
            efforts: Object.fromEntries(
              workspaceAgentModels(PROVIDER_ID.CONDUCTOR).flatMap((entry) =>
                entry.efforts.length > 0
                  ? entry.models.map((model) => [model.label, entry.efforts] as const)
                  : [],
              ),
            ),
            defaultValue: CONDUCTOR_DEFAULT_CHOICE,
            adjustable: true,
            manual: CONDUCTOR_ROW_PATH,
          },
          ...(chosen && chosenAgent && chosenAgent.efforts.length > 0
            ? [
                {
                  id: APP_SETTING_ID.WORKSPACE_AGENT_EFFORT,
                  label: "New Conductor agents' effort",
                  description:
                    "How hard the chosen model thinks. Unset, Conductor's own default decides.",
                  kind: APP_SETTING_KIND.CHOICE,
                  value: chosen.effort ?? CONDUCTOR_DEFAULT_CHOICE,
                  choices: [CONDUCTOR_DEFAULT_CHOICE, ...chosenAgent.efforts],
                  defaultValue: CONDUCTOR_DEFAULT_CHOICE,
                  adjustable: true,
                  manual: CONDUCTOR_ROW_PATH,
                },
              ]
            : []),
          {
            id: APP_SETTING_ID.SUPERSET_AGENT,
            label: "New Superset sessions run",
            description:
              "Which configured Superset agent starts when a creation ask names none. Unset, Luke asks which agent to use.",
            kind: APP_SETTING_KIND.CHOICE,
            value: supersetAgent ?? ASK_EACH_TIME_CHOICE,
            choices: [ASK_EACH_TIME_CHOICE, ...(supersetAgent ? [supersetAgent] : [])],
            defaultValue: ASK_EACH_TIME_CHOICE,
            adjustable: false,
            manual: `${CONNECTIONS_PAGE}, under Superset`,
          },
        ];
      },
    ),
    mainProcessSideEffect: SETTING_SIDE_EFFECT.NONE,
    // Every entry rides one stored write, so one id counts them all.
    analytics: { id: APP_SETTING_ID.WORKSPACE_AGENT_MODEL, value: choiceAnalytics },
  },
  workspaceProjectDefaults: {
    field: "workspaceProjectDefaults",
    default: undefined,
    guard: workspaceProjectDefaults,
    entry: {
      isKey: (value: UnparsedWireValue): value is WorkspaceProviderId =>
        isWireString(value) && isWorkspaceProviderId(value),
      same: (current: string | undefined, next: string | undefined) => current === next,
    },
    settingsPage: SETTINGS_PAGE.CONNECTIONS,
    resetScope: SETTINGS_RESET_SCOPE.WORKSPACES,
    // Observed project names and defaults travel in the workspace-project context.
    guideEntry: settingGuideEntry("workspaceProjectDefaults", [], () => undefined),
    mainProcessSideEffect: SETTING_SIDE_EFFECT.NONE,
  },
} as const;

type GuardValue<Definition> = Definition extends {
  guard(value: UnparsedWireValue): SettingGuardResult<infer Value>;
}
  ? Value
  : never;

export type AppSettingField = keyof typeof APP_SETTING_SCHEMA;
export type AppSettingValue<Field extends AppSettingField> = GuardValue<
  (typeof APP_SETTING_SCHEMA)[Field]
>;
export type StoredAppSettings = {
  [Field in AppSettingField as undefined extends AppSettingValue<Field>
    ? never
    : Field]: AppSettingValue<Field>;
} & {
  [Field in AppSettingField as undefined extends AppSettingValue<Field>
    ? Field
    : never]?: AppSettingValue<Field>;
};

export const APP_SETTING_FIELDS = Object.keys(APP_SETTING_SCHEMA).filter(
  (field): field is AppSettingField => field in APP_SETTING_SCHEMA,
);

export function isAppSettingField(value: UnparsedWireValue): value is AppSettingField {
  return isWireString(value) && value in APP_SETTING_SCHEMA;
}

/** The settings whose value is a map, and so can be written one entry at a time. */
export type KeyedAppSettingField = {
  [Field in AppSettingField]: "entry" extends keyof (typeof APP_SETTING_SCHEMA)[Field]
    ? Field
    : never;
}[AppSettingField];

export function isKeyedAppSettingField(value: UnparsedWireValue): value is KeyedAppSettingField {
  return isAppSettingField(value) && "entry" in APP_SETTING_SCHEMA[value];
}

function settingEntry(field: KeyedAppSettingField): SettingEntryDefinition<never> {
  // SAFETY: KeyedAppSettingField is derived only from schema members that declare `entry`.
  return (APP_SETTING_SCHEMA[field] as { entry: SettingEntryDefinition<never> }).entry;
}

export function isSettingEntryKey(
  field: KeyedAppSettingField,
  key: UnparsedWireValue,
): key is string {
  return settingEntry(field).isKey(key);
}

export function sameSettingEntry(
  field: KeyedAppSettingField,
  current: UnparsedWireValue,
  next: UnparsedWireValue,
): boolean {
  // SAFETY: The selected entry definition owns both values; `never` erases the keyed union.
  return settingEntry(field).same(current as never, next as never);
}

/**
 * Validates one entry by running the field's own whole-map guard over a map
 * holding only that entry: an entry the guard drops is one the map would have
 * dropped, so the two readings of what is valid cannot drift apart. Clearing an
 * entry carries no value to check.
 */
export function settingEntryGuard(
  field: KeyedAppSettingField,
  key: string,
  value: UnparsedWireValue,
): SettingGuardResult<unknown> {
  if (value === undefined) return { valid: true, value: undefined };
  const parsed = APP_SETTING_SCHEMA[field].guard({ [key]: value });
  // SAFETY: The guard validated the map; indexing recovers the single entry under test.
  const kept = parsed.valid ? (parsed.value as WireRecord | undefined)?.[key] : undefined;
  return kept === undefined ? { valid: false, value: undefined } : { valid: true, value: kept };
}

export function isSettingsResetScope(value: UnparsedWireValue): value is SettingsResetScope {
  return Object.values(SETTINGS_RESET_SCOPE).some((scope) => scope === value);
}

export function settingFieldForGuideId(id: string): AppSettingField | undefined {
  return APP_SETTING_FIELDS.find((field) => APP_SETTING_SCHEMA[field].guideEntry.ids.includes(id));
}

function isGuideSettingList(
  value: AppGuideSetting | readonly AppGuideSetting[],
): value is readonly AppGuideSetting[] {
  return Array.isArray(value);
}

export function settingGuideEntries(
  settings: Pick<StoredAppSettings, AppSettingField>,
): AppGuideSetting[] {
  const guideSettings: AppSettingGuideSettings = (field) =>
    isAppSettingField(field) ? settings[field] : undefined;
  return APP_SETTING_FIELDS.flatMap((field) => {
    const definition = APP_SETTING_SCHEMA[field];
    // SAFETY: The default and builder belong to the same schema definition selected by `field`.
    const entry = definition.guideEntry.build(guideSettings, definition.default as never);
    if (entry === undefined) return [];
    return isGuideSettingList(entry) ? entry : [entry];
  });
}

export function spokenSettingValue<Field extends AppSettingField>(
  field: Field,
  value: string,
): AppSettingValue<Field> | undefined {
  const definition = APP_SETTING_SCHEMA[field];
  // SAFETY: spokenValue exists only on fields that declare it; the branch narrows the union.
  const convert = ("spokenValue" in definition ? definition.spokenValue : undefined) as
    | ((candidate: string) => AppSettingValue<Field>)
    | undefined;
  return convert?.(value);
}

/** What a counted setting change reports: which setting, and the shape of its new value. */
export interface SettingAnalytics {
  id: AppSettingId;
  value: ProductSettingValue;
}

/**
 * How a change to this field is counted, or nothing for a field the schema
 * does not count. The value itself never travels — only whether a switch went
 * on or off, or whether a choice was made or returned to nothing.
 */
export function settingAnalytics(
  field: AppSettingField,
  settings: Pick<StoredAppSettings, AppSettingField>,
): SettingAnalytics | undefined {
  const definition = APP_SETTING_SCHEMA[field];
  if (!("analytics" in definition)) return undefined;
  // SAFETY: analytics exists only on fields that declare it; the branch narrows the union.
  const analytics = definition.analytics as {
    id: AppSettingId;
    value: (value: StoredSettingValue) => ProductSettingValue;
  };
  return { id: analytics.id, value: analytics.value(settings[field]) };
}

const appSettingDefaults = Object.fromEntries(
  APP_SETTING_FIELDS.map((field) => [field, APP_SETTING_SCHEMA[field].default]),
);
type AppSettingDefaults = {
  readonly [Field in AppSettingField]: (typeof APP_SETTING_SCHEMA)[Field]["default"];
};

function typedAppSettingDefaults(): AppSettingDefaults {
  // SAFETY: Each field is paired with the default declared by its own schema entry.
  return appSettingDefaults as AppSettingDefaults;
}

export const APP_SETTING_DEFAULTS = typedAppSettingDefaults();

export const SETTING_PAGE = {
  // SAFETY: Each entry maps one settings id to the page its schema declares;
  // the `satisfies` below is what checks the set ends up complete.
  ...(Object.fromEntries(
    Object.values(APP_SETTING_SCHEMA).flatMap((definition) =>
      definition.guideEntry.ids.map((id) => [id, definition.settingsPage]),
    ),
  ) as Record<AppSettingId, SettingsPage>),
  // Which calendars count is chosen on the rows themselves rather than
  // through a settings field, so it is the one id whose page cannot be
  // derived from the schema. Named here so the `Record` stays total.
  [APP_SETTING_ID.CALENDAR_SELECTED]: SETTINGS_PAGE.CONNECTIONS,
} satisfies Record<AppSettingId, SettingsPage>;

export function settingsScopeChanged(
  settings: Pick<StoredAppSettings, AppSettingField>,
  scope: SettingsResetScope,
): boolean {
  return APP_SETTING_FIELDS.some((field) => {
    const definition = APP_SETTING_SCHEMA[field];
    if (!("resetScope" in definition) || definition.resetScope !== scope) return false;
    const current = settings[field];
    const defaultValue = definition.default;
    if (current === undefined || defaultValue === undefined) return current !== defaultValue;
    return current !== defaultValue;
  });
}
