import { SETUP_AUDIENCE, type SetupAudience } from "@repo/settings";

export const SETUP_STEP = {
  WELCOME: "welcome",
  TEAM: "team",
  AGENT: "agent",
  GITHUB: "github",
  TOOLS: "tools",
} as const;

export type SetupStep = (typeof SETUP_STEP)[keyof typeof SETUP_STEP];

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

export const SETUP_GATE = {
  NONE: "none",
  WAIT: "wait",
  OWED: "owed",
} as const;

export type SetupGate = (typeof SETUP_GATE)[keyof typeof SETUP_GATE];

export function setupGate(account: {
  readonly id: string | undefined;
  readonly fresh: boolean;
  readonly finished: boolean;
  readonly accountRead: boolean;
  readonly started: boolean;
  readonly invited: boolean | undefined;
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
