/**
 * The app guide: what the app knows about itself, said in a form a spoken
 * conversation can be handed. The guide is data rather than prose so the same
 * snapshot can be validated against and — the reason it exists at all — kept
 * honest: a setting the guide does not carry is one the conversation cannot
 * claim, offer, or change.
 *
 * The app assembles the snapshot; this module only defines its shape and how
 * it reads. Nothing here may ever carry a credential: the guide says *whether*
 * a provider is connected, never what connects it.
 */

import { isWireString, type UnparsedWireValue } from "@sidecar/wire";
import { Schema } from "effect";

/** How a setting takes a value: a switch, or one choice from a fixed set. */
export const APP_SETTING_KIND = {
  TOGGLE: "toggle",
  CHOICE: "choice",
} as const;

type AppSettingKind = (typeof APP_SETTING_KIND)[keyof typeof APP_SETTING_KIND];

export const AppSettingKindSchema = Schema.Literals(Object.values(APP_SETTING_KIND));

/** The two words a toggle's state is said in, on screen and out loud. */
export const APP_TOGGLE_VALUE = {
  ON: "on",
  OFF: "off",
} as const;

type AppToggleValue = (typeof APP_TOGGLE_VALUE)[keyof typeof APP_TOGGLE_VALUE];

/**
 * One user-owned setting, as the guide describes it: what it is called, what
 * it does, what it is set to now, and how it changes. `adjustable` is what
 * separates a setting a spoken ask may change from one that can only be
 * described — a credential, a system permission — and `manual` is the answer
 * either way, because a conversation that changes a setting should still be
 * able to say where the switch lives.
 */
export interface AppGuideSetting {
  /** The id a spoken change names it by, exactly as the guide lists it. */
  id: string;
  label: string;
  /** What the setting does, in one sentence. */
  description: string;
  kind: AppSettingKind;
  /** The current value as it should be said: `on`/`off`, or one of `choices`. */
  value: string;
  /**
   * The value the setting holds until the user chooses, said the same way as
   * `value` — it is what an ask for "the default" is a change to, so a guide
   * without it is one that cannot honour that ask. Absent only for something
   * the app has no default of its own for, such as a system permission.
   */
  defaultValue?: string;
  /** Every value a choice accepts, in the order settings offers them. */
  choices?: readonly string[];
  /**
   * For a choice whose values each take a companion effort level — a model
   * whose agent documents levels — the levels riding each choice, keyed by
   * the choice exactly as `choices` lists it. A choice absent here takes no
   * level. This is what lets one spoken change name both halves of a stored
   * pairing at once: `change_app_setting` accepts an effort only for a value
   * this field lists levels for, refuses one on any other choice here, and on
   * a setting with no levels at all ignores it, so a volunteered effort never
   * blocks a change it could not have meant anything to.
   */
  efforts?: Readonly<Partial<Record<string, readonly string[]>>>;
  /** Whether a spoken ask may change it; false means describe, never act. */
  adjustable: boolean;
  /** Where the same change is made by hand. */
  manual: string;
}

/** One thing the app knows about itself that is not a setting. */
interface AppGuideFact {
  label: string;
  detail: string;
}

/**
 * The three actions the Updates row's button ever performs, which are also the
 * only values a spoken update ask may name. The row offers exactly one at a
 * time, so which of these an ask can reach is the guide's `update` entry's
 * question, answered by the validator.
 */
export const APP_UPDATE_ACTION = {
  /** Ask the release manifest for the latest build. */
  CHECK: "check",
  /** Open the latest release's page in the browser. */
  DOWNLOAD: "download",
  /** Restart into the downloaded release. */
  RESTART: "restart",
} as const;

export type AppUpdateAction = (typeof APP_UPDATE_ACTION)[keyof typeof APP_UPDATE_ACTION];

export const AppUpdateActionSchema = Schema.Literals(Object.values(APP_UPDATE_ACTION));

/** The two waits during which the Updates row's button offers nothing. */
export const APP_UPDATE_WAIT = {
  /** A check is already out. */
  CHECKING: "checking",
  /** A newer build is downloading itself. */
  DOWNLOADING: "downloading",
} as const;

type AppUpdateWait = (typeof APP_UPDATE_WAIT)[keyof typeof APP_UPDATE_WAIT];

export const AppUpdateWaitSchema = Schema.Literals(Object.values(APP_UPDATE_WAIT));

/** What the Updates row's button is right now: one action, or one wait. */
export type AppUpdateButton = AppUpdateAction | AppUpdateWait;

export const AppUpdateButtonSchema = Schema.Union([AppUpdateActionSchema, AppUpdateWaitSchema]);

/**
 * The Updates row, as the guide describes it: the running version, where the
 * build stands in the row's own words, and the one action its button offers —
 * or the wait it is disabled for. A spoken update ask is validated against
 * `button`, so the guide is the outer bound here exactly as it is for a
 * setting: an action the row is not offering is one no ask can run.
 */
export interface AppGuideUpdate {
  /** The running version, as the Updates row names it. */
  version: string;
  /** Where the build stands, in the row's own words. */
  detail: string;
  button: AppUpdateButton;
}

/** Everything the conversation may know about the app itself. */
export interface AppGuideSnapshot {
  facts: readonly AppGuideFact[];
  settings: readonly AppGuideSetting[];
  /** Absent only for a run that reports nothing about updates. */
  update?: AppGuideUpdate;
}

/** The guide before the app has said anything, which allows nothing. */
export const EMPTY_APP_GUIDE: AppGuideSnapshot = { facts: [], settings: [] };

/**
 * The panel surfaces a spoken ask can bring forward. The set is the panel's
 * own tab bar; a surface outside it has no press to mirror.
 */
export const APP_PANEL_TAB = {
  SESSIONS: "sessions",
  CONVERSATION: "conversation",
  SETTINGS: "settings",
} as const;

export type AppPanelTab = (typeof APP_PANEL_TAB)[keyof typeof APP_PANEL_TAB];

export const AppPanelTabSchema = Schema.Literals(Object.values(APP_PANEL_TAB));

/**
 * The two kinds of note the feedback composer writes, exactly as the composer
 * itself names them: feedback about the app, and a prompt for the founders.
 * Defined here for the same reason the panel tabs are — a spoken ask to open
 * the composer is validated against this fixed vocabulary, and a kind outside
 * it names no composer the app has. Opening is all a spoken ask can do; what
 * the composer holds is sent only by its own button, by hand.
 */
export const FEEDBACK_COMPOSER_KIND = {
  FEEDBACK: "feedback",
  PROMPT: "prompt",
} as const;

export type FeedbackComposerKind =
  (typeof FEEDBACK_COMPOSER_KIND)[keyof typeof FEEDBACK_COMPOSER_KIND];

export const FeedbackComposerKindSchema = Schema.Literals(Object.values(FEEDBACK_COMPOSER_KIND));

/**
 * The two orders the session list reads in. Defined here rather than in the
 * renderer because a spoken ask names an order too, and the words the panel's
 * own control uses and the words a tool call is validated against must be one
 * vocabulary — the renderer aliases this set rather than declaring its own.
 */
export const SESSION_LIST_SORT = {
  URGENCY: "urgency",
  RECENCY: "recency",
} as const;

export type SessionListSort = (typeof SESSION_LIST_SORT)[keyof typeof SESSION_LIST_SORT];

export const SessionListSortSchema = Schema.Literals(Object.values(SESSION_LIST_SORT));

/**
 * The ways someone says a switch's two states out loud. A spoken value is a
 * model's rendering of the developer's words, so the vocabulary is wider than
 * the two the guide prints — but never wider than unambiguous.
 */
const TOGGLE_WORDS = {
  [APP_TOGGLE_VALUE.ON]: APP_TOGGLE_VALUE.ON,
  [APP_TOGGLE_VALUE.OFF]: APP_TOGGLE_VALUE.OFF,
  true: APP_TOGGLE_VALUE.ON,
  false: APP_TOGGLE_VALUE.OFF,
  enabled: APP_TOGGLE_VALUE.ON,
  disabled: APP_TOGGLE_VALUE.OFF,
  yes: APP_TOGGLE_VALUE.ON,
  no: APP_TOGGLE_VALUE.OFF,
} satisfies Record<string, AppToggleValue>;

/** Reads a spoken toggle value, or nothing when the words are ambiguous. */
export function appToggleValue(value: UnparsedWireValue): AppToggleValue | undefined {
  if (!isWireString(value)) return undefined;
  const word = value.trim().toLowerCase();
  for (const [alias, toggle] of Object.entries(TOGGLE_WORDS)) {
    if (word === alias) return toggle;
  }
  return undefined;
}

/** The guide's own rendering of a toggle's state. */
export function appToggleText(enabled: boolean): AppToggleValue {
  return enabled ? APP_TOGGLE_VALUE.ON : APP_TOGGLE_VALUE.OFF;
}

/** Finds the setting a spoken change names, exactly as the guide lists it. */
export function appGuideSetting(
  guide: AppGuideSnapshot,
  settingId: string | undefined,
): AppGuideSetting | undefined {
  return guide.settings.find((setting) => setting.id === settingId);
}
