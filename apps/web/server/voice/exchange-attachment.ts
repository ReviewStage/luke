import { Effect, type Schema, type Scope } from "effect";
import type { SqlClient } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import type { EveSessions } from "../hosted/brain-host/eve-sessions.js";
import { standingMain } from "../hosted/brain-host/main.js";
import type { HostedStoreContext } from "../hosted/store/index.js";
import type { StoreWriter } from "../hosted/store/writer.js";
import {
  type ExchangeAttachment,
  type ExchangeReport,
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
 * function's composition, which passes it composed over the deployment's
 * seams (`deployment-exchange.ts`) since E5-3 unwired the desktop's own
 * exchange in the same commit.
 *
 * One socket, one scope. The attachment builds the whole standing — the
 * account's main, the exchange, its adoption of the sideband, and the
 * briefing look — as one effect in the scope the service provides, and that
 * scope's close is the exchange's stop. A standing that could not be reached
 * fails in that scope, so the service closing it gives back everything the
 * attempt acquired before the session is refused.
 */

interface ExchangeAttachmentDeps {
  readonly context: HostedStoreContext;
  readonly writer: StoreWriter;
  /** eve as the deployment reaches it for one account, composed by the caller so no secret enters here. */
  readonly eve: (accountId: string) => EveSessions;
  /** The retained conversation a session would be seeded from; the route seeds nothing of its own today, so the default is none. */
  readonly conversationEntries?: HostedLiveExchangeOptions["conversationEntries"];
  readonly emit: HostedLiveExchangeOptions["emit"];
  readonly now: () => number;
  readonly createId: () => string;
  /** Where a standing exchange's own reports go, each named with the route and the platform of the session it stood on. */
  readonly report: (report: ExchangeReport) => void;
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
  return (
    session,
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
        // The exchange reports a sentence; which session it stood on is this
        // attachment's to add, since the exchange itself is told no route and
        // no platform.
        report: (message) =>
          deps.report({ message, route: session.route, platform: session.platform }),
        ...(deps.trace ? { trace: deps.trace } : undefined),
        ...(session.onSpoken ? { onProactiveSpoken: session.onSpoken } : undefined),
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
}
