import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import {
  queueAgentMessage,
  readAgentQueue,
  takeQueuedMessage,
} from "@repo/database/models/agent-queue-store";
import { createTask } from "@repo/database/models/task-store";
import { type ConversationTarget, storeWriter } from "@repo/database/models/writer";
import { agentTable } from "@repo/database/schemas/agent";
import { user } from "@repo/database/schemas/auth";
import { MESSAGE_SENDER } from "@repo/database/storage-vocabulary";
import { type SyncTopic, TOPIC } from "@repo/database/sync/notification";
import { expectTopicsFire, getTestDB, openTaskAgent, openWorkspace } from "@repo/database/testing";
import { eq } from "drizzle-orm";
import { Effect, Option } from "effect";
import { CODER_TOOL_SET } from "../agents/coder-host/tool-set.js";
import { CURSOR_START, transcriptNow, transcriptPast } from "../agents/coder-host/transcript.js";
import {
  AssistantMessageBuilder,
  MESSAGE_ROLE,
  RUN_EVENT,
  RUN_STATUS,
  RUN_TURN_ORIGIN,
  sessionKey,
  TURN_ORIGIN,
  TURN_TRIGGER,
} from "../core.js";
import { liveQueryParts } from "../live/live-procedures.js";
import { agentTranscriptRead } from "../live/reads/agent-transcript.js";
import { modelCatalogOf } from "../providers/model-catalog.js";
import { wokenOnHub } from "../testing/sync-woken.js";
import type { LiveParams } from "./live-query.js";

/**
 * A coding agent's transcript (`agentTranscriptRead`) on the migrated
 * capture: each write a transcript reads, through its real writer, notifies
 * a topic the transcript's read is woken on, so a window following it hears
 * the write within a coalesce window rather than at the hold's end. That
 * holds for a developer's line, a turn queued, started, and settled, and the
 * journal it writes, which notify the conversation, a turn the agent's, its
 * task's, and its workspace's too, so every view of the agent's status
 * hears it. A transcript read held on Sync answers the agent's message
 * within a coalesce window of the write.
 *
 * Synthetic accounts, workspaces, tasks, agents, and turns throughout.
 */

/** A fixed instant the run events are stamped at, since no read here measures time. */
const NOW = 1_800_000_000_000;

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` });
  return id;
});

/** An agent of the account's on a task of its own workspace: the transcript's read for the account, and the topics of the agent's own. */
const openAgent = Effect.gen(function* () {
  const userId = yield* openAccount;
  const workspaceId = yield* openWorkspace(userId);
  const task = yield* createTask(userId, { organizationId: workspaceId, name: "Invites" });
  const agentId = yield* openTaskAgent(userId, workspaceId, task.id);
  const db = yield* Database;
  const [row] = yield* db
    .select({ conversationId: agentTable.conversationId })
    .from(agentTable)
    .where(eq(agentTable.id, agentId));
  const conversationId = row?.conversationId ?? assert.fail("the agent has no conversation");
  const params = {
    ownerId: userId,
    conversationId,
    parentConversationId: conversationId,
    agentId,
    userId,
    id: agentId,
    call: "",
  };
  const agentTopics: readonly SyncTopic[] = [
    [TOPIC.CONVERSATION, conversationId],
    [TOPIC.AGENT, agentId],
    [TOPIC.TASK, task.id],
    [TOPIC.WORKSPACE, workspaceId],
  ];
  return { userId, target: { userId, conversationId }, params, agentTopics };
});

/** Runs the write, held to the topics it notifies, and fails unless one of them wakes the transcript's read. */
const wakesTheTranscript = <A, E, R>(
  write: Effect.Effect<A, E, R>,
  topics: readonly SyncTopic[],
  params: LiveParams<(typeof agentTranscriptRead.params)[number]>,
) =>
  Effect.gen(function* () {
    const fired = yield* expectTopicsFire(write, topics);
    const woken = agentTranscriptRead.topics(params);
    assert.ok(
      topics.some(([kind, id]) => woken.some((topic) => topic[0] === kind && topic[1] === id)),
      "the transcript's read is woken by a topic the write notifies",
    );
    return fired;
  });

/** One run event of the turn, as a native harness's runner hands the writer one. */
const runEvent = (target: ConversationTarget, turnId: string) => ({
  conversationId: sessionKey(target.conversationId),
  turnId,
});

it.layer(getTestDB())("what moves a coding agent's transcript notifies", (it) => {
  it.effect(
    "a message taken out of the agent's queue moves what the transcript's live read answers, and notifies the agent",
    () =>
      Effect.gen(function* () {
        const { userId, params } = yield* openAgent;
        const { agentId } = params;
        /** What the read answers of the queue now. */
        const queuePart = Effect.map(
          liveQueryParts(agentTranscriptRead, params, {}),
          ({ queries }) => JSON.stringify(queries.queueRevision?.rows ?? []),
        );
        yield* queueAgentMessage(userId, agentId, { id: randomUUID(), text: "First" });
        const [queued] = Option.getOrThrow(yield* readAgentQueue(userId, agentId)).messages;
        assert.ok(queued !== undefined);
        const before = yield* queuePart;

        yield* wakesTheTranscript(
          takeQueuedMessage(userId, agentId, queued.id),
          [[TOPIC.AGENT, agentId]],
          params,
        );

        assert.notEqual(yield* queuePart, before);
      }),
  );

  it.effect(
    "a line written, a turn queued, started, and settled, and the journal it writes each notify the conversation, and a turn the agent's, its task's, and its workspace's too",
    () =>
      Effect.gen(function* () {
        const { userId, target, params, agentTopics } = yield* openAgent;
        const writer = yield* storeWriter({ tools: CODER_TOOL_SET });
        const conversation: readonly SyncTopic[] = [[TOPIC.CONVERSATION, target.conversationId]];
        const turnId = randomUUID();
        const answer = new AssistantMessageBuilder();
        answer.stepStart();
        answer.text("The invites are sent.");

        yield* wakesTheTranscript(
          writer.writeAwaitingLine(
            target,
            {
              text: "Send the invites.",
              clientKey: randomUUID(),
              sender: { kind: MESSAGE_SENDER.MEMBER, userId },
            },
            Effect.succeed(true),
          ),
          conversation,
          params,
        );
        yield* wakesTheTranscript(
          writer.enqueueTurn(target, {
            turnId,
            origin: TURN_ORIGIN.TYPED,
            runtimeTurnId: "turn_0",
          }),
          agentTopics,
          params,
        );
        yield* wakesTheTranscript(
          writer.consume(target, {
            ...runEvent(target, turnId),
            kind: RUN_EVENT.TURN_STARTED,
            sequence: 1,
            origin: RUN_TURN_ORIGIN.TYPED,
            trigger: TURN_TRIGGER.ASK,
            at: NOW,
          }),
          agentTopics,
          params,
        );
        yield* wakesTheTranscript(
          writer.consume(target, {
            ...runEvent(target, turnId),
            kind: RUN_EVENT.MESSAGE_COMPLETED,
            sequence: 2,
            message: answer.finish(randomUUID()),
          }),
          conversation,
          params,
        );
        yield* wakesTheTranscript(
          writer.consume(target, {
            ...runEvent(target, turnId),
            kind: RUN_EVENT.TURN_ENDED,
            sequence: 3,
            status: RUN_STATUS.SUCCEEDED,
            responseIds: [],
            at: NOW,
          }),
          agentTopics,
          params,
        );
      }),
  );

  it.effect(
    "on Vespin Sync, a held read of the agent's transcript answers its message within a coalesce window of the write",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { target, params } = yield* openAgent;
          const writer = yield* storeWriter({ tools: CODER_TOOL_SET });
          const db = yield* Database;
          const [row] = yield* db
            .select({ createdAt: agentTable.createdAt })
            .from(agentTable)
            .where(eq(agentTable.id, params.agentId));
          const agent = { createdAt: row?.createdAt ?? assert.fail("the agent has no row") };
          const own = { id: params.agentId };
          const turnId = randomUUID();
          yield* writer.enqueueTurn(target, {
            turnId,
            origin: TURN_ORIGIN.TYPED,
            runtimeTurnId: "turn_0",
          });
          yield* writer.consume(target, {
            ...runEvent(target, turnId),
            kind: RUN_EVENT.TURN_STARTED,
            sequence: 1,
            origin: RUN_TURN_ORIGIN.TYPED,
            trigger: TURN_TRIGGER.ASK,
            at: NOW,
          });
          const catalog = modelCatalogOf([]);
          const { page } = yield* transcriptNow(
            target,
            CODER_TOOL_SET,
            CURSOR_START,
            agent,
            own,
          ).pipe(Effect.provide(catalog));
          const answer = new AssistantMessageBuilder();
          answer.stepStart();
          answer.text("The invites are sent.");
          const message = yield* wokenOnHub(
            transcriptPast(target, CODER_TOOL_SET, page.cursor, agent, own).pipe(
              Effect.provide(catalog),
            ),
            writer.consume(target, {
              ...runEvent(target, turnId),
              kind: RUN_EVENT.MESSAGE_COMPLETED,
              sequence: 2,
              message: answer.finish(randomUUID()),
            }),
          );

          assert.deepEqual(
            message.answered.messages.map((each) => each.role),
            [MESSAGE_ROLE.ASSISTANT],
          );
        }),
      ),
  );
});
