import type { SqlClient } from "@effect/sql";
import type { SqlError } from "@effect/sql/SqlError";
import { Effect, type ParseResult } from "effect";
import {
  type StoreWriter as ComposedStoreWriter,
  type ConversationTarget,
  findMessageByClientId,
  offerSpeech,
} from "../store/index.js";

/**
 * How a briefing `announce` decided to give reaches a device: as a
 * `speech.offered` event on the turn's own assistant message, the journal
 * row the writer opened when the announce call was written ahead of its
 * execution, expiring `SPEECH_OFFER.TTL_MS` after the offer. The words
 * themselves are the call's input on that row; the event says only that
 * they are on offer and until when, and the one `speech.claimed` the schema
 * admits on the same row is what lets one device say them. A journal not yet
 * on the row when the offer arrives refuses the offer rather than inventing
 * a row for it.
 */

export type StoreWriter = ComposedStoreWriter;

export interface BriefingOfferSeams {
  readonly writer: Pick<StoreWriter, "recordEvent">;
  readonly now: () => number;
}

/** Offers the turn's briefing on its journal row; answers whether the offer landed or already stood. */
export function offerBriefing(
  seams: BriefingOfferSeams,
  target: ConversationTarget,
  turnId: string,
): Effect.Effect<boolean, SqlError | ParseResult.ParseError, SqlClient.SqlClient> {
  return Effect.gen(function* () {
    const journal = yield* findMessageByClientId(target.userId, target.conversationId, turnId);
    if (!journal) return false;
    const offered = yield* offerSpeech(
      { writer: seams.writer },
      target.userId,
      journal.id,
      seams.now(),
    );
    return offered.ok;
  });
}
