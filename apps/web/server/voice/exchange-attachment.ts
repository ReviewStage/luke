import type { LanguageModel } from "ai";
import { Data, Effect, Option, type Schema, type Scope } from "effect";

import type { SqlClient } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import type { EveSessions } from "../hosted/brain-host/eve-sessions.js";
import { openPlanConversation } from "../hosted/plan-store.js";
import type { HostedStoreContext } from "../hosted/store/index.js";
import type { StoreWriter } from "../hosted/store/writer.js";
import {
  type ExchangeAttachment,
  type HostedLiveExchange,
  hostedLiveExchange,
} from "./live-exchange.js";
import { upstreamSideband } from "./live-sideband.js";

/**
 * The hosted exchange as the voice service is offered it, one per signed-in
 * session: the conversation of the plan the session is bound to resolved at
 * the session's start, the store context and the writer the function already
 * holds, eve reached as the deployment for that account, and a notetaker
 * writing the plan as the call goes. This is the whole of what
 * `VoiceServiceOptions.exchange` takes, kept apart from the function's
 * composition, which passes it composed over the deployment's seams
 * (`deployment-exchange.ts`).
 *
 * One socket, one scope. The attachment builds the whole standing — the
 * plan's conversation, the exchange, and its adoption of the sideband — as
 * one effect in the scope the service provides, and that scope's close is
 * the exchange's stop. A standing that could not be reached
 * fails in that scope, so the service closing it gives back everything the
 * attempt acquired before the session is refused.
 */

interface ExchangeAttachmentDeps {
  readonly context: HostedStoreContext;
  readonly writer: StoreWriter;
  /** eve as the deployment reaches it for one account, composed by the caller so no secret enters here. */
  readonly eve: (accountId: string) => EveSessions;
  /** The model a planning call's notetaker runs on, composed by the caller so no key enters here; nothing where the deployment has none. */
  readonly scribeModel: () => LanguageModel | undefined;
  readonly createId: () => string;
  /** Where a standing exchange's own reports go. */
  readonly report: (message: string) => void;
}

/** A session whose sideband the exchange could not stand on; the service refuses the session on it. */
class ExchangeCannotStand extends Data.TaggedError("ExchangeCannotStand")<{
  readonly message: string;
}> {}

const EXCHANGE_CANNOT_STAND_MESSAGE = "the exchange could not stand on the session's sideband";

const PLAN_GONE_MESSAGE = "the plan the session is bound to no longer stands";

/**
 * The conversation a call lands in: its plan's, opened and attached now
 * where the plan has none yet. A plan deleted since the session was created
 * has none to offer, and the session is refused.
 */
const planConversation = (userId: string, planId: string) =>
  Effect.flatMap(
    openPlanConversation(userId, planId),
    Option.match({
      onNone: () => Effect.fail(new ExchangeCannotStand({ message: PLAN_GONE_MESSAGE })),
      onSome: (conversationId) => Effect.succeed(conversationId),
    }),
  );

export function exchangeAttachment(deps: ExchangeAttachmentDeps): ExchangeAttachment {
  return (
    session,
  ): Effect.Effect<
    HostedLiveExchange,
    SqlError | Schema.SchemaError | ExchangeCannotStand,
    Scope.Scope | SqlClient.SqlClient
  > =>
    Effect.gen(function* () {
      const conversationId = yield* planConversation(session.accountId, session.planId);
      const scribeModel = deps.scribeModel();
      const exchange = yield* hostedLiveExchange({
        userId: session.accountId,
        liveSessionId: session.sessionId,
        conversationId,
        ...(scribeModel === undefined
          ? undefined
          : {
              scribe: {
                planId: session.planId,
                model: scribeModel,
                ...(session.onPlanDraft ? { onDraft: session.onPlanDraft } : undefined),
              },
            }),
        context: deps.context,
        writer: deps.writer,
        eve: deps.eve(session.accountId),
        createId: deps.createId,
        report: deps.report,
        ...(session.onActivity ? { onActivity: session.onActivity } : undefined),
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
