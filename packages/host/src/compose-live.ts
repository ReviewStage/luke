import { PRODUCT_EVENT, PRODUCT_VOICE_SESSION_SOURCE } from "@sidecar/analytics";
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
import type { PlanActivityFrame, PlanCodeFrame, PlanDraftFrame } from "@sidecar/hosted";
import { unavailableLiveDiagnostics } from "@sidecar/voice";
import { LIVE_SESSION_END_CAUSE, LiveSessionHolder } from "@sidecar/voice/live-session";
import { readEither } from "@sidecar/wire/effect";
import { Effect, Result, type Scope } from "effect";
import type { AccountComposer } from "./compose-account.js";
import type { SettingsComposer } from "./compose-settings.js";
import type { Composer } from "./composer.js";
import { HostKernelTag } from "./effect/kernel.js";

export interface LiveComposer extends Composer {
  readonly service: LiveSessionHolder;
}

export interface LiveDependencies {
  settings: SettingsComposer;
  account: AccountComposer;
  /** The plan the panel has open, the one plan a planning call may be created about; nothing while it has none. */
  activePlanId: () => string | undefined;
  /** Where a draft of the open plan goes as the service's notetaker writes it during a planning call. */
  showPlanDraft: (draft: PlanDraftFrame) => void;
  /** Where the service's word of what each part of Luke is doing on a planning call goes, and the call's end clearing it. */
  showPlanActivity: (activity: PlanActivityFrame) => void;
  /** Where code Luke puts on screen during a planning call goes. */
  showPlanCode: (code: PlanCodeFrame) => void;
  /** Where a planning call's end goes, so the code it put on screen is cleared with it. */
  planCallEnded: (planId: string) => void;
}

/**
 * The GPT Live session as one concern of the host: the `voice.*` methods the
 * peer asks with, the `voiceLiveSession.changed` phases it is told, and the
 * holder that keeps the session open between them. The exchange is the
 * service's: every spoken ask is answered by the hosted brain, every reply
 * is appended by the service's own exchange over the same socket, and the
 * record is the account's on the service. What this side still does is
 * create the session for the peer's offer about the open plan, end it on the
 * peer's hang-up or the drain, and carry the peer's idle and the stop key to
 * the service. It reaches no brain and writes no record, so it needs no seam
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
    // The plan a planning call is writing, as the service's notetaker drafts it.
    onPlanDraft: (draft) => dependencies.showPlanDraft(draft),
    // What each part of Luke is doing on the call, as the service says it.
    onPlanActivity: (activity) => dependencies.showPlanActivity(activity),
    onPlanCode: (code) => dependencies.showPlanCode(code),
    onPlanCallEnded: (planId) => dependencies.planCallEnded(planId),
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
        // An offer about a plan the window no longer has open (another was
        // opened, or the window closed, while the offer was out) is refused, so
        // no call about one plan is created while another is on screen.
        if (request.planId !== dependencies.activePlanId()) {
          return yield* Effect.fail(
            new RefusedRefusal({ message: "the plan is not the one the panel has open" }),
          );
        }
        const created = yield* service.createSession(request.sdp, request.planId);
        if (!created)
          return yield* Effect.fail(
            new RefusedRefusal({ message: "no live session could be created" }),
          );
        return carried(created);
      }),
    [GATEWAY_METHOD.VOICE_END_LIVE_SESSION]: () =>
      Effect.as(service.endSession(LIVE_SESSION_END_CAUSE.HANG_UP), {}),
    // The peer's transport is acted on here, where the transport is: a
    // failure is the session lost, a close is the graceful end.
    [GATEWAY_METHOD.VOICE_REPORT_LIVE_TRANSPORT]: (params) => {
      const report = Result.getOrUndefined(
        readEither(voiceReportLiveTransportParamsSchema)(params),
      );
      if (!report) return invalid("state is not one the peer connection reports");
      service.reportTransport(report.state, report.reason);
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
