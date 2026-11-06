/**
 * setup-model.ts -- a new account's setup: who it is for, the steps that follows from, and whether the window owes it.
 *
 * Setup stands once, in the window after sign-in, for a new account (see
 * `setupGate`), until it is finished. An account invited into a team's
 * workspace with no agent connected walks its Connect an agent step alone.
 */

import { SETUP_AUDIENCE, type SetupAudience } from "@repo/settings";

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
  switch (audience) {
    case SETUP_AUDIENCE.TEAM:
      return [
        SETUP_STEP.WELCOME,
        SETUP_STEP.TEAM,
        SETUP_STEP.AGENT,
        SETUP_STEP.GITHUB,
        SETUP_STEP.TOOLS,
      ];
    case SETUP_AUDIENCE.INVITED:
      return [SETUP_STEP.AGENT];
    case SETUP_AUDIENCE.ME:
      return [SETUP_STEP.WELCOME, SETUP_STEP.AGENT, SETUP_STEP.GITHUB, SETUP_STEP.TOOLS];
  }
}

/** What the window does about setup: nothing, wait on what it still reads, or stand setup before the app. */
export const SETUP_GATE = {
  NONE: "none",
  WAIT: "wait",
  OWED: "owed",
} as const;

export type SetupGate = (typeof SETUP_GATE)[keyof typeof SETUP_GATE];

/**
 * Whether the window owes setup. It is owed to an account signed in with no
 * agent connected, since nothing runs without one: one that holds no task and
 * belongs to no team's workspace, so an account that has worked before is
 * never set up again on another machine, or one invited into a team's
 * workspace, whose teammates' tasks it holds, which is asked for an agent
 * alone. Finished is the account's, so it holds on every machine, and so is
 * where setup stands: once setup has started on any machine it stands until
 * finished, whatever it has connected or made meanwhile. Until the account's
 * preferences are read, which say whether it started or finished on another
 * machine, its workspaces, which say whether a team invited it, and the
 * agent's read answer, a new account waits on them rather than glimpsing
 * setup or the app, even with an agent connected; one a team invited is let
 * in meanwhile, since most have an agent.
 */
export function setupGate(account: {
  readonly id: string | undefined;
  readonly fresh: boolean;
  /** Whether the account finished setup, on any machine. */
  readonly finished: boolean;
  /** Whether the account's preferences were read, so `finished` and `started` speak for every machine. */
  readonly accountRead: boolean;
  /** Whether setup started for the account, on any machine. */
  readonly started: boolean;
  /** Whether the account belongs to a team's workspace; nothing while its workspaces are still read. */
  readonly invited: boolean | undefined;
  /** Whether an agent is connected; nothing while the models are still read. */
  readonly agent: boolean | undefined;
}): SetupGate {
  if (account.id === undefined || account.finished) return SETUP_GATE.NONE;
  if (account.started) return account.accountRead ? SETUP_GATE.OWED : SETUP_GATE.WAIT;
  if (account.agent === true) {
    return account.fresh && !account.accountRead ? SETUP_GATE.WAIT : SETUP_GATE.NONE;
  }
  if (account.invited === true) {
    return account.accountRead && account.agent === false ? SETUP_GATE.OWED : SETUP_GATE.NONE;
  }
  if (!account.fresh) return SETUP_GATE.NONE;
  const unread =
    !account.accountRead || account.invited === undefined || account.agent === undefined;
  return unread ? SETUP_GATE.WAIT : SETUP_GATE.OWED;
}
