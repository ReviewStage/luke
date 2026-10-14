import { TURN_ORIGIN } from "@sidecar/wire";

/**
 * The origins a developer's question may open a turn under on the hosted
 * tier: typed or spoken, and nothing else opens a turn this way; every other
 * origin is Luke's own.
 */
export const ASK_ORIGIN = {
  TYPED: TURN_ORIGIN.TYPED,
  SPOKEN: TURN_ORIGIN.SPOKEN,
} as const satisfies Partial<typeof TURN_ORIGIN>;

export type AskOrigin = (typeof ASK_ORIGIN)[keyof typeof ASK_ORIGIN];
