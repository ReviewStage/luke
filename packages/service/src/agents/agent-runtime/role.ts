export const AGENT_ROLE = {
  CODER: "coder",
  CODER_WORKER: "coder-worker",
} as const;

export type AgentRole = (typeof AGENT_ROLE)[keyof typeof AGENT_ROLE];

export const CONNECTION_POLICY = {
  ALWAYS_ON: "always-on",
  AGENT_SWITCHES: "agent-switches",
  AGENT_SWITCHES_AND_MENTIONS: "agent-switches-and-mentions",
} as const;

export type ConnectionPolicy = (typeof CONNECTION_POLICY)[keyof typeof CONNECTION_POLICY];
