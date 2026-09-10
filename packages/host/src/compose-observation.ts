import path from "node:path";
import {
  PRODUCT_DIAGNOSTIC_KIND,
  PRODUCT_EVENT,
  PRODUCT_SUPERSET_ACTION,
  type ProductDiagnosticKind,
  productSessionCountBucket,
} from "@sidecar/analytics";
import type { BrainRoster, BrainWakeEvent } from "@sidecar/brain";
import { sessionContextText } from "@sidecar/brain";
import type { CredentialProviderId } from "@sidecar/credentials";
import {
  carried,
  GATEWAY_EVENT,
  GATEWAY_METHOD,
  type GatewayMethodTable,
  gatewayOk,
  invalid,
} from "@sidecar/gateway";
import {
  ADAPTER_DIAGNOSTIC_KIND,
  type AdapterDiagnosticKind,
  claudeDesktopApplications,
  conductorApplications,
  conductorLocalWorkspacePlugin,
  ObservationHookRegistry,
  type ObservationSpoolWatcher,
  type ProviderRegistration,
  providerRegistrations,
  SUPERSET_SIGN_IN_STAGE,
  SupersetSignIn,
  supersetPlugin,
  supersetPressedLink,
  type WorkspaceHostEnrichment,
  type WorkspaceHostRegistration,
  watchObservationSpool,
  workspaceHostRegistrations,
} from "@sidecar/providers";
import { ObservationLoop } from "@sidecar/runtime";
import {
  CONDUCTOR_LOCAL_WORKSPACE_PROVIDER_ID,
  CreatedWorkspaceOpenTracker,
  isProviderId,
  isSessionApplicationId,
  isWorkspaceProviderId,
  normalizeObservedWorkspaceProjects,
  type ObservedWorkspaceProject,
  PROVIDER_ID_LIST,
  type ProviderId,
  rosterRelevantSessions,
  type Session,
  type SessionIdentity,
  type SessionProviderPlugin,
  SessionRoster,
  SUPERSET_WORKSPACE_PROVIDER_ID,
  staleWorkspaceProjectDefaults,
  type WorkspaceAgentSelection,
  workspaceProjectSelectionId,
} from "@sidecar/session";
import { APP_SETTING_SCHEMA } from "@sidecar/settings";
import {
  ACTION_RESULT_STATUS,
  isRecord,
  isWireString,
  lateRef,
  type UnparsedWireValue,
  type WireRecord,
} from "@sidecar/wire";
import type { WorkspaceCreationDefaults } from "./brain/action-performer.js";
import { wakeEventsFromHooks } from "./brain/wiring.js";
import type { AccountComposer } from "./compose-account.js";
import type { IssuesComposer } from "./compose-issues.js";
import type { SettingsComposer } from "./compose-settings.js";
import type { Composer } from "./composer.js";
import type { HostKernel } from "./host-kernel.js";
import {
  createSessionActionPerformer,
  type SessionActionPerformer,
} from "./session-action-performer.js";
import { createSessionRowActions } from "./session-row-actions.js";

const SESSION_REFRESH_INTERVAL_MS = 60_000;

const DIAGNOSTIC_COUNTED_AS = {
  [ADAPTER_DIAGNOSTIC_KIND.PASS_FAILURE]: PRODUCT_DIAGNOSTIC_KIND.PASS_FAILURE,
  [ADAPTER_DIAGNOSTIC_KIND.ACCIDENTAL_WAKE]: PRODUCT_DIAGNOSTIC_KIND.ACCIDENTAL_WAKE,
} satisfies Record<AdapterDiagnosticKind, ProductDiagnosticKind>;

function isSessionIdentity(value: UnparsedWireValue): value is SessionIdentity & WireRecord {
  return (
    isRecord(value) &&
    isWireString(value.providerId) &&
    isWireString(value.providerSessionId) &&
    value.providerSessionId.length > 0
  );
}

/** What observation reaches in the brain: a hook's wake, and the look the pass ends with. */
interface ObservationLinks {
  wake: (events: readonly BrainWakeEvent[]) => void;
  rosterLook: () => void;
  /** The roster the clients draw moved; the live session is told the same view once it settles. */
  rosterChanged: () => void;
}

export interface ObservationComposer extends Composer {
  /** The loop the merge's supervisor enables; the composer never enables it itself. */
  readonly loop: ObservationLoop;
  readonly sessionActions: SessionActionPerformer;
  readonly supersetCli: ReturnType<typeof supersetPlugin>["cli"];
  pluginFor: (providerId: string) => SessionProviderPlugin | undefined;
  session: (identity: SessionIdentity) => Session | undefined;
  observedSessionCount: () => number;
  /** The roster a client draws: the sessions still worth a row, the same gate every broadcast passes. */
  rosterForClients: () => readonly Session[];
  rosterSettled: () => boolean;
  offeredWorkspaceProjects: () => readonly ObservedWorkspaceProject[];
  workspaceProjectOffered: (providerId: string, providerProjectId: string) => boolean;
  broadcastWorkspaceProjects: () => Promise<void>;
  readSupersetWorkspaceHost: () => Promise<WorkspaceHostEnrichment>;
  refreshCredentialAdapter: (providerId: CredentialProviderId) => void;
  /** The sessions an action may name: the drawn roster less the voice's own. */
  actableSessions: () => readonly Session[];
  roster: () => BrainRoster;
  workspaceProjects: () => readonly ObservedWorkspaceProject[];
  workspaceDefaults: () => Promise<WorkspaceCreationDefaults>;
  heldWorkspaceDefaults: () => WorkspaceCreationDefaults;
  startObservation: () => void;
  stopObservation: () => void;
  link: (links: ObservationLinks) => void;
}

export interface ObservationDependencies {
  kernel: HostKernel;
  settings: SettingsComposer;
  account: AccountComposer;
  issues: IssuesComposer;
  observationGate: () => boolean;
}

export function composeObservation(dependencies: ObservationDependencies): ObservationComposer {
  const { kernel, settings, account, issues, observationGate } = dependencies;
  const { runMode, report, now, options } = kernel;
  const settingsStore = settings.store;
  const links = lateRef<ObservationLinks>("the observation composer's links");

  function reportAdapterDiagnostic(
    providerId: ProviderId,
    kind: AdapterDiagnosticKind,
    error: Error,
  ): void {
    report(`Observation diagnostic (${providerId}, ${kind}): ${error.message}`);
    const counted = DIAGNOSTIC_COUNTED_AS[kind];
    if (!counted) return;
    settings.recordProductEvent(PRODUCT_EVENT.SESSION_DIAGNOSTIC, {
      provider_id: providerId,
      diagnostic_kind: counted,
    });
  }

  const sessionRegistry = new SessionRoster();
  const conductorSessionApplications = conductorApplications();
  const claudeDesktopSessionApplications = claudeDesktopApplications();
  // The local counterpart of the cloud Conductor adapter's creation path: it
  // reads the repositories Conductor holds and creates a workspace in one by
  // handing Conductor's own creation deep link to the operating system, through
  // the native node.
  const conductorLocalWorkspaces = conductorLocalWorkspacePlugin({
    openExternal: (url: string) => kernel.openExternalThroughNode(url),
  });
  const supersetHomeDirectory =
    options.environment.SUPERSET_HOME_DIR ?? path.join(options.homeDirectory, ".superset");
  const superset = supersetPlugin({ homeDirectory: supersetHomeDirectory });
  const supersetCli = superset.cli;
  const supersetWorkspaceHost: WorkspaceHostRegistration = {
    observationFailureLabel: "Superset observation",
    read: () => readSupersetWorkspaceHost(),
    emptyEnrichment: (_providerId, observations) => observations,
  };
  const workspaceHosts = workspaceHostRegistrations({
    superset: supersetWorkspaceHost,
    conductorApplications: conductorSessionApplications,
    claudeDesktopApplications: claudeDesktopSessionApplications,
  });
  // The hook spool and every provider script live under the explicit state
  // root, the same directory Luke always kept them in.
  const observationHooks = new ObservationHookRegistry(() => kernel.stateRoot);
  const providerRegistry = providerRegistrations({
    readApiKey: (providerId) => settingsStore.readApiKey(providerId),
    observationHookInstallation: (providerId) => observationHooks.installation(providerId),
    onDiagnostic: reportAdapterDiagnostic,
  });
  const orderedRegistrations: readonly ProviderRegistration[] = PROVIDER_ID_LIST.map(
    (providerId) => providerRegistry[providerId],
  );

  let spoolWatchers: readonly ObservationSpoolWatcher[] = [];
  const createdWorkspaceOpens = new CreatedWorkspaceOpenTracker();
  let unsubscribeSessions: (() => void) | undefined;
  let lastWorkspaceProjects: string | undefined;
  let workspaceProjectsBroadcastGeneration = 0;
  let rosterBroadcast = false;
  let brainWorkspaceDefaults: WorkspaceCreationDefaults = {};

  const supersetSignIn = new SupersetSignIn({
    cli: supersetCli,
    openExternal: (url) => kernel.openExternalThroughNode(url),
    onChange: (state) => {
      kernel.emit(GATEWAY_EVENT.SUPERSET_SIGN_IN_CHANGED, carried(state));
      if (state.stage !== SUPERSET_SIGN_IN_STAGE.CONNECTED) return;
      void loop.refresh();
      settings.recordProductEvent(PRODUCT_EVENT.SUPERSET_ACTION, {
        superset_action: PRODUCT_SUPERSET_ACTION.SIGN_IN_COMPLETE,
      });
    },
  });

  function pluginFor(providerId: string) {
    if (providerId === SUPERSET_WORKSPACE_PROVIDER_ID) return superset;
    if (providerId === CONDUCTOR_LOCAL_WORKSPACE_PROVIDER_ID) return conductorLocalWorkspaces;
    return isProviderId(providerId) ? providerRegistry[providerId].plugin : undefined;
  }

  function pluginForCredential(providerId: CredentialProviderId) {
    return orderedRegistrations.find((entry) => entry.credential?.id === providerId)?.plugin;
  }

  function workspaceProjectOffered(providerId: string, providerProjectId: string): boolean {
    const projects = pluginFor(providerId)?.projects?.() ?? [];
    return projects.some((project) => workspaceProjectSelectionId(project) === providerProjectId);
  }

  function offeredWorkspaceProjects(): readonly ObservedWorkspaceProject[] {
    if (!runMode.observesProviders) return [];
    return [
      ...orderedRegistrations.map(({ plugin }) => plugin),
      superset,
      conductorLocalWorkspaces,
    ].flatMap((plugin) =>
      (plugin.projects?.() ?? []).map((project) => ({
        ...project,
        providerId: plugin.provider.id,
        providerName: plugin.provider.displayName,
      })),
    );
  }

  async function readWorkspaceDefaults(): Promise<WorkspaceCreationDefaults> {
    const [defaultProviderId, defaultProjectIds] = await Promise.all([
      settingsStore.get(APP_SETTING_SCHEMA.defaultWorkspaceProvider.field),
      settingsStore.get(APP_SETTING_SCHEMA.workspaceProjectDefaults.field),
    ]);
    const defaults: WorkspaceCreationDefaults = {};
    if (defaultProviderId) defaults.defaultProviderId = defaultProviderId;
    if (defaultProjectIds) defaults.defaultProjectIds = defaultProjectIds;
    brainWorkspaceDefaults = defaults;
    return defaults;
  }

  function brainWorkspaceProjects(): readonly ObservedWorkspaceProject[] {
    return normalizeObservedWorkspaceProjects(
      offeredWorkspaceProjects(),
      brainWorkspaceDefaults.defaultProjectIds,
    );
  }

  async function pruneWorkspaceProjectDefaults(
    projects: readonly ObservedWorkspaceProject[],
    defaults: Readonly<Partial<Record<string, string>>> | undefined,
    isCurrent: () => boolean,
  ): Promise<void> {
    if (account.signedIn()) return;
    try {
      for (const providerId of staleWorkspaceProjectDefaults(projects, defaults)) {
        if (!isCurrent()) return;
        const expected = defaults?.[providerId];
        if (expected === undefined) continue;
        const saved = await settingsStore.clearEntryIfUnchanged(
          APP_SETTING_SCHEMA.workspaceProjectDefaults.field,
          providerId,
          expected,
        );
        if (!saved.cleared) continue;
        if (!isCurrent()) return;
        settings.emitSettingsSnapshot(saved.settings);
      }
    } catch {
      return;
    }
  }

  async function broadcastWorkspaceProjects(): Promise<void> {
    const generation = ++workspaceProjectsBroadcastGeneration;
    const offeredProjects = offeredWorkspaceProjects();
    const defaults = (await readWorkspaceDefaults()).defaultProjectIds;
    if (generation !== workspaceProjectsBroadcastGeneration) return;
    await pruneWorkspaceProjectDefaults(
      offeredProjects,
      defaults,
      () => generation === workspaceProjectsBroadcastGeneration,
    );
    if (generation !== workspaceProjectsBroadcastGeneration) return;
    const projects = normalizeObservedWorkspaceProjects(offeredProjects, defaults);
    const serialized = JSON.stringify(projects);
    if (serialized === lastWorkspaceProjects) return;
    lastWorkspaceProjects = serialized;
    kernel.emit(GATEWAY_EVENT.WORKSPACE_PROJECTS_CHANGED, { projects: carried(projects) });
  }

  async function rememberWorkspaceDefaults(
    plugin: SessionProviderPlugin,
    providerProjectId: string,
    providerTargetId: string | undefined,
    namedSelection: WorkspaceAgentSelection | undefined,
    agent: string | undefined,
  ): Promise<void> {
    const providerId = plugin.provider.id;
    if (!isWorkspaceProviderId(providerId)) return;
    try {
      let accountPreferencesTouched = false;
      if (
        (await settingsStore.get(APP_SETTING_SCHEMA.defaultWorkspaceProvider.field)) === undefined
      ) {
        const saved = await settingsStore.set(
          APP_SETTING_SCHEMA.defaultWorkspaceProvider.field,
          providerId,
        );
        settings.emitSettingsSnapshot(saved.settings);
        accountPreferencesTouched = true;
      }
      if (
        providerId === SUPERSET_WORKSPACE_PROVIDER_ID &&
        agent !== undefined &&
        (await settingsStore.get(APP_SETTING_SCHEMA.workspaceAgentDefaults.field))?.[
          SUPERSET_WORKSPACE_PROVIDER_ID
        ] === undefined
      ) {
        const saved = await settingsStore.setEntry(
          APP_SETTING_SCHEMA.workspaceAgentDefaults.field,
          SUPERSET_WORKSPACE_PROVIDER_ID,
          { agent },
        );
        settings.emitSettingsSnapshot(saved.settings);
        accountPreferencesTouched = true;
      }
      if (
        (await settingsStore.get(APP_SETTING_SCHEMA.workspaceProjectDefaults.field))?.[
          providerId
        ] === undefined
      ) {
        const saved = await settingsStore.setEntry(
          APP_SETTING_SCHEMA.workspaceProjectDefaults.field,
          providerId,
          workspaceProjectSelectionId(
            providerTargetId ? { providerProjectId, providerTargetId } : { providerProjectId },
          ),
        );
        settings.emitSettingsSnapshot(saved.settings);
        accountPreferencesTouched = true;
      }
      if (
        isProviderId(providerId) &&
        namedSelection !== undefined &&
        (await settingsStore.get(APP_SETTING_SCHEMA.workspaceAgentDefaults.field))?.[providerId] ===
          undefined
      ) {
        const saved = await settingsStore.setEntry(
          APP_SETTING_SCHEMA.workspaceAgentDefaults.field,
          providerId,
          namedSelection,
        );
        settings.emitSettingsSnapshot(saved.settings);
        accountPreferencesTouched = true;
      }
      if (accountPreferencesTouched) settings.pushAccountPreferences();
    } catch {
      // The reply is the creation's; a failed remember has no line in it.
    }
  }

  function openCreatedWorkspaces(sessions: readonly Session[]): void {
    for (const created of createdWorkspaceOpens.claim(sessions, now())) {
      const link = created.detail.link;
      if (!link) continue;
      kernel
        .openExternalThroughNode(supersetPressedLink(link, kernel.createId()))
        .catch((error: Error) => {
          report(`Created workspace could not be opened: ${error.message}`);
        });
    }
  }

  const sessionActions = createSessionActionPerformer({
    sessionRegistry,
    openExternal: (url, kind) => kernel.openExternalThroughNode(url, kind),
    pluginFor,
    sendsNetwork: runMode.sendsNetwork,
    settingsStore,
    rememberWorkspaceDefaults,
    expectCreatedWorkspace: (identity, at) => createdWorkspaceOpens.expect(identity, at),
    openCreatedWorkspaces: () => openCreatedWorkspaces(sessionRegistry.list()),
    trackedIssues: () => issues.issues(),
    issueTrackers: issues.trackers,
    refreshIssues: () => issues.refresh(),
    supersetContext: (identity) =>
      superset.actableContext(identity.providerId, identity.providerSessionId),
    supersetCli,
    recordProductEvent: settings.recordProductEvent,
  });

  // A row's own send or press is admitted here, in the host, against the same
  // roster the brain's actions are: a fresh pass first, then the sessions an
  // action may name, so a control the provider withdrew a moment ago is
  // refused rather than carried on the row's stale picture of it.
  const rowActions = createSessionRowActions({
    roster: {
      read: async () => {
        await loop.refresh();
        return actableSessions();
      },
    },
    performer: sessionActions,
  });

  async function applyLocalSessionHooks(): Promise<void> {
    if (!runMode.observesProviders || options.registerProviderHooks === false) return;
    await Promise.all(
      orderedRegistrations.map(async ({ plugin, registerObservationHook }) => {
        if (!registerObservationHook) return;
        try {
          await registerObservationHook();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          report(`${plugin.provider.displayName} hook registration failed: ${message}`);
        }
      }),
    );
    watchObservationSpools();
  }

  function watchObservationSpools(): void {
    if (spoolWatchers.length > 0) return;
    spoolWatchers = orderedRegistrations.flatMap(({ plugin, observationSpool }) => {
      if (!observationSpool) return [];
      const providerId = plugin.provider.id;
      return [
        watchObservationSpool({
          spoolDirectory: observationSpool.directory(),
          events: observationSpool.events,
          onEvents: (events) => {
            void (async () => {
              await loop.refresh().catch(() => undefined);
              links.get().wake(wakeEventsFromHooks(providerId, events, sessionRegistry, now()));
            })();
          },
        }),
      ];
    });
  }

  async function readSupersetWorkspaceHost(): Promise<WorkspaceHostEnrichment> {
    try {
      const agentDefault = (
        await settingsStore.get(APP_SETTING_SCHEMA.workspaceAgentDefaults.field)
      )?.[SUPERSET_WORKSPACE_PROVIDER_ID]?.agent;
      return await superset.refresh(agentDefault);
    } catch (error) {
      report(
        `Superset observation failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return superset.emptyEnrichment;
    }
  }

  async function refreshProviderSessions(generation: number): Promise<void> {
    const actionsWereEnabled = superset.activeOrganization() !== undefined;
    const conductorRepositoriesPromise = conductorLocalWorkspaces.refresh().catch((error) => {
      report(
        `Conductor repository observation failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
    const hostEnrichments = await Promise.all(
      workspaceHosts.map((host) =>
        host.read().catch((error) => {
          report(
            `${host.observationFailureLabel} failed: ${error instanceof Error ? error.message : String(error)}`,
          );
          return host.emptyEnrichment;
        }),
      ),
    );
    await conductorRepositoriesPromise;
    const supersetActionsEnabled = superset.activeOrganization() !== undefined;
    if (actionsWereEnabled !== supersetActionsEnabled) {
      if (supersetActionsEnabled) {
        kernel.emit(GATEWAY_EVENT.SUPERSET_SIGN_IN_CHANGED, {
          stage: SUPERSET_SIGN_IN_STAGE.CONNECTED,
          organizations: [],
        });
      } else {
        supersetSignIn.cancel();
      }
    }
    await Promise.all([
      ...orderedRegistrations.map(async ({ plugin }) => {
        try {
          await sessionRegistry.refresh(plugin, (providerId, observations) =>
            hostEnrichments.reduce(
              (enriched, enrichment) => enrichment(providerId, enriched),
              observations,
            ),
          );
        } catch (error) {
          report(
            `Session observation failed (${plugin.provider.id}): ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }),
      (async () => {
        try {
          await sessionRegistry.refresh(superset);
        } catch (error) {
          report(
            `Session observation failed (${superset.provider.id}): ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      })(),
    ]);
    if (!loop.isCurrent(generation)) return;
    void broadcastWorkspaceProjects();
  }

  const loop = new ObservationLoop({
    gate: observationGate,
    intervalMs: SESSION_REFRESH_INTERVAL_MS,
    run: refreshProviderSessions,
    afterRun: () => {
      links.get().rosterLook();
    },
  });

  /**
   * The roster keeps every observation whole, and the adapters age out and cap
   * nothing, so this one gate is where a session that settled long ago stops
   * being a row. Every client-facing read passes through it: the broadcast,
   * the bootstrap and roster method, and the sessions an action may name, so
   * the panel, the voice, and admission see one roster. The pass announces
   * every run whether or not anything moved, so a session that crosses its
   * horizon between observations leaves on the next broadcast.
   */
  function relevantSessions(sessions: readonly Session[]): readonly Session[] {
    return rosterRelevantSessions(sessions, now());
  }

  function broadcastSessions(sessions: readonly Session[]): void {
    rosterBroadcast = true;
    kernel.emit(GATEWAY_EVENT.SESSIONS_CHANGED, {
      sessions: carried(relevantSessions(sessions)),
      settled: true,
    });
  }

  function countObservedSessions(sessions: readonly Session[]): void {
    const counts = new Map<string, number>();
    for (const session of sessions) {
      counts.set(session.providerId, (counts.get(session.providerId) ?? 0) + 1);
    }
    for (const [providerId, count] of counts) {
      if (!isProviderId(providerId)) continue;
      settings.recordProductEventOncePerDay(PRODUCT_EVENT.SESSION_OBSERVE, providerId, {
        provider_id: providerId,
        session_count: productSessionCountBucket(count),
      });
    }
  }

  function startObservation(): void {
    if (!runMode.observesProviders || !account.capabilitiesActive() || unsubscribeSessions) return;
    unsubscribeSessions = sessionRegistry.subscribe((sessions) => {
      broadcastSessions(sessions);
      links.get().rosterChanged();
      openCreatedWorkspaces(sessions);
      void broadcastWorkspaceProjects();
      countObservedSessions(sessions);
    });
  }

  function stopObservation(): void {
    workspaceProjectsBroadcastGeneration += 1;
    unsubscribeSessions?.();
    unsubscribeSessions = undefined;
    for (const { plugin } of orderedRegistrations) {
      sessionRegistry.replaceProvider(plugin.provider, []);
    }
    kernel.emit(GATEWAY_EVENT.SESSIONS_CHANGED, { sessions: [], settled: true });
    kernel.emit(GATEWAY_EVENT.WORKSPACE_PROJECTS_CHANGED, { projects: [] });
    lastWorkspaceProjects = undefined;
  }

  function actableSessions(): readonly Session[] {
    return relevantSessions(sessionRegistry.list()).filter(
      (session) => session.realtimeVoice !== true,
    );
  }

  function rosterForClients(): readonly Session[] {
    return runMode.observesProviders && account.capabilitiesActive()
      ? relevantSessions(sessionRegistry.list())
      : [];
  }

  const methods: GatewayMethodTable = {
    [GATEWAY_METHOD.SESSION_ROSTER]: () =>
      gatewayOk({
        sessions: carried(rosterForClients()),
        settled: !runMode.observesProviders || rosterBroadcast,
      }),
    [GATEWAY_METHOD.SESSION_OPEN]: async (params) => {
      if (!isSessionIdentity(params.identity)) return invalid("identity must name a session");
      return gatewayOk(carried(await sessionActions.openSession(params.identity)));
    },
    [GATEWAY_METHOD.SESSION_OPEN_APPLICATION]: async (params) => {
      if (!isSessionIdentity(params.identity)) return invalid("identity must name a session");
      if (!isWireString(params.applicationId) || !isSessionApplicationId(params.applicationId)) {
        return invalid("applicationId is not one this build knows");
      }
      return gatewayOk(
        carried(await sessionActions.openSessionApplication(params.identity, params.applicationId)),
      );
    },
    [GATEWAY_METHOD.SESSION_OPEN_CHANGE]: async (params) => {
      if (!isSessionIdentity(params.identity)) return invalid("identity must name a session");
      return gatewayOk(carried(await sessionActions.openSessionChange(params.identity)));
    },
    [GATEWAY_METHOD.SESSION_SEND_MESSAGE]: async (params) => {
      if (!isSessionIdentity(params.identity)) return invalid("identity must name a session");
      if (!isWireString(params.text)) return invalid("text must be a string");
      return gatewayOk(carried(await rowActions.sendMessage(params.identity, params.text)));
    },
    [GATEWAY_METHOD.SESSION_EXECUTE_CONTROL]: async (params) => {
      if (!isSessionIdentity(params.identity)) return invalid("identity must name a session");
      if (!isWireString(params.controlId)) return invalid("controlId must be a string");
      return gatewayOk(carried(await rowActions.executeControl(params.identity, params.controlId)));
    },
    [GATEWAY_METHOD.WORKSPACE_PROJECTS]: async () =>
      gatewayOk({
        projects: carried(
          account.capabilitiesActive()
            ? normalizeObservedWorkspaceProjects(
                offeredWorkspaceProjects(),
                await settingsStore.get(APP_SETTING_SCHEMA.workspaceProjectDefaults.field),
              )
            : [],
        ),
      }),
    [GATEWAY_METHOD.SUPERSET_STATUS]: async () => {
      const [installed, connected] = await Promise.all([
        supersetCli.installed(),
        supersetCli.connected(),
      ]);
      return gatewayOk({ installed, connected });
    },
    [GATEWAY_METHOD.SUPERSET_BEGIN_SIGN_IN]: async () => {
      settings.recordProductEvent(PRODUCT_EVENT.SUPERSET_ACTION, {
        superset_action: PRODUCT_SUPERSET_ACTION.SIGN_IN_START,
      });
      return gatewayOk({ state: carried(await supersetSignIn.begin()) });
    },
    [GATEWAY_METHOD.SUPERSET_SUBMIT_CODE]: async (params) => {
      if (!isWireString(params.code)) return invalid("code must be a string");
      return gatewayOk({ state: carried(await supersetSignIn.submitCode(params.code)) });
    },
    [GATEWAY_METHOD.SUPERSET_CHOOSE_ORGANIZATION]: async (params) => {
      if (!isWireString(params.slug)) return invalid("slug must be a string");
      return gatewayOk({ state: carried(await supersetSignIn.chooseOrganization(params.slug)) });
    },
    [GATEWAY_METHOD.SUPERSET_REOPEN_SIGN_IN]: () => {
      supersetSignIn.reopen();
      return gatewayOk({});
    },
    [GATEWAY_METHOD.SUPERSET_CANCEL_SIGN_IN]: () => {
      supersetSignIn.cancel();
      settings.recordProductEvent(PRODUCT_EVENT.SUPERSET_ACTION, {
        superset_action: PRODUCT_SUPERSET_ACTION.SIGN_IN_CANCEL,
      });
      return gatewayOk({});
    },
    [GATEWAY_METHOD.SUPERSET_DISCONNECT]: async () => {
      if (!(await supersetCli.signOut())) {
        return gatewayOk({
          status: ACTION_RESULT_STATUS.REJECTED,
          reason: "Superset could not sign out.",
        });
      }
      supersetSignIn.cancel();
      void loop.refresh();
      settings.recordProductEvent(PRODUCT_EVENT.SUPERSET_ACTION, {
        superset_action: PRODUCT_SUPERSET_ACTION.DISCONNECT,
      });
      return gatewayOk({ status: ACTION_RESULT_STATUS.ACCEPTED });
    },
  };

  return {
    methods,
    loop,
    sessionActions,
    supersetCli,
    pluginFor,
    session: (identity) => sessionRegistry.get(identity),
    observedSessionCount: () => actableSessions().length,
    rosterForClients,
    rosterSettled: () => !runMode.observesProviders || rosterBroadcast,
    offeredWorkspaceProjects,
    workspaceProjectOffered,
    broadcastWorkspaceProjects,
    readSupersetWorkspaceHost,
    refreshCredentialAdapter: (providerId) => {
      const plugin = pluginForCredential(providerId);
      if (plugin) void sessionRegistry.refresh(plugin);
    },
    actableSessions,
    roster: () => {
      const at = now();
      const sessions = actableSessions();
      return {
        text: sessionContextText(sessions, at),
        identities: sessions.map((session) => ({
          providerId: session.providerId,
          providerSessionId: session.providerSessionId,
        })),
        sessions,
      };
    },
    workspaceProjects: brainWorkspaceProjects,
    workspaceDefaults: readWorkspaceDefaults,
    heldWorkspaceDefaults: () => brainWorkspaceDefaults,
    startObservation,
    stopObservation,
    link: (next) => links.set(next),
    start: async () => {
      void applyLocalSessionHooks().catch((error) => {
        report(
          `Local session hook registration failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    },
    stop: async () => {
      unsubscribeSessions?.();
      unsubscribeSessions = undefined;
      for (const watcher of spoolWatchers) watcher.close();
      spoolWatchers = [];
      supersetSignIn.shutdown();
    },
  };
}
