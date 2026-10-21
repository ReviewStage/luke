import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { it } from "@effect/vitest";
import { RUNNER_END, RUNNER_EVENT, type RunnerEvent } from "@luke/agent-runner/protocol";
import { Database } from "@luke/database/core/query";
import {
  createCodingAgent,
  readCodingAgent,
  readCodingAgentContext,
  readCodingAgentRouting,
  recordCodingAgentPublished,
  recordCodingAgentRunnerToken,
} from "@luke/database/models/coding-agent-store";
import { sentLineId } from "@luke/database/models/ids";
import {
  listProviderKeyRows,
  type ProviderKeyRow,
  saveProviderKey,
} from "@luke/database/models/provider-key-store";
import { readTask, updateTask } from "@luke/database/models/task-store";
import { storeWriter } from "@luke/database/models/writer";
import { user } from "@luke/database/schemas/auth";
import { conversations, messages, turns } from "@luke/database/schemas/storage";
import { CONVERSATION_RUNTIME, MESSAGE_SENDER } from "@luke/database/storage-vocabulary";
import { getTestDB, startTask } from "@luke/database/testing";
import {
  CHECK_SUMMARY,
  CODING_AGENT_PAYER,
  type CodingAgentPayer,
  PULL_REQUEST_STATE,
} from "@luke/features/coding-agent-wire";
import {
  PROVIDER_KEY_KIND,
  PROVIDER_KEY_PROVIDER,
  PROVIDER_KEY_STATUS,
} from "@luke/features/provider-key-wire";
import { TASK_STATUS } from "@luke/features/task-wire";
import { TURN_STATUS, valueFromJsonText, type WireRecord, type WireValue } from "@luke/wire";
import type { StoredUIMessage } from "@luke/wire/ui-messages";
import { asc, eq } from "drizzle-orm";
import { Clock, Effect, Layer, Option } from "effect";
import { HttpRouter } from "effect/http";
import { SqlClient } from "effect/sql";
import { TestClock } from "effect/testing";
import { HOSTED_HTTP_STATUS } from "../../http/http.js";
import { modelCatalogOf } from "../../providers/model-catalog.js";
import { CODER } from "../coder-host/bounds.js";
import { CODER_TOOL_SET } from "../coder-host/tool-set.js";
import { CURSOR_START, transcriptPast } from "../coder-host/transcript.js";
import { runnerTokenDigest } from "../luke-mcp/bearer.js";
import {
  RUNNER_EVENTS_PATH,
  type RunnerAlive,
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

/** What each harness's agent is started on. */
const HARNESS = {
  CLAUDE_CODE: {
    model: "anthropic/claude-opus-5.5",
    runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
    payer: CODING_AGENT_PAYER.CLAUDE_SUBSCRIPTION,
  },
  CODEX: {
    model: "openai/gpt-5.5",
    runtime: CONVERSATION_RUNTIME.CODEX,
    payer: CODING_AGENT_PAYER.CHATGPT_SUBSCRIPTION,
  },
} as const;

/** A coding agent on the harness given, a runner's bearer recorded for it, and the developer's lines awaiting their turns. */
const agentOn = (
  harness: {
    readonly model: string;
    readonly runtime: (typeof HARNESS)[keyof typeof HARNESS]["runtime"];
    readonly payer: CodingAgentPayer;
  },
  lines: readonly string[],
) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const userId = `user-${randomUUID()}`;
    yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
    const task = yield* startTask(userId, { name: "Teammate invitations" });
    const started = yield* createCodingAgent(userId, {
      taskId: task.id,
      idempotencyKey: randomUUID(),
      model: harness.model,
      effort: "high",
      repository: "acme/relay",
      planSnapshot: "# Teammate invitations\n",
      prompt: null,
      runtime: harness.runtime,
      payer: harness.payer,
    });
    const agent = Option.getOrThrow(started).agent;
    const bearer = randomBytes(32).toString("base64url");
    yield* recordCodingAgentRunnerToken(userId, agent.id, runnerTokenDigest(bearer));
    const target = { userId, conversationId: agent.conversationId };
    const writer = yield* storeWriter({ tools: CODER_TOOL_SET });
    const lineIds: string[] = [];
    for (const text of lines) {
      const clientKey = randomUUID();
      yield* writer.writeAwaitingLine(
        target,
        { text, clientKey, sender: { kind: MESSAGE_SENDER.MEMBER, userId } },
        Effect.succeed(true),
      );
      lineIds.push(sentLineId(clientKey));
    }
    const [lineId = ""] = lineIds;
    return { userId, agentId: agent.id, taskId: task.id, target, bearer, lineId, lineIds };
  });

/** The task's status as the account reads it. */
const taskStatusOf = (userId: string, taskId: string) =>
  Effect.map(readTask(userId, taskId), (read) => Option.getOrThrow(read).task.status);

const agentWithBearer = agentOn(HARNESS.CLAUDE_CODE, ["Run the probe."]);

/** The agent's pull request as its row keeps it once merged. */
const MERGED = {
  number: 42,
  title: "Fix the refresh",
  url: "https://github.com/acme/relay/pull/42",
  state: PULL_REQUEST_STATE.MERGED,
  checks: CHECK_SUMMARY.PASSING,
  additions: 12,
  deletions: 3,
  changedFiles: 2,
};

/** The SDK messages of P00's workflow turn, in the pinned SDK's shapes, as the runner numbers and posts them. */
function workflowTurn(lineId: string): readonly RunnerEvent[] {
  const envelope = { parent_tool_use_id: null, session_id: SESSION, uuid: randomUUID() };
  const toolUse = (id: string, name: string, input: WireRecord) => ({
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
function drawn(part: StoredUIMessage["parts"][number]): readonly WireValue[] {
  const fields: WireValue[] = [part.type];
  if ("text" in part) fields.push(part.text);
  else if ("state" in part && part.state !== undefined) fields.push(part.state);
  if ("output" in part && part.output !== undefined) {
    fields.push(valueFromJsonText(JSON.stringify(part.output)));
  }
  return fields;
}

it.layer(getTestDB())("the runner events route", (it) => {
  it.effect(
    "P00's workflow turn lands as one turn: the line it took, each call settled, the words, and its cost",
    () =>
      Effect.gen(function* () {
        const post = yield* standing;
        const agent = yield* agentWithBearer;
        const events = workflowTurn(agent.lineId);
        // The task was marked done, and the agent's pull request merged: its turn takes the task
        // up again, and the turn's end, everyone then idle, finishes it (`tasks/task-finish.ts`).
        yield* updateTask(agent.userId, agent.taskId, { status: TASK_STATUS.DONE });
        yield* recordCodingAgentPublished(agent.userId, agent.agentId, MERGED);

        const first = yield* post(agent.bearer, events.slice(0, 11));
        const midway = yield* transcriptOf(agent.target.conversationId);
        const reopened = yield* taskStatusOf(agent.userId, agent.taskId);
        const last = yield* post(agent.bearer, events.slice(11));
        const { rows, turns: settled } = yield* transcriptOf(agent.target.conversationId);

        assert.deepEqual(first.body, { applied: 11, sequence: 10 });
        assert.deepEqual(last.body, { applied: 4, sequence: 14 });
        assert.equal(reopened, TASK_STATUS.IN_PROGRESS);
        assert.equal(yield* taskStatusOf(agent.userId, agent.taskId), TASK_STATUS.DONE);
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

  it.effect(
    "a run under way keeps its sandbox alive at its first batch and once a keep-alive interval after the last, and a batch that ends the launch keeps nothing alive",
    () =>
      Effect.gen(function* () {
        const told: RunnerAlive[] = [];
        const post = yield* standingWith({
          alive: (alive) => Effect.sync(() => void told.push(alive)),
        });
        const agent = yield* agentWithBearer;
        const events = workflowTurn(agent.lineId);

        yield* post(agent.bearer, events.slice(0, 3));
        yield* post(agent.bearer, events.slice(3, 6));
        const withinInterval = told.length;
        yield* TestClock.adjust(CODER.SANDBOX_KEEP_ALIVE_EVERY);
        yield* post(agent.bearer, events.slice(6, 11));
        // The batch carrying the launch's END, past another interval, is the stop's to settle.
        yield* TestClock.adjust(CODER.SANDBOX_KEEP_ALIVE_EVERY);
        yield* post(agent.bearer, events.slice(11));

        assert.equal(withinInterval, 1, "a batch inside the interval asks Vercel nothing");
        assert.deepEqual(
          told.map((alive) => alive.target),
          [agent.target, agent.target],
        );
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

  it.effect(
    "a plan's agent's transcript says its turns were the plan's, beside the tokens they took",
    () =>
      Effect.gen(function* () {
        const post = yield* standing;
        const agent = yield* agentWithBearer;
        yield* post(agent.bearer, workflowTurn(agent.lineId));
        const row = Option.getOrThrow(yield* readCodingAgent(agent.userId, agent.agentId));

        const page = yield* transcriptPast(
          agent.target,
          CODER_TOOL_SET,
          CURSOR_START,
          row,
          row,
        ).pipe(Effect.provide(modelCatalogOf([])));

        assert.deepEqual(page.usage, {
          inputTokens: 228,
          outputTokens: 9,
          cachedInputTokens: 200,
          payer: CODING_AGENT_PAYER.CLAUDE_SUBSCRIPTION,
        });
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

        // The next launch fails on its own, the limit having lifted: it says nothing of the old one.
        const relaunch = [
          { type: "system", subtype: "init", ...top },
          { type: RUNNER_EVENT.END, reason: RUNNER_END.INPUT_CLOSED },
        ].map((message, index) => ({ sequence: events.length + index, message }) as RunnerEvent);

        yield* post(agent.bearer, events);
        yield* post(agent.bearer, relaunch);
        const { turns: ended } = yield* transcriptOf(agent.target.conversationId);
        const context = yield* readCodingAgentContext(agent.userId, agent.agentId);

        assert.deepEqual(ended.map((turn) => [turn.status, turn.failureDetail]).sort(), [
          [
            TURN_STATUS.FAILED,
            "error_during_execution; rate_limit_rejected five_hour resets 2027-01-15T08:00:00.000Z",
          ],
          [TURN_STATUS.FAILED, "input_closed"],
        ]);
        assert.notEqual(Option.getOrThrow(context).compactedAt, null);
      }),
  );

  it.effect(
    "a Luke tool's pictures stay out of its stored answer, and a CLI tool's stand in for theirs",
    () =>
      Effect.gen(function* () {
        const post = yield* standing;
        const agent = yield* agentWithBearer;
        const top = { parent_tool_use_id: null, session_id: SESSION };
        const image = {
          type: "image",
          source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" },
        };
        const messagesOfTurn = [
          { type: RUNNER_EVENT.ACCEPTED, uuid: agent.lineId },
          {
            type: "assistant",
            message: {
              id: "msg_1",
              content: [
                { type: "tool_use", id: "toolu_read", name: "Read", input: {} },
                {
                  type: "tool_use",
                  id: "toolu_look",
                  name: "mcp__luke__look_at_picture",
                  input: {},
                },
              ],
            },
            ...top,
          },
          {
            type: "user",
            message: {
              content: [
                {
                  type: "tool_result",
                  tool_use_id: "toolu_read",
                  content: [{ type: "text", text: "shot.png" }, image],
                },
                {
                  type: "tool_result",
                  tool_use_id: "toolu_look",
                  content: [{ type: "text", text: '{"status":"looked"}' }, image],
                },
              ],
            },
            ...top,
          },
        ];
        // SAFETY: each message above is one the pinned SDK or the runner emits, written in its JSON shape.
        const events = messagesOfTurn.map(
          (message, sequence) => ({ sequence, message }) as RunnerEvent,
        );

        yield* post(agent.bearer, events);
        const { rows } = yield* transcriptOf(agent.target.conversationId);

        assert.deepEqual(rows.at(-1)?.parts.map(drawn), [
          ["step-start"],
          ["tool-Read", "output-available", "shot.png\n[image]"],
          ["tool-look_at_picture", "output-available", { status: "looked" }],
        ]);
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

/** P16's hermetic recording of app-server's stdio, as the runner's own tests play it (`tools/codex-probe/fixtures/hermetic/`). */
const CODEX_RECORDING = new URL(
  "../../../../../tools/codex-probe/fixtures/hermetic/app-server.jsonl",
  import.meta.url,
);
const THREAD = "00000000-0000-4000-8000-000000000002";

/** One line of the recording: which phase of the probe, which way it went, and what it said. */
interface RecordedLine {
  readonly phase: string;
  readonly direction: "client" | "server";
  readonly message: WireRecord;
}

/**
 * P16's recording cut into the launches P20's runner makes of it, each as
 * the events it posts: the notifications app-server sent, an ACCEPTED for
 * each of Luke's lines where the runner's `turn/start` or `turn/steer` hands
 * one over, and the launch's END. The first launch runs the workflow turn
 * (steered once), the second the `sleep 600` turn it stops, and the third,
 * after a restart, the resumed thread's turn.
 */
function codexLaunches(lineIds: readonly string[]): readonly (readonly RunnerEvent[])[] {
  // SAFETY: each line of P16's recording is one object of this shape (the runner's `fake-app-server.ts` decodes it so).
  const recorded = readFileSync(CODEX_RECORDING, "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as RecordedLine);
  const launches: WireValue[][] = [[], [], []];
  const lines = [...lineIds];
  let launch = 0;
  let turnsStarted = 0;
  for (const { phase, direction, message } of recorded) {
    if (phase === "resumed") launch = 2;
    const posted = launches[launch];
    if (posted === undefined) continue;
    if (direction === "client") {
      if (message.method === "turn/start" && phase === "first" && ++turnsStarted === 2) {
        launch = 1;
      }
      const into = launches[launch];
      if (
        (message.method === "turn/start" || message.method === "turn/steer") &&
        into !== undefined
      ) {
        into.push({ type: RUNNER_EVENT.ACCEPTED, uuid: lines.shift() ?? "" });
      }
      continue;
    }
    if (message.method !== undefined) posted.push(message);
  }
  const ends = [RUNNER_END.TURN_ENDED, RUNNER_END.STOPPED, RUNNER_END.TURN_ENDED];
  let sequence = 0;
  return launches.map((messagesOfLaunch, index) =>
    [...messagesOfLaunch, { type: RUNNER_EVENT.END, reason: ends[index] ?? RUNNER_END.FAILED }].map(
      // SAFETY: each message is one app-server or the runner emits, as P16 recorded it.
      (message) => ({ sequence: sequence++, message }) as RunnerEvent,
    ),
  );
}

/** The usage the record keeps of a Codex turn: its counts, on the model the agent ran on. */
function codexUsage(inputTokens: number, outputTokens: number) {
  const counts = {
    inputTokens,
    outputTokens,
    cachedInputTokens: 0,
    reasoningTokens: 0,
    cacheWriteTokens: 0,
  };
  return { ...counts, byModel: [{ model: HARNESS.CODEX.model, ...counts }] };
}

/** One notification app-server sends on the session's thread, as the runner posts it. */
function notification(method: string, params: WireRecord): WireRecord {
  return { method, params: { threadId: THREAD, turnId: "turn-1", ...params } };
}

it.layer(getTestDB())("the runner events route, on Codex", (it) => {
  it.effect(
    "P16's recorded launches land as three turns: each line taken, each call settled, the words, and the meter",
    () =>
      Effect.gen(function* () {
        const post = yield* standing;
        const agent = yield* agentOn(HARNESS.CODEX, [
          "The probe's first turn.",
          "Also append the steered line.",
          "Run sleep 600.",
          "What exact line did you first write?",
        ]);
        const launches = codexLaunches(agent.lineIds);
        for (const events of launches) {
          // Each launch is posted in two batches, as the runner may split it.
          const half = Math.floor(events.length / 2);
          yield* post(agent.bearer, events.slice(0, half));
          yield* post(agent.bearer, events.slice(half));
        }
        const { rows, turns: settled } = yield* transcriptOf(agent.target.conversationId);

        assert.deepEqual(
          rows.map((row) => row.role),
          ["user", "user", "user", "user", "assistant", "assistant", "assistant"],
        );
        // Each line joins the turn that took it, the steered one beside the line that opened the first.
        const turnOf = rows.map((row) => row.turnId);
        assert.deepEqual(turnOf.slice(0, 4), [turnOf[4], turnOf[4], turnOf[5], turnOf[6]]);
        assert.equal(new Set(turnOf).size, 3);
        assert.deepEqual(rows[4]?.parts.map(drawn), [
          ["step-start"],
          ["tool-fileChange", "output-available", { status: "completed" }],
          ["step-start"],
          [
            "tool-commandExecution",
            "output-available",
            {
              output:
                'LUKE_PROBE_SCAN {"uid":1001,"user":"vercel-sandbox","capEff":"0000000000000000","ownEnvHasAccessToken":false,"environsReadable":2,"environsDenied":14,"processesWithAccessToken":[],"filesScanned":0,"filesDenied":0,"jwtSha256":[]}\n',
              exitCode: 0,
            },
          ],
          ["step-start"],
          [
            "tool-mcpToolCall",
            "output-available",
            "luke-probe-echo:luke-probe-hermetic access_token_in_env=false",
          ],
          ["step-start"],
          [
            "tool-commandExecution",
            "output-available",
            {
              output: "checks pending (0s)\nall checks passed: luke-probe-hermetic-ci\n",
              exitCode: 0,
            },
          ],
          ["step-start"],
          ["tool-fileChange", "output-available", { status: "completed" }],
          ["step-start"],
          ["text", "all checks passed: luke-probe-hermetic-ci"],
        ]);
        assert.deepEqual(rows[5]?.parts.map(drawn), [
          ["step-start"],
          ["tool-commandExecution", "output-available", UNANSWERED.CANCELLED],
        ]);
        assert.deepEqual(rows[6]?.parts.map(drawn), [
          ["step-start"],
          ["text", "luke-probe-hermetic"],
        ]);
        // The resumed thread reports its total again before its turn: that meters nothing.
        assert.deepEqual(
          settled
            .map((turn) => [turn.status, turn.usage, turn.failureDetail])
            .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
          [
            [TURN_STATUS.CANCELLED, codexUsage(100, 20), null],
            [TURN_STATUS.SETTLED, codexUsage(100, 20), null],
            [TURN_STATUS.SETTLED, codexUsage(800, 160), null],
          ],
        );
        const routing = yield* readCodingAgentRouting(agent.userId, agent.agentId);
        assert.equal(Option.getOrThrow(routing).nativeSession, THREAD);
      }),
  );

  it.effect("a Codex batch posted again changes nothing, and its END is told once", () =>
    Effect.gen(function* () {
      const told: RunnerEnded[] = [];
      const post = yield* standingWith({
        ended: (ended) => Effect.sync(() => void told.push(ended)),
      });
      const agent = yield* agentOn(HARNESS.CODEX, ["The probe's first turn.", "Also append."]);
      const [events = []] = codexLaunches(agent.lineIds);
      yield* post(agent.bearer, events);
      const once = yield* transcriptOf(agent.target.conversationId);

      const again = yield* post(agent.bearer, events);
      const overlapping = yield* post(agent.bearer, events.slice(5, 20));
      const twice = yield* transcriptOf(agent.target.conversationId);

      assert.deepEqual(again.body, { applied: 0, sequence: events.length - 1 });
      assert.deepEqual(overlapping.body, { applied: 0, sequence: events.length - 1 });
      assert.deepEqual(twice, once);
      assert.deepEqual(
        told.map((end) => end.sequence),
        [events.length - 1],
      );
    }),
  );

  it.effect("a file change's completed changes replace the empty ones it started with", () =>
    Effect.gen(function* () {
      const post = yield* standing;
      const agent = yield* agentOn(HARNESS.CODEX, ["Write the probe file."]);
      const change = { type: "fileChange", id: "call_patch", status: "inProgress", changes: [] };
      const changes = [
        { path: "luke-probe/a1b2.txt", kind: { type: "add" }, diff: "a1b2c3d4e5f6\n" },
      ];
      const messagesOfTurn: WireValue[] = [
        { type: RUNNER_EVENT.ACCEPTED, uuid: agent.lineId },
        notification("turn/started", { turn: { id: "turn-1" } }),
        notification("item/started", { item: change }),
        notification("item/completed", { item: { ...change, status: "completed", changes } }),
        notification("turn/completed", { turn: { id: "turn-1", status: "completed" } }),
        { type: RUNNER_EVENT.END, reason: RUNNER_END.TURN_ENDED },
      ];
      // SAFETY: each message above is one app-server or the runner emits, written in its JSON shape.
      const events = messagesOfTurn.map(
        (message, sequence) => ({ sequence, message }) as RunnerEvent,
      );
      yield* post(agent.bearer, events);
      const { rows } = yield* transcriptOf(agent.target.conversationId);

      const patch = rows.at(-1)?.parts.find((part) => part.type === "tool-fileChange");
      assert.ok(patch !== undefined && "input" in patch);
      assert.equal(patch.state, "output-available");
      assert.deepEqual(patch.input, { changes });
    }),
  );

  it.effect("a retired bearer writes nothing of a Codex batch", () =>
    Effect.gen(function* () {
      const post = yield* standing;
      const agent = yield* agentOn(HARNESS.CODEX, ["The probe's first turn."]);
      const [events = []] = codexLaunches(agent.lineIds);
      yield* recordCodingAgentRunnerToken(agent.userId, agent.agentId, null);
      const retired = yield* post(agent.bearer, events);
      const { rows, turns: written } = yield* transcriptOf(agent.target.conversationId);

      assert.equal(retired.status, HOSTED_HTTP_STATUS.UNAUTHORIZED);
      assert.deepEqual(
        rows.map((row) => row.turnId),
        [null],
      );
      assert.deepEqual(written, []);
    }),
  );

  it.effect(
    "a Luke tool keeps its own name without its pictures, a subagent's thread folds under its interrupted call, and a plan's usage limit fails the turn saying so",
    () =>
      Effect.gen(function* () {
        const post = yield* standing;
        const agent = yield* agentOn(HARNESS.CODEX, ["Look at the inbox."]);
        const inbox = {
          type: "mcpToolCall",
          id: "mcp_inbox",
          server: "luke",
          tool: "read_inbox",
          status: "inProgress",
          arguments: {},
          result: null,
          error: null,
        };
        const spawn = {
          type: "collabAgentToolCall",
          id: "call_spawn",
          tool: "spawnAgent",
          status: "inProgress",
          senderThreadId: THREAD,
          receiverThreadIds: ["thread-sub"],
          prompt: "Find the queue.",
          model: "gpt-5.5",
          agentsStates: {},
        };
        const messagesOfTurn: WireValue[] = [
          {
            method: "thread/started",
            params: { thread: { id: THREAD, parentThreadId: null } },
          },
          { type: RUNNER_EVENT.ACCEPTED, uuid: agent.lineId },
          notification("turn/started", { turn: { id: "turn-1" } }),
          notification("item/completed", {
            item: {
              type: "reasoning",
              id: "rs_1",
              summary: ["Reading the inbox first."],
              content: [],
            },
          }),
          notification("item/started", { item: inbox }),
          notification("item/completed", {
            item: {
              ...inbox,
              status: "completed",
              result: {
                content: [
                  { type: "text", text: '{"status":"accepted","inbox":[]}' },
                  { type: "image", data: "iVBORw0K", mimeType: "image/png" },
                ],
                structuredContent: null,
                _meta: null,
              },
            },
          }),
          notification("turn/plan/updated", {
            explanation: null,
            plan: [{ step: "Read the inbox", status: "completed" }],
          }),
          notification("item/started", { item: spawn }),
          {
            method: "thread/started",
            params: { thread: { id: "thread-sub", parentThreadId: THREAD } },
          },
          {
            method: "item/started",
            params: {
              threadId: "thread-sub",
              turnId: "turn-sub",
              item: {
                type: "commandExecution",
                id: "call_sub",
                command: "rg queue",
                cwd: "/",
                status: "inProgress",
              },
            },
          },
          notification("item/completed", {
            item: {
              ...spawn,
              status: "interrupted",
              agentsStates: { "thread-sub": { status: "interrupted" } },
            },
          }),
          notification("item/completed", { item: { type: "contextCompaction", id: "cc_1" } }),
          notification("turn/completed", {
            turn: {
              id: "turn-1",
              status: "failed",
              error: {
                message:
                  'unexpected status 429: {"error":{"code":"subscription_sharing_usage_limit_exceeded"}}',
                codexErrorInfo: "usageLimitExceeded",
                additionalDetails: null,
              },
            },
          }),
          { type: RUNNER_EVENT.END, reason: RUNNER_END.FAILED, detail: "the plan's limit" },
        ];
        // SAFETY: each message above is one app-server or the runner emits, written in its JSON shape.
        const events = messagesOfTurn.map(
          (message, sequence) => ({ sequence, message }) as RunnerEvent,
        );
        yield* post(agent.bearer, events);
        const { rows, turns: ended } = yield* transcriptOf(agent.target.conversationId);
        const context = yield* readCodingAgentContext(agent.userId, agent.agentId);

        assert.deepEqual(rows.at(-1)?.parts.map(drawn), [
          ["step-start"],
          ["reasoning", "Reading the inbox first."],
          ["tool-read_inbox", "output-available", { status: "accepted", inbox: [] }],
          ["step-start"],
          [
            "tool-todoList",
            "output-available",
            { explanation: null, plan: [{ step: "Read the inbox", status: "completed" }] },
          ],
          ["step-start"],
          [
            "tool-collabAgentToolCall",
            // An interrupted subagent did not do its work: its call settles as an error.
            "output-error",
          ],
        ]);
        assert.ok(!JSON.stringify(rows).includes("iVBORw0K"));
        assert.deepEqual(
          ended.map((turn) => [turn.status, turn.failureDetail]),
          [
            [
              TURN_STATUS.FAILED,
              "failed the plan's limit; usageLimitExceeded subscription_sharing_usage_limit_exceeded",
            ],
          ],
        );
        assert.notEqual(Option.getOrThrow(context).compactedAt, null);
      }),
  );

  /** The account's ChatGPT sign-in, kept as connecting keeps it: sealed, and not yet answered. */
  const signedIn = (userId: string, at = new Date(0)) =>
    saveProviderKey(
      userId,
      PROVIDER_KEY_PROVIDER.OPENAI,
      PROVIDER_KEY_KIND.CHATGPT_OAUTH,
      { keyVersion: 1, sealedDataKey: "sealed-data-key", sealedKey: "sealed-sign-in" },
      "ChatGPT",
      null,
      at,
    );

  /** The ChatGPT row as it stands: its status, and when a reached limit resets. */
  const planRow = (userId: string) =>
    Effect.map(listProviderKeyRows(userId, PROVIDER_KEY_KIND.CHATGPT_OAUTH), (rows) => {
      const row: ProviderKeyRow | undefined = rows[0];
      return [row?.status, row?.limitResetsAt?.toISOString() ?? null] as const;
    });

  /** One launch whose one turn OpenAI refused as said, numbered from `from`, with what Codex heard first. */
  const refusedLaunch = (
    lineId: string,
    from: number,
    error: WireRecord,
    heard: readonly WireValue[] = [],
  ): readonly RunnerEvent[] =>
    (
      [
        { type: RUNNER_EVENT.ACCEPTED, uuid: lineId },
        notification("turn/started", { turn: { id: "turn-1" } }),
        ...heard,
        notification("turn/completed", { turn: { id: "turn-1", status: "failed", error } }),
        { type: RUNNER_EVENT.END, reason: RUNNER_END.FAILED },
      ] satisfies readonly WireValue[]
    ).map(
      // SAFETY: each message above is one app-server or the runner emits, written in its JSON shape.
      (message, index) => ({ sequence: from + index, message }) as RunnerEvent,
    );

  it.effect(
    "a ChatGPT plan's row takes how each turn found it: verified by P16's recorded turn, its limit reached with the reset Codex heard, then signed out, and a turn that ran never lifts a sign-in OpenAI refused",
    () =>
      Effect.gen(function* () {
        const post = yield* standing;
        const agent = yield* agentOn(HARNESS.CODEX, [
          "The probe's first turn.",
          "Also append the steered line.",
          "Run sleep 600.",
          "What exact line did you first write?",
          "Go on.",
          "Go on again.",
        ]);
        yield* signedIn(agent.userId);
        const [first, stopped, resumed] = codexLaunches(agent.lineIds);
        assert.ok(first && stopped && resumed);
        const statuses: (readonly [string | undefined, string | null])[] = [];

        yield* post(agent.bearer, first);
        statuses.push(yield* planRow(agent.userId));

        const resetsAt = Date.UTC(2026, 9, 22, 9);
        const limited = refusedLaunch(
          agent.lineIds[4] ?? "",
          (first.at(-1)?.sequence ?? 0) + 1,
          {
            message:
              'unexpected status 429: {"error":{"code":"subscription_sharing_usage_limit_exceeded"}}',
            codexErrorInfo: "usageLimitExceeded",
            additionalDetails: null,
          },
          [
            {
              method: "account/rateLimits/updated",
              params: {
                rateLimits: {
                  limitId: null,
                  limitName: null,
                  primary: { usedPercent: 100, windowDurationMins: 300, resetsAt: resetsAt / 1000 },
                  secondary: null,
                  rateLimitReachedType: "rate_limit_reached",
                },
              },
            },
          ],
        );
        yield* post(agent.bearer, limited);
        statuses.push(yield* planRow(agent.userId));

        const signedOut = refusedLaunch(
          agent.lineIds[5] ?? "",
          (limited.at(-1)?.sequence ?? 0) + 1,
          {
            message:
              'unexpected status 401: {"error":{"code":"subscription_sharing_invalid_user"}}',
            codexErrorInfo: "unauthorized",
            additionalDetails: null,
          },
        );
        yield* post(agent.bearer, signedOut);
        statuses.push(yield* planRow(agent.userId));

        // A turn that ran after the refusal leaves the refusal standing: only a new sign-in mends it.
        const ranAgain = resumed.map((event, index) => ({
          ...event,
          sequence: (signedOut.at(-1)?.sequence ?? 0) + 1 + index,
        }));
        yield* post(agent.bearer, ranAgain);
        statuses.push(yield* planRow(agent.userId));

        assert.deepEqual(statuses, [
          [PROVIDER_KEY_STATUS.VERIFIED, null],
          [PROVIDER_KEY_STATUS.LIMIT_REACHED, new Date(resetsAt).toISOString()],
          [PROVIDER_KEY_STATUS.INVALID, null],
          [PROVIDER_KEY_STATUS.INVALID, null],
        ]);
      }),
  );

  it.effect(
    "an account OpenAI says is not eligible is marked so; a failure that says nothing of the plan, or an agent a key pays for, leaves the row as it stood",
    () =>
      Effect.gen(function* () {
        const post = yield* standing;
        const ineligible = yield* agentOn(HARNESS.CODEX, ["Fix the test."]);
        yield* signedIn(ineligible.userId);
        yield* post(
          ineligible.bearer,
          refusedLaunch(ineligible.lineId, 0, {
            message:
              'unexpected status 403: {"error":{"code":"subscription_sharing_user_not_eligible"}}',
            codexErrorInfo: null,
            additionalDetails: null,
          }),
        );

        const unrelated = yield* agentOn(HARNESS.CODEX, ["Fix the test."]);
        yield* signedIn(unrelated.userId);
        yield* post(
          unrelated.bearer,
          refusedLaunch(unrelated.lineId, 0, {
            message: "context window exceeded",
            codexErrorInfo: "contextWindowExceeded",
            additionalDetails: null,
          }),
        );

        const onKey = yield* agentOn({ ...HARNESS.CODEX, payer: CODING_AGENT_PAYER.API_KEY }, [
          "Fix the test.",
        ]);
        yield* signedIn(onKey.userId);
        yield* post(
          onKey.bearer,
          refusedLaunch(onKey.lineId, 0, {
            message: "unauthorized",
            codexErrorInfo: "unauthorized",
            additionalDetails: null,
          }),
        );

        assert.deepEqual(
          [
            yield* planRow(ineligible.userId),
            yield* planRow(unrelated.userId),
            yield* planRow(onKey.userId),
          ],
          [
            [PROVIDER_KEY_STATUS.INELIGIBLE, null],
            [PROVIDER_KEY_STATUS.UNVERIFIED, null],
            [PROVIDER_KEY_STATUS.UNVERIFIED, null],
          ],
        );
      }),
  );

  it.effect(
    "a turn that opened before its starter connected ChatGPT again leaves the new sign-in as it was saved",
    () =>
      Effect.gen(function* () {
        const post = yield* standing;
        const agent = yield* agentOn(HARNESS.CODEX, ["Fix the test."]);
        yield* signedIn(agent.userId);
        const refused = refusedLaunch(agent.lineId, 0, {
          message: 'unexpected status 401: {"error":{"code":"subscription_sharing_invalid_user"}}',
          codexErrorInfo: "unauthorized",
          additionalDetails: null,
        });
        yield* post(agent.bearer, refused.slice(0, 2));
        yield* signedIn(agent.userId, new Date(60_000));
        yield* post(agent.bearer, refused.slice(2));

        assert.deepEqual(yield* planRow(agent.userId), [PROVIDER_KEY_STATUS.UNVERIFIED, null]);
      }),
  );

  /** The account's Claude setup-token, kept as pasting keeps it: sealed, and not yet answered. */
  const pasted = (userId: string, at = new Date(0)) =>
    saveProviderKey(
      userId,
      PROVIDER_KEY_PROVIDER.ANTHROPIC,
      PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN,
      { keyVersion: 1, sealedDataKey: "sealed-data-key", sealedKey: "sealed-setup-token" },
      "sk-ant-oat01…fake",
      null,
      at,
    );

  /** The setup-token's row as it stands: its status, and when a reached limit resets. */
  const setupTokenRow = (userId: string) =>
    Effect.map(listProviderKeyRows(userId, PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN), (rows) => {
      const row: ProviderKeyRow | undefined = rows[0];
      return [row?.status, row?.limitResetsAt?.toISOString() ?? null] as const;
    });

  /** Events numbered on from where the last batch left off. */
  const numberedFrom = (from: number, messagesOfLaunch: readonly unknown[]) =>
    // SAFETY: each message is one the pinned SDK or the runner emits, written in its JSON shape.
    messagesOfLaunch.map((message, index) => ({ sequence: from + index, message }) as RunnerEvent);

  /** One launch whose one turn Claude Code ended in error, with what it said first. */
  const failedClaudeLaunch = (lineId: string, said: readonly WireValue[]): readonly unknown[] => {
    const top = { parent_tool_use_id: null, session_id: SESSION };
    return [
      { type: RUNNER_EVENT.ACCEPTED, uuid: lineId },
      { type: "system", subtype: "init", ...top },
      ...said,
      { type: "result", subtype: "success", is_error: true, ...top },
      { type: RUNNER_EVENT.END, reason: RUNNER_END.TURN_ENDED },
    ];
  };

  it.effect(
    "a Claude plan's row takes how each turn found it: verified by P00's turn, its limit reached with the reset Claude Code named, verified again once a turn runs, then refused, which a turn that ran never lifts",
    () =>
      Effect.gen(function* () {
        const post = yield* standing;
        const agent = yield* agentOn(HARNESS.CLAUDE_CODE, [
          "Run the probe.",
          "Go on.",
          "Go on again.",
          "Once more.",
          "And again.",
        ]);
        yield* pasted(agent.userId);
        const statuses: (readonly [string | undefined, string | null])[] = [
          yield* setupTokenRow(agent.userId),
        ];
        const top = { parent_tool_use_id: null, session_id: SESSION };
        let next = 0;
        const launch = (messagesOfLaunch: readonly unknown[]) =>
          Effect.gen(function* () {
            const events = numberedFrom(next, messagesOfLaunch);
            next += events.length;
            yield* post(agent.bearer, events);
            statuses.push(yield* setupTokenRow(agent.userId));
          });
        const ran = (lineId: string) => workflowTurn(lineId).map((event) => event.message);

        yield* launch(ran(agent.lineIds[0] ?? ""));

        const resetsAt = Date.UTC(2026, 9, 21, 15, 40);
        yield* launch(
          failedClaudeLaunch(agent.lineIds[1] ?? "", [
            {
              type: "rate_limit_event",
              rate_limit_info: {
                status: "rejected",
                rateLimitType: "five_hour",
                resetsAt: resetsAt / 1000,
              },
              uuid: randomUUID(),
              ...top,
            },
          ]),
        );

        yield* launch(ran(agent.lineIds[2] ?? ""));

        yield* launch(
          failedClaudeLaunch(agent.lineIds[3] ?? "", [
            {
              type: "assistant",
              message: {
                id: "msg_auth",
                content: [{ type: "text", text: "Invalid API key · Please run /login" }],
              },
              error: "authentication_failed",
              uuid: randomUUID(),
              ...top,
            },
          ]),
        );

        // A turn that ran after the refusal leaves it standing: only a new setup-token mends it.
        yield* launch(ran(agent.lineIds[4] ?? ""));

        assert.deepEqual(statuses, [
          [PROVIDER_KEY_STATUS.UNVERIFIED, null],
          [PROVIDER_KEY_STATUS.VERIFIED, null],
          [PROVIDER_KEY_STATUS.LIMIT_REACHED, new Date(resetsAt).toISOString()],
          [PROVIDER_KEY_STATUS.VERIFIED, null],
          [PROVIDER_KEY_STATUS.INVALID, null],
          [PROVIDER_KEY_STATUS.INVALID, null],
        ]);
      }),
  );

  it.effect(
    "a limit that only warns, or a Claude Code agent an API key pays for, leaves the setup-token as it stood",
    () =>
      Effect.gen(function* () {
        const post = yield* standing;
        const top = { parent_tool_use_id: null, session_id: SESSION };
        const warned = yield* agentOn(HARNESS.CLAUDE_CODE, ["Fix the test."]);
        yield* pasted(warned.userId);
        yield* post(
          warned.bearer,
          numberedFrom(
            0,
            failedClaudeLaunch(warned.lineId, [
              {
                type: "rate_limit_event",
                rate_limit_info: { status: "allowed_warning", resetsAt: 1_800_000_000 },
                uuid: randomUUID(),
                ...top,
              },
            ]),
          ),
        );

        const onKey = yield* agentOn(
          { ...HARNESS.CLAUDE_CODE, payer: CODING_AGENT_PAYER.API_KEY },
          ["Fix the test."],
        );
        yield* pasted(onKey.userId);
        yield* post(
          onKey.bearer,
          numberedFrom(
            0,
            failedClaudeLaunch(onKey.lineId, [
              {
                type: "assistant",
                message: { content: [{ type: "text", text: "Invalid API key" }] },
                error: "authentication_failed",
                uuid: randomUUID(),
                ...top,
              },
            ]),
          ),
        );

        assert.deepEqual(
          [yield* setupTokenRow(warned.userId), yield* setupTokenRow(onKey.userId)],
          [
            [PROVIDER_KEY_STATUS.UNVERIFIED, null],
            [PROVIDER_KEY_STATUS.UNVERIFIED, null],
          ],
        );
      }),
  );
});
