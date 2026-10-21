import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import type { LiveStatement } from "@luke/database/core/live-statement";
import { Database, type DatabaseServices } from "@luke/database/core/query";
import { createCodingAgent } from "@luke/database/models/coding-agent-store";
import { listPages, writePage } from "@luke/database/models/plan-pages";
import { createTask } from "@luke/database/models/task-store";
import { user } from "@luke/database/schemas/auth";
import { messages } from "@luke/database/schemas/storage";
import { voiceSessions, voiceTranscriptSegments } from "@luke/database/schemas/voice";
import { getTestDB, joinWorkspace, openWorkspace, startTask } from "@luke/database/testing";
import {
  VOICE_CLOSE_REASON,
  VOICE_DELEGATION_MODE,
  VOICE_SEGMENT_ROLE,
} from "@luke/database/voice-vocabulary";
import { GITHUB_ACCESS } from "@luke/features/github-repositories-wire";
import { type TaskRecordLiveRows, taskRecordLiveRowsSchema } from "@luke/features/live-wire";
import { PAGE_SHOWER } from "@luke/features/page-wire";
import { MESSAGE_AUTHOR, MESSAGE_CHANNEL, MESSAGE_ROLE } from "@luke/wire";
import { eq } from "drizzle-orm";
import { Effect, Option, Schema } from "effect";
import { SqlClient } from "effect/sql";
import { openGithubUser } from "../testing/github-app-fake.js";
import { SHOW_CODE_TOOL } from "./show-code.js";
import { taskRecordLiveStatements } from "./task-record-live.js";
import { readTaskCode } from "./task-work-store.js";

/**
 * An open task's record as Realtime would deliver it, over the real
 * migrations on PGlite: each part's statement run as Realtime runs it and its
 * rows decoded as the desktop decodes them, beside the held reads the desktop
 * reads that part with (`listPages`, `readTranscript`). A part
 * moves exactly when its held read would answer something new.
 *
 * Synthetic accounts, pages, and words throughout.
 */

const PARTS = ["pages", "calls", "code"] as const;

type Part = (typeof PARTS)[number];

/** The parts a held read answers: every one but the calls, which no desktop reads again since every call speaks into an agent. */
const HELD_PARTS = ["pages", "code"] as const;

const CLOSED_AT = new Date(1_800_000_000_000);

/** A new account, as the store holds one. */
const openUser = Effect.gen(function* () {
  const db = yield* Database;
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
  return userId;
});

/** An accepted `show_code` part of a journal, as the relay writes one. */
function answeredShowCode(callId: string, line: string) {
  return {
    type: `tool-${SHOW_CODE_TOOL.name}`,
    toolCallId: callId,
    state: "output-available",
    input: { path: "src/invite.ts", startLine: 1, endLine: 1, note: "Invitations last a week." },
    output: {
      status: "accepted",
      code: {
        ref: { path: "src/invite.ts", startLine: 1, endLine: 1 },
        repository: "acme/api",
        firstLine: 1,
        lineCount: 1,
        lines: [line],
        note: "Invitations last a week.",
      },
    },
  };
}

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
      code: yield* runLive(statements.code),
    });
  });

/** The parts as the desktop reads them today, each as its held read answers it. */
const heldRecordOf = (reader: string, taskId: string) =>
  Effect.gen(function* () {
    return {
      pages: yield* listPages(reader, taskId),
      code: Option.map(yield* readTaskCode(reader, taskId), (read) => read.code),
    };
  });

/** The record as its held reads answer it. */
type HeldRecord = Effect.Success<ReturnType<typeof heldRecordOf>>;

/** The parts whose value differs between two live readings, by their text, as the desktop compares deliveries. */
function movedParts(before: TaskRecordLiveRows, after: TaskRecordLiveRows): readonly Part[] {
  return PARTS.filter((part) => JSON.stringify(before[part]) !== JSON.stringify(after[part]));
}

/** The parts whose value differs between two held readings: the moves a live delivery says, the calls apart. */
function movedHeld(before: HeldRecord, after: HeldRecord): readonly Part[] {
  return HELD_PARTS.filter((part) => JSON.stringify(before[part]) !== JSON.stringify(after[part]));
}

/** The moves a held reading makes for the live ones expected: every one but the calls'. */
function heldOf(expected: readonly Part[]): readonly Part[] {
  return expected.filter((part) => part !== "calls");
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
    "each part moves exactly when its held read would answer something new, as a page is shown, and a call's words, end, and metering land; and a stranger reads no rows",
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
            assert.deepEqual(movedHeld(held, nextHeld), heldOf(expected), "the held reads moved");
            assert.deepEqual(movedParts(live, nextLive), expected, "the live marks moved");
            live = nextLive;
            held = nextHeld;
          });

        assert.deepEqual(live, { pages: [], calls: [], code: [] });

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
        assert.deepEqual(yield* liveRecordOf(stranger, task.id), {
          pages: [],
          calls: [],
          code: [],
        });
      }),
  );

  it.effect(
    "an agent's code shown on a typed turn is read back under the agent and moves the code part, a later step of the same turn moves nothing, and a stranger reads neither",
    () =>
      Effect.gen(function* () {
        const owner = yield* openUser;
        const teammate = yield* openUser;
        const stranger = yield* openUser;
        const task = yield* startTask(owner, { name: "Teammate invitations" });
        yield* joinWorkspace(task.workspaceId, teammate);
        const started = yield* createCodingAgent(owner, {
          taskId: task.id,
          idempotencyKey: randomUUID(),
          model: "anthropic/claude-opus-5.5",
          effort: "high",
          planSnapshot: null,
          prompt: "Walk me through invitations.",
          repository: null,
        });
        const agent = Option.getOrThrow(started).agent;

        let live = yield* liveRecordOf(teammate, task.id);
        let held = yield* heldRecordOf(teammate, task.id);
        const step = (
          expected: readonly Part[],
          write: Effect.Effect<unknown, unknown, DatabaseServices>,
        ) =>
          Effect.gen(function* () {
            yield* Effect.orDie(write);
            const nextLive = yield* liveRecordOf(teammate, task.id);
            const nextHeld = yield* heldRecordOf(teammate, task.id);
            assert.deepEqual(movedHeld(held, nextHeld), heldOf(expected), "the held reads moved");
            assert.deepEqual(movedParts(live, nextLive), expected, "the live marks moved");
            live = nextLive;
            held = nextHeld;
          });

        const code = answeredShowCode;
        const turnId = `turn-${randomUUID()}`;
        // The agent's typed turn journals its first step: a show_code call, answered.
        const journalId = randomUUID();
        yield* step(
          ["code"],
          Database.use((db) =>
            db.insert(messages).values({
              id: journalId,
              userId: owner,
              conversationId: agent.conversationId,
              seq: 1,
              clientId: turnId,
              role: MESSAGE_ROLE.ASSISTANT,
              // SAFETY: the part is a stored journal's, as the relay writes it.
              parts: [code("call-1", "export const TTL = 7;")] as never,
              metadata: { author: MESSAGE_AUTHOR.BRAIN },
              placedAt: CLOSED_AT,
            }),
          ),
        );
        assert.deepEqual(
          Option.getOrThrow(held.code).map((each) => [each.callId, each.turnId, each.agentId]),
          [["call-1", turnId, agent.id]],
        );
        assert.deepEqual(live.code, [{ id: journalId, calls: '["call-1"]' }]);

        // A later step of the same turn rewrites its journal and shows nothing new.
        const amended = (parts: readonly unknown[], revision: number) =>
          Database.use((db) =>
            db
              .update(messages)
              // SAFETY: the parts are a stored journal's, as the relay writes them.
              .set({ parts: parts as never, revision })
              .where(eq(messages.id, journalId)),
          );
        const first = code("call-1", "export const TTL = 7;");
        const said = { type: "text", text: "Invitations last a week." };
        yield* step([], amended([first, said], 1));
        // A second show_code in that turn moves it.
        yield* step(["code"], amended([first, said, code("call-2", "export const MAX = 5;")], 2));

        assert.deepEqual(yield* liveRecordOf(stranger, task.id), {
          pages: [],
          calls: [],
          code: [],
        });
        assert.ok(Option.isNone(yield* readTaskCode(stranger, task.id)));
      }),
  );

  it.effect(
    "an agent on its starter's own token shows its code to no member who cannot see it, live or held, though the task is theirs to read",
    () =>
      Effect.gen(function* () {
        const owner = yield* openGithubUser();
        const tokenless = yield* openGithubUser();
        const workspace = yield* openWorkspace(owner);
        yield* joinWorkspace(workspace, tokenless);
        const task = yield* createTask(owner, { organizationId: workspace });
        const started = yield* createCodingAgent(owner, {
          taskId: task.id,
          idempotencyKey: randomUUID(),
          model: "anthropic/claude-opus-5.5",
          effort: "high",
          planSnapshot: null,
          prompt: "Walk me through invitations.",
          repository: "octo-owner/private",
          githubAccess: GITHUB_ACCESS.TOKEN,
        });
        const agent = Option.getOrThrow(started).agent;
        yield* Database.use((db) =>
          db.insert(messages).values({
            userId: owner,
            conversationId: agent.conversationId,
            seq: 1,
            clientId: `turn-${randomUUID()}`,
            role: MESSAGE_ROLE.ASSISTANT,
            // SAFETY: the part is a stored journal's, as the relay writes it.
            parts: [answeredShowCode("call-1", "export const TTL = 7;")] as never,
            metadata: { author: MESSAGE_AUTHOR.BRAIN },
            placedAt: CLOSED_AT,
          }),
        );

        // The starter sees it, live and held.
        assert.equal((yield* liveRecordOf(owner, task.id)).code.length, 1);
        assert.equal(Option.getOrThrow(yield* readTaskCode(owner, task.id)).code.length, 1);
        // A teammate who keeps no token reads the task, and none of the agent's code.
        assert.deepEqual((yield* liveRecordOf(tokenless, task.id)).code, []);
        assert.deepEqual(Option.getOrThrow(yield* readTaskCode(tokenless, task.id)).code, []);
      }),
  );
});
