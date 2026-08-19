import {
  APP_SETTING_KIND,
  APP_TOGGLE_VALUE,
  type AppGuideSetting,
  appToggleText,
  DEFAULT_PANEL_FORM_FACTOR,
  isPanelFormFactor,
  isProviderId,
  isRealtimeVoice,
  isRealtimeVoiceSpeed,
  isRecord,
  isWireString,
  PANEL_FORM_FACTOR_LIST,
  type PanelFormFactor,
  PROVIDER_ID,
  type ProviderId,
  REALTIME_DEFAULTS,
  REALTIME_VOICE_LIST,
  REALTIME_VOICE_SPEED,
  type RealtimeVoice,
  type RealtimeVoiceSpeed,
  type UnparsedWireValue,
  type WireRecord,
  type WorkspaceAgentSelection,
} from "@sidecar/core";
import { CREDENTIAL_PROVIDERS, isCredentialProviderId } from "./credential-providers";
import { parseVoiceHotkey } from "./voice-hotkey";
import {
  isWorkspaceAgentSelection,
  workspaceAgentModelLabel,
  workspaceAgentModels,
} from "./workspace-agents";

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

interface SettingDefinition<Field extends AppSettingField> {
  field: Field;
  default: AppSettingValue<Field>;
  guard(value: UnparsedWireValue): SettingGuardResult<AppSettingValue<Field>>;
  entry?: SettingEntryDefinition<SettingEntryValue<Field>>;
  settingsPage: SettingsPage;
  resetScope?: SettingsResetScope;
  guideEntry: {
    ids: readonly AppSettingId[];
    build(
      settings: AppSettingGuideSettings,
      defaultValue: AppSettingValue<Field>,
    ): AppGuideSetting | readonly AppGuideSetting[] | undefined;
  };
  mainProcessSideEffect: SettingSideEffect;
  spokenValue?: (value: string) => AppSettingValue<Field> | undefined;
}

export type AppSettingGuideSettings = Omit<
  StoredAppSettings,
  "voice" | "voiceSpeed" | "voiceSource" | "formFactor"
> & {
  voice: RealtimeVoice;
  voiceSpeed: RealtimeVoiceSpeed;
  voiceSource: VoiceSource;
  formFactor: PanelFormFactor;
};

const SETTINGS_TAB = "the panel's Settings tab";
const VOICE_PAGE = `${SETTINGS_TAB}, on its Voice page`;
const VOICE_SOURCE_SECTION = `${SETTINGS_TAB}, on its front page, in the What Luke runs on section at the top`;
const APPEARANCE_PAGE = `${SETTINGS_TAB}, on its Appearance page`;
const CONNECTIONS_PAGE = `${SETTINGS_TAB}, on its Connections page`;
const CONDUCTOR_ROW_PATH = `the Conductor row under Cloud Agent API keys, in ${CONNECTIONS_PAGE} — drawn once Conductor is connected`;
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

function voiceSpeedWord(speed: RealtimeVoiceSpeed): string {
  return (
    VOICE_SPEED_WORDS.find((candidate) => candidate.speed === speed)?.word ??
    VOICE_SPEED_WORD.NORMAL
  );
}

function workspaceProviderName(providerId: ProviderId): string {
  if (isCredentialProviderId(providerId)) return CREDENTIAL_PROVIDERS[providerId].displayName;
  // The one workspace-capable provider with no credential row to take a
  // display name from.
  if (providerId === PROVIDER_ID.CODEX) return "Codex";
  return providerId;
}

function settingGuideEntry(
  ids: readonly AppSettingId[],
  build: SettingDefinition<AppSettingField>["guideEntry"]["build"],
): SettingDefinition<AppSettingField>["guideEntry"] {
  return { ids, build };
}

const valid = <Value>(value: Value): SettingGuardResult<Value> => ({ valid: true, value });
const invalid = <Value>(value: Value): SettingGuardResult<Value> => ({ valid: false, value });

function optional<Value>(
  value: UnparsedWireValue,
  guard: (candidate: UnparsedWireValue) => candidate is Value,
): SettingGuardResult<Value | undefined> {
  if (value === undefined) return valid(undefined);
  return guard(value) ? valid(value) : invalid(undefined);
}

function boolean(defaultValue: boolean) {
  return (value: UnparsedWireValue): SettingGuardResult<boolean> =>
    value === true || value === false ? valid(value) : invalid(defaultValue);
}

function hotkey(value: UnparsedWireValue): SettingGuardResult<string | undefined> {
  if (value === undefined) return valid(undefined);
  if (!isWireString(value)) return invalid(undefined);
  const parsed = parseVoiceHotkey(value);
  return parsed ? valid(parsed) : invalid(undefined);
}

function workspaceAgentDefaults(
  value: UnparsedWireValue,
): SettingGuardResult<StoredAppSettings["workspaceAgentDefaults"]> {
  if (value === undefined) return valid(undefined);
  if (!isRecord(value)) {
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
  value: UnparsedWireValue,
): SettingGuardResult<StoredAppSettings["workspaceProjectDefaults"]> {
  if (value === undefined) return valid(undefined);
  if (!isRecord(value)) {
    return invalid(undefined);
  }
  const defaults: Partial<Record<ProviderId, string>> = {};
  for (const [providerId, candidate] of Object.entries(value)) {
    if (!isProviderId(providerId) || !isWireString(candidate)) continue;
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
    guideEntry: settingGuideEntry([APP_SETTING_ID.SHOW_IN_DOCK], (settings, defaultValue) => ({
      id: APP_SETTING_ID.SHOW_IN_DOCK,
      label: "Show Luke in the Dock",
      // SAFETY: The preceding check establishes the asserted contract.
      description: "Whether Luke also stands in the Dock as an app icon.",
      kind: APP_SETTING_KIND.TOGGLE,
      value: appToggleText(settings.showInDock),
      // SAFETY: The preceding check establishes the asserted contract.
      defaultValue: appToggleText(defaultValue as boolean),
      adjustable: true,
      manual: APPEARANCE_PAGE,
    })),
    mainProcessSideEffect: SETTING_SIDE_EFFECT.DOCK,
    spokenValue: (value: string) => value === APP_TOGGLE_VALUE.ON,
  },
  voice: {
    field: "voice",
    default: REALTIME_DEFAULTS.VOICE,
    guard: (value: UnparsedWireValue) => optional(value, isRealtimeVoice),
    settingsPage: SETTINGS_PAGE.VOICE,
    resetScope: SETTINGS_RESET_SCOPE.VOICE,
    guideEntry: settingGuideEntry([APP_SETTING_ID.VOICE], (settings, defaultValue) => ({
      id: APP_SETTING_ID.VOICE,
      label: "Voice",
      description:
        "Which voice Luke speaks with; a change is heard right away — a conversation under way starts afresh in the new voice.",
      kind: APP_SETTING_KIND.CHOICE,
      value: settings.voice,
      // SAFETY: The preceding check establishes the asserted contract.
      defaultValue: defaultValue as RealtimeVoice,
      choices: REALTIME_VOICE_LIST,
      adjustable: true,
      manual: VOICE_PAGE,
    })),
    mainProcessSideEffect: SETTING_SIDE_EFFECT.VOICE,
    spokenValue: (value: string) => (isRealtimeVoice(value) ? value : undefined),
  },
  voiceSpeed: {
    field: "voiceSpeed",
    default: REALTIME_DEFAULTS.SPEED,
    guard: (value: UnparsedWireValue) => optional(value, isRealtimeVoiceSpeed),
    settingsPage: SETTINGS_PAGE.VOICE,
    resetScope: SETTINGS_RESET_SCOPE.VOICE,
    guideEntry: settingGuideEntry([APP_SETTING_ID.VOICE_SPEED], (settings, defaultValue) => ({
      id: APP_SETTING_ID.VOICE_SPEED,
      label: "Speed",
      description:
        "How fast Luke talks — slow is 0.75×, normal 1×, quick 1.25×, fast 1.5× the voice's natural rate, and an ask may use the word or the multiple; a change is heard from the next reply on.",
      kind: APP_SETTING_KIND.CHOICE,
      value: voiceSpeedWord(settings.voiceSpeed),
      // SAFETY: The preceding check establishes the asserted contract.
      defaultValue: voiceSpeedWord(defaultValue as RealtimeVoiceSpeed),
      choices: VOICE_SPEED_WORDS.flatMap((candidate) => [
        candidate.word,
        voiceSpeedMultiple(candidate.speed),
      ]),
      adjustable: true,
      manual: VOICE_PAGE,
    })),
    mainProcessSideEffect: SETTING_SIDE_EFFECT.VOICE_SPEED,
    spokenValue: (value: string) => {
      return VOICE_SPEED_BY_SPOKEN_VALUE[value];
    },
  },
  voiceCaptions: {
    field: "voiceCaptions",
    default: false,
    guard: boolean(false),
    settingsPage: SETTINGS_PAGE.VOICE,
    resetScope: SETTINGS_RESET_SCOPE.VOICE,
    guideEntry: settingGuideEntry([APP_SETTING_ID.VOICE_CAPTIONS], (settings, defaultValue) => ({
      id: APP_SETTING_ID.VOICE_CAPTIONS,
      label: "Captions",
      description:
        "Luke's words on screen while he speaks; nothing is kept. They also appear on their own, " +
        "whatever this says, for a reply answering a typed ask and while the Mac's output is " +
        "muted or at zero.",
      kind: APP_SETTING_KIND.TOGGLE,
      value: appToggleText(settings.voiceCaptions),
      // SAFETY: The preceding check establishes the asserted contract.
      defaultValue: appToggleText(defaultValue as boolean),
      adjustable: true,
      manual: VOICE_PAGE,
    })),
    mainProcessSideEffect: SETTING_SIDE_EFFECT.NONE,
    spokenValue: (value: string) => value === APP_TOGGLE_VALUE.ON,
  },
  voiceHotkey: {
    field: "voiceHotkey",
    default: undefined,
    guard: hotkey,
    settingsPage: SETTINGS_PAGE.SHORTCUTS,
    resetScope: SETTINGS_RESET_SCOPE.SHORTCUTS,
    // The talk-key fact reports the registered chord and its manual path.
    guideEntry: settingGuideEntry([], () => undefined),
    mainProcessSideEffect: SETTING_SIDE_EFFECT.TALK_HOTKEY,
  },
  askHotkey: {
    field: "askHotkey",
    default: undefined,
    guard: hotkey,
    settingsPage: SETTINGS_PAGE.SHORTCUTS,
    resetScope: SETTINGS_RESET_SCOPE.SHORTCUTS,
    // The ask-key fact reports the registered chord and its manual path.
    guideEntry: settingGuideEntry([], () => undefined),
    mainProcessSideEffect: SETTING_SIDE_EFFECT.ASK_HOTKEY,
  },
  stopHotkey: {
    field: "stopHotkey",
    default: undefined,
    guard: hotkey,
    settingsPage: SETTINGS_PAGE.SHORTCUTS,
    resetScope: SETTINGS_RESET_SCOPE.SHORTCUTS,
    // The stop-key fact reports the registered chord and its manual path.
    guideEntry: settingGuideEntry([], () => undefined),
    mainProcessSideEffect: SETTING_SIDE_EFFECT.STOP_HOTKEY,
  },
  duckOtherMedia: {
    field: "duckOtherMedia",
    default: true,
    guard: boolean(true),
    settingsPage: SETTINGS_PAGE.VOICE,
    resetScope: SETTINGS_RESET_SCOPE.VOICE,
    guideEntry: settingGuideEntry([APP_SETTING_ID.DUCK_OTHER_MEDIA], (settings, defaultValue) => ({
      id: APP_SETTING_ID.DUCK_OTHER_MEDIA,
      label: "Quiet Music and Spotify",
      description:
        "Whether Music and Spotify are turned down while a spoken exchange is live, and back up after.",
      kind: APP_SETTING_KIND.TOGGLE,
      value: appToggleText(settings.duckOtherMedia),
      // SAFETY: The preceding check establishes the asserted contract.
      defaultValue: appToggleText(defaultValue as boolean),
      adjustable: true,
      manual: VOICE_PAGE,
    })),
    mainProcessSideEffect: SETTING_SIDE_EFFECT.MEDIA_DUCK,
    spokenValue: (value: string) => value === APP_TOGGLE_VALUE.ON,
  },
  voiceSource: {
    field: "voiceSource",
    default: undefined,
    guard: (value: UnparsedWireValue) => optional(value, isVoiceSource),
    settingsPage: SETTINGS_PAGE.ROOT,
    guideEntry: settingGuideEntry([APP_SETTING_ID.VOICE_SOURCE], (settings) => ({
      id: APP_SETTING_ID.VOICE_SOURCE,
      label: "What Luke runs on",
      description:
        "Which credential Luke speaks and reviews sessions on: the signed-in Luke account, free " +
        "and metered daily, or the developer's own OpenAI key, unmetered and billed to them by " +
        "OpenAI. A key stays stored either way, so the free allowance can be used without " +
        "deleting it.",
      kind: APP_SETTING_KIND.CHOICE,
      value: VOICE_SOURCE_CHOICE[settings.voiceSource],
      defaultValue: VOICE_SOURCE_CHOICE[VOICE_SOURCE.ACCOUNT],
      choices: Object.values(VOICE_SOURCE_CHOICE),
      adjustable: false,
      manual: VOICE_SOURCE_SECTION,
    })),
    mainProcessSideEffect: SETTING_SIDE_EFFECT.VOICE_SOURCE,
  },
  preferBuiltInMicrophone: {
    field: "preferBuiltInMicrophone",
    default: true,
    guard: boolean(true),
    settingsPage: SETTINGS_PAGE.VOICE,
    resetScope: SETTINGS_RESET_SCOPE.VOICE,
    guideEntry: settingGuideEntry(
      [APP_SETTING_ID.PREFER_BUILT_IN_MICROPHONE],
      (settings, defaultValue) => ({
        id: APP_SETTING_ID.PREFER_BUILT_IN_MICROPHONE,
        label: "Prefer the Mac's microphone",
        description:
          "Whether Luke listens through the Mac's own microphone when the system input is a " +
          "Bluetooth headset, so the headset keeps its full music quality. A shut lid keeps the " +
          "headset's microphone either way.",
        kind: APP_SETTING_KIND.TOGGLE,
        value: appToggleText(settings.preferBuiltInMicrophone),
        // SAFETY: The preceding check establishes the asserted contract.
        defaultValue: appToggleText(defaultValue as boolean),
        adjustable: true,
        manual: VOICE_PAGE,
      }),
    ),
    mainProcessSideEffect: SETTING_SIDE_EFFECT.NONE,
    spokenValue: (value: string) => value === APP_TOGGLE_VALUE.ON,
  },
  quietDuringMeetings: {
    field: "quietDuringMeetings",
    default: true,
    guard: boolean(true),
    settingsPage: SETTINGS_PAGE.CONNECTIONS,
    guideEntry: settingGuideEntry(
      [APP_SETTING_ID.QUIET_DURING_MEETINGS],
      (settings, defaultValue) => ({
        id: APP_SETTING_ID.QUIET_DURING_MEETINGS,
        label: "Quiet during meetings",
        description:
          "Whether spoken announcements wait while a connected calendar shows a meeting on, and are read out together once it ends. Switched on during a meeting it takes hold at once, cutting off an announcement mid-sentence. It changes nothing until a Google Calendar account is connected.",
        kind: APP_SETTING_KIND.TOGGLE,
        value: appToggleText(settings.quietDuringMeetings),
        // SAFETY: The preceding check establishes the asserted contract.
        defaultValue: appToggleText(defaultValue as boolean),
        adjustable: true,
        manual: `${CONNECTIONS_PAGE} — drawn once a calendar account is connected`,
      }),
    ),
    mainProcessSideEffect: SETTING_SIDE_EFFECT.MEETING_QUIET,
    spokenValue: (value: string) => value === APP_TOGGLE_VALUE.ON,
  },
  showOnAllDisplays: {
    field: "showOnAllDisplays",
    default: false,
    guard: boolean(false),
    settingsPage: SETTINGS_PAGE.APPEARANCE,
    resetScope: SETTINGS_RESET_SCOPE.APPEARANCE,
    guideEntry: settingGuideEntry(
      [APP_SETTING_ID.SHOW_ON_ALL_DISPLAYS],
      (settings, defaultValue) => ({
        id: APP_SETTING_ID.SHOW_ON_ALL_DISPLAYS,
        label: "Show Luke on all displays",
        description:
          "Whether Luke stands on every connected display at once; off keeps him to the main display alone.",
        kind: APP_SETTING_KIND.TOGGLE,
        value: appToggleText(settings.showOnAllDisplays),
        // SAFETY: The preceding check establishes the asserted contract.
        defaultValue: appToggleText(defaultValue as boolean),
        adjustable: true,
        manual: APPEARANCE_PAGE,
      }),
    ),
    mainProcessSideEffect: SETTING_SIDE_EFFECT.DISPLAYS,
    spokenValue: (value: string) => value === APP_TOGGLE_VALUE.ON,
  },
  formFactor: {
    field: "formFactor",
    default: DEFAULT_PANEL_FORM_FACTOR,
    guard: (value: UnparsedWireValue) => optional(value, isPanelFormFactor),
    settingsPage: SETTINGS_PAGE.APPEARANCE,
    resetScope: SETTINGS_RESET_SCOPE.APPEARANCE,
    guideEntry: settingGuideEntry([APP_SETTING_ID.FORM_FACTOR], (settings, defaultValue) => ({
      id: APP_SETTING_ID.FORM_FACTOR,
      label: "Form factor",
      description:
        "How Luke stands on a display without a camera housing — notch draws him one pressed into the top edge, bubble floats him just under it. A display with a real notch ignores this.",
      kind: APP_SETTING_KIND.CHOICE,
      value: settings.formFactor,
      // SAFETY: The preceding check establishes the asserted contract.
      defaultValue: defaultValue as PanelFormFactor,
      choices: PANEL_FORM_FACTOR_LIST,
      adjustable: true,
      manual: APPEARANCE_PAGE,
    })),
    mainProcessSideEffect: SETTING_SIDE_EFFECT.FORM_FACTOR,
    spokenValue: (value: string) => (isPanelFormFactor(value) ? value : undefined),
  },
  defaultWorkspaceProvider: {
    field: "defaultWorkspaceProvider",
    default: undefined,
    guard: (value: UnparsedWireValue) =>
      optional(
        value,
        (candidate): candidate is ProviderId => isWireString(candidate) && isProviderId(candidate),
      ),
    settingsPage: SETTINGS_PAGE.CONNECTIONS,
    resetScope: SETTINGS_RESET_SCOPE.WORKSPACES,
    guideEntry: settingGuideEntry([APP_SETTING_ID.DEFAULT_WORKSPACE_PROVIDER], (settings) => ({
      id: APP_SETTING_ID.DEFAULT_WORKSPACE_PROVIDER,
      label: "Default workspace provider",
      description:
        "Which provider a conversational ask creates a new workspace in when the ask names none. " +
        "Until one is chosen Luke asks when more than one provider could take it, and the first " +
        // SAFETY: The preceding check establishes the asserted contract.
        "workspace created saves its provider as the default.",
      kind: APP_SETTING_KIND.CHOICE,
      value: settings.defaultWorkspaceProvider
        ? workspaceProviderName(settings.defaultWorkspaceProvider)
        : ASK_EACH_TIME_CHOICE,
      choices: [
        ASK_EACH_TIME_CHOICE,
        workspaceProviderName(PROVIDER_ID.CODEX),
        workspaceProviderName(PROVIDER_ID.CONDUCTOR),
        workspaceProviderName(PROVIDER_ID.CURSOR),
      ],
      defaultValue: ASK_EACH_TIME_CHOICE,
      adjustable: false,
      manual: `${CONNECTIONS_PAGE}, under Workspaces`,
    })),
    mainProcessSideEffect: SETTING_SIDE_EFFECT.NONE,
  },
  workspaceAgentDefaults: {
    field: "workspaceAgentDefaults",
    default: undefined,
    guard: workspaceAgentDefaults,
    entry: {
      isKey: isProviderId,
      same: (current, next) =>
        current?.agent === next?.agent &&
        current?.model === next?.model &&
        current?.effort === next?.effort,
    },
    settingsPage: SETTINGS_PAGE.CONNECTIONS,
    guideEntry: settingGuideEntry(
      [APP_SETTING_ID.WORKSPACE_AGENT_MODEL, APP_SETTING_ID.WORKSPACE_AGENT_EFFORT],
      (settings) => {
        const chosen = settings.workspaceAgentDefaults?.[PROVIDER_ID.CONDUCTOR];
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
        ];
      },
    ),
    mainProcessSideEffect: SETTING_SIDE_EFFECT.NONE,
  },
  workspaceProjectDefaults: {
    field: "workspaceProjectDefaults",
    default: undefined,
    guard: workspaceProjectDefaults,
    entry: {
      isKey: isProviderId,
      same: (current, next) => current === next,
    },
    settingsPage: SETTINGS_PAGE.CONNECTIONS,
    resetScope: SETTINGS_RESET_SCOPE.WORKSPACES,
    // Observed project names and defaults travel in the workspace-project context.
    guideEntry: settingGuideEntry([], () => undefined),
    mainProcessSideEffect: SETTING_SIDE_EFFECT.NONE,
  },
} as const satisfies {
  [Field in AppSettingField]: SettingDefinition<Field>;
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
  // SAFETY: The preceding check establishes the asserted contract.
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
  // SAFETY: The preceding check establishes the asserted contract.
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
  // SAFETY: The preceding check establishes the asserted contract.
  return Object.values(SETTINGS_RESET_SCOPE).includes(value as SettingsResetScope);
}

export function isAppSettingId(value: string): value is AppSettingId {
  // SAFETY: The preceding check establishes the asserted contract.
  return Object.values(APP_SETTING_ID).includes(value as AppSettingId);
}

export function settingFieldForGuideId(id: AppSettingId): AppSettingField | undefined {
  return APP_SETTING_FIELDS.find((field) => APP_SETTING_SCHEMA[field].guideEntry.ids.includes(id));
}

export function settingGuideEntries(settings: AppSettingGuideSettings): AppGuideSetting[] {
  return APP_SETTING_FIELDS.flatMap((field) => {
    const definition = APP_SETTING_SCHEMA[field];
    const entry = definition.guideEntry.build(settings, definition.default);
    if (entry === undefined) return [];
    // SAFETY: The preceding check establishes the asserted contract.
    return Array.isArray(entry) ? entry : [entry as AppGuideSetting];
  });
}

export function spokenSettingValue(
  field: AppSettingField,
  value: string,
): StoredAppSettings[AppSettingField] {
  const definition = APP_SETTING_SCHEMA[field];
  // SAFETY: spokenValue exists only on fields that declare it; the branch narrows the union.
  const convert = ("spokenValue" in definition ? definition.spokenValue : undefined) as
    | ((candidate: string) => StoredAppSettings[AppSettingField])
    | undefined;
  return convert?.(value);
}

export const APP_SETTING_DEFAULTS = Object.fromEntries(
  APP_SETTING_FIELDS.map((field) => [field, APP_SETTING_SCHEMA[field].default]),
) satisfies {
  readonly [Field in AppSettingField]: (typeof APP_SETTING_SCHEMA)[Field]["default"];
};

export const SETTING_PAGE = Object.fromEntries(
  Object.values(APP_SETTING_SCHEMA).flatMap((definition) => {
    return definition.guideEntry.ids.map((id) => [id, definition.settingsPage]);
  }),
) satisfies Record<AppSettingId, SettingsPage>;

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
