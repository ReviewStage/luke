import {
  ASSISTANT_MESSAGE_METADATA,
  type AssistantMessageMetadata,
  type CompactionMetadata,
  MESSAGE_AUTHOR,
  MESSAGE_ROLE,
  unparsedWire,
} from "@sidecar/wire";
import { readEither } from "@sidecar/wire/effect";
import type { TextUIPart } from "ai";
import { Either } from "effect";
import type { StoredUIMessage } from "./validate.js";

/**
 * Compaction, as the store keeps it: one assistant message whose text is the
 * summary the compaction model wrote of the messages before it, carrying in
 * its metadata the first message the model still reads verbatim after it and,
 * where the runtime counted them, the tokens the folded messages had cost —
 * absent otherwise, never zero. The context the model is shown is
 * every message from the latest such row onward, so the row is the one place
 * a fold leaves its mark: nothing before it is erased, no provider-side
 * compaction item stands in for it, and a reader that wants the whole record
 * has it. The runtime that owns compaction reports the fold as an event and
 * the checkpoint text through its memory seam; this module turns what those
 * two carry into the row, and knows nothing of either runtime.
 */

/** What one completed compaction folded, as the runtime reports it and the writer knows it. */
export interface CompactionSummary {
  /** The summary the compaction model wrote, the checkpoint the model continues from. */
  readonly text: string;
  /** The first stored message the model still reads verbatim after the summary. */
  readonly firstKeptMessageId: string;
  /** The input tokens the folded messages had cost, as the runtime's own compaction request counted them; absent where it did not say. */
  readonly tokensBefore?: number;
}

/** An assistant row standing in for the rows before it: its metadata names what it folded. */
export type CompactionMessage = Extract<
  StoredUIMessage,
  { role: typeof MESSAGE_ROLE.ASSISTANT }
> & {
  readonly metadata: AssistantMessageMetadata & { readonly compaction: CompactionMetadata };
};

/** The one state a stored text part carries: written whole, never mid-stream. */
const TEXT_PART_STATE_DONE = "done";

/**
 * The compaction row for one completed fold, or nothing when the summary has
 * no words or the metadata would not read back: a summary with nothing in it
 * would stand in for the folded rows and say nothing, and a row the reader
 * would refuse is not worth writing. The metadata is held to the one schema
 * the reader holds it to, so this builder states no second rule about it.
 */
export function compactionSummaryMessage(
  id: string,
  summary: CompactionSummary,
): CompactionMessage | undefined {
  const text = summary.text.trim();
  if (text.length === 0) return undefined;
  const read = readEither(ASSISTANT_MESSAGE_METADATA)(
    unparsedWire({
      author: MESSAGE_AUTHOR.BRAIN,
      compaction: {
        first_kept_message_id: summary.firstKeptMessageId,
        ...(summary.tokensBefore !== undefined
          ? { tokens_before: summary.tokensBefore }
          : undefined),
      },
    }),
  );
  if (Either.isLeft(read) || read.right.compaction === undefined) return undefined;
  const part: TextUIPart = { type: "text", text, state: TEXT_PART_STATE_DONE };
  return {
    id,
    role: MESSAGE_ROLE.ASSISTANT,
    metadata: { author: read.right.author, compaction: read.right.compaction },
    parts: [part],
  };
}

/** Whether a stored row is a compaction: an assistant row whose metadata names what it folded. */
export function isCompactionMessage(message: StoredUIMessage): message is CompactionMessage {
  return message.role === MESSAGE_ROLE.ASSISTANT && message.metadata.compaction !== undefined;
}
