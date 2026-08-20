/**
 * The app guide: what the app knows about itself, said in a form a spoken
 * conversation can be handed. The guide is data rather than prose so the same
 * snapshot can be rendered as context, validated against, and — the reason it
 * exists at all — kept honest: a setting the guide does not carry is one the
 * conversation cannot claim, offer, or change.
 *
 * The app assembles the snapshot; this module only defines its shape and how
 * it reads. Nothing here may ever carry a credential: the guide says *whether*
 * a provider is connected, never what connects it.
 */

import { isWireString, type UnparsedWireValue } from "./json.js";

/** How a setting takes a value: a switch, or one choice from a fixed set. */
export const APP_SETTING_KIND = {
  TOGGLE: "toggle",
  CHOICE: "choice",
} as const;

export type AppSettingKind = (typeof APP_SETTING_KIND)[keyof typeof APP_SETTING_KIND];

/** The two words a toggle's state is said in, on screen and out loud. */
export const APP_TOGGLE_VALUE = {
  ON: "on",
  OFF: "off",
} as const;

export type AppToggleValue = (typeof APP_TOGGLE_VALUE)[keyof typeof APP_TOGGLE_VALUE];

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
   * this field lists levels for, and refuses it everywhere else.
   */
  efforts?: Readonly<Partial<Record<string, readonly string[]>>>;
  /** Whether a spoken ask may change it; false means describe, never act. */
  adjustable: boolean;
  /** Where the same change is made by hand. */
  manual: string;
}

/** One thing the app knows about itself that is not a setting. */
export interface AppGuideFact {
  label: string;
  detail: string;
}

/** Everything the conversation may know about the app itself. */
export interface AppGuideSnapshot {
  facts: readonly AppGuideFact[];
  settings: readonly AppGuideSetting[];
}

/** The guide before the app has said anything, which allows nothing. */
export const EMPTY_APP_GUIDE: AppGuideSnapshot = { facts: [], settings: [] };

/**
 * The panel surfaces a spoken ask can bring forward. The set is the panel's
 * own tab bar; a surface outside it has no press to mirror.
 */
export const APP_PANEL_TAB = {
  SESSIONS: "sessions",
  SETTINGS: "settings",
} as const;

export type AppPanelTab = (typeof APP_PANEL_TAB)[keyof typeof APP_PANEL_TAB];

const APP_PANEL_TAB_LIST: readonly AppPanelTab[] = Object.values(APP_PANEL_TAB);

function isListedGuideValue<T extends string>(
  value: UnparsedWireValue,
  list: readonly T[],
): value is T {
  if (!isWireString(value)) return false;
  // SAFETY: value is a string; list membership is the guide vocabulary contract check.
  return list.includes(value as T);
}

/** Guards a tab arriving from a tool call's untrusted arguments. */
export function isAppPanelTab(value: UnparsedWireValue): value is AppPanelTab {
  return isListedGuideValue(value, APP_PANEL_TAB_LIST);
}

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

const FEEDBACK_COMPOSER_KIND_LIST: readonly FeedbackComposerKind[] =
  Object.values(FEEDBACK_COMPOSER_KIND);

/** Guards a kind arriving from a tool call's untrusted arguments. */
export function isFeedbackComposerKind(value: UnparsedWireValue): value is FeedbackComposerKind {
  return isListedGuideValue(value, FEEDBACK_COMPOSER_KIND_LIST);
}

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

const SESSION_LIST_SORT_LIST: readonly SessionListSort[] = Object.values(SESSION_LIST_SORT);

/** Guards a sort arriving from a tool call's untrusted arguments. */
export function isSessionListSort(value: UnparsedWireValue): value is SessionListSort {
  return isListedGuideValue(value, SESSION_LIST_SORT_LIST);
}

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

function settingEffortsText(setting: AppGuideSetting): string | undefined {
  const efforts = setting.efforts;
  if (!efforts || !setting.choices) return undefined;
  const entries = setting.choices.flatMap((choice) => {
    const levels = efforts[choice];
    return levels && levels.length > 0 ? [`${choice}:${levels.join("/")}`] : [];
  });
  return entries.length > 0 ? `efforts=${entries.join(", ")}` : undefined;
}

function settingLine(setting: AppGuideSetting): string {
  const efforts = settingEffortsText(setting);
  const parts = [
    `- ${setting.label} — ${setting.description} [setting_id=${setting.id}]`,
    `value=${setting.value}`,
    ...(setting.defaultValue !== undefined ? [`default=${setting.defaultValue}`] : []),
    ...(setting.choices ? [`choices=${setting.choices.join(", ")}`] : []),
    ...(efforts !== undefined ? [efforts] : []),
  ];
  return parts.join("; ");
}

/**
 * Renders the guide the conversation is allowed to know about itself: the
 * facts, then every setting with its current value, its default, and how it
 * changes. The
 * ids are printed in the same breath as the values so a spoken change can
 * name a setting the way tool calls name sessions — exactly as listed.
 */
export function appGuideContextText(guide: AppGuideSnapshot): string {
  if (guide.facts.length === 0 && guide.settings.length === 0) {
    return "The app guide has not been provided.";
  }
  return [
    "App guide — what Luke is and how Luke is configured:",
    ...guide.facts.map((fact) => `- ${fact.label}: ${fact.detail}`),
    "Settings:",
    ...guide.settings.map(settingLine),
  ].join("\n");
}
