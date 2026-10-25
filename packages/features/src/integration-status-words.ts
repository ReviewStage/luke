/**
 * integration-status-words.ts -- what an integration connection's status is called wherever a surface says it.
 *
 * One map beside `words.ts`, keyed on the wire's `INTEGRATION_STATUS`, so the
 * admin pages and, in time, Settings' rows read the same word for a status. A
 * status with no word of its own (no connection, or none offered) says
 * nothing, so it is not here.
 */

import { INTEGRATION_STATUS } from "./integration-wire.js";

/** What a connection stands as, in a word: connected, a sign-in under way, or one whose grant stopped working. */
export const INTEGRATION_STATUS_WORDS = {
  [INTEGRATION_STATUS.CONNECTED]: "Connected",
  [INTEGRATION_STATUS.PENDING]: "Connecting",
  [INTEGRATION_STATUS.EXPIRED]: "Sign-in expired",
} as const;
