/**
 * role.ts -- the policies by which our agents are handed the integrations their turn reaches.
 */

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
