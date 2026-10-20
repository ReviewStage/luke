import { CHANNEL_KIND } from "@luke/features/chat-wire";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { Database } from "../core/query.js";
import { chatChannel } from "../schemas/chat.js";

/**
 * chat-dms.ts -- a DM as one the chat made before it held none stands in the store, for a test that holds the chat reads it nowhere.
 *
 * The chat makes and takes no direct messages now, so a test cannot post
 * one; it posts in a channel of its own and turns that channel into the
 * DM a build before made, its two members in the order the table keeps
 * them, so what stands in it is a DM's words as they were left.
 */

/** Turns the channel into a DM between the two members, as a DM made before stands. */
export const turnIntoDm = (channelId: string, oneMemberId: string, otherMemberId: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const [a, b] =
      oneMemberId < otherMemberId ? [oneMemberId, otherMemberId] : [otherMemberId, oneMemberId];
    yield* db
      .update(chatChannel)
      .set({ kind: CHANNEL_KIND.DM, name: null, purpose: null, dmAMemberId: a, dmBMemberId: b })
      .where(eq(chatChannel.id, channelId));
  });
