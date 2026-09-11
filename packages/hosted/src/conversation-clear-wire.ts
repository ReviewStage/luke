import { RECORD_EXTRA_KEYS, type Schema, s } from "@sidecar/wire";
import { countedNumber, wireUuidSchema } from "./service-wire.js";

/**
 * What Clear answers: the main conversation the service opened in place of
 * the one it stamped, the instant it opened — which is where the view's
 * window now starts, so a device can take the Clear to its own screen from
 * this answer alone rather than wait on a read that may not land — and how
 * many conversations the stamp reached: the main and every descendant of
 * it, or none when no main stood. Nothing of the stamped rows travels back;
 * the reads simply stop listing them.
 */
export interface ConversationClearAnswer {
  readonly opened: string;
  /** Epoch milliseconds; the same instant the messages answer's main entry carries as `openedAt`. */
  readonly openedAt: number;
  readonly cleared: number;
}

export const conversationClearAnswerSchema: Schema<ConversationClearAnswer> = s.record(
  { opened: wireUuidSchema, openedAt: countedNumber, cleared: s.wholeNumber({ minimum: 0 }) },
  { extraKeys: RECORD_EXTRA_KEYS.IGNORE },
);
