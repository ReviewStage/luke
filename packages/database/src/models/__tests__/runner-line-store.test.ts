import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Clock, Duration, Effect, Option } from "effect";
import { TestClock } from "effect/testing";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { getTestDB, startTask } from "../../testing/index.js";
import { createCodingAgent } from "../coding-agent-store.js";
import {
  acceptRunnerLine,
  clearRunnerLines,
  queueRunnerLine,
  runnerLinesPast,
} from "../runner-line-store.js";

/**
 * The lines queued for a cloud agent's runner, over a real dialect: a launch
 * reads its own lines past its cursor in the order they were queued, however
 * old, and a message queued again under its id is queued once; a later launch is handed
 * the message lines an earlier one never acknowledged, within the window it
 * names, and nothing else of that launch's, even under the same first event
 * number once the new launch dropped them; and no account queues for,
 * reads, or acknowledges another's agent. Synthetic accounts and agents
 * throughout.
 */

const LAUNCH = { FIRST: 1, NEXT: 40 } as const;

const LIMIT = 50;

/** An account holding one agent. */
const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
  const task = yield* startTask(userId, { name: "Invitations" });
  const started = yield* createCodingAgent(userId, {
    taskId: task.id,
    idempotencyKey: randomUUID(),
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    planSnapshot: "# Invitations\n",
    prompt: null,
    repository: null,
  });
  return { userId, agentId: Option.getOrThrow(started).agent.id };
});

/** The texts a launch reads past its cursor, every line queued so far in the window. */
const textsPast = (userId: string, agentId: string, launch: number, after = 0) =>
  Effect.gen(function* () {
    const since = new Date((yield* Clock.currentTimeMillis) - Duration.toMillis(Duration.hours(1)));
    const lines = yield* runnerLinesPast(userId, agentId, { launch, after, since, limit: LIMIT });
    return lines.map((line) => line.text);
  });

it.layer(getTestDB())("the runner line store", (it) => {
  it.effect("a launch reads its lines past its cursor, a message queued again once", () =>
    Effect.gen(function* () {
      const { userId, agentId } = yield* openAccount;
      const lineId = randomUUID();
      const first = yield* queueRunnerLine(userId, {
        agentId,
        launch: LAUNCH.FIRST,
        text: '{"type":"message","n":1}',
        lineId,
      });
      const again = yield* queueRunnerLine(userId, {
        agentId,
        launch: LAUNCH.FIRST,
        text: '{"type":"message","n":1}',
        lineId,
      });
      assert.deepEqual(again, first);
      const model = yield* queueRunnerLine(userId, {
        agentId,
        launch: LAUNCH.FIRST,
        text: '{"type":"model"}',
      });
      // Note that a launch's own lines stand past the window an earlier launch's are handed in.
      yield* TestClock.adjust(Duration.hours(2));
      assert.deepEqual(yield* textsPast(userId, agentId, LAUNCH.FIRST), [
        '{"type":"message","n":1}',
        '{"type":"model"}',
      ]);
      assert.deepEqual(yield* textsPast(userId, agentId, LAUNCH.FIRST, Option.getOrThrow(first)), [
        '{"type":"model"}',
      ]);
      assert.deepEqual(
        yield* textsPast(userId, agentId, LAUNCH.FIRST, Option.getOrThrow(model)),
        [],
      );
    }),
  );

  it.effect(
    "a later launch is handed the messages an earlier one never took, in the window, and nothing else of it",
    () =>
      Effect.gen(function* () {
        const { userId, agentId } = yield* openAccount;
        const queue = (launch: number, text: string, lineId?: string) =>
          queueRunnerLine(userId, { agentId, launch, text, ...(lineId ? { lineId } : {}) });
        const stale = randomUUID();
        yield* queue(LAUNCH.FIRST, "stale", stale);
        yield* TestClock.adjust(Duration.hours(2));
        const taken = randomUUID();
        yield* queue(LAUNCH.FIRST, "taken", taken);
        yield* queue(LAUNCH.FIRST, "stop");
        yield* queue(LAUNCH.FIRST, "untaken", randomUUID());
        yield* acceptRunnerLine(userId, agentId, taken);
        yield* queue(LAUNCH.NEXT, "next");
        assert.deepEqual(yield* textsPast(userId, agentId, LAUNCH.NEXT), ["untaken", "next"]);
      }),
  );

  it.effect(
    "a launch that dropped its predecessor's lines reads only its untaken messages in the window under the same number",
    () =>
      Effect.gen(function* () {
        const { userId, agentId } = yield* openAccount;
        const queue = (text: string, lineId?: string) =>
          queueRunnerLine(userId, {
            agentId,
            launch: LAUNCH.FIRST,
            text,
            ...(lineId ? { lineId } : {}),
          });
        yield* queue("stale", randomUUID());
        yield* TestClock.adjust(Duration.hours(2));
        const taken = randomUUID();
        yield* queue("taken", taken);
        yield* queue("stop");
        yield* queue("untaken", randomUUID());
        yield* acceptRunnerLine(userId, agentId, taken);
        const now = yield* Clock.currentTimeMillis;
        yield* clearRunnerLines(
          userId,
          agentId,
          new Date(now - Duration.toMillis(Duration.hours(1))),
        );
        yield* queue("first of the next");
        assert.deepEqual(yield* textsPast(userId, agentId, LAUNCH.FIRST), [
          "untaken",
          "first of the next",
        ]);
      }),
  );

  it.effect("no account queues for, reads, or acknowledges another's agent", () =>
    Effect.gen(function* () {
      const owner = yield* openAccount;
      const other = yield* openAccount;
      const lineId = randomUUID();
      yield* queueRunnerLine(owner.userId, {
        agentId: owner.agentId,
        launch: LAUNCH.FIRST,
        text: "theirs",
        lineId,
      });
      const foreign = yield* queueRunnerLine(other.userId, {
        agentId: owner.agentId,
        launch: LAUNCH.FIRST,
        text: "intruder",
      });
      assert.ok(Option.isNone(foreign));
      assert.deepEqual(yield* textsPast(other.userId, owner.agentId, LAUNCH.FIRST), []);
      yield* acceptRunnerLine(other.userId, owner.agentId, lineId);
      assert.deepEqual(yield* textsPast(owner.userId, owner.agentId, LAUNCH.NEXT), ["theirs"]);
    }),
  );
});
