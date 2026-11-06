import { middlewareGen } from "@orpc/experimental-effect";
import { ORPCError } from "@orpc/server";
import type { DatabaseServices, StoreFailure } from "@repo/database/core/query";
import {
  claimQueuedMessage,
  editQueuedMessage,
  holdQueuedMessage,
  QUEUE_OUTCOME,
  type QueuedMessageRow,
  queueAgentMessage,
  readAgentQueue,
  releaseQueuedMessage,
  reorderAgentQueue,
  resumeAgentQueue,
  takeQueuedMessage,
} from "@repo/database/models/agent-queue-store";
import { type Agent, readAgent, readVisibleAgent } from "@repo/database/models/agent-store";
import { childTitlesOf } from "@repo/database/models/child-titles";
import { readRewoundRevision } from "@repo/database/models/conversation-rewind";
import { childConversationId } from "@repo/database/models/ids";
import { listProviderKeyRows } from "@repo/database/models/provider-key-store";
import { type ConversationTarget, storeWriter } from "@repo/database/models/writer";
import {
  AGENT_BOUNDS,
  AGENT_CURSOR_START,
  AGENT_STATUS,
  type AgentMessagesAnswer,
  type AgentNewestAnswer,
  type AgentOlderAnswer,
  type AgentPartAnswer,
  type AgentTranscriptMessage,
  agentBeforeSchema,
  agentCallIdSchema,
  agentCursorSchema,
  QUEUE_CHANGE,
  TRANSCRIPT_PARTS_QUERY,
} from "@repo/features/agent-wire";
import { TRANSCRIPT_NOW_QUERY } from "@repo/features/live-wire";
import { PROVIDER_KEY_KIND } from "@repo/features/provider-key-wire";
import { isRecord } from "@repo/wire";
import { readEither } from "@repo/wire/effect";
import { DateTime, Effect, Option, Result, Schema } from "effect";
import { unparsedWire } from "../core.js";
import { afterResponse } from "../http/after-response.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
  pathUuid,
  type UserIdResolver,
} from "../http/http-effect.js";
import { accountMiddleware, type HostedContext, hosted } from "../orpc/base.js";
import {
  claimNext,
  type QueueSessions,
  sendClaimed,
  sendQueued,
  wireQueue,
} from "./coder-host/agent-queue.js";
import { cutMessage, wholePartOf } from "./coder-host/part-cut.js";
import { routedSessions } from "./coder-host/runtime-sessions.js";
import { startedBlank } from "./coder-host/status.js";
import { steerMemberWords } from "./coder-host/steer.js";
import { summaryOf } from "./coder-host/stop.js";
import { CODER_TOOL_SET } from "./coder-host/tool-set.js";
import {
  cursorOfWire,
  cursorToWire,
  delegationNow,
  delegationPast,
  NO_TITLE_AWAITED,
  NO_TITLE_EDGE,
  type TitleAwaited,
  type TitleEdge,
  type TranscriptNewest,
  type TranscriptOlder,
  type TranscriptPage,
  titleMayLand,
  titleWindowEdge,
  transcriptBefore,
  transcriptNewest,
  transcriptNow,
  transcriptPast,
} from "./coder-host/transcript.js";

const ORPC_BAD_REQUEST = "BAD_REQUEST";

export interface MessagesProcedureSeams {
  resolveUserId: UserIdResolver;
}

const reachedAgent = /* @__PURE__ */ Effect.fnUntraced(function* (userId: string, id: string) {
  const agentId = yield* pathUuid(id);
  const agent = yield* hostedStoreOrUnavailable(readVisibleAgent(userId, agentId));
  if (Option.isNone(agent)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const target: ConversationTarget = {
    userId: agent.value.userId,
    conversationId: agent.value.conversationId,
  };
  return { agent: agent.value, target };
});

const callNamed = /* @__PURE__ */ Effect.fnUntraced(function* (
  call: string,
): Effect.fn.Return<string, HostedRefusal> {
  const read = readEither(agentCallIdSchema)(unparsedWire(call));
  if (Result.isFailure(read)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return read.success;
});

const cursorNamed = /* @__PURE__ */ Effect.fnUntraced(function* (
  after: string | undefined,
): Effect.fn.Return<string | undefined, HostedRefusal> {
  if (after === undefined) return undefined;
  const read = readEither(agentCursorSchema)(unparsedWire(after));
  if (Result.isFailure(read)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  return read.success;
});

const beforeNamed = /* @__PURE__ */ Effect.fnUntraced(function* (
  before: string | undefined,
): Effect.fn.Return<number | undefined, HostedRefusal> {
  if (before === undefined) return undefined;
  const read = readEither(agentBeforeSchema)(unparsedWire(before));
  const seq = Result.isFailure(read) ? Number.NaN : Number(read.success);
  if (!Number.isSafeInteger(seq)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  return seq;
});

const titledByModel = (parent: ConversationTarget) =>
  Effect.map(
    listProviderKeyRows(parent.userId, PROVIDER_KEY_KIND.API_KEY),
    (rows) => rows.length > 0,
  );

function titleAwaitedOf(parent: ConversationTarget, childConversationId?: string): TitleAwaited {
  return Effect.flatMap(titledByModel(parent), (byModel) =>
    byModel ? titleMayLand(parent, childConversationId) : NO_TITLE_AWAITED,
  );
}

function wireMessages(
  messages: TranscriptPage["messages"] | readonly AgentTranscriptMessage[],
  cut: boolean,
): AgentMessagesAnswer["messages"] {
  const stored = messages as AgentMessagesAnswer["messages"];
  return cut ? stored.map(cutMessage) : stored;
}

function readsCut(parts: string | undefined): boolean {
  return parts === TRANSCRIPT_PARTS_QUERY.CUT;
}

const indexNamed = /* @__PURE__ */ Effect.fnUntraced(function* (
  index: string,
): Effect.fn.Return<number, HostedRefusal> {
  if (!/^\d{1,6}$/u.test(index)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return Number(index);
});

const partAnswer = /* @__PURE__ */ Effect.fnUntraced(function* (
  target: ConversationTarget,
  message: string,
  index: string,
) {
  const messageId = yield* pathUuid(message);
  const at = yield* indexNamed(index);
  const part = yield* hostedStoreOrUnavailable(wholePartOf(target, CODER_TOOL_SET, messageId, at));
  if (Option.isNone(part) || !isRecord(part.value)) {
    return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  }
  const answer: AgentPartAnswer = { part: part.value };
  return answer;
});

function titleEdgeOf(parent: ConversationTarget, childConversationId?: string): TitleEdge {
  return Effect.flatMap(titledByModel(parent), (byModel) =>
    byModel ? titleWindowEdge(parent, childConversationId) : NO_TITLE_EDGE,
  );
}

function readsNow(wait: string | undefined): boolean {
  return wait === TRANSCRIPT_NOW_QUERY.NONE;
}

const HANDS_ON: ReadonlySet<string> = new Set([
  QUEUE_CHANGE.ADD,
  QUEUE_CHANGE.EDIT,
  QUEUE_CHANGE.REORDER,
  QUEUE_CHANGE.RESUME,
  QUEUE_CHANGE.HOLD,
]);

function transcriptAnswer(
  page: TranscriptPage,
  title: string | null,
  cut: boolean,
  holds?: boolean,
  wakeIn?: number,
): AgentMessagesAnswer & { readonly holds?: boolean; readonly wakeIn?: number } {
  return {
    ...(holds === undefined ? undefined : { holds }),
    ...(wakeIn === undefined ? undefined : { wakeIn }),
    messages: wireMessages(page.messages, cut),
    cursor: cursorToWire(page.cursor),
    status: page.status,
    ...(page.runStartedAt === undefined ? undefined : { runStartedAt: page.runStartedAt }),
    ...(page.delegations === undefined ? undefined : { delegations: page.delegations }),
    ...(page.subagentTitles === undefined ? undefined : { subagentTitles: page.subagentTitles }),
    ...(page.subagents === undefined ? undefined : { subagents: page.subagents }),
    title,
    ...(page.failureReason === undefined ? undefined : { failureReason: page.failureReason }),
    ...(page.hostLost === undefined ? undefined : { hostLost: page.hostLost }),
    ...(page.usage === undefined ? undefined : { usage: page.usage }),
    ...(page.context === undefined ? undefined : { context: page.context }),
    ...(page.queue === undefined ? undefined : { queue: page.queue }),
    ...(page.launch === undefined ? undefined : { launch: page.launch }),
    ...(page.launchUnstarted === undefined ? undefined : { launchUnstarted: page.launchUnstarted }),
  };
}

function newestAnswer(
  newest: TranscriptNewest,
  title: string | null,
  cut: boolean,
): AgentNewestAnswer {
  return {
    ...transcriptAnswer(newest.page, title, cut),
    ...(newest.before === undefined ? undefined : { before: String(newest.before) }),
  };
}

function olderAnswer(older: TranscriptOlder, cut: boolean): AgentOlderAnswer {
  return {
    messages: wireMessages(older.messages, cut),
    ...(older.before === undefined ? undefined : { before: String(older.before) }),
  };
}

const isTooLong = Schema.is(
  Schema.Struct({
    body: Schema.Struct({
      text: Schema.String.check(
        Schema.makeFilter((text: string) => text.trim().length > AGENT_BOUNDS.MAX_MESSAGE_CHARS),
      ),
    }),
  }),
);

const tooLongMiddleware = middlewareGen<HostedContext>(function* ({ next }, input) {
  return yield* next().pipe(
    Effect.catchIf(
      (failure) =>
        failure instanceof ORPCError && failure.code === ORPC_BAD_REQUEST && isTooLong(input),
      () => Effect.fail(HOSTED_REFUSAL.MESSAGE_TOO_LONG),
    ),
  );
});

export function messagesProcedures(seams: MessagesProcedureSeams) {
  const signedIn = hosted.messages.use(accountMiddleware(seams.resolveUserId));
  const writer = storeWriter({ tools: CODER_TOOL_SET });
  return {
    agent: signedIn.agent.effect(function* ({ input, context }) {
      const after = (yield* cursorNamed(input.after)) ?? AGENT_CURSOR_START;
      const { agent, target } = yield* reachedAgent(context.userId, input.id);
      const titleAwaited = titleAwaitedOf(target);
      const cursor = cursorOfWire(after);
      const standing = { createdAt: agent.createdAt, blank: startedBlank(agent) };
      const rewound = yield* hostedStoreOrUnavailable(readRewoundRevision(target));
      const stale = rewound !== undefined && cursor.revision < rewound;
      const { page, holds, wakeIn } =
        readsNow(input.wait) || stale
          ? yield* hostedStoreOrUnavailable(
              transcriptNow(
                target,
                CODER_TOOL_SET,
                cursor,
                standing,
                agent,
                titleAwaited,
                titleEdgeOf(target),
              ),
            )
          : {
              page: yield* hostedStoreOrUnavailable(
                transcriptPast(
                  target,
                  CODER_TOOL_SET,
                  cursor,
                  standing,
                  agent,
                  titleAwaited,
                  titleEdgeOf(target),
                ),
              ),
              holds: undefined,
              wakeIn: undefined,
            };
      const titled = yield* hostedStoreOrUnavailable(readAgent(context.userId, agent.id));
      return {
        ...transcriptAnswer(
          page,
          Option.match(titled, {
            onNone: () => agent.title,
            onSome: (now: Agent) => now.title,
          }),
          readsCut(input.parts),
          holds,
          wakeIn,
        ),
        ...(rewound === undefined ? undefined : { rewound }),
      };
    }),

    send: hosted.messages
      .use(accountMiddleware(seams.resolveUserId))
      .use(tooLongMiddleware)
      .send.effect(function* ({ input, context }) {
        const { agent } = yield* reachedAgent(context.userId, input.params.id);
        const { txid } = yield* steerMemberWords(writer, context.userId, agent, input.body);
        const summary = yield* summaryOf(context.userId, agent);
        return txid === undefined ? { agent: summary } : { agent: summary, txid };
      }),

    queue: hosted.messages.use(accountMiddleware(seams.resolveUserId)).queue.effect(function* ({
      input,
      context,
    }) {
      const { agent } = yield* reachedAgent(context.userId, input.params.id);
      const { userId } = context;
      if (agent.userId !== userId) return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
      const eve: QueueSessions = routedSessions;
      const body = input.body;
      const found = <A>(effect: Effect.Effect<Option.Option<A>, StoreFailure, DatabaseServices>) =>
        Effect.flatMap(hostedStoreOrUnavailable(effect), (answer) =>
          Option.isSome(answer)
            ? Effect.succeed(answer.value)
            : Effect.fail(HOSTED_REFUSAL.NOT_FOUND),
        );
      switch (body.change) {
        case QUEUE_CHANGE.ADD: {
          const outcome = yield* found(
            queueAgentMessage(userId, agent.id, {
              id: body.id,
              text: body.text,
              attachments: body.attachments,
            }),
          );
          if (outcome === QUEUE_OUTCOME.FULL)
            return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
          break;
        }
        case QUEUE_CHANGE.EDIT:
          if (
            !(yield* found(
              editQueuedMessage(userId, agent.id, body.messageId, body.text, body.attachments),
            ))
          ) {
            return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
          }
          break;
        case QUEUE_CHANGE.DELETE:
          if (Option.isNone(yield* found(takeQueuedMessage(userId, agent.id, body.messageId)))) {
            return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
          }
          break;
        case QUEUE_CHANGE.HOLD:
          if (!(yield* found(holdQueuedMessage(userId, agent.id, body.messageId, body.held)))) {
            return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
          }
          break;
        case QUEUE_CHANGE.STEER: {
          const claimed = yield* found(
            claimQueuedMessage(
              userId,
              agent.id,
              body.messageId,
              body.text === undefined
                ? undefined
                : { text: body.text, attachments: body.attachments },
            ),
          );
          if (Option.isNone(claimed)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
          const message = claimed.value;
          yield* sendQueued(eve, agent, message).pipe(
            Effect.tapError(() =>
              hostedStoreOrUnavailable(releaseQueuedMessage(agent.id, message)),
            ),
          );
          break;
        }
        case QUEUE_CHANGE.REORDER:
          if (!(yield* found(reorderAgentQueue(userId, agent.id, body.order)))) {
            return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
          }
          break;
        case QUEUE_CHANGE.RESUME:
          yield* found(resumeAgentQueue(userId, agent.id));
          break;
      }
      const claimed = HANDS_ON.has(body.change)
        ? yield* claimNext(agent)
        : Option.none<QueuedMessageRow>();
      if (Option.isSome(claimed)) {
        yield* afterResponse("agent-queue", sendClaimed(eve, agent, claimed.value));
      }
      const queue = yield* found(readAgentQueue(userId, agent.id));
      return { queue: wireQueue(queue, yield* DateTime.nowAsDate) };
    }),

    agentWorker: signedIn.agentWorker.effect(function* ({ input, context }) {
      const after = (yield* cursorNamed(input.after)) ?? AGENT_CURSOR_START;
      const callId = yield* callNamed(input.call);
      const now = readsNow(input.wait);
      const { agent, target } = yield* reachedAgent(context.userId, input.id);
      const conversationId = childConversationId(agent.conversationId, callId);
      const read = yield* hostedStoreOrUnavailable(
        (now ? delegationNow : delegationPast)(target, conversationId, agent),
      );
      if (read.delegation === undefined) {
        if (!read.agentRuns) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
        return transcriptAnswer(
          { messages: [], cursor: cursorOfWire(after), status: AGENT_STATUS.STARTING },
          null,
          false,
          now ? true : undefined,
        );
      }
      const titleAwaited = titleAwaitedOf(target, conversationId);
      const worker = { userId: agent.userId, conversationId };
      const cursor = cursorOfWire(after);
      const started = { createdAt: read.delegation.createdAt };
      const { page, holds, wakeIn } = now
        ? yield* hostedStoreOrUnavailable(
            transcriptNow(
              worker,
              CODER_TOOL_SET,
              cursor,
              started,
              undefined,
              titleAwaited,
              titleEdgeOf(target, conversationId),
            ),
          )
        : {
            page: yield* hostedStoreOrUnavailable(
              transcriptPast(
                worker,
                CODER_TOOL_SET,
                cursor,
                started,
                undefined,
                titleAwaited,
                titleEdgeOf(target, conversationId),
              ),
            ),
            holds: undefined,
            wakeIn: undefined,
          };
      const titles = yield* hostedStoreOrUnavailable(childTitlesOf(target, [conversationId]));
      return transcriptAnswer(
        page,
        titles.get(conversationId) ?? null,
        readsCut(input.parts),
        holds,
        wakeIn,
      );
    }),

    agentPart: signedIn.agentPart.effect(function* ({ input, context }) {
      const { target } = yield* reachedAgent(context.userId, input.id);
      return yield* partAnswer(target, input.message, input.index);
    }),

    agentWorkerPart: signedIn.agentWorkerPart.effect(function* ({ input, context }) {
      const callId = yield* callNamed(input.call);
      const { agent } = yield* reachedAgent(context.userId, input.id);
      const worker = {
        userId: agent.userId,
        conversationId: childConversationId(agent.conversationId, callId),
      };
      return yield* partAnswer(worker, input.message, input.index);
    }),

    agentNewest: signedIn.agentNewest.effect(function* ({ input, context }) {
      const before = yield* beforeNamed(input.before);
      const { agent, target } = yield* reachedAgent(context.userId, input.id);
      if (before !== undefined) {
        return olderAnswer(
          yield* hostedStoreOrUnavailable(transcriptBefore(target, CODER_TOOL_SET, before)),
          readsCut(input.parts),
        );
      }
      const standing = { createdAt: agent.createdAt, blank: startedBlank(agent) };
      const rewound = yield* hostedStoreOrUnavailable(readRewoundRevision(target));
      const newest = yield* hostedStoreOrUnavailable(
        transcriptNewest(target, CODER_TOOL_SET, standing, agent),
      );
      const titled = yield* hostedStoreOrUnavailable(readAgent(context.userId, agent.id));
      return {
        ...newestAnswer(
          newest,
          Option.match(titled, { onNone: () => agent.title, onSome: (now) => now.title }),
          readsCut(input.parts),
        ),
        ...(rewound === undefined ? undefined : { rewound }),
      };
    }),

    agentWorkerNewest: signedIn.agentWorkerNewest.effect(function* ({ input, context }) {
      const before = yield* beforeNamed(input.before);
      const callId = yield* callNamed(input.call);
      const { agent, target } = yield* reachedAgent(context.userId, input.id);
      const conversationId = childConversationId(agent.conversationId, callId);
      const read = yield* hostedStoreOrUnavailable(delegationNow(target, conversationId, agent));
      if (read.delegation === undefined) {
        if (!read.agentRuns) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
        if (before !== undefined) return olderAnswer({ messages: [] }, false);
        return newestAnswer(
          {
            page: {
              messages: [],
              cursor: cursorOfWire(AGENT_CURSOR_START),
              status: AGENT_STATUS.STARTING,
            },
          },
          null,
          false,
        );
      }
      const worker = { userId: agent.userId, conversationId };
      if (before !== undefined) {
        return olderAnswer(
          yield* hostedStoreOrUnavailable(transcriptBefore(worker, CODER_TOOL_SET, before)),
          readsCut(input.parts),
        );
      }
      const started = { createdAt: read.delegation.createdAt };
      const newest = yield* hostedStoreOrUnavailable(
        transcriptNewest(worker, CODER_TOOL_SET, started),
      );
      const titles = yield* hostedStoreOrUnavailable(childTitlesOf(target, [conversationId]));
      return newestAnswer(newest, titles.get(conversationId) ?? null, readsCut(input.parts));
    }),
  };
}
