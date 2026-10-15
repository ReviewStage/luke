import { EXPERIMENT, type Experiment } from "./experiments.js";

/**
 * How a row says a pressed search result may land on it, and the ids the rows
 * that are not settings wear.
 *
 * It lives apart from the search itself because the rows wear these and the
 * search reads them: a module holding both would have every row's file
 * importing the search, and the search importing the table those rows are
 * drawn from.
 */
export const SETTINGS_SEARCH_ANCHOR_ATTRIBUTE = "data-search-anchor";

/** What a row spreads onto itself to be somewhere a pressed result lands. */
export function searchAnchorProps(id: string) {
  return { [SETTINGS_SEARCH_ANCHOR_ATTRIBUTE]: id } satisfies Record<string, string>;
}

/**
 * The ids of the searchable rows that are not stored settings, shared with
 * the panel so the entry and the anchor its row wears cannot drift apart. A
 * setting anchors by its schema id, a window shortcut by its command, and an
 * integration's row by its provider.
 */
export const SETTINGS_SEARCH_ROW = {
  UPDATES: "updates",
  CHANGELOG: "changelog",
  SIGN_OUT: "sign-out",
  DELETE_ACCOUNT: "delete-account",
  MICROPHONE: "microphone",
  TALK_KEY: "talk-key",
  STOP_KEY: "stop-key",
  PLAN_TEMPLATE: "plan-template",
  CODING_AGENT_MODEL: "coding-agent-model",
  CODING_AGENT_EFFORT: "coding-agent-effort",
  CODING_AGENT_FAST: "coding-agent-fast",
  API_KEY_ANTHROPIC: "api-key-anthropic",
  API_KEY_OPENAI: "api-key-openai",
} as const;

/**
 * The id each experiment's row in Settings › Experimental wears, spelled out
 * rather than its bare key, since a gated feature's own command is likely to
 * share that key and its row on the Keyboard shortcuts page anchors by the
 * command. Total over the registry, so a new experiment does not build
 * without one.
 */
export const EXPERIMENT_ANCHOR = {
  [EXPERIMENT.FACTORY]: "experiment-factory",
  [EXPERIMENT.AUTOMATIONS]: "experiment-automations",
  [EXPERIMENT.VIDEO_CALLS]: "experiment-video-calls",
} as const satisfies Record<Experiment, string>;
