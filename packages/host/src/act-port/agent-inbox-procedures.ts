/**
 * agent-inbox-procedures.ts -- the Inbox's holds and Try agains, which stay procedures of their own beside its declared acts (`contract/agent-inbox.ts`).
 *
 * The one check these procedures make is who asked, as for every task act:
 * only a panel draws the Inbox, so every one refuses the takeover and any
 * other window, in its own sentence. A task's or an agent's inbox is held
 * followed while a panel holds its stream open: the host holds one on the
 * first stream of it and lets it go with the last, and what it holds
 * reaches every panel on app state, never down the stream, which carries
 * nothing. How many streams stand open of each is all else held here. Every
 * item the account reaches reaches a panel on app state the same way, so a
 * panel asks only that either be read again; the notices
 * (`@repo/host/agent-notices`) watch what waits across the account on a
 * read of their own.
 */

import type { AgentInboxScope } from "@repo/features/agent-view";
import { Effect, MutableHashMap, Option, Stream } from "effect";
import { AGENT_INBOX_ACT_KIND } from "../contract/index.js";
import { type ActSender, actPort } from "./base.js";
import { followedStream, type OpenFollows, streamed } from "./followed-stream.js";

/** What the Inbox's holds reach: the host's follows of the service. */
export interface AgentInboxProceduresDependencies {
  host: {
    /** A task's or agent's inbox held followed at the host while any stream of it stands; what it holds reaches the panel on app state. */
    agentInboxFollow(scope: AgentInboxScope): Effect.Effect<void>;
    agentInboxUnfollow(scope: AgentInboxScope): Effect.Effect<void>;
    /** A held task's or agent's inbox read again at once, as Try again asks. */
    agentInboxRetry(scope: AgentInboxScope): Effect.Effect<void>;
    /** Every item the account reaches read again at once, as Try again asks. */
    agentInboxItemsRetry(): Effect.Effect<void>;
  };
}

/** The refusal a window that draws no Inbox hears, or nothing for a panel. */
function refuseUnlessPanel<E>(actor: ActSender, refused: () => E): Effect.Effect<void, E> {
  return actor.panel ? Effect.void : Effect.fail(refused());
}

export function agentInboxProcedures(dependencies: AgentInboxProceduresDependencies) {
  const { host } = dependencies;
  /** Every inbox a window holds a stream open of, so the host lets one go only with the last. */
  const openInboxes: OpenFollows<never, AgentInboxScope> = MutableHashMap.empty();
  return {
    [AGENT_INBOX_ACT_KIND.AGENTS_INBOX_FOLLOW]: actPort[
      AGENT_INBOX_ACT_KIND.AGENTS_INBOX_FOLLOW
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      // Note that nothing is heard down the hold, since the held inbox reaches the panel on app state.
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
  };
}
