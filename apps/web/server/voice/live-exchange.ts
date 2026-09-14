import { SqlClient, SqlSchema } from "@effect/sql";
import type { SqlError } from "@effect/sql/SqlError";
import type { SessionBeatFrame } from "@sidecar/hosted";
import { PROACTIVE_SPEECH_KIND, type ProactiveSpeechKind } from "@sidecar/live";
import { liveBrainLayer, liveRecordLayer } from "@sidecar/voice/effect";
import {
  type AdoptableSession,
  type BeatTurn,
  type BriefingDelivery,
  type LiveSessionOpened,
  LiveSessionService,
  type LiveSessionServiceOptions,
  type LiveSessionSource,
} from "@sidecar/voice/live-session";
import { Effect, Layer, Option, type ParseResult, Queue, Schema, type Scope } from "effect";
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
 * event, the brain's follow of each accepted ask, the briefing look on its
 * schedule, and the service's own — so closing the scope when the socket
 * detaches interrupts each of them. The session's graceful close and the wait on every record
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
  readonly createId: () => string;
  readonly report: (message: string) => void;
  readonly trace?: LiveSessionServiceOptions<BriefingDelivery>["trace"];
  /**
   * A proactive turn was spoken to its end, by kind: a beat the desktop
   * asked for, or a briefing this exchange decided. The desktop keeps the
   * record of the beats and the counts that follow every spoken turn, so the
   * route tells it in the service's own frame.
   */
  readonly onProactiveSpoken?: (kind: ProactiveSpeechKind) => void;
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
  /** The desktop's door for the service's word that a turn was spoken to its end; absent where the route sends it nothing of its own. */
  readonly onSpoken?: ((kind: ProactiveSpeechKind) => void) | undefined;
}

/**
 * The composition's exchange for one session, standing on it, or nothing
 * where this build stands none; one offered that cannot stand throws, and the
 * route refuses the session. The attachment builds the sideband over the
 * socket and adopts, so the service itself reaches nothing of the exchange
 * or the live-session door; the function bundle gained that edge in the
 * commit that passed the attachment and unwired the desktop's own exchange,
 * since with both live every spoken ask would be delegated twice and every
 * reply appended twice.
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
  /**
   * A beat the desktop decided is owed, spoken by this exchange from the
   * build's own script: the frame carries the kind and the bounded values the
   * script may mention, and the moment it was decided is this side's clock,
   * not the desktop's word.
   */
  speakBeat(beat: SessionBeatFrame): void;
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
function writeReport(
  write: Effect.Effect<VoiceWriteResult, SqlError | ParseResult.ParseError>,
): Effect.Effect<string | undefined> {
  return write.pipe(
    Effect.map((result) =>
      result.ok ? undefined : `The record refused a live event: ${result.refusal}`,
    ),
    Effect.catchAll((error) =>
      Effect.succeed(`The record could not take a live event: ${error.message}`),
    ),
    Effect.catchAllDefect((defect) =>
      Effect.succeed(
        `The record could not take a live event: ${defect instanceof Error ? defect.message : String(defect)}`,
      ),
    ),
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
    yield* Effect.addFinalizer(() => record.drained());
    /**
     * Every event the record was handed, in arrival order, as what it had to
     * report of it. The observation itself stays where the event arrives, so a
     * delta's place in the record's own sequence is still its arrival and the
     * ask written under a delegation still follows every delta ahead of it;
     * what this fiber carries is the reporting, on the socket's own scope,
     * rather than a promise left to settle wherever the session has gone.
     */
    const written = yield* Queue.unbounded<Effect.Effect<string | undefined>>();
    yield* Effect.forkScoped(
      Effect.forever(
        Effect.flatMap(Effect.flatten(Queue.take(written)), (message) =>
          message === undefined ? Effect.void : Effect.sync(() => report(message)),
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
      return () =>
        Effect.map(attach(), (sideband) =>
          observedSideband(sideband, (event) => {
            Queue.unsafeOffer(written, writeReport(record.observe(event)));
          }),
        );
    };

    const source = (): LiveSessionSource | undefined => {
      const inner = options.source?.();
      if (!inner) return undefined;
      return {
        ...inner,
        create: (input) =>
          Effect.map(inner.create(input), (opened) => {
            if (!opened) return undefined;
            const observed: LiveSessionOpened = {
              ...opened,
              attach: observing(() => opened.attach()),
            };
            return observed;
          }),
      };
    };

    // The brain and the record are built beside the service here rather than
    // by a caller, so the layers that name them are provided on the spot.
    const service = yield* Effect.provide(
      LiveSessionService.make<HostedBriefingDelivery>({
        source,
        conversationEntries: options.conversationEntries,
        quietNow: () => Effect.succeed(false),
        releaseHeldBriefings: () => Effect.void,
        emit: options.emit,
        createId: options.createId,
        report,
        ...(options.trace ? { trace: options.trace } : undefined),
        onBriefingAppend: (delivery, eventId) =>
          voice.noteAppend(target, { clientEventId: eventId, messageId: delivery.claim.messageId }),
        ...(options.onProactiveSpoken
          ? { onProactiveSpoken: options.onProactiveSpoken }
          : undefined),
      }),
      Layer.mergeAll(liveBrainLayer(brain), liveRecordLayer(record)),
    );

    yield* Effect.addFinalizer(() => service.stop());

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
      speakBeat: (beat) => {
        service.speakBeat(beatTurn(beat, options.now()));
      },
    };
  });
}

/** The turn a beat frame asks for: the frame's own values, and the instant it was read as its decision. */
function beatTurn(beat: SessionBeatFrame, decidedAt: number): BeatTurn {
  switch (beat.kind) {
    case PROACTIVE_SPEECH_KIND.ARRIVAL:
      return {
        kind: beat.kind,
        decidedAt,
        ...(beat.sessionTitle === undefined ? undefined : { sessionTitle: beat.sessionTitle }),
        ...(beat.talkKeyLabel === undefined ? undefined : { talkKeyLabel: beat.talkKeyLabel }),
      };
    case PROACTIVE_SPEECH_KIND.CALENDAR_ONBOARDING:
      return { kind: beat.kind, decidedAt };
    case PROACTIVE_SPEECH_KIND.LAUNCH:
      return {
        kind: beat.kind,
        decidedAt,
        ...(beat.firstName === undefined ? undefined : { firstName: beat.firstName }),
      };
  }
}
