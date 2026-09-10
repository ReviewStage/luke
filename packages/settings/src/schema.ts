import {
  CREDENTIAL_PROVIDER_ID,
  CREDENTIAL_PROVIDERS,
  CREDENTIAL_SOURCE,
  isCredentialProviderId,
} from "@sidecar/credentials/vocabulary";
import {
  APP_SETTING_ID,
  APP_SETTING_KIND,
  type AppSettingId,
  isAppSettingId,
} from "@sidecar/guide";
import { isLiveVoice, LIVE_DEFAULTS, LIVE_VOICE_LIST, type LiveVoice } from "@sidecar/live";
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
import { isRecord, isWireString, type UnparsedWireValue } from "@sidecar/wire";
import {
  choiceAnalytics,
  choiceSetting,
  hotkeySetting,
  keyedSetting,
  optional,
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
import {
  APPEARANCE_PAGE,
  ASK_EACH_TIME_CHOICE,
  CONDUCTOR_DEFAULT_CHOICE,
  CONDUCTOR_ROW_PATH,
  CONNECTIONS_PAGE,
  VOICE_PAGE,
  VOICE_SOURCE_SECTION,
} from "./settings-paths.js";

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
  type SettingsVisibility,
} from "./schema-types.js";
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

/* The default-workspace row's word for no default at all. An empty value
   rather than a member of the provider set, so no provider id can collide
   with it. */
const NO_WORKSPACE_PROVIDER = "";

const VOICE_SOURCE_CHOICE = {
  [VOICE_SOURCE.ACCOUNT]: "your Luke account",
  [VOICE_SOURCE.KEY]: "your OpenAI key",
} as const satisfies Record<VoiceSource, string>;

/* The API names its voices in lowercase; on a control they read as names. The
   default carries its status into the menu, so returning to it never needs the
   README or a memory of what shipped. */
function voiceOptionLabel(voice: LiveVoice): string {
  const name = voice.charAt(0).toUpperCase() + voice.slice(1);
  return voice === LIVE_DEFAULTS.VOICE ? `${name} (default)` : name;
}

/* The forms read as names, and the bubble carries its status into the menu the
   way the default voice does. */
function formFactorOptionLabel(formFactor: PanelFormFactor): string {
  const name = formFactor.charAt(0).toUpperCase() + formFactor.slice(1);
  return formFactor === DEFAULT_PANEL_FORM_FACTOR ? `${name} (default)` : name;
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

/** Voice available and the microphone granted: the whole of what a control needs. */
const voiceControlDrawn = (view: SettingsVisibility): boolean => view.voiceControlsDrawn;

/**
 * The quiet rides the calendar block, and appears with its first connection —
 * a Google account, or this Mac's own Calendar.
 */
const calendarConnected = (view: SettingsVisibility): boolean =>
  (view.settings.calendarSignInAvailable && view.settings.calendarAccounts.length > 0) ||
  view.settings.appleCalendar !== undefined;

/**
 * The Conductor agent rows belong to a connected provider the build documents
 * a model table for.
 */
const conductorAgentRowDrawn = (view: SettingsVisibility): boolean =>
  view.settings.credentialSources[CREDENTIAL_PROVIDER_ID.CONDUCTOR] !== CREDENTIAL_SOURCE.NONE &&
  workspaceAgentModels(PROVIDER_ID.CONDUCTOR).length > 0;

function workspaceAgentDefaultsGuard(
  value: UnparsedWireValue,
): SettingGuardResult<WorkspaceAgentDefaults | undefined> {
  if (value === undefined) return { valid: true, value: undefined };
  if (!isRecord(value)) {
    return { valid: false, value: undefined };
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
  return { valid: true, value: Object.keys(defaults).length > 0 ? defaults : undefined };
}

/**
 * The stored chips come back only as far as this build still recognizes them:
 * a value that names no place, kind, app, or agent here — another build's
 * vocabulary, or a corrupted file — is dropped rather than held dormant, a
 * repeated value narrows no further than its first, and a selection left with
 * nothing reads as unset, which is the unnarrowed list.
 */
function sessionFiltersGuard(
  value: UnparsedWireValue,
): SettingGuardResult<readonly SessionFilter[] | undefined> {
  if (value === undefined) return { valid: true, value: undefined };
  if (!Array.isArray(value)) return { valid: false, value: undefined };
  const filters: SessionFilter[] = [];
  for (const candidate of value) {
    if (!isWireString(candidate) || !isSessionFilter(candidate)) continue;
    if (filters.includes(candidate)) continue;
    filters.push(candidate);
  }
  return { valid: true, value: filters.length > 0 ? filters : undefined };
}

const MAXIMUM_SESSION_SEARCH_QUERY_LENGTH = 500;

/**
 * The stored words come back exactly as typed, because the field they refill
 * is the developer's own text. Only a value that could not be a held search
 * reads as unset instead: words that are all whitespace narrow nothing, and a
 * value past any typeable length is a corrupted file rather than a question
 * someone is still asking.
 */
function sessionSearchQueryGuard(value: UnparsedWireValue): SettingGuardResult<string | undefined> {
  if (value === undefined) return { valid: true, value: undefined };
  if (!isWireString(value)) return { valid: false, value: undefined };
  if (value.trim() === "" || value.length > MAXIMUM_SESSION_SEARCH_QUERY_LENGTH) {
    return { valid: true, value: undefined };
  }
  return { valid: true, value };
}

const MAXIMUM_WORKSPACE_PROJECT_ID_LENGTH = 500;

function workspaceProjectDefaultsGuard(
  value: UnparsedWireValue,
): SettingGuardResult<Readonly<Partial<Record<WorkspaceProviderId, string>>> | undefined> {
  if (value === undefined) return { valid: true, value: undefined };
  if (!isRecord(value)) {
    return { valid: false, value: undefined };
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
  return { valid: true, value: Object.keys(defaults).length > 0 ? defaults : undefined };
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
      "Which voice Luke speaks with. A conversation keeps the voice it opened with, so a change is heard from the next conversation on.",
    values: LIVE_VOICE_LIST,
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
      "Luke's words on screen while he speaks; nothing is kept. They also appear on their own, " +
      "whatever this says, for a reply answering a typed ask and while the Mac's output is " +
      "muted or at zero.",
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
  askHotkey: hotkeySetting({
    field: "askHotkey",
    id: APP_SETTING_ID.ASK_HOTKEY,
    order: 70,
    sideEffect: SETTING_SIDE_EFFECT.ASK_HOTKEY,
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
  voiceSource: choiceSetting({
    field: "voiceSource",
    id: APP_SETTING_ID.VOICE_SOURCE,
    label: "Provider",
    description:
      "Which credential Luke speaks and reviews sessions on: the signed-in Luke account " +
      "or the developer's own OpenAI key. A key stays stored either way.",
    values: [VOICE_SOURCE.ACCOUNT, VOICE_SOURCE.KEY],
    say: (source) => VOICE_SOURCE_CHOICE[source],
    absent: VOICE_SOURCE_CHOICE[VOICE_SOURCE.ACCOUNT],
    guard: (value: UnparsedWireValue) => optional(value, isVoiceSource),
    default: undefined,
    page: SETTINGS_PAGE.VOICE,
    section: SETTING_SECTION.PROVIDER,
    order: 100,
    manual: VOICE_SOURCE_SECTION,
    sideEffect: SETTING_SIDE_EFFECT.VOICE_SOURCE,
    // Drawn by the Provider section's own picker, which is where the way in
    // to a key stands beside the choice of credential.
    rows: SETTING_ROWS.BESPOKE,
    adjustable: false,
    visible: (view) => view.accountDrawn,
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
  announceSessions: toggleSetting({
    field: "announceSessions",
    id: APP_SETTING_ID.ANNOUNCE_SESSIONS,
    label: "Announce when sessions need you",
    description:
      "Whether announcements — a session waiting, stopping on an error, or finishing, and Luke's other unprompted remarks — are spoken as they happen. Switched off, Luke sleeps: announcements are held, then read out together, the still-true ones only, once it is switched back on. Conversations you open still answer aloud either way. Luke's face sleeps for as long as the switch is off.",
    default: true,
    page: SETTINGS_PAGE.VOICE,
    section: SETTING_SECTION.CONTROLS,
    order: 120,
    resetScope: SETTINGS_RESET_SCOPE.VOICE,
    manual: VOICE_PAGE,
    sideEffect: SETTING_SIDE_EFFECT.ANNOUNCEMENT_HOLD,
    adjustable: true,
    visible: voiceControlDrawn,
  }),
  quietDuringMeetings: toggleSetting({
    field: "quietDuringMeetings",
    id: APP_SETTING_ID.QUIET_DURING_MEETINGS,
    label: "Quiet during meetings",
    description:
      "Whether spoken announcements wait while a connected calendar shows a meeting on, then read out together once it ends. Switched on mid-meeting it takes hold at once. It changes nothing until a calendar — a Google Calendar account, or this Mac's Apple Calendar — is connected.",
    default: true,
    page: SETTINGS_PAGE.CONNECTIONS,
    section: SETTING_SECTION.CALENDAR,
    order: 130,
    manual: `${CONNECTIONS_PAGE} — drawn once a calendar is connected`,
    sideEffect: SETTING_SIDE_EFFECT.ANNOUNCEMENT_HOLD,
    adjustable: true,
    visible: calendarConnected,
  }),
  syncProviderKeys: toggleSetting({
    field: "syncProviderKeys",
    id: APP_SETTING_ID.SYNC_PROVIDER_KEYS,
    label: "Sync provider keys",
    description:
      "Whether provider API keys are also stored, encrypted, with Luke's own service for the account's other Luke devices. While on, the keys stored here are kept synced: a key saved while signed in syncs in the same press, and Luke re-syncs the stored keys when he starts signed in, at a sign-in, and when the switch turns on — automatically only for the account they were last synced for; another account signing in syncs nothing until it saves a key or flips the switch itself. Turning it off deletes every synced copy while the keys on this Mac stay. The service never sends a key back.",
    default: true,
    page: SETTINGS_PAGE.CONNECTIONS,
    section: SETTING_SECTION.SYNC,
    order: 140,
    manual: `${CONNECTIONS_PAGE}, in its Sync section`,
    sideEffect: SETTING_SIDE_EFFECT.VAULT_SYNC,
    // Not adjustable by a spoken ask, deliberately: flipping it moves
    // credentials to and from Luke's service, and a credential action is
    // taken by hand alone.
    adjustable: false,
  }),
  showOnAllDisplays: toggleSetting({
    field: "showOnAllDisplays",
    id: APP_SETTING_ID.SHOW_ON_ALL_DISPLAYS,
    label: "Show Luke on all displays",
    description:
      "Whether Luke stands on every connected display at once; off keeps him to the main display alone.",
    default: false,
    page: SETTINGS_PAGE.APPEARANCE,
    order: 150,
    resetScope: SETTINGS_RESET_SCOPE.APPEARANCE,
    manual: APPEARANCE_PAGE,
    sideEffect: SETTING_SIDE_EFFECT.DISPLAYS,
    adjustable: true,
  }),
  formFactor: choiceSetting({
    field: "formFactor",
    id: APP_SETTING_ID.FORM_FACTOR,
    label: "Form factor",
    description:
      "How Luke stands on a display without a camera housing — notch draws him one pressed into the top edge, bubble floats him just under it. A display with a real notch ignores this.",
    values: PANEL_FORM_FACTOR_LIST,
    say: (formFactor) => formFactor,
    optionLabel: formFactorOptionLabel,
    guard: (value: UnparsedWireValue) => optional(value, isPanelFormFactor),
    default: DEFAULT_PANEL_FORM_FACTOR,
    page: SETTINGS_PAGE.APPEARANCE,
    order: 160,
    resetScope: SETTINGS_RESET_SCOPE.APPEARANCE,
    manual: APPEARANCE_PAGE,
    sideEffect: SETTING_SIDE_EFFECT.FORM_FACTOR,
    adjustable: true,
  }),
  sessionFilters: storedSetting({
    field: "sessionFilters",
    default: undefined,
    guard: sessionFiltersGuard,
    // The selection is the session list's own view state, stored so the chips
    // survive the panel closing and the app restarting; the root page is named
    // only because a definition must name one.
    page: SETTINGS_PAGE.ROOT,
    section: SETTING_SECTION.MAIN,
    order: 170,
    sideEffect: SETTING_SIDE_EFFECT.NONE,
    rows: SETTING_ROWS.NONE,
    // The guide covers narrowing the list through the session-filter facts and
    // the spoken filter tool's own vocabulary; the stored selection is what
    // those already changed, not a setting of its own to describe.
    ids: [],
    guide: () => undefined,
  }),
  sessionSearchQuery: storedSetting({
    field: "sessionSearchQuery",
    default: undefined,
    guard: sessionSearchQueryGuard,
    page: SETTINGS_PAGE.ROOT,
    section: SETTING_SECTION.MAIN,
    order: 180,
    sideEffect: SETTING_SIDE_EFFECT.NONE,
    rows: SETTING_ROWS.NONE,
    // The guide covers searching through the session-search facts and the
    // spoken search tool's own vocabulary. No analytics either: the value is
    // the developer's own text, which never travels.
    ids: [],
    guide: () => undefined,
  }),
  defaultWorkspaceProvider: storedSetting({
    field: "defaultWorkspaceProvider",
    default: undefined,
    guard: (value: UnparsedWireValue) =>
      optional(
        value,
        (candidate): candidate is WorkspaceProviderId =>
          isWireString(candidate) && isWorkspaceProviderId(candidate),
      ),
    page: SETTINGS_PAGE.CONNECTIONS,
    section: SETTING_SECTION.WORKSPACES,
    order: 190,
    resetScope: SETTINGS_RESET_SCOPE.WORKSPACES,
    sideEffect: SETTING_SIDE_EFFECT.NONE,
    rows: SETTING_ROWS.SCHEMA,
    ids: [APP_SETTING_ID.DEFAULT_WORKSPACE_PROVIDER],
    guide: (settings) => {
      const stored = settings("defaultWorkspaceProvider");
      return {
        id: APP_SETTING_ID.DEFAULT_WORKSPACE_PROVIDER,
        label: "Default workspace provider",
        description:
          "Which provider a conversational ask creates a new workspace in when the ask names none. " +
          "Until one is chosen Luke asks when more than one provider could take it, and the first " +
          "workspace created saves its provider as the default.",
        kind: APP_SETTING_KIND.CHOICE,
        // SAFETY: The field's own guard is what put a provider id in the store.
        value: stored ? workspaceProviderName(stored as WorkspaceProviderId) : ASK_EACH_TIME_CHOICE,
        choices: [
          ASK_EACH_TIME_CHOICE,
          workspaceProviderName(PROVIDER_ID.CODEX),
          // Both Conductors, or the guide would read the stored cloud
          // default's plain "Conductor" as the only Conductor there is.
          workspaceProviderName(PROVIDER_ID.CONDUCTOR),
          workspaceProviderName(CONDUCTOR_LOCAL_WORKSPACE_PROVIDER_ID),
          "Superset",
        ],
        defaultValue: ASK_EACH_TIME_CHOICE,
        adjustable: false,
        manual: `${CONNECTIONS_PAGE}, under Workspaces`,
      };
    },
    // The providers it chooses between are the ones the observation reported,
    // so the row can offer nothing that was not seen — and the set is the one
    // it offered, so anything else arriving out of the select is a broken
    // control rather than a choice.
    control: {
      value: (stored) => stored ?? NO_WORKSPACE_PROVIDER,
      options: (view) => [
        { value: NO_WORKSPACE_PROVIDER, label: "Ask each time" },
        ...view.workspaceProviders.map((provider) => ({
          value: provider.id,
          label: provider.name,
        })),
      ],
      stored: (token, view) =>
        view.workspaceProviders.find((provider) => provider.id === token)?.id,
    },
    analytics: { value: choiceAnalytics },
  }),
  workspaceAgentDefaults: keyedSetting({
    field: "workspaceAgentDefaults",
    default: undefined,
    guard: workspaceAgentDefaultsGuard,
    page: SETTINGS_PAGE.CONNECTIONS,
    section: SETTING_SECTION.PROVIDERS,
    order: 200,
    sideEffect: SETTING_SIDE_EFFECT.NONE,
    // Drawn by `WorkspaceAgentRow`, whose options are a provider's own
    // documented model table rather than a set the build fixes here.
    rows: SETTING_ROWS.BESPOKE,
    ids: [
      APP_SETTING_ID.WORKSPACE_AGENT_MODEL,
      APP_SETTING_ID.WORKSPACE_AGENT_EFFORT,
      APP_SETTING_ID.SUPERSET_AGENT,
    ],
    guide: (settings) => {
      // SAFETY: The field's own guard is what put these defaults in the store.
      const defaults = settings("workspaceAgentDefaults") as WorkspaceAgentDefaults | undefined;
      const chosen = defaults?.[PROVIDER_ID.CONDUCTOR];
      const supersetAgent = defaults?.[SUPERSET_WORKSPACE_PROVIDER_ID]?.agent;
      const chosenAgent = chosen
        ? workspaceAgentModels(PROVIDER_ID.CONDUCTOR).find((entry) => entry.agent === chosen.agent)
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
    // Three rows under three different conditions, so the field answers per
    // id rather than as one row that is drawn or not.
    visibleById: {
      [APP_SETTING_ID.WORKSPACE_AGENT_MODEL]: conductorAgentRowDrawn,
      [APP_SETTING_ID.WORKSPACE_AGENT_EFFORT]: conductorAgentRowDrawn,
      [APP_SETTING_ID.SUPERSET_AGENT]: (view) =>
        view.superset.connected && view.superset.agents.length > 0,
    },
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
    // Every entry rides one stored write, so one id counts them all.
    analytics: { value: choiceAnalytics },
  }),
  workspaceProjectDefaults: keyedSetting({
    field: "workspaceProjectDefaults",
    default: undefined,
    guard: workspaceProjectDefaultsGuard,
    page: SETTINGS_PAGE.CONNECTIONS,
    section: SETTING_SECTION.PROVIDERS,
    order: 210,
    resetScope: SETTINGS_RESET_SCOPE.WORKSPACES,
    sideEffect: SETTING_SIDE_EFFECT.NONE,
    // Drawn by `WorkspaceProjectRow`, one per provider, from the projects that
    // provider's own observation reported.
    rows: SETTING_ROWS.BESPOKE,
    // Observed project names and defaults travel in the workspace-project context.
    ids: [],
    guide: () => undefined,
    entry: {
      isKey: (value: UnparsedWireValue): value is WorkspaceProviderId =>
        isWireString(value) && isWorkspaceProviderId(value),
      same: (current: string | undefined, next: string | undefined) => current === next,
    },
  }),
} as const;
