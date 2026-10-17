import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { writeAccountPreferences } from "@luke/database/models/account-store";
import { agentWorkspace, roster } from "@luke/database/models/chat-store";
import {
  archiveCodingAgent,
  type CodingAgentBriefText,
  createCodingAgent,
  latestTurnsOf,
  readCodingAgent,
} from "@luke/database/models/coding-agent-store";
import { readConversationPicture } from "@luke/database/models/conversation-pictures";
import { childConversationId, hostTurnId } from "@luke/database/models/ids";
import { keepPlanAttachment, PLAN_ATTACHMENT_KEEP } from "@luke/database/models/plan-attachments";
import { holdSandbox } from "@luke/database/models/sandbox-terminal-lease";
import { openTaskConversation, readTask, updateTask } from "@luke/database/models/task-store";
import { type ConversationTarget, storeWriter } from "@luke/database/models/writer";
import { codingAgent } from "@luke/database/schemas/coding-agent";
import { conversations, turns } from "@luke/database/schemas/storage";
import { CONVERSATION_KIND, MESSAGE_SENDER } from "@luke/database/storage-vocabulary";
import { getTestDB, startTask } from "@luke/database/testing";
import { CHAT_TOOL } from "@luke/features/chat-wire";
import { CODING_AGENT_STATUS } from "@luke/features/coding-agent-wire";
import { MODEL_PROVIDER } from "@luke/features/models-wire";
import { PICTURE_TYPE } from "@luke/features/picture-wire";
import { planAttachmentAddress } from "@luke/features/plan-attachment-link";
import { planSections } from "@luke/features/plan-document";
import { FAST_ACCESS } from "@luke/features/provider-key-wire";
import { EXPERIMENT } from "@luke/settings";
import { noNetwork } from "@luke/wire/testing";
import { isReasoningUIPart, isTextUIPart, isToolUIPart, type LanguageModel } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { eq } from "drizzle-orm";
import { Clock, Effect, Layer, Option, Redacted, Result, Schema } from "effect";
import { Base64 } from "effect/encoding";
import type { MessageStreamEvent } from "eve/client";
import type { SessionAuth, SessionAuthContext } from "eve/context";
import {
  ACTION_RESULT_STATUS,
  MESSAGE_AUTHOR,
  MESSAGE_CHANNEL,
  MESSAGE_ROLE,
  TOOL_PART_STATE,
  TURN_ORIGIN,
  TURN_STATUS,
  unparsedWire,
  type WireRecord,
} from "../../core.js";
import { modelCatalogOf, type OfferedModel } from "../../providers/model-catalog.js";
import { PICTURE_LOOK_STATUS } from "../../tasks/picture-look.js";
import { stampedEveEvent } from "../../testing/eve-events.js";
import { githubReaching, openGithubUser } from "../../testing/github-app-fake.js";
import { BRAIN_HOST_ATTRIBUTE, BRAIN_HOST_TURN } from "../brain-host/bounds.js";
import { memoryRelayState } from "../brain-host/relay.js";
import { CODER_REFUSAL } from "./bounds.js";
import { CHAT_TOOL_REFUSAL } from "./chat.js";
import { type CoderHost, coderHost } from "./host.js";
import type { InboxSandboxDoor } from "./inbox-image.js";
import type { ProviderKeys } from "./model.js";
import { PLAN_EDIT_REFUSAL } from "./plan-edit.js";
import type { CoderHostSeams } from "./production.js";
import { codingAgentStatusOf } from "./status.js";
import { titleCodingAgent } from "./title.js";
import { CODER_TOOL, CODER_TOOL_SET } from "./tool-set.js";
import { CURSOR_START, transcriptPast } from "./transcript.js";

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
 * conversation, records. Synthetic accounts, tasks, keys, and words
 * throughout.
 */

const NOW = 1_800_000_000_000;

/** A sandbox door no call of notes alone opens: one that fails if it is. */
const noSandbox: InboxSandboxDoor = () => Promise.reject(new Error("the sandbox was opened"));

const PLAN_TEXT = "# Teammate invitations\n\n## Goal\n\nInvite a teammate by email.\n";

const OPUS: OfferedModel = {
  id: "anthropic/claude-opus-5.5",
  name: "Claude Opus 5.5",
  provider: MODEL_PROVIDER.ANTHROPIC,
  efforts: ["low", "medium", "high", "max"],
  contextWindow: 1_000_000,
};

const CATALOG: readonly OfferedModel[] = [
  OPUS,
  {
    id: "openai/gpt-6.1-sol",
    name: "GPT-6.1 Sol",
    provider: MODEL_PROVIDER.OPENAI,
    efforts: ["low", "high"],
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
        reachesSession: () => Promise.resolve(false),
        reachesConversation: () => Promise.resolve(false),
      },
      deploymentSecret: () => undefined,
      eveOrigin: () => undefined,
      keys: () => Effect.succeed(KEYS),
      fastRefused: async () => undefined,
      titleModel: () => titleModel,
      research: () => ({ openAi: undefined, spend: Effect.void }),
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

/** An account with one agent started on a task, on the model given, whose session nothing has claimed yet. */
const unclaimedAgent = (
  model = "anthropic/claude-opus-5.5",
  effort = "high",
  brief: CodingAgentBriefText = { planSnapshot: PLAN_TEXT, prompt: null },
) =>
  Effect.gen(function* () {
    const userId = yield* openGithubUser();
    const task = yield* startTask(userId, {
      name: "Teammate invitations",
      repository: "acme/relay",
    });
    const started = yield* createCodingAgent(userId, {
      taskId: task.id,
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

/** An account with one agent started on a task, on the model given, its session claimed as the hook claims it. */
const openAgent = (
  host: CoderHost,
  model = "anthropic/claude-opus-5.5",
  effort = "high",
  brief: CodingAgentBriefText = { planSnapshot: PLAN_TEXT, prompt: null },
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

/** Chat turned on for the account, as Settings › Experimental turns it on. */
const chatOn = (userId: string) =>
  writeAccountPreferences(userId, { experiments: { [EXPERIMENT.CHAT]: true } });

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

/** A title model answering each call with the next of `answers`, nothing once they run out, keeping each prompt it was asked. */
function scriptedTitleModel(answers: readonly string[]) {
  const asked: string[] = [];
  const model = new MockLanguageModelV4({
    doGenerate: async (options) => {
      const text = answers[asked.length] ?? "";
      asked.push(JSON.stringify(options.prompt));
      return {
        content: [{ type: "text", text }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: {
          inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 1, text: 1, reasoning: 0 },
        },
        warnings: [],
      };
    },
  });
  return { model, asked };
}

const STEP_START = "step-start";

/** A chat notice as the chat steers one in: another agent's words, which are no task of the developer's. */
const CHAT_NOTICE = "@agent-2 in #teammate-invitations: the invite table is mine, leave it.";

/** A second turn as eve emits it for a line it received while the agent was idle: the line, then a word of answer. */
function answeredTurn(turnId: string, received: string): MessageStreamEvent[] {
  const sequence = 1;
  return [
    stamped({ type: "turn.started", data: { turnId, sequence } }),
    stamped({ type: "message.received", data: { turnId, sequence, message: received } }),
    stamped({ type: "step.started", data: { turnId, sequence, stepIndex: 0, modelId: "m" } }),
    stamped({
      type: "message.completed",
      data: { turnId, sequence, stepIndex: 0, finishReason: "stop", message: "Understood." },
    }),
    stamped({
      type: "step.completed",
      data: { turnId, sequence, stepIndex: 0, finishReason: "stop" },
    }),
    stamped({ type: "turn.completed", data: { turnId, sequence } }),
  ];
}

/** A title model answering every call with one title, keeping the prompt each call was handed. */
function titleModelAnswering(title: string) {
  return new MockLanguageModelV4({
    doGenerate: {
      content: [{ type: "text", text: title }],
      finishReason: { unified: "stop", raw: "stop" },
      usage: {
        inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 1, text: 1, reasoning: 0 },
      },
      warnings: [],
    },
  });
}

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
    Database.use((db) =>
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
    ),
    (rows) =>
      rows[0] === undefined ? undefined : Schema.decodeUnknownSync(TurnRowSchema)(rows[0]),
  );

it.layer(Layer.mergeAll(getTestDB(), noNetwork))("the coding-agent host", (it) => {
  it.effect(
    "a conversation that is no agent's is refused a model, an agent, and a prompt alike",
    () =>
      Effect.gen(function* () {
        const host = yield* hostOverStore();
        const { admitted } = yield* openAgent(host);
        // The same account's other conversation: a task's, which no agent row names.
        const userId = admitted.target.userId;
        const task = yield* startTask(userId, { name: "Billing export" });
        const conversationId = Option.getOrThrow(
          yield* openTaskConversation(userId, task.id),
        ).conversationId;
        const sessionId = mintSession();
        const auth = ownSeat(userId, conversationId);
        const starting = yield* host.admitStarting(auth, sessionId);
        assert.ok(Result.isSuccess(starting));
        yield* host.sessionStarted(starting.success, sessionId);
        const other = yield* host.admit(auth, sessionId);
        assert.ok(Result.isSuccess(other));

        assert.deepEqual(yield* host.agent(other.success), Result.fail(CODER_REFUSAL.NO_AGENT));
        assert.deepEqual(
          yield* host
            .model(other.success, undefined, "turn-fixture")
            .pipe(Effect.provide(modelCatalogOf(CATALOG))),
          Result.fail(CODER_REFUSAL.NO_AGENT),
        );
      }),
  );

  it.effect(
    "a worker asked for on a fast version is refused as no model Luke offers where Anthropic never granted the key's organization fast mode, and recorded on it where Anthropic did",
    () =>
      Effect.gen(function* () {
        const host = yield* hostOverStore();
        const { admitted } = yield* openAgent(host);
        const fast: OfferedModel = { ...OPUS, id: "anthropic/claude-opus-5.5-fast" };
        const catalog = [...CATALOG, fast];
        const asked = { model: fast.id };

        const refused = yield* host
          .delegate(admitted, "call-fast-refused", asked)
          .pipe(Effect.provide(modelCatalogOf(catalog, FAST_ACCESS.NOT_ENABLED)));
        const accepted = yield* host
          .delegate(admitted, "call-fast-accepted", asked)
          .pipe(Effect.provide(modelCatalogOf(catalog, FAST_ACCESS.ENABLED)));

        assert.ok(Result.isFailure(refused));
        assert.match(refused.failure, /is no model Luke offers/u);
        assert.deepEqual(accepted, Result.succeed({ model: fast.id, effort: "high" }));
      }),
  );

  it.effect(
    "an agent started on its plan is titled from the plan as its first turn's words are received, long before the turn ends",
    () =>
      Effect.gen(function* () {
        const { model, asked } = scriptedTitleModel(["Teammate invitations by email"]);
        const host = yield* hostOverStore(model);
        const { agent, userId, sessionId, auth, admitted } = yield* openAgent(host);
        const state = memoryRelayState();
        const session = { id: sessionId, auth, turn: { id: "turn_0" } };
        const [started, received] = codingTurn("turn_0", "turn.completed");
        assert.ok(started && received);
        for (const event of [started, received]) {
          // SAFETY: the relay reads the session's id and auth; eve's turn metadata is not read here.
          yield* host.relay(event, admitted, session as never, state, {});
        }

        const titled = Option.getOrThrow(yield* readCodingAgent(userId, agent.id));
        assert.equal(titled.title, "Teammate invitations by email");
        assert.equal(asked.length, 1);
        assert.match(asked[0] ?? "", /Invite a teammate by email/u);
      }),
  );

  it.effect(
    "an opening the title model names nothing from is asked again as the turn ends, with the answer beside it",
    () =>
      Effect.gen(function* () {
        const { model, asked } = scriptedTitleModel(["", "Read the agent guide"]);
        const host = yield* hostOverStore(model);
        const { agent, userId, sessionId, auth, admitted } = yield* openAgent(host);
        const state = memoryRelayState();
        const session = { id: sessionId, auth, turn: { id: "turn_0" } };
        for (const event of codingTurn("turn_0", "turn.completed")) {
          // SAFETY: the relay reads the session's id and auth; eve's turn metadata is not read here.
          yield* host.relay(event, admitted, session as never, state, {});
        }

        const titled = Option.getOrThrow(yield* readCodingAgent(userId, agent.id));
        assert.equal(titled.title, "Read the agent guide");
        assert.equal(asked.length, 2);
        assert.match(asked[1] ?? "", /The guide is read; the plan fits the code\./u);
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
    "an agent's notes are taken into its plan together or not at all, a miss answering the plan as it stands to retry from, and read back in the plan",
    () =>
      Effect.gen(function* () {
        const host = yield* hostOverStore();
        const { userId, agent, admitted } = yield* openAgent(host);
        assert.ok(agent.taskId !== null);
        const before = Option.getOrThrow(yield* readTask(userId, agent.taskId));
        const notes = [
          {
            kind: "add",
            section: "Open questions",
            text: "- Who may withdraw an invite? Going on as: the member who sent it.",
          },
          { kind: "add", section: "Approach", text: "- Invites expire after 7 days." },
        ];

        const missed = yield* host.editPlan(
          admitted,
          unparsedWire({
            notes: [...notes, { kind: "replace", find: "a phrase the plan never held", text: "x" }],
          }),
          0,
          noSandbox,
        );

        assert.deepEqual(missed, {
          status: ACTION_RESULT_STATUS.REJECTED,
          reason: PLAN_EDIT_REFUSAL.CONFLICT,
          missed: "replace a phrase the plan never held",
          current: before.text,
        });
        const untouched = Option.getOrThrow(yield* readTask(userId, agent.taskId));
        assert.equal(untouched.text, before.text);
        assert.deepEqual(untouched.agentEdits, []);

        const answer = yield* host.editPlan(admitted, unparsedWire({ notes }), 0, noSandbox);

        assert.deepEqual(answer, { status: ACTION_RESULT_STATUS.ACCEPTED, taken: 2 });
        const stored = Option.getOrThrow(yield* readTask(userId, agent.taskId));
        const sectionText = (heading: string) =>
          planSections(stored.text).find((section) => section.heading === heading)?.text ?? "";
        assert.ok(
          sectionText("Open questions").endsWith(
            "\n\n- Who may withdraw an invite? Going on as: the member who sent it.",
          ),
        );
        assert.ok(sectionText("Approach").endsWith("\n\n- Invites expire after 7 days."));
        assert.equal(stored.task.document.body, stored.text);
        // The save is journaled as the agent's, with the notes that were taken and the agent named by its row.
        const at = yield* Clock.currentTimeMillis;
        assert.deepEqual(stored.task.agentEdits, [{ agentId: agent.id, label: agent.model, at }]);
        assert.deepEqual(
          stored.agentEdits.map((edit) => edit.notes.map((note) => note.kind)),
          [["add", "add"]],
        );
      }),
  );

  it.effect(
    "an agent's look at a picture of its plan answers the picture, and the transcript keeps only that it looked",
    () =>
      Effect.gen(function* () {
        const host = yield* hostOverStore();
        const { userId, agent, target, auth, sessionId, admitted } = yield* openAgent(host);
        assert.ok(agent.taskId !== null);
        const picture = {
          contentType: PICTURE_TYPE.PNG,
          bytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 4, 2]),
        };
        const kept = yield* keepPlanAttachment(userId, agent.taskId, picture);
        if (kept.status !== PLAN_ATTACHMENT_KEEP.KEPT) return assert.fail("no picture was kept");
        const ref = { taskId: agent.taskId, attachmentId: kept.id };
        const input = { address: planAttachmentAddress(ref, "acme") };

        const answer = yield* host.lookAtPicture(admitted, unparsedWire(input));
        assert.equal(answer.status, PICTURE_LOOK_STATUS.LOOKED);
        if (answer.status !== PICTURE_LOOK_STATUS.LOOKED) return;
        assert.equal(answer.image, Base64.encode(picture.bytes));

        const call = { callId: "call-look", toolName: CODER_TOOL.LOOK_AT_PICTURE };
        const at = { turnId: "turn_0", sequence: 0, stepIndex: 0 };
        const events: MessageStreamEvent[] = [
          stamped({ type: "turn.started", data: { turnId: "turn_0", sequence: 0 } }),
          stamped({ type: "step.started", data: { ...at, modelId: "m" } }),
          stamped({
            type: "actions.requested",
            data: { ...at, actions: [{ kind: "tool-call", ...call, input }] },
          }),
          stamped({
            type: "action.result",
            data: {
              ...at,
              status: "completed",
              result: { kind: "tool-result", ...call, output: { ...answer } },
            },
          }),
          stamped({ type: "step.completed", data: { ...at, finishReason: "tool-calls" } }),
          stamped({ type: "turn.completed", data: { turnId: "turn_0", sequence: 0 } }),
        ];
        const state = memoryRelayState();
        const session = { id: sessionId, auth, turn: { id: "turn_0" } };
        for (const event of events) {
          // SAFETY: the relay reads the session's id and auth; eve's turn metadata is not read here.
          yield* host.relay(event, admitted, session as never, state, {});
        }

        const page = yield* transcriptPast(target, CODER_TOOL_SET, CURSOR_START, agent).pipe(
          Effect.provide(modelCatalogOf(CATALOG)),
        );
        const look = page.messages.flatMap((message) => message.parts).find(isToolUIPart);
        assert.ok(look);
        assert.equal(look.state, TOOL_PART_STATE.OUTPUT_AVAILABLE);
        assert.deepEqual(look.output, { status: PICTURE_LOOK_STATUS.LOOKED });
        assert.equal(JSON.stringify(page).includes(answer.image), false);
      }),
  );

  it.effect(
    "the turn-end stop is told an agent's sandbox is held while a developer's terminal lease reaches past now, and not once it lapsed",
    () =>
      Effect.gen(function* () {
        const host = yield* hostOverStore();
        const held = yield* openAgent(host);
        const lapsed = yield* openAgent(host);
        const untouched = yield* openAgent(host);
        yield* holdSandbox(held.target.conversationId, new Date(NOW + 60_000));
        yield* holdSandbox(lapsed.target.conversationId, new Date(NOW - 1));

        assert.equal(yield* host.sandboxHeld(held.admitted), true);
        assert.equal(yield* host.sandboxHeld(lapsed.admitted), false);
        assert.equal(yield* host.sandboxHeld(untouched.admitted), false);
      }),
  );

  it.effect(
    "show_image keeps an agent's pictures beside its own transcript, and a worker's beside the worker's",
    () =>
      Effect.gen(function* () {
        const host = yield* hostOverStore();
        const { target, auth, admitted } = yield* openAgent(host);
        const header = new Uint8Array(33);
        header.set([
          0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52,
        ]);
        new DataView(header.buffer).setUint32(16, 1200);
        new DataView(header.buffer).setUint32(20, 720);
        const sandbox = () =>
          Promise.resolve({
            readFile: () =>
              Promise.resolve(
                new ReadableStream<Uint8Array>({
                  start(controller) {
                    controller.enqueue(header);
                    controller.close();
                  },
                }),
              ),
          });
        const input = unparsedWire({ images: [{ path: "shot.png", caption: "Members page" }] });
        const shownId = (answer: WireRecord) => {
          const read = Schema.decodeUnknownSync(
            Schema.Struct({ pictures: Schema.Tuple([Schema.Struct({ id: Schema.String })]) }),
          )(answer);
          return read.pictures[0].id;
        };
        const workerCall = "call-worker";
        const child = childConversationId(target.conversationId, workerCall);
        const db = yield* Database;
        yield* db.insert(conversations).values({
          id: child,
          userId: target.userId,
          kind: CONVERSATION_KIND.CHILD,
          parentConversationId: target.conversationId,
        });
        const turn = { id: "turn_0", sequence: 0 };
        const worker = {
          id: mintSession(),
          auth,
          turn,
          parent: { callId: workerCall, rootSessionId: "root", sessionId: "root", turn },
        };

        const agentPicture = shownId(yield* host.showImage(admitted, input, sandbox));
        const workerPicture = shownId(yield* host.showDelegatedImage(worker, input, sandbox));

        assert.ok(
          Option.isSome(yield* readConversationPicture(target.conversationId, agentPicture)),
        );
        assert.ok(Option.isSome(yield* readConversationPicture(child, workerPicture)));
        assert.deepEqual(
          yield* readConversationPicture(target.conversationId, workerPicture),
          Option.none(),
          "a worker's picture is its own transcript's",
        );
      }),
  );

  it.effect(
    "a chat notice steered into an agent is taken into the turn that received it as the chat's line, and the agent's title is named from the developer's words alone",
    () =>
      Effect.gen(function* () {
        const host = yield* hostOverStore();
        const { userId, agent, target, auth, sessionId, admitted } = yield* openAgent(host);
        const state = memoryRelayState();
        const prompt = yield* composedPrompt(host, admitted, agent);
        const relayed = (turnId: string, events: readonly MessageStreamEvent[]) =>
          Effect.forEach(events, (event) =>
            // SAFETY: the relay reads the session's id and auth; eve's turn metadata is not read here.
            host.relay(
              event,
              admitted,
              { id: sessionId, auth, turn: { id: turnId } } as never,
              state,
              {
                hash: prompt.hash,
              },
            ),
          );
        yield* relayed("turn_0", codingTurn("turn_0", "turn.completed"));
        const writer = yield* storeWriter({ tools: CODER_TOOL_SET });
        const notice = {
          author: MESSAGE_AUTHOR.AGENT,
          channel: MESSAGE_CHANNEL.CHAT,
          chat_seq: 41,
          from: "agent-2",
        } as const;
        const written = yield* writer.writeAwaitingLine(
          target,
          {
            text: CHAT_NOTICE,
            clientKey: "chat-notice-41",
            sender: { kind: MESSAGE_SENDER.AGENT, name: "agent-2" },
            metadata: notice,
          },
          Effect.succeed(true),
        );
        assert.ok(Result.isSuccess(written) && Option.isSome(written.success));
        yield* relayed("turn_1", answeredTurn("turn_1", CHAT_NOTICE));

        const page = yield* transcriptPast(target, CODER_TOOL_SET, CURSOR_START, agent).pipe(
          Effect.provide(modelCatalogOf(CATALOG)),
        );
        const said = page.messages.flatMap((message) =>
          message.role === MESSAGE_ROLE.USER ? [message.metadata] : [],
        );
        assert.deepEqual(said, [
          { author: MESSAGE_AUTHOR.DEVELOPER, channel: MESSAGE_CHANNEL.TYPED },
          notice,
        ]);

        const model = titleModelAnswering("Teammate invitations by email");
        yield* titleCodingAgent(model, target, agent);
        const asked = JSON.stringify(model.doGenerateCalls.map((call) => call.prompt));
        assert.ok(asked.includes("Invite a teammate by email."));
        assert.ok(!asked.includes("the invite table is mine"));
        const titled = Option.getOrThrow(yield* readCodingAgent(userId, agent.id));
        assert.equal(titled.title, "Teammate invitations by email");
      }),
  );

  it.effect(
    "a planless agent reaches its chat through the host, its own channel its workspace's general one",
    () =>
      Effect.gen(function* () {
        const host = yield* hostOverStore();
        const { userId, agent, admitted } = yield* openAgent(host);
        yield* chatOn(userId);
        const db = yield* Database;
        yield* db.update(codingAgent).set({ taskId: null }).where(eq(codingAgent.id, agent.id));
        const read = yield* host
          .chat(admitted, { tool: CHAT_TOOL.READ, input: unparsedWire({}) })
          .pipe(Effect.provide(reachingRelay()));
        assert.ok("channels" in read, JSON.stringify(read));
        assert.deepEqual(
          read.channels.map((channel) => channel.name),
          ["#general"],
        );
      }),
  );

  it.effect(
    "chat is off for an agent whose starter never turned it on: its tools are not offered and a call is refused; once turned on, they are offered and answer",
    () =>
      Effect.gen(function* () {
        const host = yield* hostOverStore();
        const { userId, admitted } = yield* openAgent(host);
        const read = () =>
          host
            .chat(admitted, { tool: CHAT_TOOL.READ, input: unparsedWire({}) })
            .pipe(Effect.provide(reachingRelay()));
        assert.equal(yield* host.chatOffered(admitted, { chatOn: true }), false);
        assert.deepEqual(yield* read(), {
          status: ACTION_RESULT_STATUS.REJECTED,
          reason: CHAT_TOOL_REFUSAL.OFF,
        });
        yield* chatOn(userId);
        assert.equal(yield* host.chatOffered(admitted, { chatOn: true }), true);
        // A session started before Chat was on was told nothing of it, so it is offered no chat tool.
        assert.equal(yield* host.chatOffered(admitted, { chatOn: false }), false);
        assert.equal(yield* host.chatOffered(admitted, {}), false);
        const answered = yield* read();
        assert.equal(answered.status, ACTION_RESULT_STATUS.ACCEPTED);
      }),
  );

  it.effect(
    "a post from an archived agent, or from one on an archived task, is refused without stamping it as having left, so once brought back it posts again",
    () =>
      Effect.gen(function* () {
        const host = yield* hostOverStore();
        const post = (admitted: Parameters<CoderHost["chat"]>[0]) =>
          host
            .chat(admitted, {
              tool: CHAT_TOOL.POST,
              input: unparsedWire({ text: "Still here." }),
              clientKey: "call-left",
              postsInTurn: 0,
              sandbox: () => Promise.reject(new Error("the sandbox was opened")),
            })
            .pipe(Effect.provide(reachingRelay()));
        const stamped = (userId: string, agentId: string) =>
          Effect.gen(function* () {
            const workspace = Option.getOrThrow(yield* agentWorkspace(userId, agentId));
            const members = yield* roster(userId, workspace);
            return members.some((member) => member.agentId === agentId && member.leftAt !== null);
          });
        const refused = { status: ACTION_RESULT_STATUS.REJECTED, reason: CHAT_TOOL_REFUSAL.LEFT };

        const archived = yield* openAgent(host);
        yield* chatOn(archived.userId);
        yield* archiveCodingAgent(archived.userId, archived.agent.id, true);
        assert.deepEqual(yield* post(archived.admitted), refused);
        assert.equal(yield* stamped(archived.userId, archived.agent.id), false);
        yield* archiveCodingAgent(archived.userId, archived.agent.id, false);
        assert.notDeepEqual(yield* post(archived.admitted), refused, "brought back, it posts");

        const onArchivedTask = yield* openAgent(host);
        yield* chatOn(onArchivedTask.userId);
        const taskId = onArchivedTask.agent.taskId ?? "";
        yield* updateTask(onArchivedTask.userId, taskId, { archived: true });
        assert.deepEqual(yield* post(onArchivedTask.admitted), refused);
        assert.equal(yield* stamped(onArchivedTask.userId, onArchivedTask.agent.id), false);
        yield* updateTask(onArchivedTask.userId, taskId, { archived: false });
        assert.notDeepEqual(
          yield* post(onArchivedTask.admitted),
          refused,
          "brought back, it posts",
        );
      }),
  );

  it.effect(
    "a chat post lands where the deployment names no secret or no origin for eve, the members it addresses left to read it next",
    () =>
      Effect.gen(function* () {
        const host = yield* hostOverStore();
        const { userId, admitted } = yield* openAgent(host);
        yield* chatOn(userId);
        const posted = yield* host
          .chat(admitted, {
            tool: CHAT_TOOL.POST,
            input: unparsedWire({ text: "Taking the invite table." }),
            clientKey: "call-1",
            postsInTurn: 0,
            sandbox: () => Promise.reject(new Error("the sandbox was opened")),
          })
          .pipe(Effect.provide(reachingRelay()));
        assert.equal(posted.status, ACTION_RESULT_STATUS.ACCEPTED);
        const read = yield* host
          .chat(admitted, { tool: CHAT_TOOL.READ, input: unparsedWire({}) })
          .pipe(Effect.provide(reachingRelay()));
        assert.ok("channels" in read);
        assert.deepEqual(
          read.channels.map((channel) => channel.name),
          ["#teammate-invitations"],
        );
      }),
  );
});
