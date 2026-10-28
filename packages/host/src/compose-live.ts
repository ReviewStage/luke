import type { TaskActivityFrame } from "@luke/features";
import { PRODUCT_EVENT, PRODUCT_VOICE_SESSION_SOURCE } from "@luke/features/analytics";
import {
  carried,
  GATEWAY_EVENT,
  GATEWAY_METHOD,
  type GatewayMethodTable,
  invalid,
  RefusedRefusal,
  voiceCreateLiveSessionParamsSchema,
  voiceEndLiveSessionParamsSchema,
  voiceReportLiveActivityParamsSchema,
  voiceReportLiveTransportParamsSchema,
} from "@luke/gateway";
import { isAgentWireTrace } from "@luke/gateway/devtrace";
import { unavailableLiveDiagnostics } from "@luke/voice";
import { LiveSessionHolder } from "@luke/voice/live-session";
import type { VoiceCallAbout } from "@luke/voice/voice-view";
import { readEither } from "@luke/wire/effect";
import { Effect, Result, type Scope } from "effect";
import type { AccountComposer } from "./compose-account.js";
import type { SettingsComposer } from "./compose-settings.js";
import type { Composer } from "./composer.js";
import { HostKernelTag } from "./effect/kernel.js";

export interface LiveComposer extends Composer {
  readonly service: LiveSessionHolder;
}

export interface LiveDependencies {
  settings: Pick<SettingsComposer, "recordProductEvent">;
  account: Pick<AccountComposer, "agentTrace"> & {
    readonly voiceCapabilities: Pick<AccountComposer["voiceCapabilities"], "liveSessions">;
  };
  /** The task an agent a call may go into is on, null for none, as the service reads it now; none for one no call goes into (`CodingAgentsComposer.callTaskOf`). */
  callTaskOf: (agentId: string) => Effect.Effect<string | null | undefined>;
  /** Where the service's word of what each part of Luke is doing on a call goes, and the call's end clearing it. */
  showTaskActivity: (activity: TaskActivityFrame) => void;
  /** Where a call's end goes, so what it was doing is cleared with it. */
  taskCallEnded: (about: VoiceCallAbout) => void;
}

/**
 * The GPT Live session as one concern of the host: the `voice.*` methods the
 * peer asks with, the `voiceLiveSession.changed` phases it is told, and the
 * holder that keeps the session open between them. The exchange is the
 * service's: every spoken ask is answered by the hosted agent, every reply
 * is appended by the service's own exchange over the same socket, and the
 * record is the account's on the service. What this side still does is
 * create the session for the peer's offer into an agent the account
 * reaches on eve, end it on the peer's hang-up or the drain, and carry the peer's idle and the stop key
 * to the service. It reaches no agent and writes no record, so it needs no seam
 * for either. The holder stands for this composition's own scope, which is
 * the host's, and its graceful close stays a drain step of `compose-host.ts`
 * rather than a finalizer, so a quit ends the session inside its own
 * deadline.
 */
export const composeLive = /* @__PURE__ */ Effect.fn("host/composeLive")(function* (
  dependencies: LiveDependencies,
): Effect.fn.Return<LiveComposer, never, HostKernelTag | Scope.Scope> {
  const { settings, account } = dependencies;
  const kernel = yield* HostKernelTag;
  const { runMode } = kernel;

  const service = yield* LiveSessionHolder.make({
    source: () => account.voiceCapabilities.liveSessions,
    emit: (change) => kernel.emit(GATEWAY_EVENT.VOICE_LIVE_SESSION_CHANGED, carried(change)),
    onSessionCreated: () => {
      settings.recordProductEvent(PRODUCT_EVENT.VOICE_CALL_START, {
        // Every session this Mac opens is the service's, on the account.
        session_source: PRODUCT_VOICE_SESSION_SOURCE.HOSTED,
      });
    },
    // What each part of Luke is doing on the call, as the service says it.
    onTaskActivity: (activity) => dependencies.showTaskActivity(activity),
    onTaskCallEnded: (about) => dependencies.taskCallEnded(about),
  });

  const methods: GatewayMethodTable = {
    // The peer's offer becomes the one session, seeded and attached before
    // the answer leaves; the idempotency key on the method is what stops a
    // retried offer creating and billing a second one.
    [GATEWAY_METHOD.VOICE_CREATE_LIVE_SESSION]: (params) =>
      Effect.gen(function* () {
        const request = Result.getOrUndefined(
          readEither(voiceCreateLiveSessionParamsSchema)(params),
        );
        if (!request) return yield* invalid("sdp must be the peer's offer");
        // Note that the agent is read here as well as on the service, so an
        // offer naming an agent archived, out of reach, or on a provider's
        // own harness creates and bills no session at all. The call is keyed
        // by the agent, whatever task the panel has open: one with no task
        // names none, and one on a task names that task and no other.
        const taskOf = yield* dependencies.callTaskOf(request.agentId);
        if (taskOf === undefined) {
          return yield* Effect.fail(
            new RefusedRefusal({ message: "the agent is not one a call may go into" }),
          );
        }
        if ((request.taskId ?? null) !== taskOf) {
          return yield* Effect.fail(
            new RefusedRefusal({ message: "the agent is not on the task named" }),
          );
        }
        const created = yield* service.createSession(request.sdp, {
          agentId: request.agentId,
          ...(taskOf === null ? undefined : { taskId: taskOf }),
        });
        if (!created)
          return yield* Effect.fail(
            new RefusedRefusal({ message: "no live session could be created" }),
          );
        return carried(created);
      }),
    // The peer's hang-up names its session, so an old call's ask ends nothing newer.
    [GATEWAY_METHOD.VOICE_END_LIVE_SESSION]: (params) => {
      const request = Result.getOrUndefined(readEither(voiceEndLiveSessionParamsSchema)(params));
      if (!request) return invalid("sessionId must name the session to end");
      return Effect.as(service.hangUp(request.sessionId), {});
    },
    // The peer's transport is acted on here, where the transport is: a
    // failure is the session lost, a close is the graceful end.
    [GATEWAY_METHOD.VOICE_REPORT_LIVE_TRANSPORT]: (params) => {
      const report = Result.getOrUndefined(
        readEither(voiceReportLiveTransportParamsSchema)(params),
      );
      if (!report) return invalid("the report must name a session and a state the peer reports");
      service.reportTransport(report);
      return Effect.succeed({});
    },
    // The peer's idle is carried to the service, whose exchange alone knows
    // when it last appended and whether a reply is still coming.
    [GATEWAY_METHOD.VOICE_REPORT_LIVE_ACTIVITY]: (params) => {
      const report = Result.getOrUndefined(readEither(voiceReportLiveActivityParamsSchema)(params));
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
            unavailableLiveDiagnostics({ fixtureMode: !runMode.sendsNetwork }),
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
