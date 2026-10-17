/**
 * messages-procedures.ts -- the held message reads, and the writes on the same paths, as the hosted oRPC router answers them.
 *
 * Five reads the desktop holds open while nothing it reads has moved: one
 * agent's transcript (`GET /api/agents/{id}/messages`) and its worker's
 * (`GET /api/agents/{id}/subagents/{call}/messages`), held while the agent
 * or the worker runs (`coder-host/transcript.ts`); one task's conversation
 * with the brain (`GET /api/plans/{id}/messages`) and its worker's
 * (`GET /api/plans/{id}/subagents/{call}/messages`), read as an agent's
 * transcript is; and a workspace's chat (`GET /api/workspaces/chat`), held
 * while nothing moved (`coder-host/chat-page.ts`). Each is a long-held JSON
 * procedure, its hold the store's own, unchanged: the handler adds no
 * deadline of its own, and the hold ends when the store's does, answering
 * the page as it stands. Beside them, the two writes the same paths take: a
 * message to an agent (`POST /api/agents/{id}/messages`), handed to its
 * session through the one steer path the voice brain's tool shares
 * (`coder-host/steer.ts`), and a write to the chat (`POST
 * /api/workspaces/chat`, `workspace-chat.ts`).
 *
 * Every row a read touches is one of a workspace the caller is a member of:
 * an agent or a task of any other workspace answers exactly as one that
 * names nothing, and an id that is no UUID names no row. A title, the
 * agent's or a worker's, is read after the page, since it can land after a
 * turn ends, which a held read may span.
 */

import { childTitlesOf } from "@luke/database/models/child-titles";
import { type CodingAgent, readCodingAgent } from "@luke/database/models/coding-agent-store";
import { childConversationId } from "@luke/database/models/ids";
import { readTask } from "@luke/database/models/task-store";
import { type ConversationTarget, storeWriter } from "@luke/database/models/writer";
import { MESSAGE_SENDER } from "@luke/database/storage-vocabulary";
import {
  CODING_AGENT_BOUNDS,
  CODING_AGENT_CURSOR_START,
  CODING_AGENT_STATUS,
  type CodingAgentMessage,
  type CodingAgentMessagesAnswer,
  codingAgentCallIdSchema,
  codingAgentCursorSchema,
} from "@luke/features/coding-agent-wire";
import { readEither } from "@luke/wire/effect";
import { middlewareGen } from "@orpc/experimental-effect";
import { ORPCError } from "@orpc/server";
import { Clock, Effect, Option, Result, Schema } from "effect";
import { unparsedWire, wireUuidSchema } from "../core.js";
import { HostedEnvironment } from "../environment.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
  type UserIdResolver,
} from "../http/http-effect.js";
import { accountMiddleware, bodyLimit, type HostedContext, hosted } from "../orpc/base.js";
import { HOSTED_TOOL_SET } from "../tasks/brain-tool-set.js";
import {
  BRAIN_POLL,
  type BrainPage,
  brainPageNow,
  brainPagePast,
  brainStatusNow,
  brainTitleAwaited,
  brainTurnsPage,
  brainWorkerSession,
  taskConversationLiveStatements,
} from "../tasks/brain-transcript.js";
import { MAXIMUM_ATTACHMENTS_BODY_BYTES } from "./coder-host/start.js";
import { steerCodingAgent } from "./coder-host/steer.js";
import { type EveReach, eveFor, summaryOf } from "./coder-host/stop.js";
import { CODER_TOOL_SET } from "./coder-host/tool-set.js";
import {
  CURSOR_START,
  cursorOfWire,
  cursorToWire,
  delegationPast,
  NO_TITLE_AWAITED,
  type TitleAwaited,
  type TranscriptPage,
  titleMayLand,
  transcriptPast,
} from "./coder-host/transcript.js";
import {
  MAXIMUM_CHAT_WRITE_BODY_BYTES,
  readWorkspaceChat,
  workspaceOf,
  writeWorkspaceChat,
} from "./workspace-chat.js";

/** A message is its words, its files, and a key: the bound's characters at JSON's widest escape, the files, and room for the keys around them. */
const MAXIMUM_MESSAGE_BODY_BYTES =
  6 * CODING_AGENT_BOUNDS.MAX_MESSAGE_CHARS + MAXIMUM_ATTACHMENTS_BODY_BYTES + 1_024;

/** oRPC's own code for an input its schema refused. */
const ORPC_BAD_REQUEST = "BAD_REQUEST";

export interface MessagesProcedureSeams extends EveReach {
  resolveUserId: UserIdResolver;
}

/** The row an id names, or none where it is no UUID. */
const uuidNamed = /* @__PURE__ */ Effect.fnUntraced(function* (
  id: string,
): Effect.fn.Return<string, HostedRefusal> {
  const read = readEither(wireUuidSchema)(unparsedWire(id));
  if (Result.isFailure(read)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return read.success;
});

/** The agent the path names, where the account is a member of its workspace, its conversation targeted under the member who started it; not found otherwise. */
const reachedAgent = /* @__PURE__ */ Effect.fnUntraced(function* (userId: string, id: string) {
  const agentId = yield* uuidNamed(id);
  const agent = yield* hostedStoreOrUnavailable(readCodingAgent(userId, agentId));
  if (Option.isNone(agent)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const target: ConversationTarget = {
    userId: agent.value.userId,
    conversationId: agent.value.conversationId,
  };
  return { agent: agent.value, target };
});

/** The delegation call the path names, or not found for one that is no call id. */
const callNamed = /* @__PURE__ */ Effect.fnUntraced(function* (
  call: string,
): Effect.fn.Return<string, HostedRefusal> {
  const read = readEither(codingAgentCallIdSchema)(unparsedWire(call));
  if (Result.isFailure(read)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return read.success;
});

/** The cursor a read names, or none; refused where it names something else. */
const cursorNamed = /* @__PURE__ */ Effect.fnUntraced(function* (
  after: string | undefined,
): Effect.fn.Return<string | undefined, HostedRefusal> {
  if (after === undefined) return undefined;
  const read = readEither(codingAgentCursorSchema)(unparsedWire(after));
  if (Result.isFailure(read)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  return read.success;
});

/** The turn an older page is read before, or none for the newest; one that is no UUID names no turn, refused as a request that does not read. */
const turnNamed = /* @__PURE__ */ Effect.fnUntraced(function* (
  before: string | undefined,
): Effect.fn.Return<string | undefined, HostedRefusal> {
  if (before === undefined) return undefined;
  const read = readEither(wireUuidSchema)(unparsedWire(before));
  if (Result.isFailure(read)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  return read.success;
});

/** The one word a task's read takes for `hold`: past the cursor in one look, never held. */
const HOLD_NONE = "none";

/** Whether a read past the cursor asks for one look rather than a hold; refused where `hold` names anything else. */
const unheldNamed = /* @__PURE__ */ Effect.fnUntraced(function* (
  hold: string | undefined,
): Effect.fn.Return<boolean, HostedRefusal> {
  if (hold === undefined) return false;
  if (hold !== HOLD_NONE) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  return true;
});

/**
 * What a read of an ended agent, or of its worker, waits on for a title:
 * the worker named, or the agent's own or any of its workers' where none
 * is; nothing on a deployment that generates no titles, which is one
 * without Luke's Anthropic key, the title model's (`coder-host/model.ts`).
 */
const titleAwaitedOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  parent: ConversationTarget,
  childConversationId?: string,
): Effect.fn.Return<TitleAwaited, never, HostedEnvironment> {
  const environment = yield* HostedEnvironment;
  return environment.anthropicKey === undefined
    ? NO_TITLE_AWAITED
    : titleMayLand(parent, childConversationId);
});

/**
 * A page's messages as the wire declares them: each part the stored JSON
 * the row holds, which the SDK's own types describe more narrowly than the
 * wire's verbatim JSON does.
 */
function wireMessages(
  messages: TranscriptPage["messages"] | readonly CodingAgentMessage[],
): CodingAgentMessagesAnswer["messages"] {
  // SAFETY: every part and metadata is the JSON its row stored (`storedObjectSchema`), which the SDK's part types only name more narrowly.
  return messages as CodingAgentMessagesAnswer["messages"];
}

/** A page of an agent's or a worker's transcript as the wire answers it. */
function transcriptAnswer(page: TranscriptPage, title: string | null): CodingAgentMessagesAnswer {
  return {
    messages: wireMessages(page.messages),
    cursor: cursorToWire(page.cursor),
    status: page.status,
    ...(page.runStartedAt === undefined ? undefined : { runStartedAt: page.runStartedAt }),
    ...(page.delegations === undefined ? undefined : { delegations: page.delegations }),
    ...(page.subagentTitles === undefined ? undefined : { subagentTitles: page.subagentTitles }),
    ...(page.subagents === undefined ? undefined : { subagents: page.subagents }),
    title,
    ...(page.failureReason === undefined ? undefined : { failureReason: page.failureReason }),
    ...(page.usage === undefined ? undefined : { usage: page.usage }),
    ...(page.context === undefined ? undefined : { context: page.context }),
  };
}

/** A page of a task's conversation as the wire answers it, every field the page holds carried as it is; a brain conversation is named by its task, so it carries no title. */
function taskAnswer(
  page: BrainPage | TranscriptPage,
  title: string | null,
): CodingAgentMessagesAnswer {
  return {
    ...page,
    messages: wireMessages(page.messages),
    cursor: cursorToWire(page.cursor),
    title,
  };
}

/** A detailed input whose body's words run past the bound, whatever else it carries: refused as too long rather than as a body that does not read. */
const isTooLong = Schema.is(
  Schema.Struct({
    body: Schema.Struct({
      text: Schema.String.check(
        Schema.makeFilter(
          (text: string) => text.trim().length > CODING_AGENT_BOUNDS.MAX_MESSAGE_CHARS,
        ),
      ),
    }),
  }),
);

/**
 * A message its schema refused because its words run past the bound is
 * refused as too long, as the old group refused it; any other refusal of
 * its shape stands. Note that this runs before the input is validated, so
 * it sees the refusal and the body as it came.
 */
const tooLongMiddleware = middlewareGen<HostedContext>(function* ({ next }, input) {
  return yield* next().pipe(
    Effect.catchIf(
      (failure) =>
        failure instanceof ORPCError && failure.code === ORPC_BAD_REQUEST && isTooLong(input),
      () => Effect.fail(HOSTED_REFUSAL.MESSAGE_TOO_LONG),
    ),
  );
});

/** The messages resource: its five held reads and the two writes on their paths, each to a signed-in caller. */
export function messagesProcedures(seams: MessagesProcedureSeams) {
  const signedIn = hosted.messages.use(accountMiddleware(seams.resolveUserId));
  const writer = storeWriter({ tools: CODER_TOOL_SET });
  return {
    agent: signedIn.agent.effect(function* ({ input, context }) {
      const after = (yield* cursorNamed(input.after)) ?? CODING_AGENT_CURSOR_START;
      const { agent, target } = yield* reachedAgent(context.userId, input.id);
      const titleAwaited = yield* titleAwaitedOf(target);
      const page = yield* hostedStoreOrUnavailable(
        transcriptPast(target, CODER_TOOL_SET, cursorOfWire(after), agent, agent, titleAwaited),
      );
      const titled = yield* hostedStoreOrUnavailable(readCodingAgent(context.userId, agent.id));
      return transcriptAnswer(
        page,
        Option.match(titled, {
          onNone: () => agent.title,
          onSome: (now: CodingAgent) => now.title,
        }),
      );
    }),

    send: hosted.messages
      .use(accountMiddleware(seams.resolveUserId))
      .use(bodyLimit(MAXIMUM_MESSAGE_BODY_BYTES))
      .use(tooLongMiddleware)
      .send.effect(function* ({ input, context }) {
        const { agent } = yield* reachedAgent(context.userId, input.params.id);
        const eve = yield* eveFor(seams, context.request, context.userId);
        yield* steerCodingAgent(eve, writer, context.userId, agent, {
          ...input.body,
          sender: { kind: MESSAGE_SENDER.MEMBER, userId: context.userId },
        });
        return { agent: yield* summaryOf(context.userId, agent) };
      }),

    agentWorker: signedIn.agentWorker.effect(function* ({ input, context }) {
      const after = (yield* cursorNamed(input.after)) ?? CODING_AGENT_CURSOR_START;
      const callId = yield* callNamed(input.call);
      const { agent, target } = yield* reachedAgent(context.userId, input.id);
      const conversationId = childConversationId(agent.conversationId, callId);
      const read = yield* hostedStoreOrUnavailable(delegationPast(target, conversationId, agent));
      if (read.delegation === undefined) {
        if (!read.agentRuns) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
        return transcriptAnswer(
          { messages: [], cursor: cursorOfWire(after), status: CODING_AGENT_STATUS.STARTING },
          null,
        );
      }
      const titleAwaited = yield* titleAwaitedOf(target, conversationId);
      const page = yield* hostedStoreOrUnavailable(
        transcriptPast(
          { userId: agent.userId, conversationId },
          CODER_TOOL_SET,
          cursorOfWire(after),
          { createdAt: read.delegation.createdAt },
          undefined,
          titleAwaited,
        ),
      );
      const titles = yield* hostedStoreOrUnavailable(childTitlesOf(target, [conversationId]));
      return transcriptAnswer(page, titles.get(conversationId) ?? null);
    }),

    task: signedIn.task.effect(function* ({ input, context }) {
      const taskId = yield* uuidNamed(input.id);
      const after = yield* cursorNamed(input.after);
      const before = yield* turnNamed(input.before);
      const unheld = yield* unheldNamed(input.hold);
      if ((after !== undefined && before !== undefined) || (unheld && after === undefined)) {
        return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
      }
      const task = yield* hostedStoreOrUnavailable(readTask(context.userId, taskId));
      if (Option.isNone(task)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      const { conversationId } = task.value;
      if (conversationId === undefined) {
        return taskAnswer(
          { messages: [], cursor: CURSOR_START, status: CODING_AGENT_STATUS.COMPLETED },
          null,
        );
      }
      const target = { userId: context.userId, conversationId };
      const page = yield* hostedStoreOrUnavailable(
        after === undefined
          ? brainTurnsPage(target, before)
          : unheld
            ? brainPageNow(target, cursorOfWire(after))
            : brainPagePast(
                target,
                cursorOfWire(after),
                Option.match(taskConversationLiveStatements(context.userId, taskId), {
                  onNone: () => [],
                  onSome: ({ mark }) => [mark],
                }),
              ),
      );
      return taskAnswer(page, null);
    }),

    taskWorker: signedIn.taskWorker.effect(function* ({ input, context }) {
      const taskId = yield* uuidNamed(input.id);
      const call = yield* callNamed(input.call);
      const after = (yield* cursorNamed(input.after)) ?? CODING_AGENT_CURSOR_START;
      const task = yield* hostedStoreOrUnavailable(readTask(context.userId, taskId));
      if (Option.isNone(task) || task.value.conversationId === undefined) {
        return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      }
      const parent = { userId: context.userId, conversationId: task.value.conversationId };
      const session = yield* hostedStoreOrUnavailable(brainWorkerSession(parent, call));
      if (session === undefined) {
        // A tab opens the moment its call is made, a step before the journal holds the call; past the turn, none is none for good.
        const status = yield* hostedStoreOrUnavailable(brainStatusNow(parent));
        if (status !== CODING_AGENT_STATUS.RUNNING) {
          return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
        }
        return taskAnswer(
          { messages: [], cursor: cursorOfWire(after), status: CODING_AGENT_STATUS.STARTING },
          null,
        );
      }
      const child = childConversationId(parent.conversationId, session);
      const createdAt = new Date(yield* Clock.currentTimeMillis);
      const page = yield* hostedStoreOrUnavailable(
        transcriptPast(
          { userId: context.userId, conversationId: child },
          HOSTED_TOOL_SET,
          cursorOfWire(after),
          { createdAt },
          undefined,
          brainTitleAwaited(parent, child),
          BRAIN_POLL,
        ),
      );
      const titles = yield* hostedStoreOrUnavailable(childTitlesOf(parent, [child]));
      return taskAnswer(page, titles.get(child) ?? null);
    }),

    chat: signedIn.chat.effect(function* ({ input, context }) {
      return yield* readWorkspaceChat(context.userId, input);
    }),

    chatWrite: hosted.messages
      .use(accountMiddleware(seams.resolveUserId))
      .use(bodyLimit(MAXIMUM_CHAT_WRITE_BODY_BYTES))
      .chatWrite.effect(function* ({ input, context }) {
        const workspaceId = yield* workspaceOf(input.query.workspaceId);
        return yield* writeWorkspaceChat(seams, context.userId, workspaceId, input.body);
      }),
  };
}
