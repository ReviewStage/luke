import { PRODUCT_EVENT, PRODUCT_VOICE_SESSION_SOURCE, productSignInAge } from "@sidecar/analytics";
import { ACCOUNT_STATUS } from "@sidecar/credentials";
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
import { type SessionBeatFrame, VOICE_SERVICE_FRAME } from "@sidecar/hosted";
import { PROACTIVE_SPEECH_KIND } from "@sidecar/live";
import { SESSION_STATUS } from "@sidecar/session";
import { APP_SETTING_SCHEMA, voiceHotkeyCandidates, voiceHotkeyLabel } from "@sidecar/settings";
import { unavailableLiveDiagnostics } from "@sidecar/voice";
import { type BeatKind, LiveSessionHolder } from "@sidecar/voice/live-session";
import { readEither } from "@sidecar/wire/effect";
import { Effect, Either, Queue, type Scope } from "effect";
import {
  arrivalBeatOwed,
  countsFirstAnnouncement,
  firstNameOf,
  launchGreetingOwed,
} from "./arrival-flow.js";
import type { AccountComposer } from "./compose-account.js";
import type { CalendarsComposer } from "./compose-calendars.js";
import type { ObservationComposer } from "./compose-observation.js";
import type { SettingsComposer } from "./compose-settings.js";
import type { Composer } from "./composer.js";
import { HostKernelTag } from "./effect/kernel.js";
import { voiceRoster } from "./voice-roster.js";

export interface LiveComposer extends Composer {
  readonly service: LiveSessionHolder;
  /**
   * The onboarding beats and the launch greeting, asked for when their
   * deterministic reason stands. Every caller asks and waits for nothing — the
   * account gate, the launch, the onboarding record's writes, and the hold's
   * reads are all synchronous or fire-and-forget — so the ask offers the
   * decision's own effect to this composer's queue and answers at once. A
   * decision runs one at a time on a fiber of this composer's scope: a quit
   * ends one in flight, and one that fails takes no caller and no later ask
   * with it.
   */
  requestOnboardingBeat: () => void;
  /** Asked when the announcement hold was read again: the beat the hold kept is asked for once it has lifted. */
  onAnnouncementHoldRead: () => void;
  /** The arrival beat's own moment, recorded at the first sign-in ever observed. */
  seedArrivalOnFirstSignIn: () => void;
  /** Every beat not yet sent is dropped; a sign-out is no reason to keep one waiting for a session. */
  withdrawBeats: () => void;
}

export interface LiveDependencies {
  settings: SettingsComposer;
  account: AccountComposer;
  observation: ObservationComposer;
  calendars: CalendarsComposer;
}

/** The three beats this side decides, each withdrawn together at a sign-out. */
const BEAT_KINDS: readonly BeatKind[] = [
  PROACTIVE_SPEECH_KIND.ARRIVAL,
  PROACTIVE_SPEECH_KIND.CALENDAR_ONBOARDING,
  PROACTIVE_SPEECH_KIND.LAUNCH,
];

/**
 * The GPT Live session as one concern of the host: the `voice.*` methods the
 * peer asks with, the `voiceLiveSession.changed` phases it is told, and the
 * holder that keeps the session open between them. The exchange is the
 * service's: every spoken ask is answered by the hosted brain, every reply
 * and briefing is appended by the service's own exchange over the same
 * socket, and the record is the account's on the service. What this side
 * still does is create the session for the peer's offer, seeded from the
 * desk as this Mac sees it; end it on the peer's hang-up or the drain; carry
 * the peer's idle and the stop key to the service; and decide the three
 * beats Luke says unprompted on this Mac's own reasons — the arrival beat
 * once per install, the calendar line while the gate shows, the launch
 * greeting once per run — asking the service to speak each from the build's
 * script with the bounded values the script may mention, and opening a muted
 * session for one when none stands. The words are the service's; what the
 * service tells back, by kind, is that a turn was spoken to its end, which
 * is what settles the arrival's moment and the first-announcement count
 * here. It reaches no brain and writes no record, so it needs no seam for
 * either. The holder stands for this composition's own scope, which is the
 * host's, and its graceful close stays a drain step of `compose-host.ts`
 * rather than a finalizer, so a quit ends the session inside its own
 * deadline.
 */
export const composeLive = (
  dependencies: LiveDependencies,
): Effect.Effect<LiveComposer, never, HostKernelTag | Scope.Scope> =>
  Effect.gen(function* () {
    const { settings, account, observation, calendars } = dependencies;
    const kernel = yield* HostKernelTag;
    const { now, runMode } = kernel;

    // What a caller asked for and nothing waits on: each decision is taken in
    // turn by a fiber of this composer's scope, and one that dies is written
    // down rather than left to end the fiber every later ask needs.
    const asks = yield* Queue.unbounded<Effect.Effect<void>>();
    yield* Effect.forkScoped(
      Effect.forever(
        Effect.flatMap(Queue.take(asks), (ask) =>
          Effect.catchAllDefect(ask, (defect) =>
            Effect.logError("an onboarding beat failed", defect),
          ),
        ),
      ),
    );

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

    /** The beats spoken to the end this run: each is one line, said once per run whatever re-asks it. */
    const spokenThisRun = new Set<BeatKind>();

    const service = yield* LiveSessionHolder.make({
      source: () => account.voiceCapabilities.liveSessions,
      // This Mac keeps no conversation lines to seed a session from: the
      // Conversation is the service's record, and what the session is told of
      // it is the exchange's to append over the socket.
      conversationEntries: () => [],
      roster: () => voiceRoster(observation.rosterForClients()),
      emit: (change) => kernel.emit(GATEWAY_EVENT.VOICE_LIVE_SESSION_CHANGED, carried(change)),
      createId: kernel.createId,
      report: kernel.report,
      onSessionCreated: () => {
        settings.recordProductEvent(PRODUCT_EVENT.VOICE_CALL_START, {
          // Every session this Mac opens is the service's, on the account.
          session_source: PRODUCT_VOICE_SESSION_SOURCE.HOSTED,
        });
      },
      // The service's word that a turn was spoken to its end, by kind: the
      // counts and the arrival's moment are this side's record, kept here as
      // they were when the queue that spoke them stood on this Mac.
      onSpoken: (kind) => {
        if (kind === PROACTIVE_SPEECH_KIND.BRIEFING) {
          settings.recordProductEvent(PRODUCT_EVENT.VOICE_ANNOUNCEMENT_SPEAK, {});
          markFirstAnnouncementSpoken();
          return;
        }
        spokenThisRun.add(kind);
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
    const arrivalBeat = Effect.gen(function* () {
      const working = observation
        .rosterForClients()
        .find((session) => session.status === SESSION_STATUS.WORKING);
      const talkKey = voiceHotkeyCandidates(
        yield* Effect.orDie(settings.store.get(APP_SETTING_SCHEMA.voiceHotkey.field)),
      )[0];
      const beat: SessionBeatFrame = {
        type: VOICE_SERVICE_FRAME.SESSION_BEAT,
        kind: PROACTIVE_SPEECH_KIND.ARRIVAL,
        ...(working ? { sessionTitle: working.title } : undefined),
        ...(talkKey === undefined ? undefined : { talkKeyLabel: voiceHotkeyLabel(talkKey) }),
      };
      return beat;
    });

    /**
     * The launch greeting's one observed value is the signed-in account's
     * first name, read from the snapshot the host already holds and never
     * from a session. Once per run means spoken once per run: an ask a hold
     * took back or a session lost before speaking it stands again, and the
     * holder refuses a second ask while one is still waiting or with the
     * service.
     */
    function launchGreeting(): SessionBeatFrame {
      const snapshot = account.snapshot();
      const name = snapshot.status === ACCOUNT_STATUS.SIGNED_IN ? snapshot.name : undefined;
      const firstName = firstNameOf(name);
      return {
        type: VOICE_SERVICE_FRAME.SESSION_BEAT,
        kind: PROACTIVE_SPEECH_KIND.LAUNCH,
        ...(firstName === undefined ? undefined : { firstName }),
      };
    }

    /**
     * Whether a beat was owed and kept back by the hold, so the hold's next
     * read that finds it lifted asks again, and a read that finds it lifted
     * with nothing kept asks for nothing.
     */
    let beatHeld = false;

    /**
     * Whether speech is held right now, or cannot yet be known to be free: a
     * meeting or the pause, as the hold reads them, and, while meetings are to
     * be kept quiet through, the moment before the first calendar pass has
     * said whether one stands, since a launch into a meeting must not speak
     * before the pass that would have held it.
     */
    const speechHeld = Effect.gen(function* () {
      const at = now();
      if (yield* calendars.announcementsQuietNow(at)) return true;
      const quietDuringMeetings = yield* Effect.orDie(
        settings.store.get(APP_SETTING_SCHEMA.quietDuringMeetings.field),
      );
      return quietDuringMeetings && (yield* calendars.meetingQuietUntil(at)) === undefined;
    });

    /**
     * Which beat is owed, decided from this Mac's own record and nothing the
     * service knows: one ask at a time, in the order the onboarding runs. A
     * hold — a meeting, the pause, the first pass not yet in — keeps a beat
     * from being asked at all rather than sending it to a service that would
     * speak it through the hold; the hold's next read that finds it lifted
     * asks again.
     */
    const onboardingBeat = Effect.gen(function* () {
      if (!runMode.requiresAccount || !account.signedIn()) return;
      if (!account.voiceCapabilities.liveSessions) return;
      // The greeting comes first and speaks in its own session; the beats are
      // asked for again by the completion that takes the introduction down.
      if (calendars.introductionOwed()) return;
      // The key step has no beat of its own: the gate says on screen what it
      // asks, and the calendar beat waits its turn behind it.
      if (calendars.keyGateOwed()) return;
      if (yield* speechHeld) {
        beatHeld = true;
        return;
      }
      beatHeld = false;
      if (yield* calendars.gateOfferable()) {
        if (spokenThisRun.has(PROACTIVE_SPEECH_KIND.CALENDAR_ONBOARDING)) return;
        service.speakBeat({
          type: VOICE_SERVICE_FRAME.SESSION_BEAT,
          kind: PROACTIVE_SPEECH_KIND.CALENDAR_ONBOARDING,
        });
        return;
      }
      // The gate settled with the calendar line still waiting for a session: its reason has gone.
      service.withdrawBeat(PROACTIVE_SPEECH_KIND.CALENDAR_ONBOARDING);
      if (arrivalBeatOwed(calendars.onboarding())) {
        // The beat's own decision waits on the pass, so the pass is yielded
        // here rather than run: a link that cannot wait for it offers this
        // whole effect to the queue above instead.
        yield* observation.loop.refresh;
        if (!account.signedIn() || !arrivalBeatOwed(calendars.onboarding())) return;
        // The pass took time, and the hold's reads wait behind this decision
        // on the same queue: a hold that began during the pass is read here.
        if (yield* speechHeld) {
          beatHeld = true;
          return;
        }
        service.speakBeat(yield* arrivalBeat);
        return;
      }
      service.withdrawBeat(PROACTIVE_SPEECH_KIND.ARRIVAL);
      // The launch that heard the arrival has been greeted by it: the arrival's
      // own write asks again here, and must not find the greeting owed.
      if (spokenThisRun.has(PROACTIVE_SPEECH_KIND.ARRIVAL)) return;
      if (
        !launchGreetingOwed(calendars.onboarding(), spokenThisRun.has(PROACTIVE_SPEECH_KIND.LAUNCH))
      )
        return;
      service.speakBeat(launchGreeting());
    });

    /**
     * The hold read again. A hold that has begun takes back every beat still
     * waiting for a session (one the service already has is the service's to
     * speak) and keeps it as held; a read that finds speech free asks again
     * for what was kept, and for nothing otherwise.
     */
    const holdRead = Effect.gen(function* () {
      if (yield* speechHeld) {
        for (const kind of BEAT_KINDS) {
          if (service.withdrawBeat(kind)) beatHeld = true;
        }
        return;
      }
      if (!beatHeld) return;
      yield* onboardingBeat;
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
      requestOnboardingBeat: () => {
        Queue.unsafeOffer(asks, onboardingBeat);
      },
      onAnnouncementHoldRead: () => {
        Queue.unsafeOffer(asks, holdRead);
      },
      seedArrivalOnFirstSignIn: () => {
        if (calendars.onboarding()?.arrivalSignedInAt !== undefined) return;
        calendars.writeOnboarding({ arrivalSignedInAt: new Date(now()).toISOString() });
      },
      withdrawBeats: () => {
        for (const kind of BEAT_KINDS) service.withdrawBeat(kind);
      },
      // The session itself is closed by the drain, inside the quit's deadline,
      // before any composer stops; nothing is left here to give back.
      lifetime: Effect.void,
    };
  });
