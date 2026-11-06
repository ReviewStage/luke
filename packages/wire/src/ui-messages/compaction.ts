import type { TextUIPart } from "ai";
import { Result } from "effect";
import { readEither } from "../effect/index.js";
import {
  ASSISTANT_MESSAGE_METADATA,
  type AssistantMessageMetadata,
  type CompactionMetadata,
  MESSAGE_AUTHOR,
  MESSAGE_ROLE,
  unparsedWire,
} from "../index.js";
import type { StoredUIMessage } from "./validate.js";

export interface CompactionSummary {
  readonly text: string;
  readonly firstKeptMessageId: string;
  readonly tokensBefore?: number;
}

export type CompactionMessage = Extract<
  StoredUIMessage,
  { role: typeof MESSAGE_ROLE.ASSISTANT }
> & {
  readonly metadata: AssistantMessageMetadata & { readonly compaction: CompactionMetadata };
};

const TEXT_PART_STATE_DONE = "done";

export function compactionSummaryMessage(
  id: string,
  summary: CompactionSummary,
): CompactionMessage | undefined {
  const text = summary.text.trim();
  if (text.length === 0) return undefined;
  const read = readEither(ASSISTANT_MESSAGE_METADATA)(
    unparsedWire({
      author: MESSAGE_AUTHOR.MODEL,
      compaction: {
        first_kept_message_id: summary.firstKeptMessageId,
        ...(summary.tokensBefore !== undefined
          ? { tokens_before: summary.tokensBefore }
          : undefined),
      },
    }),
  );
  if (Result.isFailure(read) || read.success.compaction === undefined) return undefined;
  const part: TextUIPart = { type: "text", text, state: TEXT_PART_STATE_DONE };
  return {
    id,
    role: MESSAGE_ROLE.ASSISTANT,
    metadata: { author: read.success.author, compaction: read.success.compaction },
    parts: [part],
  };
}
