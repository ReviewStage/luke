import type * as FileSystem from "@effect/platform/FileSystem";
import { NodeFileSystem } from "@effect/platform-node";
import { BRAIN_REQUEST_STATUS } from "@sidecar/brain/requests";
import {
  carried,
  GATEWAY_METHOD,
  type GatewayMethodTable,
  type GatewayShutdownOptions,
  type GatewayShutdownSteps,
  gatewayOk,
} from "@sidecar/gateway";
import type { GatewayInProcessHost } from "@sidecar/gateway/server";
import { HostedChangesClient, HostedConversationClient } from "@sidecar/hosted";
import { PROACTIVE_SPEECH_KIND } from "@sidecar/live";
import { ObservationSupervisor } from "@sidecar/runtime";
import {
  isTerminalChildRunStatus,
  MAIN_SESSION_KEY,
  type SessionKey,
} from "@sidecar/runtime/vocabulary";
import { normalizeObservedWorkspaceProjects } from "@sidecar/session";
import { APP_SETTING_SCHEMA } from "@sidecar/settings";
import { liveBrainLayer, liveRecordLayer } from "@sidecar/voice/effect";
import {
  Cause,
  type Context,
  Duration,
  Effect,
  Exit,
  Fiber,
  Layer,
  ManagedRuntime,
  Option,
  Scope,
} from "effect";
import { composeAccount } from "./compose-account.js";
import { composeBrain } from "./compose-brain.js";
import { composeCalendars } from "./compose-calendars.js";
import { composeConversation } from "./compose-conversation.js";
import { composeDevices } from "./compose-devices.js";
import { composeIssues } from "./compose-issues.js";
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
import { HostKernelTag, HostService, hostKernelLayerFromSeams } from "./effect/kernel.js";
import {
  type Environment,
  HostSeamsObject,
  Reporter,
  RunMode,
  type SecretCipher,
} from "./effect/seams.js";
import type { HostSeams } from "./host-kernel.js";
import { shutdownStepsClosingLiveSession, shutdownStepsFlushingEvents } from "./lifecycle.js";
import { createGatewayService } from "./service.js";
import { conversationLiveRecord } from "./voice/conversation-live-record.js";
import { brainAgentLiveBrain } from "./voice/live-brain-adapter.js";

/**
 * How long the quit waits for the store to close after the drain has
 * settled. A close that hangs on a disk must not hold the process open past
 * its quit: what it could not write is what the next launch marks
 * interrupted, which is the same answer an unsettled drain leaves.
 */
const HOST_CLOSE_WAIT_MS = 5_000;

export interface Host {
  /** The one boundary a client reaches this host through: the in-process host every transport here is bound to. */
  readonly gateway: GatewayInProcessHost;
  /** Opens the store, seeds the workspace, starts maintenance, scheduling, hooks, and observation. */
  start: () => Promise<void>;
  /**
   * The whole quit, in the coordinator's fixed order: admissions closed,
   * everything under way cancelled, a bounded wait for it to settle,
   * whatever did not settle written down as unresolved for the next launch's
   * recovery, and only then the store closed. A caller that ran the steps
   * itself would be a second order for the same quit, so there is none to
   * run: what became of it is reported, never answered, because nothing a
   * client could do with the answer is left to do.
   */
  stop: (options?: GatewayShutdownOptions) => Promise<void>;
}

/** The nine concerns, by the name each is built under. */
export const HOST_CONCERN = {
  SETTINGS: "settings",
  ACCOUNT: "account",
  DEVICES: "devices",
  CONVERSATION: "conversation",
  BRAIN: "brain",
  CALENDARS: "calendars",
  OBSERVATION: "observation",
  ISSUES: "issues",
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
  HOST_CONCERN.ISSUES,
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
  | HostSeamsObject
  | RunMode
  | Reporter
  | Environment
  | SecretCipher
  | FileSystem.FileSystem
> = Layer.scoped(
  HostAssemblyTag,
  Effect.gen(function* () {
    const kernel = yield* HostKernelTag;
    const hostService = yield* HostService;
    const options = yield* HostSeamsObject;
    const runMode = yield* RunMode;
    const { report } = yield* Reporter;
    const { now } = kernel;

    const settings = yield* composeSettings();
    const account = yield* composeAccount({ settings });
    const observationGate = () => runMode.observesProviders && account.capabilitiesActive();
    const issues = composeIssues({ kernel, settings, observationGate });
    const observation = yield* composeObservation({ settings, account, issues, observationGate });
    const calendars = composeCalendars({ kernel, settings, observationGate });
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
    const brain = composeBrain({
      kernel,
      settings,
      account,
      issues,
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

    // Every edge a composer could not take as a constructor argument, in one
    // list: each is a cycle the concerns genuinely have, and reading one before
    // this has run throws by name rather than answering nothing.
    settings.link({
      refreshAccount: async () => {
        await account.session.refreshOnce();
      },
      applyVoiceCredential: account.applyVoiceCredential,
      setVoice: (voice) => account.voiceCapabilities.liveSessions?.setVoice(voice),
      reconcileSpeech: () => {
        void live.service.reconcile();
      },
      refreshSupersetWorkspaceHost: async () => {
        await observation.readSupersetWorkspaceHost();
      },
      broadcastWorkspaceProjects: observation.broadcastWorkspaceProjects,
      refreshIssues: issues.refresh,
      workspaceProjectOffered: observation.workspaceProjectOffered,
    });
    account.link({
      startCapabilities: startAccountCapabilities,
      stopCapabilities: stopAccountCapabilities,
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
      [HOST_CONCERN.ISSUES]: issues,
      [HOST_CONCERN.LIVE]: live,
    } satisfies Readonly<Record<HostConcern, Composer>>;
    const supervisor = new ObservationSupervisor([
      observation.loop,
      issues.loop,
      calendars.loop,
      conversation.loop,
    ]);

    async function startAccountCapabilities(): Promise<void> {
      if (!account.capabilitiesActive()) return;
      void settings.reconcileAccountPreferences();
      await account.applyVoiceCredential();
      await settings.emitSettings();
      if (!account.capabilitiesActive()) return;
      void devices.register();
      observation.startObservation();
      calendars.startObservation();
      supervisor.setEnabled(true);
      void live.requestOnboardingBeat();
      settings.reconcileProviderKeyVault();
    }

    async function stopAccountCapabilities(): Promise<void> {
      supervisor.setEnabled(false);
      conversation.reset();
      await devices.release(undefined);
      observation.stopObservation();
      issues.stopObservation();
      calendars.stopObservation();
      live.service.withdrawBeat(PROACTIVE_SPEECH_KIND.ARRIVAL);
      live.service.withdrawBeat(PROACTIVE_SPEECH_KIND.CALENDAR_ONBOARDING);
      await account.applyVoiceCredential();
      await settings.emitSettings();
    }

    /**
     * The one method no composer can own: it reads six of them at once, so
     * giving it to any would hand that composer references to the other five,
     * which is the coupling the split exists to remove.
     */
    const bootstrapMethods: GatewayMethodTable = {
      [GATEWAY_METHOD.SHUTDOWN]: () => {
        options.onShutdownRequested?.();
        return gatewayOk({ accepted: true });
      },
      [GATEWAY_METHOD.CLIENT_BOOTSTRAP]: async () => {
        const [snapshot, supersetInstalled, supersetConnected, quiet, replay] = await Promise.all([
          settings.store.snapshot(),
          observation.supersetCli.installed(),
          observation.supersetCli.connected(),
          account.capabilitiesActive()
            ? calendars.announcementsQuietNow(now())
            : Promise.resolve(false),
          account.sessionReplayState(),
        ]);
        return gatewayOk({
          settings: carried(snapshot),
          account: carried(account.snapshot()),
          sessions: carried(observation.rosterForClients()),
          sessionsSettled: observation.rosterSettled(),
          announcementsHeld: quiet,
          conversationView: carried(conversation.snapshot()),
          workspaceProjects: carried(
            account.capabilitiesActive()
              ? normalizeObservedWorkspaceProjects(
                  observation.offeredWorkspaceProjects(),
                  await settings.store.get(APP_SETTING_SCHEMA.workspaceProjectDefaults.field),
                )
              : [],
          ),
          calendars: carried(account.capabilitiesActive() ? calendars.observedCalendars() : []),
          calendarOnboardingOwed: calendars.gateOwed(),
          supersetInstalled,
          supersetConnected,
          sessionReplay: carried(replay),
          voiceAvailable: account.voiceCapabilities.liveSessions !== undefined,
          agentTraceEnabled: account.agentTrace !== undefined,
        });
      },
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
    const drainSteps: GatewayShutdownSteps = shutdownStepsFlushingEvents(
      {
        closeAdmissions: () => service.closeAdmissions(),
        cancelActive: async () => {
          supervisor.setEnabled(false);
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
        },
        awaitSettled: async (signal) => {
          if (signal.aborted) return;
          await brain.wiring.publicationSettled();
        },
        persistUnresolved: async () => {
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
        },
      },
      () => settings.flushProductEvents(),
    );
    // The live session's graceful close rides inside the same drain, so a quit
    // mid-call ends the session within the deadline and never after it.
    const shutdownSteps = shutdownStepsClosingLiveSession(drainSteps, () => live.service.stop());

    const assembly: HostAssembly = {
      gateway: service.gateway,
      startOrder: HOST_START_ORDER.map((name) => concerns[name]),
      arm: async () => {
        if (account.signedIn()) void settings.reconcileAccountPreferences();
        void devices.register();
        await account.applyVoiceCredential();
        observation.startObservation();
        calendars.startObservation();
        supervisor.setEnabled(true);
        if (account.signedIn()) settings.reconcileProviderKeyVault();
        void live.requestOnboardingBeat();
        void account.session.refreshOnce();
      },
      disarm: () => {
        supervisor.setEnabled(false);
      },
      drain: yield* hostDrain(shutdownSteps, report),
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
  | HostSeamsObject
  | RunMode
  | Reporter
  | Environment
  | SecretCipher
  | FileSystem.FileSystem
> = Layer.provide(hostStandingLayer, hostAssemblyLayer);

/**
 * The host and the kernel beneath it, from the one object the desktop builds
 * today.
 *
 * @deprecated The `Layer.succeed(oldObject)` shim over `hostLayer`; P12-05
 * deletes it with `createHostKernel`.
 */
export const hostLayerFromSeams = (
  options: HostSeams,
): Layer.Layer<HostTag, DuplicateGatewayMethod> =>
  Layer.provide(hostLayer, Layer.merge(hostKernelLayerFromSeams(options), NodeFileSystem.layer));

/**
 * What the composers' stops left when the scope closed, one line each: a
 * concern that could not stop stranded none of its siblings, and the scope's
 * own close is what says so.
 */
const reportUncleanStops = (exit: Exit.Exit<void>, report: (message: string) => void): void => {
  if (Exit.isSuccess(exit)) return;
  for (const failure of Cause.defects(exit.cause)) {
    report(
      `a composer did not stop cleanly: ${failure instanceof Error ? failure.message : String(failure)}`,
    );
  }
};

/**
 * The `start()`/`stop()` face the desktop still operates, over `hostLayer`
 * built in one scope on a `ManagedRuntime` of the adaptor's own. The assembly
 * is built at once, so the server stands before the start as it always has;
 * `start` builds the standing layer into the scope on a fiber of its own, and
 * `stop` interrupts that fiber if it is still under way, runs the drain under
 * the caller's deadline, and then closes the scope, bounded, reporting what
 * did not close in time and leaving it to the exit. The runs here are the
 * strangler shim's own and on the ADR's allowlist.
 *
 * @deprecated P8-01 takes `hostLayer` on the desktop's own runtime; P12-05
 * deletes this adaptor with `createHostKernel`.
 */
export function composeHost(options: HostSeams): Host {
  const runtime = ManagedRuntime.make(
    Layer.provideMerge(
      hostAssemblyLayer,
      Layer.merge(hostKernelLayerFromSeams(options), NodeFileSystem.layer),
    ),
  );
  const assembly = runtime.runSync(HostAssemblyTag);
  const standing = runtime.runSync(Scope.make());
  const { report } = options;

  let standup: Fiber.RuntimeFiber<Context.Context<HostTag>, DuplicateGatewayMethod> | undefined;

  const quit = (shutdown: GatewayShutdownOptions) =>
    Effect.gen(function* () {
      // A standup still under way is interrupted first, so no composer after
      // the one starting begins and nothing is armed behind the quit; the
      // composer mid-start runs to its end, since a start is uninterruptible,
      // and one that never ends is left, bounded, for the drain to leave behind.
      if (standup !== undefined) {
        const interrupted = yield* Effect.timeoutOption(
          Fiber.interrupt(standup),
          Duration.millis(HOST_CLOSE_WAIT_MS),
        );
        if (Option.isNone(interrupted)) report("the standup did not stop in time; draining anyway");
      }
      // A drain that cannot finish still says so and still closes the store:
      // what it could not settle is what the next launch marks interrupted, and
      // a quit must leave either way rather than on an unhandled failure.
      yield* Effect.ignore(assembly.drain(shutdown));
      const closing = yield* Effect.forkDaemon(Effect.exit(Scope.close(standing, Exit.void)));
      const closed = yield* Effect.timeoutOption(
        Fiber.join(closing),
        Duration.millis(HOST_CLOSE_WAIT_MS),
      );
      Option.match(closed, {
        onNone: () => report("the runtime did not close in time; leaving it to the exit"),
        onSome: (exit) => reportUncleanStops(exit, report),
      });
    });

  let stopping: Promise<void> | undefined;
  return {
    gateway: assembly.gateway,
    start: async () => {
      const fiber = runtime.runFork(Layer.buildWithScope(hostStandingLayer, standing));
      standup = fiber;
      const built = await runtime.runPromise(Fiber.await(fiber));
      if (Exit.isFailure(built)) throw Cause.squash(built.cause);
    },
    stop: (shutdown = {}) => {
      stopping ??= runtime.runPromise(quit(shutdown)).then(() => runtime.dispose());
      return stopping;
    },
  };
}
