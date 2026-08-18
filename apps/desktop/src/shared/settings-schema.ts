import {
  APP_TOGGLE_VALUE,
  DEFAULT_PANEL_FORM_FACTOR,
  isPanelFormFactor,
  isProviderId,
  isRealtimeVoice,
  isRealtimeVoiceSpeed,
  type PanelFormFactor,
  type ProviderId,
  REALTIME_DEFAULTS,
  type RealtimeVoice,
  type RealtimeVoiceSpeed,
  type WorkspaceAgentSelection,
} from "@sidecar/core";
import { parseVoiceHotkey } from "./voice-hotkey";
import { isWorkspaceAgentSelection } from "./workspace-agents";

export const APP_SETTING_ID = {
  VOICE: "voice",
  VOICE_SPEED: "voice_speed",
  VOICE_CAPTIONS: "voice_captions",
  DUCK_OTHER_MEDIA: "duck_other_media",
  PREFER_BUILT_IN_MICROPHONE: "prefer_built_in_microphone",
  QUIET_DURING_MEETINGS: "quiet_during_meetings",
  SHOW_IN_DOCK: "show_in_dock",
  SHOW_ON_ALL_DISPLAYS: "show_on_all_displays",
  FORM_FACTOR: "form_factor",
  DEFAULT_WORKSPACE_PROVIDER: "default_workspace_provider",
  WORKSPACE_AGENT_MODEL: "workspace_agent_model",
  WORKSPACE_AGENT_EFFORT: "workspace_agent_effort",
  VOICE_SOURCE: "voice_source",
} as const;

export type AppSettingId = (typeof APP_SETTING_ID)[keyof typeof APP_SETTING_ID];

export const VOICE_SOURCE = {
  ACCOUNT: "account",
  KEY: "key",
} as const;

export type VoiceSource = (typeof VOICE_SOURCE)[keyof typeof VOICE_SOURCE];

export function isVoiceSource(value: unknown): value is VoiceSource {
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
} as const;

export type SettingSideEffect = (typeof SETTING_SIDE_EFFECT)[keyof typeof SETTING_SIDE_EFFECT];

export interface StoredAppSettings {
  showInDock: boolean;
  voice?: RealtimeVoice;
  voiceSpeed?: RealtimeVoiceSpeed;
  voiceCaptions: boolean;
  voiceHotkey?: string;
  askHotkey?: string;
  stopHotkey?: string;
  duckOtherMedia: boolean;
  voiceSource?: VoiceSource;
  preferBuiltInMicrophone: boolean;
  quietDuringMeetings: boolean;
  showOnAllDisplays: boolean;
  formFactor?: PanelFormFactor;
  defaultWorkspaceProvider?: ProviderId;
  workspaceAgentDefaults?: Readonly<Partial<Record<ProviderId, WorkspaceAgentSelection>>>;
  workspaceProjectDefaults?: Readonly<Partial<Record<ProviderId, string>>>;
}

export type AppSettingField = keyof StoredAppSettings;
export type AppSettingValue<Field extends AppSettingField> = StoredAppSettings[Field];

export interface SettingGuardResult<Value> {
  valid: boolean;
  value: Value;
}

interface SettingDefinition<Field extends AppSettingField> {
  field: Field;
  default: AppSettingValue<Field>;
  guard(value: unknown): SettingGuardResult<AppSettingValue<Field>>;
  settingsPage: SettingsPage;
  resetScope?: SettingsResetScope;
  guideEntry: AppSettingId | readonly AppSettingId[] | undefined;
  mainProcessSideEffect: SettingSideEffect;
  spokenValue?: (value: string) => AppSettingValue<Field> | undefined;
}

const valid = <Value>(value: Value): SettingGuardResult<Value> => ({ valid: true, value });
const invalid = <Value>(value: Value): SettingGuardResult<Value> => ({ valid: false, value });

function optional<Value>(
  value: unknown,
  guard: (candidate: unknown) => candidate is Value,
): SettingGuardResult<Value | undefined> {
  if (value === undefined) return valid(undefined);
  return guard(value) ? valid(value) : invalid(undefined);
}

function boolean(defaultValue: boolean) {
  return (value: unknown): SettingGuardResult<boolean> =>
    typeof value === "boolean" ? valid(value) : invalid(defaultValue);
}

function hotkey(value: unknown): SettingGuardResult<string | undefined> {
  if (value === undefined) return valid(undefined);
  if (typeof value !== "string") return invalid(undefined);
  const parsed = parseVoiceHotkey(value);
  return parsed ? valid(parsed) : invalid(undefined);
}

function workspaceAgentDefaults(
  value: unknown,
): SettingGuardResult<StoredAppSettings["workspaceAgentDefaults"]> {
  if (value === undefined) return valid(undefined);
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return invalid(undefined);
  }
  const defaults: Partial<Record<ProviderId, WorkspaceAgentSelection>> = {};
  for (const [providerId, selection] of Object.entries(value)) {
    if (!isProviderId(providerId) || !isWorkspaceAgentSelection(providerId, selection)) continue;
    defaults[providerId] = selection;
  }
  return valid(Object.keys(defaults).length > 0 ? defaults : undefined);
}

const MAXIMUM_WORKSPACE_PROJECT_ID_LENGTH = 200;

function workspaceProjectDefaults(
  value: unknown,
): SettingGuardResult<StoredAppSettings["workspaceProjectDefaults"]> {
  if (value === undefined) return valid(undefined);
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return invalid(undefined);
  }
  const defaults: Partial<Record<ProviderId, string>> = {};
  for (const [providerId, candidate] of Object.entries(value)) {
    if (!isProviderId(providerId) || typeof candidate !== "string") continue;
    const providerProjectId = candidate.trim();
    if (!providerProjectId || providerProjectId.length > MAXIMUM_WORKSPACE_PROJECT_ID_LENGTH) {
      continue;
    }
    defaults[providerId] = providerProjectId;
  }
  return valid(Object.keys(defaults).length > 0 ? defaults : undefined);
}

export const APP_SETTING_SCHEMA = {
  showInDock: {
    field: "showInDock",
    default: false,
    guard: boolean(false),
    settingsPage: SETTINGS_PAGE.APPEARANCE,
    resetScope: SETTINGS_RESET_SCOPE.APPEARANCE,
    guideEntry: APP_SETTING_ID.SHOW_IN_DOCK,
    mainProcessSideEffect: SETTING_SIDE_EFFECT.DOCK,
    spokenValue: (value: string) => value === APP_TOGGLE_VALUE.ON,
  },
  voice: {
    field: "voice",
    default: REALTIME_DEFAULTS.VOICE,
    guard: (value: unknown) => optional(value, isRealtimeVoice),
    settingsPage: SETTINGS_PAGE.VOICE,
    resetScope: SETTINGS_RESET_SCOPE.VOICE,
    guideEntry: APP_SETTING_ID.VOICE,
    mainProcessSideEffect: SETTING_SIDE_EFFECT.VOICE,
    spokenValue: (value: string) => (isRealtimeVoice(value) ? value : undefined),
  },
  voiceSpeed: {
    field: "voiceSpeed",
    default: REALTIME_DEFAULTS.SPEED,
    guard: (value: unknown) => optional(value, isRealtimeVoiceSpeed),
    settingsPage: SETTINGS_PAGE.VOICE,
    resetScope: SETTINGS_RESET_SCOPE.VOICE,
    guideEntry: APP_SETTING_ID.VOICE_SPEED,
    mainProcessSideEffect: SETTING_SIDE_EFFECT.VOICE_SPEED,
    spokenValue: (value: string) => {
      const words: Record<string, RealtimeVoiceSpeed> = {
        slow: 0.75,
        normal: 1,
        quick: 1.25,
        fast: 1.5,
        "0.75×": 0.75,
        "1×": 1,
        "1.25×": 1.25,
        "1.5×": 1.5,
      };
      return words[value];
    },
  },
  voiceCaptions: {
    field: "voiceCaptions",
    default: false,
    guard: boolean(false),
    settingsPage: SETTINGS_PAGE.VOICE,
    resetScope: SETTINGS_RESET_SCOPE.VOICE,
    guideEntry: APP_SETTING_ID.VOICE_CAPTIONS,
    mainProcessSideEffect: SETTING_SIDE_EFFECT.NONE,
    spokenValue: (value: string) => value === APP_TOGGLE_VALUE.ON,
  },
  voiceHotkey: {
    field: "voiceHotkey",
    default: undefined,
    guard: hotkey,
    settingsPage: SETTINGS_PAGE.SHORTCUTS,
    resetScope: SETTINGS_RESET_SCOPE.SHORTCUTS,
    guideEntry: undefined,
    mainProcessSideEffect: SETTING_SIDE_EFFECT.TALK_HOTKEY,
  },
  askHotkey: {
    field: "askHotkey",
    default: undefined,
    guard: hotkey,
    settingsPage: SETTINGS_PAGE.SHORTCUTS,
    resetScope: SETTINGS_RESET_SCOPE.SHORTCUTS,
    guideEntry: undefined,
    mainProcessSideEffect: SETTING_SIDE_EFFECT.ASK_HOTKEY,
  },
  stopHotkey: {
    field: "stopHotkey",
    default: undefined,
    guard: hotkey,
    settingsPage: SETTINGS_PAGE.SHORTCUTS,
    resetScope: SETTINGS_RESET_SCOPE.SHORTCUTS,
    guideEntry: undefined,
    mainProcessSideEffect: SETTING_SIDE_EFFECT.STOP_HOTKEY,
  },
  duckOtherMedia: {
    field: "duckOtherMedia",
    default: true,
    guard: boolean(true),
    settingsPage: SETTINGS_PAGE.VOICE,
    resetScope: SETTINGS_RESET_SCOPE.VOICE,
    guideEntry: APP_SETTING_ID.DUCK_OTHER_MEDIA,
    mainProcessSideEffect: SETTING_SIDE_EFFECT.MEDIA_DUCK,
    spokenValue: (value: string) => value === APP_TOGGLE_VALUE.ON,
  },
  voiceSource: {
    field: "voiceSource",
    default: undefined,
    guard: (value: unknown) => optional(value, isVoiceSource),
    settingsPage: SETTINGS_PAGE.ROOT,
    guideEntry: APP_SETTING_ID.VOICE_SOURCE,
    mainProcessSideEffect: SETTING_SIDE_EFFECT.VOICE_SOURCE,
  },
  preferBuiltInMicrophone: {
    field: "preferBuiltInMicrophone",
    default: true,
    guard: boolean(true),
    settingsPage: SETTINGS_PAGE.VOICE,
    resetScope: SETTINGS_RESET_SCOPE.VOICE,
    guideEntry: APP_SETTING_ID.PREFER_BUILT_IN_MICROPHONE,
    mainProcessSideEffect: SETTING_SIDE_EFFECT.NONE,
    spokenValue: (value: string) => value === APP_TOGGLE_VALUE.ON,
  },
  quietDuringMeetings: {
    field: "quietDuringMeetings",
    default: true,
    guard: boolean(true),
    settingsPage: SETTINGS_PAGE.CONNECTIONS,
    guideEntry: APP_SETTING_ID.QUIET_DURING_MEETINGS,
    mainProcessSideEffect: SETTING_SIDE_EFFECT.MEETING_QUIET,
    spokenValue: (value: string) => value === APP_TOGGLE_VALUE.ON,
  },
  showOnAllDisplays: {
    field: "showOnAllDisplays",
    default: false,
    guard: boolean(false),
    settingsPage: SETTINGS_PAGE.APPEARANCE,
    resetScope: SETTINGS_RESET_SCOPE.APPEARANCE,
    guideEntry: APP_SETTING_ID.SHOW_ON_ALL_DISPLAYS,
    mainProcessSideEffect: SETTING_SIDE_EFFECT.DISPLAYS,
    spokenValue: (value: string) => value === APP_TOGGLE_VALUE.ON,
  },
  formFactor: {
    field: "formFactor",
    default: DEFAULT_PANEL_FORM_FACTOR,
    guard: (value: unknown) => optional(value, isPanelFormFactor),
    settingsPage: SETTINGS_PAGE.APPEARANCE,
    resetScope: SETTINGS_RESET_SCOPE.APPEARANCE,
    guideEntry: APP_SETTING_ID.FORM_FACTOR,
    mainProcessSideEffect: SETTING_SIDE_EFFECT.FORM_FACTOR,
    spokenValue: (value: string) => (isPanelFormFactor(value) ? value : undefined),
  },
  defaultWorkspaceProvider: {
    field: "defaultWorkspaceProvider",
    default: undefined,
    guard: (value: unknown) =>
      optional(
        value,
        (candidate): candidate is ProviderId =>
          typeof candidate === "string" && isProviderId(candidate),
      ),
    settingsPage: SETTINGS_PAGE.CONNECTIONS,
    resetScope: SETTINGS_RESET_SCOPE.WORKSPACES,
    guideEntry: APP_SETTING_ID.DEFAULT_WORKSPACE_PROVIDER,
    mainProcessSideEffect: SETTING_SIDE_EFFECT.NONE,
  },
  workspaceAgentDefaults: {
    field: "workspaceAgentDefaults",
    default: undefined,
    guard: workspaceAgentDefaults,
    settingsPage: SETTINGS_PAGE.CONNECTIONS,
    guideEntry: [APP_SETTING_ID.WORKSPACE_AGENT_MODEL, APP_SETTING_ID.WORKSPACE_AGENT_EFFORT],
    mainProcessSideEffect: SETTING_SIDE_EFFECT.NONE,
  },
  workspaceProjectDefaults: {
    field: "workspaceProjectDefaults",
    default: undefined,
    guard: workspaceProjectDefaults,
    settingsPage: SETTINGS_PAGE.CONNECTIONS,
    resetScope: SETTINGS_RESET_SCOPE.WORKSPACES,
    guideEntry: undefined,
    mainProcessSideEffect: SETTING_SIDE_EFFECT.NONE,
  },
} as const satisfies {
  [Field in AppSettingField]: SettingDefinition<Field>;
};

export const APP_SETTING_FIELDS = Object.keys(APP_SETTING_SCHEMA) as AppSettingField[];

export function isAppSettingField(value: unknown): value is AppSettingField {
  return typeof value === "string" && value in APP_SETTING_SCHEMA;
}

export function isSettingsResetScope(value: unknown): value is SettingsResetScope {
  return Object.values(SETTINGS_RESET_SCOPE).includes(value as SettingsResetScope);
}

export function isAppSettingId(value: string): value is AppSettingId {
  return Object.values(APP_SETTING_ID).includes(value as AppSettingId);
}

export function settingFieldForGuideId(id: AppSettingId): AppSettingField | undefined {
  return APP_SETTING_FIELDS.find((field) => {
    const entry = APP_SETTING_SCHEMA[field].guideEntry;
    return Array.isArray(entry) ? entry.includes(id) : entry === id;
  });
}

export function spokenSettingValue(
  field: AppSettingField,
  value: string,
): StoredAppSettings[AppSettingField] {
  const definition = APP_SETTING_SCHEMA[field];
  const convert = ("spokenValue" in definition ? definition.spokenValue : undefined) as
    | ((candidate: string) => StoredAppSettings[AppSettingField])
    | undefined;
  return convert?.(value);
}

export const APP_SETTING_DEFAULTS = {
  showInDock: APP_SETTING_SCHEMA.showInDock.default,
  voice: REALTIME_DEFAULTS.VOICE,
  voiceSpeed: REALTIME_DEFAULTS.SPEED,
  voiceCaptions: APP_SETTING_SCHEMA.voiceCaptions.default,
  duckOtherMedia: APP_SETTING_SCHEMA.duckOtherMedia.default,
  preferBuiltInMicrophone: APP_SETTING_SCHEMA.preferBuiltInMicrophone.default,
  quietDuringMeetings: APP_SETTING_SCHEMA.quietDuringMeetings.default,
  showOnAllDisplays: APP_SETTING_SCHEMA.showOnAllDisplays.default,
  formFactor: DEFAULT_PANEL_FORM_FACTOR,
} as const;

export const SETTING_PAGE = Object.fromEntries(
  Object.values(APP_SETTING_SCHEMA).flatMap((definition) => {
    const entries = definition.guideEntry;
    if (entries === undefined) return [];
    return (Array.isArray(entries) ? entries : [entries]).map((id) => [
      id,
      definition.settingsPage,
    ]);
  }),
) as Record<AppSettingId, SettingsPage>;

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
