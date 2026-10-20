import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { writeAccountPreferences } from "@luke/database/models/account-store";
import { askRecord } from "@luke/database/models/asks";
import {
  agentWorkspace,
  ensureGeneral,
  ensureMember,
  postMessage,
  roster,
} from "@luke/database/models/chat-store";
import { fillChildTitle } from "@luke/database/models/child-titles";
import {
  archiveCodingAgent,
  type CodingAgentBriefText,
  createCodingAgent,
  delegationsOf,
  fillCodingAgentTitle,
  hasRepository,
  latestTurnsOf,
  readCodingAgent,
  writeDelegation,
} from "@luke/database/models/coding-agent-store";
import { readConversationPicture } from "@luke/database/models/conversation-pictures";
import { childConversationId, hostTurnId } from "@luke/database/models/ids";
import { keepPlanAttachment, PLAN_ATTACHMENT_KEEP } from "@luke/database/models/plan-attachments";
import { holdSandbox } from "@luke/database/models/sandbox-terminal-lease";
import { openTaskConversation, readTask, updateTask } from "@luke/database/models/task-store";
import { type ConversationTarget, storeWriter } from "@luke/database/models/writer";
import { codingAgent } from "@luke/database/schemas/coding-agent";
import { conversations, messages, turns } from "@luke/database/schemas/storage";
import { CONVERSATION_KIND, MESSAGE_SENDER } from "@luke/database/storage-vocabulary";
import { getTestDB, joinWorkspace, leaveWorkspace, startTask } from "@luke/database/testing";
import { ACCOUNT_CHAT_REASON } from "@luke/features/account-inbox-wire";
import { CHAT_BLOCK, CHAT_TOOL, MEMBER_KIND } from "@luke/features/chat-wire";
import { CODING_AGENT_STATUS } from "@luke/features/coding-agent-wire";
import {
  INBOX_ASK,
  INBOX_ASK_STATUS,
  INBOX_CURSOR_START,
  INBOX_STATUS,
  INBOX_TOOL,
} from "@luke/features/inbox-wire";
import { agentTranscriptLiveRowsSchema } from "@luke/features/live-wire";
import { MENTION_KIND, mentionMarkdown } from "@luke/features/mention-link";
import { MODEL_PROVIDER } from "@luke/features/models-wire";
import { PICTURE_TYPE } from "@luke/features/picture-wire";
import { planAttachmentAddress } from "@luke/features/plan-attachment-link";
import { planSections } from "@luke/features/plan-document";
import { PLAN_HEADING } from "@luke/features/plan-template";
import { FAST_ACCESS } from "@luke/features/provider-key-wire";
import { EXPERIMENT } from "@luke/settings";
import { noNetwork } from "@luke/wire/testing";
import { isReasoningUIPart, isTextUIPart, isToolUIPart, type LanguageModel } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { eq } from "drizzle-orm";
import { Clock, Duration, Effect, Layer, Option, Redacted, Result, Schema } from "effect";
import { Base64 } from "effect/encoding";
import { SqlClient } from "effect/sql";
import { TestClock } from "effect/testing";
import type { MessageStreamEvent } from "eve/client";
import type { SessionAuth, SessionAuthContext } from "eve/context";
import type { SandboxNetworkPolicy } from "eve/sandbox";
import {
  ACTION_RESULT_STATUS,
  ASK_ORIGIN,
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
import { saveNotes } from "../../tasks/plan-notes.js";
import { stampedEveEvent } from "../../testing/eve-events.js";
import { githubReaching, openGithubUser } from "../../testing/github-app-fake.js";
import { added } from "../../testing/task-contents.js";
import {
  BRAIN_HOST_ATTRIBUTE,
  BRAIN_HOST_AUTHENTICATOR,
  BRAIN_HOST_DEPLOYMENT_PRINCIPAL,
  BRAIN_HOST_PRINCIPAL_TYPE,
  BRAIN_HOST_REFUSAL,
  BRAIN_HOST_TURN,
} from "../brain-host/bounds.js";
import { memoryRelayState } from "../brain-host/relay.js";
import type { RepositorySandbox } from "../repository-shell.js";
import { CODER, CODER_REFUSAL } from "./bounds.js";
import { CHAT_DIGEST_HEADING, CHAT_TOOL_REFUSAL } from "./chat.js";
import { type CoderHost, coderHost } from "./host.js";
import type { InboxSandboxDoor } from "./inbox-image.js";
import { accountInboxPast } from "./inbox-page.js";
import type { ProviderKeys } from "./model.js";
import { PLAN_EDIT_REFUSAL } from "./plan-edit.js";
import type { CoderHostSeams } from "./production.js";
import { codingAgentStatusOf } from "./status.js";
import { titleCodingAgent } from "./title.js";
import { CODER_TOOL, CODER_TOOL_SET, repositoryToolsOf, turnToolsOf } from "./tool-set.js";
import {
  CURSOR_START,
  titleMayLand,
  titleWindowEdge,
  transcriptNow,
  transcriptPast,
} from "./transcript.js";
import { agentFollowedBy, transcriptLiveStatements } from "./transcript-live.js";

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

/** When a turn starts on the relay's clock where a test reads that against the test's own clock, which starts at nothing. */
const TURN_STARTS_AT = 10 * 60_000;

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

/** The host over the test's own store, with the writer composed on the test's client, the title model handed in where a test has one, and its clock, the fixed instant where a test names none. */
const hostOverStore = (titleModel?: LanguageModel, now: () => number = () => NOW) =>
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
      now,
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

/** The voice's seat in the agent's conversation: the deployment acting for the agent's starter, on a spoken turn, as the coder door admits a call's ask. */
function spokenSeat(target: ConversationTarget): SessionAuth {
  const seat: SessionAuthContext = {
    principalId: BRAIN_HOST_DEPLOYMENT_PRINCIPAL,
    principalType: BRAIN_HOST_PRINCIPAL_TYPE.DEPLOYMENT,
    authenticator: BRAIN_HOST_AUTHENTICATOR.DEPLOYMENT,
    attributes: {
      [BRAIN_HOST_ATTRIBUTE.CONVERSATION]: target.conversationId,
      [BRAIN_HOST_ATTRIBUTE.TURN]: BRAIN_HOST_TURN.SPOKEN,
      [BRAIN_HOST_ATTRIBUTE.ACCOUNT]: target.userId,
    },
  };
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
    assert.ok(hasRepository(agent));
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

/** One spoken ask's turn as eve emits it on an agent's session: the ask received, a question queued for the voice, and a sentence of answer. */
function spokenCodingTurn(turnId: string, deliveryIds: readonly string[]): MessageStreamEvent[] {
  const sequence = 0;
  return [
    stampedEveEvent({ type: "turn.started", data: { turnId, sequence } }, NOW, deliveryIds),
    stamped({
      type: "message.received",
      data: { turnId, sequence, message: "The developer asked how far along the invites are." },
    }),
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
            toolName: CODER_TOOL.QUEUE_QUESTION,
            input: {
              question: "Should a withdrawn invite say who withdrew it?",
              recommendation: "No: just say it is no longer valid.",
            },
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
          toolName: CODER_TOOL.QUEUE_QUESTION,
          output: { status: ACTION_RESULT_STATUS.ACCEPTED },
        },
      },
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
        message: "The invite table is built; expiry is next.",
      },
    }),
    stamped({
      type: "step.completed",
      data: { turnId, sequence, stepIndex: 1, finishReason: "stop" },
    }),
    stamped({ type: "turn.completed", data: { turnId, sequence } }),
  ];
}

/**
 * The rest of a typed coding turn as eve emits it once a line steered in
 * after its first step: the line received under the deliveries the turn now
 * carries, a step that answers it and goes back to work, a step of that
 * work, and the end.
 */
function steeredTail(
  turnId: string,
  received: string,
  deliveryIds: readonly string[],
): MessageStreamEvent[] {
  const sequence = 0;
  const step = (stepIndex: number) => ({ turnId, sequence, stepIndex });
  const steered = <Event extends Omit<MessageStreamEvent, "meta">>(event: Event) =>
    stampedEveEvent(event, NOW, deliveryIds);
  return [
    steered({ type: "message.received", data: { turnId, sequence, message: received } }),
    steered({ type: "step.started", data: { ...step(1), modelId: "m" } }),
    steered({
      type: "message.completed",
      data: { ...step(1), finishReason: "tool-calls", message: "The invite table is built." },
    }),
    steered({
      type: "actions.requested",
      data: {
        ...step(1),
        actions: [
          {
            kind: "tool-call",
            callId: "call-2",
            toolName: CODER_TOOL.BASH,
            input: { command: "pnpm test" },
          },
        ],
      },
    }),
    steered({
      type: "action.result",
      data: {
        ...step(1),
        status: "completed",
        result: {
          kind: "tool-result",
          callId: "call-2",
          toolName: CODER_TOOL.BASH,
          output: { status: "completed", exitCode: 0, stdout: "ok\n", stderr: "" },
        },
      },
    }),
    steered({ type: "step.completed", data: { ...step(1), finishReason: "tool-calls" } }),
    steered({ type: "step.started", data: { ...step(2), modelId: "m" } }),
    steered({
      type: "message.completed",
      data: { ...step(2), finishReason: "stop", message: "Expiry is in." },
    }),
    steered({ type: "step.completed", data: { ...step(2), finishReason: "stop" } }),
    steered({ type: "turn.completed", data: { turnId, sequence } }),
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
const CHAT_NOTICE =
  "Chat · [@Invite emails](https://tryluke.dev/acme/agent/7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f) in #teammate-invitations (m 41):\n\nThe invite table is mine, leave it.";

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

/** A transcript's live statements run as Realtime runs them, their rows decoded as the desktop decodes them, each part in an order of its own since Realtime keeps none. */
const liveRowsOf = (
  target: ConversationTarget,
  parentConversationId: string,
  readerId = target.userId,
) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const statements = Option.getOrThrow(
      transcriptLiveStatements(
        target,
        parentConversationId,
        agentFollowedBy(target.userId, parentConversationId, readerId),
      ),
    );
    const rows = yield* Effect.all({
      messages: sql.unsafe(statements.messages.sql, [...statements.messages.params]),
      turns: sql.unsafe(statements.turns.sql, [...statements.turns.params]),
      conversation: sql.unsafe(statements.conversation.sql, [...statements.conversation.params]),
      agent: sql.unsafe(statements.agent.sql, [...statements.agent.params]),
      workers: sql.unsafe(statements.workers.sql, [...statements.workers.params]),
    });
    const decoded = yield* Schema.decodeUnknownEffect(agentTranscriptLiveRowsSchema)(rows);
    return JSON.stringify(
      Object.entries(decoded).map(([part, list]) => [
        part,
        list.map((row) => JSON.stringify(row)).toSorted(),
      ]),
    );
  });

it.layer(Layer.mergeAll(getTestDB(), noNetwork))("the coding-agent host", (it) => {
  it.effect(
    "a line no turn takes after the agent's turn ended holds the read running, which the read says it wakes from once the line's grace ends",
    () =>
      Effect.gen(function* () {
        const host = yield* hostOverStore();
        const { userId, agent, target } = yield* openAgent(host);
        const db = yield* Database;
        const now = yield* Clock.currentTimeMillis;
        yield* db.insert(turns).values({
          userId,
          conversationId: target.conversationId,
          origin: TURN_ORIGIN.TYPED,
          status: TURN_STATUS.SETTLED,
          queuedAt: new Date(now - 60_000),
          settledAt: new Date(now - 30_000),
        });
        const writtenAt = new Date(now - 10_000);
        yield* db.insert(messages).values({
          userId,
          conversationId: target.conversationId,
          seq: 50,
          clientId: randomUUID(),
          role: MESSAGE_ROLE.USER,
          parts: [{ type: "text", text: "Are you there?" }],
          placedAt: writtenAt,
          createdAt: writtenAt,
          turnId: null,
        });
        const read = (cursor: typeof CURSOR_START) =>
          transcriptNow(target, CODER_TOOL_SET, cursor, agent, agent).pipe(
            Effect.provide(modelCatalogOf(CATALOG)),
          );
        const first = yield* read(CURSOR_START);
        const past = yield* read(first.page.cursor);

        assert.equal(past.page.status, CODING_AGENT_STATUS.RUNNING);
        assert.equal(past.holds, true);
        assert.equal(
          past.wakeIn,
          writtenAt.getTime() + Duration.toMillis(CODER.LINE_GRACE) + 1 - now,
        );
      }),
  );

  it.effect(
    "a transcript's live statements move at every write a page past the reader's cursor says something of, the agent's own and a worker's alike, and hold nothing for an account outside the agent's workspace, nor for a member once removed",
    () =>
      Effect.gen(function* () {
        const host = yield* hostOverStore();
        const { userId, agent, target, auth, sessionId, admitted } = yield* openAgent(host);
        const state = memoryRelayState();
        const prompt = yield* composedPrompt(host, admitted, agent);
        const parent = target.conversationId;
        const now = (cursor: typeof CURSOR_START) =>
          transcriptNow(target, CODER_TOOL_SET, cursor, agent, agent).pipe(
            Effect.provide(modelCatalogOf(CATALOG)),
          );

        let cursor = CURSOR_START;
        let read = yield* now(cursor);
        let rows = yield* liveRowsOf(target, parent);
        // Before its first turn the agent is starting, which only the clock ends: the read says when.
        assert.equal(read.page.status, CODING_AGENT_STATUS.STARTING);
        assert.equal(read.holds, true);
        assert.equal(
          read.wakeIn,
          agent.createdAt.getTime() +
            Duration.toMillis(CODER.STARTING_GRACE) +
            1 -
            (yield* Clock.currentTimeMillis),
        );
        let said = 0;
        for (const event of codingTurn("turn_0", "turn.completed")) {
          // SAFETY: the relay reads the session's id and auth; eve's turn metadata is not read here.
          yield* host.relay(
            event,
            admitted,
            { id: sessionId, auth, turn: { id: "turn_0" } } as never,
            state,
            {
              hash: prompt.hash,
            },
          );
          const next = yield* now(cursor);
          const moved = yield* liveRowsOf(target, parent);
          if (next.page.messages.length > 0 || next.page.status !== read.page.status) {
            said += 1;
            assert.notEqual(moved, rows, `the statements move with ${event.type}`);
          }
          // Note that a page with nothing past the cursor holds while the turn runs, and not once it ended.
          if (next.page.messages.length === 0) {
            assert.equal(next.holds, next.page.status === CODING_AGENT_STATUS.RUNNING);
          }
          cursor = next.page.cursor;
          read = next;
          rows = moved;
        }
        assert.ok(said > 2, "the turn said something more than once");
        assert.equal(read.page.status, CODING_AGENT_STATUS.COMPLETED);

        // Ended and untitled, the read holds on the title, until its window closes with the clock.
        const ended = (yield* latestTurnsOf(userId, [parent])).get(parent)?.settledAt;
        assert.ok(ended);
        const awaiting = yield* transcriptNow(
          target,
          CODER_TOOL_SET,
          cursor,
          agent,
          agent,
          titleMayLand(target),
          titleWindowEdge(target),
        ).pipe(Effect.provide(modelCatalogOf(CATALOG)));
        assert.equal(awaiting.holds, true);
        assert.equal(awaiting.wakeIn, ended.getTime() + 20_001 - (yield* Clock.currentTimeMillis));

        // A title landing is heard on the agent's own transcript.
        assert.equal(yield* fillCodingAgentTitle(userId, agent.id, "Teammate invitations"), true);
        const titled = yield* liveRowsOf(target, parent);
        assert.notEqual(titled, rows);

        // A worker's delegation being recorded and its title landing are heard on its transcript and the agent's.
        const workerCall = "call-worker";
        const child = childConversationId(parent, workerCall);
        const db = yield* Database;
        yield* db.insert(conversations).values({
          id: child,
          userId,
          kind: CONVERSATION_KIND.CHILD,
          parentConversationId: parent,
        });
        const worker = { userId, conversationId: child };
        const opened = yield* liveRowsOf(worker, parent);
        yield* writeDelegation(child, workerCall, { model: agent.model, effort: agent.effort });
        const delegated = yield* liveRowsOf(worker, parent);
        assert.notEqual(delegated, opened);
        // An untitled worker's read waits on its title until the window opened at its start closes.
        const [recorded] = yield* delegationsOf(target);
        assert.equal(recorded?.childConversationId, child);
        assert.equal(
          yield* titleWindowEdge(target, child),
          (recorded?.createdAt.getTime() ?? 0) + 20_001,
        );
        const ownBefore = yield* liveRowsOf(target, parent);
        assert.equal(yield* fillChildTitle(target, child, "Invite expiry"), true);
        assert.notEqual(yield* liveRowsOf(worker, parent), delegated);
        assert.notEqual(yield* liveRowsOf(target, parent), ownBefore);

        // Another account's statements over the same conversations read nothing of them.
        const stranger = yield* openGithubUser();
        const nothing = JSON.stringify([
          ["messages", [JSON.stringify({ rows: 0, seq: 0 })]],
          ["turns", []],
          ["conversation", []],
          ["agent", []],
          ["workers", []],
        ]);
        assert.equal(
          yield* liveRowsOf({ userId: stranger, conversationId: parent }, parent),
          nothing,
        );
        assert.equal(
          yield* liveRowsOf({ userId: stranger, conversationId: child }, parent),
          nothing,
        );

        // A member of the agent's workspace follows the owner's rows, an outsider nothing, and a member taken out stops at once.
        const owned = yield* liveRowsOf(target, parent);
        assert.equal(yield* liveRowsOf(target, parent, stranger), nothing);
        yield* joinWorkspace(agent.organizationId, stranger);
        assert.equal(yield* liveRowsOf(target, parent, stranger), owned);
        yield* leaveWorkspace(agent.organizationId, stranger);
        assert.equal(yield* liveRowsOf(target, parent, stranger), nothing);
      }),
  );

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
    "an agent with no repository runs: its sandbox opens on an empty working folder with nothing at the firewall, its session tells of no checkout or pull request, and it is offered none of the repository's tools",
    () =>
      Effect.gen(function* () {
        const host = yield* hostOverStore();
        const userId = yield* openGithubUser();
        const task = yield* startTask(userId, { name: "Talk it over" });
        const { agent } = Option.getOrThrow(
          yield* createCodingAgent(userId, {
            taskId: task.id,
            idempotencyKey: "start-blank",
            model: "anthropic/claude-opus-5.5",
            effort: "high",
            planSnapshot: null,
            prompt: null,
            repository: null,
          }),
        );
        const sessionId = mintSession();
        const auth = ownSeat(userId, agent.conversationId);
        const starting = yield* host.admitStarting(auth, sessionId);
        assert.ok(Result.isSuccess(starting));
        yield* host.sessionStarted(starting.success, sessionId);
        const admitted = yield* host.admit(auth, sessionId);
        assert.ok(Result.isSuccess(admitted));
        const found = yield* host.agent(admitted.success);
        assert.ok(Result.isSuccess(found));
        // A sandbox writing down each command it ran, in the directory it ran it in, and each firewall policy set.
        const ran: string[] = [];
        const policies: SandboxNetworkPolicy[] = [];
        const sandbox: RepositorySandbox = {
          run: (run) => {
            ran.push(`${run.workingDirectory ?? ""}: ${run.command}`);
            return Promise.resolve({ exitCode: 0, stdout: "", stderr: "" });
          },
          setNetworkPolicy: (policy) => {
            policies.push(policy);
            return Promise.resolve();
          },
        };

        const credential = yield* host
          .checkOut(admitted.success, sandbox)
          .pipe(Effect.provide(reachingRelay()));
        const renewed = yield* host
          .repositoryCredential(admitted.success)
          .pipe(Effect.provide(reachingRelay()));
        const prompt = yield* composedPrompt(host, admitted.success, found.success);
        const skills = yield* host
          .skills(admitted.success, found.success)
          .pipe(Effect.provide(reachingRelay()));
        const model = yield* host
          .model(admitted.success, undefined, "turn-fixture")
          .pipe(Effect.provide(modelCatalogOf(CATALOG)));

        assert.equal(credential, undefined);
        assert.equal(renewed, undefined);
        assert.deepEqual(ran, ["/workspace: mkdir -p /workspace/repository"]);
        assert.deepEqual(policies, []);
        assert.deepEqual(skills, []);
        assert.ok(Result.isSuccess(model));
        assert.match(prompt.text, /You work in no repository/u);
        for (const absent of [
          "## The checkout",
          CODER_TOOL.OPEN_PULL_REQUEST,
          CODER_TOOL.APPLY_PATCH,
          CODER_TOOL.WRITE_FILE,
          "Co-authored-by",
          "gh pr checks",
        ]) {
          assert.ok(!prompt.text.includes(absent), absent);
        }
        assert.deepEqual([...repositoryToolsOf(found.success)], []);
        assert.deepEqual(
          yield* host
            .openPullRequest(
              admitted.success,
              unparsedWire({ head: "luke/x", title: "x", body: "" }),
            )
            .pipe(Effect.provide(reachingRelay())),
          { status: ACTION_RESULT_STATUS.REJECTED, reason: CODER_REFUSAL.NO_REPOSITORY },
        );
      }),
  );

  it.effect(
    "an agent with a repository is offered its pull request and the tools that write into its checkout",
    () =>
      Effect.gen(function* () {
        const { agent } = yield* unclaimedAgent();
        assert.deepEqual(
          [...repositoryToolsOf(agent)].sort(),
          [CODER_TOOL.APPLY_PATCH, CODER_TOOL.OPEN_PULL_REQUEST, CODER_TOOL.WRITE_FILE].sort(),
        );
      }),
  );

  it.effect(
    "a session opened afresh after the agent's last one retired claims the conversation, the retired one is refused, and the fresh one is seeded with what was said, the line it opens with left out",
    () =>
      Effect.gen(function* () {
        const host = yield* hostOverStore();
        const { userId, target, auth, sessionId, admitted } = yield* openAgent(host);
        const state = memoryRelayState();
        const session = { id: sessionId, auth, turn: { id: "turn_0" } };
        for (const event of codingTurn("turn_0", "turn.completed")) {
          // SAFETY: the relay reads the session's id and auth; eve's turn metadata is not read here.
          yield* host.relay(event, admitted, session as never, state, {});
        }
        const writer = yield* storeWriter({ tools: CODER_TOOL_SET });
        yield* writer.writeAwaitingLine(
          target,
          {
            text: "Now send the invitation from the settings page.",
            clientKey: "after-retirement",
            sender: { kind: MESSAGE_SENDER.MEMBER, userId },
          },
          Effect.succeed(true),
        );

        const fresh = mintSession();
        const starting = yield* host.admitStarting(auth, fresh);
        assert.ok(Result.isSuccess(starting));
        const seed = yield* host.seed(starting.success);
        assert.equal(yield* host.sessionStarted(starting.success, fresh), true);

        assert.deepEqual(
          yield* host.admit(auth, sessionId),
          Result.fail(BRAIN_HOST_REFUSAL.NOT_CURRENT_SESSION),
        );
        assert.ok(Result.isSuccess(yield* host.admit(auth, fresh)));
        assert.ok(seed !== undefined);
        assert.match(seed, /Invite a teammate by email/u);
        assert.match(seed, /The guide is read; the plan fits the code\./u);
        assert.ok(!seed.includes("settings page"), seed);
      }),
  );

  it.effect(
    "an agent's first session, over a conversation with nothing said, is seeded with nothing",
    () =>
      Effect.gen(function* () {
        const host = yield* hostOverStore();
        const { starting } = yield* openAgent(host);
        assert.equal(yield* host.seed(starting), undefined);
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
    "an opening the title model names nothing from is asked again as a failed turn ends, so an agent whose first turn fails is still named",
    () =>
      Effect.gen(function* () {
        const { model, asked } = scriptedTitleModel(["", "Read the agent guide"]);
        const host = yield* hostOverStore(model);
        const { agent, userId, sessionId, auth, admitted } = yield* openAgent(host);
        const state = memoryRelayState();
        const session = { id: sessionId, auth, turn: { id: "turn_0" } };
        for (const event of codingTurn("turn_0", "turn.failed")) {
          // SAFETY: the relay reads the session's id and auth; eve's turn metadata is not read here.
          yield* host.relay(event, admitted, session as never, state, {});
        }

        const titled = Option.getOrThrow(yield* readCodingAgent(userId, agent.id));
        assert.equal(titled.title, "Read the agent guide");
        assert.equal(asked.length, 2);
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
    "an agent handed a prompt on a task takes notes on its plan, as New task starts every agent",
    () =>
      Effect.gen(function* () {
        const host = yield* hostOverStore();
        const brief = { planSnapshot: null, prompt: "Let invites expire." } as const;
        const { userId, agent, admitted } = yield* openAgent(host, undefined, undefined, brief);
        assert.ok(agent.taskId !== null);
        const note = { kind: "add", section: "Approach", text: "- Invites expire after 7 days." };

        const answer = yield* host.editPlan(
          admitted,
          unparsedWire({ notes: [note] }),
          0,
          noSandbox,
        );

        assert.deepEqual(answer, { status: ACTION_RESULT_STATUS.ACCEPTED, taken: 1 });
        const stored = Option.getOrThrow(yield* readTask(userId, agent.taskId));
        assert.deepEqual(
          stored.agentEdits.map((edit) => edit.agentId),
          [agent.id],
        );
        assert.ok(stored.text.includes("- Invites expire after 7 days."));
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
    "an agent's inbox calls run under its session: a post opens a thread, withdraw_ask settles its ask, and read_inbox reads it back",
    () =>
      Effect.gen(function* () {
        const host = yield* hostOverStore();
        const { admitted } = yield* openAgent(host);
        const post = {
          key: "region",
          title: "Which region?",
          body: "Both cost the same.",
          ask: { type: INBOX_ASK.DECIDE, options: [{ label: "iad1" }, { label: "fra1" }] },
        };

        const posted = yield* host.inbox(admitted, {
          tool: INBOX_TOOL.POST,
          input: unparsedWire(post),
          sandbox: noSandbox,
        });
        assert.equal(posted.status, ACTION_RESULT_STATUS.ACCEPTED);
        const withdrawn = yield* host.inbox(admitted, {
          tool: INBOX_TOOL.WITHDRAW,
          input: unparsedWire({ key: "region", reason: "Picked iad1." }),
        });
        assert.equal(withdrawn.status, ACTION_RESULT_STATUS.ACCEPTED);
        const read = yield* host.inbox(admitted, {
          tool: INBOX_TOOL.READ,
          input: unparsedWire({}),
        });

        assert.deepEqual(read, {
          status: ACTION_RESULT_STATUS.ACCEPTED,
          inbox: [
            {
              key: "region",
              title: "Which region?",
              status: INBOX_STATUS.CLOSED,
              thread: [
                {
                  from: "you",
                  text: "Both cost the same.",
                  ask: {
                    type: INBOX_ASK.DECIDE,
                    status: INBOX_ASK_STATUS.WITHDRAWN,
                    withdrawnReason: "Picked iad1.",
                  },
                },
              ],
            },
          ],
        });
      }),
  );

  it.effect(
    "a transcript written before the inbox moved to threads still reads its close_inbox_item and reply_inbox calls, which no agent is offered now",
    () =>
      Effect.gen(function* () {
        const host = yield* hostOverStore();
        const { target, auth, sessionId, admitted, agent } = yield* openAgent(host);
        const at = { turnId: "turn_0", sequence: 0, stepIndex: 0 };
        const calls = [
          { callId: "call-reply", toolName: "reply_inbox", input: { key: "k", text: "Done." } },
          {
            callId: "call-close",
            toolName: "close_inbox_item",
            input: { key: "k", reason: "Done." },
          },
        ];
        const events: MessageStreamEvent[] = [
          stamped({ type: "turn.started", data: { turnId: "turn_0", sequence: 0 } }),
          stamped({ type: "step.started", data: { ...at, modelId: "m" } }),
          stamped({
            type: "actions.requested",
            data: { ...at, actions: calls.map((call) => ({ kind: "tool-call", ...call })) },
          }),
          ...calls.map((call) =>
            stamped({
              type: "action.result",
              data: {
                ...at,
                status: "completed",
                result: {
                  kind: "tool-result",
                  callId: call.callId,
                  toolName: call.toolName,
                  output: { status: ACTION_RESULT_STATUS.ACCEPTED, inbox: [] },
                },
              },
            }),
          ),
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
        const parts = page.messages.flatMap((message) => message.parts).filter(isToolUIPart);
        assert.deepEqual(
          parts.map((part) => [part.type, part.state]),
          [
            ["tool-reply_inbox", TOOL_PART_STATE.OUTPUT_AVAILABLE],
            ["tool-close_inbox_item", TOOL_PART_STATE.OUTPUT_AVAILABLE],
          ],
        );
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
          from: "Invite emails",
        } as const;
        const written = yield* writer.writeAwaitingLine(
          target,
          {
            text: CHAT_NOTICE,
            clientKey: "chat-notice-41",
            sender: {
              kind: MESSAGE_SENDER.AGENT,
              agentId: randomUUID(),
              name: "Invite emails",
              model: agent.model,
            },
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
        // The agent's answer to the chat notice speaks to another member, so the title reads its answer to the developer.
        assert.ok(asked.includes("The guide is read; the plan fits the code."));
        assert.ok(!asked.includes("Understood."));
        const titled = Option.getOrThrow(yield* readCodingAgent(userId, agent.id));
        assert.equal(titled.title, "Teammate invitations by email");
      }),
  );

  it.effect(
    "a chat notice steered into the developer's own turn leaves that turn's answer to name the agent from",
    () =>
      Effect.gen(function* () {
        const host = yield* hostOverStore();
        const { agent, target, auth, sessionId, admitted } = yield* openAgent(host);
        const state = memoryRelayState();
        const prompt = yield* composedPrompt(host, admitted, agent);
        const relayed = (events: readonly MessageStreamEvent[]) =>
          Effect.forEach(events, (event) =>
            // SAFETY: the relay reads the session's id and auth; eve's turn metadata is not read here.
            host.relay(
              event,
              admitted,
              { id: sessionId, auth, turn: { id: "turn_0" } } as never,
              state,
              { hash: prompt.hash },
            ),
          );
        const events = codingTurn("turn_0", "turn.completed");
        const steeredAt = events.findIndex((event) => event.type === "reasoning.completed");
        yield* relayed(events.slice(0, steeredAt));
        const writer = yield* storeWriter({ tools: CODER_TOOL_SET });
        yield* writer.writeAwaitingLine(
          target,
          {
            text: CHAT_NOTICE,
            clientKey: "chat-notice-mid-turn",
            sender: { kind: MESSAGE_SENDER.AGENT, name: "Invite emails" },
            metadata: {
              author: MESSAGE_AUTHOR.AGENT,
              channel: MESSAGE_CHANNEL.CHAT,
              chat_seq: 41,
              from: "Invite emails",
            },
          },
          Effect.succeed(true),
        );
        yield* relayed(events.slice(steeredAt));

        const model = titleModelAnswering("Teammate invitations by email");
        yield* titleCodingAgent(model, target, agent);
        const asked = JSON.stringify(model.doGenerateCalls.map((call) => call.prompt));
        assert.ok(asked.includes("The guide is read; the plan fits the code."), asked);
      }),
  );

  it.effect(
    "a title's recent window opening on notices steered into the developer's turn keeps that turn's answer",
    () =>
      Effect.gen(function* () {
        const host = yield* hostOverStore();
        const { agent, target, auth, sessionId, admitted } = yield* openAgent(host);
        const state = memoryRelayState();
        const prompt = yield* composedPrompt(host, admitted, agent);
        const relayed = (events: readonly MessageStreamEvent[]) =>
          Effect.forEach(events, (event) =>
            // SAFETY: the relay reads the session's id and auth; eve's turn metadata is not read here.
            host.relay(
              event,
              admitted,
              { id: sessionId, auth, turn: { id: "turn_0" } } as never,
              state,
              { hash: prompt.hash },
            ),
          );
        const events = codingTurn("turn_0", "turn.completed");
        const steeredAt = events.findIndex((event) => event.type === "reasoning.completed");
        yield* relayed(events.slice(0, steeredAt));
        const writer = yield* storeWriter({ tools: CODER_TOOL_SET });
        // Eight notices steered in leave the developer's line before the recent window of eight.
        yield* Effect.forEach([1, 2, 3, 4, 5, 6, 7, 8], (at) =>
          writer.writeAwaitingLine(
            target,
            {
              text: CHAT_NOTICE,
              clientKey: `chat-notice-steered-${at}`,
              sender: { kind: MESSAGE_SENDER.AGENT, name: "Invite emails" },
              metadata: {
                author: MESSAGE_AUTHOR.AGENT,
                channel: MESSAGE_CHANNEL.CHAT,
                chat_seq: 40 + at,
                from: "Invite emails",
              },
            },
            Effect.succeed(true),
          ),
        );
        yield* relayed(events.slice(steeredAt));

        const model = titleModelAnswering("Teammate invitations by email");
        yield* titleCodingAgent(model, target, agent);
        const asked = JSON.stringify(model.doGenerateCalls.map((call) => call.prompt));
        assert.ok(asked.includes("The guide is read; the plan fits the code."), asked);
      }),
  );

  it.effect("a title's recent window opening on a chat notice leaves the answer to it out", () =>
    Effect.gen(function* () {
      const host = yield* hostOverStore();
      const { agent, target, auth, sessionId, admitted } = yield* openAgent(host);
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
            { hash: prompt.hash },
          ),
        );
      yield* relayed("turn_0", codingTurn("turn_0", "turn.completed"));
      const writer = yield* storeWriter({ tools: CODER_TOOL_SET });
      // The second turn takes five notices in, the third one more, so the recent window of eight opens on a notice.
      const notice = (at: number) =>
        writer.writeAwaitingLine(
          target,
          {
            text: CHAT_NOTICE,
            clientKey: `chat-notice-${at}`,
            sender: { kind: MESSAGE_SENDER.AGENT, name: "Invite emails" },
            metadata: {
              author: MESSAGE_AUTHOR.AGENT,
              channel: MESSAGE_CHANNEL.CHAT,
              chat_seq: 40 + at,
              from: "Invite emails",
            },
          },
          Effect.succeed(true),
        );
      yield* Effect.forEach([1, 2, 3, 4, 5], notice);
      yield* relayed("turn_1", answeredTurn("turn_1", CHAT_NOTICE));
      yield* notice(6);
      yield* relayed("turn_2", answeredTurn("turn_2", CHAT_NOTICE));
      const page = yield* transcriptPast(target, CODER_TOOL_SET, CURSOR_START, agent).pipe(
        Effect.provide(modelCatalogOf(CATALOG)),
      );
      assert.equal(page.messages.length, 10, JSON.stringify(page.messages.map((m) => m.role)));

      const model = titleModelAnswering("Teammate invitations by email");
      yield* titleCodingAgent(model, target, agent);
      const asked = JSON.stringify(model.doGenerateCalls.map((call) => call.prompt));
      assert.ok(asked.includes("Invite a teammate by email."), asked);
      assert.ok(!asked.includes("Understood."), asked);
    }),
  );

  it.effect(
    "a title leaves out the answer to a turn a chat notice opened, though the notices it took in push that notice out of the recent window",
    () =>
      Effect.gen(function* () {
        const host = yield* hostOverStore();
        const { agent, target, auth, sessionId, admitted } = yield* openAgent(host);
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
              { hash: prompt.hash },
            ),
          );
        yield* relayed("turn_0", codingTurn("turn_0", "turn.completed"));
        const writer = yield* storeWriter({ tools: CODER_TOOL_SET });
        const notice = (at: number) =>
          writer.writeAwaitingLine(
            target,
            {
              text: CHAT_NOTICE,
              clientKey: `chat-notice-opening-${at}`,
              sender: { kind: MESSAGE_SENDER.AGENT, name: "Invite emails" },
              metadata: {
                author: MESSAGE_AUTHOR.AGENT,
                channel: MESSAGE_CHANNEL.CHAT,
                chat_seq: 40 + at,
                from: "Invite emails",
              },
            },
            Effect.succeed(true),
          );
        // A notice opens the second turn, and the eight it takes in mid-run leave it before the recent window of eight.
        yield* notice(0);
        const events = answeredTurn("turn_1", CHAT_NOTICE);
        const steeredAt = events.findIndex((event) => event.type === "message.completed");
        yield* relayed("turn_1", events.slice(0, steeredAt));
        yield* Effect.forEach([1, 2, 3, 4, 5, 6, 7, 8], notice);
        yield* relayed("turn_1", events.slice(steeredAt));

        const model = titleModelAnswering("Teammate invitations by email");
        yield* titleCodingAgent(model, target, agent);
        const asked = JSON.stringify(model.doGenerateCalls.map((call) => call.prompt));
        assert.ok(asked.includes("Invite a teammate by email."), asked);
        assert.ok(!asked.includes("Understood."), asked);
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
    "an agent's post mentioning a person tells them through their account's read, which carries who and why",
    () =>
      Effect.gen(function* () {
        const host = yield* hostOverStore();
        const { userId, agent, admitted } = yield* openAgent(host);
        yield* chatOn(userId);
        const workspace = Option.getOrThrow(yield* agentWorkspace(userId, agent.id));
        yield* ensureMember(userId, workspace, { kind: MEMBER_KIND.HUMAN, userId });
        const posted = yield* host
          .chat(admitted, {
            tool: CHAT_TOOL.POST,
            input: unparsedWire({
              text: `${mentionMarkdown({ kind: MENTION_KIND.PERSON, userId }, "Test User", { workspace: "acme", repository: null })} the invite table is yours.`,
            }),
            clientKey: "call-mention",
            postsInTurn: 0,
            sandbox: () => Promise.reject(new Error("the sandbox was opened")),
          })
          .pipe(Effect.provide(reachingRelay()));
        assert.equal(posted.status, ACTION_RESULT_STATUS.ACCEPTED);
        const read = yield* accountInboxPast(userId, INBOX_CURSOR_START);
        assert.deepEqual(
          read.chat?.map(({ reason, workspaceId }) => ({ reason, workspaceId })),
          [{ reason: ACCOUNT_CHAT_REASON.MENTION, workspaceId: workspace }],
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

  it.effect(
    "a turn opens with no chat for an agent whose starter never turned Chat on, and with what it has not read once it is on",
    () =>
      Effect.gen(function* () {
        const host = yield* hostOverStore();
        const { userId, agent, admitted } = yield* openAgent(host);
        const workspace = Option.getOrThrow(yield* agentWorkspace(userId, agent.id));
        const person = Option.getOrThrow(
          yield* ensureMember(userId, workspace, { kind: MEMBER_KIND.HUMAN, userId }),
        );
        const general = Option.getOrThrow(yield* ensureGeneral(userId, workspace));
        // The agent joins before the post, as a member joins the chat at its head.
        yield* ensureMember(userId, workspace, { kind: MEMBER_KIND.AGENT, agentId: agent.id });
        yield* postMessage(userId, workspace, {
          authorMemberId: person.id,
          to: { channelId: general.id },
          blocks: [{ type: CHAT_BLOCK.MARKDOWN, text: "The invite table is mine." }],
          clientKey: "post-1",
        });
        assert.equal(
          yield* host.turnInstructions(admitted, BRAIN_HOST_TURN.TYPED, undefined),
          undefined,
        );
        yield* chatOn(userId);
        const digest =
          (yield* host.turnInstructions(admitted, BRAIN_HOST_TURN.TYPED, undefined)) ?? "";
        assert.ok(digest.startsWith(CHAT_DIGEST_HEADING), digest);
        assert.ok(digest.endsWith("The invite table is mine."), digest);
      }),
  );

  it.effect(
    "a spoken turn opens with the call's words, how to talk the plan through, and the task as it stands, and is offered the call's own tools; a typed turn of a fresh agent opens with none of it and is offered none",
    () =>
      Effect.gen(function* () {
        const host = yield* hostOverStore();
        const { admitted } = yield* openAgent(host);

        const spoken =
          (yield* host.turnInstructions(admitted, BRAIN_HOST_TURN.SPOKEN, undefined)) ?? "";
        for (const told of [
          "## This turn is spoken",
          `\`${CODER_TOOL.QUEUE_QUESTION}\``,
          "## Talking the plan through",
          "[the developer's time]",
          "[saved document]",
          "Name: Teammate invitations",
        ]) {
          assert.ok(spoken.includes(told), told);
        }
        assert.deepEqual(
          [...turnToolsOf(host.turnKind(spokenSeat(admitted.target)))],
          [CODER_TOOL.QUEUE_QUESTION, CODER_TOOL.WITHDRAW_QUESTION, CODER_TOOL.END_CALL],
        );

        assert.equal(
          yield* host.turnInstructions(admitted, BRAIN_HOST_TURN.TYPED, undefined),
          undefined,
        );
        assert.deepEqual(
          [
            ...turnToolsOf(
              host.turnKind(ownSeat(admitted.target.userId, admitted.target.conversationId)),
            ),
          ],
          [],
        );
      }),
  );

  it.effect(
    "a typed turn is handed the task as it stands only once someone other than the agent saved the plan after the agent's previous turn started, even where the agent then wrote over the same section, and never on its first turn or for its own notes",
    () =>
      Effect.gen(function* () {
        // The relay's clock, which stamps when a turn started, stands ten minutes into the test's.
        const host = yield* hostOverStore(undefined, () => TURN_STARTS_AT);
        const { userId, agent, auth, sessionId, admitted } = yield* openAgent(host);
        assert.ok(agent.taskId !== null);
        const binding = { userId, taskId: agent.taskId };
        const typedAt = (eveTurnId: string) =>
          host.turnInstructions(admitted, BRAIN_HOST_TURN.TYPED, hostTurnId(sessionId, eveTurnId));
        const agentNotes = (notes: Parameters<typeof saveNotes>[1]) =>
          Effect.map(
            host.editPlan(admitted, unparsedWire({ notes }), 0, noSandbox),
            (answer) => answer.status,
          );

        // Luke's notes before the agent's first turn: that turn opens on the plan as its first message.
        yield* TestClock.adjust("1 minute");
        yield* saveNotes(binding, [added(PLAN_HEADING.CONTEXT, "Invites go by email.")]);
        assert.equal(yield* typedAt("turn_0"), undefined);
        // The first turn runs, started at the relay's clock, after Luke's notes.
        const session = { id: sessionId, auth, turn: { id: "turn_0" } };
        const state = memoryRelayState();
        for (const event of codingTurn("turn_0", "turn.completed")) {
          // SAFETY: the relay reads the session's id and auth; eve's turn metadata is not read here.
          yield* host.relay(event, admitted, session as never, state, {});
        }
        assert.equal(yield* typedAt("turn_1"), undefined);

        // The agent's own notes after its turn started: it wrote them, so there is nothing new to read.
        yield* TestClock.adjust("10 minutes");
        assert.equal(
          yield* agentNotes([added(PLAN_HEADING.APPROACH, "- Invites expire after 7 days.")]),
          ACTION_RESULT_STATUS.ACCEPTED,
        );
        assert.equal(yield* typedAt("turn_1"), undefined);

        // Luke's notes while that turn ran, and the agent's after them in the same section, which
        // leave the agent the section's last writer: the next typed turn is handed the plan all the same.
        yield* TestClock.adjust("1 minute");
        yield* saveNotes(binding, [
          added(PLAN_HEADING.APPROACH, "- A withdrawn invite never grants access."),
        ]);
        yield* TestClock.adjust("1 minute");
        assert.equal(
          yield* agentNotes([added(PLAN_HEADING.APPROACH, "- Resending renews the link.")]),
          ACTION_RESULT_STATUS.ACCEPTED,
        );
        const handed = (yield* typedAt("turn_1")) ?? "";
        assert.ok(handed.includes("saved since your last turn by someone other than you"), handed);
        assert.ok(handed.includes("A withdrawn invite never grants access."), handed);
        assert.ok(!handed.includes("## This turn is spoken"), handed);
      }),
  );

  it.effect(
    "a spoken ask the voice dispatched into an agent's session runs as a spoken turn: the ask learns the turn it ran in, the transcript's line is the turn's own rather than a second line written from eve's message, and the question the agent queued is journaled",
    () =>
      Effect.gen(function* () {
        const host = yield* hostOverStore();
        const { agent, target, auth, sessionId } = yield* openAgent(host);
        const spokenAuth: SessionAuth = {
          current: spokenSeat(target).current,
          initiator: auth.initiator,
        };
        const admitted = Result.getOrThrow(yield* host.admit(spokenAuth, sessionId));
        // The voice's ask under its delegation's id, dispatched into the agent's session, and the
        // transcript row the voice writer cut for it, written before eve's turn started.
        const asks = askRecord();
        const delegationId = `dl_${randomUUID()}`;
        const ask = yield* asks.record({
          userId: target.userId,
          conversationId: target.conversationId,
          clientId: delegationId,
          origin: ASK_ORIGIN.SPOKEN,
          createdAt: new Date(NOW),
        });
        yield* asks.dispatchOnce(target, ask.id, () =>
          Effect.succeed({ sessionId, deliveryId: "delivery-1" }),
        );
        const writer = yield* storeWriter({ tools: CODER_TOOL_SET });
        const lineId = `line-${delegationId}`;
        const line = yield* writer.upsertSpokenRow(target, {
          role: MESSAGE_ROLE.USER,
          clientId: lineId,
          text: "How far along are the invites?",
          metadata: { author: MESSAGE_AUTHOR.DEVELOPER, channel: MESSAGE_CHANNEL.VOICE },
        });
        assert.ok(Result.isSuccess(line));
        yield* writer.attachSpokenAsk(target, { delegationId, rowIds: [lineId] });

        const session = { id: sessionId, auth: spokenAuth, turn: { id: "turn_0" } };
        const state = memoryRelayState();
        for (const event of spokenCodingTurn("turn_0", ["delivery-1"])) {
          // SAFETY: the relay reads the session's id and auth; eve's turn metadata is not read here.
          yield* host.relay(event, admitted, session as never, state, {});
        }

        const turnId = hostTurnId(sessionId, "turn_0");
        assert.equal((yield* turnRow(turnId))?.origin, TURN_ORIGIN.SPOKEN);
        assert.equal((yield* asks.named(target.userId, ask.id))?.turnId, turnId);
        const page = yield* transcriptPast(target, CODER_TOOL_SET, CURSOR_START, agent).pipe(
          Effect.provide(modelCatalogOf(CATALOG)),
        );
        assert.deepEqual(
          page.messages.map((message) => [message.role, message.id]),
          [
            [MESSAGE_ROLE.USER, line.success.id],
            [MESSAGE_ROLE.ASSISTANT, page.messages[1]?.id],
          ],
        );
        const answer = page.messages[1];
        assert.ok(
          answer?.parts.some(
            (part) => isToolUIPart(part) && part.type === `tool-${CODER_TOOL.QUEUE_QUESTION}`,
          ),
        );
      }),
  );
  it.effect(
    "a call's spoken ask steered into the agent's typed turn under way binds to that turn at the step it joined, and the line the voice wrote is the turn's once, drawn where it arrived among the turn's work, rather than written again from eve's message; the turn stays typed and runs to its end",
    () =>
      Effect.gen(function* () {
        const host = yield* hostOverStore();
        const { agent, target, auth, sessionId, admitted } = yield* openAgent(host);
        const writer = yield* storeWriter({ tools: CODER_TOOL_SET });
        const state = memoryRelayState();
        const session = { id: sessionId, auth, turn: { id: "turn_0" } };
        const relayed = (events: readonly MessageStreamEvent[]) =>
          Effect.forEach(events, (event) =>
            // SAFETY: the relay reads the session's id and auth; eve's turn metadata is not read here.
            host.relay(event, admitted, session as never, state, {}),
          );
        const opening = codingTurn("turn_0", "turn.completed");
        yield* relayed(opening.slice(0, opening.findIndex((e) => e.type === "step.completed") + 1));

        // The call's ask, dispatched into the agent's session as a follow-up, and the developer's
        // words the voice wrote as they were said; the voice ties them to the ask only after eve
        // has steered the ask in, as it does when the steer is quick.
        const asks = askRecord();
        const delegationId = `dl_${randomUUID()}`;
        const ask = yield* asks.record({
          userId: target.userId,
          conversationId: target.conversationId,
          clientId: delegationId,
          origin: ASK_ORIGIN.SPOKEN,
          createdAt: new Date(NOW),
        });
        yield* asks.dispatchOnce(target, ask.id, () =>
          Effect.succeed({ sessionId, deliveryId: "delivery-call" }),
        );
        const lineId = `line-${delegationId}`;
        const line = yield* writer.upsertSpokenRow(target, {
          role: MESSAGE_ROLE.USER,
          clientId: lineId,
          text: "Where are you with the invites?",
          metadata: { author: MESSAGE_AUTHOR.DEVELOPER, channel: MESSAGE_CHANNEL.VOICE },
        });
        assert.ok(Result.isSuccess(line));
        // eve moves the session's current auth to the line that steered in.
        session.auth = { current: spokenSeat(target).current, initiator: auth.initiator };
        const tail = steeredTail("turn_0", "The developer asked where the invites are.", [
          "delivery-call",
        ]);
        yield* relayed(tail.slice(0, 2));
        yield* writer.attachSpokenAsk(target, { delegationId, rowIds: [lineId] });
        yield* relayed(tail.slice(2));

        const turnId = hostTurnId(sessionId, "turn_0");
        const bound = yield* asks.named(target.userId, ask.id);
        assert.deepEqual([bound?.turnId, bound?.joinedAfterStep], [turnId, 1]);
        const turn = yield* turnRow(turnId);
        assert.deepEqual([turn?.origin, turn?.status], [TURN_ORIGIN.TYPED, TURN_STATUS.SETTLED]);
        const page = yield* transcriptPast(target, CODER_TOOL_SET, CURSOR_START, agent).pipe(
          Effect.provide(modelCatalogOf(CATALOG)),
        );
        const journal = page.messages.find((message) => message.role === MESSAGE_ROLE.ASSISTANT);
        assert.ok(journal !== undefined);
        const [opened] = page.messages;
        assert.ok(opened !== undefined);
        assert.deepEqual(
          page.messages.flatMap((message) =>
            message.role === MESSAGE_ROLE.USER ? [[message.id, message.arrivedIn]] : [],
          ),
          [
            [opened.id, undefined],
            [line.success.id, { journalId: journal.id, afterStep: 1 }],
          ],
        );
      }),
  );

  it.effect(
    "a line typed to the agent while a call's spoken turn runs joins that turn and is taken as the developer's awaiting row where it arrived, not written again, while the turn's own line stays the transcript's",
    () =>
      Effect.gen(function* () {
        const host = yield* hostOverStore();
        const { agent, userId, target, auth, sessionId } = yield* openAgent(host);
        const spokenAuth: SessionAuth = {
          current: spokenSeat(target).current,
          initiator: auth.initiator,
        };
        const admitted = Result.getOrThrow(yield* host.admit(spokenAuth, sessionId));
        const writer = yield* storeWriter({ tools: CODER_TOOL_SET });
        const asks = askRecord();
        const delegationId = `dl_${randomUUID()}`;
        const ask = yield* asks.record({
          userId: target.userId,
          conversationId: target.conversationId,
          clientId: delegationId,
          origin: ASK_ORIGIN.SPOKEN,
          createdAt: new Date(NOW),
        });
        yield* asks.dispatchOnce(target, ask.id, () =>
          Effect.succeed({ sessionId, deliveryId: "delivery-1" }),
        );
        const lineId = `line-${delegationId}`;
        const spokenLine = yield* writer.upsertSpokenRow(target, {
          role: MESSAGE_ROLE.USER,
          clientId: lineId,
          text: "How far along are the invites?",
          metadata: { author: MESSAGE_AUTHOR.DEVELOPER, channel: MESSAGE_CHANNEL.VOICE },
        });
        assert.ok(Result.isSuccess(spokenLine));
        yield* writer.attachSpokenAsk(target, { delegationId, rowIds: [lineId] });

        const state = memoryRelayState();
        const session = { id: sessionId, auth: spokenAuth, turn: { id: "turn_0" } };
        const relayed = (events: readonly MessageStreamEvent[]) =>
          Effect.forEach(events, (event) =>
            // SAFETY: the relay reads the session's id and auth; eve's turn metadata is not read here.
            host.relay(event, admitted, session as never, state, {}),
          );
        const spoken = spokenCodingTurn("turn_0", ["delivery-1"]);
        yield* relayed(spoken.slice(0, spoken.findIndex((e) => e.type === "step.completed") + 1));
        const typed = "Use the mailer we already have.";
        const written = yield* writer.writeAwaitingLine(
          target,
          {
            text: typed,
            clientKey: "typed-mid-call",
            sender: { kind: MESSAGE_SENDER.MEMBER, userId },
          },
          Effect.succeed(true),
        );
        assert.ok(Result.isSuccess(written) && Option.isSome(written.success));
        session.auth = auth;
        yield* relayed(steeredTail("turn_0", typed, ["delivery-1", "delivery-typed"]));

        const turnId = hostTurnId(sessionId, "turn_0");
        const turn = yield* turnRow(turnId);
        assert.deepEqual([turn?.origin, turn?.status], [TURN_ORIGIN.SPOKEN, TURN_STATUS.SETTLED]);
        const page = yield* transcriptPast(target, CODER_TOOL_SET, CURSOR_START, agent).pipe(
          Effect.provide(modelCatalogOf(CATALOG)),
        );
        const journal = page.messages.find((message) => message.role === MESSAGE_ROLE.ASSISTANT);
        assert.ok(journal !== undefined);
        assert.deepEqual(
          page.messages.flatMap((message) =>
            message.role === MESSAGE_ROLE.USER ? [[message.id, message.arrivedIn]] : [],
          ),
          [
            [spokenLine.success.id, undefined],
            [written.success.value.id, { journalId: journal.id, afterStep: 1 }],
          ],
        );
      }),
  );
});
