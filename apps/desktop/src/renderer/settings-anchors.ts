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
 * setting anchors by its schema id, and a window shortcut by its command.
 */
export const SETTINGS_SEARCH_ROW = {
  UPDATES: "updates",
  CHANGELOG: "changelog",
  FEEDBACK: "feedback",
  SIGN_OUT: "sign-out",
  DELETE_ACCOUNT: "delete-account",
  QUIT: "quit",
  MICROPHONE: "microphone",
  TALK_KEY: "talk-key",
  STOP_KEY: "stop-key",
  CODING_AGENT_MODEL: "coding-agent-model",
  CODING_AGENT_EFFORT: "coding-agent-effort",
  CODING_AGENT_FAST: "coding-agent-fast",
} as const;
