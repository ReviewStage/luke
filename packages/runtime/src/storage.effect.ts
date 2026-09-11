/**
 * The storage contracts' wire codecs in Effect's own terms. `storage.ts` is
 * a faithful port of OpenClaw `b7528507`'s conversation directory shapes and
 * imports nothing from `effect`, so its Effect surface lives here beside it:
 * the two `fromWire` readers restated as effects that fail with a typed
 * refusal instead of answering `undefined`, so a caller composing a store
 * read gets a reason it can report rather than a value it must re-check.
 *
 * This is the OpenClaw-wrap shape from `queue.effect.ts`: a sibling named for
 * the ported file, wrapping its exported API and reaching inside none of it.
 */
import type { UnparsedWireValue } from "@sidecar/wire";
import { Data, Effect } from "effect";
import {
  type ConversationArchiveRecord,
  type ConversationRecord,
  conversationArchiveRecordFromWire,
  conversationRecordFromWire,
} from "./storage.js";

/** Which stored shape a wire value failed to read back as. */
export const STORAGE_DECODE_REFUSAL = {
  CONVERSATION_RECORD: "conversation-record",
  CONVERSATION_ARCHIVE_RECORD: "conversation-archive-record",
} as const;

export type StorageDecodeRefusal =
  (typeof STORAGE_DECODE_REFUSAL)[keyof typeof STORAGE_DECODE_REFUSAL];

export class StorageDecodeRefused extends Data.TaggedError("StorageDecodeRefused")<{
  readonly code: StorageDecodeRefusal;
  readonly value: UnparsedWireValue;
}> {}

/** Reads a conversation directory row back from the wire, or fails with what it was not. */
export const decodeConversationRecord = (
  value: UnparsedWireValue,
): Effect.Effect<ConversationRecord, StorageDecodeRefused> =>
  Effect.suspend(() => {
    const record = conversationRecordFromWire(value);
    if (record !== undefined) return Effect.succeed(record);
    return Effect.fail(
      new StorageDecodeRefused({ code: STORAGE_DECODE_REFUSAL.CONVERSATION_RECORD, value }),
    );
  });

/** Reads a deleted conversation's archive row back from the wire, or fails with what it was not. */
export const decodeConversationArchiveRecord = (
  value: UnparsedWireValue,
): Effect.Effect<ConversationArchiveRecord, StorageDecodeRefused> =>
  Effect.suspend(() => {
    const record = conversationArchiveRecordFromWire(value);
    if (record !== undefined) return Effect.succeed(record);
    return Effect.fail(
      new StorageDecodeRefused({
        code: STORAGE_DECODE_REFUSAL.CONVERSATION_ARCHIVE_RECORD,
        value,
      }),
    );
  });
