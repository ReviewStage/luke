import type { EveSessions } from "../hosted/brain-host/eve-sessions.js";
import { standingMain } from "../hosted/brain-host/main.js";
import type { HostedStoreRun } from "../hosted/store/database.js";
import type { HostedStoreContext } from "../hosted/store/index.js";
import type { StoreWriter } from "../hosted/store/writer.js";
import {
  type ExchangeAttachment,
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
 */

export interface ExchangeAttachmentDeps {
  readonly context: HostedStoreContext;
  /** The runner the attachment's own reads and the exchange beneath it are answered through. */
  readonly run: HostedStoreRun;
  readonly writer: StoreWriter;
  /** eve as the deployment reaches it for one account, composed by the caller so no secret enters here. */
  readonly eve: (accountId: string) => EveSessions;
  /** The retained conversation a session would be seeded from; the route seeds nothing of its own today, so the default is none. */
  readonly conversationEntries?: HostedLiveExchangeOptions["conversationEntries"];
  readonly emit: HostedLiveExchangeOptions["emit"];
  readonly now: () => number;
  readonly schedule: HostedLiveExchangeOptions["schedule"];
  readonly cancel: HostedLiveExchangeOptions["cancel"];
  readonly createId: () => string;
  readonly report: (message: string) => void;
  readonly trace?: HostedLiveExchangeOptions["trace"];
}

const NO_ENTRIES: HostedLiveExchangeOptions["conversationEntries"] = () => [];

export function exchangeAttachment(deps: ExchangeAttachmentDeps): ExchangeAttachment {
  return async (session) => {
    const conversationId = await deps.run(standingMain(session.accountId, new Date(deps.now())));
    const exchange = hostedLiveExchange({
      userId: session.accountId,
      liveSessionId: session.sessionId,
      conversationId,
      context: deps.context,
      run: deps.run,
      writer: deps.writer,
      eve: deps.eve(session.accountId),
      conversationEntries: deps.conversationEntries ?? NO_ENTRIES,
      emit: deps.emit,
      now: deps.now,
      schedule: deps.schedule,
      cancel: deps.cancel,
      createId: deps.createId,
      report: deps.report,
      ...(deps.trace ? { trace: deps.trace } : undefined),
    });
    const adopted = await exchange.adopt({
      sessionId: session.sessionId,
      attach: async () => upstreamSideband(session.sideband),
      started: session.started,
    });
    if (!adopted) {
      await exchange.stop();
      throw new Error("the exchange could not stand on the session's sideband");
    }
    // The look at the account's open offers runs for as long as the session stands; the exchange's stop ends it.
    exchange.briefings.start();
    return exchange;
  };
}
