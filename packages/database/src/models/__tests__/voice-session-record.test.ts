import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { voiceTranscriptSegments } from "../../schemas/voice.js";
import { getTestDB, joinWorkspace, startTask } from "../../testing/index.js";
import { VOICE_SEGMENT_ROLE } from "../../voice-vocabulary.js";
import { archiveCodingAgent, createCodingAgent } from "../coding-agent-store.js";
import { readAgentTranscript } from "../transcript-store.js";
import { voiceSessionRecord } from "../voice-session-record.js";

/**
 * The voice session record and the transcript read for a call that names
 * its agent, over a real dialect: the agent a call speaks into is reached by
 * its starter and a teammate in its workspace and by no stranger; its row
 * names the agent and a re-attach reads it back; and what a new call into
 * the agent reads back, as the transcript the agent's calls read, is what was
 * said on its own calls alone, never a sibling agent's on the same task.
 *
 * Synthetic accounts, tasks, agents, and sessions throughout.
 */

const record = voiceSessionRecord();

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@luke.test` });
  return id;
});

/** An agent on the task, started blank under the account. */
const startAgent = (userId: string, taskId: string) =>
  Effect.map(
    createCodingAgent(userId, {
      taskId,
      planSnapshot: null,
      prompt: null,
      idempotencyKey: randomUUID(),
      model: "anthropic/claude-opus-5.5",
      effort: "high",
      repository: null,
    }),
    (started) => Option.getOrThrow(started).agent,
  );

/** A call registered under the account, on the task and into the agent named, with one line by each speaker; answers its live session id. */
const callWith = (
  userId: string,
  taskId: string,
  agentId: string | undefined,
  words: readonly [developer: string, luke: string],
) =>
  Effect.gen(function* () {
    const sessionId = `live-${randomUUID()}`;
    const voiceSessionId = yield* record.register({
      userId,
      sessionId,
      taskId,
      agentId,
      attachId: randomUUID(),
      model: "gpt-live",
    });
    assert.ok(voiceSessionId);
    const db = yield* Database;
    yield* db.insert(voiceTranscriptSegments).values([
      {
        voiceSessionId,
        seq: 0,
        role: VOICE_SEGMENT_ROLE.USER,
        text: words[0],
        startMs: 0,
        endMs: 1_000,
      },
      {
        voiceSessionId,
        seq: 1,
        role: VOICE_SEGMENT_ROLE.ASSISTANT,
        text: words[1],
        startMs: 1_000,
        endMs: 2_000,
      },
    ]);
    return sessionId;
  });

it.layer(getTestDB())("a call that names its agent", (it) => {
  it.effect(
    "the agent is held by its starter and a teammate in its workspace with its task and conversation, archived as it stands, and by no stranger",
    () =>
      Effect.gen(function* () {
        const starter = yield* openAccount;
        const teammate = yield* openAccount;
        const stranger = yield* openAccount;
        const task = yield* startTask(starter, { name: "Billing export" });
        yield* joinWorkspace(task.workspaceId, teammate);
        const agent = yield* startAgent(starter, task.id);

        const held = {
          agentId: agent.id,
          taskId: task.id,
          archived: false,
          conversation: { userId: starter, conversationId: agent.conversationId },
        };
        assert.deepEqual(yield* record.heldAgent({ userId: starter, agentId: agent.id }), held);
        assert.deepEqual(yield* record.heldAgent({ userId: teammate, agentId: agent.id }), held);
        assert.equal(yield* record.heldAgent({ userId: stranger, agentId: agent.id }), undefined);

        yield* archiveCodingAgent(starter, agent.id, true);
        assert.equal(
          (yield* record.heldAgent({ userId: starter, agentId: agent.id }))?.archived,
          true,
        );
      }),
  );

  it.effect("the session's row names its agent, and a re-attach reads it back", () =>
    Effect.gen(function* () {
      const userId = yield* openAccount;
      const task = yield* startTask(userId, { name: "Billing export" });
      const agent = yield* startAgent(userId, task.id);
      const intoAgent = yield* callWith(userId, task.id, agent.id, ["Hi", "Hello"]);
      const aboutTask = yield* callWith(userId, task.id, undefined, ["Hi", "Hello"]);

      assert.equal((yield* record.owned({ userId, sessionId: intoAgent }))?.agentId, agent.id);
      assert.equal((yield* record.owned({ userId, sessionId: aboutTask }))?.agentId, undefined);
    }),
  );

  it.effect(
    "a new call into an agent reads back its own calls alone, and its transcript is those calls, never a sibling agent's or the task's own",
    () =>
      Effect.gen(function* () {
        const userId = yield* openAccount;
        const stranger = yield* openAccount;
        const task = yield* startTask(userId, { name: "Billing export" });
        const agent = yield* startAgent(userId, task.id);
        const sibling = yield* startAgent(userId, task.id);
        yield* callWith(userId, task.id, agent.id, ["Ship the CSV first.", "Starting on it."]);
        yield* callWith(userId, task.id, sibling.id, ["Fix the flaky test.", "On it."]);
        yield* callWith(userId, task.id, undefined, ["What is left?", "The export."]);

        const earlier = yield* record.earlierCalls({ agentId: agent.id });
        assert.deepEqual(
          earlier.map((line) => line.text),
          ["Ship the CSV first.", "Starting on it."],
        );

        const transcript = Option.getOrThrow(yield* readAgentTranscript(userId, agent.id));
        assert.deepEqual(
          transcript.calls.flatMap((call) =>
            call.messages.flatMap((message) => message.parts.map((part) => part.text)),
          ),
          ["Ship the CSV first.", "Starting on it."],
        );
        assert.ok(Option.isNone(yield* readAgentTranscript(stranger, agent.id)));
      }),
  );
});
