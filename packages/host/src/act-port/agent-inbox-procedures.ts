/**
 * agent-inbox-procedures.ts -- the Inbox's and the workspace chat's asks of the host.
 *
 * The one check these procedures make is who asked, as for every task act:
 * only a panel draws the Inbox and the chat, so every one refuses the
 * takeover and the hidden voice window, in its own sentence. What the
 * service answers comes back as the panel's own answer. The task's inbox is
 * answered to the panel alone: the notices (`@luke/host/agent-notices`)
 * watch what waits across the account on a read of their own. A
 * workspace's chat is followed while a panel holds its stream open
 * (`CODING_AGENTS_CHAT_FOLLOW`): the host follows it on the first stream of
 * it and lets it go with the last, and every change it tells reaches every
 * stream of it. How many streams stand open of each chat is all else held
 * here.
 */

import type {
  CodingAgentAgentInboxParams,
  CodingAgentChatAnswerView,
  CodingAgentChatAttachmentParams,
  CodingAgentChatChanged,
  CodingAgentChatPostParams,
  CodingAgentChatWriteAnswerView,
  CodingAgentInboxAnsweredView,
  CodingAgentInboxAnswerParams,
  CodingAgentInboxAnswerView,
  CodingAgentInboxAttachmentParams,
  CodingAgentInboxAttachmentView,
  CodingAgentInboxCloseParams,
  CodingAgentInboxMessagedView,
  CodingAgentInboxMessageParams,
  CodingAgentInboxParams,
  CodingAgentInboxReadAllView,
  CodingAgentInboxReadStateParams,
  CodingAgentInboxReadStateView,
  CodingAgentPictureParams,
} from "@luke/features/coding-agent-view";
import type { InboxReadAllRequest } from "@luke/features/inbox-wire";
import { Effect, Queue, Semaphore, Stream } from "effect";
import { AGENT_INBOX_ACT_KIND } from "../contract/index.js";
import { type ActSender, actPort } from "./base.js";

/** What the Inbox and chat procedures reach: the host's asks of the service. */
export interface AgentInboxProceduresDependencies {
  host: {
    codingAgentInbox(params: CodingAgentInboxParams): Effect.Effect<CodingAgentInboxAnswerView>;
    codingAgentAgentInbox(
      params: CodingAgentAgentInboxParams,
    ): Effect.Effect<CodingAgentInboxAnswerView>;
    codingAgentInboxAnswer(
      params: CodingAgentInboxAnswerParams,
    ): Effect.Effect<CodingAgentInboxAnsweredView>;
    codingAgentInboxClose(
      params: CodingAgentInboxCloseParams,
    ): Effect.Effect<CodingAgentInboxAnsweredView>;
    codingAgentInboxMessage(
      params: CodingAgentInboxMessageParams,
    ): Effect.Effect<CodingAgentInboxMessagedView>;
    codingAgentInboxReadState(
      params: CodingAgentInboxReadStateParams,
    ): Effect.Effect<CodingAgentInboxReadStateView>;
    codingAgentInboxReadAll(
      params: InboxReadAllRequest,
    ): Effect.Effect<CodingAgentInboxReadAllView>;
    codingAgentInboxAttachment(
      params: CodingAgentInboxAttachmentParams,
    ): Effect.Effect<CodingAgentInboxAttachmentView>;
    codingAgentPicture(
      params: CodingAgentPictureParams,
    ): Effect.Effect<CodingAgentInboxAttachmentView>;
    codingAgentChatPost(
      params: CodingAgentChatPostParams,
    ): Effect.Effect<CodingAgentChatWriteAnswerView>;
    codingAgentChatAttachment(
      params: CodingAgentChatAttachmentParams,
    ): Effect.Effect<CodingAgentInboxAttachmentView>;
    codingAgentChatFollow(workspaceId: string): Effect.Effect<void>;
    codingAgentChatUnfollow(workspaceId: string): Effect.Effect<void>;
    onChatChanged(listener: (changed: CodingAgentChatChanged) => void): () => void;
  };
}

/** The refusal a window that draws no Inbox hears, or nothing for a panel. */
function refuseUnlessPanel<E>(actor: ActSender, refused: () => E): Effect.Effect<void, E> {
  return actor.panel ? Effect.void : Effect.fail(refused());
}

/**
 * An async iterable as the iterator oRPC streams. Note that its end is
 * handed straight to the iterable's own, rather than through an async
 * generator, which would queue the end behind a read still waiting for the
 * next change and so never close the stream.
 */
function streamed<A>(iterable: AsyncIterable<A>): AsyncIteratorObject<A, undefined, unknown> {
  const iterator = iterable[Symbol.asyncIterator]();
  const ended = async (): Promise<IteratorReturnResult<undefined>> => {
    await iterator.return?.();
    return { done: true, value: undefined };
  };
  const self: AsyncIteratorObject<A, undefined, unknown> = {
    next: async () => {
      const read = await iterator.next();
      return read.done === true ? { done: true, value: undefined } : read;
    },
    return: ended,
    [Symbol.asyncIterator]: () => self,
    [Symbol.asyncDispose]: async () => {
      await ended();
    },
  };
  return self;
}

/**
 * A workspace's chat for one stream a panel holds open: the host follows it
 * as the first stream of it opens, so the panel hears it whole, and lets it
 * go once the last stream of it closes. Every change the host tells of it
 * reaches every stream of it.
 */
function chatChanges(
  host: AgentInboxProceduresDependencies["host"],
  open: Map<string, number>,
  turns: Semaphore.Semaphore,
  workspaceId: string,
): Stream.Stream<CodingAgentChatAnswerView> {
  return Stream.callback<CodingAgentChatAnswerView>((queue) =>
    Effect.gen(function* () {
      yield* Effect.acquireRelease(
        Effect.sync(() =>
          host.onChatChanged((changed) => {
            if (changed.workspaceId === workspaceId) Queue.offerUnsafe(queue, changed.chat);
          }),
        ),
        (stop) => Effect.sync(stop),
      );
      // Note that each count change and its ask of the host take a turn, so a last stream's
      // unfollow reaches the host before a new stream's follow, never after it.
      yield* Effect.acquireRelease(
        turns.withPermit(
          Effect.suspend(() => {
            const standing = open.get(workspaceId) ?? 0;
            open.set(workspaceId, standing + 1);
            // Note that a later stream asks the host again too, so it hears the chat whole at once.
            return host.codingAgentChatFollow(workspaceId);
          }),
        ),
        () =>
          turns.withPermit(
            Effect.suspend(() => {
              const left = (open.get(workspaceId) ?? 1) - 1;
              if (left > 0) {
                open.set(workspaceId, left);
                return Effect.void;
              }
              open.delete(workspaceId);
              return host.codingAgentChatUnfollow(workspaceId);
            }),
          ),
      );
    }),
  );
}

export function agentInboxProcedures(dependencies: AgentInboxProceduresDependencies) {
  const { host } = dependencies;
  /** How many streams stand open of each workspace's chat, so the host lets one go only with the last. */
  const openChats = new Map<string, number>();
  /**
   * One turn at a time for a chat stream's follow or unfollow, per workspace,
   * so the host hears a workspace's in the order its streams opened and
   * closed and one workspace's slow ask never holds another's. Note that a
   * turn is kept once made: one per workspace the window has followed.
   */
  const chatTurns = new Map<string, Semaphore.Semaphore>();
  const turnOf = (workspaceId: string): Semaphore.Semaphore => {
    const standing = chatTurns.get(workspaceId);
    if (standing !== undefined) return standing;
    const made = Semaphore.makeUnsafe(1);
    chatTurns.set(workspaceId, made);
    return made;
  };
  return {
    [AGENT_INBOX_ACT_KIND.CODING_AGENTS_INBOX]: actPort[
      AGENT_INBOX_ACT_KIND.CODING_AGENTS_INBOX
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.codingAgentInbox(input);
    }),
    [AGENT_INBOX_ACT_KIND.CODING_AGENTS_AGENT_INBOX]: actPort[
      AGENT_INBOX_ACT_KIND.CODING_AGENTS_AGENT_INBOX
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.codingAgentAgentInbox(input);
    }),
    [AGENT_INBOX_ACT_KIND.CODING_AGENTS_INBOX_ANSWER]: actPort[
      AGENT_INBOX_ACT_KIND.CODING_AGENTS_INBOX_ANSWER
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.codingAgentInboxAnswer(input);
    }),
    [AGENT_INBOX_ACT_KIND.CODING_AGENTS_INBOX_CLOSE]: actPort[
      AGENT_INBOX_ACT_KIND.CODING_AGENTS_INBOX_CLOSE
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.codingAgentInboxClose(input);
    }),
    [AGENT_INBOX_ACT_KIND.CODING_AGENTS_INBOX_MESSAGE]: actPort[
      AGENT_INBOX_ACT_KIND.CODING_AGENTS_INBOX_MESSAGE
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.codingAgentInboxMessage(input);
    }),
    [AGENT_INBOX_ACT_KIND.CODING_AGENTS_INBOX_READ_STATE]: actPort[
      AGENT_INBOX_ACT_KIND.CODING_AGENTS_INBOX_READ_STATE
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.codingAgentInboxReadState(input);
    }),
    [AGENT_INBOX_ACT_KIND.CODING_AGENTS_INBOX_READ_ALL]: actPort[
      AGENT_INBOX_ACT_KIND.CODING_AGENTS_INBOX_READ_ALL
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.codingAgentInboxReadAll(input);
    }),
    [AGENT_INBOX_ACT_KIND.CODING_AGENTS_INBOX_ATTACHMENT]: actPort[
      AGENT_INBOX_ACT_KIND.CODING_AGENTS_INBOX_ATTACHMENT
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.codingAgentInboxAttachment(input);
    }),
    // Note that the picture's answer, a failure among them, is the panel's to read, as an inbox image's is.
    [AGENT_INBOX_ACT_KIND.CODING_AGENTS_PICTURE]: actPort[
      AGENT_INBOX_ACT_KIND.CODING_AGENTS_PICTURE
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.codingAgentPicture(input);
    }),
    [AGENT_INBOX_ACT_KIND.CODING_AGENTS_CHAT_POST]: actPort[
      AGENT_INBOX_ACT_KIND.CODING_AGENTS_CHAT_POST
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.codingAgentChatPost(input);
    }),
    // Note that the picture's answer, a failure among them, is the panel's to read, as an inbox image's is.
    [AGENT_INBOX_ACT_KIND.CODING_AGENTS_CHAT_ATTACHMENT]: actPort[
      AGENT_INBOX_ACT_KIND.CODING_AGENTS_CHAT_ATTACHMENT
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.codingAgentChatAttachment(input);
    }),
    [AGENT_INBOX_ACT_KIND.CODING_AGENTS_CHAT_FOLLOW]: actPort[
      AGENT_INBOX_ACT_KIND.CODING_AGENTS_CHAT_FOLLOW
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      const changes = chatChanges(host, openChats, turnOf(input.workspaceId), input.workspaceId);
      return streamed(yield* Stream.toAsyncIterableEffect(changes));
    }),
  };
}
