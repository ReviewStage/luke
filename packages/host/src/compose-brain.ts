import fs from "node:fs/promises";
import { type BrainDelivery, workspaceProjectContextText } from "@sidecar/brain";
import type { BrainAppActionRequest } from "@sidecar/brain/requests-wire";
import {
  carried,
  GATEWAY_METHOD,
  type GatewayMethodTable,
  invalid,
  NODE_CAPABILITY_STATUS,
} from "@sidecar/gateway";
import {
  type AppGuideSnapshot,
  appGuideContextText,
  EMPTY_APP_GUIDE,
  isAppGuideSnapshot,
} from "@sidecar/guide";
import { CREDENTIAL_REFERENCE_KIND } from "@sidecar/runtime";
import {
  CONVERSATION_KIND,
  conversationKindOf,
  DEFAULT_AGENT_ID,
  MAIN_SESSION_KEY,
  MEMORY_SCOPE_KIND,
  type SessionKey,
} from "@sidecar/runtime/vocabulary";
import {
  ACTION_RESULT_STATUS,
  isRecord,
  UNKNOWN_ACTION_STATUS,
  type WireRecord,
} from "@sidecar/wire";
import { Cause, Effect, type Scope } from "effect";
import { wireBrain } from "./brain/wiring.js";
import type { AccountComposer } from "./compose-account.js";
import type { ObservationComposer } from "./compose-observation.js";
import type { Composer } from "./composer.js";
import { conversationOperations } from "./conversation-operations.js";
import { startedAndStopped } from "./effect/composer.js";
import { HostKernelTag } from "./effect/kernel.js";
import { type HeldConversations, wireHeldConversations } from "./held-conversations.js";
import { wireMemoryDefinitions } from "./memory-definition.js";
import { wireMemoryMaintenance } from "./memory-maintenance.js";
import { HOST_NODE_CAPABILITY } from "./node-capabilities.js";
import { removeRetiredStore } from "./retired-store.js";

type BrainWiring = Effect.Effect.Success<ReturnType<typeof wireBrain>>;

export interface BrainComposer extends Composer {
  readonly wiring: BrainWiring;
  /** The conversations this run holds for the local brain, in memory alone. */
  readonly conversations: HeldConversations;
  readonly operations: ReturnType<typeof conversationOperations>;
}

export interface BrainDependencies {
  account: AccountComposer;
  observation: ObservationComposer;
  /** Where a briefing goes, and where a generation's end drops the ones not yet said; the merge routes both to the live session. */
  announcements: {
    deliverBriefing: (delivery: BrainDelivery) => void | Promise<void>;
    dropBriefings: () => void;
  };
}

export const composeBrain = (
  dependencies: BrainDependencies,
): Effect.Effect<BrainComposer, never, HostKernelTag | Scope.Scope> =>
  Effect.gen(function* () {
    const { account, observation, announcements } = dependencies;
    const kernel = yield* HostKernelTag;
    // The runtime every run of the tool loop is a fiber of: the host's own,
    // so a turn and the host that cancels it stand on one runtime rather
    // than on a second one built where the work lives.
    const execution = yield* Effect.runtime<never>();
    const { runMode, report, now, createId } = kernel;

    /**
     * The conversations the local brain holds, in memory and for this run
     * alone: the directory and each conversation's envelope, gone at the next
     * launch. No lines are held here: the Conversation is the service's.
     */
    const conversations = wireHeldConversations({ now });
    let appGuide: AppGuideSnapshot = EMPTY_APP_GUIDE;

    const memoryMaintenance = wireMemoryMaintenance({
      createRuntime: () => wiring.createRuntime(),
      workspaceDirectory: kernel.agentWorkspacePath,
      isTemporary: conversations.isTemporary,
      now,
      createId,
      report,
    });

    /**
     * The notebook as every conversation's memory provider, bound to this
     * Mac's one account: the one agent's workspace is its notebook, so the
     * agent's id is the scope's key.
     */
    const memoryDefinitions = wireMemoryDefinitions({
      scope: { kind: MEMORY_SCOPE_KIND.ACCOUNT, key: DEFAULT_AGENT_ID },
      maintenance: memoryMaintenance,
      workspaceDirectory: kernel.agentWorkspacePath,
      now,
    });

    /**
     * What a conversation is handed beside the roster, by which conversation it
     * is. The recent exchange is no longer rendered here: the Conversation is
     * the service's record since E5-3, and the hosted brain reads it as
     * messages; the remembered facts reach every conversation recalled by the
     * memory provider rather than rendered here. The app guide and the
     * projects a workspace could be created in belong to the conversations the
     * developer actually holds; an observed session's conversation and a child's brief
     * one session or one task, and would pay for both on every call and every
     * iteration of their tool loops.
     */
    function standingContext(sessionKey: SessionKey): string {
      const kind = conversationKindOf(sessionKey);
      const developerHeld = kind === CONVERSATION_KIND.MAIN || kind === CONVERSATION_KIND.THREAD;
      const defaults = observation.heldWorkspaceDefaults();
      return [
        ...(developerHeld
          ? [
              workspaceProjectContextText(
                observation.workspaceProjects(),
                defaults.defaultProviderId,
                defaults.defaultProjectIds,
              ),
            ]
          : []),
        ...(developerHeld ? [appGuideContextText(appGuide)] : []),
      ]
        .filter((part): part is string => part !== undefined && part.trim().length > 0)
        .join("\n\n");
    }

    /**
     * Carries an app act only a renderer can perform to the native node, as the
     * validated action itself, serialized: the node hands it to the panel and
     * answers what became of it. No node connected, or one that answers in a
     * shape this build cannot read, is a refusal, and the action is left undone.
     */
    function performAppAction(action: BrainAppActionRequest["action"]): Effect.Effect<WireRecord> {
      return Effect.map(
        kernel.nodes.invoke(HOST_NODE_CAPABILITY.PANEL_APP_ACTION, { action: carried(action) }),
        (result) => {
          if (result.status === NODE_CAPABILITY_STATUS.OK && isRecord(result.value))
            return result.value;
          if (result.status === NODE_CAPABILITY_STATUS.UNKNOWN) {
            return { status: UNKNOWN_ACTION_STATUS, reason: result.reason };
          }
          return {
            status: ACTION_RESULT_STATUS.REJECTED,
            reason:
              result.status === NODE_CAPABILITY_STATUS.OK
                ? "The panel answered in a shape this build cannot read."
                : result.reason,
          };
        },
      );
    }

    const wiring = yield* wireBrain({
      execution,
      repositoryFor: (sessionKey) => conversations.brainStateRepository(sessionKey),
      ensureObservedConversation: async (sessionKey, name) => {
        await conversations.ensureConversation(sessionKey, CONVERSATION_KIND.OBSERVED, name);
      },
      ensureChildConversation: async (sessionKey, name) => {
        await conversations.ensureConversation(sessionKey, CONVERSATION_KIND.CHILD, name);
      },
      archiveConversation: (sessionKey) => conversations.archive(sessionKey),
      conversationDirectory: () => conversations.directory(),
      childStore: () => conversations.childStore(),
      createId,
      report,
      ...(account.agentTrace
        ? {
            traceTurn: (record) => account.agentTrace?.recordBrainTurn(record),
            tracePrefetch: (record) => account.agentTrace?.recordBrainPrefetch(record),
          }
        : undefined),
      // The followers' reports reach no client: the desktop stopped drawing
      // the runs and the service carries no runs event (LUKE-206). The
      // followers still mark each run's end, which is what they are for.
      broadcastRequests: () => undefined,
      onGenerationReplaced: (sessionKey) => {
        if (sessionKey === MAIN_SESSION_KEY) announcements.dropBriefings();
      },
      actions: {
        sessionActions: observation.sessionActions,
        sessions: observation.actableSessions,
        // The pass admission asks for before a session action is the loop's
        // own effect, waited on by the fiber the action is admitted on.
        refreshSessions: () => observation.loop.refresh,
        workspaceProjects: observation.workspaceProjects,
        workspaceDefaults: observation.workspaceDefaults,
        appGuide: () => appGuide,
        // This Mac keeps no remembered facts: the notebook and its index
        // stood in the SQLite store the desktop no longer opens, and the
        // remembered facts are the hosted brain's. The local brain's two
        // notebook writes are refused, so nothing is "remembered" here that
        // the next launch would not know.
        rememberedFacts: () => [],
        notebook: {
          remember: () => Promise.resolve(false),
          forget: () => Promise.resolve(false),
        },
        performAppAction: (action) => performAppAction(action),
      },
      roster: observation.roster,
      standingContext,
      transcripts: observation.transcripts,
      session: observation.session,
      deliver: announcements.deliverBriefing,
      model: () => account.voiceCapabilities.brainModel,
      prefetchModel: () => account.voiceCapabilities.prefetchModel,
      // The one credential a brain on this Mac runs on: the signed-in
      // account, through Luke's hosted service. A key of the developer's own
      // is nothing the brain reaches.
      credential: () => ({ kind: CREDENTIAL_REFERENCE_KIND.HOSTED_ACCOUNT }),
      workspaceDirectory: kernel.agentWorkspacePath,
      skillRoots: () => [kernel.agentSkillsPath()],
      runnable: () =>
        runMode.observesProviders && runMode.sendsNetwork && account.capabilitiesActive(),
      dropBriefings: announcements.dropBriefings,
      memory: memoryDefinitions,
      flushMarker: (sessionKey) => memoryMaintenance.flushMarkerFor(sessionKey),
    });

    const operations = conversationOperations({
      conversations,
      brain: wiring,
      now,
      report,
    });

    const methods: GatewayMethodTable = {
      [GATEWAY_METHOD.GUIDE_REPORT]: (params) => {
        const guide = params.guide;
        if (!isAppGuideSnapshot(guide)) return invalid("guide is not the shape a panel reports");
        appGuide = guide;
        return Effect.succeed({});
      },
    };

    return {
      methods,
      wiring,
      conversations,
      operations,
      // A live launch first removes the SQLite store an earlier build left
      // under the agent's directory, then seeds the workspace's missing files,
      // never rewriting one; a removal or a seed that fails is reported and
      // stops nothing else. A fixture or capture run keeps nothing on disk and
      // touches neither.
      lifetime: startedAndStopped(
        Effect.gen(function* () {
          if (!runMode.observesProviders) return;
          yield* Effect.promise(() =>
            removeRetiredStore({
              agentRoot: kernel.agentRootPath(),
              remove: (target) => fs.rm(target, { recursive: true, force: true }),
              report,
            }),
          );
          yield* Effect.catchAllCause(wiring.seedWorkspace(), (cause) => {
            const failure = Cause.squash(cause);
            return Effect.sync(() => {
              report(
                `Brain workspace could not be seeded: ${failure instanceof Error ? failure.message : String(failure)}`,
              );
            });
          });
          yield* Effect.promise(() => wiring.store().load());
        }),
        wiring.retire(),
      ),
    };
  });
