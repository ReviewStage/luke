import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { db } from "@sidecar/database/core/query";
import { childConversationId, hostTurnId, sentLineId } from "@sidecar/database/models/ids";
import { listMessagesPast, type MessageCursor } from "@sidecar/database/models/message-reads";
import { createPlan, openPlanConversation, readPlan } from "@sidecar/database/models/plan-store";
import {
  type ConversationTarget,
  STORE_WRITE_EFFECT,
  storeWriter,
} from "@sidecar/database/models/writer";
import { turns } from "@sidecar/database/schemas/storage";
import { getTestDB } from "@sidecar/database/testing";
import { CODING_AGENT_STATUS, CONTEXT_WINDOW } from "@sidecar/hosted/coding-agent-wire";
import { MODEL_PROVIDER } from "@sidecar/hosted/models-wire";
import { planSections } from "@sidecar/hosted/plan-document";
import { DEFAULT_PLAN_TEMPLATE } from "@sidecar/hosted/plan-document-template";
import { isReasoningUIPart, isTextUIPart, isToolUIPart, type LanguageModel } from "ai";
import { eq } from "drizzle-orm";
import {
  Clock,
  type Duration,
  Effect,
  Fiber,
  Layer,
  Option,
  Redacted,
  Result,
  Schema,
} from "effect";
import { TestClock } from "effect/testing";
import type { MessageStreamEvent } from "eve/client";
import type { SessionAuth, SessionAuthContext, SessionContext } from "eve/context";
import {
  ACTION_RESULT_STATUS,
  MESSAGE_AUTHOR,
  MESSAGE_CHANNEL,
  MESSAGE_ROLE,
  TOOL_PART_STATE,
  TURN_ORIGIN,
  TURN_STATUS,
  unparsedWire,
} from "../server/core";
import { CI_READ_PERMISSIONS } from "../server/github/github-app";
import {
  BRAIN_HOST_ATTRIBUTE,
  BRAIN_HOST_REFUSAL,
  BRAIN_HOST_TURN,
} from "../server/hosted/brain-host/bounds";
import type { AdmittedConversation } from "../server/hosted/brain-host/conversation";
import { memoryRelayState } from "../server/hosted/brain-host/relay";
import { CODER, CODER_MODEL_FIXTURE, CODER_REFUSAL } from "../server/hosted/coder-host/bounds";
import { type CoderHost, coderHost } from "../server/hosted/coder-host/host";
import type { CoderModelSelection, ProviderKeys } from "../server/hosted/coder-host/model";
import {
  PLAN_EDIT,
  PLAN_EDIT_REFUSAL,
  requestedNotes,
  reserveNotes,
  settleNotes,
  takenInTurn,
} from "../server/hosted/coder-host/plan-edit";
import type { CoderHostSeams } from "../server/hosted/coder-host/production";
import { codingAgentStatusOf } from "../server/hosted/coder-host/status";
import { CODER_TOOL, CODER_TOOL_SET, opensSandbox } from "../server/hosted/coder-host/tool-set";
import {
  CURSOR_START,
  cursorOfWire,
  cursorToWire,
  type TranscriptPage,
  transcriptPast,
} from "../server/hosted/coder-host/transcript";
import {
  awaitingLinesOf,
  type CodingAgent,
  type CodingAgentBriefText,
  createCodingAgent,
  fillCodingAgentTitle,
  latestTurnsOf,
  readCodingAgent,
  renameCodingAgent,
  updateCodingAgentChoice,
} from "../server/hosted/coding-agent-store";
import { modelCatalogOf, type OfferedModel } from "../server/hosted/model-catalog";
import { stampedEveEvent } from "./support/eve-events";
import { githubReaching, NO_GITHUB, openGithubUser } from "./support/github-app-fake";
import { noNetwork } from "./support/no-network";
import { type CommandTable, sandboxDouble } from "./support/repository-sandbox";
import { titleModelAnswering } from "./support/title-model";

/**
 * The coding-agent host through the same functions the coder project's
 * authored files call, over the real migrations on PGlite: the model a step
 * is told from the agent's row and the catalog, the shared relay writing a
 * coding turn's words, reasoning, and tool calls into the store with no ask
 * record beside it, the status the turn row then reads as, and the
 * transcript read held open while the turn runs and let go when it is
 * idle or the hold is out; and a delegation, recorded under the child
 * conversation its call names on the pair the agent chose, which is what
 * the worker's steps are told and what its turn, relayed into that
 * conversation, records. Synthetic accounts, plans, keys, and words
 * throughout.
 */

const NOW = 1_800_000_000_000;

const PLAN_TEXT = "# Teammate invitations\n\n## Goal\n\nInvite a teammate by email.\n";

const CATALOG: readonly OfferedModel[] = [
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

/** The catalog with a model offering two windows beside it: priced apart past 272K, as OpenAI prices its long context. */
const WINDOWED_CATALOG: readonly OfferedModel[] = [
  ...CATALOG,
  {
    id: "openai/gpt-5.5",
    name: "GPT-5.5",
    provider: MODEL_PROVIDER.OPENAI,
    efforts: ["low", "high"],
    contextWindow: 1_050_000,
    contextWindows: { standardTokens: 272_000, longTokens: 1_050_000 },
  },
];

const KEYS: ProviderKeys = {
  anthropic: { key: Redacted.make("sk-ant-fixture") },
  openAi: { key: Redacted.make("sk-openai-fixture") },
};

/** The host over the test's own store, with the writer composed on the test's client, and the title model handed in where a test has one. */
const hostOverStore = (titleModel?: LanguageModel) =>
  Effect.gen(function* () {
    const writer = yield* storeWriter({ tools: CODER_TOOL_SET });
    const seams: CoderHostSeams = {
      writer: () => Effect.succeed(writer),
      userInfo: () => Effect.succeed(undefined),
      ownership: {
        sessionOwner: () => Promise.resolve(undefined),
        ownsConversation: () => Promise.resolve(false),
      },
      deploymentSecret: () => undefined,
      keys: () => Effect.succeed(KEYS),
      titleModel: () => titleModel,
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

/** An account with one agent started on a plan, on the model given, whose session nothing has claimed yet. */
const unclaimedAgent = (
  model = "anthropic/claude-opus-5.5",
  effort = "high",
  brief: CodingAgentBriefText = { planSnapshot: PLAN_TEXT, task: null },
) =>
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
      ...brief,
      repository: "acme/relay",
    });
    assert.ok(Option.isSome(started));
    const { agent } = started.value;
    const target: ConversationTarget = { userId, conversationId: agent.conversationId };
    return { userId, agent, target, auth: ownSeat(userId, agent.conversationId) };
  });

/** An account with one agent started on a plan, on the model given, its session claimed as the hook claims it. */
const openAgent = (
  host: CoderHost,
  model = "anthropic/claude-opus-5.5",
  effort = "high",
  brief: CodingAgentBriefText = { planSnapshot: PLAN_TEXT, task: null },
) =>
  Effect.gen(function* () {
    const { userId, agent, target, auth } = yield* unclaimedAgent(model, effort, brief);
    const sessionId = mintSession();
    const starting = yield* host.admitStarting(auth, sessionId);
    assert.ok(Result.isSuccess(starting));
    assert.equal(yield* host.sessionStarted(starting.success, sessionId), true);
    const admitted = yield* host.admit(auth, sessionId);
    assert.ok(Result.isSuccess(admitted));
    return {
      userId,
      agent,
      target,
      auth,
      sessionId,
      starting: starting.success,
      admitted: admitted.success,
    };
  });

/** A GitHub where the developer reaches the agent's repository through one installation, granting the App what the test says; the fixture's own grant when unsaid. */
const reachingRelay = (permissions?: Readonly<Record<string, string>>) =>
  githubReaching([
    {
      id: 7,
      login: "acme",
      repositories: [{ owner: "acme", name: "relay" }],
      ...(permissions === undefined ? undefined : { permissions }),
    },
  ]).layer;

/** The prompt the session composes at its start, on an installation granting the App no CI read. */
const composedPrompt = (host: CoderHost, ...composed: Parameters<CoderHost["prompt"]>) =>
  host.prompt(...composed).pipe(Effect.provide(reachingRelay()));

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

/** A worker's session as eve hands it to the worker's hook: the agent's own seat, opened by the call named in the agent's session. */
function childSession(
  auth: SessionAuth,
  rootSessionId: string,
  callId: string,
): SessionContext["session"] {
  const turn = { id: "turn_0", sequence: 0 };
  return {
    id: mintSession(),
    auth,
    turn,
    parent: { callId, rootSessionId, sessionId: rootSessionId, turn },
  };
}

/** What a worker's turn thinks before it answers. */
const WORKER_REASONING = "The routes live under one folder.";

/** One worker turn as eve emits it: the task received, its reasoning, and the answer. */
function workerTurn(turnId: string, task: string, answer: string): MessageStreamEvent[] {
  const sequence = 0;
  return [
    stamped({ type: "turn.started", data: { turnId, sequence } }),
    stamped({ type: "message.received", data: { turnId, sequence, message: task } }),
    stamped({ type: "step.started", data: { turnId, sequence, stepIndex: 0, modelId: "m" } }),
    stamped({
      type: "reasoning.completed",
      data: { turnId, sequence, stepIndex: 0, reasoning: WORKER_REASONING },
    }),
    stamped({
      type: "message.completed",
      data: { turnId, sequence, stepIndex: 0, finishReason: "stop", message: answer },
    }),
    stamped({
      type: "step.completed",
      data: { turnId, sequence, stepIndex: 0, finishReason: "stop" },
    }),
    stamped({ type: "turn.completed", data: { turnId, sequence } }),
  ];
}

const STEP_START = "step-start";

/** What a step on a Claude 5 model is told of its thinking: show it, summarized. */
const SHOWN_THINKING = { type: "adaptive", display: "summarized" };

/** One line the developer sent the agent, as the message route writes it ahead of its turn once eve took it, under the key given. */
const awaitingLine = (target: ConversationTarget, text: string, clientKey: string) =>
  Effect.gen(function* () {
    const writer = yield* storeWriter({ tools: CODER_TOOL_SET });
    const written = yield* writer.writeAwaitingLine(
      target,
      { text, clientKey },
      Effect.succeed(true),
    );
    assert.ok(Result.isSuccess(written) && Option.isSome(written.success));
    return written.success.value;
  });

/** What eve hands a turn beside its words: the files a message carries. */
type ReceivedParts = Extract<MessageStreamEvent, { type: "message.received" }>["data"]["parts"];

/**
 * One turn of the agent's session relayed whole, a minute after the one
 * before it: the developer's words received, with the files given, the
 * agent's terse answer, then the turn completed.
 */
const exchange = (
  host: CoderHost,
  opened: {
    readonly auth: SessionAuth;
    readonly sessionId: string;
    readonly admitted: AdmittedConversation;
  },
  turnId: string,
  said: string,
  parts?: ReceivedParts,
) =>
  Effect.gen(function* () {
    yield* TestClock.adjust("1 minute");
    const session = { id: opened.sessionId, auth: opened.auth, turn: { id: turnId } };
    const sequence = 0;
    const answer = "Done.";
    const state = memoryRelayState();
    for (const event of [
      stamped({ type: "turn.started", data: { turnId, sequence } }),
      stamped({
        type: "message.received",
        data: { turnId, sequence, message: said, ...(parts === undefined ? undefined : { parts }) },
      }),
      stamped({
        type: "message.completed",
        data: { turnId, sequence, stepIndex: 0, finishReason: "stop", message: answer },
      }),
      stamped({ type: "turn.completed", data: { turnId, sequence } }),
    ]) {
      // SAFETY: the relay reads the session's id and auth; eve's turn metadata is not read here.
      yield* host.relay(event, opened.admitted, session as never, state, {});
    }
  });

/** Each user line of the transcript by the key it was sent under, with the turn that owns it; a line no key named is absent. */
const linesByKey = (target: ConversationTarget, keys: readonly string[]) =>
  Effect.map(
    listMessagesPast(target.userId, target.conversationId, CODER_TOOL_SET, CURSOR_START),
    (page) => {
      assert.ok(page.read.ok);
      const rows = page.read.value;
      return keys.map((key) => {
        const row = rows.find((record) => record.clientId === sentLineId(key));
        return row === undefined ? undefined : { turnId: row.turnId };
      });
    },
  );

/** The developer's lines of the conversation in order: each line's words, and whether a turn has taken it. */
const developerLines = (target: ConversationTarget) =>
  Effect.map(
    listMessagesPast(target.userId, target.conversationId, CODER_TOOL_SET, CURSOR_START),
    (page) => {
      assert.ok(page.read.ok);
      return page.read.value
        .filter((record) => record.message.role === MESSAGE_ROLE.USER)
        .map((record) => ({
          text: record.message.parts.find(isTextUIPart)?.text,
          taken: record.turnId !== undefined,
        }));
    },
  );

/** The id of the provider's model a step was told, read off the SDK's handle; none for a bare id. */
const readModelId = (model: CoderModelSelection["model"]) =>
  Option.map(
    Schema.decodeUnknownOption(Schema.Struct({ modelId: Schema.String }))(model),
    (handle) => handle.modelId,
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

/** The agent's own page from the start, read to the end of the hold a starting agent's read is held for. */
const ownPage = (target: ConversationTarget, agent: CodingAgent) =>
  Effect.gen(function* () {
    const reading = yield* Effect.forkChild(
      transcriptPast(target, CODER_TOOL_SET, CURSOR_START, agent, agent).pipe(
        Effect.provide(modelCatalogOf(CATALOG)),
      ),
    );
    yield* TestClock.adjust(CODER.MESSAGES_HOLD);
    return yield* driven(reading, CODER.MESSAGES_POLL);
  });

it.layer(Layer.mergeAll(getTestDB(), noNetwork))("the coding-agent host", (it) => {
  it.effect(
    "a turn's end writes the branch checked out in the sandbox on the agent's row, null for a detached HEAD; a read git cannot answer writes nothing and does not fail, so the stop that follows it runs",
    () =>
      Effect.gen(function* () {
        const host = yield* hostOverStore();
        const { userId, agent, admitted } = yield* openAgent(host);
        let shown: ReturnType<CommandTable> = { exitCode: 0, stdout: "luke/invites\n", stderr: "" };
        const sandbox = sandboxDouble((command) =>
          command === "git branch --show-current" ? shown : undefined,
        );
        sandbox.checkedOut = agent.repository;
        const branchOnRow = Effect.map(readCodingAgent(userId, agent.id), (row) =>
          Option.isSome(row) ? row.value.branch : assert.fail("the agent is gone"),
        );

        yield* host.recordBranch(admitted, sandbox);
        assert.equal(yield* branchOnRow, "luke/invites");

        // A detached HEAD prints nothing.
        shown = { exitCode: 0, stdout: "", stderr: "" };
        yield* host.recordBranch(admitted, sandbox);
        assert.equal(yield* branchOnRow, null);

        shown = { exitCode: 0, stdout: "luke/invites\n", stderr: "" };
        yield* host.recordBranch(admitted, sandbox);
        // git could not say: the row keeps what it had, and the record answers rather than fails.
        shown = undefined;
        yield* host.recordBranch(admitted, sandbox);
        assert.equal(yield* branchOnRow, "luke/invites");
      }),
  );

  it.effect(
    "a step is told the model and effort the agent's row holds now, with the window the catalog lists, and the fallback where it lists none",
    () =>
      Effect.gen(function* () {
        const host = yield* hostOverStore();
        const opus = yield* openAgent(host);
        const selected = yield* host
          .model(opus.admitted, undefined)
          .pipe(Effect.provide(modelCatalogOf(CATALOG)));
        assert.ok(Result.isSuccess(selected));
        assert.equal(Option.getOrUndefined(readModelId(selected.success.model)), "claude-opus-5-5");
        assert.equal(selected.success.modelContextWindowTokens, 1_000_000);
        assert.deepEqual(selected.success.modelOptions, {
          providerOptions: { anthropic: { effort: "high", thinking: SHOWN_THINKING } },
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
          providerOptions: { openai: { reasoningEffort: "low", reasoningSummary: "auto" } },
        });
      }),
  );

  it.effect(
    "a step on a model with two windows is told its whole window until the agent chooses the standard one, and its context is told against the window chosen",
    () =>
      Effect.gen(function* () {
        const host = yield* hostOverStore();
        const { userId, agent, target, auth, sessionId, admitted } = yield* openAgent(
          host,
          "openai/gpt-5.5",
        );
        const windowNow = Effect.map(
          host.model(admitted, undefined).pipe(Effect.provide(modelCatalogOf(WINDOWED_CATALOG))),
          (selected) =>
            Result.isSuccess(selected)
              ? selected.success.modelContextWindowTokens
              : assert.fail("the step was refused"),
        );
        const contextNow = Effect.map(
          transcriptPast(target, CODER_TOOL_SET, CURSOR_START, agent, agent).pipe(
            Effect.provide(modelCatalogOf(WINDOWED_CATALOG)),
          ),
          (page) => page.context,
        );
        const state = memoryRelayState();
        const prompt = yield* composedPrompt(host, admitted, agent);
        const session = { id: sessionId, auth, turn: { id: "turn_0" } };
        const relay = (event: MessageStreamEvent) =>
          // SAFETY: the relay reads the session's id and auth; eve's turn metadata is not read here.
          host.relay(event, admitted, session as never, state, { hash: prompt.hash });
        const data = { turnId: "turn_0", sequence: 0 };
        yield* relay(stamped({ type: "turn.started", data }));
        yield* relay(stamped({ type: "message.received", data: { ...data, message: PLAN_TEXT } }));
        yield* relay(
          stamped({
            type: "step.completed",
            data: {
              ...data,
              stepIndex: 0,
              finishReason: "tool-calls",
              usage: { inputTokens: 300_000, outputTokens: 400 },
            },
          }),
        );
        assert.equal(yield* windowNow, 1_050_000);
        const long = yield* contextNow;
        assert.equal(long?.windowTokens, 1_050_000);
        assert.equal(long?.compactionThresholdTokens, 945_000);

        yield* updateCodingAgentChoice(userId, agent.id, {
          model: "openai/gpt-5.5",
          effort: "high",
          contextWindow: CONTEXT_WINDOW.STANDARD,
        });
        assert.equal(yield* windowNow, 272_000);
        const standard = yield* contextNow;
        assert.equal(standard?.windowTokens, 272_000);
        assert.equal(standard?.compactionThresholdTokens, 244_800);

        // A change naming no window is the model's whole window again.
        yield* updateCodingAgentChoice(userId, agent.id, {
          model: "openai/gpt-5.5",
          effort: "low",
        });
        assert.equal(yield* windowNow, 1_050_000);
      }),
  );

  it.effect(
    "a delegation that names nothing records the agent's own pair, which the worker's step is told; a worker no delegation stands for is refused by name",
    () =>
      Effect.gen(function* () {
        const host = yield* hostOverStore();
        const { agent, auth, sessionId, admitted } = yield* openAgent(host);
        const made = yield* host
          .delegate(admitted, "call-1", {})
          .pipe(Effect.provide(modelCatalogOf(CATALOG)));
        assert.deepEqual(
          made,
          Result.succeed({ model: "anthropic/claude-opus-5.5", effort: "high" }),
        );

        const child = childSession(auth, sessionId, "call-1");
        const delegated = yield* host.admitDelegated(child.auth, child.id);
        assert.ok(Result.isSuccess(delegated));
        const selected = yield* host
          .delegatedModel(delegated.success, "call-1", undefined)
          .pipe(Effect.provide(modelCatalogOf(CATALOG)));
        assert.ok(Result.isSuccess(selected));
        assert.equal(Option.getOrUndefined(readModelId(selected.success.model)), "claude-opus-5-5");
        assert.deepEqual(selected.success.modelOptions, {
          providerOptions: { anthropic: { effort: "high", thinking: SHOWN_THINKING } },
        });
        assert.deepEqual(
          yield* host
            .delegatedModel(delegated.success, "call-nobody-made", undefined)
            .pipe(Effect.provide(modelCatalogOf(CATALOG))),
          Result.fail(CODER_REFUSAL.NO_DELEGATION),
        );
        // The same call made again after the agent's row changed answers the pair it already recorded.
        yield* updateCodingAgentChoice(admitted.target.userId, agent.id, {
          model: "openai/gpt-6.1-sol",
          effort: "low",
        });
        assert.deepEqual(
          yield* host
            .delegate(admitted, "call-1", {})
            .pipe(Effect.provide(modelCatalogOf(CATALOG))),
          Result.succeed({ model: "anthropic/claude-opus-5.5", effort: "high" }),
        );
      }),
  );

  it.effect(
    "a delegation on a pair of the agent's choosing runs the worker on that pair, and the worker's turn lands in the child conversation the call names, recording it",
    () =>
      Effect.gen(function* () {
        const host = yield* hostOverStore();
        const { auth, sessionId, target, admitted } = yield* openAgent(host);
        const made = yield* host
          .delegate(admitted, "call-2", { model: "openai/gpt-6.1-sol", effort: "low" })
          .pipe(Effect.provide(modelCatalogOf(CATALOG)));
        assert.ok(Result.isSuccess(made));

        const child = childSession(auth, sessionId, "call-2");
        const delegated = yield* host.admitDelegated(child.auth, child.id);
        assert.ok(Result.isSuccess(delegated));
        const selected = yield* host
          .delegatedModel(delegated.success, "call-2", undefined)
          .pipe(Effect.provide(modelCatalogOf(CATALOG)));
        assert.ok(Result.isSuccess(selected));
        assert.equal(Option.getOrUndefined(readModelId(selected.success.model)), "gpt-6.1-sol");
        assert.deepEqual(selected.success.modelOptions, {
          providerOptions: { openai: { reasoningEffort: "low", reasoningSummary: "auto" } },
        });

        const state = memoryRelayState();
        for (const event of workerTurn("turn_0", "Count the routes.", "Three routes.")) {
          yield* host.relayChild(event, child, state);
        }
        const conversationId = childConversationId(target.conversationId, "call-2");
        const row = yield* turnRow(hostTurnId(child.id, "turn_0"));
        assert.equal(row?.origin, TURN_ORIGIN.CHILD);
        assert.equal(row?.status, TURN_STATUS.SETTLED);
        assert.equal(row?.model, "openai/gpt-6.1-sol");
        assert.equal(row?.reasoningEffort, "low");
        const page = yield* transcriptPast(
          { userId: target.userId, conversationId },
          CODER_TOOL_SET,
          CURSOR_START,
          { createdAt: new Date(NOW) },
        ).pipe(Effect.provide(modelCatalogOf(CATALOG)));
        assert.deepEqual(
          page.messages.map((message) => [message.role, message.parts.find(isTextUIPart)?.text]),
          [
            [MESSAGE_ROLE.USER, "Count the routes."],
            [MESSAGE_ROLE.ASSISTANT, "Three routes."],
          ],
        );
        // The worker's thinking reads back with its answer, as the agent's does.
        assert.equal(page.messages[1]?.parts.find(isReasoningUIPart)?.text, WORKER_REASONING);
        assert.equal(page.status, CODING_AGENT_STATUS.COMPLETED);
        // The agent's session still stands for its conversation, so its own calls still run.
        assert.ok(Result.isSuccess(yield* host.admit(auth, sessionId)));
      }),
  );

  it.effect(
    "an agent handed a task of its own is titled from its first exchange as its turn completes, with no plan's name beside it, tidied of quotes and a full stop, and written once: a later turn asks nothing, and a rename is never covered",
    () =>
      Effect.gen(function* () {
        const model = titleModelAnswering(['"Sign-out button in the header."', "Second title"]);
        const host = yield* hostOverStore(model);
        const opened = yield* openAgent(host, undefined, undefined, {
          planSnapshot: null,
          task: "Add a sign-out button to the header.",
        });
        const { userId, agent } = opened;
        yield* exchange(host, opened, "turn_0", "Add a sign-out button to the header.");
        yield* host.title(opened.admitted);
        const titled = yield* readCodingAgent(userId, agent.id);
        assert.equal(Option.getOrThrow(titled).title, "Sign-out button in the header");
        const [asked] = model.doGenerateCalls;
        assert.ok(asked !== undefined);
        const read = JSON.stringify(asked.prompt);
        assert.match(read, /Add a sign-out button to the header[\s\S]*Done/u);
        assert.doesNotMatch(read, /Teammate invitations/u);

        // A title standing is never asked for again.
        yield* exchange(host, opened, "turn_1", "Make it red.");
        yield* host.title(opened.admitted);
        assert.equal(model.doGenerateCalls.length, 1);

        // The developer's own name is the last word: a generated title lands only where none stands.
        yield* renameCodingAgent(userId, agent.id, "Header sign-out");
        assert.equal(yield* fillCodingAgentTitle(userId, agent.id, "Late title"), false);
        const renamed = yield* readCodingAgent(userId, agent.id);
        assert.equal(Option.getOrThrow(renamed).title, "Header sign-out");
      }),
  );

  it.effect("an agent started from the plan is titled from the plan it said first", () =>
    Effect.gen(function* () {
      const model = titleModelAnswering(["Teammate invitations by email"]);
      const host = yield* hostOverStore(model);
      const opened = yield* openAgent(host);
      yield* exchange(host, opened, "turn_0", PLAN_TEXT);
      yield* host.title(opened.admitted);
      const titled = yield* readCodingAgent(opened.userId, opened.agent.id);
      assert.equal(Option.getOrThrow(titled).title, "Teammate invitations by email");
      const [asked] = model.doGenerateCalls;
      assert.ok(asked !== undefined);
      assert.match(JSON.stringify(asked.prompt), /Invite a teammate by email/u);
    }),
  );

  it.effect(
    "a first exchange that names no task, a greeting or an image with no words, is asked again as the next turn completes, and an agent still untitled past its third turn is asked no more",
    () =>
      Effect.gen(function* () {
        const greeted = titleModelAnswering(["", "Flaky login test"]);
        const greeting = yield* hostOverStore(greeted);
        const hello = yield* openAgent(greeting, undefined, undefined, {
          planSnapshot: null,
          task: "Hi",
        });
        yield* exchange(greeting, hello, "turn_0", "Hi");
        yield* greeting.title(hello.admitted);
        assert.equal(
          Option.getOrThrow(yield* readCodingAgent(hello.userId, hello.agent.id)).title,
          null,
        );
        yield* exchange(greeting, hello, "turn_1", "The login test fails on CI now and then.");
        yield* greeting.title(hello.admitted);
        // The retry reads the task that followed the greeting, which the agent's answer does not repeat.
        assert.match(JSON.stringify(greeted.doGenerateCalls[1]?.prompt), /login test fails on CI/u);
        assert.equal(
          Option.getOrThrow(yield* readCodingAgent(hello.userId, hello.agent.id)).title,
          "Flaky login test",
        );

        const shown = titleModelAnswering(["", "Login screen redesign"]);
        const imaging = yield* hostOverStore(shown);
        const image = yield* openAgent(imaging, undefined, undefined, {
          planSnapshot: null,
          task: "",
        });
        yield* exchange(imaging, image, "turn_0", "", [
          { type: "file", filename: "login.png", mediaType: "image/png" },
        ]);
        yield* imaging.title(image.admitted);
        assert.equal(
          Option.getOrThrow(yield* readCodingAgent(image.userId, image.agent.id)).title,
          null,
        );
        yield* exchange(imaging, image, "turn_1", "Redesign this screen.");
        yield* imaging.title(image.admitted);
        assert.equal(
          Option.getOrThrow(yield* readCodingAgent(image.userId, image.agent.id)).title,
          "Login screen redesign",
        );

        const quiet = titleModelAnswering(["", "", "", "Too late"]);
        const silent = yield* hostOverStore(quiet);
        const idle = yield* openAgent(silent, undefined, undefined, {
          planSnapshot: null,
          task: "Hi",
        });
        for (const turnId of ["turn_0", "turn_1", "turn_2", "turn_3"]) {
          yield* exchange(silent, idle, turnId, "Hi");
          yield* silent.title(idle.admitted);
        }
        assert.equal(quiet.doGenerateCalls.length, 3);
        assert.equal(
          Option.getOrThrow(yield* readCodingAgent(idle.userId, idle.agent.id)).title,
          null,
        );
      }),
  );

  it.effect(
    "an agent handed files with its task opens its sandbox before its session starts, to stage them: the sandbox's admission claims the record, so the checkout is let in, the start that follows still finds the record its own, and a session older than the one recorded is refused",
    () =>
      Effect.gen(function* () {
        const host = yield* hostOverStore();
        const stale = mintSession();
        const { auth } = yield* unclaimedAgent(undefined, undefined, {
          planSnapshot: null,
          task: "Match this mock",
        });
        const sessionId = mintSession();
        // Nothing has claimed the record yet, so the session is not yet the one it runs in.
        assert.ok(Result.isFailure(yield* host.admit(auth, sessionId)));

        const opening = yield* host.admitSandbox(auth, sessionId);
        assert.ok(Result.isSuccess(opening));
        assert.ok(Result.isSuccess(yield* host.admit(auth, sessionId)));

        // The session's start finds the record already its own: still the agent's start.
        const starting = yield* host.admitStarting(auth, sessionId);
        assert.ok(Result.isSuccess(starting));
        assert.equal(yield* host.sessionStarted(starting.success, sessionId), true);

        const refused = yield* host.admitSandbox(auth, stale);
        assert.ok(Result.isFailure(refused));
        assert.equal(refused.failure, BRAIN_HOST_REFUSAL.NOT_CURRENT_SESSION);
      }),
  );

  it("a sandbox counts as opened by a sandbox tool's call or a message received with files, and by no words alone or other call", () => {
    const turnId = "turn_0";
    const sequence = 0;
    const received = (
      parts: Extract<MessageStreamEvent, { type: "message.received" }>["data"]["parts"],
    ) =>
      stamped({
        type: "message.received",
        data: { turnId, sequence, message: "Match this mock", parts },
      });
    const requested = (toolName: string) =>
      stamped({
        type: "actions.requested",
        data: {
          turnId,
          sequence,
          stepIndex: 0,
          actions: [{ kind: "tool-call", callId: "call-1", toolName, input: {} }],
        },
      });
    assert.equal(
      opensSandbox(
        received([
          { type: "text", text: "Match this mock" },
          { type: "file", mediaType: "image/png", filename: "mock.png" },
        ]),
      ),
      true,
    );
    assert.equal(opensSandbox(requested(CODER_TOOL.READ_FILE)), true);
    assert.equal(opensSandbox(received([{ type: "text", text: "Match this mock" }])), false);
    assert.equal(opensSandbox(received(undefined)), false);
    assert.equal(opensSandbox(requested(CODER_TOOL.WEB_SEARCH)), false);
  });

  it.effect("a title call that fails leaves the agent untitled", () =>
    Effect.gen(function* () {
      const host = yield* hostOverStore(titleModelAnswering([new Error("fixture: provider down")]));
      const opened = yield* openAgent(host);
      yield* exchange(host, opened, "turn_0", PLAN_TEXT);
      yield* host.title(opened.admitted);
      const untitled = yield* readCodingAgent(opened.userId, opened.agent.id);
      assert.equal(Option.getOrThrow(untitled).title, null);
    }),
  );

  it.effect(
    "a worker's title is generated from the task its delegation handed it, tidied as the agent's is, and written once on its child, which the agent's page then names by the call",
    () =>
      Effect.gen(function* () {
        const model = titleModelAnswering(['"Count the API routes."', "Second title"]);
        const host = yield* hostOverStore(model);
        const { agent, target, admitted } = yield* openAgent(host);
        const made = yield* host
          .delegate(admitted, "call-3", {})
          .pipe(Effect.provide(modelCatalogOf(CATALOG)));
        assert.ok(Result.isSuccess(made));
        yield* host.delegationTitle(admitted, "call-3", "Count the routes under app/api.");
        const [asked] = model.doGenerateCalls;
        assert.ok(asked !== undefined);
        // The task is what is named; the agent's plan does not ride along.
        assert.match(JSON.stringify(asked.prompt), /Count the routes under app\/api/u);
        assert.doesNotMatch(JSON.stringify(asked.prompt), /Teammate invitations/u);

        // A worker already titled is never asked for again.
        yield* host.delegationTitle(admitted, "call-3", "Count the routes under app/api.");
        assert.equal(model.doGenerateCalls.length, 1);

        const page = yield* ownPage(target, agent);
        assert.deepEqual(page.subagentTitles, [
          { callId: "call-3", title: "Count the API routes" },
        ]);
      }),
  );

  it.effect(
    "a worker whose title call fails, or that a deployment with no title model delegates, stays untitled, and the agent's page names no title for it",
    () =>
      Effect.gen(function* () {
        const failing = yield* hostOverStore(
          titleModelAnswering([new Error("fixture: provider down")]),
        );
        const { agent, target, admitted } = yield* openAgent(failing);
        const untitled = yield* hostOverStore();
        for (const [host, callId] of [
          [failing, "call-4"],
          [untitled, "call-5"],
        ] as const) {
          const made = yield* host
            .delegate(admitted, callId, {})
            .pipe(Effect.provide(modelCatalogOf(CATALOG)));
          assert.ok(Result.isSuccess(made));
          yield* host.delegationTitle(admitted, callId, "Count the routes.");
        }
        const page = yield* ownPage(target, agent);
        assert.equal(page.subagentTitles, undefined);
      }),
  );

  it.effect("a change of the agent's model and effort is what the next step is told", () =>
    Effect.gen(function* () {
      const host = yield* hostOverStore();
      const { userId, agent, admitted } = yield* openAgent(host);
      const changed = yield* updateCodingAgentChoice(userId, agent.id, {
        model: "openai/gpt-6.1-sol",
        effort: "low",
      });
      assert.ok(Option.isSome(changed));
      const selected = yield* host
        .model(admitted, undefined)
        .pipe(Effect.provide(modelCatalogOf(CATALOG)));
      assert.ok(Result.isSuccess(selected));
      assert.equal(Option.getOrUndefined(readModelId(selected.success.model)), "gpt-6.1-sol");
      assert.deepEqual(selected.success.modelOptions, {
        providerOptions: { openai: { reasoningEffort: "low", reasoningSummary: "auto" } },
      });
    }),
  );

  it.effect(
    "a conversation that is no agent's is refused a model, an agent, and a prompt alike",
    () =>
      Effect.gen(function* () {
        const host = yield* hostOverStore();
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
    "the session is told whether its pull request's checks are readable, from what the installation grants the App, and told they are not where GitHub cannot be read",
    () =>
      Effect.gen(function* () {
        const host = yield* hostOverStore();
        const { agent, admitted } = yield* openAgent(host);

        const granted = yield* host
          .prompt(admitted, agent)
          .pipe(
            Effect.provide(
              reachingRelay({ contents: "write", pull_requests: "write", ...CI_READ_PERMISSIONS }),
            ),
          );
        const withheld = yield* composedPrompt(host, admitted, agent);
        const unread = yield* host.prompt(admitted, agent).pipe(Effect.provide(NO_GITHUB));

        assert.equal(granted.ciReadable, true);
        assert.ok(granted.text.includes("gh pr checks"));
        assert.equal(withheld.ciReadable, false);
        assert.ok(!withheld.text.includes("gh pr checks"));
        assert.notEqual(granted.hash, withheld.hash);
        assert.equal(unread.ciReadable, false);
      }),
  );

  it.effect(
    "a coding turn lands through the shared relay with no ask record: the plan as the developer's line, the answer with its reasoning, its shell call, and its words, and the turn row naming the agent's model and effort",
    () =>
      Effect.gen(function* () {
        const host = yield* hostOverStore();
        const { agent, target, auth, sessionId, admitted } = yield* openAgent(host);
        const state = memoryRelayState();
        const prompt = yield* composedPrompt(host, admitted, agent);
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

        const page = yield* transcriptPast(target, CODER_TOOL_SET, CURSOR_START, agent).pipe(
          Effect.provide(modelCatalogOf(CATALOG)),
        );
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
          codingAgentStatusOf(turns.get(target.conversationId), {
            createdAt: agent.createdAt,
            now: yield* Clock.currentTimeMillis,
          }),
          CODING_AGENT_STATUS.COMPLETED,
        );
      }),
  );

  it.effect(
    "a failed turn and a cancelled turn read as failed and cancelled, and the agent is never rerun",
    () =>
      Effect.gen(function* () {
        const host = yield* hostOverStore();
        for (const [end, status] of [
          ["turn.failed", CODING_AGENT_STATUS.FAILED],
          ["turn.cancelled", CODING_AGENT_STATUS.CANCELLED],
        ] as const) {
          const { agent, target, auth, sessionId, admitted } = yield* openAgent(host);
          const state = memoryRelayState();
          const prompt = yield* composedPrompt(host, admitted, agent);
          const session = { id: sessionId, auth, turn: { id: "turn_0" } };
          for (const event of codingTurn("turn_0", end)) {
            // SAFETY: the relay reads the session's id and auth; eve's turn metadata is not read here.
            yield* host.relay(event, admitted, session as never, state, {
              hash: prompt.hash,
            });
          }
          const turns = yield* latestTurnsOf(target.userId, [target.conversationId]);
          assert.equal(
            codingAgentStatusOf(turns.get(target.conversationId), {
              createdAt: agent.createdAt,
              now: yield* Clock.currentTimeMillis,
            }),
            status,
          );
          assert.equal(turns.size, 1);
        }
      }),
  );

  it.effect(
    "each step's end leaves what its provider counted on the agent's own page, against the window of the model it runs on now and eve's threshold in it, with estimates of its instructions, tools, and plan; a compaction drops the plan's estimate",
    () =>
      Effect.gen(function* () {
        const host = yield* hostOverStore();
        const { userId, agent, target, auth, sessionId, admitted } = yield* openAgent(host);
        const state = memoryRelayState();
        const prompt = yield* composedPrompt(host, admitted, agent);
        const session = { id: sessionId, auth, turn: { id: "turn_0" } };
        const relay = (event: MessageStreamEvent) =>
          // SAFETY: the relay reads the session's id and auth; eve's turn metadata is not read here.
          host.relay(event, admitted, session as never, state, { hash: prompt.hash });
        const context = Effect.map(
          transcriptPast(target, CODER_TOOL_SET, CURSOR_START, agent, agent).pipe(
            Effect.provide(modelCatalogOf(CATALOG)),
          ),
          (page) => page.context,
        );
        const turnId = "turn_0";
        const sequence = 0;
        const stepEnded = (
          stepIndex: number,
          usage: Extract<MessageStreamEvent, { type: "step.completed" }>["data"]["usage"],
        ) =>
          stamped({
            type: "step.completed",
            data: { turnId, sequence, stepIndex, finishReason: "tool-calls", usage },
          });

        // The plan lands first, so each read answers at once rather than holding for the next message.
        yield* relay(stamped({ type: "turn.started", data: { turnId, sequence } }));
        yield* relay(
          stamped({ type: "message.received", data: { turnId, sequence, message: PLAN_TEXT } }),
        );
        assert.equal(yield* context, undefined);

        yield* relay(
          stepEnded(0, { inputTokens: 30_000, outputTokens: 400, cacheWriteTokens: 29_000 }),
        );
        yield* relay(
          stepEnded(1, { inputTokens: 64_000, outputTokens: 1_200, cacheReadTokens: 60_000 }),
        );
        // A step whose provider counted nothing leaves the one before it standing.
        yield* relay(stepEnded(2, undefined));
        const measured = yield* context;
        assert.ok(measured);
        const { estimated, ...counted } = measured;
        assert.deepEqual(counted, {
          windowTokens: 1_000_000,
          compactionThresholdTokens: 900_000,
          inputTokens: 64_000,
          outputTokens: 1_200,
          cachedInputTokens: 60_000,
          measuredAt: NOW,
        });
        // The plan is estimated at about four bytes a token, as eve estimates; the instructions
        // and the tools are text of the service's own, each well short of what the step read.
        assert.ok(estimated.briefTokens !== undefined);
        assert.ok(Math.abs(estimated.briefTokens - PLAN_TEXT.length / 4) <= 2);
        assert.ok(estimated.systemPromptTokens > estimated.briefTokens);
        assert.ok(estimated.toolDefinitionTokens > estimated.briefTokens);
        assert.ok(
          estimated.systemPromptTokens + estimated.toolDefinitionTokens + estimated.briefTokens <
            measured.inputTokens,
        );

        // The next step runs on another model, whose window the catalog does not list: a read
        // under the agent as it stood before the change still tells the window of the model now.
        yield* updateCodingAgentChoice(userId, agent.id, {
          model: "openai/gpt-6.1-sol",
          effort: "high",
        });
        const moved = yield* transcriptPast(
          target,
          CODER_TOOL_SET,
          CURSOR_START,
          agent,
          agent,
        ).pipe(Effect.provide(modelCatalogOf(CATALOG)));
        assert.equal(moved.context?.windowTokens, CODER.FALLBACK_CONTEXT_WINDOW_TOKENS);
        assert.equal(
          moved.context?.compactionThresholdTokens,
          CODER.FALLBACK_CONTEXT_WINDOW_TOKENS * CODER.COMPACTION_THRESHOLD_SHARE,
        );

        yield* relay(
          stamped({
            type: "compaction.completed",
            data: { turnId, sequence, stepIndex: 3, sessionId, modelId: "m" },
          }),
        );
        const compacted = yield* context;
        assert.equal(compacted?.compactedAt, NOW);
        assert.equal(compacted?.inputTokens, 64_000);
        assert.equal(compacted?.estimated.briefTokens, undefined);
        assert.equal(compacted?.estimated.systemPromptTokens, estimated.systemPromptTokens);

        // A worker's transcript, read under no agent of its own, carries no context.
        const worker = yield* transcriptPast(target, CODER_TOOL_SET, CURSOR_START, agent).pipe(
          Effect.provide(modelCatalogOf(CATALOG)),
        );
        assert.equal(worker.context, undefined);
      }),
  );

  it.effect(
    "a transcript read past the cursor is held open while the agent is starting or the turn runs, answers the moment a message lands with the agent's status, hears an amended journal again, and lets go at the hold; an agent that ended answers at once",
    () =>
      Effect.gen(function* () {
        const host = yield* hostOverStore();
        const { agent, target, auth, sessionId, admitted } = yield* openAgent(host);
        const state = memoryRelayState();
        const prompt = yield* composedPrompt(host, admitted, agent);
        const session = { id: sessionId, auth, turn: { id: "turn_0" } };
        const events = codingTurn("turn_0", "turn.completed");
        const play = (from: number, to: number) =>
          Effect.forEach(events.slice(from, to), (event) =>
            // SAFETY: the relay reads the session's id and auth; eve's turn metadata is not read here.
            host.relay(event, admitted, session as never, state, { hash: prompt.hash }),
          );
        const read = (after: MessageCursor) =>
          transcriptPast(target, CODER_TOOL_SET, after, agent).pipe(
            Effect.provide(modelCatalogOf(CATALOG)),
          );

        // Starting, before the first turn: the read holds rather than spinning, and lets go at the
        // hold with the status it stands at, so a tab on a starting agent costs one read per hold.
        const starting = yield* Effect.forkChild(read(CURSOR_START));
        yield* TestClock.adjust(CODER.MESSAGES_POLL);
        assert.equal(starting.pollUnsafe(), undefined);
        yield* TestClock.adjust(CODER.MESSAGES_HOLD);
        const idle: TranscriptPage = yield* driven(starting, CODER.MESSAGES_POLL);
        assert.deepEqual(idle.messages, []);
        assert.equal(cursorToWire(idle.cursor), "0:0");
        assert.equal(idle.status, CODING_AGENT_STATUS.STARTING);

        // The turn starts and the plan lands: a held read answers with it, running.
        yield* play(0, 2);
        const first = yield* read(CURSOR_START);
        assert.equal(first.messages.length, 1);
        assert.equal(first.messages[0]?.role, MESSAGE_ROLE.USER);
        assert.equal(first.status, CODING_AGENT_STATUS.RUNNING);

        // Past that, nothing new while the turn runs: the read holds, and the journal's next write releases it.
        const held = yield* Effect.forkChild(read(first.cursor));
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
        const amended = yield* read(released.cursor);
        assert.equal(amended.messages.length, 1);
        assert.ok(amended.messages[0]?.parts.some((part) => isReasoningUIPart(part)));

        // Nothing lands inside the hold: the read lets go empty with the cursor to read on from.
        const expiring = yield* Effect.forkChild(read(amended.cursor));
        yield* TestClock.adjust(CODER.MESSAGES_HOLD);
        const expired: TranscriptPage = yield* driven(expiring, CODER.MESSAGES_POLL);
        assert.deepEqual(expired.messages, []);
        assert.deepEqual(cursorOfWire(cursorToWire(expired.cursor)), amended.cursor);
        assert.equal(expired.status, CODING_AGENT_STATUS.RUNNING);

        // The turn ends: the finished answer replaces the journal and the page says the agent
        // completed, and an ended agent's empty read answers at once.
        yield* play(7, events.length);
        const finished = yield* read(expired.cursor);
        assert.equal(finished.messages.length, 1);
        assert.ok(finished.messages[0]?.parts.some((part) => isTextUIPart(part)));
        assert.equal(finished.status, CODING_AGENT_STATUS.COMPLETED);
        const done = yield* read(finished.cursor);
        assert.deepEqual(done.messages, []);
        assert.equal(done.status, CODING_AGENT_STATUS.COMPLETED);
      }),
  );

  it.effect(
    "a starting agent whose first turn never lands reads as failed past the grace, and its read is not held",
    () =>
      Effect.gen(function* () {
        const host = yield* hostOverStore();
        const { agent, target } = yield* openAgent(host);
        yield* TestClock.adjust(CODER.STARTING_GRACE);
        yield* TestClock.adjust(CODER.MESSAGES_POLL);

        const page = yield* transcriptPast(target, CODER_TOOL_SET, CURSOR_START, agent).pipe(
          Effect.provide(modelCatalogOf(CATALOG)),
        );

        assert.deepEqual(page.messages, []);
        assert.equal(page.status, CODING_AGENT_STATUS.FAILED);
      }),
  );

  it.effect(
    "a line the developer sent ahead of its turn is taken by the turn that receives it, in place: no second row is written, and the agent reads as running from the send until the turn opens on it",
    () =>
      Effect.gen(function* () {
        const host = yield* hostOverStore();
        const { agent, target, auth, sessionId, admitted } = yield* openAgent(host);
        const state = memoryRelayState();
        const prompt = yield* composedPrompt(host, admitted, agent);
        const session = { id: sessionId, auth, turn: { id: "turn_0" } };
        const play = (events: readonly MessageStreamEvent[]) =>
          Effect.forEach(events, (event) =>
            // SAFETY: the relay reads the session's id and auth; eve's turn metadata is not read here.
            host.relay(event, admitted, session as never, state, { hash: prompt.hash }),
          );
        const statusNow = () =>
          Effect.gen(function* () {
            const turns = yield* latestTurnsOf(target.userId, [target.conversationId]);
            const awaiting = yield* awaitingLinesOf(target.userId, [target.conversationId]);
            return codingAgentStatusOf(turns.get(target.conversationId), {
              createdAt: agent.createdAt,
              now: yield* Clock.currentTimeMillis,
              lineAwaits: awaiting.has(target.conversationId),
            });
          });
        const lines = () => developerLines(target);
        const first = codingTurn("turn_0", "turn.completed");
        const [started, received, ...rest] = first;
        assert.ok(started && received);

        // The turn opens on the plan; a steer sent while it runs stands at once, awaiting it.
        yield* play([started, received]);
        yield* awaitingLine(target, "Use the shared helper.", "k-steer");
        assert.deepEqual(yield* lines(), [
          { text: PLAN_TEXT, taken: true },
          { text: "Use the shared helper.", taken: false },
        ]);
        assert.equal(yield* statusNow(), CODING_AGENT_STATUS.RUNNING);
        // The turn receives the steer: the line is its now, in place, and no row is written beside it.
        yield* play([
          stampedEveEvent(
            {
              type: "message.received",
              data: { turnId: "turn_0", sequence: 0, message: "Use the shared helper." },
            },
            NOW,
            ["d-plan", "d-steer"],
          ),
        ]);
        assert.deepEqual(yield* lines(), [
          { text: PLAN_TEXT, taken: true },
          { text: "Use the shared helper.", taken: true },
        ]);
        const page = yield* transcriptPast(target, CODER_TOOL_SET, CURSOR_START, agent).pipe(
          Effect.provide(modelCatalogOf(CATALOG)),
        );
        assert.equal(
          page.messages.filter((message) => message.role === MESSAGE_ROLE.USER).length,
          2,
        );

        // A line sent as the turn ends awaits the next turn: the agent reads as running on the
        // line's account alone until that turn opens on it.
        yield* awaitingLine(target, "Now add the tests.", "k-next");
        yield* play(rest);
        const turns = yield* latestTurnsOf(target.userId, [target.conversationId]);
        assert.equal(turns.get(target.conversationId)?.status, TURN_STATUS.SETTLED);
        assert.equal(yield* statusNow(), CODING_AGENT_STATUS.RUNNING);
        yield* TestClock.adjust("1 minute");
        yield* play([
          stampedEveEvent({ type: "turn.started", data: { turnId: "turn_1", sequence: 1 } }, NOW, [
            "d-queue",
          ]),
          stampedEveEvent(
            {
              type: "message.received",
              data: { turnId: "turn_1", sequence: 1, message: "Now add the tests." },
            },
            NOW,
            ["d-queue"],
          ),
        ]);
        const taken = yield* lines();
        assert.deepEqual(taken.at(-1), { text: "Now add the tests.", taken: true });
        assert.equal(taken.length, 3);
        assert.equal(yield* statusNow(), CODING_AGENT_STATUS.RUNNING);
        yield* play([stamped({ type: "turn.completed", data: { turnId: "turn_1", sequence: 1 } })]);
        assert.equal(yield* statusNow(), CODING_AGENT_STATUS.COMPLETED);
      }),
  );

  it.effect(
    "a line carrying files is taken by the turn whose receipt carries them, coalesced with a plain line before it and a line of files alone after it, and a receipt of files alone no line awaits keeps them on its own row with no words, a text file read back to a file by its heading",
    () =>
      Effect.gen(function* () {
        const host = yield* hostOverStore();
        const { target, auth, sessionId, admitted, agent } = yield* openAgent(host);
        const state = memoryRelayState();
        const prompt = yield* composedPrompt(host, admitted, agent);
        const session = { id: sessionId, auth, turn: { id: "turn_0" } };
        const play = (events: readonly MessageStreamEvent[]) =>
          Effect.forEach(events, (event) =>
            // SAFETY: the relay reads the session's id and auth; eve's turn metadata is not read here.
            host.relay(event, admitted, session as never, state, { hash: prompt.hash }),
          );
        const [started, received] = codingTurn("turn_0", "turn.completed");
        assert.ok(started && received);
        yield* play([started, received]);
        const writer = yield* storeWriter({ tools: CODER_TOOL_SET });
        yield* awaitingLine(target, "Plain first.", "k-plain");
        const withFiles = yield* writer.writeAwaitingLine(
          target,
          {
            text: "Look at these.",
            clientKey: "k-files",
            attachments: [
              { name: "notes.md", mediaType: "text/plain", data: "IyBOb3Rlcw==" },
              { name: "shot.png", mediaType: "image/png", data: "iVBORw0KGgo=" },
            ],
          },
          Effect.succeed(true),
        );
        assert.ok(Result.isSuccess(withFiles) && Option.isSome(withFiles.success));
        const filesAlone = yield* writer.writeAwaitingLine(
          target,
          {
            text: "",
            clientKey: "k-alone",
            attachments: [{ name: "after.png", mediaType: "image/png", data: "iVBORw0KGgo=" }],
          },
          Effect.succeed(true),
        );
        assert.ok(Result.isSuccess(filesAlone) && Option.isSome(filesAlone.success));

        // eve coalesced the three steers into one message: its summary names the images, its parts hold the words.
        yield* play([
          stamped({
            type: "message.received",
            data: {
              turnId: "turn_0",
              sequence: 0,
              message:
                "Plain first.\nLook at these.\nAttached file: notes.md\n```\n# Notes\n```\n[file: shot.png (image/png)]\n[file: after.png (image/png)]",
              parts: [
                { type: "text", text: "Plain first." },
                { type: "text", text: "Look at these." },
                { type: "text", text: "Attached file: notes.md\n```\n# Notes\n```" },
                { type: "file", filename: "shot.png", mediaType: "image/png" },
                { type: "file", filename: "after.png", mediaType: "image/png" },
              ],
            },
          }),
        ]);
        assert.deepEqual(yield* linesByKey(target, ["k-plain", "k-files", "k-alone"]), [
          { turnId: hostTurnId(sessionId, "turn_0") },
          { turnId: hostTurnId(sessionId, "turn_0") },
          { turnId: hostTurnId(sessionId, "turn_0") },
        ]);
        assert.equal((yield* developerLines(target)).length, 4);

        // A receipt no line awaits is written as eve received it: its words, empty where it carried
        // files alone, then each file, a text part spelled as a file's heading read back as that file.
        yield* TestClock.adjust("1 minute");
        yield* play([
          stamped({ type: "turn.started", data: { turnId: "turn_1", sequence: 1 } }),
          stamped({
            type: "message.received",
            data: {
              turnId: "turn_1",
              sequence: 1,
              message: "Attached file: spec.md\n```\nRead it.\n```",
              parts: [
                { type: "text", text: "Attached file: spec.md\n```\nRead it.\n```" },
                { type: "text", text: "Attached file: a.ts\n````\nconst a = ```x```;\n````" },
                {
                  type: "file",
                  filename: "spec.pdf",
                  mediaType: "application/pdf",
                  url: "data:application/pdf;base64,JVBERi0=",
                },
                { type: "file", filename: "staged.png", mediaType: "image/png", size: 8 },
              ],
            },
          }),
        ]);
        const page = yield* listMessagesPast(
          target.userId,
          target.conversationId,
          CODER_TOOL_SET,
          CURSOR_START,
        );
        assert.ok(page.read.ok);
        const rows = page.read.value.filter((record) => record.message.role === MESSAGE_ROLE.USER);
        assert.deepEqual(rows.at(2)?.message.parts, [
          { type: "text", text: "Look at these.", state: "done" },
          {
            type: "file",
            mediaType: "text/plain",
            filename: "notes.md",
            url: "data:text/plain;base64,IyBOb3Rlcw==",
          },
          {
            type: "file",
            mediaType: "image/png",
            filename: "shot.png",
            url: "data:image/png;base64,iVBORw0KGgo=",
          },
        ]);
        assert.deepEqual(rows.at(-1)?.message.parts, [
          { type: "text", text: "", state: "done" },
          {
            type: "file",
            mediaType: "text/plain",
            filename: "spec.md",
            url: "data:text/plain;base64,UmVhZCBpdC4=",
          },
          {
            type: "file",
            mediaType: "text/plain",
            filename: "a.ts",
            url: "data:text/plain;base64,Y29uc3QgYSA9IGBgYHhgYGA7",
          },
          {
            type: "file",
            mediaType: "application/pdf",
            filename: "spec.pdf",
            url: "data:application/pdf;base64,JVBERi0=",
          },
          { type: "file", mediaType: "image/png", filename: "staged.png", url: "" },
        ]);
      }),
  );

  it.effect(
    "two awaiting lines with the same words are taken in the order sent, each by the turn that receives it, and a line sent again under its key is the one already standing: nothing is dispatched and no second row is written",
    () =>
      Effect.gen(function* () {
        const host = yield* hostOverStore();
        const { agent, target, auth, sessionId, admitted } = yield* openAgent(host);
        const state = memoryRelayState();
        const prompt = yield* composedPrompt(host, admitted, agent);
        const session = { id: sessionId, auth, turn: { id: "turn_0" } };
        const play = (events: readonly MessageStreamEvent[]) =>
          Effect.forEach(events, (event) =>
            // SAFETY: the relay reads the session's id and auth; eve's turn metadata is not read here.
            host.relay(event, admitted, session as never, state, { hash: prompt.hash }),
          );
        const [started, received] = codingTurn("turn_0", "turn.completed");
        assert.ok(started && received);
        yield* play([started, received]);
        const first = yield* awaitingLine(target, "Run checks", "k-1");
        yield* awaitingLine(target, "Run checks", "k-2");
        assert.equal(first.effect, STORE_WRITE_EFFECT.WRITTEN);

        // The same key again: the line stands, eve is not asked, and the row is the first's.
        const writer = yield* storeWriter({ tools: CODER_TOOL_SET });
        let dispatched = false;
        const again = yield* writer.writeAwaitingLine(
          target,
          { text: "Run checks", clientKey: "k-1" },
          Effect.sync(() => {
            dispatched = true;
            return true;
          }),
        );
        assert.ok(Result.isSuccess(again) && Option.isSome(again.success));
        assert.deepEqual(again.success.value, {
          id: first.id,
          effect: STORE_WRITE_EFFECT.REPEATED,
        });
        assert.equal(dispatched, false);
        assert.equal((yield* developerLines(target)).length, 3);

        // The turn under way receives the words once: the older line is its.
        yield* play([
          stamped({
            type: "message.received",
            data: { turnId: "turn_0", sequence: 0, message: "Run checks" },
          }),
        ]);
        assert.deepEqual(yield* linesByKey(target, ["k-1", "k-2"]), [
          { turnId: hostTurnId(sessionId, "turn_0") },
          { turnId: undefined },
        ]);

        // The next turn opens on the other.
        yield* TestClock.adjust("1 minute");
        yield* play([
          stamped({ type: "turn.started", data: { turnId: "turn_1", sequence: 1 } }),
          stamped({
            type: "message.received",
            data: { turnId: "turn_1", sequence: 1, message: "Run checks" },
          }),
        ]);
        assert.deepEqual(yield* linesByKey(target, ["k-1", "k-2"]), [
          { turnId: hostTurnId(sessionId, "turn_0") },
          { turnId: hostTurnId(sessionId, "turn_1") },
        ]);
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
          deploymentSecret: () => undefined,
          keys: () => Effect.succeed({ anthropic: undefined, openAi: undefined }),
          titleModel: () => undefined,
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
        const prompt = yield* composedPrompt(host, admitted, agent);
        const session = { id: sessionId, auth, turn: { id: "turn_0" } };
        // SAFETY: the relay reads the session's id and auth; eve's turn metadata is not read here.
        yield* host.relay(
          codingTurn("turn_0", "turn.completed")[0] as MessageStreamEvent,
          admitted,
          session as never,
          state,
          { hash: prompt.hash },
        );
        const turn = yield* turnRow(hostTurnId(sessionId, "turn_0"));
        assert.equal(turn?.model, CODER_MODEL_FIXTURE.SCRIPTED_MODEL_ID);
      }),
  );
  it.effect(
    "an agent's notes are taken into its plan as the notetaker's are, the ones the plan cannot take reported, and read back in the plan",
    () =>
      Effect.gen(function* () {
        const host = yield* hostOverStore();
        const { userId, agent, admitted } = yield* openAgent(host);
        const input = unparsedWire({
          notes: [
            {
              kind: "add",
              section: "Open questions",
              text: "- Who may withdraw an invite? Going on as: the member who sent it.",
            },
            { kind: "add", section: "Approach", text: "- Invites expire after 7 days." },
            { kind: "replace", find: "a phrase the plan never held", text: "an owner" },
          ],
        });

        const answer = yield* host.editPlan(admitted, input, 0);

        assert.deepEqual(answer, {
          status: ACTION_RESULT_STATUS.ACCEPTED,
          taken: 2,
          missed: ["replace a phrase the plan never held"],
        });
        const stored = Option.getOrThrow(yield* readPlan(userId, agent.planId));
        const sectionText = (heading: string) =>
          planSections(stored.text).find((section) => section.heading === heading)?.text ?? "";
        assert.ok(
          sectionText("Open questions").endsWith(
            "\n\n- Who may withdraw an invite? Going on as: the member who sent it.",
          ),
        );
        assert.ok(sectionText("Approach").endsWith("\n\n- Invites expire after 7 days."));
        assert.equal(stored.plan.document.body, stored.text);
        // The save is journaled as the agent's, with the notes that were taken and the agent named by its row.
        const at = yield* Clock.currentTimeMillis;
        assert.deepEqual(stored.plan.agentEdits, [{ agentId: agent.id, label: agent.model, at }]);
        assert.deepEqual(
          stored.agentEdits.map((edit) => edit.notes.map((note) => note.kind)),
          [["add", "add"]],
        );
      }),
  );

  it.effect(
    "an agent started before notes named headings still lands its notes under its fields' headings",
    () =>
      Effect.gen(function* () {
        const host = yield* hostOverStore();
        const { userId, agent, admitted } = yield* openAgent(host);
        const input = unparsedWire({
          notes: [
            { kind: "add", field: "openQuestions", text: "Who may withdraw an invite?" },
            { kind: "add", field: "approach", text: "Invites expire after 7 days." },
          ],
        });

        const answer = yield* host.editPlan(admitted, input, 0);

        assert.deepEqual(answer, { status: ACTION_RESULT_STATUS.ACCEPTED, taken: 2, missed: [] });
        const stored = Option.getOrThrow(yield* readPlan(userId, agent.planId));
        const sectionText = (heading: string) =>
          planSections(stored.text).find((section) => section.heading === heading)?.text ?? "";
        assert.ok(sectionText("Open questions").endsWith("\n\n- Who may withdraw an invite?"));
        assert.ok(sectionText("Approach").endsWith("\n\nInvites expire after 7 days."));
      }),
  );

  it.effect(
    "a call holding one note that does not read is refused whole, and the plan stands",
    () =>
      Effect.gen(function* () {
        const host = yield* hostOverStore();
        const { userId, agent, admitted } = yield* openAgent(host);
        const input = unparsedWire({
          notes: [
            { kind: "add", section: "Approach", text: "- Invites expire after 7 days." },
            { kind: "add", text: "- A note that names no heading." },
          ],
        });

        const answer = yield* host.editPlan(admitted, input, 0);

        assert.deepEqual(answer, {
          status: ACTION_RESULT_STATUS.REJECTED,
          reason: PLAN_EDIT_REFUSAL.UNREADABLE,
        });
        assert.equal(requestedNotes(input), 0);
        const stored = Option.getOrThrow(yield* readPlan(userId, agent.planId));
        assert.equal(stored.text, DEFAULT_PLAN_TEMPLATE);
      }),
  );

  it.effect(
    "notes outside the template or past the turn's cap are refused, and the plan stands",
    () =>
      Effect.gen(function* () {
        const host = yield* hostOverStore();
        const { userId, agent, admitted } = yield* openAgent(host);
        const outside = unparsedWire({ notes: [{ kind: "add", field: "title", text: "x" }] });
        const two = unparsedWire({
          notes: [
            { kind: "add", section: "Approach", text: "One." },
            { kind: "add", section: "Approach", text: "Two." },
          ],
        });

        assert.deepEqual(yield* host.editPlan(admitted, outside, 0), {
          status: ACTION_RESULT_STATUS.REJECTED,
          reason: PLAN_EDIT_REFUSAL.UNREADABLE,
        });
        assert.deepEqual(yield* host.editPlan(admitted, two, PLAN_EDIT.MAX_NOTES_PER_TURN - 1), {
          status: ACTION_RESULT_STATUS.REJECTED,
          reason: PLAN_EDIT_REFUSAL.TOO_MANY,
        });
        const stored = Option.getOrThrow(yield* readPlan(userId, agent.planId));
        assert.equal(stored.text, DEFAULT_PLAN_TEMPLATE);

        // An agent handed a task never saw the plan, so it is refused by name.
        const onTask = yield* openAgent(host, "anthropic/claude-opus-5.5", "high", {
          planSnapshot: null,
          task: "Rename the invite button.",
        });
        assert.deepEqual(yield* host.editPlan(onTask.admitted, two, 0), {
          status: ACTION_RESULT_STATUS.REJECTED,
          reason: PLAN_EDIT_REFUSAL.NO_PLAN,
        });

        // Two calls one step makes run at once: each reserves its notes before its save goes out,
        // so the second reads the first's reservation, and a refused call gives its reservation back.
        assert.equal(requestedNotes(two), 2);
        assert.equal(requestedNotes(outside), 0);
        let count = reserveNotes({ count: 0 }, "turn_0", PLAN_EDIT.MAX_NOTES_PER_TURN);
        assert.equal(takenInTurn(count, "turn_0"), PLAN_EDIT.MAX_NOTES_PER_TURN);
        count = reserveNotes(count, "turn_0", 2);
        count = settleNotes(count, "turn_0", 2, 0);
        count = settleNotes(count, "turn_0", PLAN_EDIT.MAX_NOTES_PER_TURN, 38);
        assert.equal(takenInTurn(count, "turn_0"), 38);
        // The count is the session's own: a new turn starts it over.
        assert.equal(takenInTurn(count, "turn_1"), 0);
        assert.deepEqual(reserveNotes(count, "turn_1", 1), { turnId: "turn_1", count: 1 });
      }),
  );
});
