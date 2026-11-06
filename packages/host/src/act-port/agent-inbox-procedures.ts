import type {
  AgentInboxAnsweredView,
  AgentInboxAnswerParams,
  AgentInboxAttachmentParams,
  AgentInboxAttachmentView,
  AgentInboxCloseParams,
  AgentInboxItemHomeParams,
  AgentInboxItemHomeView,
  AgentInboxMessagedView,
  AgentInboxMessageParams,
  AgentInboxReadAllParams,
  AgentInboxReadAllView,
  AgentInboxReadStateParams,
  AgentInboxReadStateView,
  AgentInboxRemindParams,
  AgentInboxScope,
  AgentInboxStartParams,
  AgentPictureParams,
} from "@repo/features/agent-view";
import { Effect, MutableHashMap, Option, Stream } from "effect";
import { AGENT_INBOX_ACT_KIND } from "../contract/index.js";
import { type ActSender, actPort } from "./base.js";
import { followedStream, type OpenFollows, streamed } from "./followed-stream.js";

export interface AgentInboxProceduresDependencies {
  host: {
    agentInboxFollow(scope: AgentInboxScope): Effect.Effect<void>;
    agentInboxUnfollow(scope: AgentInboxScope): Effect.Effect<void>;
    agentInboxRetry(scope: AgentInboxScope): Effect.Effect<void>;
    agentInboxItemsRetry(): Effect.Effect<void>;
    agentInboxAnswer(params: AgentInboxAnswerParams): Effect.Effect<AgentInboxAnsweredView>;
    agentInboxClose(params: AgentInboxCloseParams): Effect.Effect<AgentInboxAnsweredView>;
    agentInboxMessage(params: AgentInboxMessageParams): Effect.Effect<AgentInboxMessagedView>;
    agentInboxStart(params: AgentInboxStartParams): Effect.Effect<AgentInboxMessagedView>;
    agentInboxReadState(params: AgentInboxReadStateParams): Effect.Effect<AgentInboxReadStateView>;
    agentInboxRemind(params: AgentInboxRemindParams): Effect.Effect<AgentInboxReadStateView>;
    agentInboxItemHome(params: AgentInboxItemHomeParams): Effect.Effect<AgentInboxItemHomeView>;
    agentInboxReadAll(params: AgentInboxReadAllParams): Effect.Effect<AgentInboxReadAllView>;
    agentInboxAttachment(
      params: AgentInboxAttachmentParams,
    ): Effect.Effect<AgentInboxAttachmentView>;
    agentPicture(params: AgentPictureParams): Effect.Effect<AgentInboxAttachmentView>;
  };
}

function refuseUnlessPanel<E>(actor: ActSender, refused: () => E): Effect.Effect<void, E> {
  return actor.panel ? Effect.void : Effect.fail(refused());
}

export function agentInboxProcedures(dependencies: AgentInboxProceduresDependencies) {
  const { host } = dependencies;
  const openInboxes: OpenFollows<never, AgentInboxScope> = MutableHashMap.empty();
  return {
    [AGENT_INBOX_ACT_KIND.AGENTS_INBOX_FOLLOW]: actPort[
      AGENT_INBOX_ACT_KIND.AGENTS_INBOX_FOLLOW
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      const hold = followedStream(
        {
          keyOf: (scope: AgentInboxScope) => ({ kind: scope.kind, id: scope.id }),
          follow: host.agentInboxFollow,
          unfollow: host.agentInboxUnfollow,
          onChanged: () => () => undefined,
          valueOf: () => Option.none<never>(),
        },
        openInboxes,
        input,
      );
      return streamed(yield* Stream.toAsyncIterableEffect(hold));
    }),
    [AGENT_INBOX_ACT_KIND.AGENTS_INBOX_RETRY]: actPort[
      AGENT_INBOX_ACT_KIND.AGENTS_INBOX_RETRY
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      yield* host.agentInboxRetry(input);
    }),
    [AGENT_INBOX_ACT_KIND.AGENTS_INBOX_ITEMS_RETRY]: actPort[
      AGENT_INBOX_ACT_KIND.AGENTS_INBOX_ITEMS_RETRY
    ].effect(function* ({ context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      yield* host.agentInboxItemsRetry();
    }),
    [AGENT_INBOX_ACT_KIND.AGENTS_INBOX_ANSWER]: actPort[
      AGENT_INBOX_ACT_KIND.AGENTS_INBOX_ANSWER
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.agentInboxAnswer(input);
    }),
    [AGENT_INBOX_ACT_KIND.AGENTS_INBOX_CLOSE]: actPort[
      AGENT_INBOX_ACT_KIND.AGENTS_INBOX_CLOSE
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.agentInboxClose(input);
    }),
    [AGENT_INBOX_ACT_KIND.AGENTS_INBOX_MESSAGE]: actPort[
      AGENT_INBOX_ACT_KIND.AGENTS_INBOX_MESSAGE
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.agentInboxMessage(input);
    }),
    [AGENT_INBOX_ACT_KIND.AGENTS_INBOX_START]: actPort[
      AGENT_INBOX_ACT_KIND.AGENTS_INBOX_START
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.agentInboxStart(input);
    }),
    [AGENT_INBOX_ACT_KIND.AGENTS_INBOX_READ_STATE]: actPort[
      AGENT_INBOX_ACT_KIND.AGENTS_INBOX_READ_STATE
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.agentInboxReadState(input);
    }),
    [AGENT_INBOX_ACT_KIND.AGENTS_INBOX_REMIND]: actPort[
      AGENT_INBOX_ACT_KIND.AGENTS_INBOX_REMIND
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.agentInboxRemind(input);
    }),
    [AGENT_INBOX_ACT_KIND.AGENTS_INBOX_ITEM_HOME]: actPort[
      AGENT_INBOX_ACT_KIND.AGENTS_INBOX_ITEM_HOME
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.agentInboxItemHome(input);
    }),
    [AGENT_INBOX_ACT_KIND.AGENTS_INBOX_READ_ALL]: actPort[
      AGENT_INBOX_ACT_KIND.AGENTS_INBOX_READ_ALL
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.agentInboxReadAll(input);
    }),
    [AGENT_INBOX_ACT_KIND.AGENTS_INBOX_ATTACHMENT]: actPort[
      AGENT_INBOX_ACT_KIND.AGENTS_INBOX_ATTACHMENT
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.agentInboxAttachment(input);
    }),
    [AGENT_INBOX_ACT_KIND.AGENTS_PICTURE]: actPort[AGENT_INBOX_ACT_KIND.AGENTS_PICTURE].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        return yield* host.agentPicture(input);
      },
    ),
  };
}
