import type { DatabaseServices, QueryError } from "@luke/database/core/query";
import { openTaskConversation } from "@luke/database/models/task-store";
import type { StoreWriter } from "@luke/database/models/writer";
import type { LanguageModel } from "ai";
import { Data, Effect, Option, type Schema, type Scope } from "effect";
import type { EveSessions } from "../agents/brain-host/eve-sessions.js";
import {
  type ExchangeAttachment,
  type HostedLiveExchange,
  hostedLiveExchange,
} from "./live-exchange.js";
import { upstreamSideband } from "./live-sideband.js";

/**
 * The hosted exchange as the voice service is offered it, one per signed-in
 * session: the conversation of the task the session is bound to resolved at
 * the session's start, the writer the function already holds, eve reached as the deployment for the calling account, and a notetaker
 * writing the plan as the call goes. This is the whole of what
 * `VoiceServiceOptions.exchange` takes, kept apart from the function's
 * composition, which passes it composed over the deployment's seams
 * (`deployment-exchange.ts`).
 *
 * One socket, one scope. The attachment builds the whole standing — the
 * task's conversation, the exchange, and its adoption of the sideband — as
 * one effect in the scope the service provides, and that scope's close is
 * the exchange's stop. A standing that could not be reached
 * fails in that scope, so the service closing it gives back everything the
 * attempt acquired before the session is refused.
 */

interface ExchangeAttachmentDeps {
  readonly writer: StoreWriter;
  /** eve as the deployment reaches it for one account, composed by the caller so no secret enters here. */
  readonly eve: (accountId: string) => EveSessions;
  /** The model a task call's notetaker runs on, composed by the caller so no key enters here; nothing where the deployment has none. */
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

const TASK_GONE_MESSAGE = "the task the session is bound to no longer stands";

/**
 * The conversation a call lands in: its task's, opened and attached now
 * where the task has none yet, and answered under the member who opened it
 * where a teammate did. A task deleted since the session was created, or
 * one the account no longer reaches, has none to offer, and the session is
 * refused.
 */
const taskConversation = (userId: string, taskId: string) =>
  Effect.flatMap(
    openTaskConversation(userId, taskId),
    Option.match({
      onNone: () => Effect.fail(new ExchangeCannotStand({ message: TASK_GONE_MESSAGE })),
      onSome: (opened) => Effect.succeed(opened),
    }),
  );

export function exchangeAttachment(deps: ExchangeAttachmentDeps): ExchangeAttachment {
  return (
    session,
  ): Effect.Effect<
    HostedLiveExchange,
    QueryError | Schema.SchemaError | ExchangeCannotStand,
    Scope.Scope | DatabaseServices
  > =>
    Effect.gen(function* () {
      const opened = yield* taskConversation(session.accountId, session.taskId);
      const scribeModel = deps.scribeModel();
      const exchange = yield* hostedLiveExchange({
        accountId: session.accountId,
        liveSessionId: session.sessionId,
        conversation: { userId: opened.ownerId, conversationId: opened.conversationId },
        ...(scribeModel === undefined
          ? undefined
          : {
              scribe: {
                taskId: session.taskId,
                model: scribeModel,
                ...(session.onPlanDraft ? { onDraft: session.onPlanDraft } : undefined),
              },
            }),
        writer: deps.writer,
        eve: deps.eve(session.accountId),
        createId: deps.createId,
        report: deps.report,
        ...(session.onActivity ? { onActivity: session.onActivity } : undefined),
        ...(session.onCode ? { onCode: session.onCode } : undefined),
        ...(session.onWork ? { onWork: session.onWork } : undefined),
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
