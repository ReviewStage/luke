import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { type Agent, archiveAgent, createAgent } from "@luke/database/models/agent-store";
import { claimRuntimeSession } from "@luke/database/models/recorded-session";
import { SettledTurnListener, storeWriter } from "@luke/database/models/writer";
import { user } from "@luke/database/schemas/auth";
import { getTestDB, openWorkspace } from "@luke/database/testing";
import { agentMessageReplyLine } from "@luke/features/agent-wire";
import {
  AssistantMessageBuilder,
  RUN_EVENT,
  RUN_STATUS,
  RUN_TURN_ORIGIN,
  type RunStatus,
  TURN_FAILURE,
  TURN_TRIGGER,
} from "@luke/features/turn-run";
import { sessionKey } from "@luke/runtime/vocabulary";
import { TURN_ORIGIN, TURN_STATUS } from "@luke/wire";
import { Effect, Layer, Option } from "effect";
import { connectAgentApiKeys } from "../../testing/agent-credentials.js";
import { githubReaching } from "../../testing/github-app-fake.js";
import { recordingEve, sentTo } from "../../testing/recording-eve.js";
import { reportToStarter } from "./starter-report.js";
import { CODER_TOOL_SET } from "./tool-set.js";

/**
 * A started agent's final message handed to its starter as the store writer
 * settles its turn, where the starter, which takes a turn only when a
 * message reaches it, would otherwise wait on a report that never comes.
 * Over a real dialect, eve a fake at the client's boundary, the writer told
 * to hand each settled turn here as the deployment's listener does.
 * Synthetic accounts and agents.
 */

const T0 = new Date("2026-10-28T12:00:00Z").getTime();

const REPORT = "Opened the pull request; the checks are green and auto-merge is armed.";

/** A member of a fresh workspace, their orchestrating agent with its eve session recorded, and an agent it started. */
const openStarted = () =>
  Effect.gen(function* () {
    const db = yield* Database;
    const member = `user-${randomUUID()}`;
    yield* db.insert(user).values({ id: member, name: "Test User", email: `${member}@luke.test` });
    yield* connectAgentApiKeys(member);
    const organizationId = yield* openWorkspace(member);
    const start = { taskId: null, organizationId, planSnapshot: null, repository: null };
    const choice = { model: "anthropic/claude-opus-5.5", effort: "high" };
    const starter = Option.getOrThrow(
      yield* createAgent(member, {
        ...start,
        prompt: "Orchestrate the rollout.",
        idempotencyKey: randomUUID(),
        ...choice,
      }),
    ).agent;
    const agent = Option.getOrThrow(
      yield* createAgent(member, {
        ...start,
        prompt: "Record the starter.",
        title: "Record the starter",
        idempotencyKey: randomUUID(),
        startedByAgentId: starter.id,
        ...choice,
      }),
    ).agent;
    const sessionId = `wrun_${randomUUID()}`;
    yield* claimRuntimeSession(
      { userId: member, conversationId: starter.conversationId },
      sessionId,
      new Date(T0 - 60_000),
    );
    return { member, starter, agent, sessionId };
  });

/** The writer told to hand each turn it settles to the agent's starter over the eve given, as the deployment's listener does. */
const reporting = (eve: ReturnType<typeof recordingEve>) =>
  Layer.succeed(SettledTurnListener, {
    heard: (turn) =>
      reportToStarter(eve.eveFor, turn).pipe(Effect.provide(githubReaching([]).layer)),
  });

/** One turn of the agent's, begun just before `at`, answered with the words given where some are, and ended in the run status given at `at`; its id. */
const endedAt = (agent: Agent, status: RunStatus, at: number, said?: string) =>
  Effect.gen(function* () {
    const writer = yield* storeWriter({ tools: CODER_TOOL_SET });
    const target = { userId: agent.userId, conversationId: agent.conversationId };
    const turnId = randomUUID();
    const turn = { conversationId: sessionKey(agent.conversationId), turnId };
    yield* writer.enqueueTurn(target, { turnId, origin: TURN_ORIGIN.TYPED, eveTurnId: "turn_0" });
    yield* writer.consume(target, {
      ...turn,
      kind: RUN_EVENT.TURN_STARTED,
      sequence: 1,
      origin: RUN_TURN_ORIGIN.TYPED,
      trigger: TURN_TRIGGER.ASK,
      at: at - 1,
    });
    if (said !== undefined) {
      const answer = new AssistantMessageBuilder();
      answer.stepStart();
      answer.text("Reading the plan first.");
      answer.stepStart();
      answer.text(said);
      yield* writer.consume(target, {
        ...turn,
        kind: RUN_EVENT.MESSAGE_COMPLETED,
        sequence: 2,
        message: answer.finish(randomUUID()),
      });
    }
    yield* writer.consume(target, {
      ...turn,
      kind: RUN_EVENT.TURN_ENDED,
      sequence: 3,
      status,
      ...(status === RUN_STATUS.FAILED ? { failure: TURN_FAILURE.MODEL } : undefined),
      responseIds: [],
      at,
    });
    return turnId;
  });

it.layer(getTestDB())("a started agent's final message handed to its starter", (it) => {
  it.effect(
    "a completed turn hands its last words to the starter once, under the agent's name and how it ended, however many times the settle is heard",
    () =>
      Effect.gen(function* () {
        const eve = recordingEve();
        const { agent, sessionId } = yield* openStarted();

        const turnId = yield* endedAt(agent, RUN_STATUS.SUCCEEDED, T0, REPORT).pipe(
          Effect.provide(reporting(eve)),
        );
        const [told, ...more] = sentTo(eve, sessionId);
        assert.equal(more.length, 0, more.join("\n"));
        assert.ok(told !== undefined);
        assert.match(
          told,
          /^Message · \[@Record the starter\]\(.*\), an agent you started, finished its turn\. Its final message:\n\n/u,
        );
        assert.ok(told.includes(`\n\n${REPORT}\n\n`), told);
        assert.ok(told.endsWith(agentMessageReplyLine(agent.id)), told);

        // The settle heard again, as a retried batch or a second listener would, sends nothing twice.
        yield* reportToStarter(eve.eveFor, {
          userId: agent.userId,
          conversationId: agent.conversationId,
          turnId,
          status: TURN_STATUS.SETTLED,
          failure: null,
          ranMs: 1,
        }).pipe(Effect.provide(githubReaching([]).layer));
        assert.equal(sentTo(eve, sessionId).length, 1);
      }),
  );

  it.effect(
    "a failed turn that said nothing hands its failure, and a stopped one that it was stopped",
    () =>
      Effect.gen(function* () {
        const eve = recordingEve();
        const { agent, sessionId } = yield* openStarted();

        yield* endedAt(agent, RUN_STATUS.FAILED, T0).pipe(Effect.provide(reporting(eve)));
        yield* endedAt(agent, RUN_STATUS.CANCELLED, T0 + 1_000, "Stopping.").pipe(
          Effect.provide(reporting(eve)),
        );

        const [failed, stopped] = sentTo(eve, sessionId);
        assert.ok(
          failed?.includes(
            `failed its turn (${TURN_FAILURE.MODEL}). Its final message:\n\n(it said nothing)`,
          ),
          failed ?? "nothing was sent",
        );
        assert.ok(
          stopped?.includes("was stopped before it finished. Its final message:\n\nStopping."),
          stopped ?? "nothing was sent",
        );
      }),
  );

  it.effect("nothing is handed to a starter archived since", () =>
    Effect.gen(function* () {
      const eve = recordingEve();
      const { member, starter, agent } = yield* openStarted();
      yield* archiveAgent(member, starter.id, true);

      yield* endedAt(agent, RUN_STATUS.SUCCEEDED, T0, REPORT).pipe(Effect.provide(reporting(eve)));

      assert.deepEqual(eve.sent, []);
    }),
  );
});
