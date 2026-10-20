import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import type { LiveStatement } from "@luke/database/core/live-statement";
import { Database, type DatabaseServices } from "@luke/database/core/query";
import { listPages, writePage } from "@luke/database/models/plan-pages";
import { openTaskConversation } from "@luke/database/models/task-store";
import { readTranscript } from "@luke/database/models/transcript-store";
import { user } from "@luke/database/schemas/auth";
import { messages } from "@luke/database/schemas/storage";
import { voiceSessions, voiceTranscriptSegments } from "@luke/database/schemas/voice";
import { getTestDB, startTask } from "@luke/database/testing";
import {
  VOICE_CLOSE_REASON,
  VOICE_DELEGATION_MODE,
  VOICE_SEGMENT_ROLE,
} from "@luke/database/voice-vocabulary";
import { type TaskRecordLiveRows, taskRecordLiveRowsSchema } from "@luke/features/live-wire";
import { PAGE_SHOWER } from "@luke/features/page-wire";
import { MESSAGE_AUTHOR, MESSAGE_CHANNEL, MESSAGE_ROLE } from "@luke/wire";
import { eq } from "drizzle-orm";
import { Effect, Option, Schema } from "effect";
import { SqlClient } from "effect/sql";
import { taskRecordLiveStatements } from "./task-record-live.js";

/**
 * An open task's record as Realtime would deliver it, over the real
 * migrations on PGlite: each part's statement run as Realtime runs it and its
 * rows decoded as the desktop decodes them, beside the held reads the desktop
 * reads that part with (`listPages`, `readTranscript`). A part
 * moves exactly when its held read would answer something new.
 *
 * Synthetic accounts, pages, and words throughout.
 */

const PARTS = ["pages", "calls"] as const;

type Part = (typeof PARTS)[number];

const CLOSED_AT = new Date(1_800_000_000_000);

/** A new account, as the store holds one. */
const openUser = Effect.gen(function* () {
  const db = yield* Database;
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
  return userId;
});

/** One part's statement run as Realtime runs it. */
const runLive = (statement: LiveStatement) =>
  Effect.flatMap(SqlClient.SqlClient, (sql) => sql.unsafe(statement.sql, [...statement.params]));

/** The task's record as Realtime would deliver it to `reader`, decoded as the desktop decodes it. */
const liveRecordOf = (reader: string, taskId: string) =>
  Effect.gen(function* () {
    const statements = Option.getOrThrow(taskRecordLiveStatements(reader, taskId));
    return yield* Schema.decodeUnknownEffect(taskRecordLiveRowsSchema)({
      pages: yield* runLive(statements.pages),
      calls: yield* runLive(statements.calls),
    });
  });

/** The same parts as the desktop reads them today, each as its held read answers it. */
const heldRecordOf = (reader: string, taskId: string) =>
  Effect.gen(function* () {
    return {
      pages: yield* listPages(reader, taskId),
      calls: yield* readTranscript(reader, taskId),
    };
  });

/** The record as its held reads answer it. */
type HeldRecord = Effect.Success<ReturnType<typeof heldRecordOf>>;

/** The parts whose value differs between two readings, by their text, as the desktop compares deliveries. */
function movedParts<Reading extends TaskRecordLiveRows | HeldRecord>(
  before: Reading,
  after: Reading,
): readonly Part[] {
  return PARTS.filter((part) => JSON.stringify(before[part]) !== JSON.stringify(after[part]));
}

/** A call about the task, its session row written as the voice service opens one. */
const openCall = (userId: string, taskId: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const [row] = yield* db
      .insert(voiceSessions)
      .values({
        userId,
        taskId,
        liveSessionId: `live-${randomUUID()}`,
        delegationMode: VOICE_DELEGATION_MODE.CLIENT,
        model: "gpt-realtime",
      })
      .returning({ id: voiceSessions.id });
    assert.ok(row);
    return row.id;
  });

/** One fragment of the developer's words on a call, appended as the voice writer appends one. */
const said = (voiceSessionId: string, seq: number) =>
  Effect.flatMap(Database, (db) =>
    db.insert(voiceTranscriptSegments).values({
      voiceSessionId,
      seq,
      role: VOICE_SEGMENT_ROLE.USER,
      text: seq === 0 ? "Invite by" : " email.",
      startMs: seq * 400,
      endMs: seq * 400 + 300,
    }),
  );

it.layer(getTestDB())("a task's record followed live", (it) => {
  it.effect(
    "each part moves exactly when its held read would answer something new, as a page is shown, and a call's words, end, metering and rows land; and a stranger reads no rows",
    () =>
      Effect.gen(function* () {
        const owner = yield* openUser;
        const stranger = yield* openUser;
        const task = yield* startTask(owner, { name: "Teammate invitations" });
        const other = yield* startTask(owner, { name: "Billing" });

        let live = yield* liveRecordOf(owner, task.id);
        let held = yield* heldRecordOf(owner, task.id);
        const step = (
          expected: readonly Part[],
          write: Effect.Effect<unknown, unknown, DatabaseServices>,
        ) =>
          Effect.gen(function* () {
            yield* Effect.orDie(write);
            const nextLive = yield* liveRecordOf(owner, task.id);
            const nextHeld = yield* heldRecordOf(owner, task.id);
            assert.deepEqual(movedParts(held, nextHeld), expected, "the held reads moved");
            assert.deepEqual(movedParts(live, nextLive), expected, "the live marks moved");
            live = nextLive;
            held = nextHeld;
          });

        assert.deepEqual(live, { pages: [], calls: [] });

        const shown = Option.getOrThrow(
          yield* writePage(
            owner,
            task.id,
            { title: "Invite funnel", html: "<p>One</p>" },
            { kind: PAGE_SHOWER.LUKE },
          ),
        );
        live = yield* liveRecordOf(owner, task.id);
        held = yield* heldRecordOf(owner, task.id);
        assert.deepEqual(live.pages, [{ pageId: shown.id, version: 1 }]);
        yield* step(
          ["pages"],
          writePage(
            owner,
            task.id,
            { pageId: shown.id, title: "Invite funnel", html: "<p>Two</p>" },
            { kind: PAGE_SHOWER.LUKE },
          ),
        );

        // A call with no words yet reads as no call.
        const call = yield* openCall(owner, task.id);
        yield* step([], Effect.void);
        assert.deepEqual(live.calls, []);
        yield* step(["calls"], said(call, 0));
        yield* step(["calls"], said(call, 1));
        // The task's conversation opening moves nothing until the voice writes a row for the call.
        const conversation = Option.getOrThrow(yield* openTaskConversation(owner, task.id));
        yield* step([], Effect.void);
        yield* step(
          ["calls"],
          Database.use((db) =>
            db.insert(messages).values({
              userId: owner,
              conversationId: conversation.conversationId,
              seq: 1,
              clientId: `spoken-${randomUUID()}`,
              role: MESSAGE_ROLE.USER,
              parts: [{ type: "text", text: "Invite by email." }],
              metadata: {
                author: MESSAGE_AUTHOR.DEVELOPER,
                channel: MESSAGE_CHANNEL.VOICE,
                voice_session_id: call,
                from_ms: 0,
                to_ms: 700,
              },
              placedAt: CLOSED_AT,
            }),
          ),
        );
        yield* step(
          ["calls"],
          Database.use((db) =>
            db
              .update(voiceSessions)
              .set({ closedAt: CLOSED_AT, closeReason: VOICE_CLOSE_REASON.REMOTE_HANGUP })
              .where(eq(voiceSessions.id, call)),
          ),
        );
        yield* step(
          ["calls"],
          Database.use((db) =>
            db
              .update(voiceSessions)
              .set({ usage: { seconds: 42, confirmed: true } })
              .where(eq(voiceSessions.id, call)),
          ),
        );
        // Another task's record moving moves nothing of this one's.
        yield* step(
          [],
          writePage(
            owner,
            other.id,
            { title: "Billing funnel", html: "<p>One</p>" },
            { kind: PAGE_SHOWER.LUKE },
          ),
        );
        assert.deepEqual(yield* liveRecordOf(stranger, task.id), { pages: [], calls: [] });
      }),
  );
});
