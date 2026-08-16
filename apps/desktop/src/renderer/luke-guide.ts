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
  AppBridge,
  AppSettings,
  CredentialSource,
  MicrophoneStatus,
} from "../shared/contracts";
import { APP_SETTING_DEFAULTS, CREDENTIAL_SOURCE, SECRET_STORAGE } from "../shared/contracts";
import {
  CLOUD_AGENT_PROVIDER_LIST,
  CREDENTIAL_PROVIDERS,
  INTEGRATION_PROVIDER_LIST,
  isCredentialProviderId,
} from "../shared/credential-providers";
import { workspaceAgentModelLabel, workspaceAgentModels } from "../shared/workspace-agents";

/** The ids a spoken change names Luke's settings by. */
export const APP_SETTING_ID = {
  VOICE: "voice",
  VOICE_SPEED: "voice_speed",
  VOICE_CAPTIONS: "voice_captions",
  DUCK_OTHER_MEDIA: "duck_other_media",
  SESSION_NOTIFICATIONS: "session_notifications",
  SHOW_IN_MENU_BAR: "show_in_menu_bar",
  SHOW_IN_DOCK: "show_in_dock",
  SHOW_ON_ALL_DISPLAYS: "show_on_all_displays",
  FORM_FACTOR: "form_factor",
  DEFAULT_WORKSPACE_PROVIDER: "default_workspace_provider",
  WORKSPACE_AGENT_MODEL: "workspace_agent_model",
  WORKSPACE_AGENT_EFFORT: "workspace_agent_effort",
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
const APPEARANCE_PAGE = `${SETTINGS_TAB}, on its Appearance page`;
const SHORTCUTS_PAGE = `${SETTINGS_TAB}, on its Keyboard shortcuts page`;
const CONNECTIONS_PAGE = `${SETTINGS_TAB}, on its Connections page`;

/** Where the Conductor agent choices live, said once for both their entries. */
const CONDUCTOR_ROW_PATH = `the Conductor row under Cloud Agent API keys, in ${CONNECTIONS_PAGE}`;

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
      "whatever this says, while the Mac's output is muted or at zero.",
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
  sessionNotifications: (settings) => ({
    id: APP_SETTING_ID.SESSION_NOTIFICATIONS,
    label: "Announce when a session needs you",
    description:
      "Luke says it out loud when an observed session starts waiting on the developer, stops on " +
      "an error, or finishes — no conversation needs to be open, and the microphone stays off. " +
      "Needs voice to be available; the panel and the capsule count show the same states either way.",
    kind: APP_SETTING_KIND.TOGGLE,
    value: appToggleText(settings.sessionNotifications),
    defaultValue: appToggleText(APP_SETTING_DEFAULTS.sessionNotifications),
    adjustable: true,
    manual: VOICE_PAGE,
  }),
  showInMenuBar: (settings) => ({
    id: APP_SETTING_ID.SHOW_IN_MENU_BAR,
    label: "Show Luke in the menu bar",
    description: "Whether Luke also stands in the menu bar as a status item.",
    kind: APP_SETTING_KIND.TOGGLE,
    value: appToggleText(settings.showInMenuBar),
    defaultValue: appToggleText(APP_SETTING_DEFAULTS.showInMenuBar),
    adjustable: true,
    manual: APPEARANCE_PAGE,
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
  // level with no model to ride has nowhere documented to go. Both are
  // changeable by voice, but only at the developer's own naming: the standing
  // instructions forbid asking or suggesting either, so the ask is always
  // theirs to bring up. Conductor is the one provider the build documents a
  // table for; a second provider growing one is the moment this generalizes.
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
          "Conductor's own defaults decide.",
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
  // Not a switch but a set of keys, so it is described in the facts instead:
  // which providers are connected, and that a key is only ever typed by hand.
  credentialSources: () => undefined,
  // Only worth a word when it has refused a key, which the facts carry.
  secretStorage: () => undefined,
  /* Not a setting: it is whether the OpenAI key resolved, which the credential
     row is where anyone changes. Luke is told whether he can speak at all
     through `voiceAvailable` on the guide itself, so a spoken ask about it is
     already answered without a settings entry to adjust. */
  voiceAvailable: () => undefined,
};

/** What the guide needs from the app to describe the current state of it. */
export interface LukeGuideInput {
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
  granted: "Granted. The microphone only opens while the talk key holds a turn.",
  denied:
    "Denied. It can only be granted back in System Settings, under Privacy & Security, Microphone.",
  restricted: "Restricted by a system policy, which only the system's manager can change.",
  "not-determined": "Not asked yet. The Settings tab's Permissions section can ask.",
  unknown: "Unknown. The Settings tab's Permissions section shows its state.",
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
      `${roster.join(", ")}. Connecting one takes its API key, typed by hand into ` +
      `${CONNECTIONS_PAGE}, under Cloud Agent API keys — never spoken, and never repeated back. ` +
      "Local providers such as Claude Code need no key and are observed on their own.",
  };
}

function integrationsFact(settings: AppSettings): AppGuideFact {
  const roster = INTEGRATION_PROVIDER_LIST.map(
    (provider) =>
      `${provider.displayName} (${connectionWord(settings.credentialSources[provider.id])})`,
  );
  return {
    label: "Integrations",
    detail:
      `${roster.join(", ")}. Connecting Linear lets Luke read the developer's issues and, only ` +
      `when asked in a turn the developer opened, move or comment on one. Connecting OpenAI is ` +
      `what lets Luke speak, and review which sessions need a person. Each key is typed by ` +
      `hand into ${CONNECTIONS_PAGE}, under Integrations — never spoken, and never repeated back.`,
  };
}

/**
 * Builds the guide from what the app currently knows about itself. Pure and
 * synchronous so the renderer can rebuild it on every settings change and the
 * conversation always describes the app as it is, not as it launched.
 */
export function buildLukeGuide(input: LukeGuideInput): AppGuideSnapshot {
  const facts: AppGuideFact[] = [
    {
      label: "What Luke is",
      detail:
        "A macOS sidecar living beside the notch. The capsule under the housing counts observed " +
        "sessions; hovering it peeks, pressing it opens the panel, and Escape closes what is open. " +
        "Resting the pointer on the face itself earns one trick — usually flying off the strip and " +
        "swooping back — and another only after the pointer leaves and returns.",
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
        "recency (what moved last first); a row can be opened, messaged, or controlled where its " +
        "provider allows. Where a provider nests chats in a workspace — Conductor today — each " +
        "chat is its own row: a workspace holding several draws them inside one tray named by " +
        "the workspace at its top, one holding a single chat stays one row titled by the " +
        "workspace, and every chat can be seen, opened, and messaged individually. Settings " +
        "holds a front page whose rows open its Voice, Appearance, Keyboard shortcuts, and " +
        "Connections pages — each led back out by its back button or Escape — and keeps the " +
        "microphone permission, the Feedback section, and Quit on the front page itself. A " +
        "change Luke makes himself is shown as it is made: the panel comes forward on the tab, " +
        "and the page, the change belongs to, and his face leaves the strip under the housing, " +
        "dives to the control that moved, and floats back.",
    },
    {
      label: "Feedback and prompts",
      detail:
        "The Feedback section at the foot of the Settings tab — or the menu bar item's Send " +
        "Feedback… and Submit a Prompt… — opens a composer under the notch. Send feedback is for " +
        "bugs and ideas; Submit a prompt sends a prompt to a coding agent, and one the founders " +
        "like ships in the next release. Either goes by email to the founders with an optional " +
        "name and email for credit and up to three screenshots. A spoken ask can open the " +
        "composer and start it with the developer's own words — Luke offers exactly that, once, " +
        "after refusing something he cannot do — but a note already being written is never " +
        "overwritten, and sending is always the Send button's own press, by hand: no spoken ask " +
        "can send one.",
    },
    {
      label: "Creating workspaces",
      detail:
        "Where a connected provider documents a creation endpoint — Conductor and Cursor today — " +
        "an ask in conversation, spoken or typed, can create a new workspace in one of the " +
        "projects that provider reports, optionally under a name the developer chose, and can " +
        "hand the new agent an opening task in the developer's own words where the project takes " +
        "one. Only reported projects can be named, a project that needs a task cannot be created " +
        "without one, and a provider that reports none takes no ask. An ask that names no " +
        "provider goes to the default workspace provider; until one is chosen Luke asks when " +
        "more than one provider could take it, and the first workspace created saves its " +
        "provider as the default — changed or cleared by hand in the Settings tab. What a new " +
        "Conductor agent runs — its model, and its effort where the model's agent takes one — " +
        "follows the choice on the Conductor row under Cloud Agent API keys, or Conductor's own " +
        "defaults while none is made. A model named in a creation ask rides that creation alone " +
        "and is saved as the default only while none is chosen; the settings themselves change " +
        "only when the developer asks for that, and Luke never asks or suggests a model.",
    },
    {
      label: "Adding agents to a workspace",
      detail:
        "Where a session's provider documents it — Conductor today — the same kind of ask can " +
        "start another agent in the workspace an observed session runs in, as one of the agent " +
        "kinds that session's roster entry lists, optionally named and optionally with an " +
        "opening task. A session whose entry lists no new agents takes no such ask.",
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
            label: "Muted output",
            detail:
              "While the Mac is muted or its volume is at zero, Luke's replies are captioned on " +
              "screen even with Captions off, and a hint under the words asks for volume. The " +
              "hint's Got it button rests it for that stretch of silence; the captions stay.",
          },
        ]
      : [
          {
            label: "Voice",
            detail: "Off: no OpenAI key is connected, so no conversation can be opened.",
          },
        ]),
    providersFact(input.settings),
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
      label: "Quitting",
      detail: `The Quit button at the foot of ${SETTINGS_TAB}, or the menu bar item when it is shown.`,
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
 * asks for. A model is named by its label and carries the current effort
 * forward only where the new model's agent documents it; an effort rides the
 * model already chosen, which is why the effort entry only exists while one
 * is. Naming the default returns that half to Conductor: the whole selection
 * for a model, the effort alone otherwise.
 */
function spokenWorkspaceAgentSelection(
  settingId: string,
  value: string,
  current: WorkspaceAgentSelection | undefined,
): { selection: WorkspaceAgentSelection | undefined } | { refused: string } {
  if (settingId === APP_SETTING_ID.WORKSPACE_AGENT_MODEL) {
    if (value === CONDUCTOR_DEFAULT_CHOICE) return { selection: undefined };
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
    | "setSessionNotifications"
    | "setShowInMenuBar"
    | "setShowInDock"
    | "setShowOnAllDisplays"
    | "setFormFactor"
    | "setWorkspaceAgentDefault"
  >,
  action: { setting: AppGuideSetting; value: string },
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
      current?.workspaceAgentDefaults?.[PROVIDER_ID.CONDUCTOR],
    );
    if ("refused" in composed) return { status: "refused", reason: composed.refused };
    const answered = await bridge.setWorkspaceAgentDefault(
      PROVIDER_ID.CONDUCTOR,
      composed.selection,
    );
    onSettings(answered.settings);
    if (answered.reason) return { status: "refused", reason: answered.reason };
    return { status: "changed", setting: action.setting.label, value: action.value };
  }
  const enabled = action.value === APP_TOGGLE_VALUE.ON;
  const speed = voiceSpeedFromWord(action.value);
  const result =
    action.setting.id === APP_SETTING_ID.VOICE_CAPTIONS
      ? await bridge.setVoiceCaptions(enabled)
      : action.setting.id === APP_SETTING_ID.DUCK_OTHER_MEDIA
        ? await bridge.setDuckOtherMedia(enabled)
        : action.setting.id === APP_SETTING_ID.SESSION_NOTIFICATIONS
          ? await bridge.setSessionNotifications(enabled)
          : action.setting.id === APP_SETTING_ID.SHOW_IN_MENU_BAR
            ? await bridge.setShowInMenuBar(enabled)
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
