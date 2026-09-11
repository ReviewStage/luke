import { PRODUCT_EVENT, productSignInAge } from "@sidecar/analytics";
import type { BrainDelivery } from "@sidecar/brain";
import { isAgentWireTrace } from "@sidecar/devtrace/vocabulary";
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
import { SESSION_STATUS } from "@sidecar/session";
import {
  APP_SETTING_SCHEMA,
  VOICE_SOURCE_COUNTED_AS,
  voiceHotkeyCandidates,
  voiceHotkeyLabel,
} from "@sidecar/settings";
import { unavailableLiveDiagnostics } from "@sidecar/voice";
import { lateRef } from "@sidecar/wire";
import { arrivalBeatOwed, countsFirstAnnouncement } from "./arrival-flow.js";
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
  /** The two onboarding beats, asked for when their deterministic reason stands. */
  requestOnboardingBeat: () => Promise<void>;
  /** A typed ask main's brain accepted: its run followed on the agent standing now, and its reply spoken by the session. */
  followTypedAsk: (question: string, runId: string) => void;
  /** The arrival beat's own moment, recorded at the first sign-in ever observed. */
  seedArrivalOnFirstSignIn: () => void;
  link: (links: LiveLinks) => void;
}

export interface LiveDependencies extends ComposerContext {
  account: AccountComposer;
  calendars: CalendarsComposer;
  observation: ObservationComposer;
  brain: BrainComposer;
}

/**
 * The GPT Live session as one concern of the host: the `voice.*` methods the
 * peer asks with, the `voiceLiveSession.changed` phases it is told, and the
 * service that owns the session between them. It is the one sink for
 * everything Luke says unprompted — a briefing the brain decided, a typed
 * ask's reply, the two onboarding beats — each spoken into the standing
 * session or into the one the peer opens muted when the service says it
 * wants one. The brain is reached only through the live brain interface,
 * adapted onto main's agent here; the record only through the Conversation
 * writer.
 */
export function composeLive(dependencies: LiveDependencies): LiveComposer {
  const { kernel, settings, account, calendars, observation, brain } = dependencies;
  const { now, runMode } = kernel;
  const links = lateRef<LiveLinks>("the live composer's links");

  function markFirstAnnouncementSpoken(): void {
    const onboardingState = calendars.onboarding();
    if (!countsFirstAnnouncement(onboardingState)) return;
    const signedInAt = onboardingState?.arrivalSignedInAt;
    const at = now();
    const signedInAtMs = signedInAt !== undefined ? Date.parse(signedInAt) : Number.NaN;
    if (Number.isFinite(signedInAtMs)) {
      settings.recordProductEvent(PRODUCT_EVENT.VOICE_FIRST_ANNOUNCEMENT, {
        sign_in_age: productSignInAge(at - signedInAtMs),
      });
    }
    calendars.writeOnboarding({ arrivalFirstAnnouncementAt: new Date(at).toISOString() });
  }

  const liveBrain = brainAgentLiveBrain({
    agent: () => brain.wiring.current(),
    rosterView: () => observation.roster().text,
  });
  const service = new LiveSessionService<BrainDelivery>({
    source: () => account.voiceCapabilities.liveSessions,
    brain: liveBrain,
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
        session_source: VOICE_SOURCE_COUNTED_AS[account.voiceCapabilities.voiceSource],
      });
    },
    onProactiveSpoken: (kind) => {
      if (kind === PROACTIVE_SPEECH_KIND.BRIEFING) {
        settings.recordProductEvent(PRODUCT_EVENT.VOICE_ANNOUNCEMENT_SPEAK, {});
        markFirstAnnouncementSpoken();
      }
      if (kind === PROACTIVE_SPEECH_KIND.ARRIVAL && arrivalBeatOwed(calendars.onboarding())) {
        calendars.writeOnboarding({ arrivalSpokenAt: new Date(now()).toISOString() });
      }
    },
  });

  /**
   * The arrival beat's observed values: one working session's title, read
   * from the same roster the rows draw, and the talk key worded for a
   * sentence, read from the stored choice the desktop registers first. The
   * key is suggested only while voice could actually take it.
   */
  async function arrivalBeat() {
    const working = observation
      .rosterForClients()
      .find((session) => session.status === SESSION_STATUS.WORKING);
    const talkKey = voiceHotkeyCandidates(
      await settings.store.get(APP_SETTING_SCHEMA.voiceHotkey.field),
    )[0];
    return {
      kind: PROACTIVE_SPEECH_KIND.ARRIVAL,
      decidedAt: now(),
      ...(working ? { sessionTitle: working.title } : undefined),
      ...(talkKey === undefined ? undefined : { talkKeyLabel: voiceHotkeyLabel(talkKey) }),
    } as const;
  }

  async function requestOnboardingBeat(): Promise<void> {
    if (!runMode.requiresAccount || !account.signedIn()) return;
    if (!account.voiceCapabilities.liveSessions) return;
    if (await calendars.gateOfferable()) {
      service.speakBeat({ kind: PROACTIVE_SPEECH_KIND.CALENDAR_ONBOARDING, decidedAt: now() });
      return;
    }
    if (!arrivalBeatOwed(calendars.onboarding())) return;
    await observation.loop.refresh().catch(() => undefined);
    if (!account.signedIn() || !arrivalBeatOwed(calendars.onboarding())) return;
    service.speakBeat(await arrivalBeat());
  }

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
    // The stop key alone: the mute the peer sends on its own says nothing
    // about Luke's output, so this is the one ask that tells him to stop.
    [GATEWAY_METHOD.VOICE_STOP_SPEAKING]: () =>
      gatewayOk(carried({ stopped: service.stopSpeaking() })),
    // What the host knows about why voice is or is not available, carrying no
    // credential and no session's SDP: the source's own reading while one
    // stands, and the reason there is none otherwise.
    [GATEWAY_METHOD.VOICE_DIAGNOSTICS]: () =>
      gatewayOk({
        diagnostics: carried(
          account.voiceCapabilities.liveSessions?.diagnostics() ??
            unavailableLiveDiagnostics({
              fixtureMode: !runMode.sendsNetwork,
              apiKeyConfigured: false,
            }),
        ),
      }),
    // One live event the renderer's tap saw cross the data channel, into the
    // development trace. Read again here for the shape the tap sends; on a
    // run without a writer — packaged, fixture, or simply untraced — it lands
    // here and stops.
    [GATEWAY_METHOD.VOICE_RECORD_TRACE]: (params) => {
      if (!isAgentWireTrace(params.trace)) return invalid("trace is not one tapped wire event");
      account.agentTrace?.recordWire(params.trace);
      return gatewayOk({});
    },
  };

  return {
    methods,
    service,
    requestOnboardingBeat,
    followTypedAsk: (question, runId) => {
      liveBrain.followCurrent();
      service.followTypedAsk(question, runId);
    },
    seedArrivalOnFirstSignIn: () => {
      if (calendars.onboarding()?.arrivalSignedInAt !== undefined) return;
      calendars.writeOnboarding({ arrivalSignedInAt: new Date(now()).toISOString() });
    },
    link: (next) => links.set(next),
    start: async () => undefined,
    // The session itself is closed by the drain, inside the quit's deadline,
    // before any composer stops; nothing is left here to give back.
    stop: async () => undefined,
  };
}
