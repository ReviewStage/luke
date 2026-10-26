/**
 * agent-inbox-procedures.ts -- the Inbox's asks of the host.
 *
 * The one check these procedures make is who asked, as for every task act:
 * only a panel draws the Inbox, so every one refuses the takeover and the
 * hidden voice window, in its own sentence. What the service answers comes
 * back as the panel's own answer. A task's or an agent's inbox is followed
 * while a panel holds its stream open: the host follows one on the first stream of it and
 * lets it go with the last, and every change it tells reaches every stream
 * of it. How many streams stand open of each is all else held here; the
 * notices (`@luke/host/agent-notices`) watch what waits across the account
 * on a read of their own.
 */

import type {
  CodingAgentInboxAnsweredView,
  CodingAgentInboxAnswerParams,
  CodingAgentInboxAttachmentParams,
  CodingAgentInboxAttachmentView,
  CodingAgentInboxChanged,
  CodingAgentInboxCloseParams,
  CodingAgentInboxMessagedView,
  CodingAgentInboxMessageParams,
  CodingAgentInboxReadStateParams,
  CodingAgentInboxReadStateView,
  CodingAgentInboxScope,
  CodingAgentPictureParams,
} from "@luke/features/coding-agent-view";
import { Effect, MutableHashMap, Option, Stream } from "effect";
import { AGENT_INBOX_ACT_KIND } from "../contract/index.js";
import { type ActSender, actPort } from "./base.js";
import { followedStream, type OpenFollows, streamed } from "./followed-stream.js";

/** What the Inbox procedures reach: the host's asks of the service. */
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
    codingAgentInboxReadState(
      params: CodingAgentInboxReadStateParams,
    ): Effect.Effect<CodingAgentInboxReadStateView>;
    codingAgentInboxAttachment(
      params: CodingAgentInboxAttachmentParams,
    ): Effect.Effect<CodingAgentInboxAttachmentView>;
    codingAgentPicture(
      params: CodingAgentPictureParams,
    ): Effect.Effect<CodingAgentInboxAttachmentView>;
  };
}

/** The refusal a window that draws no Inbox hears, or nothing for a panel. */
function refuseUnlessPanel<E>(actor: ActSender, refused: () => E): Effect.Effect<void, E> {
  return actor.panel ? Effect.void : Effect.fail(refused());
}

export function agentInboxProcedures(dependencies: AgentInboxProceduresDependencies) {
  const { host } = dependencies;
  /** Every inbox a window holds a stream open of, so the host lets one go only with the last. */
  const openInboxes: OpenFollows<CodingAgentInboxChanged["inbox"], CodingAgentInboxScope> =
    MutableHashMap.empty();
  return {
    [AGENT_INBOX_ACT_KIND.CODING_AGENTS_INBOX_FOLLOW]: actPort[
      AGENT_INBOX_ACT_KIND.CODING_AGENTS_INBOX_FOLLOW
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      const changes = followedStream(
        {
          keyOf: (scope: CodingAgentInboxScope) => ({ kind: scope.kind, id: scope.id }),
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
    [AGENT_INBOX_ACT_KIND.CODING_AGENTS_INBOX_READ_STATE]: actPort[
      AGENT_INBOX_ACT_KIND.CODING_AGENTS_INBOX_READ_STATE
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.codingAgentInboxReadState(input);
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
  };
}
