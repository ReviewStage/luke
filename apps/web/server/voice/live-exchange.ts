import type { CodeRef } from "@sidecar/hosted/plan-wire";
import type { PlanActivity } from "@sidecar/hosted/planning-view";
import { serialQueue } from "@sidecar/runtime/effect";
import { liveBrainLayer, liveRecordLayer } from "@sidecar/voice/effect";
import {
  type AdoptableSession,
  LiveSessionService,
  type LiveSessionStatus,
} from "@sidecar/voice/live-session";
import type { LanguageModel } from "ai";
import { Cause, Effect, Layer, Result, type Schema, type Scope } from "effect";
import type { SqlClient } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import type { WebSocket } from "ws";
import type { EveSessions } from "../hosted/brain-host/eve-sessions.js";
import { askRecord } from "../hosted/store/asks.js";
import {
  type HostedStore,
  hostedStore,
  type VoiceTarget,
  type VoiceWriteResult,
  voiceWriter,
} from "../hosted/store/index.js";
import type { StoreWriter } from "../hosted/store/writer.js";
import { type HostedLiveBrain, hostedLiveBrain } from "./live-brain.js";
import { hostedLiveRecord } from "./live-record.js";
import { observedSideband } from "./live-sideband.js";
import { type PlanDraft, planScribe } from "./plan-scribe.js";

/**
 * The live session service composed for the hosted tier, for one account's
 * one planning call: the brain answered in process through the ask door under
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
  /** The account the session was opened for, resolved at the handshake; the deployment acts for it at eve's door. */
  readonly userId: string;
  readonly liveSessionId: string;
  /** The conversation the spoken asks and the record land in: the plan's conversation. */
  readonly conversationId: string;
  /**
   * The notetaker the call writes its plan through: the plan the session is
   * bound to and the model the scribe runs on. Absent on a deployment with no
   * model key, which then writes nothing.
   */
  readonly scribe?: {
    readonly planId: string;
    readonly model: LanguageModel;
    /** Where each draft of the plan goes as the notetaker writes it; nowhere where the service sends nothing. */
    readonly onDraft?: ((draft: PlanDraft) => void) | undefined;
  };
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
  /** What the voice, the brain, and the notetaker are doing, told whole on each change; the device is shown it. */
  readonly onActivity?: (activity: PlanActivity) => void;
  /** Code Luke is about to talk about, by place, told as he starts to speak; a planning call's device is shown it. */
  readonly onCode?: (ref: CodeRef) => void;
}

/** One signed-in session the voice service created or re-attached, as an exchange is offered it. */
export interface AttachedSession {
  readonly accountId: string;
  readonly sessionId: string;
  /** The plan the call is bound to, which its asks and its record land in. */
  readonly planId: string;
  /** The socket the service attached to the session, which the relay pipes and the exchange reads its sideband over. */
  readonly sideband: WebSocket;
  /** Whether the session is already running: a fresh connection to a standing session finds it started, and hears no `session.started` again. */
  readonly started: boolean;
  /** The device's door for the plan as its notetaker has it now; absent where the service sends it nothing of its own. */
  readonly onPlanDraft?: ((draft: PlanDraft) => void) | undefined;
  /** The device's door for what each part of Luke is doing on the call; absent where the service sends it nothing of its own. */
  readonly onActivity?: ((activity: PlanActivity) => void) | undefined;
  /** The device's door for code Luke puts on screen on the call; absent where the route sends it nothing of its own. */
  readonly onCode?: ((ref: CodeRef) => void) | undefined;
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
) => Effect.Effect<HostedLiveExchange | undefined, Error, Scope.Scope | SqlClient.SqlClient>;

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
  write: Effect.Effect<VoiceWriteResult, SqlError | Schema.SchemaError>,
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
): Effect.fn.Return<HostedLiveExchange, never, Scope.Scope | SqlClient.SqlClient> {
  const { userId, liveSessionId, conversationId, writer, report } = options;
  const store = hostedStore();
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
  const written = yield* serialQueue({
    onDefect: (cause) =>
      Effect.sync(() => report(`Reporting a live event failed: ${Cause.pretty(cause)}`)),
  });
  const reported = (message: string | undefined): Effect.Effect<void> =>
    message === undefined ? Effect.void : Effect.sync(() => report(message));
  const brain = yield* hostedLiveBrain({
    userId,
    conversationId,
    asks: {
      asks: askRecord(),
      eve: options.eve,
    },
    store,
    writer,
    report,
  });

  /**
   * What the service and the notetaker last said of themselves, merged into
   * one snapshot the device is told whole each time either changes, so the
   * device holds the frame as it stands and derives nothing from a sequence.
   */
  let status: LiveSessionStatus = { voice: undefined, planner: undefined };
  let notes = false;
  const tellActivity = () => {
    const { voice: phase, planner } = status;
    options.onActivity?.({
      ...(phase === undefined ? undefined : { voice: phase }),
      ...(planner === undefined
        ? undefined
        : { planner: planner.action === undefined ? {} : { action: planner.action } }),
      notes,
    });
  };

  const scribe =
    options.scribe === undefined
      ? undefined
      : yield* planScribe({
          userId,
          planId: options.scribe.planId,
          model: options.scribe.model,
          ...(options.scribe.onDraft === undefined
            ? undefined
            : { onDraft: options.scribe.onDraft }),
          onWriting: (writing) => {
            notes = writing;
            tellActivity();
          },
          createId: options.createId,
          report,
        });
  if (scribe !== undefined) {
    const unheard = brain.onRunEvent(scribe.observeRun);
    yield* Effect.addFinalizer(() => Effect.sync(unheard));
  }

  /** The sideband with the record, and the notetaker, listening ahead of the service, on every session adopted. */
  const observing = (attach: AdoptableSession["attach"]): AdoptableSession["attach"] => {
    return () =>
      Effect.map(attach(), (sideband) =>
        observedSideband(sideband, (event) => {
          written.offerUnsafe(Effect.flatMap(writeReport(record.observe(event)), reported));
          scribe?.observe(event);
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
