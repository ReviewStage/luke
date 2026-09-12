import type * as FileSystem from "@effect/platform/FileSystem";
import { BRAIN_REQUEST_STATUS } from "@sidecar/brain/requests";
import {
  carried,
  GATEWAY_METHOD,
  type GatewayMethodTable,
  type GatewayShutdownSteps,
} from "@sidecar/gateway";
import { HostedChangesClient, HostedConversationClient } from "@sidecar/hosted";
import { PROACTIVE_SPEECH_KIND } from "@sidecar/live";
import { observationSupervisor } from "@sidecar/runtime";
import { cadenceGate } from "@sidecar/runtime/effect";
import {
  isTerminalChildRunStatus,
  MAIN_SESSION_KEY,
  type SessionKey,
} from "@sidecar/runtime/vocabulary";
import { normalizeObservedWorkspaceProjects } from "@sidecar/session";
import { APP_SETTING_SCHEMA } from "@sidecar/settings";
import { liveBrainLayer, liveRecordLayer } from "@sidecar/voice/effect";
import { Effect, Layer } from "effect";
import { composeAccount } from "./compose-account.js";
import { type BrainComposer, composeBrain } from "./compose-brain.js";
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
  type StoreWorker,
} from "./effect/seams.js";
import { shutdownStepsClosingLiveSession, shutdownStepsFlushingEvents } from "./lifecycle.js";
import { createGatewayService } from "./service.js";
import { conversationLiveRecord } from "./voice/conversation-live-record.js";
import { brainAgentLiveBrain } from "./voice/live-brain-adapter.js";

/** The eight concerns, by the name each is built under. */
export const HOST_CONCERN = {
  SETTINGS: "settings",
  ACCOUNT: "account",
  DEVICES: "devices",
  CONVERSATION: "conversation",
  BRAIN: "brain",
  CALENDARS: "calendars",
  OBSERVATION: "observation",
  LIVE: "live",
} as const;

export type HostConcern = (typeof HOST_CONCERN)[keyof typeof HOST_CONCERN];

/**
 * The order the launch has to keep: the account is read before anything
 * gated on it, the store is open before the brain's credential transition
 * installs a runtime over it, and the loops are armed only once every owner
 * of one has started. The quit is this order reversed.
 */
export const HOST_START_ORDER: readonly HostConcern[] = [
  HOST_CONCERN.SETTINGS,
  HOST_CONCERN.ACCOUNT,
  HOST_CONCERN.DEVICES,
  HOST_CONCERN.CONVERSATION,
  HOST_CONCERN.BRAIN,
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
  | StoreWorker
  | ShutdownSignal
  | FileSystem.FileSystem
> = Layer.scoped(
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
    const calendars = yield* composeCalendars({ settings, observationGate });
    const devices = yield* composeDevices({ account, calendars });
    const conversation = composeConversation({
      kernel,
      settings,
      account,
      devices,
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
    // Annotated because the brain and the live session are each other's
    // cycle — a briefing reaches the live service, and the service hands a
    // held one back to the brain that decided it — and an inferred type
    // would be reading itself through the other.
    const brain: BrainComposer = yield* composeBrain({
      account,
      observation,
      announcements: {
        deliverBriefing: (delivery) => live.service.deliverBriefing(delivery),
        dropBriefings: () => live.service.dropBriefings(),
      },
    });
    // The brain and record the live session speaks through are built here,
    // where the brain composer stands, and handed to the composer as
    // `@sidecar/voice/effect` layers rather than as constructor arguments.
    const liveBrain = brainAgentLiveBrain({ agent: () => brain.wiring.current() });
    const liveRecord = conversationLiveRecord({
      recordConversationEntry: (entry, recordedAt, sessionKey) =>
        brain.store.recordConversationEntry(entry, recordedAt, sessionKey),
      createEventId: kernel.createId,
    });
    const live = yield* Effect.provide(
      composeLive({ settings, account, calendars, observation, brain }),
      Layer.mergeAll(liveBrainLayer(liveBrain), liveRecordLayer(liveRecord)),
    );

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
      if (account.signedIn()) yield* settings.reconcileAccountPreferences();
      yield* Effect.promise(() => account.applyVoiceCredential());
      yield* settings.emitSettings();
      if (!account.capabilitiesActive()) return;
      observation.startObservation();
      yield* capabilities.arm;
      if (account.signedIn()) yield* settings.reconcileProviderKeyVault();
      void live.requestOnboardingBeat();
    });

    /** The gate closing: the cadences disarmed, and then what a sign-out alone means. */
    const closeCapabilities = Effect.gen(function* () {
      yield* capabilities.disarm;
      conversation.reset();
      observation.stopObservation();
      live.service.withdrawBeat(PROACTIVE_SPEECH_KIND.ARRIVAL);
      live.service.withdrawBeat(PROACTIVE_SPEECH_KIND.CALENDAR_ONBOARDING);
      yield* Effect.promise(() => account.applyVoiceCredential());
      yield* settings.emitSettings();
    });

    // Every edge a composer could not take as a constructor argument, in one
    // list: each is a cycle the concerns genuinely have, and reading one before
    // this has run throws by name rather than answering nothing.
    settings.link({
      refreshAccount: account.session.refreshOnce,
      applyVoiceCredential: account.applyVoiceCredential,
      setVoice: (voice) => account.voiceCapabilities.liveSessions?.setVoice(voice),
      reconcileSpeech: () => {
        void live.service.reconcile();
      },
      broadcastWorkspaceProjects: observation.broadcastWorkspaceProjects,
      workspaceProjectOffered: observation.workspaceProjectOffered,
    });
    account.link({
      startCapabilities: openCapabilities,
      stopCapabilities: closeCapabilities,
      onFirstSignIn: calendars.recordFirstSignIn,
      onFirstSignInArrival: live.seedArrivalOnFirstSignIn,
      retireBrain: () => brain.wiring.retire(),
      rebuildBrain: () => brain.wiring.rebuild(),
      syncMemory: brain.syncMemory,
      releaseDevice: (stored) => devices.release(stored),
      deviceId: () => devices.deviceId(),
    });
    observation.link({ rosterLook: () => brain.wiring.rosterLook() });
    calendars.link({
      reconcileSpeech: () => {
        void live.service.reconcile();
      },
      withdrawBeat: (kind) => live.service.withdrawBeat(kind),
      dropBriefings: () => live.service.dropBriefings(),
      requestOnboardingBeat: () => void live.requestOnboardingBeat(),
    });
    live.link({ releaseHeld: (briefings) => brain.wiring.releaseHeld(briefings) });

    const concerns = {
      [HOST_CONCERN.SETTINGS]: settings,
      [HOST_CONCERN.ACCOUNT]: account,
      [HOST_CONCERN.DEVICES]: devices,
      [HOST_CONCERN.CONVERSATION]: conversation,
      [HOST_CONCERN.BRAIN]: brain,
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
          const replay = yield* Effect.promise(() => account.sessionReplayState());
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
            sessionReplay: carried(replay),
            voiceAvailable: account.voiceCapabilities.liveSessions !== undefined,
            agentTraceEnabled: account.agentTrace !== undefined,
          };
        }),
    };

    const methods = yield* mergedMethods(Object.values(concerns));
    const service = yield* createGatewayService({
      brain: {
        current: (sessionKey) => brain.wiring.current(sessionKey),
        agentForRun: (runId) => brain.wiring.agentForRun(runId),
        allRequests: () => brain.wiring.allRequests(),
        generationId: (sessionKey) => brain.wiring.store(sessionKey).generationId(),
        children: brain.wiring.children,
        configuration: () => brain.wiring.configuration(),
        updateConfiguration: (patch) => brain.wiring.updateConfiguration(patch),
      },
      conversations: brain.conversations,
      memory: {
        status: () => ({
          mode: brain.memoryMode(),
          entries: brain.store.rememberedFacts().length,
        }),
      },
      observedSessionCount: observation.observedSessionCount,
      nodes: kernel.nodes,
      now,
      createId: kernel.createId,
      methods: { ...methods, ...bootstrapMethods },
    });
    yield* hostService.set(service);

    /**
     * The explicit quit's steps. Admissions close at the server; every run and
     * child under way is cancelled; the followers' publication is let finish,
     * so an end already reached stands in Conversation; and what did not settle is
     * counted rather than finished: the store's load at the next start marks
     * an unsettled run interrupted and replays nothing.
     */
    const drainSteps: GatewayShutdownSteps = yield* shutdownStepsFlushingEvents(
      {
        closeAdmissions: service.closeAdmissions,
        cancelActive: Effect.promise(async () => {
          const cancelled: string[] = [];
          for (const record of brain.wiring.allRequests()) {
            if (
              record.status !== BRAIN_REQUEST_STATUS.QUEUED &&
              record.status !== BRAIN_REQUEST_STATUS.RUNNING
            ) {
              continue;
            }
            const agent = brain.wiring.agentForRun(record.runId);
            if (!agent) continue;
            cancelled.push(record.runId);
            await agent.cancelAsk(record.runId).catch(() => undefined);
          }
          for (const child of brain.wiring.children.children()) {
            if (isTerminalChildRunStatus(child.status)) continue;
            await brain.wiring.children.cancel(child.childId).catch(() => undefined);
          }
          return cancelled;
        }),
        awaitSettled: Effect.promise(() => brain.wiring.publicationSettled()),
        persistUnresolved: Effect.sync(() => {
          // What the next launch will find: the records as the stores last
          // persisted them, read from the envelopes rather than from memory. A
          // cancellation whose write did not land leaves its run queued or
          // running on disk, and that is what the load marks interrupted and
          // never replays, so it is counted here as unresolved.
          const keys = new Set<SessionKey>([
            MAIN_SESSION_KEY,
            ...brain.store.directory().map((entry) => entry.sessionKey),
          ]);
          let unresolved = 0;
          for (const key of keys) {
            const persisted = brain.wiring.store(key).current();
            if (!persisted) continue;
            unresolved += persisted.requests.filter(
              (record) =>
                record.status === BRAIN_REQUEST_STATUS.QUEUED ||
                record.status === BRAIN_REQUEST_STATUS.RUNNING,
            ).length;
          }
          return unresolved;
        }),
      },
      Effect.promise(() => settings.flushProductEvents()),
    );
    // The live session's graceful close rides inside the same drain, so a quit
    // mid-call ends the session within the deadline and never after it.
    const shutdownSteps = yield* shutdownStepsClosingLiveSession(
      drainSteps,
      Effect.promise(() => live.service.stop()),
    );

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
       * drawn from and still asks for the onboarding beat, because neither
       * waits on an account.
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
          yield* Effect.promise(() => account.applyVoiceCredential());
          void live.requestOnboardingBeat();
        }
        yield* Effect.forkScoped(Effect.ignore(account.session.refreshOnce()));
      }),
      // The loops are disarmed before the admissions close, so no observation
      // pass begins behind a quit; the gate's own scope is what the standing
      // scope closes after.
      drain: (shutdown) => Effect.zipRight(supervisor.disarm, drain(shutdown)),
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
  | StoreWorker
  | ShutdownSignal
  | FileSystem.FileSystem
> = Layer.provide(hostStandingLayer, hostAssemblyLayer);
