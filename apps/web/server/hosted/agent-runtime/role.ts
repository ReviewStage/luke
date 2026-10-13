/**
 * role.ts -- the four agents Luke runs on its one agent runtime, and what sets each apart.
 *
 * The planning assistant, the coding agent, and each one's declared worker
 * are four eve agents over one runtime (`docs/proposals/one-agent-runtime.md`):
 * every slot of every one of them is the runtime's, told which role it
 * serves, and a role differs from another only by its profile here. The
 * profile grows as each slot moves onto the runtime.
 */

/** The agents, by the role each plays. */
export const AGENT_ROLE = {
  PLANNER: "planner",
  PLANNER_WORKER: "planner-worker",
  CODER: "coder",
  CODER_WORKER: "coder-worker",
} as const;

export type AgentRole = (typeof AGENT_ROLE)[keyof typeof AGENT_ROLE];

/**
 * Which integrations' MCP servers a turn is handed: every one the account
 * connected, or every one but those the developer switched off for the
 * agent (`servers.ts`).
 */
export const CONNECTION_POLICY = {
  ALWAYS_ON: "always-on",
  AGENT_SWITCHES: "agent-switches",
} as const;

export type ConnectionPolicy = (typeof CONNECTION_POLICY)[keyof typeof CONNECTION_POLICY];

/** What one role is configured with. */
export interface RoleProfile {
  /** Whether the role's sessions are a worker's, admitted on ownership alone, rather than a root's own standing. */
  readonly delegated: boolean;
  readonly connections: ConnectionPolicy;
}

export const ROLE_PROFILE = {
  [AGENT_ROLE.PLANNER]: { delegated: false, connections: CONNECTION_POLICY.ALWAYS_ON },
  [AGENT_ROLE.PLANNER_WORKER]: { delegated: true, connections: CONNECTION_POLICY.ALWAYS_ON },
  [AGENT_ROLE.CODER]: { delegated: false, connections: CONNECTION_POLICY.AGENT_SWITCHES },
  // Note that a worker follows its parent agent's switches, because its session is admitted for its parent's conversation.
  [AGENT_ROLE.CODER_WORKER]: { delegated: true, connections: CONNECTION_POLICY.AGENT_SWITCHES },
} as const satisfies { readonly [Role in AgentRole]: RoleProfile };
