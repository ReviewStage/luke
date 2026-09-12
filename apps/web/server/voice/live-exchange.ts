import { SqlClient, SqlSchema } from "@effect/sql";
import {
  type AdoptableSession,
  type BriefingDelivery,
  type LiveSessionOpened,
  LiveSessionService,
  type LiveSessionServiceOptions,
  type LiveSessionSource,
} from "@sidecar/voice/live-session";
import { Effect, Option, Queue, Schema, type Scope } from "effect";
import type { WebSocket } from "ws";
import type { EveSessions } from "../hosted/brain-host/eve-sessions.js";
import { CATALOG_TOOL_SET } from "../hosted/brain-tool-set.js";
import { askRecord } from "../hosted/store/asks.js";
import type { HostedStoreContext } from "../hosted/store/database.js";
import {
  type HostedStore,
  hostedStore,
  type VoiceTarget,
  type VoiceWriteResult,
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
 *
 * The composition is a scope's, not a socket callback's: it is built in the
 * `Scope` its caller opened for the socket, and every fiber it runs is forked
 * into that scope — the one that reports what the record made of each live
 * event, the brain's follow of each accepted ask, and the briefing look on
 * its schedule — so closing the scope when the socket detaches interrupts
 * each of them. The session's graceful close and the wait on every record
 * write already started are finalizers of the same scope, added so their
 * reverse order is the order the old `stop` ran them.
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
) => Promise<AttachedExchange | undefined>;

export interface HostedLiveExchange {
  readonly service: LiveSessionService<HostedBriefingDelivery>;
  readonly brain: HostedLiveBrain;
  readonly briefings: HostedBriefings;
  readonly store: HostedStore;
  /**
   * Runs a session the route created for the desktop: the record observes its
   * sideband ahead of the service, and the service stands it without seeding.
   */
  adopt(opened: AdoptableSession): Effect.Effect<boolean>;
}

/**
 * The exchange as the service holds one: the composition above with the close
 * of the scope it was built in, which is what ends the follows and the
 * briefing look, closes the session gracefully, and waits for every record
 * write already started. The service detaching is that close and nothing
 * else, so nothing of the exchange outlives the socket.
 */
export interface AttachedExchange extends HostedLiveExchange {
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

/**
 * What the record made of one live event, as the fiber below says it: the
 * refusal or the failure in the words the report carries, or nothing where
 * the write landed.
 */
function writeReport(write: Promise<VoiceWriteResult>): Promise<string | undefined> {
  return write.then(
    (result) => (result.ok ? undefined : `The record refused a live event: ${result.refusal}`),
    (error: Error) => `The record could not take a live event: ${error.message}`,
  );
}

export function hostedLiveExchange(
  options: HostedLiveExchangeOptions,
): Effect.Effect<HostedLiveExchange, never, Scope.Scope | SqlClient.SqlClient> {
  return Effect.gen(function* () {
    const { userId, liveSessionId, conversationId, context, writer, report } = options;
    const store = hostedStore(context);
    const target: VoiceTarget = {
      userId,
      liveSessionId,
      conversation: { userId, conversationId },
    };
    const voice = voiceWriter({ store: writer });
    const record = yield* hostedLiveRecord({ writer: voice, target });
    yield* Effect.addFinalizer(() => Effect.promise(() => record.drained()));
    /**
     * Every event the record was handed, in arrival order, as what it had to
     * report of it. The observation itself stays where the event arrives, so a
     * delta's place in the record's own sequence is still its arrival and the
     * ask written under a delegation still follows every delta ahead of it;
     * what this fiber carries is the reporting, on the socket's own scope,
     * rather than a promise left to settle wherever the session has gone.
     */
    const written = yield* Queue.unbounded<Promise<string | undefined>>();
    yield* Effect.forkScoped(
      Effect.forever(
        Effect.flatMap(
          Effect.flatMap(Queue.take(written), (pending) => Effect.promise(() => pending)),
          (message) => (message === undefined ? Effect.void : Effect.sync(() => report(message))),
        ),
      ),
    );
    const brain = yield* hostedLiveBrain({
      userId,
      conversationId,
      asks: {
        asks: askRecord(),
        eve: options.eve,
        now: options.now,
      },
      store,
      report,
    });

    /** The device the session's row names now, read at each look so a row completed after creation is seen. */
    const deviceId = Effect.map(findVoiceSessionDeviceId(liveSessionId), (row) =>
      Option.getOrUndefined(Option.flatMap(row, (found) => Option.fromNullable(found.deviceId))),
    );

    const briefings = yield* hostedBriefings({
      userId,
      speech: { writer },
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
          Queue.unsafeOffer(written, writeReport(record.observe(event)));
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
          const observed: LiveSessionOpened = {
            ...opened,
            attach: observing(() => opened.attach()),
          };
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

    yield* Effect.addFinalizer(() => Effect.promise(() => service.stop()));

    return {
      service,
      brain,
      briefings,
      store,
      adopt: (opened) =>
        Effect.promise(() =>
          service.adoptSession({
            sessionId: opened.sessionId,
            attach: observing(() => opened.attach()),
            started: opened.started,
          }),
        ),
    };
  });
}
