import {
  carried,
  GATEWAY_METHOD,
  type GatewayMethodTable,
  type GatewayShutdownSteps,
} from "@sidecar/gateway";
import { HostedChangesClient, HostedConversationClient } from "@sidecar/hosted";
import { observationSupervisor } from "@sidecar/runtime";
import { cadenceGate } from "@sidecar/runtime/effect";
import { normalizeObservedWorkspaceProjects } from "@sidecar/session";
import { APP_SETTING_SCHEMA } from "@sidecar/settings";
import { Effect, Layer } from "effect";
import type * as FileSystem from "effect/FileSystem";
import { composeAccount } from "./compose-account.js";
import { composeCalendars } from "./compose-calendars.js";
import { composeConversation } from "./compose-conversation.js";
import { composeDevices } from "./compose-devices.js";
import { composeLive } from "./compose-live.js";
import { composeObservation } from "./compose-observation.js";
import { composeSettings } from "./compose-settings.js";
import type { Composer, DuplicateGatewayMethod } from "./composer.js";
import { mergedMethods } from "./effect/composer.js";
import {
  type HostAssembly,
  HostAssemblyTag,
  type HostTag,
  hostDrain,
  hostStandingLayer,
} from "./effect/host.js";
import { HostKernelTag, HostService } from "./effect/kernel.js";
import {
  type AppIdentity,
  type Environment,
  type MachinePresenceReader,
  Reporter,
  RunMode,
  type SecretCipher,
  ShutdownSignal,
} from "./effect/seams.js";
import { shutdownStepsClosingLiveSession, shutdownStepsFlushingEvents } from "./lifecycle.js";
import { createGatewayService } from "./service.js";

/** The seven concerns, by the name each is built under. */
export const HOST_CONCERN = {
  SETTINGS: "settings",
  ACCOUNT: "account",
  DEVICES: "devices",
  CONVERSATION: "conversation",
  CALENDARS: "calendars",
  OBSERVATION: "observation",
  LIVE: "live",
} as const;

export type HostConcern = (typeof HOST_CONCERN)[keyof typeof HOST_CONCERN];

/**
 * The order the launch has to keep: the account is read before anything
 * gated on it, and the loops are armed only once every owner of one has
 * started. The quit is this order reversed.
 */
export const HOST_START_ORDER: readonly HostConcern[] = [
  HOST_CONCERN.SETTINGS,
  HOST_CONCERN.ACCOUNT,
  HOST_CONCERN.DEVICES,
  HOST_CONCERN.CONVERSATION,
  HOST_CONCERN.CALENDARS,
  HOST_CONCERN.OBSERVATION,
  HOST_CONCERN.LIVE,
];

/**
 * Every concern constructed, linked, and merged, with nothing yet begun: the
 * composers in the launch's order, the arming that follows the last of them,
 * and the drain. A method two concerns claim fails this build, so which
 * concern answers a method is checked before anything starts. The Gateway's
 * own layers are built in this layer's scope, so the server's fiber stands
 * for exactly as long as the assembly does.
 */
export const hostAssemblyLayer: Layer.Layer<
  HostAssemblyTag,
  DuplicateGatewayMethod,
  | HostKernelTag
  | HostService
  | RunMode
  | Reporter
  | Environment
  | SecretCipher
  | AppIdentity
  | MachinePresenceReader
  | ShutdownSignal
  | FileSystem.FileSystem
> = Layer.effect(
  HostAssemblyTag,
  Effect.gen(function* () {
    const kernel = yield* HostKernelTag;
    const hostService = yield* HostService;
    const shutdownSignal = yield* ShutdownSignal;
    const runMode = yield* RunMode;
    const { report } = yield* Reporter;
    const { now } = kernel;

    const settings = yield* composeSettings();
    const account = yield* composeAccount({ settings });
    const observationGate = () => runMode.observesProviders && account.capabilitiesActive();
    const observation = yield* composeObservation({ settings, account, observationGate });
    // The live composer is built after this one and decides the beats on its
    // record and its hold, so the two hands are set once it stands.
    let onboardingWritten: () => void = () => undefined;
    let announcementHoldRead: () => void = () => undefined;
    const calendars = yield* composeCalendars({
      settings,
      observationGate,
      onOnboardingWritten: () => onboardingWritten(),
      onAnnouncementHoldRead: () => announcementHoldRead(),
    });
    const devices = yield* composeDevices({ account, calendars, settings });
    // The live composer is built after this one and decides on the offers
    // the Conversation's events fold to, so the hand is set once it stands.
    let briefingsOffered: (count: number) => void = () => undefined;
    const conversation = composeConversation({
      kernel,
      settings,
      account,
      devices,
      refreshRoster: observation.refreshRoster,
      onOpenOffers: (count) => briefingsOffered(count),
      // Both clients carry the account's own token, holder fence included, so
      // the one retry after a 401 can tell a renewed bearer from another person's.
      heads: new HostedChangesClient({
        serviceBaseUrl: kernel.hostedServiceBaseUrl,
        ...account.token,
      }),
      client: new HostedConversationClient({
        serviceBaseUrl: kernel.hostedServiceBaseUrl,
        ...account.token,
      }),
    });
    // No brain runs on this Mac: the exchange is the service's, and what a
    // session speaks unprompted is what the hosted brain decided and put on
    // offer. The onboarding beats and the launch greeting are decided by the
    // live composer below and spoken by the service on its ask.
    const live = yield* composeLive({ settings, account, observation, calendars });
    onboardingWritten = live.requestOnboardingBeat;
    announcementHoldRead = live.onAnnouncementHoldRead;
    briefingsOffered = live.briefingsOffered;

    const supervisor = yield* observationSupervisor([
      observation.loop,
      calendars.loop,
      conversation.loop,
    ]);

    /**
     * Every cadence the account gate holds open, as one scope rather than as a
     * pair of arm-and-disarm calls: closing it is the whole of the disarm, and
     * the standing scope's own close is what closes it at a quit, which is why
     * nothing a sign-out alone means — the roster emptied, the view reset, the
     * voice credential re-applied — is in here.
     */
    const capabilitiesArmed = Effect.gen(function* () {
      yield* devices.register;
      yield* Effect.addFinalizer(() => devices.release(undefined));
      yield* calendars.armObservation;
      yield* Effect.addFinalizer(() => calendars.disarmObservation);
      yield* supervisor.arm;
      yield* Effect.addFinalizer(() => supervisor.disarm);
    });

    const capabilities = yield* cadenceGate(capabilitiesArmed);

    /**
     * The account gate opening, which is what a sign-in runs and what a launch
     * behind an account already signed in runs: the preferences reconciled, the
     * voice credential applied, and only then the cadences armed. The gate is
     * re-read after the awaits for the same reason it always was — a sign-out
     * can land while they are out — and the gate itself is serialized, so a
     * sign-out that arrives after the arm rather than before it disarms what
     * this opened.
     */
    const openCapabilities = Effect.gen(function* () {
      // First on the vault's queue, so the list is read and any leftover key
      // migrated before a save the developer makes in the meantime, which
      // then wins as the newest word on the same queue.
      if (account.signedIn()) yield* settings.reconcileVaultKeys();
      if (account.signedIn()) yield* settings.reconcileAccountPreferences();
      yield* account.applyVoiceCredential;
      yield* settings.emitSettings();
      if (!account.capabilitiesActive()) return;
      observation.startObservation();
      yield* capabilities.arm;
      live.requestOnboardingBeat();
    });

    /** The gate closing: the cadences disarmed, and then what a sign-out alone means. */
    const closeCapabilities = Effect.gen(function* () {
      yield* capabilities.disarm;
      live.withdrawBeats();
      conversation.reset();
      observation.stopObservation();
      settings.forgetVaultKeys();
      yield* account.applyVoiceCredential;
      yield* settings.emitSettings();
    });

    // Every edge a composer could not take as a constructor argument, in one
    // list: each is a cycle the concerns genuinely have. The write is the
    // composer's own set-once, so a reader that awaits its links suspends
    // until this has run rather than reading nothing.
    yield* settings.link({
      refreshAccount: account.session.refreshOnce,
      cloudKeyHeld: calendars.settleKeyGate,
      setVoice: (voice) =>
        Effect.sync(() => account.voiceCapabilities.liveSessions?.setVoice(voice)),
      refreshAnnouncementHold: calendars.refreshAnnouncementHold,
      reportPresence: devices.reportPresence,
      broadcastWorkspaceProjects: observation.broadcastWorkspaceProjects,
      workspaceProjectOffered: (providerId, providerProjectId) =>
        Effect.sync(() => observation.workspaceProjectOffered(providerId, providerProjectId)),
    });
    yield* calendars.link({ reportPresence: devices.reportPresence });
    yield* account.link({
      startCapabilities: openCapabilities,
      stopCapabilities: closeCapabilities,
      onFirstSignIn: calendars.recordFirstSignIn,
      onFirstSignInArrival: live.seedArrivalOnFirstSignIn,
      releaseDevice: (stored) => devices.release(stored),
      deviceId: () => devices.deviceId(),
    });
    const concerns = {
      [HOST_CONCERN.SETTINGS]: settings,
      [HOST_CONCERN.ACCOUNT]: account,
      [HOST_CONCERN.DEVICES]: devices,
      [HOST_CONCERN.CONVERSATION]: conversation,
      [HOST_CONCERN.CALENDARS]: calendars,
      [HOST_CONCERN.OBSERVATION]: observation,
      [HOST_CONCERN.LIVE]: live,
    } satisfies Readonly<Record<HostConcern, Composer>>;

    /**
     * The one method no composer can own: it reads six of them at once, so
     * giving it to any would hand that composer references to the other five,
     * which is the coupling the split exists to remove.
     */
    const bootstrapMethods: GatewayMethodTable = {
      [GATEWAY_METHOD.SHUTDOWN]: () =>
        Effect.sync(() => {
          shutdownSignal.notify?.();
          return { accepted: true };
        }),
      [GATEWAY_METHOD.CLIENT_BOOTSTRAP]: () =>
        Effect.gen(function* () {
          const snapshot = yield* Effect.orDie(settings.store.snapshot());
          const quiet = account.capabilitiesActive()
            ? yield* calendars.announcementsQuietNow(now())
            : false;
          const replay = yield* account.sessionReplayState;
          const workspaceProjectDefaults = account.capabilitiesActive()
            ? yield* Effect.orDie(
                settings.store.get(APP_SETTING_SCHEMA.workspaceProjectDefaults.field),
              )
            : undefined;
          return {
            settings: carried(snapshot),
            account: carried(account.snapshot()),
            sessions: carried(observation.rosterForClients()),
            sessionsSettled: observation.rosterSettled(),
            announcementsHeld: quiet,
            conversationView: carried(conversation.snapshot()),
            workspaceProjects: carried(
              workspaceProjectDefaults === undefined
                ? []
                : normalizeObservedWorkspaceProjects(
                    observation.offeredWorkspaceProjects(),
                    workspaceProjectDefaults,
                  ),
            ),
            calendars: carried(account.capabilitiesActive() ? calendars.observedCalendars() : []),
            calendarOnboardingOwed: calendars.gateOwed(),
            introductionOwed: calendars.introductionOwed(),
            conductorKeyOnboardingOwed: calendars.keyGateOwed(),
            sessionReplay: carried(replay),
            voiceAvailable: account.voiceCapabilities.liveSessions !== undefined,
            agentTraceEnabled: account.agentTrace !== undefined,
          };
        }),
    };

    const methods = yield* mergedMethods(Object.values(concerns));
    const service = yield* createGatewayService({
      nodes: kernel.nodes,
      now,
      createId: kernel.createId,
      methods: { ...methods, ...bootstrapMethods },
    });
    yield* hostService.set(service);

    /**
     * The explicit quit's steps. Admissions close at the server, and the
     * counted events are flushed. No run of this Mac's own is under way to
     * cancel, settle, or count: every ask is the service's, so the drain
     * cancels nothing and counts nothing unresolved.
     */
    const drainSteps: GatewayShutdownSteps = yield* shutdownStepsFlushingEvents(
      {
        closeAdmissions: service.closeAdmissions,
        cancelActive: Effect.succeed([]),
        awaitSettled: Effect.void,
        persistUnresolved: Effect.succeed(0),
      },
      settings.flushProductEvents,
    );
    // The live session's graceful close rides inside the same drain, so a quit
    // mid-call ends the session within the deadline and never after it.
    const shutdownSteps = yield* shutdownStepsClosingLiveSession(drainSteps, live.service.stop());

    const drain = yield* hostDrain(shutdownSteps, report);

    const assembly: HostAssembly = {
      gateway: service.gateway,
      startOrder: HOST_START_ORDER.map((name) => concerns[name]),
      /**
       * The launch's own arming, which is the gate's: where the account's
       * capabilities already stand open, the launch opens the gate exactly as
       * a sign-in does, and the standing scope closing is what disarms it —
       * the cadences alone, since a quit is not a sign-out. Where they do not,
       * the launch still applies the voice credential the signed-out panel is
       * drawn from, because it waits on no account.
       */
      armed: Effect.gen(function* () {
        // Registered whether or not the launch opens the gate, because a
        // sign-in after a signed-out launch opens it too, and the gate's own
        // scope would otherwise stand until the assembly's close — which is
        // after every composer has stopped, so a calendars timer would still
        // be firing into a live session that had already been told to stop.
        yield* Effect.addFinalizer(() => capabilities.disarm);
        if (account.capabilitiesActive()) {
          yield* openCapabilities;
        } else {
          yield* account.applyVoiceCredential;
          // The ask decides for itself that no account stands; it is made all
          // the same so a launch reads one rule and not two.
          live.requestOnboardingBeat();
        }
        yield* Effect.forkScoped(Effect.ignore(account.session.refreshOnce()));
      }),
      // The loops are disarmed before the admissions close, so no observation
      // pass begins behind a quit; the gate's own scope is what the standing
      // scope closes after.
      drain: (shutdown) => Effect.andThen(supervisor.disarm, drain(shutdown)),
    };
    return assembly;
  }),
);

/**
 * The host as one `Layer` over the kernel: built, it is the host started, and
 * the scope it was built in closing is the whole quit — the drain, the loops
 * disarmed, and every composer's stop in the reverse of its start.
 */
export const hostLayer: Layer.Layer<
  HostTag,
  DuplicateGatewayMethod,
  | HostKernelTag
  | HostService
  | RunMode
  | Reporter
  | Environment
  | SecretCipher
  | AppIdentity
  | MachinePresenceReader
  | ShutdownSignal
  | FileSystem.FileSystem
> = Layer.provide(hostStandingLayer, hostAssemblyLayer);
