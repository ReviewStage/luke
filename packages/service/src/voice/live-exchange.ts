import type { DatabaseServices, QueryError } from "@luke/database/core/query";
import { askRecord } from "@luke/database/models/asks";
import { type HostedStore, hostedStore } from "@luke/database/models/hosted-store";
import {
  type VoiceTarget,
  type VoiceWriteResult,
  voiceWriter,
} from "@luke/database/models/voice-writer";
import type { ConversationTarget, StoreWriter } from "@luke/database/models/writer";
import type { TaskActivity, TaskShownCode, TaskWorkTurn } from "@luke/features/tasks-view";
import { serialQueue } from "@luke/runtime/effect";
import { liveBrainLayer, liveRecordLayer } from "@luke/voice/effect";
import {
  type AdoptableSession,
  LiveSessionService,
  type LiveSessionStatus,
  type LiveSessionTrace,
} from "@luke/voice/live-session";
import { Cause, Effect, Layer, Result, type Schema, type Scope } from "effect";
import type { WebSocket } from "ws";
import type { EveSessions } from "../agents/brain-host/eve-sessions.js";
import { type HostedLiveBrain, hostedLiveBrain } from "./live-brain.js";
import { hostedLiveRecord } from "./live-record.js";
import { observedSideband } from "./live-sideband.js";

/**
 * The live session service composed for the hosted tier, for one account's
 * one task call, in the task's conversation whichever member of its
 * workspace opened it: the brain answered in process through the ask door under
 * the eve client the caller composed for the account, and the record over the
 * voice writer with the sideband observed so the writer sees each event once
 * ahead of the service. The writers, the ask record, and the reads all stand
 * on the ambient client, so they hold one client over one database. The
 * session itself is
 * still the caller's: the voice service hands in a session it already
 * created for the device and the exchange adopts it, seeding nothing,
 * through `adopt`.
 *
 * The composition is a scope's, not a socket callback's: it is built in the
 * `Scope` its caller opened for the socket, and every fiber it runs is forked
 * into that scope — the one that reports what the record made of each live
 * event, the brain's follow of each accepted ask, and the service's own — so
 * closing the scope when the socket
 * detaches interrupts each of them. The session's graceful close (or, where
 * the device's socket went with no hang-up, its release with nothing said to
 * it) and the wait on every record write already started are finalizers of
 * the same scope, added so their reverse order is the order the old `stop`
 * ran them.
 */

export interface HostedLiveExchangeOptions {
  /** The account the session was opened for, resolved at the handshake: it owns the voice row, is metered, and the deployment acts for it at eve's door. */
  readonly accountId: string;
  readonly liveSessionId: string;
  /** The conversation the spoken asks and the record land in: the task's, under the member who opened it, whoever is calling. */
  readonly conversation: ConversationTarget;
  /** The store writer, which the voice writer writes through. */
  readonly writer: StoreWriter;
  /**
   * eve as the deployment reaches it for this account: `eveSessions` with
   * the deployment's secret and this account, composed by the caller, so neither the secret nor eve's origin enters
   * here and a test hands in a fake.
   */
  readonly eve: EveSessions;
  readonly createId: () => string;
  readonly report: (message: string) => void;
  /** What the voice and the brain are doing, told whole on each change; the device is shown it. */
  readonly onActivity?: (activity: TaskActivity) => void;
  /** Code Luke is about to talk about, with its lines, told as he starts to speak; a task call's device is shown it. */
  readonly onCode?: (shown: TaskShownCode) => void;
  /** Each brain turn's work, told whole on each change; a task call's device is shown it. */
  readonly onWork?: (work: TaskWorkTurn) => void;
  /** The developer said they are done and Luke is saying goodbye; a task call's device hangs up once it has played. */
  readonly onCallEnding?: () => void;
  /** Each hand-off the session traces, ids and words left out; the service writes it to its log. */
  readonly onTrace?: (entry: LiveSessionTrace) => void;
}

/** One signed-in session the voice service created or re-attached, as an exchange is offered it. */
export interface AttachedSession {
  readonly accountId: string;
  readonly sessionId: string;
  /** The task the call is bound to, which its asks and its record land in. */
  readonly taskId: string;
  /** The socket the service attached to the session, which the relay pipes and the exchange reads its sideband over. */
  readonly sideband: WebSocket;
  /** Whether the session is already running: a fresh connection to a standing session finds it started, and hears no `session.started` again. */
  readonly started: boolean;
  /** The device's door for what each part of Luke is doing on the call; absent where the service sends it nothing of its own. */
  readonly onActivity?: ((activity: TaskActivity) => void) | undefined;
  /** The device's door for code Luke puts on screen on the call; absent where the route sends it nothing of its own. */
  readonly onCode?: ((shown: TaskShownCode) => void) | undefined;
  /** The device's door for each brain turn's work on the call; absent where the route sends it nothing of its own. */
  readonly onWork?: ((work: TaskWorkTurn) => void) | undefined;
  /** The device's door for Luke ending the call; absent where the route sends it nothing of its own. */
  readonly onCallEnding?: (() => void) | undefined;
  /** The service's door for each hand-off the session traces; absent where the route logs none. */
  readonly onTrace?: ((entry: LiveSessionTrace) => void) | undefined;
}

/**
 * The composition's exchange for one session, standing on it, or nothing
 * where this build stands none; one offered that cannot stand fails, and the
 * service refuses the session. The attachment builds the sideband over the
 * socket and adopts, so the service itself reaches nothing of the exchange
 * or the live-session door. The scope is the caller's: everything the
 * standing acquires (the follows, the record writes under way) belongs to
 * it, and closing it is the exchange's stop.
 */
export type ExchangeAttachment = (
  session: AttachedSession,
) => Effect.Effect<HostedLiveExchange | undefined, Error, Scope.Scope | DatabaseServices>;

/**
 * How the exchange's scope lets go of the session it stands on: closing it,
 * the docs' graceful close, which is every ending but one; or detaching from
 * it, which says nothing to the session, because the device's socket went
 * with no hang-up and the device will attach to the same session again.
 */
export const EXCHANGE_ENDING = {
  CLOSE: "close",
  DETACH: "detach",
} as const;

export type ExchangeEnding = (typeof EXCHANGE_ENDING)[keyof typeof EXCHANGE_ENDING];

export interface HostedLiveExchange {
  readonly service: LiveSessionService;
  /**
   * Names how the scope's close is to end the session, asked before that
   * close; an exchange never told closes it.
   */
  endAs(ending: ExchangeEnding): void;
  readonly brain: HostedLiveBrain;
  readonly store: HostedStore;
  /**
   * Runs a session the service created for the device: the record observes
   * its sideband ahead of the service, and the service stands it without
   * seeding.
   */
  adopt(opened: AdoptableSession): Effect.Effect<boolean>;
}

/**
 * What the record made of one live event, as the fiber below says it: the
 * refusal or the failure in the words the report carries, or nothing where
 * the write landed.
 */
function writeReport(
  write: Effect.Effect<VoiceWriteResult, QueryError | Schema.SchemaError>,
): Effect.Effect<string | undefined> {
  return write.pipe(
    Effect.map((result) =>
      Result.isSuccess(result) ? undefined : `The record refused a live event: ${result.failure}`,
    ),
    Effect.catch((error) =>
      Effect.succeed(`The record could not take a live event: ${error.message}`),
    ),
    Effect.catchDefect((defect) =>
      Effect.succeed(
        `The record could not take a live event: ${defect instanceof Error ? defect.message : String(defect)}`,
      ),
    ),
  );
}

export const hostedLiveExchange = /* @__PURE__ */ Effect.fn("web/hostedLiveExchange")(function* (
  options: HostedLiveExchangeOptions,
): Effect.fn.Return<HostedLiveExchange, never, Scope.Scope | DatabaseServices> {
  const { accountId, liveSessionId, conversation, writer, report } = options;
  const store = hostedStore();
  const target: VoiceTarget = { userId: accountId, liveSessionId, conversation };
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
  const written = yield* serialQueue({
    onDefect: (cause) =>
      Effect.sync(() => report(`Reporting a live event failed: ${Cause.pretty(cause)}`)),
  });
  const reported = (message: string | undefined): Effect.Effect<void> =>
    message === undefined ? Effect.void : Effect.sync(() => report(message));
  const brain = yield* hostedLiveBrain({
    accountId,
    conversation,
    asks: {
      asks: askRecord(),
      eve: options.eve,
    },
    store,
    writer,
    report,
  });

  /**
   * What the service last said of the voice and the brain, merged into
   * one snapshot the device is told whole each time either changes, so the
   * device holds the frame as it stands and derives nothing from a sequence.
   */
  let status: LiveSessionStatus = { voice: undefined, brain: undefined };
  const tellActivity = () => {
    const { voice: phase, brain } = status;
    options.onActivity?.({
      ...(phase === undefined ? undefined : { voice: phase }),
      ...(brain === undefined
        ? undefined
        : { planner: brain.action === undefined ? {} : { action: brain.action } }),
      // Note that no notetaker writes beside the call any more: Luke writes the plan himself.
      notes: false,
    });
  };

  if (options.onWork !== undefined) {
    const unshown = brain.onWork(options.onWork);
    yield* Effect.addFinalizer(() => Effect.sync(unshown));
  }

  /** The sideband with the record listening ahead of the service, on every session adopted. */
  const observing = (attach: AdoptableSession["attach"]): AdoptableSession["attach"] => {
    return () =>
      Effect.map(attach(), (sideband) =>
        observedSideband(sideband, (event) => {
          written.offerUnsafe(Effect.flatMap(writeReport(record.observe(event)), reported));
        }),
      );
  };

  // The brain and the record are built beside the service here rather than
  // by a caller, so the layers that name them are provided on the spot.
  const service = yield* Effect.provide(
    LiveSessionService.make({
      createId: options.createId,
      report,
      onStatus: (told) => {
        status = told;
        tellActivity();
      },
      ...(options.onCode ? { onCode: options.onCode } : undefined),
      ...(options.onCallEnding ? { onCallEnding: options.onCallEnding } : undefined),
      ...(options.onTrace ? { onTrace: options.onTrace } : undefined),
    }),
    Layer.mergeAll(liveBrainLayer(brain), liveRecordLayer(record)),
  );

  let ending: ExchangeEnding = EXCHANGE_ENDING.CLOSE;
  yield* Effect.addFinalizer(() =>
    ending === EXCHANGE_ENDING.DETACH ? service.release() : service.stop(),
  );

  return {
    service,
    endAs: (next) => {
      ending = next;
    },
    brain,
    store,
    adopt: (opened) =>
      service.adoptSession({
        sessionId: opened.sessionId,
        attach: observing(() => opened.attach()),
        started: opened.started,
      }),
  };
});
