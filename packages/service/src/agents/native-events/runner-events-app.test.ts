import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { RUNNER_END, RUNNER_EVENT, type RunnerEvent } from "@luke/agent-runner/protocol";
import { Database } from "@luke/database/core/query";
import {
  createCodingAgent,
  readCodingAgentContext,
  readCodingAgentRouting,
  recordCodingAgentRunnerToken,
} from "@luke/database/models/coding-agent-store";
import { sentLineId } from "@luke/database/models/ids";
import { storeWriter } from "@luke/database/models/writer";
import { user } from "@luke/database/schemas/auth";
import { conversations, messages, turns } from "@luke/database/schemas/storage";
import { CONVERSATION_RUNTIME, MESSAGE_SENDER } from "@luke/database/storage-vocabulary";
import { getTestDB, startTask } from "@luke/database/testing";
import { CODING_AGENT_PAYER } from "@luke/features/coding-agent-wire";
import { TURN_STATUS } from "@luke/wire";
import { asc, eq } from "drizzle-orm";
import { Clock, Effect, Layer, Option } from "effect";
import { HttpRouter } from "effect/http";
import { SqlClient } from "effect/sql";
import { HOSTED_HTTP_STATUS } from "../../http/http.js";
import { CODER_TOOL_SET } from "../coder-host/tool-set.js";
import { runnerTokenDigest } from "../luke-mcp/bearer.js";
import {
  RUNNER_EVENTS_PATH,
  type RunnerEnded,
  type RunnerEventsOptions,
  runnerEventsApp,
} from "./runner-events-app.js";

/**
 * The events route, answered by its group the way a function answers it,
 * over a real dialect: a runner's batches of Claude Code's SDK messages,
 * posted under its bearer, land in the agent's transcript as the eve relay
 * would write them, a batch posted again changes nothing, and a wrong or
 * retired bearer is refused before anything is read. The stream is P00's
 * hermetic one, as the runner's own tests replay it
 * (`packages/agent-runner/src/testing/recorded-stream.ts`), numbered as the
 * runner posts it. Synthetic accounts, words, and ids throughout.
 */

const ORIGIN = "https://luke.test";
const SESSION = "00000000-0000-4000-8000-000000000001";
const NONCE = "a1b2c3d4e5f6";

/** The route's group over the test's database, as a fetch. */
const standingWith = (options: RunnerEventsOptions) =>
  Effect.gen(function* () {
    const services = Layer.mergeAll(
      Layer.succeed(SqlClient.SqlClient, yield* SqlClient.SqlClient),
      Layer.succeed(Database, yield* Database),
      Layer.succeed(Clock.Clock, yield* Clock.Clock),
    );
    const web = HttpRouter.toWebHandler(
      runnerEventsApp(options).pipe(HttpRouter.provideRequest(services)),
      {
        disableLogger: true,
      },
    );
    yield* Effect.addFinalizer(() => Effect.promise(() => web.dispose()));
    return (bearer: string | undefined, events: readonly RunnerEvent[]) =>
      Effect.promise(async () => {
        const headers = new Headers({ "content-type": "application/json" });
        if (bearer !== undefined) headers.set("authorization", `Bearer ${bearer}`);
        const response = await web.handler(
          new Request(`${ORIGIN}${RUNNER_EVENTS_PATH}`, {
            method: "POST",
            headers,
            body: JSON.stringify({ events }),
          }),
        );
        return { status: response.status, body: await response.json() };
      });
  });

const standing = standingWith({});

/** A Claude Code agent on a task, a runner's bearer recorded for it, and the developer's line awaiting its turn. */
const agentWithBearer = Effect.gen(function* () {
  const db = yield* Database;
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
  const task = yield* startTask(userId, { name: "Teammate invitations" });
  const started = yield* createCodingAgent(userId, {
    taskId: task.id,
    idempotencyKey: randomUUID(),
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    repository: "acme/relay",
    planSnapshot: "# Teammate invitations\n",
    prompt: null,
    runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
    payer: CODING_AGENT_PAYER.CLAUDE_SUBSCRIPTION,
  });
  const agent = Option.getOrThrow(started).agent;
  const bearer = randomBytes(32).toString("base64url");
  yield* recordCodingAgentRunnerToken(userId, agent.id, runnerTokenDigest(bearer));
  const target = { userId, conversationId: agent.conversationId };
  const clientKey = randomUUID();
  const writer = yield* storeWriter({ tools: CODER_TOOL_SET });
  yield* writer.writeAwaitingLine(
    target,
    { text: "Run the probe.", clientKey, sender: { kind: MESSAGE_SENDER.MEMBER, userId } },
    Effect.succeed(true),
  );
  return { userId, agentId: agent.id, target, bearer, lineId: sentLineId(clientKey) };
});

/** The SDK messages of P00's workflow turn, in the pinned SDK's shapes, as the runner numbers and posts them. */
function workflowTurn(lineId: string): readonly RunnerEvent[] {
  const envelope = { parent_tool_use_id: null, session_id: SESSION, uuid: randomUUID() };
  const toolUse = (id: string, name: string, input: object) => ({
    type: "assistant",
    message: { content: [{ type: "tool_use", id, name, input }] },
    ...envelope,
  });
  const toolResult = (id: string, text: string) => ({
    type: "user",
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: id, content: [{ type: "text", text }] }],
    },
    ...envelope,
  });
  const partial = (text: string) => ({
    type: "stream_event",
    event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
    ...envelope,
  });
  const result = (input: number, output: number) => ({
    type: "result",
    subtype: "success",
    is_error: false,
    usage: {
      input_tokens: input,
      output_tokens: output,
      cache_read_input_tokens: 100,
      cache_creation_input_tokens: 10,
    },
    ...envelope,
  });
  const messagesOfTurn = [
    { type: RUNNER_EVENT.ACCEPTED, uuid: lineId },
    { type: "system", subtype: "init", ...envelope },
    toolUse("toolu_Write", "Write", { file_path: `luke-probe/${NONCE}.txt`, content: NONCE }),
    toolResult("toolu_Write", "File created"),
    toolUse("toolu_inbox", "mcp__luke__read_inbox", {}),
    toolResult("toolu_inbox", '{"status":"accepted","inbox":[]}'),
    toolUse("toolu_Bash", "Bash", {
      command: `sleep 45 && echo ${NONCE}`,
      run_in_background: true,
    }),
    toolUse("toolu_wake", "ScheduleWakeup", { delaySeconds: 60, reason: "wait" }),
    result(5, 7),
    { type: RUNNER_EVENT.WAITING, background_tasks: [], session_crons: [] },
    partial("Background done. LUKE-PROBE-"),
    partial("TURN-1-DONE"),
    {
      type: "assistant",
      message: { content: [{ type: "text", text: "Background done. LUKE-PROBE-TURN-1-DONE" }] },
      ...envelope,
    },
    result(3, 2),
    { type: RUNNER_EVENT.END, reason: RUNNER_END.TURN_ENDED },
  ];
  // SAFETY: each message above is one the pinned SDK or the runner emits, written in its JSON shape.
  return messagesOfTurn.map((message, sequence) => ({ sequence, message }) as RunnerEvent);
}

/** The conversation's rows as a reader of the transcript sees them: each message's role and parts, and each turn's end. */
const transcriptOf = (conversationId: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const rows = yield* db
      .select({ role: messages.role, parts: messages.parts, turnId: messages.turnId })
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(asc(messages.seq));
    const turnRows = yield* db
      .select({
        status: turns.status,
        usage: turns.usage,
        failureDetail: turns.failureDetail,
        model: turns.model,
      })
      .from(turns)
      .where(eq(turns.conversationId, conversationId));
    return { rows, turns: turnRows };
  });

/** What the record settles a call with that its turn ended, or was cancelled, before it answered. */
const UNANSWERED = {
  ENDED: {
    reason: "The turn ended before the call answered; it may have run.",
    status: "unknown",
  },
  CANCELLED: {
    reason: "The turn was cancelled before the call answered; it may have run.",
    status: "unknown",
  },
} as const;

/** A part as the transcript draws it: its type, and its words, state, and output where it has them. */
function drawn(part: Readonly<Record<string, unknown>>): readonly unknown[] {
  return [part.type, part.text ?? part.state, part.output].filter((field) => field !== undefined);
}

it.layer(getTestDB())("the runner events route", (it) => {
  it.effect(
    "P00's workflow turn lands as one turn: the line it took, each call settled, the words, and its cost",
    () =>
      Effect.gen(function* () {
        const post = yield* standing;
        const agent = yield* agentWithBearer;
        const events = workflowTurn(agent.lineId);

        const first = yield* post(agent.bearer, events.slice(0, 11));
        const midway = yield* transcriptOf(agent.target.conversationId);
        const last = yield* post(agent.bearer, events.slice(11));
        const { rows, turns: settled } = yield* transcriptOf(agent.target.conversationId);

        assert.deepEqual(first.body, { applied: 11, sequence: 10 });
        assert.deepEqual(last.body, { applied: 4, sequence: 14 });
        // A model turn that ends with work still in flight leaves the agent's turn running,
        // and the words forming after it are told through their last finished sentence.
        assert.deepEqual(
          midway.turns.map((turn) => turn.status),
          [TURN_STATUS.RUNNING],
        );
        assert.deepEqual(midway.rows.at(-1)?.parts.map(drawn).at(-1), ["text", "Background done."]);
        const [line, answer] = rows;
        assert.equal(rows.length, 2);
        assert.equal(line?.role, "user");
        assert.equal(line?.turnId, answer?.turnId);
        assert.deepEqual(answer?.parts.map(drawn), [
          ["step-start"],
          ["tool-Write", "output-available", "File created"],
          ["step-start"],
          ["tool-read_inbox", "output-available", { status: "accepted", inbox: [] }],
          ["step-start"],
          // P00's stream never answers these two, so the turn's end settles them as unanswered.
          ["tool-Bash", "output-available", UNANSWERED.ENDED],
          ["tool-ScheduleWakeup", "output-available", UNANSWERED.ENDED],
          ["step-start"],
          ["text", "Background done. LUKE-PROBE-TURN-1-DONE"],
        ]);
        assert.deepEqual(settled, [
          {
            status: TURN_STATUS.SETTLED,
            usage: {
              inputTokens: 228,
              outputTokens: 9,
              cachedInputTokens: 200,
              reasoningTokens: 0,
              cacheWriteTokens: 20,
              byModel: [
                {
                  model: "anthropic/claude-opus-5.5",
                  inputTokens: 228,
                  outputTokens: 9,
                  cachedInputTokens: 200,
                  reasoningTokens: 0,
                  cacheWriteTokens: 20,
                },
              ],
            },
            failureDetail: null,
            model: "anthropic/claude-opus-5.5",
          },
        ]);
        const routing = yield* readCodingAgentRouting(agent.userId, agent.agentId);
        assert.equal(Option.getOrThrow(routing).nativeSession, SESSION);
      }),
  );

  it.effect("a batch posted again, whole or overlapping, changes nothing", () =>
    Effect.gen(function* () {
      const post = yield* standing;
      const agent = yield* agentWithBearer;
      const events = workflowTurn(agent.lineId);
      yield* post(agent.bearer, events.slice(0, 12));
      const once = yield* transcriptOf(agent.target.conversationId);

      const again = yield* post(agent.bearer, events.slice(0, 12));
      const overlapping = yield* post(agent.bearer, events.slice(8, 12));
      const twice = yield* transcriptOf(agent.target.conversationId);

      assert.deepEqual(again.body, { applied: 0, sequence: 11 });
      assert.deepEqual(overlapping.body, { applied: 0, sequence: 11 });
      assert.deepEqual(twice, once);
    }),
  );

  it.effect("a wrong bearer, none, and one retired from the conversation are refused", () =>
    Effect.gen(function* () {
      const post = yield* standing;
      const agent = yield* agentWithBearer;
      const events = workflowTurn(agent.lineId).slice(0, 2);

      const wrong = yield* post(randomBytes(32).toString("base64url"), events);
      const none = yield* post(undefined, events);
      yield* recordCodingAgentRunnerToken(agent.userId, agent.agentId, null);
      const retired = yield* post(agent.bearer, events);
      const { rows, turns: written } = yield* transcriptOf(agent.target.conversationId);

      assert.deepEqual(
        [wrong.status, none.status, retired.status],
        [
          HOSTED_HTTP_STATUS.UNAUTHORIZED,
          HOSTED_HTTP_STATUS.UNAUTHORIZED,
          HOSTED_HTTP_STATUS.UNAUTHORIZED,
        ],
      );
      // The awaiting line alone stands: nothing of the batch was applied.
      assert.deepEqual(
        rows.map((row) => row.turnId),
        [null],
      );
      assert.deepEqual(written, []);
    }),
  );

  it.effect(
    "a subagent's work folds under its Agent call, and a stopped launch ends its turn cancelled and is told once",
    () =>
      Effect.gen(function* () {
        const told: RunnerEnded[] = [];
        const post = yield* standingWith({
          ended: (ended) => Effect.sync(() => void told.push(ended)),
        });
        const agent = yield* agentWithBearer;
        const inside = { parent_tool_use_id: "toolu_agent", session_id: SESSION };
        const top = { parent_tool_use_id: null, session_id: SESSION };
        const messagesOfTurn = [
          { type: RUNNER_EVENT.ACCEPTED, uuid: agent.lineId },
          {
            type: "assistant",
            message: {
              id: "msg_1",
              content: [
                { type: "text", text: "Asking a helper." },
                {
                  type: "tool_use",
                  id: "toolu_agent",
                  name: "Agent",
                  input: { description: "find the queue", prompt: "Find it." },
                },
              ],
            },
            ...top,
          },
          {
            type: "assistant",
            message: {
              id: "msg_sub",
              content: [{ type: "tool_use", id: "toolu_sub", name: "Grep", input: {} }],
            },
            ...inside,
          },
          {
            type: "user",
            message: {
              content: [{ type: "tool_result", tool_use_id: "toolu_sub", content: "queue.ts" }],
            },
            ...inside,
          },
          {
            type: "user",
            message: {
              content: [
                { type: "tool_result", tool_use_id: "toolu_agent", content: "It is in queue.ts." },
              ],
            },
            ...top,
          },
          {
            type: "assistant",
            message: {
              id: "msg_2",
              content: [{ type: "tool_use", id: "toolu_sleep", name: "Bash", input: {} }],
            },
            ...top,
          },
          { type: "result", subtype: "error_during_execution", is_error: true, ...top },
          { type: RUNNER_EVENT.END, reason: RUNNER_END.STOPPED },
        ];
        // SAFETY: each message above is one the pinned SDK or the runner emits, written in its JSON shape.
        const events = messagesOfTurn.map(
          (message, sequence) => ({ sequence, message }) as RunnerEvent,
        );

        yield* post(agent.bearer, events);
        yield* post(agent.bearer, events);
        const { rows, turns: ended } = yield* transcriptOf(agent.target.conversationId);

        assert.deepEqual(
          told.map((end) => [end.target, end.sequence]),
          [[agent.target, events.length - 1]],
        );
        assert.deepEqual(rows.at(-1)?.parts.map(drawn), [
          ["step-start"],
          ["text", "Asking a helper."],
          ["tool-Agent", "output-available", "It is in queue.ts."],
          ["step-start"],
          ["tool-Bash", "output-available", UNANSWERED.CANCELLED],
        ]);
        assert.deepEqual(
          ended.map((turn) => turn.status),
          [TURN_STATUS.CANCELLED],
        );
      }),
  );

  it.effect(
    "a compaction stamps the agent, and a launch the plan's limit refused fails its turn saying so",
    () =>
      Effect.gen(function* () {
        const post = yield* standing;
        const agent = yield* agentWithBearer;
        const top = { parent_tool_use_id: null, session_id: SESSION };
        const messagesOfTurn = [
          { type: RUNNER_EVENT.ACCEPTED, uuid: agent.lineId },
          {
            type: "system",
            subtype: "compact_boundary",
            compact_metadata: { trigger: "auto", pre_tokens: 1000 },
            ...top,
          },
          {
            type: "rate_limit_event",
            rate_limit_info: {
              status: "rejected",
              rateLimitType: "five_hour",
              resetsAt: 1_800_000_000,
            },
            ...top,
          },
          { type: "result", subtype: "error_during_execution", is_error: true, ...top },
          { type: RUNNER_EVENT.END, reason: RUNNER_END.TURN_ENDED },
        ];
        // SAFETY: each message above is one the pinned SDK or the runner emits, written in its JSON shape.
        const events = messagesOfTurn.map(
          (message, sequence) => ({ sequence, message }) as RunnerEvent,
        );

        yield* post(agent.bearer, events);
        const { turns: ended } = yield* transcriptOf(agent.target.conversationId);
        const context = yield* readCodingAgentContext(agent.userId, agent.agentId);

        assert.deepEqual(
          ended.map((turn) => [turn.status, turn.failureDetail]),
          [
            [
              TURN_STATUS.FAILED,
              "error_during_execution; rate_limit_rejected five_hour resets 2027-01-15T08:00:00.000Z",
            ],
          ],
        );
        assert.notEqual(Option.getOrThrow(context).compactedAt, null);
      }),
  );

  it.effect(
    "the last event applied is kept on the conversation, for a relaunch to number after",
    () =>
      Effect.gen(function* () {
        const post = yield* standing;
        const agent = yield* agentWithBearer;
        yield* post(agent.bearer, workflowTurn(agent.lineId).slice(0, 4));
        const db = yield* Database;
        const [row] = yield* db
          .select({ sequence: conversations.nativeSequence })
          .from(conversations)
          .where(eq(conversations.id, agent.target.conversationId));
        assert.equal(row?.sequence, 3);
      }),
  );
});
