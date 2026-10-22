import type { DatabaseServices, QueryError } from "@luke/database/core/query";
import { keptImageOf } from "@luke/database/models/attached-file-parts";
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

/** The most characters of a file's name its line spells, so a message's files, at most ten, stay near the bound its words keep. */
const FILE_NAME_CHARS = 80;

/** What a line says of an image that was handed to the agent and not kept, which has no id to name it by. */
const NOT_KEPT_WORDS = "not kept as an attachment";

/**
 * A file a stored message carried, as its line names it: its name, cut to
 * its bound, its type, and the attachment its image was kept as, whole, or
 * that it was not kept (`attached-file-parts.ts`). Note that a line is
 * words alone, so a session seeded from the rows is told the file was
 * there, and how to name a kept image again, rather than handed its bytes.
 */
function fileWords(part: FileUIPart): string {
  const name = part.filename ?? "";
  const shown = name.length > FILE_NAME_CHARS ? `${name.slice(0, FILE_NAME_CHARS)}…` : name;
  const kept = keptImageOf(part);
  const said =
    kept === undefined ? "" : "id" in kept ? `, attachment ${kept.id}` : `, ${NOT_KEPT_WORDS}`;
  return `[file: ${shown} (${part.mediaType})${said}]`;
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
