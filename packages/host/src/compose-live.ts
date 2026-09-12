import { PRODUCT_EVENT, productSignInAge } from "@sidecar/analytics";
import type { BrainDelivery } from "@sidecar/brain";
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
import { PROACTIVE_SPEECH_KIND } from "@sidecar/live";
import { SESSION_STATUS } from "@sidecar/session";
import {
  APP_SETTING_SCHEMA,
  VOICE_SOURCE_COUNTED_AS,
  voiceHotkeyCandidates,
  voiceHotkeyLabel,
} from "@sidecar/settings";
import { unavailableLiveDiagnostics } from "@sidecar/voice";
import { LiveBrainTag, LiveRecordTag } from "@sidecar/voice/effect";
import { LiveSessionService, type TimerHandle } from "@sidecar/voice/live-session";
import { readEither } from "@sidecar/wire/effect";
import type { Fiber } from "effect";
import { Clock, Duration, Effect, Either, FiberId, Option, Runtime } from "effect";
import { arrivalBeatOwed, countsFirstAnnouncement } from "./arrival-flow.js";
import type { AccountComposer } from "./compose-account.js";
import type { BrainComposer } from "./compose-brain.js";
import type { CalendarsComposer } from "./compose-calendars.js";
import type { ObservationComposer } from "./compose-observation.js";
import type { SettingsComposer } from "./compose-settings.js";
import type { Composer } from "./composer.js";
import { HostKernelTag, lateService } from "./effect/kernel.js";
import { voiceRoster } from "./voice-roster.js";

/**
 * The `now`/`schedule`/`cancel` seam `LiveSessionService` still takes as a
 * constructor argument, answered from this composition's own Effect runtime
 * rather than Node's own `setTimeout` — a package-local bridge rather than a
 * shared `@sidecar/host/effect` export, since P12-03 deleted
 * `@sidecar/runtime/effect`'s `timersFromRuntime` with the `ScheduledTimer`
 * seam it answered. Starting the fiber here is a run outside an Effect,
 * which the "runtime only at an edge" rule allows precisely because this is
 * that edge: it starts the work on the runtime it was handed rather than
 * building a second one. `cancel` has no way to be awaited, so it interrupts
 * the fiber without waiting for the interruption to finish: what it must
 * guarantee is that the callback does not run afterwards, never that the
 * fiber has already ended.
 */
const liveSessionTimersOnRuntime = (runtime: Runtime.Runtime<never>) => {
  const sync = Runtime.runSync(runtime);
  const fork = Runtime.runFork(runtime);
  const armed = new Map<TimerHandle, Fiber.RuntimeFiber<void>>();
  return {
    now: () => sync(Clock.currentTimeMillis),
    schedule: (callback: () => void, delayMs: number): TimerHandle => {
      const handle: TimerHandle = {};
      const fiber = fork(
        Effect.delay(Effect.sync(callback), Duration.millis(delayMs)).pipe(
          Effect.ensuring(Effect.sync(() => armed.delete(handle))),
        ),
      );
      armed.set(handle, fiber);
      return handle;
    },
    cancel: (timer: TimerHandle) => {
      const fiber = armed.get(timer);
      if (fiber === undefined) return;
      armed.delete(timer);
      fiber.unsafeInterruptAsFork(FiberId.none);
    },
  };
};

/** What the live session reaches in the brain that re-decides a held briefing. */
interface LiveLinks {
  releaseHeld: (briefings: readonly BrainDelivery[]) => void;
}

export interface LiveComposer extends Composer {
  readonly service: LiveSessionService<BrainDelivery>;
  /** The two onboarding beats, asked for when their deterministic reason stands. */
  requestOnboardingBeat: () => Promise<void>;
  /** The arrival beat's own moment, recorded at the first sign-in ever observed. */
  seedArrivalOnFirstSignIn: () => void;
  link: (links: LiveLinks) => void;
}

export interface LiveDependencies {
  settings: SettingsComposer;
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
 * wants one. The brain is reached only through the live brain interface, and
 * the record only through the Conversation writer; both are handed in as
 * `@sidecar/voice/effect` layers by the caller that composed them
 * (`compose-host.ts`) rather than built here, so this composer states only
 * that it needs one of each. The kernel and those two seams are read as
 * tags; the sibling composers stay constructor arguments, since the cycles
 * between them forbid tags.
 */
export const composeLive = (
  dependencies: LiveDependencies,
): Effect.Effect<LiveComposer, never, HostKernelTag | LiveBrainTag | LiveRecordTag> =>
  Effect.gen(function* () {
    const { settings, account, calendars, observation, brain } = dependencies;
    const kernel = yield* HostKernelTag;
    const liveBrain = yield* LiveBrainTag;
    const liveRecord = yield* LiveRecordTag;
    const { now, runMode } = kernel;
    const late = yield* lateService<LiveLinks>();
    const links = (): LiveLinks => {
      const standing = late.unsafePeek();
      if (Option.isNone(standing)) {
        throw new Error("the live composer's links are read before link() has run");
      }
      return standing.value;
    };
    // The service's own idle, settle, and finalize timers, over the Effect
    // runtime this composition runs on rather than Node's own `setTimeout`, so
    // a test driving a `TestClock` drives them too.
    const timers = liveSessionTimersOnRuntime(yield* Effect.runtime<never>());

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

    const service = new LiveSessionService<BrainDelivery>({
      source: () => account.voiceCapabilities.liveSessions,
      brain: liveBrain,
      record: liveRecord,
      conversationEntries: () => brain.store.thread().entries(),
      roster: () => voiceRoster(observation.rosterForClients()),
      quietNow: () => calendars.announcementsQuietNow(now()),
      releaseHeldBriefings: (held) => links().releaseHeld(held),
      emit: (change) => kernel.emit(GATEWAY_EVENT.VOICE_LIVE_SESSION_CHANGED, carried(change)),
      now: timers.now,
      schedule: timers.schedule,
      cancel: timers.cancel,
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

    // The desk moving is the one thing that refreshes what the voice knows of
    // it. The service holds the append until the change settles and sends
    // nothing while no session stands, so a roster that moves all day on a
    // quiet Mac costs nothing.
    observation.onRosterChange((sessions) => {
      service.updateRoster(voiceRoster(sessions));
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
      [GATEWAY_METHOD.VOICE_CREATE_LIVE_SESSION]: (params) =>
        Effect.gen(function* () {
          const request = Either.getOrUndefined(
            readEither(voiceCreateLiveSessionParamsSchema)(params),
          );
          if (!request) return yield* invalid("sdp must be the peer's offer");
          const created = yield* Effect.promise(() => service.createSession(request.sdp));
          if (!created)
            return yield* Effect.fail(
              new RefusedRefusal({ message: "no live session could be created" }),
            );
          return carried(created);
        }),
      [GATEWAY_METHOD.VOICE_END_LIVE_SESSION]: () =>
        Effect.as(
          Effect.promise(() => service.endSession()),
          {},
        ),
      [GATEWAY_METHOD.VOICE_REPORT_LIVE_TRANSPORT]: (params) => {
        const report = Either.getOrUndefined(
          readEither(voiceReportLiveTransportParamsSchema)(params),
        );
        if (!report) return invalid("state is not one the peer connection reports");
        service.reportTransport(report.state);
        return Effect.succeed({});
      },
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
      requestOnboardingBeat,
      seedArrivalOnFirstSignIn: () => {
        if (calendars.onboarding()?.arrivalSignedInAt !== undefined) return;
        calendars.writeOnboarding({ arrivalSignedInAt: new Date(now()).toISOString() });
      },
      link: (next) => {
        late.unsafeSet(next);
      },
      // The session itself is closed by the drain, inside the quit's deadline,
      // before any composer stops; nothing is left here to give back.
      lifetime: Effect.void,
    };
  });
