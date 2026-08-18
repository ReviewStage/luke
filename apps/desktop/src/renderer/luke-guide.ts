/**
 * Luke's knowledge of himself, in one place.
 *
 * Everything the voice conversation may know about the app — what Luke is on
 * screen, every setting with its current value and its default, and where
 * each is changed by hand — is assembled here into the `AppGuideSnapshot` the
 * conversation is sent. A feature this file does not describe is one Luke
 * will deny having, and a setting it does not mark changeable is one no
 * spoken ask can touch, so adding either to the app means adding it here in
 * the same change.
 *
 * The settings half is compile-enforced: `SETTING_GUIDE` is a `Record` over
 * every key of `AppSettings`, so a new settings field does not build until a
 * decision is written down — a spoken entry, or `undefined` with a comment
 * saying how the guide covers it instead. The facts have no such lever, which
 * is why the agent guide states the rule in words.
 *
 * Nothing here may carry a credential, a key's shape, or any part of one:
 * the guide says whether a provider is connected, and no more.
 */

import {
  APP_SETTING_KIND,
  APP_TOGGLE_VALUE,
  type AppGuideFact,
  type AppGuideSetting,
  type AppGuideSnapshot,
  appToggleText,
  DEFAULT_PANEL_FORM_FACTOR,
  isPanelFormFactor,
  isRealtimeVoice,
  PANEL_FORM_FACTOR_LIST,
  PROVIDER_ID,
  type ProviderId,
  REALTIME_DEFAULTS,
  REALTIME_VOICE_LIST,
  REALTIME_VOICE_SPEED,
  type RealtimeVoiceSpeed,
  type WorkspaceAgentSelection,
} from "@sidecar/core";
import type {
  AccountSnapshot,
  AppBridge,
  AppSettings,
  CredentialSource,
  MicrophoneStatus,
  VoiceSource,
} from "../shared/contracts";
import {
  ACCOUNT_PROVIDER,
  ACCOUNT_STATUS,
  APP_SETTING_DEFAULTS,
  CREDENTIAL_SOURCE,
  SECRET_STORAGE,
  VOICE_SOURCE,
} from "../shared/contracts";
import {
  CLOUD_AGENT_PROVIDER_LIST,
  CREDENTIAL_PROVIDERS,
  INTEGRATION_PROVIDER_LIST,
  isCredentialProviderId,
  VOICE_CREDENTIAL_PROVIDER_ID,
} from "../shared/credential-providers";
import { workspaceAgentModelLabel, workspaceAgentModels } from "../shared/workspace-agents";

/** The ids a spoken change names Luke's settings by. */
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

const APP_SETTING_ID_LIST: readonly AppSettingId[] = Object.values(APP_SETTING_ID);

/**
 * Whether an id read back off a guide entry is one of Luke's own settings. A
 * guide entry carries its id as plain text — the snapshot is data on its way
 * out to a conversation — so anything reading one back has to ask.
 */
export function isAppSettingId(value: string): value is AppSettingId {
  return APP_SETTING_ID_LIST.includes(value as AppSettingId);
}

/** Where the switches live, said once so every entry words it the same way. */
const SETTINGS_TAB = "the panel's Settings tab";

/* The tab's front page opens pages, and each setting is changed by hand on
   one of them — so every by-hand path names its page, worded once each. */
const VOICE_PAGE = `${SETTINGS_TAB}, on its Voice page`;
/** Where the allowance meters and the OpenAI key row both live. */
const VOICE_SOURCE_SECTION = `${SETTINGS_TAB}, on its front page, in the What Luke runs on section at the top`;
/** Where the signed-in identity and the two ways out of it live. */
const ACCOUNT_SECTION = `the Account section, at the foot of ${SETTINGS_TAB}'s front page`;
const APPEARANCE_PAGE = `${SETTINGS_TAB}, on its Appearance page`;
const SHORTCUTS_PAGE = `${SETTINGS_TAB}, on its Keyboard shortcuts page`;
const CONNECTIONS_PAGE = `${SETTINGS_TAB}, on its Connections page`;
/* Where the Updates section stands, for the fact that describes it. */
const FRONT_PAGE = `${SETTINGS_TAB}, on its front page`;

/** Where the Conductor agent choices live, said once for both their entries. */
const CONDUCTOR_ROW_PATH = `the Conductor row under Cloud Agent API keys, in ${CONNECTIONS_PAGE} — drawn once Conductor is connected`;

/**
 * The word both Conductor agent entries use for no choice at all. It is a
 * member of their choices on purpose: saying it is how a spoken ask returns a
 * half to Conductor's own default.
 */
const CONDUCTOR_DEFAULT_CHOICE = "Conductor's default";

/**
 * The provider entry's word for no default at all, the same words its row
 * offers: while nothing is chosen, Luke asks which provider each time.
 */
const ASK_EACH_TIME_CHOICE = "ask each time";

/**
 * How the two sources are named in the guide — the toggle's own words, minus
 * the price tag beside them, because a spoken value is read aloud and "(you
 * pay)" is a label rather than a name.
 */
const VOICE_SOURCE_CHOICE: Record<VoiceSource, string> = {
  [VOICE_SOURCE.ACCOUNT]: "your Luke account",
  [VOICE_SOURCE.KEY]: "your OpenAI key",
};

/**
 * The words a pace is asked for in, slowest to fastest, each paired with the
 * multiple it means. A conversation offers both spellings: the word because
 * "quick" survives speech where "1.25×" does not, and the multiple because it
 * is the label the settings row shows, so it is the name a reader of the row
 * will ask by.
 */
const VOICE_SPEED_WORDS: readonly { word: string; speed: RealtimeVoiceSpeed }[] = [
  { word: "slow", speed: REALTIME_VOICE_SPEED.SLOW },
  { word: "normal", speed: REALTIME_VOICE_SPEED.NORMAL },
  { word: "quick", speed: REALTIME_VOICE_SPEED.QUICK },
  { word: "fast", speed: REALTIME_VOICE_SPEED.FAST },
];

/** A pace spelt the way its settings row labels it. */
function voiceSpeedMultiple(speed: RealtimeVoiceSpeed): string {
  return `${speed}×`;
}

function voiceSpeedWord(speed: RealtimeVoiceSpeed): string {
  return VOICE_SPEED_WORDS.find((candidate) => candidate.speed === speed)?.word ?? "normal";
}

function voiceSpeedFromWord(word: string): RealtimeVoiceSpeed | undefined {
  return VOICE_SPEED_WORDS.find(
    (candidate) => candidate.word === word || voiceSpeedMultiple(candidate.speed) === word,
  )?.speed;
}

/** The name a provider is known by on its rows, falling back to its id. */
function workspaceProviderName(providerId: ProviderId): string {
  return isCredentialProviderId(providerId)
    ? CREDENTIAL_PROVIDERS[providerId].displayName
    : providerId;
}

/**
 * One guide entry per settings field — or several, where one stored value is
 * spoken of as more than one choice — or an explicit nothing. Exhaustive over
 * `AppSettings` on purpose: this `Record` failing to compile is how a new
 * setting is prevented from shipping unknown to Luke.
 */
const SETTING_GUIDE: Record<
  keyof AppSettings,
  (settings: AppSettings) => AppGuideSetting | readonly AppGuideSetting[] | undefined
> = {
  voice: (settings) => ({
    id: APP_SETTING_ID.VOICE,
    label: "Voice",
    description:
      "Which voice Luke speaks with; a change is heard right away — a conversation under way starts afresh in the new voice.",
    kind: APP_SETTING_KIND.CHOICE,
    value: settings.voice,
    defaultValue: REALTIME_DEFAULTS.VOICE,
    choices: REALTIME_VOICE_LIST,
    adjustable: true,
    manual: VOICE_PAGE,
  }),
  voiceSpeed: (settings) => ({
    id: APP_SETTING_ID.VOICE_SPEED,
    label: "Speed",
    description:
      "How fast Luke talks — slow is 0.75×, normal 1×, quick 1.25×, fast 1.5× the voice's natural rate, and an ask may use the word or the multiple; a change is heard from the next reply on.",
    kind: APP_SETTING_KIND.CHOICE,
    value: voiceSpeedWord(settings.voiceSpeed),
    defaultValue: voiceSpeedWord(REALTIME_DEFAULTS.SPEED),
    choices: VOICE_SPEED_WORDS.flatMap((candidate) => [
      candidate.word,
      voiceSpeedMultiple(candidate.speed),
    ]),
    adjustable: true,
    manual: VOICE_PAGE,
  }),
  voiceCaptions: (settings) => ({
    id: APP_SETTING_ID.VOICE_CAPTIONS,
    label: "Captions",
    description:
      "Luke's words on screen while he speaks; nothing is kept. They also appear on their own, " +
      "whatever this says, for a reply answering a typed ask and while the Mac's output is " +
      "muted or at zero.",
    kind: APP_SETTING_KIND.TOGGLE,
    value: appToggleText(settings.voiceCaptions),
    defaultValue: appToggleText(APP_SETTING_DEFAULTS.voiceCaptions),
    adjustable: true,
    manual: VOICE_PAGE,
  }),
  duckOtherMedia: (settings) => ({
    id: APP_SETTING_ID.DUCK_OTHER_MEDIA,
    label: "Quiet Music and Spotify",
    description:
      "Whether Music and Spotify are turned down while a spoken exchange is live, and back up after.",
    kind: APP_SETTING_KIND.TOGGLE,
    value: appToggleText(settings.duckOtherMedia),
    defaultValue: appToggleText(APP_SETTING_DEFAULTS.duckOtherMedia),
    adjustable: true,
    manual: VOICE_PAGE,
  }),
  preferBuiltInMicrophone: (settings) => ({
    id: APP_SETTING_ID.PREFER_BUILT_IN_MICROPHONE,
    label: "Prefer the Mac's microphone",
    description:
      "Whether Luke listens through the Mac's own microphone when the system input is a " +
      "Bluetooth headset, so the headset keeps its full music quality. A shut lid keeps the " +
      "headset's microphone either way.",
    kind: APP_SETTING_KIND.TOGGLE,
    value: appToggleText(settings.preferBuiltInMicrophone),
    defaultValue: appToggleText(APP_SETTING_DEFAULTS.preferBuiltInMicrophone),
    adjustable: true,
    manual: VOICE_PAGE,
  }),
  quietDuringMeetings: (settings) => ({
    id: APP_SETTING_ID.QUIET_DURING_MEETINGS,
    label: "Quiet during meetings",
    description:
      "Whether spoken announcements wait while a connected calendar shows a meeting on, and are read out together once it ends. It changes nothing until a Google Calendar account is connected.",
    kind: APP_SETTING_KIND.TOGGLE,
    value: appToggleText(settings.quietDuringMeetings),
    defaultValue: appToggleText(APP_SETTING_DEFAULTS.quietDuringMeetings),
    adjustable: true,
    manual: `${CONNECTIONS_PAGE} — drawn once a calendar account is connected`,
  }),
  showInDock: (settings) => ({
    id: APP_SETTING_ID.SHOW_IN_DOCK,
    label: "Show Luke in the Dock",
    description: "Whether Luke also stands in the Dock as an app icon.",
    kind: APP_SETTING_KIND.TOGGLE,
    value: appToggleText(settings.showInDock),
    defaultValue: appToggleText(APP_SETTING_DEFAULTS.showInDock),
    adjustable: true,
    manual: APPEARANCE_PAGE,
  }),
  showOnAllDisplays: (settings) => ({
    id: APP_SETTING_ID.SHOW_ON_ALL_DISPLAYS,
    label: "Show Luke on all displays",
    description:
      "Whether Luke stands on every connected display at once; off keeps him to the main display alone.",
    kind: APP_SETTING_KIND.TOGGLE,
    value: appToggleText(settings.showOnAllDisplays),
    defaultValue: appToggleText(APP_SETTING_DEFAULTS.showOnAllDisplays),
    adjustable: true,
    manual: APPEARANCE_PAGE,
  }),
  // One stored value, spoken of as two choices: the model, and — only while a
  // model whose agent documents levels is chosen — its effort, because a
  // level with no model to ride has nowhere documented to go. The model entry
  // also lists the levels each choice takes, so a model and its effort named
  // in one breath are one change riding one call — the only way to set both
  // while nothing is chosen yet, since the effort entry does not exist to be
  // named. Both are changeable by voice, but only at the developer's own
  // naming: the standing instructions forbid asking or suggesting either, so
  // the ask is always theirs to bring up. Conductor is the one provider the
  // build documents a table for; a second provider growing one is the moment
  // this generalizes.
  workspaceAgentDefaults: (settings) => {
    const chosen = settings.workspaceAgentDefaults?.[PROVIDER_ID.CONDUCTOR];
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
        // Said by the name people know the model by, the way its row draws
        // it; the id stays on the wire where only endpoints read it.
        value: chosen
          ? workspaceAgentModelLabel(PROVIDER_ID.CONDUCTOR, chosen)
          : CONDUCTOR_DEFAULT_CHOICE,
        choices: [
          CONDUCTOR_DEFAULT_CHOICE,
          ...workspaceAgentModels(PROVIDER_ID.CONDUCTOR).flatMap((entry) =>
            entry.models.map((model) => model.label),
          ),
        ],
        // Each model's documented levels, keyed by the label the choice is
        // said by, so an effort can ride the model's own change — the guide
        // never lists a level nowhere documented, and a model whose agent
        // takes none is simply absent.
        efforts: Object.fromEntries(
          workspaceAgentModels(PROVIDER_ID.CONDUCTOR).flatMap((entry) =>
            entry.efforts.length > 0
              ? entry.models.map((model) => [model.label, entry.efforts] as const)
              : [],
          ),
        ),
        // The default is itself one of the choices, so an ask to restore it
        // is an ordinary change to the value listed.
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
  // Described but kept by hand: the value's own story is conversational — the
  // first workspace created saves its provider — so a spoken "change it"
  // would shadow the same act the setting exists to record, and the refusal
  // Luke voices carries the by-hand path. The projects context, not this
  // entry, is what steers a live creation ask.
  defaultWorkspaceProvider: (settings) => ({
    id: APP_SETTING_ID.DEFAULT_WORKSPACE_PROVIDER,
    label: "Default workspace provider",
    description:
      "Which provider a conversational ask creates a new workspace in when the ask names none. " +
      "Until one is chosen Luke asks when more than one provider could take it, and the first " +
      "workspace created saves its provider as the default.",
    kind: APP_SETTING_KIND.CHOICE,
    value: settings.defaultWorkspaceProvider
      ? workspaceProviderName(settings.defaultWorkspaceProvider)
      : ASK_EACH_TIME_CHOICE,
    // Descriptive, never a spoken vocabulary — the entry is by-hand-only.
    // The two named providers are the two that document a creation endpoint,
    // the same two the "Creating workspaces" fact names; a third gaining one
    // updates both.
    choices: [
      ASK_EACH_TIME_CHOICE,
      workspaceProviderName(PROVIDER_ID.CONDUCTOR),
      workspaceProviderName(PROVIDER_ID.CURSOR),
    ],
    // Every install starts with no provider chosen: asking each time is the
    // default, and the first creation is what ends it.
    defaultValue: ASK_EACH_TIME_CHOICE,
    adjustable: false,
    manual: `${CONNECTIONS_PAGE}, under Workspaces`,
  }),
  // Described in the workspace projects context instead, for a reason the
  // provider entry does not have: projects are observed rather than
  // build-fixed, so the guide's settings half holds only their ids, while the
  // projects context names each provider's default by the repository a person
  // knows it as. Kept by hand for the provider default's own reason — the
  // first creation in a provider saves its project — and the Creating
  // workspaces fact carries the by-hand path.
  workspaceProjectDefaults: () => undefined,
  formFactor: (settings) => ({
    id: APP_SETTING_ID.FORM_FACTOR,
    label: "Form factor",
    description:
      "How Luke stands on a display without a camera housing — notch draws him one pressed into the top edge, bubble floats him just under it. A display with a real notch ignores this.",
    kind: APP_SETTING_KIND.CHOICE,
    value: settings.formFactor,
    defaultValue: DEFAULT_PANEL_FORM_FACTOR,
    choices: PANEL_FORM_FACTOR_LIST,
    adjustable: true,
    manual: APPEARANCE_PAGE,
  }),
  // Described in the talk-key fact instead, which carries the key that
  // actually registered — this field is only the stored choice, absent on the
  // defaults and silently outbid when another app owns the chord. Not spoken-
  // changeable either way: a chord is recorded by typing it, so the fact says
  // where.
  voiceHotkey: () => undefined,
  // Described in the ask-key fact instead, for exactly the talk key's
  // reasons: the fact carries the key that registered, and a chord is
  // recorded by typing it rather than saying it.
  askHotkey: () => undefined,
  // Described in the stopping-a-reply fact instead, on the same terms as the
  // other two keys' stored choices.
  stopHotkey: () => undefined,
  voiceSource: (settings) => ({
    id: APP_SETTING_ID.VOICE_SOURCE,
    label: "What Luke runs on",
    description:
      "Which credential Luke speaks and reviews sessions on: the signed-in Luke account, free " +
      "and metered daily, or the developer's own OpenAI key, unmetered and billed to them by " +
      "OpenAI. A key stays stored either way, so the free allowance can be used without " +
      "deleting it.",
    kind: APP_SETTING_KIND.CHOICE,
    value: VOICE_SOURCE_CHOICE[settings.voiceSource],
    // Every install begins on the account: the allowance is what a sign-in
    // carries, and a key is something the developer goes and gets.
    defaultValue: VOICE_SOURCE_CHOICE[VOICE_SOURCE.ACCOUNT],
    choices: Object.values(VOICE_SOURCE_CHOICE),
    // By hand only, and deliberately: this is the one switch that decides
    // whose money is spent. It is not a credential, so the guide may describe
    // it — but moving it is the developer's own act on their own bill, and a
    // spoken ask that could start spending their key is exactly the shape of
    // thing the refusal exists for.
    adjustable: false,
    manual: VOICE_SOURCE_SECTION,
  }),
  // Not a switch but a set of keys, so it is described in the facts instead:
  // which providers are connected, and that a key is only ever typed by hand.
  credentialSources: () => undefined,
  // Only worth a word when it has refused a key, which the facts carry.
  secretStorage: () => undefined,
  /* Not a setting: it is whether the OpenAI key resolved, which the credential
     row is where anyone changes. Luke is told whether he can speak at all by
     the voice facts built from `LukeGuideInput.voiceAvailable`, so a spoken
     ask about it is already answered without a settings entry to adjust. */
  voiceAvailable: () => undefined,
  /* Not a setting either: whether this build carries the OAuth client the
     Google Calendar sign-in runs on. The integrations fact says whether the
     calendar is connected, which is the question anyone actually asks. */
  calendarSignInAvailable: () => undefined,
  /* Connections rather than settings: accounts are signed into and
     disconnected on their own rows, and which calendars count is chosen
     there too. The integrations fact carries the counts; nothing here is a
     value a spoken change could set. */
  calendarAccounts: () => undefined,
};

/** What the guide needs from the app to describe the current state of it. */
export interface LukeGuideInput {
  /** Optional only for pure callers that predate accounts; the app always supplies it. */
  account?: AccountSnapshot;
  settings: AppSettings;
  /** Whether a Realtime credential can be minted at all. */
  voiceAvailable: boolean;
  microphoneStatus: MicrophoneStatus;
  /**
   * The talk key labelled the way macOS writes it, absent when none was
   * registered. Labelled rather than drawn as keys: the guide is spoken and
   * read, and a chord said aloud is one thing to press.
   */
  hotkey: { hotkey?: string; held: boolean };
  /** The ask key labelled on the same terms, absent when none was registered. */
  askKey?: string;
  /**
   * The stop key labelled on the same terms, absent when none was registered
   * — another app owns Option-S, or another Luke key was moved onto it.
   */
  stopKey?: string;
}

function talkKeyFact(hotkey: LukeGuideInput["hotkey"]): AppGuideFact {
  if (!hotkey.hotkey) {
    return {
      label: "Talk key",
      detail:
        "None is registered right now — another app may own the shortcut. The Settings tab's Keyboard shortcuts page shows its state.",
    };
  }
  const use = hotkey.held
    ? "hold to talk, let go to send; tap instead to keep the turn open"
    : "press to talk, again to send, again to interrupt";
  return {
    label: "Talk key",
    detail: `${hotkey.hotkey}, from any app: ${use}. A different chord can be recorded, or the default restored, in ${SHORTCUTS_PAGE}.`,
  };
}

function askKeyFact(askKey: string | undefined): AppGuideFact {
  if (!askKey) {
    return {
      label: "Ask key",
      detail:
        "None is registered right now — another app may own the shortcut, or voice is off. The Settings tab's Keyboard shortcuts page shows its state.",
    };
  }
  return {
    label: "Ask key",
    detail:
      `${askKey}, from any app: summons the panel with the caret in the typed composer, and the ` +
      `same press puts it away. A different chord can be recorded, or the default restored, in ${SHORTCUTS_PAGE}.`,
  };
}

const MICROPHONE_DETAIL: Record<MicrophoneStatus, string> = {
  granted:
    "Granted. The microphone opens only when the talk key takes a turn, sends nothing after " +
    "the key comes up, and closes once the exchange settles. Typing to Luke never opens it. " +
    "Which device it opens is the Prefer the Mac's microphone setting's to say.",
  denied:
    "Denied. It can only be granted back in System Settings, under Privacy & Security, Microphone.",
  restricted: "Restricted by a system policy, which only the system's manager can change.",
  "not-determined":
    "Not asked yet. The Permissions section on the Settings tab's Voice page can ask while voice is available — a signed-in account includes it, and an OpenAI key also provides it.",
  unknown: "Unknown. The Permissions section on the Settings tab's Voice page shows its state.",
};

/** The same three answers a credential row gives, in words a fact can carry. */
function connectionWord(source: CredentialSource): string {
  return source === CREDENTIAL_SOURCE.NONE
    ? "not connected"
    : source === CREDENTIAL_SOURCE.ENVIRONMENT
      ? "connected from the environment"
      : "connected";
}

function providersFact(settings: AppSettings): AppGuideFact {
  const roster = CLOUD_AGENT_PROVIDER_LIST.map(
    (provider) =>
      `${provider.displayName} (${connectionWord(settings.credentialSources[provider.id])})`,
  );
  return {
    label: "Cloud providers",
    detail:
      `${roster.join(", ")}. Connecting one takes the key its row names, typed by hand into ` +
      `${CONNECTIONS_PAGE}, under Cloud Agent API keys — never spoken, and never repeated back. ` +
      "Local providers such as Claude Code need no key and are observed on their own.",
  };
}

function integrationsFact(settings: AppSettings): AppGuideFact {
  const roster = INTEGRATION_PROVIDER_LIST.map(
    (provider) =>
      `${provider.displayName} (${connectionWord(settings.credentialSources[provider.id])})`,
  );
  // The calendar is an integration too, connected by sign-in rather than by a
  // key — and only a build carrying the sign-in offers it at all, so a build
  // without one says nothing rather than describing a row that is not drawn.
  const accounts = settings.calendarAccounts.length;
  const calendar = !settings.calendarSignInAvailable
    ? ""
    : accounts === 0
      ? " Google Calendar (not connected) connects by signing in with Google from its row. " +
        "Connecting it lets Luke read only when meetings start and end — never their titles " +
        "or who attends — so announcements can wait out a meeting."
      : ` Google Calendar (${accounts === 1 ? "1 account" : `${accounts} accounts`} connected) ` +
        "reads only when meetings start and end — never their titles or who attends. Which " +
        "calendars count is chosen with the checkboxes under each account, and more accounts " +
        "can be added from the same row.";
  return {
    label: "Integrations",
    detail:
      `${roster.join(", ")}. Connecting Linear lets Luke read the developer's issues and, only ` +
      `when asked in a turn the developer opened, move or comment on one. Its key is typed by ` +
      `hand into ${CONNECTIONS_PAGE}, under Integrations — never spoken, and never repeated ` +
      `back.${calendar}`,
  };
}

/**
 * The one key that is neither an agent's nor an integration's, described where
 * its row lives: at the top of the Voice page, beside the feature it turns on.
 */
function voiceKeyFact(settings: AppSettings, voiceAvailable: boolean): AppGuideFact {
  const openai = CREDENTIAL_PROVIDERS[VOICE_CREDENTIAL_PROVIDER_ID];
  const source = settings.credentialSources[openai.id];
  const hosted = voiceAvailable && source === CREDENTIAL_SOURCE.NONE;
  return {
    label: openai.displayName,
    detail:
      `${openai.displayName} (${connectionWord(source)}). ` +
      (hosted
        ? `Voice and session review run on the signed-in Luke account's daily allowance, free; ` +
          `connecting your own key removes the daily limit and runs them on it instead, billed ` +
          `by OpenAI. `
        : source === CREDENTIAL_SOURCE.NONE
          ? `Signing in — or connecting a key — is what lets Luke speak and review sessions. `
          : `Voice and session review run on this key: no daily limit, nothing through Luke's ` +
            `service, and OpenAI bills you for what you use. `) +
      `The key is typed by hand into ${VOICE_SOURCE_SECTION} — never read from the environment, ` +
      `never spoken, and never repeated back.`,
  };
}

/**
 * Builds the guide from what the app currently knows about itself. Pure and
 * synchronous so the renderer can rebuild it on every settings change and the
 * conversation always describes the app as it is, not as it launched.
 */
export function buildLukeGuide(input: LukeGuideInput): AppGuideSnapshot {
  const account = input.account ?? { status: ACCOUNT_STATUS.SIGNED_OUT };
  const facts: AppGuideFact[] = [
    {
      label: "What Luke is",
      detail:
        "A macOS sidecar living beside the notch. The capsule beside the housing counts the " +
        "sessions the panel lists — the ones still live or recently settled, not every " +
        "conversation on disk; hovering it peeks, pressing it opens the panel, and Escape " +
        "closes what is open. " +
        "Resting the pointer on the face itself earns one trick — most often flying off the strip " +
        "and swooping back — and another only after the pointer leaves and returns; asking the " +
        "system for reduced motion stills the tricks.",
    },
    {
      label: "The panel",
      detail:
        "Two tabs, switched by pressing one or by asking Luke — out loud or typed — to show it; " +
        "asked while the panel is closed, the panel opens on that tab. " +
        "Sessions lists every session that still matters — one that is working or waiting stays " +
        "at any age, a failure stays for three days, and a finished or quiet one for two — " +
        "with its state, narrowable to all, local, " +
        "cloud, or one provider, and orderable by urgency (what needs the developer first) or " +
        "recency (what moved last first) — by its options button, or by the same ask that shows " +
        "the tab. The list is searchable by hand alone: the magnifier beside the options " +
        "button, or Command-F while the panel has the keyboard, opens a field that keeps only " +
        "rows saying every typed word in their title, status line, branch, repository, " +
        "workspace, agent, or model, marks where the words landed, and counts what it left; a " +
        "search that matches nothing says so — offering the matches a filter is hiding rather " +
        "than pretending there are none — Escape clears the query and then closes the field, " +
        "no spoken ask can search, and no search survives the panel closing. " +
        "A row can be opened, messaged, or controlled where its " +
        "provider allows; a session whose provider reported a pull request grows a chip that " +
        "opens it in the browser, titled by the request's own number — #245 — or reading " +
        "Pull request when its address names none; and a row the developer asked Luke to listen for — " +
        "“tell me when this finishes” — wears a small listening mark beside its age, whose hover " +
        "says the ask in the developer's own words. Luke's own composer at the foot of the list " +
        "takes a typed ask — Enter sends it, Shift-Enter breaks the line, and the field grows " +
        "with what it holds. " +
        "Where a provider nests chats in a workspace — Conductor today — each " +
        "chat is its own row: a workspace holding several draws them inside one tray named by " +
        "the workspace at its top, one holding a single chat stays one row titled by the " +
        "workspace, and every chat can be seen, opened, and messaged individually. Settings " +
        "holds a front page led by the What Luke runs on section — a two-way toggle naming the " +
        "signed-in Luke account (free, a daily amount) against the developer's own OpenAI key " +
        "(unmetered, billed by OpenAI), with the live one marked and the other pressable to " +
        "switch: choosing the key with none stored asks for one, and choosing the account " +
        "parks a stored key without deleting it. Under the toggle stands whichever half is " +
        "live, and only that one: on the account, small meters filling with the day's talking " +
        "and announcements and checks on your sessions — blue until the last fifth of either " +
        "is left and amber from there on — when they reset, and a folded How this works " +
        "saying what spends each; on the key, the OpenAI row itself, typed by hand and never " +
        "read from the environment, and a folded How your key is used saying it pays for " +
        "those same two things, straight from the Mac to OpenAI with no daily limit " +
        "— then rows that open its Voice, Appearance, Keyboard " +
        "shortcuts, and Connections pages — each led back out by its back button or Escape — " +
        "and keeps the Feedback section, the Account section, and Quit on the front page " +
        "itself, the account last because signing out and deleting are done once or never; the Voice page " +
        "holds the microphone permission and then the voice settings once voice is available, " +
        "and only a pointer back to What Luke runs on while it is not — and a small " +
        "exclamation mark sits on whatever still needs a hand: the What Luke runs on heading " +
        "while voice has nothing to run on, the front page's Voice row and the microphone row " +
        "while the permission is ungranted, and the Keyboard shortcuts rows while voice is off, " +
        "where each key's chord stays shown and changeable but answers nothing until voice is " +
        "available; the " +
        "Command-comma switches to it while " +
        "the panel has the keyboard. A dot beside a settings row marks a value changed from " +
        "its default, and a page holding one ends its head with a reset, pressed by hand and " +
        "never spoken, that returns that page's settings to their defaults in one act — the " +
        "Workspaces group on the Connections page carries its own reset on its heading, and " +
        "no reset touches a key, an account, or the Conductor agent choice, whose own menu " +
        "already offers Conductor's default. A " +
        "change Luke makes himself is shown as it is made: the panel comes forward on the tab, " +
        "and the page, the change belongs to, and his face leaves the strip beside the housing, " +
        "dives to the control that moved, and floats back.",
    },
    {
      label: "Account",
      detail:
        account.status === ACCOUNT_STATUS.SIGNED_IN
          ? `Signed in as ${account.email} through ${account.provider === ACCOUNT_PROVIDER.GITHUB ? "GitHub" : "Google"}. Sign out by hand from ${ACCOUNT_SECTION} — it asks before acting. The same section's Delete account row erases the account and everything Luke's service holds for it, cannot be undone, and is only ever done by hand — its button asks before acting, and no spoken ask can reach it.`
          : "Not signed in. The sign-in screen greets the launch once with Google and GitHub, then closes like any panel. While signed out the strip beside the housing keeps Luke's face and a small Sign in label in place of the session count, and hovering or pressing it brings the sign-in screen back. Live sessions and Luke's controls stay off until sign-in finishes. Choosing a provider stands the panel down to a small waiting popup with a Cancel button while the browser finishes, and the panel opens itself once the sign-in lands.",
    },
    {
      label: "Feedback and prompts",
      detail:
        "The Feedback section near the foot of the Settings tab, just above Quit, opens a composer under the notch. " +
        "Send feedback is for bugs and ideas; Submit a prompt sends a prompt to a coding agent, and one the founders " +
        "like ships in the next release. Either goes by email to the founders with an optional " +
        "name and email for credit — a fresh note starts them from the signed-in account, and " +
        "both stay free to edit or clear before sending — and up to three screenshots. A spoken ask can open the " +
        "composer and start it with the developer's own words — Luke offers exactly that, once, " +
        "after refusing something he cannot do — but a note already being written is never " +
        "overwritten, and sending is always the Send button's own press, by hand: no spoken ask " +
        "can send one. A landed send is answered in the composer's own shape before the panel " +
        "returns: Luke swoops down beside “Sent — thank you!” and plays a little flourish, a " +
        "different one each send.",
    },
    {
      label: "Reading a session's transcript",
      detail:
        "Asked what a local session did, said, or is stuck on, Luke can read that session's own " +
        "recent transcript — Claude Code, Codex, OpenCode, and the Devin and Cursor agents " +
        "running on this machine today — and answer from it. Cursor keeps tool outputs out of its own " +
        "transcripts, so those readings carry the words and the calls but no results. " +
        "The reading happens when asked and is kept nowhere; cloud sessions keep their " +
        "conversations with their provider, so Luke answers about those from their roster " +
        "fields alone.",
    },
    {
      label: "Creating workspaces",
      detail:
        "Where a connected provider documents a creation endpoint — Conductor and Cursor today — " +
        "an ask in conversation, spoken or typed, can create a new workspace in one of the " +
        "projects that provider reports, optionally under a name the developer chose, and can " +
        "hand the new agent an opening task in the developer's own words where the project takes " +
        "one. A bare ask for a new agent lands here: only an ask that itself names the existing " +
        "workspace or session the agent should join adds one beside it instead. Only reported " +
        "projects can be named, a project that needs a task cannot be created " +
        "without one, and a provider that reports none takes no ask. An ask that names no " +
        "provider goes to the default workspace provider; until one is chosen Luke asks when " +
        "more than one provider could take it, and the first workspace created saves its " +
        "provider as the default — changed or cleared by hand in the Settings tab. An ask that " +
        "names no project goes the same way: each provider remembers a default project, filled " +
        "in by the first workspace created there and changed or cleared by hand on the " +
        "Connections page, under Workspaces; until one is chosen Luke asks when the provider " +
        "lists more than one project. What a new " +
        "Conductor agent runs — its model, and its effort where the model's agent takes one — " +
        "follows the choice on the Conductor row under Cloud Agent API keys, or Conductor's own " +
        "defaults while none is made. A model named in a creation ask rides that creation alone " +
        "and is saved as the default only while none is chosen; the settings themselves change " +
        "only when the developer asks for that, and Luke never asks or suggests a model. A " +
        "workspace that lands opens on the developer's screen by itself: the moment observation " +
        "reports the new session with an address, that address is handed to the operating " +
        "system, the same as pressing the session's row. One whose provider reports no address " +
        "stays on its row, unopened.",
    },
    {
      label: "Adding agents to a workspace",
      detail:
        "Where a session's provider documents it — Conductor today — the same kind of ask can " +
        "start another agent in the workspace an observed session runs in, as one of the agent " +
        "kinds that session's roster entry lists, optionally named and optionally with an " +
        "opening task. The ask must name that workspace or session in its own words; a bare " +
        "ask for a new agent creates a new workspace instead. A model named in the ask — with an effort where its agent takes one — " +
        "rides that agent alone; unnamed, the Conductor row's choice rides along only when it " +
        "names the same agent kind. A session whose entry lists no new agents takes no such ask.",
    },
    {
      label: "Archiving",
      detail:
        "Where a provider documents an archive endpoint — a Conductor workspace, a Cursor " +
        "cloud agent, and a Devin cloud session today — Archive is offered as a control once the " +
        "work there was positively seen to settle: pressed, or asked of Luke in " +
        "conversation, it files the work away through the provider's own endpoint. Archiving a " +
        "Conductor workspace files away every chat in it at once, so when several of its chats " +
        "are drawn together the control sits once on the group's own header rather than on " +
        "each row; a lone chat, or any other provider's session, carries it on the row. An " +
        "archived Cursor agent " +
        "stays readable but takes no new runs; an archived Devin session can be viewed but not " +
        "resumed. A row mid-turn — or one whose state could not be read — offers no archive, a " +
        "session whose roster entry lists no archive control takes no such ask, and local " +
        "sessions — which Luke only reads — are never archived.",
    },
    {
      label: "Standing asks about sessions",
      detail:
        "An ask in conversation, spoken or typed, can be kept standing for one observed session " +
        "— told when it finishes, warned if it fails, whatever the developer asked in their own " +
        "words. Luke's background review weighs each of that session's updates against the ask " +
        "and speaks when one satisfies it, opening a speak-only call if no conversation is up; " +
        "the ask itself is the consent. One ask stands per session, a new one replaces it, asking Luke to drop " +
        "it withdraws it, and an ask ends with the session it was about. A row with an ask standing wears a " +
        "small listening mark beside its age, and the conversation roster carries each standing ask, so Luke " +
        "can say what he is already listening for. It needs voice to be available — the " +
        "signed-in account includes it, and a personal OpenAI key also provides it — " +
        "changes nothing about the session itself, and is never sent to a provider.",
    },
    talkKeyFact(input.hotkey),
    askKeyFact(input.askKey),
    { label: "Microphone access", detail: MICROPHONE_DETAIL[input.microphoneStatus] },
    ...(input.voiceAvailable
      ? [
          {
            label: "Stopping a reply",
            detail:
              (input.stopKey
                ? `${input.stopKey}, from any app, cuts the reply off and asks for nothing in ` +
                  "its place; Escape does the same while Luke's panel has the keyboard."
                : "Escape while Luke is speaking cuts the reply off and asks for nothing in " +
                  "its place. No system-wide stop key is registered right now — another app " +
                  "may own the shortcut.") +
              " The talk key over a reply interrupts too, but takes the turn: the microphone " +
              `opens with the same press. A different stop chord can be recorded, or the ` +
              `default restored, in ${SHORTCUTS_PAGE}.`,
          },
          {
            // A behavior rather than a setting: stated here so Luke neither
            // denies announcing nor offers to turn it off.
            label: "Announcements",
            detail:
              "Luke says it out loud when an observed session starts waiting on the developer, " +
              "stops on an error, or finishes — in his own words, naming the session and saying " +
              "what it needs, from the agent's parting words or the provider's error line when " +
              "one was reported. No conversation needs to be open, and the microphone stays " +
              "off. While he says it, a pressable notice names the session he is talking " +
              "about — under the housing, or at the open panel's foot: pressing it opens the " +
              "session where its provider keeps it, or opens the panel for a local session " +
              "with no page of its own. The same chips appear while a conversation reply " +
              "names observed sessions by title, or a workspace of grouped chats by its " +
              "name — asking what is being worked on draws one chip per thing named, up to " +
              "a dozen, a workspace's opening its most recent chat. A reply naming tracked " +
              "issues — by identifier like LUKE-123, or by whole title — draws their chips " +
              "on the same band, each opening its issue where the tracker keeps it. Past " +
              "three rows the chips scroll in place, and each presses the same way. " +
              "Always on while voice is available; the panel and the capsule count show the " +
              "same states either way." +
              // Only a build that offers the calendar may describe the quiet:
              // a hold Luke claims without a calendar row to connect is a
              // capability he does not have.
              (input.settings.calendarSignInAvailable
                ? " With a Google Calendar account connected and Quiet during meetings on, " +
                  "announcements decided during a meeting wait and are read out together once " +
                  "it ends — and Luke's face sleeps beside the housing for as long as the " +
                  "quiet holds, which is how the hold is seen."
                : ""),
          },
          {
            label: "Muted output",
            detail:
              "While the Mac is muted or its volume is at zero, Luke's replies are captioned on " +
              "screen even with Captions off, and a hint under the words asks for volume. A " +
              "reply longer than the caption block scrolls at reading pace, oldest line first. " +
              "The hint's Got it button rests it for that stretch of silence and any that " +
              "begins within fifteen minutes; the captions stay.",
          },
          {
            label: "How long a conversation lasts",
            detail:
              "One conversation lasts as long as the call it is held on. The call opens on the " +
              "first press of the talk key or the first typed ask, stays open across as many " +
              "turns as the developer takes, and is put away after ten minutes with nothing said " +
              "on it — which releases the microphone rather than holding it all day. The voice " +
              "service also ends any call at an hour. Either way the next press opens a fresh " +
              "conversation, and Luke will not remember the last one: what he knows then is what " +
              "the panel observes, not what was said before. A call that ends underneath a " +
              "conversation says so rather than quietly forgetting. Nothing is written down " +
              "between conversations.",
          },
          {
            label: "When a call fails",
            detail:
              "Why a call failed or ended is shown for a few seconds where the captions are " +
              "drawn — under the housing, or at the open panel's foot — and then fades. " +
              "Nothing about it lives in Settings; trying again is the only fix to reach for.",
          },
        ]
      : [
          {
            label: "Voice",
            detail:
              "Off: nothing to run voice on, so no conversation can be opened. " +
              `Signing in turns it on with the included allowance; a key entered in ${VOICE_SOURCE_SECTION} also works.`,
          },
        ]),
    providersFact(input.settings),
    voiceKeyFact(input.settings, input.voiceAvailable),
    integrationsFact(input.settings),
    ...(input.settings.secretStorage === SECRET_STORAGE.UNAVAILABLE
      ? [
          {
            label: "Credential storage",
            detail:
              "This system offers no encrypted credential storage, so Luke will not store a key here.",
          },
        ]
      : []),
    {
      label: "Updates",
      // A behavior rather than a setting, like the announcements: stated so
      // Luke neither denies checking nor offers a switch that does not exist.
      detail:
        `The Updates section on ${FRONT_PAGE} says which version this is and whether a newer ` +
        "release exists. Its button checks GitHub on the spot, and Luke also checks on his own " +
        "a few times a day — always on; nothing about the developer or their sessions is sent, " +
        "and only the release's version name is read back. A newer release is fetched by hand " +
        "in the browser, from the fixed releases page: Luke never changes the running build " +
        "himself.",
    },
    {
      label: "Quitting",
      detail: `The Quit button at the foot of ${SETTINGS_TAB} or on the sign-in screen when it is shown.`,
    },
  ];

  const settings = Object.values(SETTING_GUIDE).flatMap((entry) => {
    const setting = entry(input.settings);
    if (setting === undefined) return [];
    return Array.isArray(setting) ? setting : [setting as AppGuideSetting];
  });

  return { facts, settings };
}

/**
 * Composes the stored Conductor selection a spoken model or effort change
 * asks for. A model is named by its label; an effort named beside it rides
 * that same change, and one left unsaid carries the current effort forward
 * only where the new model's agent documents it. An effort change alone
 * rides the model already chosen, which is why the effort entry only exists
 * while one is. Naming the default returns that half to Conductor: the whole
 * selection for a model, the effort alone otherwise.
 */
function spokenWorkspaceAgentSelection(
  settingId: string,
  value: string,
  namedEffort: string | undefined,
  current: WorkspaceAgentSelection | undefined,
): { selection: WorkspaceAgentSelection | undefined } | { refused: string } {
  if (settingId === APP_SETTING_ID.WORKSPACE_AGENT_MODEL) {
    if (value === CONDUCTOR_DEFAULT_CHOICE) {
      if (namedEffort !== undefined) {
        return { refused: "Conductor's own default takes no effort level." };
      }
      return { selection: undefined };
    }
    const named = workspaceAgentModels(PROVIDER_ID.CONDUCTOR)
      .flatMap((entry) =>
        entry.models.map((model) => ({
          agent: entry.agent,
          model: model.id,
          label: model.label,
          efforts: entry.efforts,
        })),
      )
      .find((candidate) => candidate.label === value);
    if (!named) return { refused: "No documented Conductor model goes by that name." };
    if (namedEffort !== undefined) {
      // Composed against the table itself, not the guide the call was
      // validated against: this half answers to what an endpoint takes.
      if (!named.efforts.includes(namedEffort)) {
        return {
          refused:
            named.efforts.length > 0
              ? `That model's effort is one of ${named.efforts.join(", ")}.`
              : "That model takes no effort level.",
        };
      }
      return { selection: { agent: named.agent, model: named.model, effort: namedEffort } };
    }
    const effort =
      current?.effort && named.efforts.includes(current.effort) ? current.effort : undefined;
    return {
      selection: { agent: named.agent, model: named.model, ...(effort ? { effort } : {}) },
    };
  }
  // The effort entry only exists while a model is chosen, so an ask arriving
  // without one is a guide ahead of the state; refuse honestly.
  if (!current) {
    return {
      refused: "No model is chosen for new Conductor agents, so there is no effort to set.",
    };
  }
  if (value === CONDUCTOR_DEFAULT_CHOICE) {
    return { selection: { agent: current.agent, model: current.model } };
  }
  return { selection: { agent: current.agent, model: current.model, effort: value } };
}

/**
 * Carries one validated spoken settings change to the same bridge calls the
 * settings rows use, and reports what became of it in words Luke can say.
 * The store answers with the settings it actually holds either way, and
 * `onSettings` hands that snapshot back to the panel so the switch on screen
 * and the sentence out loud never disagree. The current settings ride along
 * so a model or effort change composes against the selection actually stored.
 */
export async function applySpokenSetting(
  bridge: Pick<
    AppBridge,
    | "setVoice"
    | "setVoiceSpeed"
    | "setVoiceCaptions"
    | "setDuckOtherMedia"
    | "setPreferBuiltInMicrophone"
    | "setQuietDuringMeetings"
    | "setShowInDock"
    | "setShowOnAllDisplays"
    | "setFormFactor"
    | "setWorkspaceAgentDefault"
  >,
  action: { setting: AppGuideSetting; value: string; effort?: string },
  onSettings: (settings: AppSettings) => void,
  current?: AppSettings,
): Promise<Record<string, unknown>> {
  if (
    action.setting.id === APP_SETTING_ID.WORKSPACE_AGENT_MODEL ||
    action.setting.id === APP_SETTING_ID.WORKSPACE_AGENT_EFFORT
  ) {
    const composed = spokenWorkspaceAgentSelection(
      action.setting.id,
      action.value,
      action.effort,
      current?.workspaceAgentDefaults?.[PROVIDER_ID.CONDUCTOR],
    );
    if ("refused" in composed) return { status: "refused", reason: composed.refused };
    const answered = await bridge.setWorkspaceAgentDefault(
      PROVIDER_ID.CONDUCTOR,
      composed.selection,
    );
    onSettings(answered.settings);
    if (answered.reason) return { status: "refused", reason: answered.reason };
    return {
      status: "changed",
      setting: action.setting.label,
      value: action.value,
      ...(action.effort !== undefined ? { effort: action.effort } : {}),
    };
  }
  const enabled = action.value === APP_TOGGLE_VALUE.ON;
  const speed = voiceSpeedFromWord(action.value);
  const result =
    action.setting.id === APP_SETTING_ID.VOICE_CAPTIONS
      ? await bridge.setVoiceCaptions(enabled)
      : action.setting.id === APP_SETTING_ID.DUCK_OTHER_MEDIA
        ? await bridge.setDuckOtherMedia(enabled)
        : action.setting.id === APP_SETTING_ID.PREFER_BUILT_IN_MICROPHONE
          ? await bridge.setPreferBuiltInMicrophone(enabled)
          : action.setting.id === APP_SETTING_ID.QUIET_DURING_MEETINGS
            ? await bridge.setQuietDuringMeetings(enabled)
            : action.setting.id === APP_SETTING_ID.SHOW_IN_DOCK
              ? await bridge.setShowInDock(enabled)
              : action.setting.id === APP_SETTING_ID.SHOW_ON_ALL_DISPLAYS
                ? await bridge.setShowOnAllDisplays(enabled)
                : action.setting.id === APP_SETTING_ID.VOICE_SPEED && speed !== undefined
                  ? await bridge.setVoiceSpeed(speed)
                  : action.setting.id === APP_SETTING_ID.VOICE && isRealtimeVoice(action.value)
                    ? await bridge.setVoice(action.value)
                    : action.setting.id === APP_SETTING_ID.FORM_FACTOR &&
                        isPanelFormFactor(action.value)
                      ? await bridge.setFormFactor(action.value)
                      : undefined;
  if (!result) {
    // An adjustable entry with no carrier is a guide ahead of its wiring;
    // refuse honestly rather than claim a change that never happened.
    return { status: "refused", reason: "That setting cannot be changed from here." };
  }
  onSettings(result.settings);
  if (result.reason) return { status: "refused", reason: result.reason };
  return {
    status: "changed",
    setting: action.setting.label,
    value: action.value,
    // What each change means for the call now open, so the outcome Luke
    // voices matches what actually happens. The API locks a session's voice
    // once the model has spoken, so a changed voice is heard by starting the
    // conversation afresh; a pace rides a session update and needs no restart.
    ...(action.setting.id === APP_SETTING_ID.VOICE
      ? {
          note: "The new voice takes over as soon as this reply ends, and the conversation starts afresh in it.",
        }
      : action.setting.id === APP_SETTING_ID.VOICE_SPEED
        ? { note: "The new pace is heard from the next reply on." }
        : {}),
  };
}
