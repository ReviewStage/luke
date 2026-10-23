/**
 * messages-procedures.ts -- the held message reads, and the writes on the same paths, as the hosted oRPC router answers them.
 *
 * Three reads the desktop holds open while nothing it reads has moved: one
 * agent's transcript (`GET /api/agents/{id}/messages`) and its worker's
 * (`GET /api/agents/{id}/subagents/{call}/messages`), held while the agent
 * or the worker runs (`coder-host/transcript.ts`); and a workspace's chat (`GET /api/workspaces/chat`), held
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
 * turn ends, which a held read may span. An agent's or a worker's
 * transcript read with `wait=none` is answered at once rather than held,
 * with whether the held read would have held on it and how soon the clock
 * alone may end that hold, for a reader following
 * its live statements (`live-wire.ts`). A transcript read with `parts=cut`
 * carries each heavy part cut to its two ends (`coder-host/part-cut.ts`), and
 * the part reads beside them answer one such part whole, under the same
 * reach as the transcript it stands in.
 *
 * Beside them, the same two transcripts read back from their end, at once
 * (`GET /api/agents/{id}/messages/newest`, and its worker's under
 * `subagents/{call}`): the newest page, with the cursor a reader follows
 * on from past it, or, where `before` names the oldest row a reader holds,
 * the page below it, so a desktop opening a long transcript draws its end
 * first and reads back only as far as it is scrolled.
 */

import { childTitlesOf } from "@luke/database/models/child-titles";
import { type CodingAgent, readCodingAgent } from "@luke/database/models/coding-agent-store";
import { readRewoundRevision } from "@luke/database/models/conversation-rewind";
import { childConversationId } from "@luke/database/models/ids";
import { listProviderKeyRows } from "@luke/database/models/provider-key-store";
import { type ConversationTarget, storeWriter } from "@luke/database/models/writer";
import { MESSAGE_SENDER } from "@luke/database/storage-vocabulary";
import {
  CODING_AGENT_BOUNDS,
  CODING_AGENT_CURSOR_START,
  CODING_AGENT_STATUS,
  type CodingAgentMessage,
  type CodingAgentMessagesAnswer,
  type CodingAgentNewestAnswer,
  type CodingAgentOlderAnswer,
  type CodingAgentPartAnswer,
  codingAgentBeforeSchema,
  codingAgentCallIdSchema,
  codingAgentCursorSchema,
  TRANSCRIPT_PARTS_QUERY,
} from "@luke/features/coding-agent-wire";
import { TRANSCRIPT_NOW_QUERY } from "@luke/features/live-wire";
import { PROVIDER_KEY_KIND } from "@luke/features/provider-key-wire";
import { isRecord } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { middlewareGen } from "@orpc/experimental-effect";
import { ORPCError } from "@orpc/server";
import { Effect, Option, Result, Schema } from "effect";
import { unparsedWire, wireUuidSchema } from "../core.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
  type UserIdResolver,
} from "../http/http-effect.js";
import { accountMiddleware, type HostedContext, hosted } from "../orpc/base.js";
import type { EveTypedTurn } from "./brain-host/eve-sessions.js";
import { cutMessage, wholePartOf } from "./coder-host/part-cut.js";
import { startedBlank } from "./coder-host/status.js";
import { steerCodingAgentWritten } from "./coder-host/steer.js";
import { type EveReach, eveFor, summaryOf } from "./coder-host/stop.js";
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
import {
  joinWorkspaceChatAsPerson,
  readWorkspaceChat,
  workspaceOf,
  writeWorkspaceChat,
} from "./workspace-chat.js";

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

/** Where a read back from the end names it reads below, or none for the newest page; refused where it names something else. */
const beforeNamed = /* @__PURE__ */ Effect.fnUntraced(function* (
  before: string | undefined,
): Effect.fn.Return<number | undefined, HostedRefusal> {
  if (before === undefined) return undefined;
  const read = readEither(codingAgentBeforeSchema)(unparsedWire(before));
  const seq = Result.isFailure(read) ? Number.NaN : Number(read.success);
  if (!Number.isSafeInteger(seq)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  return seq;
});

/**
 * Whether the agent's owner's titles are told by a model, which may land
 * after its turn ends: only where the owner saved an API key, which the
 * title model runs on (`coder-host/model.ts`). Without one a title is the
 * opening's first words, written as the words are received, so no read
 * waits on it.
 */
const titledByModel = (parent: ConversationTarget) =>
  Effect.map(
    listProviderKeyRows(parent.userId, PROVIDER_KEY_KIND.API_KEY),
    (rows) => rows.length > 0,
  );

/**
 * What a read of an ended agent, or of its worker, waits on for a title:
 * the worker named, or the agent's own or any of its workers' where none
 * is; nothing for an owner whose titles no model tells (`titledByModel`).
 */
function titleAwaitedOf(parent: ConversationTarget, childConversationId?: string): TitleAwaited {
  return Effect.flatMap(titledByModel(parent), (byModel) =>
    byModel ? titleMayLand(parent, childConversationId) : NO_TITLE_AWAITED,
  );
}

/**
 * A page's messages as the wire declares them: each part the stored JSON
 * the row holds, which the SDK's own types describe more narrowly than the
 * wire's verbatim JSON does.
 */
function wireMessages(
  messages: TranscriptPage["messages"] | readonly CodingAgentMessage[],
  cut: boolean,
): CodingAgentMessagesAnswer["messages"] {
  // SAFETY: every part and metadata is the JSON its row stored (`storedObjectSchema`), which the SDK's part types only name more narrowly.
  const stored = messages as CodingAgentMessagesAnswer["messages"];
  return cut ? stored.map(cutMessage) : stored;
}

/** Whether a transcript read asks its heavy parts cut (`TRANSCRIPT_PARTS_QUERY`). */
function readsCut(parts: string | undefined): boolean {
  return parts === TRANSCRIPT_PARTS_QUERY.CUT;
}

/** A part's index as its path segment spells it, or not found for one that is no index. */
const indexNamed = /* @__PURE__ */ Effect.fnUntraced(function* (
  index: string,
): Effect.fn.Return<number, HostedRefusal> {
  if (!/^\d{1,6}$/u.test(index)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return Number(index);
});

/** One part of a message of the conversation, whole, or not found where none stands at the index. */
const partAnswer = /* @__PURE__ */ Effect.fnUntraced(function* (
  target: ConversationTarget,
  message: string,
  index: string,
) {
  const messageId = yield* uuidNamed(message);
  const at = yield* indexNamed(index);
  const part = yield* hostedStoreOrUnavailable(wholePartOf(target, CODER_TOOL_SET, messageId, at));
  if (Option.isNone(part) || !isRecord(part.value)) {
    return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  }
  const answer: CodingAgentPartAnswer = { part: part.value };
  return answer;
});

/** When the window of every title `titleAwaitedOf` waits on closes, on the same terms: none where no model tells the owner's titles. */
function titleEdgeOf(parent: ConversationTarget, childConversationId?: string): TitleEdge {
  return Effect.flatMap(titledByModel(parent), (byModel) =>
    byModel ? titleWindowEdge(parent, childConversationId) : NO_TITLE_EDGE,
  );
}

/** Whether a transcript read asks for the page at once rather than held, as a reader following its live statements does (`live-wire.ts`). */
function readsNow(wait: string | undefined): boolean {
  return wait === TRANSCRIPT_NOW_QUERY.NONE;
}

/** A page of an agent's or a worker's transcript as the wire answers it, with whether the held read would have held on it where it was read at once, and how soon the clock alone may end that hold. */
function transcriptAnswer(
  page: TranscriptPage,
  title: string | null,
  cut: boolean,
  holds?: boolean,
  wakeIn?: number,
): CodingAgentMessagesAnswer & { readonly holds?: boolean; readonly wakeIn?: number } {
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
    ...(page.usage === undefined ? undefined : { usage: page.usage }),
    ...(page.context === undefined ? undefined : { context: page.context }),
  };
}

/** A transcript's newest page as the wire answers it, with where the page before it is read below. */
function newestAnswer(
  newest: TranscriptNewest,
  title: string | null,
  cut: boolean,
): CodingAgentNewestAnswer {
  return {
    ...transcriptAnswer(newest.page, title, cut),
    ...(newest.before === undefined ? undefined : { before: String(newest.before) }),
  };
}

/** An older page of a transcript as the wire answers it. */
function olderAnswer(older: TranscriptOlder, cut: boolean): CodingAgentOlderAnswer {
  return {
    messages: wireMessages(older.messages, cut),
    ...(older.before === undefined ? undefined : { before: String(older.before) }),
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

/** The messages resource: its five held reads, the two transcripts read back from their end, the two writes on their paths, and the two part reads, each to a signed-in caller. */
export function messagesProcedures(seams: MessagesProcedureSeams) {
  const signedIn = hosted.messages.use(accountMiddleware(seams.resolveUserId));
  const writer = storeWriter({ tools: CODER_TOOL_SET });
  return {
    agent: signedIn.agent.effect(function* ({ input, context }) {
      const after = (yield* cursorNamed(input.after)) ?? CODING_AGENT_CURSOR_START;
      const { agent, target } = yield* reachedAgent(context.userId, input.id);
      const titleAwaited = titleAwaitedOf(target);
      const cursor = cursorOfWire(after);
      const standing = { createdAt: agent.createdAt, blank: startedBlank(agent) };
      // Note that a cursor read before the transcript's last rewind is answered at once, never held, since its reader reads afresh.
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
                transcriptPast(target, CODER_TOOL_SET, cursor, standing, agent, titleAwaited),
              ),
              holds: undefined,
              wakeIn: undefined,
            };
      // The title is read after the page, since it lands after a turn ends, which a held read may span.
      const titled = yield* hostedStoreOrUnavailable(readCodingAgent(context.userId, agent.id));
      return {
        ...transcriptAnswer(
          page,
          Option.match(titled, {
            onNone: () => agent.title,
            onSome: (now: CodingAgent) => now.title,
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
        const eve = yield* eveFor<EveTypedTurn>(seams, context.request, context.userId);
        const { txid } = yield* steerCodingAgentWritten(eve, writer, context.userId, agent, {
          ...input.body,
          sender: { kind: MESSAGE_SENDER.MEMBER, userId: context.userId },
        });
        const summary = yield* summaryOf(context.userId, agent);
        // The transaction that wrote the line, which the host waits to see live before it confirms the send.
        return txid === undefined ? { agent: summary } : { agent: summary, txid };
      }),

    agentWorker: signedIn.agentWorker.effect(function* ({ input, context }) {
      const after = (yield* cursorNamed(input.after)) ?? CODING_AGENT_CURSOR_START;
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
          { messages: [], cursor: cursorOfWire(after), status: CODING_AGENT_STATUS.STARTING },
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
              transcriptPast(worker, CODER_TOOL_SET, cursor, started, undefined, titleAwaited),
            ),
            holds: undefined,
            wakeIn: undefined,
          };
      // The title is read after the page, since it lands beside the worker's start, which a held read may span.
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
      // The rewind is read before the page, so a page read after a rewind never carries the one before it.
      const rewound = yield* hostedStoreOrUnavailable(readRewoundRevision(target));
      const newest = yield* hostedStoreOrUnavailable(
        transcriptNewest(target, CODER_TOOL_SET, standing, agent),
      );
      // The title is read after the page, as the forward read's is, so one that landed while the page was read is told rather than lost to a follow that starts after it.
      const titled = yield* hostedStoreOrUnavailable(readCodingAgent(context.userId, agent.id));
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
        // The call's record has not landed yet, so its worker has written nothing.
        if (before !== undefined) return olderAnswer({ messages: [] }, false);
        return newestAnswer(
          {
            page: {
              messages: [],
              cursor: cursorOfWire(CODING_AGENT_CURSOR_START),
              status: CODING_AGENT_STATUS.STARTING,
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
      // The title is read after the page, since it lands beside the worker's start, which the page's reads may span.
      const titles = yield* hostedStoreOrUnavailable(childTitlesOf(target, [conversationId]));
      return newestAnswer(newest, titles.get(conversationId) ?? null, readsCut(input.parts));
    }),

    chat: signedIn.chat.effect(function* ({ input, context }) {
      return yield* readWorkspaceChat(context.userId, input);
    }),

    chatWrite: hosted.messages
      .use(accountMiddleware(seams.resolveUserId))
      .chatWrite.effect(function* ({ input, context }) {
        const workspaceId = yield* workspaceOf(input.query.workspaceId);
        if ("join" in input.body) {
          return yield* joinWorkspaceChatAsPerson(context.userId, workspaceId);
        }
        return yield* writeWorkspaceChat(seams, context.userId, workspaceId, input.body);
      }),
  };
}
