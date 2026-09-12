import { PRODUCT_EVENT, productSessionCountBucket } from "@sidecar/analytics";
import type { BrainRoster } from "@sidecar/brain";
import { sessionContextText } from "@sidecar/brain";
import {
  carried,
  GATEWAY_EVENT,
  GATEWAY_METHOD,
  type GatewayMethodTable,
  invalid,
} from "@sidecar/gateway";
import {
  HostedActionClient,
  HostedRosterClient,
  HostedSessionMessagesClient,
} from "@sidecar/hosted";
import { ObservationLoop } from "@sidecar/runtime";
import { cadenceHome } from "@sidecar/runtime/effect";
import {
  CLOUD_AGENT_PROVIDER_ID,
  type CloudAgentProviderId,
  CreatedWorkspaceOpenTracker,
  isProviderId,
  isSessionApplicationId,
  normalizeObservedWorkspaceProjects,
  type ObservedWorkspaceProject,
  PROVIDER_IDENTITY_BY_ID,
  rosterRelevantSessions,
  type Session,
  type SessionIdentity,
  SessionRoster,
  staleWorkspaceProjectDefaults,
  type WorkspaceAgentSelection,
  workspaceProjectSelectionId,
} from "@sidecar/session";
import { APP_SETTING_SCHEMA } from "@sidecar/settings";
import { isRecord, isWireString, type UnparsedWireValue, type WireRecord } from "@sidecar/wire";
import { Effect, Option, type Scope } from "effect";
import type { WorkspaceCreationDefaults } from "./brain/action-performer.js";
import { hostedTranscriptReads, type SessionTranscriptReads } from "./brain/hosted-transcripts.js";
import type { AccountComposer } from "./compose-account.js";
import type { SettingsComposer } from "./compose-settings.js";
import type { Composer } from "./composer.js";
import { HostKernelTag, lateService } from "./effect/kernel.js";
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
  /** The brain's transcript reads, each through the service's documented read of the session's conversation. */
  readonly transcripts: SessionTranscriptReads;
  session: (identity: SessionIdentity) => Session | undefined;
  observedSessionCount: () => number;
  /** The roster a client draws: the sessions still worth a row, the same gate every broadcast passes. */
  rosterForClients: () => readonly Session[];
  /**
   * Told every time the drawn roster is broadcast, with the same sessions the
   * broadcast carried. It is the one way a concern that draws nothing — the
   * voice session, which is seeded with a summary of the desk — learns that
   * the desk moved without polling for it.
   */
  onRosterChange: (listener: (sessions: readonly Session[]) => void) => void;
  rosterSettled: () => boolean;
  offeredWorkspaceProjects: () => readonly ObservedWorkspaceProject[];
  workspaceProjectOffered: (providerId: string, providerProjectId: string) => boolean;
  broadcastWorkspaceProjects: () => Promise<void>;
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
  settings: SettingsComposer;
  account: AccountComposer;
  observationGate: () => boolean;
}

/**
 * The observation concern, over the kernel it takes as a tag rather than as a
 * constructor argument; its sibling concerns stay plain arguments because the
 * cycles between them forbid a tag on either side.
 */
export const composeObservation = (
  dependencies: ObservationDependencies,
): Effect.Effect<ObservationComposer, never, HostKernelTag | Scope.Scope> =>
  Effect.gen(function* () {
    const { settings, account, observationGate } = dependencies;
    const kernel = yield* HostKernelTag;
    const home = yield* cadenceHome;
    const { runMode, report, now } = kernel;
    const settingsStore = settings.store;
    const late = yield* lateService<ObservationLinks>();
    const links = (): ObservationLinks => {
      const standing = late.unsafePeek();
      if (Option.isNone(standing)) {
        throw new Error("the observation composer's links are read before link() has run");
      }
      return standing.value;
    };

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
    const createdWorkspaceOpens = new CreatedWorkspaceOpenTracker();
    let unsubscribeSessions: (() => void) | undefined;
    let lastWorkspaceProjects: string | undefined;
    /** Where a workspace can be created, as the service's snapshot last listed it. */
    let heldWorkspaceProjects: readonly ObservedWorkspaceProject[] = [];
    let workspaceProjectsBroadcastGeneration = 0;
    let rosterBroadcast = false;
    const rosterListeners: ((sessions: readonly Session[]) => void)[] = [];
    let brainWorkspaceDefaults: WorkspaceCreationDefaults = {};

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
          (await settingsStore.get(APP_SETTING_SCHEMA.workspaceAgentDefaults.field))?.[
            providerId
          ] === undefined
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
        kernel.openExternalThroughNode(link).catch((error: Error) => {
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

    const loop = new ObservationLoop({
      gate: observationGate,
      home,
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
        links().rosterLook();
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
      const drawn = relevantSessions(sessions);
      kernel.emit(GATEWAY_EVENT.SESSIONS_CHANGED, { sessions: carried(drawn), settled: true });
      for (const listener of rosterListeners) listener(drawn);
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
      if (!runMode.observesProviders || !account.capabilitiesActive() || unsubscribeSessions)
        return;
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
      // The snapshot fills the roster one cloud provider at a time, so the stop
      // empties it the same way.
      for (const id of Object.values(CLOUD_AGENT_PROVIDER_ID)) {
        sessionRegistry.replaceProvider(PROVIDER_IDENTITY_BY_ID[id], []);
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
        Effect.sync(() => ({
          sessions: carried(rosterForClients()),
          settled: !runMode.observesProviders || rosterBroadcast,
        })),
      [GATEWAY_METHOD.SESSION_OPEN]: (params) => {
        const identity = params.identity;
        if (!isSessionIdentity(identity)) return invalid("identity must name a session");
        return Effect.map(
          Effect.promise(() => sessionActions.openSession(identity)),
          (answer) => carried(answer),
        );
      },
      [GATEWAY_METHOD.SESSION_OPEN_APPLICATION]: (params) => {
        const identity = params.identity;
        const applicationId = params.applicationId;
        if (!isSessionIdentity(identity)) return invalid("identity must name a session");
        if (!isWireString(applicationId) || !isSessionApplicationId(applicationId)) {
          return invalid("applicationId is not one this build knows");
        }
        return Effect.map(
          Effect.promise(() => sessionActions.openSessionApplication(identity, applicationId)),
          (answer) => carried(answer),
        );
      },
      [GATEWAY_METHOD.SESSION_OPEN_CHANGE]: (params) => {
        const identity = params.identity;
        if (!isSessionIdentity(identity)) return invalid("identity must name a session");
        return Effect.map(
          Effect.promise(() => sessionActions.openSessionChange(identity)),
          (answer) => carried(answer),
        );
      },
      [GATEWAY_METHOD.SESSION_SEND_MESSAGE]: (params) => {
        const identity = params.identity;
        const text = params.text;
        if (!isSessionIdentity(identity)) return invalid("identity must name a session");
        if (!isWireString(text)) return invalid("text must be a string");
        return Effect.map(
          Effect.promise(() => rowActions.sendMessage(identity, text)),
          (answer) => carried(answer),
        );
      },
      [GATEWAY_METHOD.SESSION_EXECUTE_CONTROL]: (params) => {
        const identity = params.identity;
        const controlId = params.controlId;
        if (!isSessionIdentity(identity)) return invalid("identity must name a session");
        if (!isWireString(controlId)) return invalid("controlId must be a string");
        return Effect.map(
          Effect.promise(() => rowActions.executeControl(identity, controlId)),
          (answer) => carried(answer),
        );
      },
      [GATEWAY_METHOD.WORKSPACE_PROJECTS]: () =>
        Effect.gen(function* () {
          if (!account.capabilitiesActive()) return { projects: carried([]) };
          const defaults = yield* Effect.promise(() =>
            settingsStore.get(APP_SETTING_SCHEMA.workspaceProjectDefaults.field),
          );
          return {
            projects: carried(
              normalizeObservedWorkspaceProjects(offeredWorkspaceProjects(), defaults),
            ),
          };
        }),
    };

    return {
      methods,
      loop,
      sessionActions,
      transcripts,
      session: (identity) => sessionRegistry.get(identity),
      observedSessionCount: () => actableSessions().length,
      rosterForClients,
      onRosterChange: (listener) => {
        rosterListeners.push(listener);
      },
      rosterSettled: () => !runMode.observesProviders || rosterBroadcast,
      offeredWorkspaceProjects,
      workspaceProjectOffered,
      broadcastWorkspaceProjects,
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
      link: (next) => {
        late.unsafeSet(next);
      },
      start: async () => undefined,
      stop: async () => {
        unsubscribeSessions?.();
        unsubscribeSessions = undefined;
      },
    };
  });
