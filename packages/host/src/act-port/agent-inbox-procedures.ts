/**
 * agent-inbox-procedures.ts -- the Inbox's and the workspace chat's asks of the host.
 *
 * The one check these procedures make is who asked, as for every task act:
 * only a panel draws the Inbox and the chat, so every one refuses the
 * takeover and the hidden voice window, in its own sentence. What the
 * service answers comes back as the panel's own answer. A task's or an
 * agent's inbox, and a workspace's chat, are each followed while a panel
 * holds its stream open: the host follows one on the first stream of it and
 * lets it go with the last, and every change it tells reaches every stream
 * of it. How many streams stand open of each is all else held here; the
 * notices (`@luke/host/agent-notices`) watch what waits across the account
 * on a read of their own.
 */

import type {
  CodingAgentChatAnswerView,
  CodingAgentChatAttachmentParams,
  CodingAgentChatChanged,
  CodingAgentChatPostParams,
  CodingAgentChatWriteAnswerView,
  CodingAgentInboxAnsweredView,
  CodingAgentInboxAnswerParams,
  CodingAgentInboxAttachmentParams,
  CodingAgentInboxAttachmentView,
  CodingAgentInboxChanged,
  CodingAgentInboxCloseParams,
  CodingAgentInboxMessagedView,
  CodingAgentInboxMessageParams,
  CodingAgentInboxReadAllView,
  CodingAgentInboxReadStateParams,
  CodingAgentInboxReadStateView,
  CodingAgentInboxScope,
  CodingAgentInboxStartParams,
  CodingAgentPictureParams,
} from "@luke/features/coding-agent-view";
import type { InboxReadAllRequest } from "@luke/features/inbox-wire";
import { Effect, MutableHashMap, Option, Queue, Semaphore, Stream } from "effect";
import { AGENT_INBOX_ACT_KIND } from "../contract/index.js";
import { type ActSender, actPort } from "./base.js";
import { followedStream, type OpenFollows, streamed } from "./followed-stream.js";

/** What the Inbox and chat procedures reach: the host's asks of the service. */
export interface AgentInboxProceduresDependencies {
  host: {
    /** A task's or agent's inbox followed at the host, heard through `onInboxChanged`; following again starts over. */
    codingAgentInboxFollow(scope: CodingAgentInboxScope): Effect.Effect<void>;
    codingAgentInboxUnfollow(scope: CodingAgentInboxScope): Effect.Effect<void>;
    onInboxChanged(listener: (changed: CodingAgentInboxChanged) => void): () => void;
    codingAgentInboxAnswer(
      params: CodingAgentInboxAnswerParams,
    ): Effect.Effect<CodingAgentInboxAnsweredView>;
    codingAgentInboxClose(
      params: CodingAgentInboxCloseParams,
    ): Effect.Effect<CodingAgentInboxAnsweredView>;
    codingAgentInboxMessage(
      params: CodingAgentInboxMessageParams,
    ): Effect.Effect<CodingAgentInboxMessagedView>;
    codingAgentInboxStart(
      params: CodingAgentInboxStartParams,
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
  /** Every inbox a window holds a stream open of, so the host lets one go only with the last. */
  const openInboxes: OpenFollows<CodingAgentInboxChanged["inbox"]> = MutableHashMap.empty();
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
    [AGENT_INBOX_ACT_KIND.CODING_AGENTS_INBOX_FOLLOW]: actPort[
      AGENT_INBOX_ACT_KIND.CODING_AGENTS_INBOX_FOLLOW
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      const changes = followedStream(
        {
          keyOf: (scope: CodingAgentInboxScope) => `${scope.kind}:${scope.id}`,
          follow: host.codingAgentInboxFollow,
          unfollow: host.codingAgentInboxUnfollow,
          onChanged: host.onInboxChanged,
          valueOf: (changed: CodingAgentInboxChanged, scope: CodingAgentInboxScope) =>
            changed.scope.kind === scope.kind && changed.scope.id === scope.id
              ? Option.some(changed.inbox)
              : Option.none(),
        },
        openInboxes,
        input,
      );
      return streamed(yield* Stream.toAsyncIterableEffect(changes));
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
    [AGENT_INBOX_ACT_KIND.CODING_AGENTS_INBOX_START]: actPort[
      AGENT_INBOX_ACT_KIND.CODING_AGENTS_INBOX_START
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.codingAgentInboxStart(input);
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
