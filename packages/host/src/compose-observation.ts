import path from "node:path";
import {
  PRODUCT_DIAGNOSTIC_KIND,
  PRODUCT_EVENT,
  PRODUCT_SUPERSET_ACTION,
  type ProductDiagnosticKind,
  productSessionCountBucket,
} from "@sidecar/analytics";
import type { BrainRoster } from "@sidecar/brain";
import { sessionContextText } from "@sidecar/brain";
import {
  carried,
  GATEWAY_EVENT,
  GATEWAY_METHOD,
  type GatewayMethodTable,
  gatewayOk,
  invalid,
} from "@sidecar/gateway";
import {
  HostedActionClient,
  HostedRosterClient,
  HostedSessionMessagesClient,
} from "@sidecar/hosted";
import {
  ADAPTER_DIAGNOSTIC_KIND,
  type AdapterDiagnosticKind,
  ObservationHookRegistry,
  type ProviderRegistration,
  providerRegistrations,
  SUPERSET_SIGN_IN_STAGE,
  SupersetSignIn,
  supersetPlugin,
  supersetPressedLink,
  type WorkspaceHostEnrichment,
} from "@sidecar/providers";
import { ObservationLoop } from "@sidecar/runtime";
import {
  type CloudAgentProviderId,
  CreatedWorkspaceOpenTracker,
  isProviderId,
  isSessionApplicationId,
  normalizeObservedWorkspaceProjects,
  type ObservedWorkspaceProject,
  PROVIDER_ID_LIST,
  type ProviderId,
  rosterRelevantSessions,
  type Session,
  type SessionIdentity,
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
import { hostedTranscriptReads, type SessionTranscriptReads } from "./brain/hosted-transcripts.js";
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
import { drawSnapshotProjects, drawSnapshotRoster } from "./snapshot-roster.js";

/**
 * How often the stored snapshot is drawn again: the cadence the service's
 * own scheduled pass refreshes it at, so a faster tick would read the same
 * roster twice and a slower one would show a chat's move a tick late.
 */
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

/** What observation reaches in the brain: the look the pass ends with. */
interface ObservationLinks {
  rosterLook: () => void;
}

export interface ObservationComposer extends Composer {
  /** The loop the merge's supervisor enables; the composer never enables it itself. */
  readonly loop: ObservationLoop;
  readonly sessionActions: SessionActionPerformer;
  readonly supersetCli: ReturnType<typeof supersetPlugin>["cli"];
  /** The brain's transcript reads, each through the service's documented read of the session's conversation. */
  readonly transcripts: SessionTranscriptReads;
  session: (identity: SessionIdentity) => Session | undefined;
  observedSessionCount: () => number;
  /** The roster a client draws: the sessions still worth a row, the same gate every broadcast passes. */
  rosterForClients: () => readonly Session[];
  rosterSettled: () => boolean;
  offeredWorkspaceProjects: () => readonly ObservedWorkspaceProject[];
  workspaceProjectOffered: (providerId: string, providerProjectId: string) => boolean;
  broadcastWorkspaceProjects: () => Promise<void>;
  readSupersetWorkspaceHost: () => Promise<WorkspaceHostEnrichment>;
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
  const rosterClient = new HostedRosterClient({
    serviceBaseUrl: kernel.hostedServiceBaseUrl,
    ...account.token,
  });
  const actionClient = new HostedActionClient({
    serviceBaseUrl: kernel.hostedServiceBaseUrl,
    ...account.token,
  });
  const messagesClient = new HostedSessionMessagesClient({
    serviceBaseUrl: kernel.hostedServiceBaseUrl,
    ...account.token,
  });
  const supersetHomeDirectory =
    options.environment.SUPERSET_HOME_DIR ?? path.join(options.homeDirectory, ".superset");
  const superset = supersetPlugin({ homeDirectory: supersetHomeDirectory });
  const supersetCli = superset.cli;
  // The hook spool and every provider script live under the explicit state
  // root, the same directory Luke always kept them in; nothing registers a
  // hook or watches the spool any more, and the plugins here observe nothing
  // and answer no read: they stand only for the slices the stop empties.
  const observationHooks = new ObservationHookRegistry(() => kernel.stateRoot);
  const providerRegistry = providerRegistrations({
    readApiKey: (providerId) => settingsStore.readApiKey(providerId),
    observationHookInstallation: (providerId) => observationHooks.installation(providerId),
    onDiagnostic: reportAdapterDiagnostic,
  });
  const orderedRegistrations: readonly ProviderRegistration[] = PROVIDER_ID_LIST.map(
    (providerId) => providerRegistry[providerId],
  );

  const createdWorkspaceOpens = new CreatedWorkspaceOpenTracker();
  let unsubscribeSessions: (() => void) | undefined;
  let lastWorkspaceProjects: string | undefined;
  /** Where a workspace can be created, as the service's snapshot last listed it. */
  let heldWorkspaceProjects: readonly ObservedWorkspaceProject[] = [];
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

  function workspaceProjectOffered(providerId: string, providerProjectId: string): boolean {
    return heldWorkspaceProjects.some(
      (project) =>
        project.providerId === providerId &&
        workspaceProjectSelectionId(project) === providerProjectId,
    );
  }

  // The one list every offer of a project reads: the settings rows, the
  // bootstrap, and the brain's admission all see what the service's stored
  // snapshot lists for the account's keys, which is what a creation is
  // admitted against there.
  function offeredWorkspaceProjects(): readonly ObservedWorkspaceProject[] {
    return runMode.observesProviders ? heldWorkspaceProjects : [];
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
    providerId: CloudAgentProviderId,
    providerProjectId: string,
    namedSelection: WorkspaceAgentSelection | undefined,
  ): Promise<void> {
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
        (await settingsStore.get(APP_SETTING_SCHEMA.workspaceProjectDefaults.field))?.[
          providerId
        ] === undefined
      ) {
        const saved = await settingsStore.setEntry(
          APP_SETTING_SCHEMA.workspaceProjectDefaults.field,
          providerId,
          workspaceProjectSelectionId({ providerProjectId }),
        );
        settings.emitSettingsSnapshot(saved.settings);
        accountPreferencesTouched = true;
      }
      if (
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
    actions: actionClient,
    refreshSessions: () => loop.refresh(),
    sendsNetwork: runMode.sendsNetwork,
    settingsStore,
    rememberWorkspaceDefaults,
    expectCreatedWorkspace: (identity, at) => createdWorkspaceOpens.expect(identity, at),
    openCreatedWorkspaces: () => openCreatedWorkspaces(sessionRegistry.list()),
    trackedIssues: () => issues.issues(),
    issueTrackers: issues.trackers,
    refreshIssues: () => issues.refresh(),
    recordProductEvent: settings.recordProductEvent,
  });

  const transcripts = hostedTranscriptReads({
    client: messagesClient,
    session: (identity) => sessionRegistry.get(identity),
  });

  // A row's own send or press is admitted where its roster is: the service
  // admits it against the stored snapshot the row was drawn from, the same
  // observation and not a second one read here, so a control the provider
  // withdrew since the last pass is refused there rather than carried on the
  // row's stale picture of it.
  const rowActions = createSessionRowActions({
    drawn: actableSessions,
    client: actionClient,
    refresh: () => loop.refresh(),
    recordProductEvent: settings.recordProductEvent,
  });

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

  const loop = new ObservationLoop({
    gate: observationGate,
    intervalMs: SESSION_REFRESH_INTERVAL_MS,
    // The projects are drawn before the roster, so the broadcast the roster's
    // commit fires already reads the list the same pass listed.
    run: async (generation) => {
      const isCurrent = () => loop.isCurrent(generation);
      const projects = await drawSnapshotProjects({ client: rosterClient, isCurrent, report });
      if (projects) heldWorkspaceProjects = projects;
      await drawSnapshotRoster({
        client: rosterClient,
        registry: sessionRegistry,
        isCurrent,
        report,
      });
    },
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
    heldWorkspaceProjects = [];
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
    transcripts,
    session: (identity) => sessionRegistry.get(identity),
    observedSessionCount: () => actableSessions().length,
    rosterForClients,
    rosterSettled: () => !runMode.observesProviders || rosterBroadcast,
    offeredWorkspaceProjects,
    workspaceProjectOffered,
    broadcastWorkspaceProjects,
    readSupersetWorkspaceHost,
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
    start: async () => undefined,
    stop: async () => {
      unsubscribeSessions?.();
      unsubscribeSessions = undefined;
      supersetSignIn.shutdown();
    },
  };
}
