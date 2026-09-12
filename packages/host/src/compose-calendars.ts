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
import { PROACTIVE_SPEECH_KIND } from "@sidecar/live";
import { ObservationLoop } from "@sidecar/runtime";
import {
  cadenceHome,
  closeCadenceScope,
  forkIntoCadence,
  openCadenceScope,
} from "@sidecar/runtime/effect";
import { APP_SETTING_ID, APP_SETTING_SCHEMA } from "@sidecar/settings";
import type { ObservedAccountCalendars } from "@sidecar/settings/wire";
import type { BeatKind } from "@sidecar/voice/live-session";
import { ACTION_RESULT_STATUS, isWireBoolean, isWireString } from "@sidecar/wire";
import { Duration, Effect, Fiber, Option, Runtime, Schedule, type Scope } from "effect";
import {
  APPLE_CALENDAR_ACCESS_REFUSAL,
  type AppleCalendarHelperRun,
  AppleCalendarReader,
} from "./apple-calendar.js";
import { calendarOnboardingOwed } from "./calendar-onboarding-flow.js";
import type { SettingsComposer } from "./compose-settings.js";
import type { Composer } from "./composer.js";
import { quietUntilFrom } from "./device-presence.js";
import { HostKernelTag, lateService } from "./effect/kernel.js";
import { HOST_NODE_CAPABILITY } from "./node-capabilities.js";
import { type OnboardingState, onboardingStateFile } from "./onboarding-state.js";
import { reporterOf } from "./wire-helpers.js";

/** A diary changes at the pace of hands too; five minutes is current. */
const CALENDAR_REFRESH_INTERVAL_MS = 5 * 60_000;
/**
 * How often held notices ask whether the meeting holding them has ended. The
 * question is answered from meetings already in memory, so asking often costs
 * nothing. The boundary timer is what answers on time — this tick is the net
 * behind it, for the clocks a timer cannot promise to keep: a laptop asleep
 * through the boundary, or a system clock moved by hand.
 */
const HELD_NOTICE_RELEASE_INTERVAL_MS = 30_000;
/**
 * How often the System Settings switch is asked about between passes. Each
 * probe is a fresh helper process on purpose: EventKit answers a running
 * process's authorization from state it read at launch, so only a fresh
 * process can be trusted about where the switch stands now. Ten seconds is
 * the longest consent taken back keeps holding anything.
 */
const APPLE_ACCESS_POLL_INTERVAL_MS = 10_000;

/** What the calendars reach in the speech the meetings hold. */
interface CalendarsLinks {
  reconcileSpeech: () => void;
  withdrawBeat: (kind: BeatKind) => void;
  /** The live service's held briefings go with the meetings that were holding them. */
  dropBriefings: () => void;
  /** The gate settling is where the beat that was waiting for it may speak. */
  requestOnboardingBeat: () => void;
}

export interface CalendarsComposer extends Composer {
  /** The loop the merge's supervisor enables; the composer never enables it itself. */
  readonly loop: ObservationLoop;
  observedCalendars: () => readonly ObservedAccountCalendars[];
  announcementsQuietNow: (at: number) => Promise<boolean>;
  /**
   * When the meeting hold standing at `at` ends; `null` once the calendars
   * have been observed and none stands; `undefined` before the first
   * observation has resolved, when whether a hold stands is not yet known.
   * It is the fact the device row reports and nothing decided from it; the
   * manual pause has no end and is no instant.
   */
  meetingQuietUntil: (at: number) => Promise<number | null | undefined>;
  /** Whether the calendar step of onboarding still stands over the panel. */
  gateOwed: () => boolean;
  gateOfferable: () => Promise<boolean>;
  /** The onboarding record as it stands, for the beats that read their own moments out of it. */
  onboarding: () => OnboardingState | undefined;
  writeOnboarding: (moment: OnboardingState) => void;
  /** The calendar step goes up at the first sign-in ever observed, before the account event. */
  recordFirstSignIn: () => void;
  startObservation: () => void;
  stopObservation: () => void;
  link: (links: CalendarsLinks) => void;
}

export interface CalendarsDependencies {
  settings: SettingsComposer;
  observationGate: () => boolean;
}

/**
 * The calendars concern, over the kernel it takes as a tag and the runtime
 * the layer it is built under is running on: the reader classes below carry
 * that runtime rather than the ambient default one, and the three
 * observation-driven timers fork their fibers into a `Scope` this composer
 * makes at `startObservation` and closes at `stopObservation`, exactly as
 * `DeviceRegistration` does one level down.
 */
export const composeCalendars = (
  dependencies: CalendarsDependencies,
): Effect.Effect<CalendarsComposer, never, HostKernelTag | Scope.Scope> =>
  Effect.gen(function* () {
    const { settings, observationGate } = dependencies;
    const kernel = yield* HostKernelTag;
    const runtime = yield* Effect.runtime<never>();
    const home = yield* cadenceHome;
    const { runMode, report, now } = kernel;
    const settingsStore = settings.store;
    const late = yield* lateService<CalendarsLinks>();
    const links = (): CalendarsLinks => {
      const standing = late.unsafePeek();
      if (Option.isNone(standing)) {
        throw new Error("the calendars composer's links are read before link() has run");
      }
      return standing.value;
    };

    const googleCalendar = new GoogleCalendarReader({
      readAccounts: () => settingsStore.readCalendarAccounts(),
      runtime,
    });
    const googleCalendarConsent = googleCalendarSignIn({
      openExternal: (url) =>
        void kernel.openExternalThroughNode(url).catch(kernel.reportOpenFailure),
      runtime,
    });
    /**
     * The EventKit helper runs on the desktop, where the device is: each
     * invocation the reader composes — a command fixed by the build, the
     * window's instants, the chosen calendar ids — crosses to the native node
     * and its stdout comes back. No node connected is a failed read, which
     * the reader answers by standing what it last showed, never by emptying
     * a calendar on the strength of an absent desktop.
     */
    const runAppleCalendarHelper: AppleCalendarHelperRun = async (helperArguments, timeoutMs) => {
      const result = await kernel.nodes.invoke(HOST_NODE_CAPABILITY.APPLE_CALENDAR_HELPER, {
        arguments: [...helperArguments],
        timeoutMs,
      });
      if (result.status !== NODE_CAPABILITY_STATUS.OK) throw new Error(result.reason);
      if (!isWireString(result.value)) throw new Error("the helper answered no text");
      return result.value;
    };
    const appleCalendar = new AppleCalendarReader({
      readConnection: () => settingsStore.readAppleCalendarConnection(),
      runHelper: runAppleCalendarHelper,
      now,
    });

    /** The observed meetings; `undefined` until the first observation of this run has resolved. */
    let calendarMeetings: readonly MeetingInterval[] | undefined;
    let observedCalendars: readonly ObservedAccountCalendars[] = [];
    let appleAccessProbeFailing = false;
    let announcementsHeld = false;
    let appleConnectGeneration = 0;

    /**
     * Every fiber the three observation-driven timers below fork, made in
     * `startObservation` and closed in `stopObservation`; the scope closing is
     * what ends all three, so no handle of any of them is kept only to be
     * handed back.
     */
    let observationScope: Scope.CloseableScope | undefined;
    /** The one pending meeting-boundary wake, interrupted and replaced on every re-arm. */
    let boundaryFiber: Fiber.RuntimeFiber<void, never> | undefined;

    const onboarding = onboardingStateFile(() => kernel.stateRoot, report);
    let onboardingState: OnboardingState | undefined;
    let announcedCalendarGateOwed: boolean | undefined;

    function calendarOnboardingGateOwed(): boolean {
      return runMode.requiresAccount && calendarOnboardingOwed(onboardingState);
    }

    /**
     * The one onboarding write, taking the moment it records and merging it over
     * the record as it stands on disk — the client writes the
     * introduction's own moment into the same file. Every moment lives in one
     * record, so each write reconciles both beats; the gate event stays fenced
     * on a changed answer, so writing an arrival moment cannot tell the renderer
     * about a gate that did not move.
     */
    function writeOnboardingState(moment: OnboardingState): void {
      onboardingState = onboarding.update((current) => ({ ...current, ...moment }));
      if (moment.arrivalSpokenAt !== undefined) links().withdrawBeat(PROACTIVE_SPEECH_KIND.ARRIVAL);
      const owed = calendarOnboardingGateOwed();
      if (!owed) links().withdrawBeat(PROACTIVE_SPEECH_KIND.CALENDAR_ONBOARDING);
      if (owed === announcedCalendarGateOwed) return;
      announcedCalendarGateOwed = owed;
      kernel.emit(GATEWAY_EVENT.CALENDAR_ONBOARDING_CHANGED, { owed });
    }

    async function settleCalendarOnboardingIfConnected(): Promise<void> {
      if (!calendarOnboardingOwed(onboardingState)) return;
      const connected = await settingsStore.calendarConnectionStored();
      if (!connected || !calendarOnboardingOwed(onboardingState)) return;
      writeOnboardingState({ calendarOnboardingSettledAt: new Date(now()).toISOString() });
    }

    async function calendarGateOfferable(): Promise<boolean> {
      if (!calendarOnboardingGateOwed()) return false;
      const snapshot = await settingsStore.snapshot();
      if (!calendarOnboardingGateOwed()) return false;
      return snapshot.status.appleCalendarAvailable || snapshot.status.calendarSignInAvailable;
    }

    async function announcementsQuietNow(at: number): Promise<boolean> {
      const paused = !(await settingsStore.get(APP_SETTING_SCHEMA.announceSessions.field));
      const inMeeting =
        !paused &&
        calendarMeetings !== undefined &&
        activeMeetingEnd(calendarMeetings, at) !== undefined;
      const holding =
        paused ||
        (inMeeting && (await settingsStore.get(APP_SETTING_SCHEMA.quietDuringMeetings.field)));
      if (holding !== announcementsHeld) {
        announcementsHeld = holding;
        kernel.emit(GATEWAY_EVENT.ANNOUNCEMENTS_HELD_CHANGED, { held: holding });
      }
      return holding;
    }

    async function meetingQuietUntil(at: number): Promise<number | null | undefined> {
      return quietUntilFrom(
        calendarMeetings,
        await settingsStore.get(APP_SETTING_SCHEMA.quietDuringMeetings.field),
        at,
      );
    }

    async function refreshAnnouncementHold(): Promise<void> {
      await announcementsQuietNow(now());
    }

    /**
     * The meeting-boundary wake is a one-shot fiber rather than a fixed
     * `Schedule`, because its delay is recomputed from the meetings every
     * observation pass just read: the fiber still standing from the last
     * arming is interrupted first, and a fresh one is forked into the
     * observation scope only where one still stands and a next boundary
     * exists.
     */
    function armQuietBoundaryTimer(): void {
      if (boundaryFiber !== undefined) {
        const fiber = boundaryFiber;
        boundaryFiber = undefined;
        Runtime.runFork(runtime)(Fiber.interrupt(fiber));
      }
      if (!calendarMeetings || observationScope === undefined) return;
      const at = now();
      const boundary = nextMeetingBoundary(calendarMeetings, at);
      if (boundary === undefined) return;
      const scope = observationScope;
      boundaryFiber = forkIntoCadence(
        home,
        scope,
        Effect.forkScoped(
          Effect.sleep(Duration.millis(boundary - at + 1)).pipe(
            Effect.zipRight(
              Effect.sync(() => {
                boundaryFiber = undefined;
                links().reconcileSpeech();
                armQuietBoundaryTimer();
              }),
            ),
          ),
        ),
      );
    }

    async function refreshCalendarMeetings(generation: number): Promise<void> {
      try {
        const [observations, appleObservation] = await Promise.all([
          googleCalendar.observe(),
          appleCalendar.observe(),
        ]);
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
      } catch (error) {
        report(
          `Calendar observation failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      if (!loop.isCurrent(generation)) return;
      links().reconcileSpeech();
      armQuietBoundaryTimer();
    }

    const loop = new ObservationLoop({
      gate: observationGate,
      home,
      intervalMs: CALENDAR_REFRESH_INTERVAL_MS,
      run: refreshCalendarMeetings,
    });

    async function pollAppleCalendarAccess(): Promise<void> {
      if (!(await settingsStore.readAppleCalendarConnection())) return;
      let access: string | undefined;
      try {
        access = await appleCalendar.status();
      } catch (error) {
        if (!appleAccessProbeFailing) {
          report(
            `Calendar access probe failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      appleAccessProbeFailing = access === undefined;
      if (access === undefined) return;
      const drawnRevoked =
        observedCalendars.find((held) => held.accountId === APPLE_CALENDAR_ID)?.revoked === true;
      const probeRevoked = access !== APPLE_CALENDAR_ACCESS.FULL;
      if (probeRevoked !== drawnRevoked) {
        report(`Calendar access now reads ${access}; running a pass.`);
        void loop.refresh();
      }
    }

    /**
     * The two remaining timers are fixed-interval `Schedule`s forked into the
     * one scope this call makes: `Effect.schedule`, not `Effect.repeat`,
     * because a `setInterval` never fires at once either, and a repeat would.
     */
    function startObservation(): void {
      if (observationScope !== undefined) return;
      const scope = openCadenceScope(home);
      observationScope = scope;
      forkIntoCadence(
        home,
        scope,
        Effect.forkScoped(
          Effect.schedule(
            Effect.sync(() => links().reconcileSpeech()),
            Schedule.spaced(Duration.millis(HELD_NOTICE_RELEASE_INTERVAL_MS)),
          ),
        ),
      );
      if (process.platform === "darwin" && runMode.observesProviders) {
        forkIntoCadence(
          home,
          scope,
          Effect.forkScoped(
            Effect.schedule(
              Effect.promise(() => pollAppleCalendarAccess()),
              Schedule.spaced(Duration.millis(APPLE_ACCESS_POLL_INTERVAL_MS)),
            ),
          ),
        );
      }
    }

    function stopObservation(): void {
      const scope = observationScope;
      observationScope = undefined;
      // Closing is not awaited, for the same reason cancelling a timer never
      // was: what it has to guarantee is that no further beat starts, never
      // that the fiber has already ended.
      if (scope !== undefined) closeCadenceScope(home, scope);
      if (boundaryFiber !== undefined) {
        const fiber = boundaryFiber;
        boundaryFiber = undefined;
        Runtime.runFork(runtime)(Fiber.interrupt(fiber));
      }
      appleAccessProbeFailing = false;
      calendarMeetings = undefined;
      observedCalendars = [];
      googleCalendar.forget();
      appleCalendar.forget();
      links().dropBriefings();
      kernel.emit(GATEWAY_EVENT.CALENDARS_CHANGED, { calendars: [] });
      void refreshAnnouncementHold();
    }

    const methods: GatewayMethodTable = {
      [GATEWAY_METHOD.CALENDAR_CONNECT_GOOGLE]: (params) =>
        Effect.map(
          Effect.promise(() =>
            settings.settingsWrite(
              async () => {
                const outcome = await Runtime.runPromise(runtime)(
                  Effect.scoped(googleCalendarConsent.signInEffect()),
                );
                if ("reason" in outcome) return settings.refusedSettings(outcome.reason);
                let primaryId: string | undefined;
                try {
                  const calendars = await googleCalendar.listCalendars(outcome.accessToken);
                  primaryId = (calendars.find((candidate) => candidate.primary) ?? calendars[0])
                    ?.id;
                } catch {
                  primaryId = undefined;
                }
                if (!primaryId) {
                  return settings.refusedSettings(
                    "Google did not answer with the account's calendars.",
                  );
                }
                return settingsStore.addCalendarAccount(primaryId, outcome.refreshToken, [
                  primaryId,
                ]);
              },
              (saved) => {
                if (saved.reason) return;
                void loop.refresh();
                settings.recordProductEvent(PRODUCT_EVENT.CALENDAR_CONNECT, {
                  calendar_source: PRODUCT_CALENDAR_SOURCE.GOOGLE,
                });
              },
              "Could not connect Google Calendar on this system.",
              reporterOf(params),
            ),
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
          Effect.promise(() =>
            settings.settingsWrite(
              () => settingsStore.removeCalendarAccount(accountId),
              (saved) => {
                if (saved.reason) return;
                void loop.refresh();
                settings.recordProductEvent(PRODUCT_EVENT.CALENDAR_DISCONNECT, {
                  calendar_source: PRODUCT_CALENDAR_SOURCE.GOOGLE,
                });
              },
              "Could not disconnect that account on this system.",
              reporterOf(params),
            ),
          ),
          (result) => carried(result),
        );
      },
      [GATEWAY_METHOD.CALENDAR_CONNECT_APPLE]: (params) =>
        Effect.suspend(() => {
          const generation = ++appleConnectGeneration;
          let stored = false;
          return Effect.map(
            Effect.promise(() =>
              settings.settingsWrite(
                async () => {
                  // The system's own consent is the whole connect flow, raised by the
                  // helper on the desktop at this press and nowhere else.
                  const outcome = await appleCalendar.obtainAccess({
                    openSystemSettings: () =>
                      void kernel
                        .openExternalThroughNode(CALENDAR_PRIVACY_PANE_URL)
                        .catch(kernel.reportOpenFailure),
                    superseded: () => appleConnectGeneration !== generation,
                  });
                  if (appleConnectGeneration !== generation) {
                    return {
                      status: ACTION_RESULT_STATUS.ACCEPTED,
                      settings: await settingsStore.snapshot(),
                    };
                  }
                  if (outcome.access !== APPLE_CALENDAR_ACCESS.FULL) {
                    return settings.refusedSettings(
                      outcome.failure ?? APPLE_CALENDAR_ACCESS_REFUSAL[outcome.access],
                    );
                  }
                  const seed = outcome.defaultCalendarId ?? outcome.calendars[0]?.id;
                  stored = true;
                  return settingsStore.connectAppleCalendar(seed ? [seed] : []);
                },
                (saved) => {
                  if (saved.reason) return;
                  void loop.refresh();
                  if (stored) {
                    settings.recordProductEvent(PRODUCT_EVENT.CALENDAR_CONNECT, {
                      calendar_source: PRODUCT_CALENDAR_SOURCE.APPLE,
                    });
                  }
                },
                "Could not connect Apple Calendar on this system.",
                reporterOf(params),
              ),
            ),
            (result) => carried(result),
          );
        }),
      [GATEWAY_METHOD.CALENDAR_DISCONNECT_APPLE]: (params) =>
        Effect.map(
          Effect.promise(() =>
            settings.settingsWrite(
              () => settingsStore.disconnectAppleCalendar(),
              (saved) => {
                if (saved.reason) return;
                void loop.refresh();
                settings.recordProductEvent(PRODUCT_EVENT.CALENDAR_DISCONNECT, {
                  calendar_source: PRODUCT_CALENDAR_SOURCE.APPLE,
                });
              },
              "Could not disconnect Apple Calendar on this system.",
              reporterOf(params),
            ),
          ),
          (result) => carried(result),
        ),
      [GATEWAY_METHOD.CALENDAR_APPLE_ACCESS_STATUS]: () =>
        Effect.match(
          Effect.tryPromise(() => appleCalendar.status()),
          {
            onFailure: () => ({ access: APPLE_CALENDAR_ACCESS.NOT_DETERMINED }),
            onSuccess: (access) => ({ access }),
          },
        ),
      [GATEWAY_METHOD.CALENDAR_CANCEL_APPLE_CONNECT]: () =>
        Effect.sync(() => {
          appleConnectGeneration += 1;
          return {};
        }),
      [GATEWAY_METHOD.CALENDAR_REFRESH]: () =>
        Effect.as(
          Effect.promise(() => loop.refresh()),
          {},
        ),
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
              yield* Effect.promise(() =>
                settings.refusedSettings(
                  "That calendar is not one the account's latest list offered.",
                ),
              ),
            );
          }
          const result = yield* Effect.promise(() =>
            settings.settingsWrite(
              () => settingsStore.setCalendarSelected(accountId, calendarId, selected),
              (saved) => {
                if (saved.reason) return;
                void loop.refresh();
                settings.recordProductEvent(PRODUCT_EVENT.SETTING_UPDATE, {
                  setting_id: APP_SETTING_ID.CALENDAR_SELECTED,
                  setting_value: selected ? PRODUCT_SETTING_VALUE.ON : PRODUCT_SETTING_VALUE.OFF,
                });
              },
              "Could not save that calendar choice on this system.",
              reporterOf(params),
            ),
          );
          return carried(result);
        }),
      [GATEWAY_METHOD.ONBOARDING_STATE]: () =>
        Effect.sync(() => ({ calendarOnboardingOwed: calendarOnboardingGateOwed() })),
      [GATEWAY_METHOD.ONBOARDING_SKIP_CALENDAR]: () =>
        Effect.sync(() => {
          if (calendarOnboardingOwed(onboardingState)) {
            writeOnboardingState({ calendarOnboardingSkippedAt: new Date(now()).toISOString() });
            links().requestOnboardingBeat();
          }
          return {};
        }),
      [GATEWAY_METHOD.ONBOARDING_COMPLETE_CALENDAR]: () =>
        Effect.sync(() => {
          if (calendarOnboardingOwed(onboardingState)) {
            writeOnboardingState({ calendarOnboardingSettledAt: new Date(now()).toISOString() });
            links().requestOnboardingBeat();
          }
          return {};
        }),
    };

    return {
      methods,
      loop,
      observedCalendars: () => observedCalendars,
      announcementsQuietNow,
      meetingQuietUntil,
      gateOwed: calendarOnboardingGateOwed,
      gateOfferable: calendarGateOfferable,
      onboarding: () => onboardingState,
      writeOnboarding: writeOnboardingState,
      recordFirstSignIn: () => {
        // The first sign-in ever observed is also where the calendar step of
        // onboarding goes up: recorded on disk rather than derived, so quitting
        // at the gate and relaunching finds it standing.
        if (onboardingState?.calendarOnboardingRequiredAt !== undefined) return;
        writeOnboardingState({ calendarOnboardingRequiredAt: new Date(now()).toISOString() });
        void settleCalendarOnboardingIfConnected();
      },
      startObservation,
      stopObservation,
      link: (next) => {
        late.unsafeSet(next);
      },
      start: async () => {
        onboardingState = onboarding.read();
        void settleCalendarOnboardingIfConnected();
      },
      stop: async () => {
        stopObservation();
      },
    };
  });
