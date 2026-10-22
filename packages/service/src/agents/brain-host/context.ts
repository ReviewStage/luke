import type { DatabaseServices, QueryError } from "@luke/database/core/query";
import { fileMark, keptImageLine, keptImageOf } from "@luke/database/models/attached-file-parts";
import { listRecentMessages } from "@luke/database/models/message-reads";
import type { ConversationTarget } from "@luke/database/models/writer";
import { type FileUIPart, isFileUIPart, isTextUIPart, isToolUIPart, type ToolSet } from "ai";
import { Effect, type Schema } from "effect";
import { MESSAGE_AUTHOR, MESSAGE_ROLE, type StoredUIMessage } from "../../core.js";

/**
 * A conversation's stored messages as the model reads them back: a rotated
 * session is seeded once with the newest messages by `seed.ts`, which is
 * what `storedMessageLine` and `readRecentMessages` are for.
 */

/** Who a stored message's words are attributed to when a stored message is rendered as a line. */
const SPEAKER = {
  DEVELOPER: "Developer",
  LUKE: "Luke",
  NOTE: "Luke's own note",
} as const;

function speakerOf(message: StoredUIMessage): string {
  if (message.role === MESSAGE_ROLE.ASSISTANT) return SPEAKER.LUKE;
  if (message.role === MESSAGE_ROLE.USER) {
    return message.metadata.author === MESSAGE_AUTHOR.DEVELOPER ? SPEAKER.DEVELOPER : SPEAKER.NOTE;
  }
  return SPEAKER.NOTE;
}

/**
 * A file a stored message carried, as its line names it: its mark, then the
 * attachment its image was kept as, in the words the agent was first handed
 * (`attached-file-parts.ts`). Note that a line is words alone, so a session
 * seeded from the rows is told the file was there, and how to name a kept
 * image again, rather than handed its bytes.
 */
function fileWords(part: FileUIPart): string {
  const mark = fileMark(part.filename, part.mediaType);
  const kept = keptImageOf(part);
  return kept === undefined ? mark : `${mark} ${keptImageLine(part.filename ?? "", kept)}`;
}

/** One stored message as a line: its speaker, its words, the files it carried by name, and the tools it called by name. */
export function storedMessageLine(message: StoredUIMessage, maximumChars: number): string {
  const words = message.parts
    .filter((part) => isTextUIPart(part))
    .map((part) => part.text.trim())
    .filter((text) => text.length > 0)
    .join(" ");
  const files = message.parts.filter((part) => isFileUIPart(part)).map(fileWords);
  const tools = message.parts
    .filter((part) => isToolUIPart(part))
    .map((part) => part.type.slice("tool-".length));
  const body = [
    words.length > maximumChars ? `${words.slice(0, maximumChars)}…` : words,
    ...files,
    ...(tools.length > 0 ? [`(called ${tools.join(", ")})`] : []),
  ]
    .filter((piece) => piece.length > 0)
    .join(" ");
  return `${speakerOf(message)}: ${body}`;
}

/**
 * The newest finished messages of a conversation, oldest first, read back
 * through the store's own reader so a row outside the vocabulary refuses the
 * page whole rather than being rendered. The limit is on rows, not words:
 * each line is bounded again when rendered.
 */
export function readRecentMessages(
  target: ConversationTarget,
  tools: ToolSet,
  limit: number,
): Effect.Effect<readonly StoredUIMessage[], QueryError | Schema.SchemaError, DatabaseServices> {
  return Effect.map(
    listRecentMessages(target.userId, target.conversationId, tools, limit),
    (read) => (read.ok ? read.value.map((record) => record.message) : []),
  );
}
