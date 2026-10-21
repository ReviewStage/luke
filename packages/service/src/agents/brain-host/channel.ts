import type { TurnPolicy } from "eve/channels";

/**
 * channel.ts -- the two ways eve can take a message that arrives while the session's turn is under way.
 *
 * The coding agent's channel names which it runs under (`../coder-host/channel.ts`).
 */
export const BRAIN_HOST_TURN_POLICY = {
  /** The message joins the turn under way: a parked turn resumes on it at once, and a model call still generating is cut short and run again with it. */
  STEER: "steer",
  /** The message waits for the turn to end and opens the next. */
  QUEUE: "queue",
} as const satisfies Record<string, TurnPolicy>;
