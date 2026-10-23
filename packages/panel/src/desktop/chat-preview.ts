/**
 * A chat message's words as the rail's row previews them: one plain line,
 * its Markdown read by the same parser the message is drawn with, so what
 * the preview drops is exactly the marks the message never shows, and every
 * word it does show (a code span's, an identifier's underscores, a lone
 * star) stays as written.
 */

import { CHAT_BLOCK, type ChatMessage } from "@luke/features/chat-wire";
import { markdownWords } from "@luke/ui/markdown-words";

/** A message's words as a row previews them, one line: its Markdown read as plain words, a chip as its label; a picture alone by its words. */
export function previewWords(message: ChatMessage): string {
  const words = message.blocks.map((block) =>
    block.type === CHAT_BLOCK.MARKDOWN && "text" in block
      ? markdownWords(block.text)
      : block.type === CHAT_BLOCK.IMAGE && "alt" in block
        ? block.alt
        : block.type === CHAT_BLOCK.LINK && "label" in block
          ? block.label
          : "",
  );
  return words.join(" ").replace(/\s+/gu, " ").trim();
}
