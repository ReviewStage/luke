import { PRODUCT_EVENT } from "@sidecar/analytics";
import type { BrainDelivery } from "@sidecar/brain";
import {
  carried,
  GATEWAY_ERROR,
  GATEWAY_EVENT,
  GATEWAY_METHOD,
  type GatewayMethodTable,
  gatewayError,
  gatewayOk,
  invalid,
  voiceCreateLiveSessionParamsSchema,
  voiceReportLiveActivityParamsSchema,
  voiceReportLiveTransportParamsSchema,
} from "@sidecar/gateway";
import { PROACTIVE_SPEECH_KIND } from "@sidecar/live";
import { VOICE_SOURCE_COUNTED_AS } from "@sidecar/settings";
import { lateRef } from "@sidecar/wire";
import { arrivalBeatOwed } from "./arrival-flow.js";
import type { AccountComposer } from "./compose-account.js";
import type { BrainComposer } from "./compose-brain.js";
import type { CalendarsComposer } from "./compose-calendars.js";
import type { ObservationComposer } from "./compose-observation.js";
import type { Composer, ComposerContext } from "./composer.js";
import { brainAgentLiveBrain } from "./voice/live-brain-adapter.js";
import { conversationLiveRecord } from "./voice/live-record.js";
import { LiveSessionService } from "./voice/live-session-service.js";

/** What the live session reaches in the brain that re-decides a held briefing. */
interface LiveLinks {
  releaseHeld: (briefings: readonly BrainDelivery[]) => void;
}

export interface LiveComposer extends Composer {
  readonly service: LiveSessionService<BrainDelivery>;
  link: (links: LiveLinks) => void;
}

export interface LiveDependencies extends ComposerContext {
  account: AccountComposer;
  calendars: CalendarsComposer;
  observation: ObservationComposer;
  brain: BrainComposer;
}

/**
 * The GPT Live session as one concern of the host: the four `voice.*`
 * methods the peer asks with, the `voiceLiveSession.changed` phases it is
 * told, and the service that owns the session between them. The brain is
 * reached only through the live brain interface, adapted onto main's agent
 * here; the record only through the Conversation writer. The old speech
 * path stands beside this one and is still what the renderer uses; a
 * briefing reaches this composer only while a session stands.
 */
export function composeLive(dependencies: LiveDependencies): LiveComposer {
  const { kernel, settings, account, calendars, observation, brain } = dependencies;
  const { now } = kernel;
  const links = lateRef<LiveLinks>("the live composer's links");

  const service = new LiveSessionService<BrainDelivery>({
    source: () => account.voiceCapabilities.liveSessions,
    brain: brainAgentLiveBrain({
      agent: () => brain.wiring.current(),
      rosterView: () => observation.roster().text,
    }),
    record: conversationLiveRecord({
      recordConversationEntry: (entry, recordedAt, sessionKey) =>
        brain.store.recordConversationEntry(entry, recordedAt, sessionKey),
      createEventId: kernel.createId,
    }),
    conversationEntries: () => brain.store.thread().entries(),
    quietNow: () => calendars.announcementsQuietNow(now()),
    releaseHeldBriefings: (held) => links.get().releaseHeld(held),
    emit: (change) => kernel.emit(GATEWAY_EVENT.VOICE_LIVE_SESSION_CHANGED, carried(change)),
    now,
    schedule: (callback, delayMs) => setTimeout(callback, delayMs),
    cancel: (timer) => {
      // SAFETY: a timer this service cancels is one the scheduler above made, a Node timeout.
      clearTimeout(timer as NodeJS.Timeout);
    },
    createId: kernel.createId,
    report: kernel.report,
    ...(account.agentTrace
      ? { trace: (record) => account.agentTrace?.recordSpeechDecision(record) }
      : undefined),
    onSessionCreated: () => {
      settings.recordProductEvent(PRODUCT_EVENT.VOICE_CALL_START, {
        credential_source: VOICE_SOURCE_COUNTED_AS[account.voiceCapabilities.voiceSource],
      });
    },
    onProactiveSpoken: (kind) => {
      if (kind === PROACTIVE_SPEECH_KIND.BRIEFING) {
        settings.recordProductEvent(PRODUCT_EVENT.VOICE_ANNOUNCEMENT_SPEAK, {});
      }
      if (kind === PROACTIVE_SPEECH_KIND.ARRIVAL && arrivalBeatOwed(calendars.onboarding())) {
        calendars.writeOnboarding({ arrivalSpokenAt: new Date(now()).toISOString() });
      }
    },
  });

  const methods: GatewayMethodTable = {
    // The peer's offer becomes the one session, seeded and attached before
    // the answer leaves; the idempotency key on the method is what stops a
    // retried offer creating and billing a second one.
    [GATEWAY_METHOD.VOICE_CREATE_LIVE_SESSION]: async (params) => {
      const request = voiceCreateLiveSessionParamsSchema.parse(params);
      if (!request) return invalid("sdp must be the peer's offer");
      const created = await service.createSession(request.sdp);
      if (!created) return gatewayError(GATEWAY_ERROR.REFUSED, "no live session could be created");
      return gatewayOk(carried(created));
    },
    [GATEWAY_METHOD.VOICE_END_LIVE_SESSION]: async () => {
      await service.endSession();
      return gatewayOk({});
    },
    [GATEWAY_METHOD.VOICE_REPORT_LIVE_TRANSPORT]: (params) => {
      const report = voiceReportLiveTransportParamsSchema.parse(params);
      if (!report) return invalid("state is not one the peer connection reports");
      service.reportTransport(report.state);
      return gatewayOk({});
    },
    [GATEWAY_METHOD.VOICE_REPORT_LIVE_ACTIVITY]: (params) => {
      const report = voiceReportLiveActivityParamsSchema.parse(params);
      if (!report) return invalid("idle must be a boolean");
      service.reportActivity(report.idle);
      return gatewayOk({});
    },
  };

  return {
    methods,
    service,
    link: (next) => links.set(next),
    start: async () => undefined,
    // The session itself is closed by the drain, inside the quit's deadline,
    // before any composer stops; nothing is left here to give back.
    stop: async () => undefined,
  };
}
