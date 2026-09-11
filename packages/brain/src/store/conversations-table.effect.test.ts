import assert from "node:assert/strict";
import * as Client from "@effect/sql/SqlClient";
import { describe, it } from "@effect/vitest";
import {
  ARCHIVE_REASON,
  CONVERSATION_KIND,
  DEFAULT_AGENT_ID,
  MAIN_SESSION_KEY,
  sessionKey,
  threadSessionKey,
} from "@sidecar/runtime/vocabulary";
import { Effect } from "effect";
import {
  archiveConversationEffect,
  conversationRecordEffect,
  createConversationEffect,
  listConversationsEffect,
  pinConversationEffect,
  unarchiveConversationEffect,
} from "./conversations-table.js";
import { NOW, overStore } from "./testing.js";

const THREAD = threadSessionKey("thread-a");

describe("the conversation directory over the client", () => {
  it.effect("round-trips a created conversation through its row", () =>
    overStore(
      Effect.gen(function* () {
        const created = yield* createConversationEffect({
          agentId: DEFAULT_AGENT_ID,
          sessionKey: THREAD,
          name: "a thread",
          now: NOW + 1,
        });

        const read = yield* conversationRecordEffect(THREAD);
        const listed = yield* listConversationsEffect;

        assert.deepEqual(read, created);
        assert.deepEqual(read, {
          sessionKey: THREAD,
          kind: CONVERSATION_KIND.THREAD,
          name: "a thread",
          createdAt: NOW + 1,
          lastActivityAt: NOW + 1,
        });
        assert.deepEqual(
          listed.map((record) => record.sessionKey),
          [MAIN_SESSION_KEY, THREAD],
        );
      }),
    ),
  );

  it.effect("answers the standing record for a creation at a key that already holds one", () =>
    overStore(
      Effect.gen(function* () {
        yield* createConversationEffect({
          agentId: DEFAULT_AGENT_ID,
          sessionKey: THREAD,
          name: "first",
          now: NOW,
        });

        const again = yield* createConversationEffect({
          agentId: DEFAULT_AGENT_ID,
          sessionKey: THREAD,
          name: "second",
          now: NOW + 5,
        });

        assert.equal(again.name, "first");
        assert.equal((yield* listConversationsEffect).length, 2);
      }),
    ),
  );

  it.effect("refuses a conditional write that matches no row, as zero changes", () =>
    overStore(
      Effect.gen(function* () {
        const absent = sessionKey("agent:main:thread:nothing-here");

        assert.equal(yield* unarchiveConversationEffect(absent), false);
        assert.equal(yield* pinConversationEffect(absent, NOW), false);
        assert.equal(
          yield* archiveConversationEffect(absent, NOW, ARCHIVE_REASON.AGE_RETENTION),
          false,
        );
        assert.equal(
          yield* archiveConversationEffect(MAIN_SESSION_KEY, NOW, ARCHIVE_REASON.AGE_RETENTION),
          false,
        );
        assert.equal(yield* pinConversationEffect(MAIN_SESSION_KEY, NOW), true);
      }),
    ),
  );

  it.effect("replaces a kind no vocabulary holds with the one the key itself says", () =>
    overStore(
      Effect.gen(function* () {
        const sql = yield* Client.SqlClient;
        yield* createConversationEffect({
          agentId: DEFAULT_AGENT_ID,
          sessionKey: THREAD,
          name: "a thread",
          now: NOW,
        });
        yield* sql`UPDATE conversations SET kind = 'not-a-kind' WHERE session_key = ${THREAD}`;

        const read = yield* conversationRecordEffect(THREAD);

        assert.equal(read?.kind, CONVERSATION_KIND.THREAD);
      }),
    ),
  );
});
