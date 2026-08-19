/**
 * The shared half of every on-demand transcript read: the bounds a rendering
 * must fit and the cut that enforces them. Each provider maps its own records
 * into the one line vocabulary — `Developer:` for the person, the agent's own
 * name for its replies, `→` for a tool call, `←` for its answer, `Error:` for
 * a failure the provider recorded — and this module keeps every rendering the
 * same bounded size however the records differ.
 */

import { isRecord, isWireString, text, type WireRecord } from "@sidecar/core";

export const transcriptLine = {
  developer: (words: string) => `Developer: ${words}`,
  agent: (name: string, words: string) => `${name}: ${words}`,
  toolCall: (name: string, detail?: string) => (detail ? `→ ${name}: ${detail}` : `→ ${name}`),
  toolResult: (answer: string) => `← ${answer}`,
  error: (reason: string) => `Error: ${reason}`,
} as const;

export const TRANSCRIPT_BOUNDS = {
  /** How much of the file's end one read may load. */
  READ_TAIL_BYTES: 256 * 1024,
  /** A rendered message line: enough to carry meaning, not a document. */
  MAXIMUM_MESSAGE_LENGTH: 400,
  /** A rendered tool call or its result: the gist, never the payload. */
  MAXIMUM_TOOL_LENGTH: 200,
  /**
   // SAFETY: The preceding check establishes the asserted contract.
   * The whole rendering. It enters a live conversation as one tool output,
   * so it is sized for answering a question about the session, not for
   * carrying the session.
   */
  MAXIMUM_RENDERED_LENGTH: 8_000,
} as const;

export const OMISSION_MARKER = "[earlier turns omitted]";

export function transcriptContentBlocks(
  record: WireRecord,
  fallbackToRecordContent: boolean,
): WireRecord[] {
  const message = record.message;
  const content = isRecord(message)
    ? message.content
    : fallbackToRecordContent
      ? record.content
      : undefined;
  return Array.isArray(content) ? content.filter(isRecord) : [];
}

export function transcriptMessageText(
  record: WireRecord,
  fallbackToRecordContent: boolean,
): string | undefined {
  const message = record.message;
  const content = isRecord(message)
    ? message.content
    : fallbackToRecordContent
      ? record.content
      : undefined;
  if (isWireString(content)) return text(content);
  const parts = transcriptContentBlocks(record, fallbackToRecordContent)
    .filter((block) => block.type === "text")
    .map((block) => text(block.text))
    .filter((part): part is string => part !== undefined);
  return parts.length > 0 ? parts.join(" ") : undefined;
}

/**
 * Joins rendered lines into one bounded rendering, or nothing when there are
 * no lines to render. The newest turns win the space: a question about a
 * session is almost always about where it is now, so the rendering is cut
 * from the front, at a line, and says so.
 */
export function boundedTranscript(
  lines: readonly string[],
  maximumLength: number,
): string | undefined {
  if (lines.length === 0) return undefined;
  let rendered = lines.join("\n");
  if (rendered.length > maximumLength) {
    const kept = rendered.slice(rendered.length - maximumLength);
    const firstWholeLine = kept.indexOf("\n");
    rendered = `${OMISSION_MARKER}\n${firstWholeLine >= 0 ? kept.slice(firstWholeLine + 1) : kept}`;
  }
  return rendered;
}
