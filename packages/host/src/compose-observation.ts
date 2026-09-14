import { PRODUCT_EVENT, productSessionCountBucket } from "@sidecar/analytics";
import {
  carried,
  GATEWAY_EVENT,
  GATEWAY_METHOD,
  type GatewayMethodTable,
  invalid,
} from "@sidecar/gateway";
import { HostedActionClient, HostedRosterClient } from "@sidecar/hosted";
import { ObservationLoop } from "@sidecar/runtime";
import {
  CLOUD_AGENT_PROVIDER_ID,
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
  workspaceProjectSelectionId,
} from "@sidecar/session";
import { APP_SETTING_SCHEMA } from "@sidecar/settings";
import { isRecord, isWireString, type UnparsedWireValue, type WireRecord } from "@sidecar/wire";
import { Effect, Result, type Scope } from "effect";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import type { AccountComposer } from "./compose-account.js";
import type { SettingsComposer } from "./compose-settings.js";
import type { Composer } from "./composer.js";
import { HostKernelTag } from "./effect/kernel.js";
import { createSessionOpens, type SessionOpens } from "./session-opens.js";
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

export interface ObservationComposer extends Composer {
  /** The loop the merge's supervisor enables; the composer never enables it itself. */
  readonly loop: ObservationLoop;
  readonly sessionOpens: SessionOpens;
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
  /**
   * Told the roster or the settings moved; yielded on whichever fiber asked,
   * the loop's own pass after it draws the roster or the settings write that
   * changed a default.
   */
  broadcastWorkspaceProjects: Effect.Effect<void>;
  startObservation: () => void;
  stopObservation: () => void;
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
export const composeObservation = /* @__PURE__ */ Effect.fn("composeObservation")(function* (
  dependencies: ObservationDependencies,
): Effect.fn.Return<ObservationComposer, never, HostKernelTag | Scope.Scope> {
  const { settings, account, observationGate } = dependencies;
  const kernel = yield* HostKernelTag;
  const { runMode, report, now } = kernel;

  const sessionRegistry = new SessionRoster();
  const rosterClient = new HostedRosterClient({
    serviceBaseUrl: kernel.hostedServiceBaseUrl,
    ...account.token,
  });
  const actionClient = new HostedActionClient({
    serviceBaseUrl: kernel.hostedServiceBaseUrl,
    ...account.token,
  });
  /**
   * The redraw a landed write earns. A row's press settles on its own
   * fiber, so the poke is a fork from there rather than a run: the write's
   * answer goes back the moment the pass is started.
   */
  const pokeRefresh = Effect.asVoid(Effect.forkDetach(Effect.suspend(() => loop.refresh)));

  let unsubscribeSessions: (() => void) | undefined;
  let lastWorkspaceProjects: string | undefined;
  /** Where a workspace can be created, as the service's snapshot last listed it. */
  let heldWorkspaceProjects: readonly ObservedWorkspaceProject[] = [];
  let workspaceProjectsBroadcastGeneration = 0;
  let rosterBroadcast = false;
  const rosterListeners: ((sessions: readonly Session[]) => void)[] = [];

  function workspaceProjectOffered(providerId: string, providerProjectId: string): boolean {
    return heldWorkspaceProjects.some(
      (project) =>
        project.providerId === providerId &&
        workspaceProjectSelectionId(project) === providerProjectId,
    );
  }

  // The one list every offer of a project reads: the settings rows and the
  // bootstrap both see what the service's stored snapshot lists for the
  // account's keys, which is what a creation is admitted against there.
  function offeredWorkspaceProjects(): readonly ObservedWorkspaceProject[] {
    return runMode.observesProviders ? heldWorkspaceProjects : [];
  }

  const pruneWorkspaceProjectDefaultsEffect = /* @__PURE__ */ Effect.fnUntraced(function* (
    projects: readonly ObservedWorkspaceProject[],
    defaults: Readonly<Partial<Record<string, string>>> | undefined,
    isCurrent: () => boolean,
  ): Effect.fn.Return<void> {
    if (account.signedIn()) return;
    for (const providerId of staleWorkspaceProjectDefaults(projects, defaults)) {
      if (!isCurrent()) return;
      const expected = defaults?.[providerId];
      if (expected === undefined) continue;
      const outcome = yield* Effect.result(
        settings.store.clearEntryIfUnchanged(
          APP_SETTING_SCHEMA.workspaceProjectDefaults.field,
          providerId,
          expected,
        ),
      );
      if (Result.isFailure(outcome)) return;
      const saved = outcome.success;
      if (!saved.cleared) continue;
      if (!isCurrent()) return;
      settings.emitSettingsSnapshot(saved.settings);
    }
  });

  const broadcastWorkspaceProjects: Effect.Effect<void> = Effect.gen(function* () {
    const generation = ++workspaceProjectsBroadcastGeneration;
    const offeredProjects = offeredWorkspaceProjects();
    const defaults = yield* Effect.orDie(
      settings.store.get(APP_SETTING_SCHEMA.workspaceProjectDefaults.field),
    );
    if (generation !== workspaceProjectsBroadcastGeneration) return;
    yield* pruneWorkspaceProjectDefaultsEffect(
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
  });

  const sessionOpens = createSessionOpens({
    sessionRegistry,
    openExternal: (url, kind) => kernel.openExternalThroughNode(url, kind),
    recordProductEvent: settings.recordProductEvent,
  });

  // A row's own send or press is admitted where its roster is: the service
  // admits it against the stored snapshot the row was drawn from, the same
  // observation and not a second one read here, so a control the provider
  // withdrew since the last pass is refused there rather than carried on the
  // row's stale picture of it.
  const rowActions = createSessionRowActions({
    drawn: actableSessions,
    client: actionClient,
    refresh: pokeRefresh,
    recordProductEvent: settings.recordProductEvent,
  });

  const loop = new ObservationLoop({
    gate: observationGate,
    intervalMs: SESSION_REFRESH_INTERVAL_MS,
    // The projects are drawn before the roster, so the broadcast the roster's
    // commit fires already reads the list the same pass listed.
    run: (generation) =>
      Effect.provide(
        Effect.gen(function* () {
          const isCurrent = () => loop.isCurrent(generation);
          const projects = yield* drawSnapshotProjects({
            client: rosterClient,
            isCurrent,
            report,
          });
          if (projects) heldWorkspaceProjects = projects;
          yield* drawSnapshotRoster({
            client: rosterClient,
            registry: sessionRegistry,
            isCurrent,
            report,
          });
          // The roster's own subscriber only broadcasts sessions; the
          // projects broadcast the same pass earns is yielded here, on the
          // pass's own fiber, rather than forked from that plain callback.
          // Gated the same way `drawSnapshotRoster` gates its own write, so
          // a pass a newer one superseded broadcasts nothing stale.
          if (isCurrent()) yield* broadcastWorkspaceProjects;
        }),
        FetchHttpClient.layer,
      ),
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
    emitSessions(relevantSessions(sessions));
  }

  /**
   * The one place the drawn roster leaves this composer, so every reader of
   * it sees the same desk: the panel over the event, and the concerns that
   * draw nothing over the listeners. The stop's empty roster travels here
   * too — a voice session outlives the account gate closing, and one left
   * holding the last desk it was told would keep offering agents that are
   * no longer observed.
   */
  function emitSessions(drawn: readonly Session[]): void {
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
    if (!runMode.observesProviders || !account.capabilitiesActive() || unsubscribeSessions) return;
    unsubscribeSessions = sessionRegistry.subscribe((sessions) => {
      broadcastSessions(sessions);
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
    emitSessions([]);
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
      return Effect.map(sessionOpens.openSession(identity), (answer) => carried(answer));
    },
    [GATEWAY_METHOD.SESSION_OPEN_APPLICATION]: (params) => {
      const identity = params.identity;
      const applicationId = params.applicationId;
      if (!isSessionIdentity(identity)) return invalid("identity must name a session");
      if (!isWireString(applicationId) || !isSessionApplicationId(applicationId)) {
        return invalid("applicationId is not one this build knows");
      }
      return Effect.map(sessionOpens.openSessionApplication(identity, applicationId), (answer) =>
        carried(answer),
      );
    },
    [GATEWAY_METHOD.SESSION_OPEN_CHANGE]: (params) => {
      const identity = params.identity;
      if (!isSessionIdentity(identity)) return invalid("identity must name a session");
      return Effect.map(sessionOpens.openSessionChange(identity), (answer) => carried(answer));
    },
    [GATEWAY_METHOD.SESSION_SEND_MESSAGE]: (params) => {
      const identity = params.identity;
      const text = params.text;
      if (!isSessionIdentity(identity)) return invalid("identity must name a session");
      if (!isWireString(text)) return invalid("text must be a string");
      return Effect.map(rowActions.sendMessage(identity, text), (answer) => carried(answer));
    },
    [GATEWAY_METHOD.SESSION_EXECUTE_CONTROL]: (params) => {
      const identity = params.identity;
      const controlId = params.controlId;
      if (!isSessionIdentity(identity)) return invalid("identity must name a session");
      if (!isWireString(controlId)) return invalid("controlId must be a string");
      return Effect.map(rowActions.executeControl(identity, controlId), (answer) =>
        carried(answer),
      );
    },
    [GATEWAY_METHOD.WORKSPACE_PROJECTS]: () =>
      Effect.gen(function* () {
        if (!account.capabilitiesActive()) return { projects: carried([]) };
        const defaults = yield* Effect.orDie(
          settings.store.get(APP_SETTING_SCHEMA.workspaceProjectDefaults.field),
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
    sessionOpens,
    rosterForClients,
    onRosterChange: (listener) => {
      rosterListeners.push(listener);
    },
    rosterSettled: () => !runMode.observesProviders || rosterBroadcast,
    offeredWorkspaceProjects,
    workspaceProjectOffered,
    broadcastWorkspaceProjects,
    startObservation,
    stopObservation,
    lifetime: Effect.addFinalizer(() =>
      Effect.sync(() => {
        unsubscribeSessions?.();
        unsubscribeSessions = undefined;
      }),
    ),
  };
});
