/**
 * transcript.ts -- the kinds of conversation a device may hold a transcript of.
 *
 * Beside the Conversation a device may hold one transcript open: a child's,
 * the conversation a delegation opened, or an observed one, the brain's own
 * turns about a coding-agent session it follows. Both are read through the
 * one transcript read the service keeps; the kind says which list names the
 * conversation, and so which head moving means its transcript has more to
 * read. Declared here so the host that pages the transcript, the gateway the
 * open crosses, and the panel that asked all spell the same words.
 */

export const TRANSCRIPT_KIND = {
  CHILD: "child",
  OBSERVED: "observed",
} as const;

export type TranscriptKind = (typeof TRANSCRIPT_KIND)[keyof typeof TRANSCRIPT_KIND];
