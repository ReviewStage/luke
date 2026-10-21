import { LUKE_HANDLE, MEMBER_KIND } from "@luke/features/chat-wire";
import { DateTime, Effect } from "effect";
import { Database } from "../core/query.js";
import { chatMember } from "../schemas/chat.js";

/**
 * chat-members.ts -- a task's Luke as a member of its workspace's chat, written as one minted while a task had its own Luke stands.
 *
 * Nothing mints a task's Luke now (`models/chat-store.ts`), but the members
 * minted before stand with the messages they wrote, so a test of how old
 * chat history still reads writes one straight over the table.
 */

/** A task's Luke in the workspace, as an old row stands: its handle `luke`, the next ordinal given, still hearing. Answers the row's id. */
export const insertFormerLuke = (organizationId: string, taskId: string, ordinal = 1) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const now = yield* DateTime.nowAsDate;
    const [row] = yield* db
      .insert(chatMember)
      .values({
        organizationId,
        kind: MEMBER_KIND.LUKE,
        taskId,
        handle: LUKE_HANDLE,
        ordinal,
        joinedAt: now,
      })
      .returning({ id: chatMember.id });
    if (row === undefined) return yield* Effect.die(new Error("no member row was written"));
    return row.id;
  });
