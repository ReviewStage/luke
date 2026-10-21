import type { DatabaseServices, QueryError } from "@luke/database/core/query";
import { readCodingAgent, readCodingAgentRouting } from "@luke/database/models/coding-agent-store";
import type { ConversationTarget, StoreWriter } from "@luke/database/models/writer";
import { CONVERSATION_RUNTIME } from "@luke/database/storage-vocabulary";
import { Data, Effect, Option, type Schema, type Scope } from "effect";
import type { BRAIN_HOST_TURN } from "../agents/brain-host/bounds.js";
import type { AgentSessions, EveMount } from "../agents/brain-host/eve-sessions.js";
import { CALL_BACKEND } from "./call-backend.js";
import {
  type AttachedSession,
  type ExchangeAttachment,
  type HostedLiveExchange,
  hostedLiveExchange,
} from "./live-exchange.js";
import { upstreamSideband } from "./live-sideband.js";

/**
 * The hosted exchange as the voice service is offered it, one per signed-in
 * session: the agent's conversation the session is bound to resolved at the
 * session's start, the writer the function already holds for that
 * conversation's tools, and eve reached as the deployment for the calling
 * account under the mount the agent runs on. This is the whole of what `VoiceServiceOptions.exchange` takes,
 * kept apart from the function's composition, which passes it composed over
 * the deployment's seams (`deployment-exchange.ts`).
 *
 * One socket, one scope. The attachment builds the whole standing — the
 * conversation, the exchange, and its adoption of the sideband — as
 * one effect in the scope the service provides, and that scope's close is
 * the exchange's stop. A standing that could not be reached
 * fails in that scope, so the service closing it gives back everything the
 * attempt acquired before the session is refused.
 */

interface ExchangeAttachmentDeps {
  /** The store writer an agent's rows are written through, holding them to the tools it may call. */
  readonly writer: StoreWriter;
  /** eve as the deployment reaches it for one account under one mount, for a spoken ask alone, composed by the caller so no secret enters here. */
  readonly eve: (
    accountId: string,
    mount: EveMount,
  ) => AgentSessions<typeof BRAIN_HOST_TURN.SPOKEN>;
  readonly createId: () => string;
  /** Where a standing exchange's own reports go. */
  readonly report: (message: string) => void;
}

/** A session whose sideband the exchange could not stand on; the service refuses the session on it. */
class ExchangeCannotStand extends Data.TaggedError("ExchangeCannotStand")<{
  readonly message: string;
}> {}

const EXCHANGE_CANNOT_STAND_MESSAGE = "the exchange could not stand on the session's sideband";

const AGENT_GONE_MESSAGE = "the agent the session is bound to no longer stands";

const NATIVE_AGENT_MESSAGE = "the agent the session is bound to runs on a native harness, not eve";

/** A conversation found, or the refusal that the session's binding names none. */
function found(
  conversation: Option.Option<ConversationTarget>,
  gone: string,
): Effect.Effect<ConversationTarget, ExchangeCannotStand> {
  return Option.match(conversation, {
    onNone: () => Effect.fail(new ExchangeCannotStand({ message: gone })),
    onSome: (target) => Effect.succeed(target),
  });
}

/**
 * The conversation a call lands in: the agent's, under the member who
 * started it, whoever is calling. An agent deleted since the session was
 * created, or one the account no longer reaches, has none to offer, and the
 * session is refused. So is an agent whose conversation a native harness
 * (Claude Code or Codex) answers, whenever the session was admitted: a
 * call's asks reach eve alone, and eve must never answer a conversation
 * beside its harness.
 */
const sessionConversation = (session: AttachedSession) =>
  Effect.gen(function* () {
    const agent = yield* readCodingAgent(session.accountId, session.agentId);
    const routing = yield* readCodingAgentRouting(session.accountId, session.agentId);
    if (Option.isSome(routing) && routing.value.runtime !== CONVERSATION_RUNTIME.EVE) {
      return yield* Effect.fail(new ExchangeCannotStand({ message: NATIVE_AGENT_MESSAGE }));
    }
    return yield* found(
      Option.map(agent, (held) => ({
        userId: held.userId,
        conversationId: held.conversationId,
      })),
      AGENT_GONE_MESSAGE,
    );
  });

export function exchangeAttachment(deps: ExchangeAttachmentDeps): ExchangeAttachment {
  return (
    session,
  ): Effect.Effect<
    HostedLiveExchange,
    QueryError | Schema.SchemaError | ExchangeCannotStand,
    Scope.Scope | DatabaseServices
  > =>
    Effect.gen(function* () {
      const conversation = yield* sessionConversation(session);
      const exchange = yield* hostedLiveExchange({
        accountId: session.accountId,
        liveSessionId: session.sessionId,
        conversation,
        backend: CALL_BACKEND,
        timeZone: session.timeZone,
        writer: deps.writer,
        eve: deps.eve(session.accountId, CALL_BACKEND.mount),
        createId: deps.createId,
        report: deps.report,
        ...(session.onActivity ? { onActivity: session.onActivity } : undefined),
        ...(session.onCode ? { onCode: session.onCode } : undefined),
        ...(session.onCallEnding ? { onCallEnding: session.onCallEnding } : undefined),
        ...(session.onTrace ? { onTrace: session.onTrace } : undefined),
      });
      const adopted = yield* exchange.adopt({
        sessionId: session.sessionId,
        attach: () => upstreamSideband(session.sideband),
        started: session.started,
      });
      if (!adopted)
        return yield* Effect.fail(
          new ExchangeCannotStand({ message: EXCHANGE_CANNOT_STAND_MESSAGE }),
        );
      return exchange;
    });
}
