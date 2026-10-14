import { TURN_ORIGIN } from "@sidecar/wire";

/**
 * The origins a turn handed to Luke from outside his own session may open
 * under on the hosted tier: a developer's question, typed or spoken, and a
 * rollout worker's report, which the deployment hands him on the plan's
 * conversation; every other origin is Luke's own.
 */
export const ASK_ORIGIN = {
  TYPED: TURN_ORIGIN.TYPED,
  SPOKEN: TURN_ORIGIN.SPOKEN,
  REPORT: TURN_ORIGIN.REPORT,
} as const satisfies Partial<typeof TURN_ORIGIN>;

export type AskOrigin = (typeof ASK_ORIGIN)[keyof typeof ASK_ORIGIN];
