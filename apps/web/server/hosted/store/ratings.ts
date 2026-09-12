import type { SqlClient } from "@effect/sql";
import type { SqlError } from "@effect/sql/SqlError";
import { Effect, type ParseResult } from "effect";
import {
  CONVERSATION_EVENT_KIND,
  type HostedMessageRatingRequest,
  MESSAGE_ROLE,
  unparsedWire,
} from "../../core.js";
import { messageAuthorship } from "./message-reads.js";
import { STORE_WRITE_REFUSAL, type StoreWriter } from "./writer.js";

/**
 * A rating is an event on one of Luke's messages, recorded through the store
 * writer like every other event: numbered by the conversation's event
 * sequence, appended and never updated, so a developer who rates a message
 * twice leaves two facts and a read takes the newer. Two refusals stand in
 * front of the write, and they are different checks. A message the caller
 * does not own — another account's, or one in a conversation the Clear
 * stamped — reads as no message at all, so nothing of it is learned. A
 * message the caller owns but did not receive from Luke — their own ask,
 * or the brain's observation note — is theirs and still not rateable. The
 * line is whether Luke said it to the developer: an observation note is the
 * brain writing to itself and a compaction summary is bookkeeping, so a
 * verdict on either would mean nothing anyone could act on, and a "why was
 * this rated down" that joined back to one would be noise where the rating
 * exists to be signal. Only an assistant row that is not a compaction is
 * Luke's words, whichever of Luke's parts wrote it.
 *
 * The read and the write are both effects over the ambient client, so the
 * whole rating — the authorship check and the event it clears the way for —
 * composes into the one request the caller is already running.
 */

export const RATING_REFUSAL = {
  /** No message by that id stands for this account. */
  NOT_FOUND: "not_found",
  /** The message is the caller's, but not one of Luke's. */
  NOT_LUKES: "not_lukes",
} as const;

type RatingRefusal = (typeof RATING_REFUSAL)[keyof typeof RATING_REFUSAL];

export type RatingWriteResult =
  | { readonly ok: true; readonly id: string; readonly seq: number }
  | { readonly ok: false; readonly refusal: RatingRefusal };

export interface RatingStore {
  readonly writer: StoreWriter;
}

export function rateMessage(
  { writer }: RatingStore,
  userId: string,
  messageId: string,
  rating: HostedMessageRatingRequest,
): Effect.Effect<RatingWriteResult, SqlError | ParseResult.ParseError, SqlClient.SqlClient> {
  return Effect.gen(function* () {
    const authorship = yield* messageAuthorship(userId, messageId);
    if (authorship === undefined) return { ok: false, refusal: RATING_REFUSAL.NOT_FOUND };
    if (authorship.role !== MESSAGE_ROLE.ASSISTANT || authorship.compaction) {
      return { ok: false, refusal: RATING_REFUSAL.NOT_LUKES };
    }
    const { deviceId, ...payload } = rating;
    const written = yield* writer.recordEvent(
      { userId, conversationId: authorship.conversationId },
      {
        messageId,
        kind: CONVERSATION_EVENT_KIND.RATING,
        deviceId,
        payload: unparsedWire(payload),
      },
    );
    if (written.ok) return { ok: true, id: written.id, seq: written.seq };
    switch (written.refusal) {
      case STORE_WRITE_REFUSAL.NO_CONVERSATION:
      case STORE_WRITE_REFUSAL.NO_MESSAGE:
        return { ok: false, refusal: RATING_REFUSAL.NOT_FOUND };
      case STORE_WRITE_REFUSAL.ALREADY_CLAIMED:
        return yield* Effect.die(
          new Error("a rating was refused as a claim, which only a speech.claimed event can be"),
        );
      case STORE_WRITE_REFUSAL.SUPERSEDED:
        return yield* Effect.die(
          new Error(
            "a rating was refused as superseded, and a rating names nothing that excludes it",
          ),
        );
    }
  });
}
