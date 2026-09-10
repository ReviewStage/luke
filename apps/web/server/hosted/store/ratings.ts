import { and, eq, inArray } from "drizzle-orm";
import {
  CONVERSATION_ENTRY_KIND,
  type ConversationEntry,
  LINE_RATING,
  type LineRating,
  type SessionKey,
} from "../../core.js";
import { conversationLine, conversationLineRating } from "../../db/schema.js";
import { conversationEventKey } from "./conversation-lines.js";
import type { HostedStoreDatabase, UserSeal } from "./database.js";

/**
 * The developer's ratings of Luke's lines. A rating attaches to a line the
 * caller's own conversation holds and Luke authored — a reply or an
 * announcement — by the id its writer minted; a line of any other kind, or
 * one the conversation does not hold, takes none. One rating stands per
 * line, the latest press replacing the one before, with the words the
 * developer added sealed beside it.
 */

/** The kinds a rating may attach to: the lines Luke himself wrote. */
const RATEABLE_KINDS: readonly string[] = [
  CONVERSATION_ENTRY_KIND.REPLY,
  CONVERSATION_ENTRY_KIND.ANNOUNCEMENT,
];

const LINE_RATING_LIST: readonly LineRating[] = Object.values(LINE_RATING);

export interface LineRatingWrite {
  readonly eventId: string;
  readonly rating: LineRating;
  readonly note?: string;
  readonly deviceId: string;
  readonly ratedAt: number;
}

/** Writes the rating, answering false for a line the conversation does not hold or Luke did not author. */
export async function rateConversationLine(
  db: HostedStoreDatabase,
  seal: UserSeal,
  userId: string,
  sessionKey: SessionKey,
  write: LineRatingWrite,
): Promise<boolean> {
  const eventKey = conversationEventKey({
    kind: CONVERSATION_ENTRY_KIND.REPLY,
    words: "",
    eventId: write.eventId,
  });
  const [line] = await db
    .select({ kind: conversationLine.kind })
    .from(conversationLine)
    .where(
      and(
        eq(conversationLine.userId, userId),
        eq(conversationLine.sessionKey, sessionKey),
        eq(conversationLine.eventKey, eventKey),
        inArray(conversationLine.kind, [...RATEABLE_KINDS]),
      ),
    );
  if (!line) return false;
  const columns = {
    rating: write.rating,
    sealedNote: write.note === undefined ? null : seal.seal(write.note),
    deviceId: write.deviceId,
    ratedAt: write.ratedAt,
  };
  await db
    .insert(conversationLineRating)
    .values({ userId, sessionKey, eventKey, ...columns })
    .onConflictDoUpdate({
      target: [
        conversationLineRating.userId,
        conversationLineRating.sessionKey,
        conversationLineRating.eventKey,
      ],
      set: columns,
    });
  return true;
}

/** The rating each rated line carries, by the key the line is idempotent on; a row naming a rating this build does not know is left out. */
export async function listConversationLineRatings(
  db: HostedStoreDatabase,
  userId: string,
  sessionKey: SessionKey,
): Promise<ReadonlyMap<string, LineRating>> {
  const rows = await db
    .select({ eventKey: conversationLineRating.eventKey, rating: conversationLineRating.rating })
    .from(conversationLineRating)
    .where(
      and(
        eq(conversationLineRating.userId, userId),
        eq(conversationLineRating.sessionKey, sessionKey),
      ),
    );
  const ratings = new Map<string, LineRating>();
  for (const row of rows) {
    const rating = LINE_RATING_LIST.find((candidate) => candidate === row.rating);
    if (rating !== undefined) ratings.set(row.eventKey, rating);
  }
  return ratings;
}

/** The rating a line carries, looked up by the line itself. */
export function ratingOf(
  ratings: ReadonlyMap<string, LineRating>,
  entry: ConversationEntry,
): LineRating | undefined {
  return ratings.get(conversationEventKey(entry));
}
