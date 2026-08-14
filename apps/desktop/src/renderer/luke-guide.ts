/**
 * Luke's knowledge of himself, in one place.
 *
 * Everything the voice conversation may know about the app — what Luke is on
 * screen, every setting with its current value, and where each is changed by
 * hand — is assembled here into the `AppGuideSnapshot` the conversation is
 * sent. A feature this file does not describe is one Luke will deny having,
 * and a setting it does not mark changeable is one no spoken ask can touch,
 * so adding either to the app means adding it here in the same change.
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
  isRealtimeVoice,
  REALTIME_VOICE_LIST,
} from "@sidecar/core";
import type { AppBridge, AppSettings, MicrophoneStatus } from "../shared/contracts";
import { CREDENTIAL_SOURCE, SECRET_STORAGE } from "../shared/contracts";
import { CREDENTIAL_PROVIDER_LIST } from "../shared/credential-providers";

/** The ids a spoken change names Luke's settings by. */
export const APP_SETTING_ID = {
  VOICE: "voice",
  VOICE_CAPTIONS: "voice_captions",
  SHOW_IN_MENU_BAR: "show_in_menu_bar",
} as const;

export type AppSettingId = (typeof APP_SETTING_ID)[keyof typeof APP_SETTING_ID];

/** Where the switches live, said once so every entry words it the same way. */
const SETTINGS_TAB = "the panel's Settings tab";

/**
 * One guide entry per settings field, or an explicit nothing. Exhaustive over
 * `AppSettings` on purpose: this `Record` failing to compile is how a new
 * setting is prevented from shipping unknown to Luke.
 */
const SETTING_GUIDE: Record<
  keyof AppSettings,
  (settings: AppSettings) => AppGuideSetting | undefined
> = {
  voice: (settings) => ({
    id: APP_SETTING_ID.VOICE,
    label: "Voice",
    description: "Which voice Luke speaks with; a change is heard from the next conversation on.",
    kind: APP_SETTING_KIND.CHOICE,
    value: settings.voice,
    choices: REALTIME_VOICE_LIST,
    adjustable: true,
    manual: `${SETTINGS_TAB}, under Preferences`,
  }),
  voiceCaptions: (settings) => ({
    id: APP_SETTING_ID.VOICE_CAPTIONS,
    label: "Captions",
    description: "Luke's words on screen while he speaks; nothing is kept.",
    kind: APP_SETTING_KIND.TOGGLE,
    value: appToggleText(settings.voiceCaptions),
    adjustable: true,
    manual: `${SETTINGS_TAB}, under Preferences`,
  }),
  showInMenuBar: (settings) => ({
    id: APP_SETTING_ID.SHOW_IN_MENU_BAR,
    label: "Show Luke in the menu bar",
    description: "Whether Luke also stands in the menu bar as a status item.",
    kind: APP_SETTING_KIND.TOGGLE,
    value: appToggleText(settings.showInMenuBar),
    adjustable: true,
    manual: `${SETTINGS_TAB}, under Preferences`,
  }),
  // Not a switch but a set of keys, so it is described in the facts instead:
  // which providers are connected, and that a key is only ever typed by hand.
  credentialSources: () => undefined,
  // Only worth a word when it has refused a key, which the facts carry.
  secretStorage: () => undefined,
};

/** What the guide needs from the app to describe the current state of it. */
export interface LukeGuideInput {
  settings: AppSettings;
  /** Whether a Realtime credential can be minted at all. */
  voiceAvailable: boolean;
  microphoneStatus: MicrophoneStatus;
  /** The talk key as the panel shows it, absent when none was registered. */
  hotkey: { hotkey?: string; held: boolean };
}

function talkKeyFact(hotkey: LukeGuideInput["hotkey"]): AppGuideFact {
  if (!hotkey.hotkey) {
    return {
      label: "Talk key",
      detail:
        "None is registered right now — another app may own the shortcut. The Settings tab shows its state.",
    };
  }
  return {
    label: "Talk key",
    detail: hotkey.held
      ? `${hotkey.hotkey}, from any app: hold to talk, let go to send; tap instead to keep the turn open.`
      : `${hotkey.hotkey}, from any app: press to talk, again to send, again to interrupt.`,
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

function providersFact(settings: AppSettings): AppGuideFact {
  const roster = CREDENTIAL_PROVIDER_LIST.map((provider) => {
    const source = settings.credentialSources[provider.id];
    const connected =
      source === CREDENTIAL_SOURCE.NONE
        ? "not connected"
        : source === CREDENTIAL_SOURCE.ENVIRONMENT
          ? "connected from the environment"
          : "connected";
    return `${provider.displayName} (${connected})`;
  });
  return {
    label: "Cloud providers",
    detail:
      `${roster.join(", ")}. Connecting one takes its API key, typed by hand into ${SETTINGS_TAB} ` +
      "on the provider's row — never spoken, and never repeated back. Local providers such as " +
      "Claude Code need no key and are observed on their own.",
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
        "sessions; hovering it peeks, pressing it opens the panel, and Escape closes what is open.",
    },
    {
      label: "The panel",
      detail:
        "Two tabs. Sessions lists every observed session with its state, narrowable to all, local, " +
        "cloud, or one provider, and orderable by urgency (what needs the developer first) or " +
        "recency (what moved last first); a row can be opened, messaged, or controlled where its " +
        "provider allows. Settings holds the preferences, the talk key, the cloud API keys, " +
        "permissions, and Quit.",
    },
    talkKeyFact(input.hotkey),
    { label: "Microphone access", detail: MICROPHONE_DETAIL[input.microphoneStatus] },
    ...(input.voiceAvailable
      ? []
      : [
          {
            label: "Voice",
            detail:
              "Off: no OPENAI_API_KEY reached the process Luke was launched with, so no conversation can be opened.",
          },
        ]),
    providersFact(input.settings),
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
    return setting ? [setting] : [];
  });

  return { facts, settings };
}

/**
 * Carries one validated spoken settings change to the same bridge calls the
 * settings rows use, and reports what became of it in words Luke can say.
 * The store answers with the settings it actually holds either way, and
 * `onSettings` hands that snapshot back to the panel so the switch on screen
 * and the sentence out loud never disagree.
 */
export async function applySpokenSetting(
  bridge: Pick<AppBridge, "setVoice" | "setVoiceCaptions" | "setShowInMenuBar">,
  action: { setting: AppGuideSetting; value: string },
  onSettings: (settings: AppSettings) => void,
): Promise<Record<string, unknown>> {
  const enabled = action.value === APP_TOGGLE_VALUE.ON;
  const result =
    action.setting.id === APP_SETTING_ID.VOICE_CAPTIONS
      ? await bridge.setVoiceCaptions(enabled)
      : action.setting.id === APP_SETTING_ID.SHOW_IN_MENU_BAR
        ? await bridge.setShowInMenuBar(enabled)
        : action.setting.id === APP_SETTING_ID.VOICE && isRealtimeVoice(action.value)
          ? await bridge.setVoice(action.value)
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
    ...(action.setting.id === APP_SETTING_ID.VOICE
      ? { note: "The new voice is heard from the next conversation on." }
      : {}),
  };
}
