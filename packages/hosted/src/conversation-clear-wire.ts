import { RECORD_EXTRA_KEYS, type Schema, s } from "@sidecar/wire";
import { wireUuidSchema } from "./service-wire.js";

/**
 * What Clear answers: the main conversation the service opened in place of
 * the one it stamped, and how many conversations the stamp reached — the
 * main and every descendant of it, or none when no main stood. Nothing of the
 * stamped rows travels back; the reads simply stop listing them.
 */
export interface ConversationClearAnswer {
  readonly opened: string;
  readonly cleared: number;
}

export const conversationClearAnswerSchema: Schema<ConversationClearAnswer> = s.record(
  { opened: wireUuidSchema, cleared: s.wholeNumber({ minimum: 0 }) },
  { extraKeys: RECORD_EXTRA_KEYS.IGNORE },
);
