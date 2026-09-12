import { SqlClient, SqlSchema } from "@effect/sql";
import {
  type AdoptableSession,
  type BriefingDelivery,
  type LiveSessionOpened,
  LiveSessionService,
  type LiveSessionServiceOptions,
  type LiveSessionSource,
} from "@sidecar/voice/live-session";
import { Effect, Option, Schema } from "effect";
import type { WebSocket } from "ws";
import type { EveSessions } from "../hosted/brain-host/eve-sessions.js";
import { CATALOG_TOOL_SET } from "../hosted/brain-tool-set.js";
import { askRecord } from "../hosted/store/asks.js";
import type { HostedStoreContext } from "../hosted/store/database.js";
import {
  type HostedStore,
  hostedStore,
  type VoiceTarget,
  voiceWriter,
} from "../hosted/store/index.js";
import type { StoreWriter } from "../hosted/store/writer.js";
import { type HostedLiveBrain, hostedLiveBrain } from "./live-brain.js";
import {
  type HostedBriefingDelivery,
  type HostedBriefings,
  hostedBriefings,
} from "./live-briefings.js";
import { hostedLiveRecord } from "./live-record.js";
import { observedSideband } from "./live-sideband.js";

/**
 * The live session service composed for the hosted tier, for one account's
 * one live session: the brain answered in process through the ask door under
 * the eve client the caller composed for the account, the record over the voice writer with the
 * sideband observed so the writer sees each event once ahead of the service,
 * and the briefings claimed as the session's device before they are spoken.
 * Everything of the store arrives as one context — the database, the runner,
 * and the key ring — so the writers, the ask record, and the reads hold one
 * client over one database. The session itself is still the caller's: a
 * source handed in is what creates and attaches it, or the sessions route
 * hands in a session it already created for the desktop and the exchange
 * adopts it, seeding nothing, through `adopt`. Whether the route hands one in
 * is the route's composition's decision, by build. The account's quiet is not this composition's: a held offer is
 * `speech.held` on the record and never open here, so the service's own hold
 * stands empty and releases nothing.
 */

export interface HostedLiveExchangeOptions {
  /** The account the session was opened for, resolved at the handshake; the deployment acts for it at eve's door. */
  readonly userId: string;
  readonly liveSessionId: string;
  /** The account's standing main, which the spoken asks and the record land in. */
  readonly conversationId: string;
  readonly context: HostedStoreContext;
  /** The store writer over the catalog, which the voice writer and the speech claim write through. */
  readonly writer: StoreWriter;
  /**
   * eve as the deployment reaches it for this account: `eveSessions` under
   * `EVE_CALLER.DEPLOYMENT` with the deployment's secret and this account,
   * composed by the caller, so neither the secret nor eve's origin enters
   * here and a test hands in a fake.
   */
  readonly eve: EveSessions;
  /** What creates a session for the service's own `createSession`; absent where every session is adopted. */
  readonly source?: () => LiveSessionSource | undefined;
  readonly conversationEntries: LiveSessionServiceOptions<BriefingDelivery>["conversationEntries"];
  readonly emit: LiveSessionServiceOptions<BriefingDelivery>["emit"];
  readonly now: () => number;
  readonly schedule: LiveSessionServiceOptions<BriefingDelivery>["schedule"];
  readonly cancel: LiveSessionServiceOptions<BriefingDelivery>["cancel"];
  readonly createId: () => string;
  readonly report: (message: string) => void;
  readonly trace?: LiveSessionServiceOptions<BriefingDelivery>["trace"];
}

/** One signed-in session the sessions route created or re-attached, as an exchange is offered it. */
export interface AttachedSession {
  readonly accountId: string;
  readonly sessionId: string;
  /** The device the handshake named and the account was shown to hold; none where the desktop sent none or the route re-attached. */
  readonly deviceId: string | undefined;
  /** The socket the route attached to the session, which the relay pipes and the exchange reads its sideband over. */
  readonly sideband: WebSocket;
  /** Whether the session is already running: a fresh connection to a standing session finds it started, and hears no `session.started` again. */
  readonly started: boolean;
}

/**
 * The composition's exchange for one session, standing on it, or nothing
 * where this build stands none; one offered that cannot stand throws, and the
 * route refuses the session. The attachment builds the sideband over the
 * socket and adopts, so the service itself reaches nothing of the exchange
 * or the live-session door, and the function bundle gains that edge only in
 * the commit that passes the attachment: the desktop still runs an exchange
 * of its own, and with both live every spoken ask would be delegated twice
 * and every reply appended twice.
 */
export type ExchangeAttachment = (
  session: AttachedSession,
) => Promise<HostedLiveExchange | undefined>;

export interface HostedLiveExchange {
  readonly service: LiveSessionService<HostedBriefingDelivery>;
  readonly brain: HostedLiveBrain;
  readonly briefings: HostedBriefings;
  readonly store: HostedStore;
  /**
   * Runs a session the route created for the desktop: the record observes its
   * sideband ahead of the service, and the service stands it without seeding.
   */
  adopt(opened: AdoptableSession): Promise<boolean>;
  /** Ends the follows and the briefing look, closes the session gracefully, and waits for every record write already started. */
  stop(): Promise<void>;
}

/** A statement over the ambient client, so the query below reads as the query it is. */
const statement = <A, E>(build: (sql: SqlClient.SqlClient) => Effect.Effect<A, E>) =>
  Effect.flatMap(SqlClient.SqlClient, build);

const VoiceSessionDeviceIdRowSchema = Schema.Struct({
  deviceId: Schema.propertySignature(Schema.NullOr(Schema.String)).pipe(
    Schema.fromKey("device_id"),
  ),
});

const findVoiceSessionDeviceId = SqlSchema.findOne({
  Request: Schema.String,
  Result: VoiceSessionDeviceIdRowSchema,
  execute: (liveSessionId) =>
    statement(
      (sql) => sql`select device_id from voice_sessions where live_session_id = ${liveSessionId}`,
    ),
});

export function hostedLiveExchange(options: HostedLiveExchangeOptions): HostedLiveExchange {
  const { userId, liveSessionId, conversationId, context, writer, report } = options;
  const store = hostedStore(context);
  const target: VoiceTarget = {
    userId,
    liveSessionId,
    conversation: { userId, conversationId },
  };
  const voice = voiceWriter({ run: context.run, store: writer });
  const record = hostedLiveRecord({ writer: voice, target });
  const brain = hostedLiveBrain({
    userId,
    conversationId,
    asks: {
      run: context.run,
      asks: askRecord(context.run),
      eve: options.eve,
      now: options.now,
    },
    store,
    report,
  });

  /** The device the session's row names now, read at each look so a row completed after creation is seen. */
  function deviceId(): Promise<string | undefined> {
    return context.run(
      Effect.map(findVoiceSessionDeviceId(liveSessionId), (row) =>
        Option.getOrUndefined(Option.flatMap(row, (found) => Option.fromNullable(found.deviceId))),
      ),
    );
  }

  const briefings = hostedBriefings({
    userId,
    speech: { run: context.run, writer },
    offers: store.speech,
    tools: CATALOG_TOOL_SET,
    deviceId,
    deliver: (delivery) => service.deliverBriefing(delivery),
    now: options.now,
    report,
  });

  /** The sideband with the record listening ahead of the service, on every session, created or adopted. */
  const observing = (attach: AdoptableSession["attach"]): AdoptableSession["attach"] => {
    return async () =>
      observedSideband(await attach(), (event) => {
        void record.observe(event).then(
          (result) => {
            if (!result.ok) report(`The record refused a live event: ${result.refusal}`);
          },
          (error: Error) => report(`The record could not take a live event: ${error.message}`),
        );
      });
  };

  const source = (): LiveSessionSource | undefined => {
    const inner = options.source?.();
    if (!inner) return undefined;
    return {
      ...inner,
      create: async (input) => {
        const opened = await inner.create(input);
        if (!opened) return undefined;
        const observed: LiveSessionOpened = { ...opened, attach: observing(() => opened.attach()) };
        return observed;
      },
    };
  };

  const service = new LiveSessionService<HostedBriefingDelivery>({
    source,
    brain,
    record,
    conversationEntries: options.conversationEntries,
    quietNow: async () => false,
    releaseHeldBriefings: () => undefined,
    emit: options.emit,
    now: options.now,
    schedule: options.schedule,
    cancel: options.cancel,
    createId: options.createId,
    report,
    ...(options.trace ? { trace: options.trace } : undefined),
    onBriefingAppend: (delivery, eventId) =>
      voice.noteAppend(target, { clientEventId: eventId, messageId: delivery.claim.messageId }),
  });

  return {
    service,
    brain,
    briefings,
    store,
    adopt: (opened) =>
      service.adoptSession({
        sessionId: opened.sessionId,
        attach: observing(() => opened.attach()),
        started: opened.started,
      }),
    async stop() {
      brain.stop();
      briefings.stop();
      await service.stop();
      await record.drained();
    },
  };
}
