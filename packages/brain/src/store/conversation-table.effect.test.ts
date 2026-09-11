import assert from "node:assert/strict";
import * as Client from "@effect/sql/SqlClient";
import { describe, it } from "@effect/vitest";
import { MAIN_SESSION_KEY } from "@sidecar/runtime/vocabulary";
import { CONVERSATION_ENTRY_KIND } from "@sidecar/session";
import { Effect } from "effect";
import {
  appendConversationEffect,
  conversationClearedAtEffect,
  listConversationEffect,
  searchConversationEffect,
} from "./conversation-table.js";
import { raiseConversationCutoffEffect } from "./conversations-table.js";
import { line, NOW, overStore } from "./testing.js";

describe("the conversation's lines over the client", () => {
  it.effect("round-trips appended lines, oldest first", () =>
    overStore(
      Effect.gen(function* () {
        const outcome = yield* appendConversationEffect(
          MAIN_SESSION_KEY,
          [line("second", NOW - 1), line("first", NOW - 2)],
          NOW,
        );

        const listed = yield* listConversationEffect(MAIN_SESSION_KEY, NOW);

        assert.equal(outcome.changed, true);
        assert.deepEqual(
          listed.map((entry) => entry.words),
          ["first", "second"],
        );
        assert.deepEqual(outcome.entries, listed);
      }),
    ),
  );

  it.effect("refuses a second write of a line the thread already holds, as no change", () =>
    overStore(
      Effect.gen(function* () {
        const entries = [line("said once", NOW - 1)];
        yield* appendConversationEffect(MAIN_SESSION_KEY, entries, NOW);

        const again = yield* appendConversationEffect(MAIN_SESSION_KEY, entries, NOW);

        assert.equal(again.changed, false);
        assert.equal(again.entries.length, 1);
      }),
    ),
  );

  it.effect("refuses a run's second reply, and adopts the run onto the line already standing", () =>
    overStore(
      Effect.gen(function* () {
        const words = "the reply";
        yield* appendConversationEffect(MAIN_SESSION_KEY, [line(words, NOW - 2)], NOW);

        const adopted = yield* appendConversationEffect(
          MAIN_SESSION_KEY,
          [line(words, NOW - 2, { requestId: "run-1" })],
          NOW,
        );
        const second = yield* appendConversationEffect(
          MAIN_SESSION_KEY,
          [line("another reply", NOW - 1, { requestId: "run-1" })],
          NOW,
        );

        assert.equal(adopted.changed, true);
        assert.equal(second.changed, false);
        assert.deepEqual(
          second.entries.map((entry) => entry.words),
          [words],
        );
      }),
    ),
  );

  it.effect("keeps a line the Clear cutoff covers out of the thread and out of a search", () =>
    overStore(
      Effect.gen(function* () {
        yield* appendConversationEffect(
          MAIN_SESSION_KEY,
          [line("before the clear", NOW - 10), line("after the clear", NOW - 1)],
          NOW,
        );
        yield* raiseConversationCutoffEffect(MAIN_SESSION_KEY, NOW - 5);

        assert.equal(yield* conversationClearedAtEffect(MAIN_SESSION_KEY), NOW - 5);
        assert.deepEqual(
          (yield* listConversationEffect(MAIN_SESSION_KEY, NOW)).map((entry) => entry.words),
          ["after the clear"],
        );
        assert.deepEqual(
          (yield* searchConversationEffect([MAIN_SESSION_KEY], "clear", 10, NOW)).map(
            (hit) => hit.entry.words,
          ),
          ["after the clear"],
        );
      }),
    ),
  );

  it.effect("answers a hit under the session key the column holds", () =>
    overStore(
      Effect.gen(function* () {
        yield* appendConversationEffect(MAIN_SESSION_KEY, [line("deploy the thing", NOW - 1)], NOW);

        const hits = yield* searchConversationEffect([MAIN_SESSION_KEY], "deploy", 10, NOW);

        assert.deepEqual(
          hits.map((hit) => hit.sessionKey),
          [MAIN_SESSION_KEY],
        );
      }),
    ),
  );

  it.effect("drops a row whose payload this build cannot vouch for, and keeps the rest", () =>
    overStore(
      Effect.gen(function* () {
        const sql = yield* Client.SqlClient;
        yield* appendConversationEffect(MAIN_SESSION_KEY, [line("readable", NOW - 1)], NOW);
        yield* sql`INSERT INTO conversation_events
                     (session_key, sequence, event_key, kind, words, recorded_at, payload)
                   VALUES (${MAIN_SESSION_KEY}, ${99}, ${"value:corrupt"},
                           ${CONVERSATION_ENTRY_KIND.REPLY}, ${"corrupt"}, ${NOW - 1},
                           ${"{not json"})`;

        const listed = yield* listConversationEffect(MAIN_SESSION_KEY, NOW);
        const hits = yield* searchConversationEffect([MAIN_SESSION_KEY], "corrupt", 10, NOW);

        assert.deepEqual(
          listed.map((entry) => entry.words),
          ["readable"],
        );
        assert.deepEqual(hits, []);
      }),
    ),
  );
});
