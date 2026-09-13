import { Effect, Exit, type Schema, Scope } from "effect";
import type { SqlClient } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import type { EveSessions } from "../hosted/brain-host/eve-sessions.js";
import { standingMain } from "../hosted/brain-host/main.js";
import type { HostedStoreContext } from "../hosted/store/index.js";
import type { StoreWriter } from "../hosted/store/writer.js";
import type { WebStoreRun } from "../runtime.js";
import {
  type ExchangeAttachment,
  type HostedLiveExchange,
  type HostedLiveExchangeOptions,
  hostedLiveExchange,
} from "./live-exchange.js";
import { upstreamSideband } from "./live-sideband.js";

/**
 * The hosted exchange as the sessions route would offer it to the voice
 * service, one per signed-in session: the account's standing main resolved
 * at the session's start, the store context and the writer the function
 * already holds, and eve reached as the deployment for that account. This is
 * the whole of what `VoiceServiceOptions.exchange` takes, kept apart from the
 * function's composition so the route can pass it in one line when the
 * desktop's own exchange is unwired, and not before: until then the function
 * passes nothing, the service only pipes, and the desktop answers.
 *
 * One socket, one scope. The attachment opens a `Scope` when the service
 * offers it a session, builds the whole standing — the account's main, the
 * exchange, its adoption of the sideband, and the briefing look — as one
 * effect run in that scope on the edge's own runner, and hands the service a
 * `stop` that closes it. A standing that could not be reached closes the
 * scope before it throws, so nothing an attempt acquired is left behind on a
 * session the service is about to refuse.
 */

export interface ExchangeAttachmentDeps {
  readonly context: HostedStoreContext;
  /** The runner the attachment's own scope and the effects built in it are answered through. */
  readonly run: WebStoreRun;
  readonly writer: StoreWriter;
  /** eve as the deployment reaches it for one account, composed by the caller so no secret enters here. */
  readonly eve: (accountId: string) => EveSessions;
  /** The retained conversation a session would be seeded from; the route seeds nothing of its own today, so the default is none. */
  readonly conversationEntries?: HostedLiveExchangeOptions["conversationEntries"];
  readonly emit: HostedLiveExchangeOptions["emit"];
  readonly now: () => number;
  readonly createId: () => string;
  readonly report: (message: string) => void;
  readonly trace?: HostedLiveExchangeOptions["trace"];
}

const NO_ENTRIES: HostedLiveExchangeOptions["conversationEntries"] = () => [];

/** A session whose sideband the exchange could not stand on; the service refuses the session on it. */
class ExchangeCannotStand extends Error {
  constructor() {
    super("the exchange could not stand on the session's sideband");
  }
}

export function exchangeAttachment(deps: ExchangeAttachmentDeps): ExchangeAttachment {
  const standing = (
    session: Parameters<ExchangeAttachment>[0],
  ): Effect.Effect<
    HostedLiveExchange,
    SqlError | Schema.SchemaError | ExchangeCannotStand,
    Scope.Scope | SqlClient.SqlClient
  > =>
    Effect.gen(function* () {
      const conversationId = yield* standingMain(session.accountId, new Date(deps.now()));
      const exchange = yield* hostedLiveExchange({
        userId: session.accountId,
        liveSessionId: session.sessionId,
        conversationId,
        context: deps.context,
        writer: deps.writer,
        eve: deps.eve(session.accountId),
        conversationEntries: deps.conversationEntries ?? NO_ENTRIES,
        emit: deps.emit,
        now: deps.now,
        createId: deps.createId,
        report: deps.report,
        ...(deps.trace ? { trace: deps.trace } : undefined),
      });
      const adopted = yield* exchange.adopt({
        sessionId: session.sessionId,
        attach: () => upstreamSideband(session.sideband),
        started: session.started,
      });
      if (!adopted) return yield* Effect.fail(new ExchangeCannotStand());
      // The look at the account's open offers runs for as long as the session stands; the scope's close ends it.
      yield* exchange.briefings.start;
      return exchange;
    });

  return async (session) => {
    const scope = await deps.run(Scope.make());
    const close = () => deps.run(Scope.close(scope, Exit.void));
    try {
      const exchange = await deps.run(Scope.provide(standing(session), scope));
      return { ...exchange, stop: close };
    } catch (error) {
      await close();
      throw error;
    }
  };
}
