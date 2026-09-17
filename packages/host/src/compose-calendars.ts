import { PRODUCT_CALENDAR_SOURCE, PRODUCT_EVENT, PRODUCT_SETTING_VALUE } from "@sidecar/analytics";
import {
  activeMeetingEnd,
  GoogleCalendarReader,
  googleCalendarSignIn,
  type MeetingInterval,
  nextMeetingBoundary,
} from "@sidecar/calendar";
import {
  APPLE_CALENDAR_ACCESS,
  APPLE_CALENDAR_ID,
  CALENDAR_PRIVACY_PANE_URL,
} from "@sidecar/calendar/vocabulary";
import {
  carried,
  GATEWAY_EVENT,
  GATEWAY_METHOD,
  type GatewayMethodTable,
  invalid,
  NODE_CAPABILITY_STATUS,
} from "@sidecar/gateway";
import { ObservationLoop } from "@sidecar/runtime";
import { cadenceGate } from "@sidecar/runtime/effect";
import { APP_SETTING_ID, APP_SETTING_SCHEMA } from "@sidecar/settings";
import type { ObservedAccountCalendars } from "@sidecar/settings/wire";
import { ACTION_RESULT_STATUS, isWireBoolean, isWireString } from "@sidecar/wire";
import { Duration, Effect, Fiber, Queue, Result, Schedule, Scope, Semaphore } from "effect";
import type * as FileSystem from "effect/FileSystem";
import type * as Path from "effect/Path";
import {
  APPLE_CALENDAR_ACCESS_REFUSAL,
  type AppleCalendarHelperRun,
  AppleCalendarReader,
} from "./apple-calendar.js";
import { calendarOnboardingOwed } from "./calendar-onboarding-flow.js";
import type { SettingsComposer } from "./compose-settings.js";
import type { Composer } from "./composer.js";
import { conductorKeyOnboardingOwed } from "./conductor-key-onboarding-flow.js";
import { quietUntilFrom } from "./device-presence.js";
import { HostKernelTag, lateService } from "./effect/kernel.js";
import { introductionOwed } from "./introduction-flow.js";
import { HOST_NODE_CAPABILITY } from "./node-capabilities.js";
import { type OnboardingState, onboardingStateRecord } from "./onboarding-state.js";
import { reporterOf } from "./wire-helpers.js";

/** A diary changes at the pace of hands too; five minutes is current. */
const CALENDAR_REFRESH_INTERVAL_MS = 5 * 60_000;
/**
 * How often the announcement hold the panel draws is read again against the
 * meetings already in memory, so asking often costs nothing. The boundary
 * timer is what answers on time — this tick is the net behind it, for the
 * clocks a timer cannot promise to keep: a laptop asleep through the
 * boundary, or a system clock moved by hand.
 */
const HOLD_REFRESH_INTERVAL_MS = 30_000;
/**
 * How often the System Settings switch is asked about between passes. Each
 * probe is a fresh helper process on purpose: EventKit answers a running
 * process's authorization from state it read at launch, so only a fresh
 * process can be trusted about where the switch stands now. Ten seconds is
 * the longest consent taken back keeps holding anything.
 */
const APPLE_ACCESS_POLL_INTERVAL_MS = 10_000;

export interface CalendarsComposer extends Composer {
  /** The loop the merge's supervisor enables; the composer never enables it itself. */
  readonly loop: ObservationLoop;
  observedCalendars: () => readonly ObservedAccountCalendars[];
  announcementsQuietNow: (at: number) => Effect.Effect<boolean>;
  /** Reads the hold again and tells the panel where it moved; the settings composer yields this where the pause is toggled. */
  readonly refreshAnnouncementHold: Effect.Effect<void>;
  /**
   * When the meeting hold standing at `at` ends; `null` once the calendars
   * have been observed and none stands; `undefined` before the first
   * observation has resolved, when whether a hold stands is not yet known.
   * It is the fact the device row reports and nothing decided from it; the
   * pause and the introduction, which have no end of their own, are the
   * devices composer's to fold in beside it.
   */
  meetingQuietUntil: (at: number) => Effect.Effect<number | null | undefined>;
  /** The one back-edge: the devices composer is built after this one and is what the introduction's move must reach. */
  link: (links: CalendarsLinks) => Effect.Effect<void>;
  /** Whether the calendar step of onboarding still stands over the panel. */
  gateOwed: () => boolean;
  gateOfferable: () => Effect.Effect<boolean>;
  /** Whether the spoken introduction is owed to the signed-in developer, as the onboarding record has it. */
  introductionOwed: () => boolean;
  /** Whether the Conductor key step of onboarding stands, as the record has it. */
  keyGateOwed: () => boolean;
  /** The vault holds a Conductor key: the key step is answered, if it stood. */
  readonly settleKeyGate: Effect.Effect<void>;
  /** The onboarding record as it stands, for the beats that read their own moments out of it. */
  onboarding: () => OnboardingState | undefined;
  /**
   * One moment recorded over the record. The callers are synchronous
   * statements — the live service's own callbacks — so the moment stands in
   * the record this run reads on the statement that asked for it, and the
   * disk and the events it earns are offered to this composer's writer fiber,
   * as with the first sign-in below.
   */
  writeOnboarding: (moment: OnboardingState) => void;
  /** The calendar step goes up at the first sign-in ever observed, before the account event. */
  recordFirstSignIn: () => void;
  /** Arms the three observation-driven timers; the account gate's own edges are what run these two. */
  readonly armObservation: Effect.Effect<void>;
  readonly disarmObservation: Effect.Effect<void>;
}

interface CalendarsDependencies {
  settings: SettingsComposer;
  observationGate: () => boolean;
  /**
   * Told after every onboarding write, once the record this run reads holds
   * the moment: the live composer re-decides the onboarding beats on it, since
   * the introduction's completion, the key gate, and the calendar step each
   * change which beat is owed. Composed after this composer, so it is handed
   * in as a hand rather than a link.
   */
  onOnboardingWritten?: () => void;
  /**
   * Told each time the announcement hold is read again for the panel: the
   * live composer asks for a beat the hold was keeping when it finds the hold
   * lifted, since a beat is not asked of the service while a meeting or the
   * pause holds speech.
   */
  onAnnouncementHoldRead?: () => void;
}

/** What the calendars concern reaches in a concern built after it. */
interface CalendarsLinks {
  /** The device heartbeat sent now, carrying the introduction hold as it stands after the record moved. */
  readonly reportPresence: Effect.Effect<void>;
}

/**
 * The calendars concern, over the kernel it takes as a tag: the announcement
 * hold its observation finalizer owes is detached from the fiber the
 * finalizer runs on and begun on that same stack, so the disarm never waits
 * on it, and the three observation-driven timers fork their fibers into the
 * `Scope` the account gate's own arming runs in, exactly as the device
 * registration does one level down. The onboarding record is read and
 * written through `FileSystem`, which this composition provides.
 */
export const composeCalendars = /* @__PURE__ */ Effect.fn("composeCalendars")(function* (
  dependencies: CalendarsDependencies,
): Effect.fn.Return<
  CalendarsComposer,
  never,
  HostKernelTag | FileSystem.FileSystem | Path.Path | Scope.Scope
> {
  const { settings, observationGate, onOnboardingWritten, onAnnouncementHoldRead } = dependencies;
  const kernel = yield* HostKernelTag;
  const { runMode, report, now } = kernel;
  const settingsStore = settings.store;
  const fileSystemContext = yield* Effect.context<FileSystem.FileSystem | Path.Path>();

  const googleCalendar = new GoogleCalendarReader({
    readAccounts: () => Effect.orDie(settingsStore.readCalendarAccounts()),
  });
  const googleCalendarConsent = googleCalendarSignIn({
    openExternal: (url) => void kernel.openExternalThroughNode(url).catch(kernel.reportOpenFailure),
  });
  /**
   * The EventKit helper runs on the desktop, where the device is: each
   * invocation the reader composes — a command fixed by the build, the
   * window's instants, the chosen calendar ids — crosses to the native node
   * and its stdout comes back. No node connected is a failed read, which
   * the reader answers by standing what it last showed, never by emptying
   * a calendar on the strength of an absent desktop.
   */
  const runAppleCalendarHelper: AppleCalendarHelperRun = (helperArguments, timeoutMs) =>
    Effect.flatMap(
      kernel.nodes.invoke(HOST_NODE_CAPABILITY.APPLE_CALENDAR_HELPER, {
        arguments: [...helperArguments],
        timeoutMs,
      }),
      (result) => {
        if (result.status !== NODE_CAPABILITY_STATUS.OK) {
          return Effect.fail(new Error(result.reason));
        }
        return isWireString(result.value)
          ? Effect.succeed(result.value)
          : Effect.fail(new Error("the helper answered no text"));
      },
    );
  const appleCalendar = new AppleCalendarReader({
    readConnection: () => Effect.orDie(settingsStore.readAppleCalendarConnection()),
    runHelper: runAppleCalendarHelper,
  });

  /** The observed meetings; `undefined` until the first observation of this run has resolved. */
  let calendarMeetings: readonly MeetingInterval[] | undefined;
  let observedCalendars: readonly ObservedAccountCalendars[] = [];
  let appleAccessProbeFailing = false;
  let announcementsHeld = false;
  let appleConnectGeneration = 0;

  /**
   * Every fiber the three observation-driven timers below fork lives in the
   * scope the arming runs in; the scope closing is what ends all three, so
   * no handle of any of them is kept only to be handed back.
   */
  let observationScope: Scope.Scope | undefined;
  /** The one pending meeting-boundary wake, interrupted and replaced on every re-arm. */
  let boundaryFiber: Fiber.Fiber<void, never> | undefined;

  const onboarding = onboardingStateRecord(kernel.stateRoot, report, fileSystemContext);
  /**
   * What a synchronous edge asked the record to record and nothing waits
   * on — a beat that was spoken, the first sign-in ever observed — taken in
   * turn by a fiber of this composer's scope, in the order it was offered.
   * A write that dies is written down rather than left to end the fiber
   * every later write needs.
   */
  const onboardingWrites = yield* Queue.unbounded<Effect.Effect<void>>();
  /**
   * A write is uninterruptible, because a moment that reached this queue is
   * one the record has to end up holding: a quit landing between the read
   * and the write would leave the disk saying the edge never happened.
   */
  const takeOnboardingWrite = (write: Effect.Effect<void>): Effect.Effect<void> =>
    Effect.catchDefect(Effect.uninterruptible(write), (defect) =>
      Effect.logError("an onboarding write failed", defect),
    );
  /**
   * Registered before the fiber below is forked, so the scope closing runs
   * it after that fiber has been interrupted: what was offered and not yet
   * taken is written here rather than lost with the queue. `Queue.clear` is
   * what reads a queue that may be empty — `Queue.takeAll` waits for the
   * first message rather than answering with nothing, and a finalizer is
   * uninterruptible, so a close behind an empty queue would never end.
   */
  yield* Effect.addFinalizer(() =>
    Effect.flatMap(Queue.clear(onboardingWrites), (pending) =>
      Effect.forEach(pending, takeOnboardingWrite, { discard: true }),
    ),
  );
  yield* Effect.forkScoped(
    Effect.forever(Effect.flatMap(Queue.take(onboardingWrites), takeOnboardingWrite)),
  );
  const offerOnboardingWrite = (write: Effect.Effect<void>): void => {
    Queue.offerUnsafe(onboardingWrites, write);
  };
  /**
   * One writer at a time over the record, which the synchronous face this
   * replaced had for free: every write merges its own moment over what disk
   * holds at that instant, so two that overlapped would each save over a
   * record read before the other's moment landed.
   */
  const writeGate = yield* Semaphore.make(1);
  const late = yield* lateService<CalendarsLinks>();
  let onboardingState: OnboardingState | undefined;
  let announcedCalendarGateOwed: boolean | undefined;
  let announcedIntroductionOwed: boolean | undefined;
  let announcedKeyGateOwed: boolean | undefined;

  function calendarOnboardingGateOwed(): boolean {
    return runMode.requiresAccount && calendarOnboardingOwed(onboardingState);
  }

  function spokenIntroductionOwed(): boolean {
    return runMode.requiresAccount && introductionOwed(onboardingState);
  }

  function conductorKeyGateOwed(): boolean {
    return runMode.requiresAccount && conductorKeyOnboardingOwed(onboardingState);
  }

  /**
   * The one onboarding write, taking the moment it records and merging it over
   * the record as it stands on disk. Every moment lives in one record, so
   * each write reconciles every beat and the introduction; each event stays
   * fenced on a changed answer, so writing an arrival moment cannot tell the
   * client about a gate or an introduction that did not move.
   */
  const writeOnboardingState = (moment: OnboardingState): Effect.Effect<void> =>
    writeGate.withPermits(1)(
      Effect.gen(function* () {
        const persisted = yield* onboarding.update((current) => ({ ...current, ...moment }));
        // What another process recorded, under what this run has: a moment
        // offered while this write was out stands in memory already and is
        // not on the disk the merge above read from.
        onboardingState = { ...persisted, ...onboardingState, ...moment };
        onOnboardingWritten?.();
        const owed = calendarOnboardingGateOwed();
        const introduction = spokenIntroductionOwed();
        if (introduction !== announcedIntroductionOwed) {
          announcedIntroductionOwed = introduction;
          kernel.emit(GATEWAY_EVENT.INTRODUCTION_CHANGED, { owed: introduction });
          // The introduction owed is a hold the panel draws: read again
          // here so the face it holds asleep wakes on the completion. It is
          // also a hold the device heartbeat carries, so the service hears
          // the completion now rather than at the next scheduled beat.
          yield* refreshAnnouncementHold;
          yield* Effect.flatMap(late.value, (links) => links.reportPresence);
        }
        const keyGate = conductorKeyGateOwed();
        if (keyGate !== announcedKeyGateOwed) {
          announcedKeyGateOwed = keyGate;
          kernel.emit(GATEWAY_EVENT.CONDUCTOR_KEY_ONBOARDING_CHANGED, { owed: keyGate });
        }
        if (owed === announcedCalendarGateOwed) return;
        announcedCalendarGateOwed = owed;
        kernel.emit(GATEWAY_EVENT.CALENDAR_ONBOARDING_CHANGED, { owed });
      }),
    );

  /**
   * The record as this run holds it, merged on the caller's own statement so
   * that every synchronous reader beside it — the arrival beat's guard, the
   * first announcement's count, the gate the account event is raised before —
   * decides on the moment just recorded. What the writer fiber adds after is
   * the disk and the events the change earns.
   */
  const recordMoment = (moment: OnboardingState): void => {
    onboardingState = { ...onboardingState, ...moment };
    offerOnboardingWrite(writeOnboardingState(moment));
  };

  /**
   * The settled key gate: the settings composer's link yields this where it
   * stores a key, so a key stored twice reads the gate twice and settles it
   * once.
   */
  const settleKeyGate: Effect.Effect<void> = Effect.gen(function* () {
    if (!conductorKeyOnboardingOwed(onboardingState)) return;
    yield* writeOnboardingState({
      conductorKeyOnboardingSettledAt: new Date(now()).toISOString(),
    });
  });

  const settleCalendarOnboardingIfConnected = /* @__PURE__ */ Effect.fnUntraced(
    function* (): Effect.fn.Return<void> {
      if (!calendarOnboardingOwed(onboardingState)) return;
      const connected = yield* Effect.orDie(settingsStore.calendarConnectionStored());
      if (!connected || !calendarOnboardingOwed(onboardingState)) return;
      yield* writeOnboardingState({
        calendarOnboardingSettledAt: new Date(now()).toISOString(),
      });
    },
  );

  const calendarGateOfferable = /* @__PURE__ */ Effect.fnUntraced(
    function* (): Effect.fn.Return<boolean> {
      if (!calendarOnboardingGateOwed()) return false;
      const snapshot = yield* Effect.orDie(settingsStore.snapshot());
      if (!calendarOnboardingGateOwed()) return false;
      return snapshot.status.appleCalendarAvailable || snapshot.status.calendarSignInAvailable;
    },
  );

  const announcementsQuietNow = /* @__PURE__ */ Effect.fnUntraced(function* (
    at: number,
  ): Effect.fn.Return<boolean> {
    const paused = !(yield* Effect.orDie(
      settingsStore.get(APP_SETTING_SCHEMA.announceSessions.field),
    ));
    const inMeeting =
      !paused &&
      calendarMeetings !== undefined &&
      activeMeetingEnd(calendarMeetings, at) !== undefined;
    // The introduction owed is a hold of its own: nothing else of Luke's
    // speaks over the greeting, and what was held is re-decided once the
    // completion takes the hold down, like a meeting's end.
    const holding =
      paused ||
      spokenIntroductionOwed() ||
      (inMeeting &&
        (yield* Effect.orDie(settingsStore.get(APP_SETTING_SCHEMA.quietDuringMeetings.field))));
    if (holding !== announcementsHeld) {
      announcementsHeld = holding;
      kernel.emit(GATEWAY_EVENT.ANNOUNCEMENTS_HELD_CHANGED, { held: holding });
    }
    return holding;
  });

  const meetingQuietUntil = (at: number): Effect.Effect<number | null | undefined> =>
    Effect.map(
      Effect.orDie(settingsStore.get(APP_SETTING_SCHEMA.quietDuringMeetings.field)),
      (quietDuringMeetings) => quietUntilFrom(calendarMeetings, quietDuringMeetings, at),
    );

  /**
   * The hold read again for the panel's sake: `announcementsQuietNow` is
   * what tells the panel where the hold moved, and since E5-3 nothing on
   * this side queues speech to hold, so this read is the whole of what the
   * pass, the boundary wake, the tick, the pause, and the introduction's
   * completion still owe.
   */
  const refreshAnnouncementHold: Effect.Effect<void> = Effect.suspend(() =>
    Effect.andThen(
      announcementsQuietNow(now()),
      Effect.sync(() => onAnnouncementHoldRead?.()),
    ),
  );

  /**
   * The meeting-boundary wake is a one-shot fiber rather than a fixed
   * `Schedule`, because its delay is recomputed from the meetings every
   * observation pass just read: the fiber still standing from the last
   * arming is interrupted first, and a fresh one is forked into the
   * observation scope only where one still stands and a next boundary
   * exists.
   */
  const armQuietBoundaryTimer: Effect.Effect<void> = Effect.gen(function* () {
    if (boundaryFiber !== undefined) {
      const fiber = boundaryFiber;
      boundaryFiber = undefined;
      // Dropped rather than waited for, the way cancelling a timer never
      // waited: what an interruption has to guarantee is that the wake does
      // not fire, never that its fiber has already ended.
      yield* Effect.forkDetach(Fiber.interrupt(fiber));
    }
    if (!calendarMeetings || observationScope === undefined) return;
    const at = now();
    const boundary = nextMeetingBoundary(calendarMeetings, at);
    if (boundary === undefined) return;
    boundaryFiber = yield* Effect.provideService(
      Effect.forkScoped(
        Effect.sleep(Duration.millis(boundary - at + 1)).pipe(
          Effect.andThen(
            Effect.gen(function* () {
              boundaryFiber = undefined;
              yield* refreshAnnouncementHold;
              yield* armQuietBoundaryTimer;
            }),
          ),
        ),
      ),
      Scope.Scope,
      observationScope,
    );
  });

  const refreshCalendarMeetings = /* @__PURE__ */ Effect.fnUntraced(function* (
    generation: number,
  ): Effect.fn.Return<void> {
    const [observations, appleObservation] = yield* Effect.all(
      [googleCalendar.observe(), appleCalendar.observe()],
      { concurrency: "unbounded" },
    );
    if (!loop.isCurrent(generation)) return;
    const accounts = [...(observations ?? []), ...(appleObservation ? [appleObservation] : [])];
    // Both readers answer nothing for a calendar that is not connected, so
    // a machine with none observed holds no meetings; only a run whose
    // first observation has not resolved yet holds nothing at all.
    calendarMeetings = accounts.flatMap((held) => [...held.meetings]);
    observedCalendars = accounts.map(({ accountId, calendars, failure, revoked }) => ({
      accountId,
      calendars,
      ...(failure ? { failure } : undefined),
      ...(revoked ? { revoked } : undefined),
    }));
    kernel.emit(GATEWAY_EVENT.CALENDARS_CHANGED, { calendars: carried(observedCalendars) });
    for (const held of accounts) {
      if (held.failure) report(`Calendar observation failed: ${held.failure}`);
    }
    if (!loop.isCurrent(generation)) return;
    yield* refreshAnnouncementHold;
    yield* armQuietBoundaryTimer;
  });

  const loop = new ObservationLoop({
    gate: observationGate,
    intervalMs: CALENDAR_REFRESH_INTERVAL_MS,
    run: refreshCalendarMeetings,
  });

  /**
   * The pass a calendar write earns, started and never waited for: the
   * write's own answer must not sit behind two providers' reads. A daemon
   * because the fiber outlives the request that asked for it, exactly as
   * the detached promise it replaces did.
   */
  const pokeRefresh = Effect.asVoid(Effect.forkDetach(loop.refresh));

  const pollAppleCalendarAccess = /* @__PURE__ */ Effect.fnUntraced(
    function* (): Effect.fn.Return<void> {
      if (!(yield* Effect.orDie(settingsStore.readAppleCalendarConnection()))) return;
      // The probe's own failure is read out of the failure channel rather
      // than caught around the yield: a rejection lifted into a fiber is a
      // defect no `try` here would see, and one failed probe must not end
      // the poll the schedule is repeating.
      const probed = yield* Effect.result(appleCalendar.status());
      const access = Result.getOrUndefined(probed);
      if (Result.isFailure(probed) && !appleAccessProbeFailing) {
        const error = probed.failure;
        report(
          `Calendar access probe failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      appleAccessProbeFailing = access === undefined;
      if (access === undefined) return;
      const drawnRevoked =
        observedCalendars.find((held) => held.accountId === APPLE_CALENDAR_ID)?.revoked === true;
      const probeRevoked = access !== APPLE_CALENDAR_ACCESS.FULL;
      if (probeRevoked !== drawnRevoked) {
        report(`Calendar access now reads ${access}; running a pass.`);
        yield* loop.refresh;
      }
    },
  );

  /**
   * The two remaining timers are fixed-interval `Schedule`s forked into the
   * one scope an arming runs in: `Effect.schedule`, not `Effect.repeat`,
   * because a `setInterval` never fires at once either, and a repeat would.
   * What the gate's release gives back is registered first, so it runs after
   * the fibers it belongs beside have been interrupted.
   */
  const observationArmed = Effect.gen(function* () {
    const scope = yield* Effect.scope;
    observationScope = scope;
    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        observationScope = undefined;
        boundaryFiber = undefined;
        appleAccessProbeFailing = false;
        calendarMeetings = undefined;
        observedCalendars = [];
        googleCalendar.forget();
        appleCalendar.forget();
        kernel.emit(GATEWAY_EVENT.CALENDARS_CHANGED, { calendars: [] });
        yield* Effect.forkDetach(refreshAnnouncementHold, { startImmediately: true });
      }),
    );
    yield* Effect.forkScoped(
      Effect.schedule(
        refreshAnnouncementHold,
        Schedule.spaced(Duration.millis(HOLD_REFRESH_INTERVAL_MS)),
      ),
    );
    if (process.platform === "darwin" && runMode.observesProviders) {
      yield* Effect.forkScoped(
        Effect.schedule(
          pollAppleCalendarAccess(),
          Schedule.spaced(Duration.millis(APPLE_ACCESS_POLL_INTERVAL_MS)),
        ),
      );
    }
  });

  const observation = yield* cadenceGate(observationArmed);

  const methods: GatewayMethodTable = {
    [GATEWAY_METHOD.CALENDAR_CONNECT_GOOGLE]: (params) =>
      Effect.map(
        settings.settingsWrite(
          () =>
            Effect.gen(function* () {
              const outcome = yield* Effect.scoped(googleCalendarConsent.signInEffect());
              if ("reason" in outcome) return yield* settings.refusedSettings(outcome.reason);
              const calendars = yield* Effect.orElseSucceed(
                googleCalendar.listCalendars(outcome.accessToken),
                () => [],
              );
              const primaryId = (calendars.find((candidate) => candidate.primary) ?? calendars[0])
                ?.id;
              if (!primaryId) {
                return yield* settings.refusedSettings(
                  "Google did not answer with the account's calendars.",
                );
              }
              return yield* settingsStore.addCalendarAccount(primaryId, outcome.refreshToken, [
                primaryId,
              ]);
            }),
          (saved) =>
            Effect.gen(function* () {
              if (saved.reason) return;
              yield* pokeRefresh;
              settings.recordProductEvent(PRODUCT_EVENT.CALENDAR_CONNECT, {
                calendar_source: PRODUCT_CALENDAR_SOURCE.GOOGLE,
              });
            }),
          "Could not connect Google Calendar on this system.",
          reporterOf(params),
        ),
        (result) => carried(result),
      ),
    [GATEWAY_METHOD.CALENDAR_CANCEL_GOOGLE_SIGN_IN]: () =>
      Effect.sync(() => {
        googleCalendarConsent.cancel();
        return {};
      }),
    [GATEWAY_METHOD.CALENDAR_REOPEN_GOOGLE_SIGN_IN]: () =>
      Effect.sync(() => {
        googleCalendarConsent.reopen();
        return {};
      }),
    [GATEWAY_METHOD.CALENDAR_REMOVE_ACCOUNT]: (params) => {
      const accountId = params.accountId;
      if (!isWireString(accountId)) return invalid("accountId must be a string");
      return Effect.map(
        settings.settingsWrite(
          () => settingsStore.removeCalendarAccount(accountId),
          (saved) =>
            Effect.gen(function* () {
              if (saved.reason) return;
              yield* pokeRefresh;
              settings.recordProductEvent(PRODUCT_EVENT.CALENDAR_DISCONNECT, {
                calendar_source: PRODUCT_CALENDAR_SOURCE.GOOGLE,
              });
            }),
          "Could not disconnect that account on this system.",
          reporterOf(params),
        ),
        (result) => carried(result),
      );
    },
    [GATEWAY_METHOD.CALENDAR_CONNECT_APPLE]: (params) =>
      Effect.suspend(() => {
        const generation = ++appleConnectGeneration;
        let stored = false;
        return Effect.map(
          settings.settingsWrite(
            () =>
              Effect.gen(function* () {
                // The system's own consent is the whole connect flow, raised by the
                // helper on the desktop at this press and nowhere else.
                const outcome = yield* appleCalendar.obtainAccess({
                  openSystemSettings: () =>
                    void kernel
                      .openExternalThroughNode(CALENDAR_PRIVACY_PANE_URL)
                      .catch(kernel.reportOpenFailure),
                  superseded: () => appleConnectGeneration !== generation,
                });
                if (appleConnectGeneration !== generation) {
                  return {
                    status: ACTION_RESULT_STATUS.ACCEPTED,
                    settings: yield* settingsStore.snapshot(),
                  };
                }
                if (outcome.access !== APPLE_CALENDAR_ACCESS.FULL) {
                  return yield* settings.refusedSettings(
                    outcome.failure ?? APPLE_CALENDAR_ACCESS_REFUSAL[outcome.access],
                  );
                }
                const seed = outcome.defaultCalendarId ?? outcome.calendars[0]?.id;
                stored = true;
                return yield* settingsStore.connectAppleCalendar(seed ? [seed] : []);
              }),
            (saved) =>
              Effect.gen(function* () {
                if (saved.reason) return;
                yield* pokeRefresh;
                if (stored) {
                  settings.recordProductEvent(PRODUCT_EVENT.CALENDAR_CONNECT, {
                    calendar_source: PRODUCT_CALENDAR_SOURCE.APPLE,
                  });
                }
              }),
            "Could not connect Apple Calendar on this system.",
            reporterOf(params),
          ),
          (result) => carried(result),
        );
      }),
    [GATEWAY_METHOD.CALENDAR_DISCONNECT_APPLE]: (params) =>
      Effect.map(
        settings.settingsWrite(
          () => settingsStore.disconnectAppleCalendar(),
          (saved) =>
            Effect.gen(function* () {
              if (saved.reason) return;
              yield* pokeRefresh;
              settings.recordProductEvent(PRODUCT_EVENT.CALENDAR_DISCONNECT, {
                calendar_source: PRODUCT_CALENDAR_SOURCE.APPLE,
              });
            }),
          "Could not disconnect Apple Calendar on this system.",
          reporterOf(params),
        ),
        (result) => carried(result),
      ),
    [GATEWAY_METHOD.CALENDAR_APPLE_ACCESS_STATUS]: () =>
      Effect.match(appleCalendar.status(), {
        onFailure: () => ({ access: APPLE_CALENDAR_ACCESS.NOT_DETERMINED }),
        onSuccess: (access) => ({ access }),
      }),
    [GATEWAY_METHOD.CALENDAR_CANCEL_APPLE_CONNECT]: () =>
      Effect.sync(() => {
        appleConnectGeneration += 1;
        return {};
      }),
    [GATEWAY_METHOD.CALENDAR_REFRESH]: () => Effect.as(loop.refresh, {}),
    [GATEWAY_METHOD.CALENDAR_SET_SELECTED]: (params) =>
      Effect.gen(function* () {
        const { accountId, calendarId, selected } = params;
        if (!isWireString(accountId) || !isWireString(calendarId)) {
          return yield* invalid("accountId and calendarId must be strings");
        }
        if (!isWireBoolean(selected)) return yield* invalid("selected must be a boolean");
        if (
          selected &&
          !observedCalendars
            .find((held) => held.accountId === accountId)
            ?.calendars.some((candidate) => candidate.id === calendarId)
        ) {
          return carried(
            yield* settings.refusedSettings(
              "That calendar is not one the account's latest list offered.",
            ),
          );
        }
        const result = yield* settings.settingsWrite(
          () => settingsStore.setCalendarSelected(accountId, calendarId, selected),
          (saved) =>
            Effect.gen(function* () {
              if (saved.reason) return;
              yield* pokeRefresh;
              settings.recordProductEvent(PRODUCT_EVENT.SETTING_UPDATE, {
                setting_id: APP_SETTING_ID.CALENDAR_SELECTED,
                setting_value: selected ? PRODUCT_SETTING_VALUE.ON : PRODUCT_SETTING_VALUE.OFF,
              });
            }),
          "Could not save that calendar choice on this system.",
          reporterOf(params),
        );
        return carried(result);
      }),
    [GATEWAY_METHOD.ONBOARDING_STATE]: () =>
      Effect.sync(() => ({
        calendarOnboardingOwed: calendarOnboardingGateOwed(),
        introductionOwed: spokenIntroductionOwed(),
        conductorKeyOnboardingOwed: conductorKeyGateOwed(),
      })),
    [GATEWAY_METHOD.ONBOARDING_SKIP_CONDUCTOR_KEY]: () =>
      Effect.gen(function* () {
        if (conductorKeyOnboardingOwed(onboardingState)) {
          yield* writeOnboardingState({
            conductorKeyOnboardingSkippedAt: new Date(now()).toISOString(),
          });
        }
        return {};
      }),
    // The completion is the host's write, so the record has one writer and
    // the client learns of it from the same event.
    [GATEWAY_METHOD.ONBOARDING_COMPLETE_INTRODUCTION]: () =>
      Effect.gen(function* () {
        if (introductionOwed(onboardingState)) {
          yield* writeOnboardingState({
            introductionCompletedAt: new Date(now()).toISOString(),
          });
        }
        return {};
      }),
    [GATEWAY_METHOD.ONBOARDING_SKIP_CALENDAR]: () =>
      Effect.gen(function* () {
        if (calendarOnboardingOwed(onboardingState)) {
          yield* writeOnboardingState({
            calendarOnboardingSkippedAt: new Date(now()).toISOString(),
          });
        }
        return {};
      }),
    [GATEWAY_METHOD.ONBOARDING_COMPLETE_CALENDAR]: () =>
      Effect.gen(function* () {
        if (calendarOnboardingOwed(onboardingState)) {
          yield* writeOnboardingState({
            calendarOnboardingSettledAt: new Date(now()).toISOString(),
          });
        }
        return {};
      }),
  };

  return {
    methods,
    loop,
    observedCalendars: () => observedCalendars,
    announcementsQuietNow,
    refreshAnnouncementHold,
    meetingQuietUntil,
    link: (links) => Effect.asVoid(late.set(links)),
    gateOwed: calendarOnboardingGateOwed,
    gateOfferable: calendarGateOfferable,
    introductionOwed: spokenIntroductionOwed,
    keyGateOwed: conductorKeyGateOwed,
    settleKeyGate,
    onboarding: () => onboardingState,
    writeOnboarding: recordMoment,
    recordFirstSignIn: () => {
      // The first sign-in ever observed is where the spoken introduction,
      // the Conductor key step, and the calendar step of onboarding go up,
      // in that order: recorded on disk rather than derived, so quitting at
      // any and relaunching finds it standing, and an install signed in
      // before this edge was recorded has none to record. The three stand
      // on this statement, before the account event the caller publishes
      // next; the disk and the settle follow on the writer's own fiber.
      if (onboardingState?.calendarOnboardingRequiredAt !== undefined) return;
      const at = new Date(now()).toISOString();
      recordMoment({
        introductionRequiredAt: at,
        conductorKeyOnboardingRequiredAt: at,
        calendarOnboardingRequiredAt: at,
      });
      offerOnboardingWrite(settleCalendarOnboardingIfConnected());
    },
    armObservation: observation.arm,
    disarmObservation: observation.disarm,
    // The gate's own disarm is what ends the observation; the scope this
    // composer was built in ends whatever a disarm missed, so this lifetime
    // is its start alone.
    lifetime: Effect.gen(function* () {
      const stored = yield* onboarding.read;
      // Under what this run has already recorded, never over it: the account
      // composer starts ahead of this one and its first sign-in ever observed
      // can raise the three gates while this read is still out.
      if (stored !== undefined) onboardingState = { ...stored, ...onboardingState };
      offerOnboardingWrite(settleCalendarOnboardingIfConnected());
    }),
  };
});
