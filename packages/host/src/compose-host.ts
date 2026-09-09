import { BRAIN_REQUEST_STATUS } from "@sidecar/brain/requests";
import {
  carried,
  GATEWAY_METHOD,
  type GatewayMethodTable,
  type GatewayServer,
  type GatewayShutdownOptions,
  type GatewayShutdownSteps,
  gatewayOk,
  shutdownGateway,
} from "@sidecar/gateway";
import { ARRIVAL_SPEECH_KIND, CALENDAR_ONBOARDING_SPEECH_KIND } from "@sidecar/realtime";
import { ObservationSupervisor } from "@sidecar/runtime";
import {
  isTerminalChildRunStatus,
  MAIN_SESSION_KEY,
  type SessionKey,
} from "@sidecar/runtime/vocabulary";
import { normalizeObservedWorkspaceProjects } from "@sidecar/session";
import { APP_SETTING_SCHEMA } from "@sidecar/settings";
import { composeAccount } from "./compose-account.js";
import { composeBrain } from "./compose-brain.js";
import { composeCalendars } from "./compose-calendars.js";
import { composeDevices } from "./compose-devices.js";
import { composeIssues } from "./compose-issues.js";
import { composeObservation } from "./compose-observation.js";
import { composeSettings } from "./compose-settings.js";
import { composeSpeech } from "./compose-speech.js";
import { type Composer, mergeMethods } from "./composer.js";
import { createHostKernel, type HostSeams } from "./host-kernel.js";
import { shutdownStepsFlushingEvents } from "./lifecycle.js";
import { createGatewayService } from "./service.js";

/**
 * How long the quit waits for the store to close after the drain has
 * settled. A close that hangs on a disk must not hold the process open past
 * its quit: what it could not write is what the next launch marks
 * interrupted, which is the same answer an unsettled drain leaves.
 */
const HOST_CLOSE_WAIT_MS = 5_000;

export interface Host {
  /** The one boundary a client reaches this host through. */
  readonly server: GatewayServer;
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

export function composeHost(options: HostSeams): Host {
  const kernel = createHostKernel(options);
  const { runMode, report, now } = kernel;

  const settings = composeSettings({ kernel });
  const account = composeAccount({ kernel, settings });
  const devices = composeDevices({ kernel, settings, account });
  const observationGate = () => runMode.observesProviders && account.capabilitiesActive();
  const issues = composeIssues({ kernel, settings, observationGate });
  const observation = composeObservation({ kernel, settings, account, issues, observationGate });
  const calendars = composeCalendars({ kernel, settings, observationGate });
  const speech = composeSpeech({ kernel, settings, account, calendars, observation });
  const brain = composeBrain({ kernel, settings, account, issues, observation, speech });

  // Every edge a composer could not take as a constructor argument, in one
  // list: each is a cycle the concerns genuinely have, and reading one before
  // this has run throws by name rather than answering nothing.
  settings.link({
    refreshAccount: async () => {
      await account.session.refreshOnce();
    },
    applyVoiceCredential: account.applyVoiceCredential,
    setVoice: (voice) => account.voiceCapabilities.realtimeCredentials?.setVoice(voice),
    setVoiceSpeed: (speed) => account.voiceCapabilities.realtimeCredentials?.setSpeed(speed),
    reconcileSpeech: () => void speech.reconcileSpeech(),
    refreshSupersetWorkspaceHost: async () => {
      await observation.readSupersetWorkspaceHost();
    },
    broadcastWorkspaceProjects: observation.broadcastWorkspaceProjects,
    refreshCredentialAdapter: observation.refreshCredentialAdapter,
    refreshIssues: issues.refresh,
    workspaceProjectOffered: observation.workspaceProjectOffered,
  });
  account.link({
    startCapabilities: startAccountCapabilities,
    stopCapabilities: stopAccountCapabilities,
    onFirstSignIn: calendars.recordFirstSignIn,
    onFirstSignInArrival: speech.seedArrivalOnFirstSignIn,
    retireBrain: () => brain.wiring.retire(),
    rebuildBrain: () => brain.wiring.rebuild(),
    syncMemory: brain.syncMemory,
    releaseDevice: (stored) => devices.release(stored),
  });
  observation.link({
    wake: (events) => brain.wiring.wake(events),
    rosterLook: () => brain.wiring.rosterLook(),
  });
  calendars.link({
    reconcileSpeech: () => void speech.reconcileSpeech(),
    withdrawBeat: speech.withdrawBeat,
    dropBriefings: speech.dropBriefings,
    requestOnboardingBeat: () => void speech.requestOnboardingBeat(),
  });
  speech.link({
    brainCurrent: () => brain.wiring.current() !== undefined,
    releaseHeld: (briefings) => brain.wiring.releaseHeld(briefings),
  });

  const composers: readonly Composer[] = [
    settings,
    account,
    devices,
    issues,
    observation,
    calendars,
    speech,
    brain,
  ];
  const supervisor = new ObservationSupervisor([observation.loop, issues.loop, calendars.loop]);

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
    void speech.requestOnboardingBeat();
    settings.reconcileProviderKeyVault();
  }

  async function stopAccountCapabilities(): Promise<void> {
    supervisor.setEnabled(false);
    await devices.release(undefined);
    observation.stopObservation();
    issues.stopObservation();
    calendars.stopObservation();
    speech.withdrawBeat(ARRIVAL_SPEECH_KIND);
    speech.withdrawBeat(CALENDAR_ONBOARDING_SPEECH_KIND);
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
        conversationLines: carried(brain.store.thread().entries()),
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
        receiverEpoch: speech.receiver.epoch(),
        voiceAvailable: account.voiceCapabilities.realtimeCredentials !== undefined,
        agentTraceEnabled: account.agentTrace !== undefined,
      });
    },
  };

  const service = createGatewayService({
    brain: {
      current: (sessionKey) => brain.wiring.current(sessionKey),
      agentForRun: (runId) => brain.wiring.agentForRun(runId),
      conversationForRun: (runId) => brain.wiring.conversationForRun(runId),
      allRequests: () => brain.wiring.allRequests(),
      generationId: (sessionKey) => brain.wiring.store(sessionKey).generationId(),
      holdsGeneration: (generationId) => brain.wiring.holdsGeneration(generationId),
      publicationSettled: () => brain.wiring.publicationSettled(),
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
    deliveries: brain.deliveries,
    receiver: speech.receiver,
    nodes: kernel.nodes,
    recordConversationEntry: (entry, recordedAt, sessionKey) =>
      brain.store.recordConversationEntry(entry, recordedAt, sessionKey),
    now,
    createId: kernel.createId,
    methods: { ...mergeMethods(composers), ...bootstrapMethods },
    // A client whose connection closed can reach no renderer: its receiver
    // epoch ends here as its window going away would, so replies and
    // briefings wait for the next epoch rather than being offered into a gap.
    onOperatorDisconnected: () => speech.receiver.reset(),
  });
  kernel.setService(service);

  // The order the launch has to keep: the account is read before anything
  // gated on it, the store is open before the brain's credential transition
  // installs a runtime over it, and the loops are armed only once every
  // owner of one has started.
  const startOrder: readonly Composer[] = [
    settings,
    account,
    devices,
    brain,
    calendars,
    observation,
    speech,
    issues,
  ];

  const start = async (): Promise<void> => {
    for (const composer of startOrder) await composer.start();
    if (account.signedIn()) void settings.reconcileAccountPreferences();
    void devices.register();
    await account.applyVoiceCredential();
    observation.startObservation();
    calendars.startObservation();
    supervisor.setEnabled(true);
    if (account.signedIn()) settings.reconcileProviderKeyVault();
    void speech.requestOnboardingBeat();
    void account.session.refreshOnce();
  };

  /**
   * The explicit quit's steps. Admissions close at the server; every run and
   * child under way is cancelled; the followers' publication is let finish,
   * so an end already reached stands in Conversation; and what did not settle is
   * counted rather than finished: the store's load at the next start marks
   * an unsettled run interrupted and replays nothing.
   */
  const shutdownSteps: GatewayShutdownSteps = shutdownStepsFlushingEvents(
    {
      closeAdmissions: () => service.server.closeAdmissions(),
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

  const close = async (): Promise<void> => {
    supervisor.setEnabled(false);
    // Every concern gives back what it began, in the reverse of the order it
    // began in; one that cannot must not strand the store's close.
    for (const composer of [...startOrder].reverse()) {
      await composer.stop().catch((error: Error) => {
        report(`a composer did not stop cleanly: ${error.message}`);
      });
    }
  };

  const stop = async (shutdown: GatewayShutdownOptions = {}): Promise<void> => {
    // A drain that cannot finish still says so and still closes the store:
    // what it could not settle is what the next launch marks interrupted, and
    // a quit must leave either way rather than on an unhandled failure.
    try {
      const outcome = await shutdownGateway(shutdownSteps, shutdown);
      report(
        `shutting down: ${outcome.settled ? "settled" : "unsettled"}, ${outcome.cancelled.length} cancelled, ${outcome.unresolved} unresolved`,
      );
    } catch (error) {
      report(`the drain did not finish: ${error instanceof Error ? error.message : String(error)}`);
    }
    const closed = close().catch((error: Error) => {
      report(`the runtime did not close cleanly: ${error.message}`);
    });
    const closedInTime = await Promise.race([
      closed.then(() => true),
      new Promise<false>((resolve) => {
        setTimeout(() => resolve(false), HOST_CLOSE_WAIT_MS);
      }),
    ]);
    if (!closedInTime) report("the runtime did not close in time; leaving it to the exit");
  };

  return { server: service.server, start, stop };
}
