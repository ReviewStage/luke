/**
 * setup-model.ts -- a new account's setup: who it is for, the steps that follows from, and whether the window owes it.
 *
 * Setup stands once, in the window after sign-in, for an account with no
 * task in any workspace and nothing waiting on it, until it is finished on
 * this machine. An account invited into a team's workspace that already
 * holds tasks never sees it.
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

/** Whether the window owes setup: a fresh account, signed in, that has not finished it on this machine. */
export function setupOwed(account: {
  readonly id: string | undefined;
  readonly fresh: boolean;
  readonly finished: readonly string[];
}): boolean {
  return account.id !== undefined && account.fresh && !account.finished.includes(account.id);
}
