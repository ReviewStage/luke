import type { HostedStoreRun } from "../store/database.js";
import {
  type ConversationTarget,
  findMessageByClientId,
  offerSpeech,
  type storeWriter,
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

export type StoreWriter = Awaited<ReturnType<typeof storeWriter>>;

export interface BriefingOfferSeams {
  /** The runner the speech module's own reads are answered through. */
  readonly run: HostedStoreRun;
  readonly writer: Pick<StoreWriter, "recordEvent">;
  readonly now: () => number;
}

/** Offers the turn's briefing on its journal row; answers whether the offer landed or already stood. */
export async function offerBriefing(
  seams: BriefingOfferSeams,
  target: ConversationTarget,
  turnId: string,
): Promise<boolean> {
  const journal = await seams.run(
    findMessageByClientId(target.userId, target.conversationId, turnId),
  );
  if (!journal) return false;
  const offered = await offerSpeech(
    { run: seams.run, writer: seams.writer },
    target.userId,
    journal.id,
    seams.now(),
  );
  return offered.ok;
}
