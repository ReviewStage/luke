import { CONVERSATION_ENTRY_KIND } from "@sidecar/session";
import { RECORD_EXTRA_KEYS, type Schema, s, TEXT_ENDS } from "@sidecar/wire";
import { countedNumber, writtenText } from "./service-wire.js";

/**
 * The Conversation as the service answers it (GET): the lines the panel
 * draws, in the line shape the session package keeps, each carrying the
 * rating the developer gave it when they gave one, and a cursor for the
 * lines newer than the last answer. The service projects what the panel
 * projects — the most recent lines inside their retention — and the cursor
 * is the newest line's instant, so a client asks for what it has not seen by
 * naming when it last looked.
 */

export const LINE_RATING = {
  UP: "up",
  DOWN: "down",
} as const;

export type LineRating = (typeof LINE_RATING)[keyof typeof LINE_RATING];

const LINE_RATING_LIST = Object.values(LINE_RATING);

export const lineRatingSchema: Schema<LineRating> = s.enumOf(LINE_RATING_LIST, {
  ends: TEXT_ENDS.TRIM,
});

export interface HostedConversationLine {
  kind: (typeof CONVERSATION_ENTRY_KIND)[keyof typeof CONVERSATION_ENTRY_KIND];
  /** The line's id as its writer minted it; what a rating names. */
  eventId?: string;
  words: string;
  identity?: { providerId: string; providerSessionId: string };
  recordedAt: number;
  requestId?: string;
  rating?: LineRating;
}

export interface HostedConversationLinesAnswer {
  lines: HostedConversationLine[];
  /** The newest line's instant, for the next read's `after`; absent when no line stands. */
  cursor?: number;
}

const conversationLineSchema: Schema<HostedConversationLine> = s.record(
  {
    kind: s.enumOf(Object.values(CONVERSATION_ENTRY_KIND), { ends: TEXT_ENDS.TRIM }),
    eventId: s.dropRefused(writtenText),
    words: s.text({ ends: TEXT_ENDS.KEEP, allowEmpty: true }),
    identity: s.dropRefused(
      s.record(
        { providerId: writtenText, providerSessionId: writtenText },
        { extraKeys: RECORD_EXTRA_KEYS.IGNORE },
      ),
    ),
    recordedAt: countedNumber,
    requestId: s.dropRefused(writtenText),
    rating: s.dropRefused(lineRatingSchema),
  },
  { extraKeys: RECORD_EXTRA_KEYS.IGNORE },
);

/** A malformed line is skipped, not fatal. */
export const hostedConversationLinesAnswerSchema: Schema<HostedConversationLinesAnswer> = s.record(
  {
    lines: s.array(conversationLineSchema, { skipRefused: true }),
    cursor: s.dropRefused(countedNumber),
  },
  { extraKeys: RECORD_EXTRA_KEYS.IGNORE },
);

/** The query a read names the lines newer than a cursor with. */
export const HOSTED_CONVERSATION_QUERY = {
  AFTER: "after",
} as const;

/** What the Clear answers. */
export interface HostedConversationClearAnswer {
  cleared: boolean;
}

export const hostedConversationClearAnswerSchema: Schema<HostedConversationClearAnswer> = s.record(
  { cleared: s.boolean() },
  { extraKeys: RECORD_EXTRA_KEYS.IGNORE },
);

/** How long the developer's words about a rating may run. */
export const LINE_RATING_NOTE_BOUNDS = { MAXIMUM_CHARS: 2_000 } as const;

/**
 * One rating of one line Luke authored (PUT): the thumb, the developer's
 * optional words, and the device it was pressed on. The line is named in the
 * path by the id its writer minted; only a line the caller's own conversation
 * holds and Luke authored takes one.
 */
export interface HostedLineRatingRequest {
  rating: LineRating;
  note?: string;
  deviceId: string;
}

export const hostedLineRatingRequestSchema: Schema<HostedLineRatingRequest> = s.record(
  {
    rating: lineRatingSchema,
    note: s.text({ max: LINE_RATING_NOTE_BOUNDS.MAXIMUM_CHARS, ends: TEXT_ENDS.TRIM }).optional(),
    deviceId: s.text({ max: 64 }),
  },
  { extraKeys: RECORD_EXTRA_KEYS.REFUSE },
);

export interface HostedLineRatingAnswer {
  rated: boolean;
}

export const hostedLineRatingAnswerSchema: Schema<HostedLineRatingAnswer> = s.record(
  { rated: s.boolean() },
  { extraKeys: RECORD_EXTRA_KEYS.IGNORE },
);
