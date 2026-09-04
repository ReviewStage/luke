import { randomUUID } from "node:crypto";
import { type RememberedFact, rememberedFactsText } from "@sidecar/acts";
import {
  BrainAgent,
  type BrainClient,
  type BrainDelivery,
  type BrainPersistedState,
  type BrainTurnTraceRecord,
  type BrainWakeEvent,
} from "@sidecar/brain";
import { type AppGuideSnapshot, appGuideContextText, EMPTY_APP_GUIDE } from "@sidecar/guide";
import type { TrackedIssue } from "@sidecar/issues";
import type { ProviderRegistration } from "@sidecar/providers";
import { SpoolWatcher } from "@sidecar/providers";
import {
  type ConversationEntry,
  conversationHistoryText,
  recentConversationEntries,
  sessionContextText,
  workspaceProjectContextText,
} from "@sidecar/realtime";
import {
  normalizeObservedWorkspaceProjects,
  type ObservedWorkspaceProject,
  SESSION_LOCATION,
  type Session,
  type SessionIdentity,
  type SessionProviderAdapter,
} from "@sidecar/session";
import { APP_SETTING_SCHEMA, type AppSettingField, type AppSettingValue } from "@sidecar/settings";
import { ACT_RESULT_STATUS, type WireRecord } from "@sidecar/wire";
import type { BrowserWindow } from "electron";
import { channels } from "#shared/bridge";
import type { BrainAppActRequest, BriefingPayload } from "#shared/contracts";
import { brainStateFromStored, brainStateRecord, wakeEventsFromHooks } from "./brain-flow";
import { createBrainActPerformer, type WorkspaceCreationDefaults } from "./ipc/brain-acts";
import type { SessionActPerformer } from "./ipc/session-acts";

/**
 * Everything in the main process that stands around the brain: the agent
 * itself, built on the client the credential policy hands over and torn down
 * with it; the spool watchers whose hooks ride the next roster look; the app
 * guide the renderer reports and the app acts it is asked to carry; the
 * briefings held through a meeting or a pause; and the developer's saved
 * creation tie-breaks the standing context narrates. Nothing here detects a
 * change for the brain — no status edge, no notice — because the brain
 * notices changes itself, against its own memory.
 *
 * The brain runs only on the developer's own OpenAI key in this build: with
 * no key there is no brain, nothing is announced, and an ask is answered with
 * the honest refusal. Never in a fixture or capture run, which observes
 * nothing and sends nothing, and never past a closed account gate.
 */

/**
 * How many briefings wait through a meeting or a pause. The brain re-decides
 * the whole backlog in one turn at the release, so what it needs is the recent
 * few, not every word decided since the quiet began.
 */
const MAXIMUM_HELD_BRIEFINGS = 8;

/** A renderer answers an app act within this, or the act is refused on the clock. */
const APP_ACT_TIMEOUT_MS = 10_000;

export interface BrainHostDependencies {
  sessionRegistry: {
    list(): readonly Session[];
    get(identity: SessionIdentity): Session | undefined;
  };
  adapterFor: (providerId: string) => SessionProviderAdapter | undefined;
  orderedRegistrations: readonly ProviderRegistration[];
  sessionActs: SessionActPerformer;
  /** A fresh observation pass, whose `afterRun` is what hands the brain its look. */
  refreshSessions: () => Promise<void>;
  voiceHost: () => BrowserWindow | undefined;
  settings: {
    get<Field extends AppSettingField>(field: Field): Promise<AppSettingValue<Field>>;
  };
  observesProviders: boolean;
  sendsNetwork: boolean;
  accountCapabilitiesActive: () => boolean;
  announcementsQuietNow: (now: number) => Promise<boolean>;
  brainClient: () => BrainClient | undefined;
  voiceAvailable: () => boolean;
  conversationHistory: () => readonly ConversationEntry[];
  recordConversationEntry: (entry: ConversationEntry) => void;
  rememberedFacts: () => readonly RememberedFact[];
  writeRememberedFacts: (facts: readonly RememberedFact[]) => boolean;
  trackedIssues: () => readonly TrackedIssue[] | undefined;
  offeredWorkspaceProjects: () => readonly ObservedWorkspaceProject[];
  traceTurn?: (record: BrainTurnTraceRecord) => void;
  /** Counts a briefing handed to the voice and settles the first-announcement beat. */
  briefingSpoken: () => void;
  statePath: () => string;
  readStoredState: (at: string) => string | undefined;
  writeStoredState: (at: string, contents: string, what: string) => boolean;
  removeStoredState: (at: string, what: string) => boolean;
}

export interface BrainHost {
  brain(): BrainAgent | undefined;
  /** Stands the brain up on the client the policy built, or down when it built none. */
  rebuild(): Promise<void>;
  watchSpools(): void;
  /** The roster look, with the hooks that landed since the last one riding along. */
  afterObservationPass(): void;
  /** Hands the held briefings back for one re-decision once the hold has ended. */
  releaseHeld(): Promise<void>;
  dropHeld(): void;
  /** Forgets the brain's memory of the agents, file and all, with the History it stood beside. */
  clearMemory(): Promise<void>;
  reportAppGuide(snapshot: AppGuideSnapshot): void;
  answerAppAct(requestId: string, answer: WireRecord): void;
  readWorkspaceDefaults(): Promise<WorkspaceCreationDefaults>;
  setWorkspaceDefaults(defaults: WorkspaceCreationDefaults): void;
  shutdown(): void;
}

export function createBrainHost(deps: BrainHostDependencies): BrainHost {
  let brain: BrainAgent | undefined;
  let spoolWatchers: readonly SpoolWatcher<string>[] = [];
  /** Hooks that landed since the last look, handed to the next one. */
  let pendingHooks: BrainWakeEvent[] = [];
  /** Briefings decided while announcements were held; the release is a re-decision, never a replay. */
  let held: BrainDelivery[] = [];
  /**
   * The guide as the renderer last reported it: what an app act is validated
   * against here, and what the brain reads as the app's description of itself.
   */
  let appGuide: AppGuideSnapshot = EMPTY_APP_GUIDE;
  const pendingAppActs = new Map<string, (answer: WireRecord) => void>();
  /**
   * The saved creation tie-breaks, cached beside the projects broadcast so the
   * standing context — rendered synchronously each turn — reads what the
   * broadcast last read.
   */
  let workspaceDefaults: WorkspaceCreationDefaults = {};

  /**
   * The roster as the brain is shown it and validates every act against: the
   * sessions still worth a row, less Luke's own voice, rendered with the same
   * bounded fields the panel draws and the identities a tool call names.
   */
  function roster() {
    const sessions = deps.sessionRegistry
      .list()
      .filter((session) => session.realtimeVoice !== true);
    return {
      text: sessionContextText(sessions, Date.now()),
      identities: sessions.map(
        ({ providerId, providerSessionId }): SessionIdentity => ({ providerId, providerSessionId }),
      ),
      sessions,
    };
  }

  function workspaceProjects(): readonly ObservedWorkspaceProject[] {
    return normalizeObservedWorkspaceProjects(
      deps.offeredWorkspaceProjects(),
      workspaceDefaults.defaultProjectIds,
    );
  }

  /**
   * Everything the brain is handed beside the roster, rebuilt every turn and
   * remembered nowhere: where a workspace can be created and the saved
   * tie-breaks, the durable facts about the developer, the recent conversation
   * rendered against the roster as both now stand, and the app guide.
   */
  function standingContext(): string {
    const { sessions } = roster();
    return [
      workspaceProjectContextText(
        workspaceProjects(),
        workspaceDefaults.defaultProviderId,
        workspaceDefaults.defaultProjectIds,
      ),
      rememberedFactsText(deps.rememberedFacts()),
      conversationHistoryText(recentConversationEntries(deps.conversationHistory()), sessions),
      appGuideContextText(appGuide),
    ]
      .filter((part): part is string => part !== undefined && part.trim().length > 0)
      .join("\n\n");
  }

  /**
   * Carries an app act only a renderer can perform — a settings change, the
   * panel shown, the feedback composer, the Updates row's button — to the
   * voice host, already validated against the guide it reported, and waits
   * for its answer. A panel that does not answer within the round trip
   * refuses the act on a clock rather than holding the brain's turn open.
   */
  function performAppAct(action: BrainAppActRequest["action"]): Promise<WireRecord> {
    const host = deps.voiceHost();
    if (!host) {
      return Promise.resolve({
        status: ACT_RESULT_STATUS.REJECTED,
        reason: "No panel is open to carry that.",
      });
    }
    const requestId = randomUUID();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pendingAppActs.delete(requestId);
        resolve({
          status: ACT_RESULT_STATUS.REJECTED,
          reason: "The panel did not answer in time.",
        });
      }, APP_ACT_TIMEOUT_MS);
      pendingAppActs.set(requestId, (answer) => {
        clearTimeout(timer);
        pendingAppActs.delete(requestId);
        resolve(answer);
      });
      const request: BrainAppActRequest = { requestId, action };
      host.webContents.send(channels.onBrainAppAct, request);
    });
  }

  /**
   * Hands one briefing the brain decided to the voice, or holds it while a
   * meeting or the pause stands. Voice gone means nothing to say it with, and
   * by the time a key returns the news is the panel's.
   */
  async function deliverBriefing(delivery: BrainDelivery): Promise<void> {
    if (!deps.voiceAvailable()) return;
    if (await deps.announcementsQuietNow(Date.now())) {
      held = [...held, delivery].slice(-MAXIMUM_HELD_BRIEFINGS);
      return;
    }
    const host = deps.voiceHost();
    if (!host) return;
    const payload: BriefingPayload = { briefing: delivery.briefing, decidedAt: delivery.decidedAt };
    deps.briefingSpoken();
    host.webContents.send(channels.onBriefing, payload);
  }

  async function readWorkspaceDefaults(): Promise<WorkspaceCreationDefaults> {
    const [defaultProviderId, defaultProjectIds] = await Promise.all([
      deps.settings.get(APP_SETTING_SCHEMA.defaultWorkspaceProvider.field),
      deps.settings.get(APP_SETTING_SCHEMA.workspaceProjectDefaults.field),
    ]);
    return {
      ...(defaultProviderId ? { defaultProviderId } : undefined),
      ...(defaultProjectIds ? { defaultProjectIds } : undefined),
    };
  }

  /**
   * The gauntlet every act the brain asks for runs, in this process: validated
   * against the roster, the issue board, the offered projects, the guide, or
   * the remembered facts as each stands at the moment of the act, then carried
   * by the session performer. The validators are the guard; the brain itself
   * is offered an act only in a turn the developer opened.
   */
  const acts = createBrainActPerformer({
    sessionActs: deps.sessionActs,
    sessions: () => roster().sessions,
    // A fresh pass before every session act keeps validation against the
    // observed roster current. At 60s intervals the registry could otherwise
    // be almost a minute stale when the act's validation and perform run.
    refreshSessions: deps.refreshSessions,
    workspaceProjects,
    workspaceDefaults: readWorkspaceDefaults,
    trackedIssues: deps.trackedIssues,
    appGuide: () => appGuide,
    rememberedFacts: deps.rememberedFacts,
    writeRememberedFacts: deps.writeRememberedFacts,
    performAppAct,
    recordConversationEntry: deps.recordConversationEntry,
  });

  async function rebuild(): Promise<void> {
    const previous = brain;
    brain = undefined;
    if (previous) await previous.stop();
    const client = deps.brainClient();
    if (
      !client ||
      !deps.observesProviders ||
      !deps.sendsNetwork ||
      !deps.accountCapabilitiesActive()
    ) {
      held = [];
      return;
    }
    brain = new BrainAgent({
      client,
      acts,
      roster,
      standingContext,
      readTranscriptSince: (identity, cursor) => {
        const adapter = deps.adapterFor(identity.providerId);
        if (!adapter) {
          return Promise.resolve({
            status: ACT_RESULT_STATUS.UNSUPPORTED,
            reason: "That session's provider is not connected.",
          });
        }
        return adapter.readTranscriptSince(identity.providerSessionId, cursor);
      },
      readTranscript: (identity) => {
        const session = deps.sessionRegistry.get(identity);
        const adapter = deps.adapterFor(identity.providerId);
        if (!session || !adapter) {
          return Promise.resolve({
            status: ACT_RESULT_STATUS.REJECTED,
            reason: "No observed session matches that identity.",
          });
        }
        if (session.location !== SESSION_LOCATION.LOCAL) {
          return Promise.resolve({
            status: ACT_RESULT_STATUS.UNSUPPORTED,
            reason: "A cloud session's conversation lives with its provider, not on this machine.",
          });
        }
        return adapter.readTranscript(identity.providerSessionId);
      },
      deliver: deliverBriefing,
      persist: (state: BrainPersistedState) => {
        deps.writeStoredState(
          deps.statePath(),
          brainStateRecord(state),
          "Luke's memory of the agents",
        );
      },
      restore: () => brainStateFromStored(deps.readStoredState(deps.statePath())),
      ...(deps.traceTurn ? { trace: deps.traceTurn } : undefined),
      report: (message) => process.stderr.write(`${message}\n`),
    });
  }

  /**
   * Stands one watcher on each hooked provider's spool. A batch of hooks asks
   * for a pass, and the look that follows the pass carries them, so a hook
   * reaches the brain with the session as it now stands rather than a whole
   * cadence later. The poll stays for the panel and for the providers no hook
   * covers; a watcher on a spool that does not exist yet retries on its own
   * clock.
   */
  function watchSpools(): void {
    if (spoolWatchers.length > 0) return;
    spoolWatchers = deps.orderedRegistrations.flatMap(({ adapter, observationSpool }) => {
      if (!observationSpool) return [];
      const providerId = adapter.provider.id;
      return [
        new SpoolWatcher({
          spoolDirectory: observationSpool.directory(),
          events: observationSpool.events,
          onEvents: (events) => {
            pendingHooks.push(...wakeEventsFromHooks(providerId, events, Date.now()));
            void deps.refreshSessions().catch(() => undefined);
          },
        }),
      ];
    });
  }

  /**
   * Hands the briefings held through a meeting or a pause back to the brain
   * once the hold has ended, for one re-decision against the roster as it now
   * stands: a session that moved on while the meeting ran is no longer news,
   * and the brain, not a replay, is what knows.
   */
  async function releaseHeld(): Promise<void> {
    if (held.length === 0) return;
    if (await deps.announcementsQuietNow(Date.now())) return;
    const released = held;
    held = [];
    if (!brain || !deps.voiceAvailable()) return;
    brain.releaseHeld(released);
  }

  return {
    brain: () => brain,
    rebuild,
    watchSpools,
    afterObservationPass: () => {
      brain?.rosterLook(pendingHooks.splice(0));
    },
    releaseHeld,
    dropHeld: () => {
      held = [];
    },
    clearMemory: async () => {
      deps.removeStoredState(deps.statePath(), "Luke's memory of the agents");
      await rebuild();
    },
    reportAppGuide: (snapshot) => {
      appGuide = snapshot;
    },
    answerAppAct: (requestId, answer) => {
      pendingAppActs.get(requestId)?.(answer);
    },
    readWorkspaceDefaults,
    setWorkspaceDefaults: (defaults) => {
      workspaceDefaults = defaults;
    },
    shutdown: () => {
      for (const watcher of spoolWatchers) watcher.close();
      spoolWatchers = [];
      pendingHooks = [];
      void brain?.stop();
    },
  };
}
