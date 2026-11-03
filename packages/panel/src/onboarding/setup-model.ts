/**
 * setup-model.ts -- a new account's setup: who it is for, the steps that follows from, and whether the window owes it.
 *
 * Setup stands once, in the window after sign-in, for a new account (see
 * `setupGate`), until it is finished. An account invited into a team's
 * workspace never sees it.
 */

/** Who the account is set up for, as setup's first step asks. */
export const SETUP_AUDIENCE = {
  ME: "me",
  TEAM: "team",
} as const;

export type SetupAudience = (typeof SETUP_AUDIENCE)[keyof typeof SETUP_AUDIENCE];

/** Setup's steps, each a card of its own. */
export const SETUP_STEP = {
  WELCOME: "welcome",
  TEAM: "team",
  AGENT: "agent",
  GITHUB: "github",
  TOOLS: "tools",
} as const;

export type SetupStep = (typeof SETUP_STEP)[keyof typeof SETUP_STEP];

/**
 * The steps an account set up for `audience` walks, in order. Note that a
 * team's workspace is made before GitHub, because the App is installed on
 * the workspace the agents will work in.
 */
export function setupSteps(audience: SetupAudience): readonly SetupStep[] {
  return audience === SETUP_AUDIENCE.TEAM
    ? [SETUP_STEP.WELCOME, SETUP_STEP.TEAM, SETUP_STEP.AGENT, SETUP_STEP.GITHUB, SETUP_STEP.TOOLS]
    : [SETUP_STEP.WELCOME, SETUP_STEP.AGENT, SETUP_STEP.GITHUB, SETUP_STEP.TOOLS];
}

/** What the window does about setup: nothing, wait on what it still reads, or stand setup before the app. */
export const SETUP_GATE = {
  NONE: "none",
  WAIT: "wait",
  OWED: "owed",
} as const;

export type SetupGate = (typeof SETUP_GATE)[keyof typeof SETUP_GATE];

/**
 * Whether the window owes setup. An account is new where it is signed in,
 * holds no task, belongs to no team's workspace, and has no agent connected,
 * since nothing runs without one, so an account that has worked before is
 * never set up again on another machine. Once setup has started on this
 * machine it stands until finished, whatever it has connected or made
 * meanwhile; until the agent's read answers, a new account waits on it
 * rather than glimpsing the app.
 */
export function setupGate(account: {
  readonly id: string | undefined;
  readonly fresh: boolean;
  readonly finished: readonly string[];
  readonly started: boolean;
  readonly personalOnly: boolean;
  /** Whether an agent is connected; nothing while the models are still read. */
  readonly agent: boolean | undefined;
}): SetupGate {
  if (account.id === undefined || !account.fresh || account.finished.includes(account.id)) {
    return SETUP_GATE.NONE;
  }
  if (account.started) return SETUP_GATE.OWED;
  if (!account.personalOnly) return SETUP_GATE.NONE;
  if (account.agent === undefined) return SETUP_GATE.WAIT;
  return account.agent ? SETUP_GATE.NONE : SETUP_GATE.OWED;
}
