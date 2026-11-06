import { EXPERIMENT, type Experiment } from "./experiments.js";

export const SETTINGS_SEARCH_ANCHOR_ATTRIBUTE = "data-search-anchor";

export function searchAnchorProps(id: string) {
  return { [SETTINGS_SEARCH_ANCHOR_ATTRIBUTE]: id } satisfies Record<string, string>;
}

export const SETTINGS_SEARCH_ROW = {
  UPDATES: "updates",
  CHANGELOG: "changelog",
  SIGN_OUT: "sign-out",
  GITHUB_ACCESS: "github-access",
  DELETE_ACCOUNT: "delete-account",
  MICROPHONE: "microphone",
  MEMORY: "memory",
  AGENT_MODEL: "agent-model",
  AGENT_EFFORT: "agent-effort",
  AGENT_FAST: "agent-fast",
  API_KEY_ANTHROPIC: "api-key-anthropic",
  API_KEY_OPENAI: "api-key-openai",
  ADD_SKILL: "add-skill",
  MCP_CLIENTS: "mcp-clients",
  MCP_CONNECT: "mcp-connect",
  CLI_INSTALL: "cli-install",
  CLI_SIGN_IN: "cli-sign-in",
  ADD_HOSTS: "add-hosts",
  WORKSPACE_RENAME: "workspace-rename",
  WORKSPACE_SLUG: "workspace-slug",
} as const;

export const EXPERIMENT_ANCHOR = {
  [EXPERIMENT.MEMORY]: "experiment-memory",
  [EXPERIMENT.PILOT]: "experiment-pilot",
  [EXPERIMENT.SKILLS]: "experiment-skills",
  [EXPERIMENT.BRING_YOUR_OWN_HOST]: "experiment-bring-your-own-host",
  [EXPERIMENT.DESCRIPTIONS]: "experiment-descriptions",
} as const satisfies Record<Experiment, string>;
