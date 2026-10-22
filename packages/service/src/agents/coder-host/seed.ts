/**
 * seed.ts -- the conversation so far, which a coding agent's session opened afresh is handed, whichever runtime answers it.
 *
 * eve hands it as a user-role instruction as a new session starts
 * (`apps/dev/instructions/seed.ts`, through `host.ts`'s `seed`). A native
 * harness has no such hook, so its sessions put it ahead of the first
 * message line a fresh CLI session is handed, one with no session of its
 * own to resume (`native-agent-sessions.ts`). The text is
 * `../brain-host/seed.ts`'s.
 */

import type { DatabaseServices, QueryError } from "@luke/database/core/query";
import { listRecentMessages, type StoredMessageRecord } from "@luke/database/models/message-reads";
import type { ConversationTarget } from "@luke/database/models/writer";
import { Effect, type Schema } from "effect";
import { MESSAGE_ROLE } from "../../core.js";
import { BRAIN_HOST } from "../brain-host/bounds.js";
import { rotationSeedText } from "../brain-host/seed.js";
import { CODER_TOOL_SET } from "./tool-set.js";

/** Whether a stored row is a line awaiting its turn: a user's words no turn has taken yet (`writer.ts`'s `takeAwaitingLine`). */
function awaitsTurn(record: StoredMessageRecord): boolean {
  return record.message.role === MESSAGE_ROLE.USER && record.turnId === undefined;
}

/**
 * The conversation so far, for a session opened afresh over a conversation
 * that already has words on record: its newest messages but a line still
 * awaiting its turn, which is the message the session opens on; nothing
 * where nothing else was said.
 */
export const conversationSeed = (
  target: ConversationTarget,
  now: number,
): Effect.Effect<string | undefined, QueryError | Schema.SchemaError, DatabaseServices> =>
  Effect.map(
    listRecentMessages(
      target.userId,
      target.conversationId,
      CODER_TOOL_SET,
      BRAIN_HOST.SEED_MESSAGES,
    ),
    (read) =>
      rotationSeedText(
        read.ok
          ? read.value.filter((record) => !awaitsTurn(record)).map((record) => record.message)
          : [],
        now,
      ),
  );
