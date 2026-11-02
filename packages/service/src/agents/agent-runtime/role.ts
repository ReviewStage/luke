/**
 * role.ts -- the two agents we run on our one agent runtime, and what sets each apart.
 *
 * The coding agent and the worker it delegated to, as an eve agent did,
 * each serve a role, which names the tools each is offered (`tools.ts`) and
 * the integrations its turn is handed (`servers.ts`).
 */

/** The agents, by the role each plays. */
export const AGENT_ROLE = {
  CODER: "coder",
  CODER_WORKER: "coder-worker",
} as const;

export type AgentRole = (typeof AGENT_ROLE)[keyof typeof AGENT_ROLE];

/**
 * Which integrations' MCP servers a turn is handed: every one the account
 * connected; every one but those the developer switched off for the agent;
 * or those, and the ones a message to the agent mentioned since its last
 * turn started, which the turn takes (`servers.ts`).
 */
export const CONNECTION_POLICY = {
  ALWAYS_ON: "always-on",
  AGENT_SWITCHES: "agent-switches",
  AGENT_SWITCHES_AND_MENTIONS: "agent-switches-and-mentions",
} as const;

export type ConnectionPolicy = (typeof CONNECTION_POLICY)[keyof typeof CONNECTION_POLICY];
