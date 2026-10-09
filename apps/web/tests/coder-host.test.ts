import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { CODING_AGENT_STATUS } from "@sidecar/hosted";
import { isReasoningUIPart, isTextUIPart, isToolUIPart } from "ai";
import { eq } from "drizzle-orm";
import { type Duration, Effect, Fiber, Layer, Option, Redacted, Result, Schema } from "effect";
import { TestClock } from "effect/testing";
import type { MessageStreamEvent } from "eve/client";
import type { SessionAuth, SessionAuthContext } from "eve/context";
import {
  MESSAGE_AUTHOR,
  MESSAGE_CHANNEL,
  MESSAGE_ROLE,
  TOOL_PART_STATE,
  TURN_ORIGIN,
  TURN_STATUS,
} from "../server/core";
import { db } from "../server/db/query";
import { turns } from "../server/db/storage-schema";
import { BRAIN_HOST_ATTRIBUTE, BRAIN_HOST_TURN } from "../server/hosted/brain-host/bounds";
import { hostTurnId } from "../server/hosted/brain-host/ids";
import { memoryRelayState } from "../server/hosted/brain-host/relay";
import { CODER, CODER_MODEL_FIXTURE, CODER_REFUSAL } from "../server/hosted/coder-host/bounds";
import { type CoderHost, coderHost } from "../server/hosted/coder-host/host";
import type { CoderHostSeams } from "../server/hosted/coder-host/production";
import { codingAgentStatusOf } from "../server/hosted/coder-host/status";
import { CODER_TOOL, CODER_TOOL_SET } from "../server/hosted/coder-host/tool-set";
import {
  CURSOR_START,
  cursorOfWire,
  cursorToWire,
  type TranscriptPage,
  transcriptPast,
} from "../server/hosted/coder-host/transcript";
import { createCodingAgent, latestTurnsOf } from "../server/hosted/coding-agent-store";
import { type CatalogModel, MODEL_PROVIDER, modelCatalogOf } from "../server/hosted/model-catalog";
import { createPlan, openPlanConversation } from "../server/hosted/plan-store";
import { type ConversationTarget, storeWriter } from "../server/hosted/store";
import { stampedEveEvent } from "./support/eve-events";
import { openGithubUser } from "./support/github-app-fake";
import { noNetwork } from "./support/no-network";
import { testSqlClient } from "./support/sql-client";

/**
 * The coding-agent host through the same functions the coder project's
 * authored files call, over the real migrations on PGlite: the model a step
 * is told from the agent's row and the catalog, the shared relay writing a
 * coding turn's words, reasoning, and tool calls into the store with no ask
 * record beside it, the status the turn row then reads as, and the
 * transcript read held open while the turn runs and let go when it is
 * idle or the hold is out. Synthetic accounts, plans, keys, and words
 * throughout.
 */

const NOW = 1_800_000_000_000;

const PLAN_TEXT = "# Teammate invitations\n\n## Goal\n\nInvite a teammate by email.\n";

const CATALOG: readonly CatalogModel[] = [
  {
    id: "anthropic/claude-opus-5.5",
    name: "Claude Opus 5.5",
    provider: MODEL_PROVIDER.ANTHROPIC,
    efforts: ["low", "medium", "high", "max"],
    contextWindow: 1_000_000,
  },
  {
    id: "openai/gpt-6.1-sol",
    name: "GPT-6.1 Sol",
    provider: MODEL_PROVIDER.OPENAI,
    efforts: ["low", "high"],
  },
];

const KEYS = {
  anthropic: Redacted.make("sk-ant-fixture"),
  openAi: Redacted.make("sk-openai-fixture"),
};

/** The host over the test's own store, with the writer composed on the test's client. */
const hostOverStore = Effect.gen(function* () {
  const writer = yield* storeWriter({ tools: CODER_TOOL_SET });
  const seams: CoderHostSeams = {
    writer: () => Effect.succeed(writer),
    userInfo: () => Effect.succeed(undefined),
    ownership: {
      sessionOwner: () => Promise.resolve(undefined),
      ownsConversation: () => Promise.resolve(false),
    },
    keys: () => KEYS,
    scriptedModel: () => false,
    now: () => NOW,
  };
  return coderHost(seams);
});

function principal(
  id: string,
  attributes: Readonly<Record<string, string>> = {},
): SessionAuthContext {
  return { principalId: id, principalType: "user", authenticator: "test", attributes };
}

/** The developer's own seat in the agent's conversation: the same principal opened the session and speaks now, on a typed turn. */
function ownSeat(userId: string, conversationId: string): SessionAuth {
  const seat = principal(userId, {
    [BRAIN_HOST_ATTRIBUTE.CONVERSATION]: conversationId,
    [BRAIN_HOST_ATTRIBUTE.TURN]: BRAIN_HOST_TURN.TYPED,
  });
  return { current: seat, initiator: seat };
}

let minted = 0;
function mintSession(): string {
  minted += 1;
  return `wrun_01M${String(minted).padStart(22, "0")}`;
}

/** An account with one agent started on a plan, on the model given, its session claimed as the hook claims it. */
const openAgent = (host: CoderHost, model = "anthropic/claude-opus-5.5", effort = "high") =>
  Effect.gen(function* () {
    const userId = yield* openGithubUser();
    const plan = yield* createPlan(userId, {
      name: "Teammate invitations",
      repository: "acme/relay",
    });
    const started = yield* createCodingAgent(userId, {
      planId: plan.id,
      idempotencyKey: `start-${minted}`,
      model,
      effort,
      planSnapshot: PLAN_TEXT,
      repository: "acme/relay",
    });
    assert.ok(Option.isSome(started));
    const { agent } = started.value;
    const target: ConversationTarget = { userId, conversationId: agent.conversationId };
    const auth = ownSeat(userId, agent.conversationId);
    const sessionId = mintSession();
    const starting = yield* host.admitStarting(auth, sessionId);
    assert.ok(Result.isSuccess(starting));
    assert.equal(yield* host.sessionStarted(starting.success, sessionId), true);
    const admitted = yield* host.admit(auth, sessionId);
    assert.ok(Result.isSuccess(admitted));
    return { userId, agent, target, auth, sessionId, admitted: admitted.success };
  });

const stamped = <Event extends Omit<MessageStreamEvent, "meta">>(event: Event) =>
  stampedEveEvent(event, NOW);

/** One coding turn as eve emits it: the plan received, a shell call answered, a thought, words, and the end given. */
function codingTurn(
  turnId: string,
  end: "turn.completed" | "turn.failed" | "turn.cancelled",
): MessageStreamEvent[] {
  const sequence = 0;
  const ended: MessageStreamEvent =
    end === "turn.failed"
      ? stamped({
          type: "turn.failed",
          data: { turnId, sequence, code: "MODEL_CALL_FAILED", message: "the provider refused" },
        })
      : stamped({ type: end, data: { turnId, sequence } });
  return [
    stamped({ type: "turn.started", data: { turnId, sequence } }),
    stamped({ type: "message.received", data: { turnId, sequence, message: PLAN_TEXT } }),
    stamped({ type: "step.started", data: { turnId, sequence, stepIndex: 0, modelId: "m" } }),
    stamped({
      type: "actions.requested",
      data: {
        turnId,
        sequence,
        stepIndex: 0,
        actions: [
          {
            kind: "tool-call",
            callId: "call-1",
            toolName: CODER_TOOL.BASH,
            input: { command: "cat AGENTS.md" },
          },
        ],
      },
    }),
    stamped({
      type: "action.result",
      data: {
        turnId,
        sequence,
        stepIndex: 0,
        status: "completed",
        result: {
          kind: "tool-result",
          callId: "call-1",
          toolName: CODER_TOOL.BASH,
          output: { status: "completed", exitCode: 0, stdout: "# Agent guide\n", stderr: "" },
        },
      },
    }),
    stamped({
      type: "reasoning.completed",
      data: { turnId, sequence, stepIndex: 0, reasoning: "Read the guide first." },
    }),
    stamped({
      type: "step.completed",
      data: { turnId, sequence, stepIndex: 0, finishReason: "tool-calls" },
    }),
    stamped({ type: "step.started", data: { turnId, sequence, stepIndex: 1, modelId: "m" } }),
    stamped({
      type: "message.completed",
      data: {
        turnId,
        sequence,
        stepIndex: 1,
        finishReason: "stop",
        message: "The guide is read; the plan fits the code.",
      },
    }),
    stamped({
      type: "step.completed",
      data: { turnId, sequence, stepIndex: 1, finishReason: "stop" },
    }),
    ended,
  ];
}

const STEP_START = "step-start";

/** The id of the provider's model a step was told, read off the SDK's handle; none for a bare id. */
const readModelId = Schema.decodeUnknownOption(
  Schema.Struct({ modelId: Schema.String }).pipe(
    Schema.decodeTo(Schema.String, {
      decode: (handle) => handle.modelId,
      encode: (modelId) => ({ modelId }),
    }),
  ),
);

const TurnRowSchema = Schema.Struct({
  origin: Schema.String,
  status: Schema.String,
  model: Schema.NullOr(Schema.String),
  reasoningEffort: Schema.NullOr(Schema.String),
  promptHash: Schema.NullOr(Schema.String),
});

/** The turn row as the relay wrote it, read on the test's own client. */
const turnRow = (id: string) =>
  Effect.map(
    db
      .select({
        origin: turns.origin,
        status: turns.status,
        model: turns.model,
        reasoningEffort: turns.reasoningEffort,
        promptHash: turns.promptHash,
      })
      .from(turns)
      .where(eq(turns.id, id)),
    (rows) =>
      rows[0] === undefined ? undefined : Schema.decodeUnknownSync(TurnRowSchema)(rows[0]),
  );

/** A forked effect driven to its end, the clock moved a step at a time so each wait it holds elapses. */
const driven = <A, E>(fiber: Fiber.Fiber<A, E>, step: Duration.Duration) =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < 1_000; attempt += 1) {
      if (fiber.pollUnsafe() !== undefined) return yield* Fiber.join(fiber);
      yield* TestClock.adjust(step);
      yield* Effect.yieldNow;
    }
    return yield* Fiber.join(fiber);
  });

it.layer(Layer.mergeAll(testSqlClient, noNetwork))("the coding-agent host", (it) => {
  it.effect(
    "a step is told the model and effort the agent's row holds now, with the window the catalog lists, and the fallback where it lists none",
    () =>
      Effect.gen(function* () {
        const host = yield* hostOverStore;
        const opus = yield* openAgent(host);
        const selected = yield* host
          .model(opus.admitted, undefined)
          .pipe(Effect.provide(modelCatalogOf(CATALOG)));
        assert.ok(Result.isSuccess(selected));
        assert.equal(Option.getOrUndefined(readModelId(selected.success.model)), "claude-opus-5-5");
        assert.equal(selected.success.modelContextWindowTokens, 1_000_000);
        assert.deepEqual(selected.success.modelOptions, {
          providerOptions: { anthropic: { effort: "high" } },
        });

        const sol = yield* openAgent(host, "openai/gpt-6.1-sol", "low");
        const unlisted = yield* host
          .model(sol.admitted, undefined)
          .pipe(Effect.provide(modelCatalogOf(CATALOG)));
        assert.ok(Result.isSuccess(unlisted));
        assert.equal(
          unlisted.success.modelContextWindowTokens,
          CODER.FALLBACK_CONTEXT_WINDOW_TOKENS,
        );
        assert.deepEqual(unlisted.success.modelOptions, {
          providerOptions: { openai: { reasoningEffort: "low" } },
        });
      }),
  );

  it.effect(
    "a conversation that is no agent's is refused a model, an agent, and a prompt alike",
    () =>
      Effect.gen(function* () {
        const host = yield* hostOverStore;
        const { admitted } = yield* openAgent(host);
        // The same account's other conversation: a plan's, which no agent row names.
        const userId = admitted.target.userId;
        const plan = yield* createPlan(userId, { name: "Billing export" });
        const conversationId = Option.getOrThrow(yield* openPlanConversation(userId, plan.id));
        const sessionId = mintSession();
        const auth = ownSeat(userId, conversationId);
        const starting = yield* host.admitStarting(auth, sessionId);
        assert.ok(Result.isSuccess(starting));
        yield* host.sessionStarted(starting.success, sessionId);
        const other = yield* host.admit(auth, sessionId);
        assert.ok(Result.isSuccess(other));

        assert.deepEqual(yield* host.agent(other.success), Result.fail(CODER_REFUSAL.NO_AGENT));
        assert.deepEqual(
          yield* host.model(other.success, undefined).pipe(Effect.provide(modelCatalogOf(CATALOG))),
          Result.fail(CODER_REFUSAL.NO_AGENT),
        );
      }),
  );

  it.effect(
    "a coding turn lands through the shared relay with no ask record: the plan as the developer's line, the answer with its reasoning, its shell call, and its words, and the turn row naming the agent's model and effort",
    () =>
      Effect.gen(function* () {
        const host = yield* hostOverStore;
        const { agent, target, auth, sessionId, admitted } = yield* openAgent(host);
        const state = memoryRelayState();
        const prompt = host.prompt(agent);
        const session = { id: sessionId, auth, turn: { id: "turn_0" } };
        for (const event of codingTurn("turn_0", "turn.completed")) {
          // SAFETY: the relay reads the session's id and auth; eve's turn metadata is not read here.
          yield* host.relay(event, admitted, session as never, state, { hash: prompt.hash });
        }

        const turn = yield* turnRow(hostTurnId(sessionId, "turn_0"));
        assert.ok(turn);
        assert.equal(turn.origin, TURN_ORIGIN.TYPED);
        assert.equal(turn.status, TURN_STATUS.SETTLED);
        assert.equal(turn.model, agent.model);
        assert.equal(turn.reasoningEffort, agent.effort);
        assert.equal(turn.promptHash, prompt.hash);

        const page = yield* transcriptPast(target, CODER_TOOL_SET, CURSOR_START);
        assert.deepEqual(
          page.messages.map((message) => message.role),
          [MESSAGE_ROLE.USER, MESSAGE_ROLE.ASSISTANT],
        );
        const [words, answer] = page.messages;
        assert.ok(words && answer);
        assert.equal(words.role, MESSAGE_ROLE.USER);
        if (words.role !== MESSAGE_ROLE.USER) return;
        assert.deepEqual(words.metadata, {
          author: MESSAGE_AUTHOR.DEVELOPER,
          channel: MESSAGE_CHANNEL.TYPED,
        });
        assert.ok(words.parts.some((part) => isTextUIPart(part) && part.text === PLAN_TEXT));
        assert.deepEqual(
          answer.parts.map((part) => part.type),
          [STEP_START, "reasoning", `tool-${CODER_TOOL.BASH}`, STEP_START, "text"],
        );
        const reasoning = answer.parts.find((part) => isReasoningUIPart(part));
        assert.equal(reasoning?.text, "Read the guide first.");
        const call = answer.parts.find((part) => isToolUIPart(part));
        assert.ok(call);
        assert.equal(call.state, TOOL_PART_STATE.OUTPUT_AVAILABLE);
        assert.deepEqual(call.input, { command: "cat AGENTS.md" });
        assert.deepEqual(state.get(), { turns: {} });

        const turns = yield* latestTurnsOf(target.userId, [target.conversationId]);
        assert.equal(
          codingAgentStatusOf(turns.get(target.conversationId)),
          CODING_AGENT_STATUS.COMPLETED,
        );
      }),
  );

  it.effect(
    "a failed turn and a cancelled turn read as failed and cancelled, and the agent is never rerun",
    () =>
      Effect.gen(function* () {
        const host = yield* hostOverStore;
        for (const [end, status] of [
          ["turn.failed", CODING_AGENT_STATUS.FAILED],
          ["turn.cancelled", CODING_AGENT_STATUS.CANCELLED],
        ] as const) {
          const { agent, target, auth, sessionId, admitted } = yield* openAgent(host);
          const state = memoryRelayState();
          const session = { id: sessionId, auth, turn: { id: "turn_0" } };
          for (const event of codingTurn("turn_0", end)) {
            // SAFETY: the relay reads the session's id and auth; eve's turn metadata is not read here.
            yield* host.relay(event, admitted, session as never, state, {
              hash: host.prompt(agent).hash,
            });
          }
          const turns = yield* latestTurnsOf(target.userId, [target.conversationId]);
          assert.equal(codingAgentStatusOf(turns.get(target.conversationId)), status);
          assert.equal(turns.size, 1);
        }
      }),
  );

  it.effect(
    "a transcript read past the cursor is held open while the turn runs, answers the moment a message lands, hears an amended journal again, and lets go at the hold on an idle agent at once",
    () =>
      Effect.gen(function* () {
        const host = yield* hostOverStore;
        const { agent, target, auth, sessionId, admitted } = yield* openAgent(host);
        const state = memoryRelayState();
        const session = { id: sessionId, auth, turn: { id: "turn_0" } };
        const events = codingTurn("turn_0", "turn.completed");
        const play = (from: number, to: number) =>
          Effect.forEach(events.slice(from, to), (event) =>
            // SAFETY: the relay reads the session's id and auth; eve's turn metadata is not read here.
            host.relay(event, admitted, session as never, state, { hash: host.prompt(agent).hash }),
          );

        // Idle before the first turn: nothing stands, and the read answers at once.
        const idle = yield* transcriptPast(target, CODER_TOOL_SET, CURSOR_START);
        assert.deepEqual(idle.messages, []);
        assert.equal(cursorToWire(idle.cursor), "0:0");

        // The turn starts and the plan lands: a held read answers with it.
        yield* play(0, 2);
        const first = yield* transcriptPast(target, CODER_TOOL_SET, CURSOR_START);
        assert.equal(first.messages.length, 1);
        assert.equal(first.messages[0]?.role, MESSAGE_ROLE.USER);

        // Past that, nothing new while the turn runs: the read holds, and the journal's next write releases it.
        const held = yield* Effect.forkChild(transcriptPast(target, CODER_TOOL_SET, first.cursor));
        yield* TestClock.adjust(CODER.MESSAGES_POLL);
        assert.equal(held.pollUnsafe(), undefined);
        yield* play(2, 5);
        const released = yield* driven(held, CODER.MESSAGES_POLL);
        assert.equal(released.messages.length, 1);
        assert.equal(released.messages[0]?.role, MESSAGE_ROLE.ASSISTANT);
        assert.ok(
          released.cursor.revision > first.cursor.revision ||
            released.cursor.seq > first.cursor.seq,
        );

        // The journal grows in place: the same row is heard again past the cursor it was last read at.
        yield* play(5, 7);
        const amended = yield* transcriptPast(target, CODER_TOOL_SET, released.cursor);
        assert.equal(amended.messages.length, 1);
        assert.ok(amended.messages[0]?.parts.some((part) => isReasoningUIPart(part)));

        // Nothing lands inside the hold: the read lets go empty with the cursor to read on from.
        const expiring = yield* Effect.forkChild(
          transcriptPast(target, CODER_TOOL_SET, amended.cursor),
        );
        yield* TestClock.adjust(CODER.MESSAGES_HOLD);
        const expired: TranscriptPage = yield* driven(expiring, CODER.MESSAGES_POLL);
        assert.deepEqual(expired.messages, []);
        assert.deepEqual(cursorOfWire(cursorToWire(expired.cursor)), amended.cursor);

        // The turn ends: the finished answer replaces the journal, and an idle agent's empty read answers at once.
        yield* play(7, events.length);
        const finished = yield* transcriptPast(target, CODER_TOOL_SET, expired.cursor);
        assert.equal(finished.messages.length, 1);
        assert.ok(finished.messages[0]?.parts.some((part) => isTextUIPart(part)));
        const done = yield* transcriptPast(target, CODER_TOOL_SET, finished.cursor);
        assert.deepEqual(done.messages, []);
      }),
  );

  it.effect(
    "under the scripted fixture the step runs the model handed in and the turn row names the fixture",
    () =>
      Effect.gen(function* () {
        const writer = yield* storeWriter({ tools: CODER_TOOL_SET });
        const host = coderHost({
          writer: () => Effect.succeed(writer),
          userInfo: () => Effect.succeed(undefined),
          ownership: {
            sessionOwner: () => Promise.resolve(undefined),
            ownsConversation: () => Promise.resolve(false),
          },
          keys: () => ({ anthropic: undefined, openAi: undefined }),
          scriptedModel: () => true,
          now: () => NOW,
        });
        const { agent, auth, sessionId, admitted } = yield* openAgent(host);
        const scripted = { model: "luke-fixtures/scripted" as const };
        const selected = yield* host
          .model(admitted, scripted)
          .pipe(Effect.provide(modelCatalogOf([])));
        assert.ok(Result.isSuccess(selected));
        assert.equal(selected.success.model, scripted.model);

        const state = memoryRelayState();
        const session = { id: sessionId, auth, turn: { id: "turn_0" } };
        // SAFETY: the relay reads the session's id and auth; eve's turn metadata is not read here.
        yield* host.relay(
          codingTurn("turn_0", "turn.completed")[0] as MessageStreamEvent,
          admitted,
          session as never,
          state,
          { hash: host.prompt(agent).hash },
        );
        const turn = yield* turnRow(hostTurnId(sessionId, "turn_0"));
        assert.equal(turn?.model, CODER_MODEL_FIXTURE.SCRIPTED_MODEL_ID);
      }),
  );
});
