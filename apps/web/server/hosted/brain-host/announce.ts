import { CONVERSATION_EVENT_KIND } from "../../core.js";
import type { HostedStoreDatabase } from "../store/database.js";
import {
  type ConversationTarget,
  findMessageByClientId,
  type storeWriter,
} from "../store/index.js";

/**
 * How a briefing `announce` decided to give reaches a device: as an event on
 * the turn's own assistant message, the journal row the writer opened when
 * the announce call was written ahead of its execution. The words themselves
 * are the call's input on that row; the event says only that they are on
 * offer, and the reply-grant ledger's claim on the same row is what lets one
 * device say them. A journal not yet on the row when the offer arrives
 * refuses the offer rather than inventing a row for it.
 */

export type StoreWriter = Awaited<ReturnType<typeof storeWriter>>;

export interface BriefingOfferSeams {
  readonly db: HostedStoreDatabase;
  readonly writer: Pick<StoreWriter, "recordEvent">;
}

/** Offers the turn's briefing on its journal row; answers whether the offer landed. */
export async function offerBriefing(
  seams: BriefingOfferSeams,
  target: ConversationTarget,
  turnId: string,
): Promise<boolean> {
  const journal = await findMessageByClientId(
    seams.db,
    target.userId,
    target.conversationId,
    turnId,
  );
  if (!journal) return false;
  const recorded = await seams.writer.recordEvent(target, {
    messageId: journal.id,
    kind: CONVERSATION_EVENT_KIND.SPEECH_OFFERED,
  });
  return recorded.ok;
}
