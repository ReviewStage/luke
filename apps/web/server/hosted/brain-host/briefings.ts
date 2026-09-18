import type { ToolSet } from "ai";
import { Effect, type Schema } from "effect";
import type { SqlClient } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import type { RecentBriefing } from "../../core.js";
import { announcedWordsOf } from "../briefing-words.js";
import type { ConversationTarget, HostedStore } from "../store/index.js";
import { BRAIN_HOST } from "./bounds.js";

/**
 * The briefings main's standing context recalls: what observed conversations
 * announced to the developer since the standing main opened and within the
 * window, with the words read back from the announcing rows under the same
 * registry every page is. Two statements a turn: the offers, then the rows
 * they name in one read. A row this build cannot read back leaves the whole
 * section unsaid rather than half-said, since a context that named some
 * briefings and not others would read as the whole of them; the roster still
 * stands, and the next turn reads again.
 */

/** The slice of the store the recall reaches. */
export type BriefingRecallStore = Pick<HostedStore, "speech" | "messages">;

export function readRecentBriefings(
  store: BriefingRecallStore,
  tools: ToolSet,
  main: ConversationTarget,
  now: number,
): Effect.Effect<readonly RecentBriefing[], SqlError | Schema.SchemaError, SqlClient.SqlClient> {
  return Effect.gen(function* () {
    const offers = yield* store.speech.recentBriefings({
      userId: main.userId,
      mainConversationId: main.conversationId,
      since: new Date(now - BRAIN_HOST.RECENT_BRIEFINGS_WINDOW_MS),
      limit: BRAIN_HOST.RECENT_BRIEFINGS,
    });
    if (offers.length === 0) return [];
    const read = yield* store.messages.byIds(
      main.userId,
      tools,
      offers.map((offer) => offer.messageId),
    );
    if (!read.ok) return [];
    const words = new Map(
      read.value.map((record) => [record.id, announcedWordsOf(record.message)] as const),
    );
    return offers.flatMap((offer): RecentBriefing[] => {
      const briefing = words.get(offer.messageId);
      if (briefing === undefined) return [];
      return [
        {
          announcedAt: offer.offeredAt.getTime(),
          session: { providerId: offer.providerId, providerSessionId: offer.providerSessionId },
          title: offer.title ?? undefined,
          words: briefing,
        },
      ];
    });
  });
}
