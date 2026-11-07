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
  /** Profile's GitHub personal access token row, apart from Integrations' own GitHub row, which its provider anchors. */
  GITHUB_ACCESS: "github-access",
  DELETE_ACCOUNT: "delete-account",
  MICROPHONE: "microphone",
  MEMORY: "memory",
  AGENT_MODEL: "agent-model",
  AGENT_EFFORT: "agent-effort",
  AGENT_FAST: "agent-fast",
  API_KEY_ANTHROPIC: "api-key-anthropic",
  API_KEY_OPENAI: "api-key-openai",
  /** Skills' Add a skill row. */
  ADD_SKILL: "add-skill",
  /** Our MCP page's Connected, the outside agents the account let in. */
  MCP_CLIENTS: "mcp-clients",
  /** Our MCP page's Connect an agent, the agent asked for and its step. */
  MCP_CONNECT: "mcp-connect",
  /** The CLI page's Install, the `vespin` command's install. */
  CLI_INSTALL: "cli-install",
  /** The CLI page's Sign in, the command's sign-in and Sign out everywhere. */
  CLI_SIGN_IN: "cli-sign-in",
  /** Hosts' Add hosts button, under its list. */
  ADD_HOSTS: "add-hosts",
  /** The Workspace page's identity row, where an owner or an admin renames the workspace. */
  WORKSPACE_RENAME: "workspace-rename",
  /** The Workspace page's identity row, whose ⋯ holds the owner's Change slug. */
  WORKSPACE_SLUG: "workspace-slug",
} as const;

/**
 * The id each experiment's row in Settings › Experimental wears, spelled out
 * rather than its bare key, since a gated feature's own command is likely to
 * share that key and its row on the Keyboard shortcuts page anchors by the
 * command. Total over the registry, so a new experiment does not build
 * without one.
 */
export const EXPERIMENT_ANCHOR = {
  [EXPERIMENT.MEMORY]: "experiment-memory",
  [EXPERIMENT.PILOT]: "experiment-pilot",
  [EXPERIMENT.SKILLS]: "experiment-skills",
  [EXPERIMENT.BRING_YOUR_OWN_HOST]: "experiment-bring-your-own-host",
  [EXPERIMENT.DESCRIPTIONS]: "experiment-descriptions",
} as const satisfies Record<Experiment, string>;
