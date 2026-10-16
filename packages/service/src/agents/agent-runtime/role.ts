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
  BRAIN: "brain",
  BRAIN_WORKER: "brain-worker",
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

/**
 * How a role's session comes by its sandbox, and what is done with the
 * sandbox between turns (`sandbox.ts`). A read checkout is a depth-1 clone
 * on a read token, made by the first `run_in_repository` that needs it and
 * kept between turns, so a voice call never waits on a sandbox resuming. A
 * write checkout is the whole repository on a write token, made as the
 * sandbox opens, with its credential renewed at the firewall as it ages and
 * the sandbox stopped at each turn's end. A worker reads in its parent's
 * sandbox.
 */
export const SANDBOX_POLICY = {
  READ_SHALLOW_LAZY: "read-shallow-lazy",
  WRITE_FULL_EAGER: "write-full-eager",
  PARENT: "parent",
} as const;

export type SandboxPolicy = (typeof SANDBOX_POLICY)[keyof typeof SANDBOX_POLICY];

/** What one role is configured with. */
export interface RoleProfile {
  /** Whether the role's sessions are a worker's, admitted on ownership alone, rather than a root's own standing. */
  readonly delegated: boolean;
  readonly connections: ConnectionPolicy;
  /** Whether the role's sessions are offered the skills the repository they work on keeps (`skills.ts`). */
  readonly skills: boolean;
  readonly sandbox: SandboxPolicy;
}

export const ROLE_PROFILE = {
  [AGENT_ROLE.BRAIN]: {
    delegated: false,
    connections: CONNECTION_POLICY.ALWAYS_ON,
    skills: true,
    sandbox: SANDBOX_POLICY.READ_SHALLOW_LAZY,
  },
  [AGENT_ROLE.BRAIN_WORKER]: {
    delegated: true,
    connections: CONNECTION_POLICY.ALWAYS_ON,
    skills: false,
    sandbox: SANDBOX_POLICY.PARENT,
  },
  [AGENT_ROLE.CODER]: {
    delegated: false,
    connections: CONNECTION_POLICY.AGENT_SWITCHES_AND_MENTIONS,
    skills: true,
    sandbox: SANDBOX_POLICY.WRITE_FULL_EAGER,
  },
  // Note that a worker follows its parent agent's switches, because its session is admitted for its
  // parent's conversation, and takes none of its mentions, which are its parent's turn's to take.
  [AGENT_ROLE.CODER_WORKER]: {
    delegated: true,
    connections: CONNECTION_POLICY.AGENT_SWITCHES,
    skills: false,
    sandbox: SANDBOX_POLICY.PARENT,
  },
} as const satisfies { readonly [Role in AgentRole]: RoleProfile };
