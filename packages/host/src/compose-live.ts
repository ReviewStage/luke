import { PRODUCT_EVENT } from "@sidecar/analytics";
import { isAgentWireTrace } from "@sidecar/devtrace/vocabulary";
import {
  carried,
  GATEWAY_EVENT,
  GATEWAY_METHOD,
  type GatewayMethodTable,
  invalid,
  RefusedRefusal,
  voiceCreateLiveSessionParamsSchema,
  voiceReportLiveActivityParamsSchema,
  voiceReportLiveTransportParamsSchema,
} from "@sidecar/gateway";
import { VOICE_SOURCE_COUNTED_AS } from "@sidecar/settings";
import { unavailableLiveDiagnostics } from "@sidecar/voice";
import { LiveSessionHolder } from "@sidecar/voice/live-session";
import { readEither } from "@sidecar/wire/effect";
import { Effect, Either, type Scope } from "effect";
import type { AccountComposer } from "./compose-account.js";
import type { BrainComposer } from "./compose-brain.js";
import type { ObservationComposer } from "./compose-observation.js";
import type { SettingsComposer } from "./compose-settings.js";
import type { Composer } from "./composer.js";
import { HostKernelTag } from "./effect/kernel.js";
import { voiceRoster } from "./voice-roster.js";

export interface LiveComposer extends Composer {
  readonly service: LiveSessionHolder;
}

export interface LiveDependencies {
  settings: SettingsComposer;
  account: AccountComposer;
  observation: ObservationComposer;
  brain: BrainComposer;
}

/**
 * The GPT Live session as one concern of the host: the `voice.*` methods the
 * peer asks with, the `voiceLiveSession.changed` phases it is told, and the
 * holder that keeps the session open between them. The exchange is the
 * service's: every spoken ask is answered by the hosted brain, every reply
 * and briefing is appended by the service's own exchange over the same
 * socket, and the record is the account's on the service. What this side
 * still does is create the session for the peer's offer, seeded from the
 * desk and the recent conversation as this Mac sees them; end it on the
 * peer's hang-up or the drain; send the stop key's one instruction; and
 * carry the peer's idle to the service, which decides the idle close. It
 * reaches no brain and writes no record, so it needs no seam for either. The
 * holder stands for this composition's own scope, which is the host's, and
 * its graceful close stays a drain step of `compose-host.ts` rather than a
 * finalizer, so a quit ends the session inside its own deadline.
 */
export const composeLive = (
  dependencies: LiveDependencies,
): Effect.Effect<LiveComposer, never, HostKernelTag | Scope.Scope> =>
  Effect.gen(function* () {
    const { settings, account, observation, brain } = dependencies;
    const kernel = yield* HostKernelTag;
    const { runMode } = kernel;

    const service = yield* LiveSessionHolder.make({
      source: () => account.voiceCapabilities.liveSessions,
      conversationEntries: () => brain.store.thread().entries(),
      roster: () => voiceRoster(observation.rosterForClients()),
      emit: (change) => kernel.emit(GATEWAY_EVENT.VOICE_LIVE_SESSION_CHANGED, carried(change)),
      createId: kernel.createId,
      report: kernel.report,
      onSessionCreated: () => {
        settings.recordProductEvent(PRODUCT_EVENT.VOICE_CALL_START, {
          session_source: VOICE_SOURCE_COUNTED_AS[account.voiceCapabilities.voiceSource],
        });
      },
    });

    const methods: GatewayMethodTable = {
      // The peer's offer becomes the one session, seeded and attached before
      // the answer leaves; the idempotency key on the method is what stops a
      // retried offer creating and billing a second one.
      [GATEWAY_METHOD.VOICE_CREATE_LIVE_SESSION]: (params) =>
        Effect.gen(function* () {
          const request = Either.getOrUndefined(
            readEither(voiceCreateLiveSessionParamsSchema)(params),
          );
          if (!request) return yield* invalid("sdp must be the peer's offer");
          const created = yield* service.createSession(request.sdp);
          if (!created)
            return yield* Effect.fail(
              new RefusedRefusal({ message: "no live session could be created" }),
            );
          return carried(created);
        }),
      [GATEWAY_METHOD.VOICE_END_LIVE_SESSION]: () => Effect.as(service.endSession(), {}),
      // The peer's transport is acted on here, where the transport is: a
      // failure is the session lost, a close is the graceful end.
      [GATEWAY_METHOD.VOICE_REPORT_LIVE_TRANSPORT]: (params) => {
        const report = Either.getOrUndefined(
          readEither(voiceReportLiveTransportParamsSchema)(params),
        );
        if (!report) return invalid("state is not one the peer connection reports");
        service.reportTransport(report.state);
        return Effect.succeed({});
      },
      // The peer's idle is carried to the service, whose exchange alone knows
      // when it last appended and whether a reply is still coming.
      [GATEWAY_METHOD.VOICE_REPORT_LIVE_ACTIVITY]: (params) => {
        const report = Either.getOrUndefined(
          readEither(voiceReportLiveActivityParamsSchema)(params),
        );
        if (!report) return invalid("idle must be a boolean");
        service.reportActivity(report.idle);
        return Effect.succeed({});
      },
      // The stop key alone: the mute the peer sends on its own says nothing
      // about Luke's output, so this is the one ask that tells him to stop.
      [GATEWAY_METHOD.VOICE_STOP_SPEAKING]: () =>
        Effect.sync(() => carried({ stopped: service.stopSpeaking() })),
      // What the host knows about why voice is or is not available, carrying no
      // credential and no session's SDP: the source's own reading while one
      // stands, and the reason there is none otherwise.
      [GATEWAY_METHOD.VOICE_DIAGNOSTICS]: () =>
        Effect.sync(() => ({
          diagnostics: carried(
            account.voiceCapabilities.liveSessions?.diagnostics() ??
              unavailableLiveDiagnostics({
                fixtureMode: !runMode.sendsNetwork,
                apiKeyConfigured: false,
              }),
          ),
        })),
      // One live event the renderer's tap saw cross the data channel, into the
      // development trace. Read again here for the shape the tap sends; on a
      // run without a writer — packaged, fixture, or simply untraced — it lands
      // here and stops.
      [GATEWAY_METHOD.VOICE_RECORD_TRACE]: (params) => {
        const trace = params.trace;
        if (!isAgentWireTrace(trace)) return invalid("trace is not one tapped wire event");
        account.agentTrace?.recordWire(trace);
        return Effect.succeed({});
      },
    };

    return {
      methods,
      service,
      // The session itself is closed by the drain, inside the quit's deadline,
      // before any composer stops; nothing is left here to give back.
      lifetime: Effect.void,
    };
  });
