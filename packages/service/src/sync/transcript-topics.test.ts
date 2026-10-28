import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { fillChildTitle } from "@luke/database/models/child-titles";
import { writeDelegation } from "@luke/database/models/coding-agent-store";
import { childConversationId } from "@luke/database/models/ids";
import { createTask } from "@luke/database/models/task-store";
import { type ConversationTarget, storeWriter } from "@luke/database/models/writer";
import { user } from "@luke/database/schemas/auth";
import { codingAgent } from "@luke/database/schemas/coding-agent";
import { MESSAGE_SENDER } from "@luke/database/storage-vocabulary";
import { type SyncTopic, TOPIC } from "@luke/database/sync/notification";
import { expectTopicsFire, getTestDB, openTaskAgent, openWorkspace } from "@luke/database/testing";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { recordDelegation } from "../agents/coder-host/delegation.js";
import { CODER_TOOL_SET } from "../agents/coder-host/tool-set.js";
import {
  CURSOR_START,
  delegationPast,
  transcriptNow,
  transcriptPast,
} from "../agents/coder-host/transcript.js";
import { openChildConversation } from "../agents/eve-host/conversation.js";
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
import { modelCatalogOf } from "../providers/model-catalog.js";
import { wokenOnHub } from "../testing/sync-woken.js";
import { agentTranscriptLive } from "./live-queries.js";
import type { LiveParams } from "./live-query.js";

/**
 * A coding agent's transcript (`agentTranscriptLive`) on the migrated
 * capture: each write a transcript reads, through its real writer, notifies
 * a topic the transcript's read is woken on, so a window following it hears
 * the write within a coalesce window rather than at the hold's end. That
 * holds for a developer's line, a turn queued, started, and settled, and the
 * journal it writes, which notify the conversation, a turn the agent's, its
 * task's, and its workspace's too, so every view of the agent's status
 * hears it; and for a worker opened, its delegation recorded, and its title
 * filled, which notify the agent's own conversation, whose transcript lists
 * its workers. A transcript read held on Luke Sync answers the agent's
 * message, and a wait for a worker's delegation its record, within a
 * coalesce window of the write.
 *
 * Synthetic accounts, workspaces, tasks, agents, and turns throughout.
 */

/** A fixed instant the run events are stamped at, since no read here measures time. */
const NOW = 1_800_000_000_000;

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@luke.test` });
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
    .select({ conversationId: codingAgent.conversationId })
    .from(codingAgent)
    .where(eq(codingAgent.id, agentId));
  const conversationId = row?.conversationId ?? assert.fail("the agent has no conversation");
  const params = {
    ownerId: userId,
    conversationId,
    parentConversationId: conversationId,
    agentId,
    readerId: userId,
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
  params: LiveParams<(typeof agentTranscriptLive.params)[number]>,
) =>
  Effect.gen(function* () {
    const fired = yield* expectTopicsFire(write, topics);
    const woken = agentTranscriptLive.topics(params);
    assert.ok(
      topics.some(([kind, id]) => woken.some((topic) => topic[0] === kind && topic[1] === id)),
      "the transcript's read is woken by a topic the write notifies",
    );
    return fired;
  });

/** One run event of the turn, as eve's relay hands the writer one. */
const runEvent = (target: ConversationTarget, turnId: string) => ({
  conversationId: sessionKey(target.conversationId),
  turnId,
});

it.layer(getTestDB())("what moves a coding agent's transcript notifies", (it) => {
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
          writer.enqueueTurn(target, { turnId, origin: TURN_ORIGIN.TYPED, eveTurnId: "turn_0" }),
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
    "a worker opened, its delegation recorded, and its title filled each notify the agent's own conversation, which the transcript of the agent and of the worker wake on",
    () =>
      Effect.gen(function* () {
        const { target, params } = yield* openAgent;
        const callId = `call_${randomUUID()}`;
        const workerId = childConversationId(target.conversationId, callId);
        const worker: readonly SyncTopic[] = [
          [TOPIC.CONVERSATION, workerId],
          [TOPIC.CONVERSATION, target.conversationId],
        ];
        const workersRead = { ...params, conversationId: workerId };

        yield* wakesTheTranscript(
          openChildConversation(target, workerId, "researcher"),
          worker,
          params,
        );
        yield* wakesTheTranscript(
          writeDelegation(workerId, callId, { model: "anthropic/claude-opus-5.5", effort: "high" }),
          [[TOPIC.CONVERSATION, target.conversationId]],
          workersRead,
        );
        yield* wakesTheTranscript(
          fillChildTitle(target, workerId, "Invite research"),
          worker,
          params,
        );
      }),
  );

  it.effect(
    "on Luke Sync, a held read of the agent's transcript answers its message, and a wait for a worker's delegation the record, each within a coalesce window of the write",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { target, params } = yield* openAgent;
          const writer = yield* storeWriter({ tools: CODER_TOOL_SET });
          const db = yield* Database;
          const [row] = yield* db
            .select({ createdAt: codingAgent.createdAt })
            .from(codingAgent)
            .where(eq(codingAgent.id, params.agentId));
          const agent = { createdAt: row?.createdAt ?? assert.fail("the agent has no row") };
          const own = { id: params.agentId };
          const turnId = randomUUID();
          yield* writer.enqueueTurn(target, {
            turnId,
            origin: TURN_ORIGIN.TYPED,
            eveTurnId: "turn_0",
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
          const callId = `call_${randomUUID()}`;

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
          const delegation = yield* wokenOnHub(
            delegationPast(target, childConversationId(target.conversationId, callId), agent),
            recordDelegation(
              target,
              callId,
              { model: "anthropic/claude-opus-5.5", effort: "high" },
              "researcher",
            ),
          );

          assert.deepEqual(
            message.answered.messages.map((each) => each.role),
            [MESSAGE_ROLE.ASSISTANT],
          );
          assert.equal(delegation.answered.delegation?.model, "anthropic/claude-opus-5.5");
        }),
      ),
  );
});
