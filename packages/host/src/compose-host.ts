import {
  carried,
  GATEWAY_METHOD,
  type GatewayMethodTable,
  type GatewayShutdownSteps,
} from "@sidecar/gateway";
import {
  HostedPlanClient,
  type PlanActivityFrame,
  type PlanCodeFrame,
  type PlanDraftFrame,
} from "@sidecar/hosted";
import { LIVE_SESSION_END_CAUSE } from "@sidecar/voice/live-session";
import { Effect, Layer } from "effect";
import type * as FileSystem from "effect/FileSystem";
import type * as Path from "effect/Path";
import { renderBoardThroughNode } from "./board-looks.js";
import { composeAccount } from "./compose-account.js";
import { composeLive } from "./compose-live.js";
import { composePlanning, planFoldersFile } from "./compose-planning.js";
import { composeSettings } from "./compose-settings.js";
import type { Composer, DuplicateGatewayMethod } from "./composer.js";
import { mergedMethods } from "./effect/composer.js";
import { type HostAssembly, HostAssemblyTag, hostDrain } from "./effect/host.js";
import { HostKernelTag, HostService } from "./effect/kernel.js";
import {
  type AppIdentity,
  type Environment,
  Reporter,
  type SecretCipher,
  ShutdownSignal,
} from "./effect/seams.js";
import { shutdownStepsClosingLiveSession, shutdownStepsFlushingEvents } from "./lifecycle.js";
import { createGatewayService } from "./service.js";

/** The four concerns, by the name each is built under. */
export const HOST_CONCERN = {
  SETTINGS: "settings",
  ACCOUNT: "account",
  LIVE: "live",
  PLANNING: "planning",
} as const;

export type HostConcern = (typeof HOST_CONCERN)[keyof typeof HOST_CONCERN];

/**
 * The order the launch has to keep: the account is read before anything
 * gated on it. The quit is this order reversed.
 */
export const HOST_START_ORDER: readonly HostConcern[] = [
  HOST_CONCERN.SETTINGS,
  HOST_CONCERN.ACCOUNT,
  HOST_CONCERN.LIVE,
  HOST_CONCERN.PLANNING,
];

/**
 * Every concern constructed, linked, and merged, with nothing yet begun: the
 * composers in the launch's order, the arming that follows the last of them,
 * and the drain. A method two concerns claim fails this build, so which
 * concern answers a method is checked before anything starts.
 */
export const hostAssemblyLayer: Layer.Layer<
  HostAssemblyTag,
  DuplicateGatewayMethod,
  | HostKernelTag
  | HostService
  | Reporter
  | Environment
  | SecretCipher
  | AppIdentity
  | ShutdownSignal
  | FileSystem.FileSystem
  | Path.Path
> = Layer.effect(
  HostAssemblyTag,
  Effect.gen(function* () {
    const kernel = yield* HostKernelTag;
    const hostService = yield* HostService;
    const shutdownSignal = yield* ShutdownSignal;
    const { report } = yield* Reporter;

    const settings = yield* composeSettings();
    const account = yield* composeAccount({ settings });
    // No brain runs on this Mac: the exchange is the service's, and Luke
    // speaks only on a planning call the developer opened.
    // The planning composer is built after the live one and ends its calls, so
    // the live composer reads the open plan, and hands it the plan's drafts
    // and their activity, through these late bindings.
    let activePlanId: () => string | undefined = () => undefined;
    let showPlanDraft: (draft: PlanDraftFrame) => void = () => undefined;
    let showPlanActivity: (activity: PlanActivityFrame) => void = () => undefined;
    let planCallEnded: (planId: string) => void = () => undefined;
    let showPlanCode: (code: PlanCodeFrame) => void = () => undefined;
    const live = yield* composeLive({
      settings,
      account,
      activePlanId: () => activePlanId(),
      showPlanDraft: (draft) => showPlanDraft(draft),
      showPlanActivity: (activity) => showPlanActivity(activity),
      planCallEnded: (planId) => planCallEnded(planId),
      showPlanCode: (code) => showPlanCode(code),
    });
    const planning = yield* composePlanning({
      kernel,
      account,
      folders: planFoldersFile(() => kernel.stateRoot, report),
      endPlanCall: (keep) => live.service.endPlanCall(keep),
      renderBoard: renderBoardThroughNode(kernel.nodes),
      client: new HostedPlanClient({
        serviceBaseUrl: kernel.hostedServiceBaseUrl,
        ...account.token,
      }),
    });
    activePlanId = planning.activePlanId;
    showPlanDraft = planning.showDraft;
    showPlanActivity = planning.showActivity;
    planCallEnded = planning.callEnded;
    showPlanCode = (code) => planning.showCode(code.planId, code.ref);

    /**
     * The account gate opening, which is what a sign-in runs and what a launch
     * behind an account already signed in runs: the preferences reconciled and
     * the voice credential applied.
     */
    const openCapabilities = Effect.gen(function* () {
      if (account.signedIn()) yield* settings.reconcileAccountPreferences();
      yield* account.applyVoiceCredential;
      yield* settings.emitSettings();
    });

    /** The gate closing: what a sign-out means. */
    const closeCapabilities = Effect.gen(function* () {
      yield* planning.reset;
      yield* account.applyVoiceCredential;
      yield* settings.emitSettings();
    });

    // Every edge a composer could not take as a constructor argument, in one
    // list: each is a cycle the concerns genuinely have. The write is the
    // composer's own set-once, so a reader that awaits its links suspends
    // until this has run rather than reading nothing.
    yield* settings.link({
      refreshAccount: account.session.refreshOnce,
      setVoice: (voice) =>
        Effect.sync(() => account.voiceCapabilities.liveSessions?.setVoice(voice)),
      endLiveSession: Effect.suspend(() =>
        live.service.endSession(LIVE_SESSION_END_CAUSE.VOICE_CHANGED),
      ),
    });
    yield* account.link({
      startCapabilities: openCapabilities,
      stopCapabilities: closeCapabilities,
    });
    const concerns = {
      [HOST_CONCERN.SETTINGS]: settings,
      [HOST_CONCERN.ACCOUNT]: account,
      [HOST_CONCERN.LIVE]: live,
      [HOST_CONCERN.PLANNING]: planning,
    } satisfies Readonly<Record<HostConcern, Composer>>;

    /**
     * The one method no composer can own: it reads several of them at once,
     * so giving it to any would hand that composer references to the others,
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
          const replay = yield* account.sessionReplayState;
          return {
            settings: carried(snapshot),
            account: carried(account.snapshot()),
            sessionReplay: carried(replay),
            voiceAvailable: account.voiceCapabilities.liveSessions !== undefined,
            agentTraceEnabled: account.agentTrace !== undefined,
          };
        }),
    };

    const methods = yield* mergedMethods(Object.values(concerns));
    const service = createGatewayService({
      nodes: kernel.nodes,
      methods: { ...methods, ...bootstrapMethods },
    });
    yield* hostService.set(service);

    /**
     * The explicit quit's steps. The Gateway has no door to close, since the
     * one client is this process, so the step that closed it now only begins
     * the counted events' flush. No run of this Mac's own is under way to
     * cancel, settle, or count: every ask is the service's, so the drain
     * cancels nothing and counts nothing unresolved.
     */
    const drainSteps: GatewayShutdownSteps = yield* shutdownStepsFlushingEvents(
      {
        closeAdmissions: Effect.void,
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
      nodes: kernel.nodes,
      startOrder: HOST_START_ORDER.map((name) => concerns[name]),
      /**
       * The launch's own arming: where the account's capabilities already
       * stand open, the launch opens the gate exactly as a sign-in does.
       * Where they do not, the launch still applies the voice credential the
       * signed-out panel is drawn from, because it waits on no account.
       */
      armed: Effect.gen(function* () {
        if (account.capabilitiesActive()) {
          yield* openCapabilities;
        } else {
          yield* account.applyVoiceCredential;
        }
        yield* Effect.forkScoped(Effect.ignore(account.session.refreshOnce()));
      }),
      drain,
    };
    return assembly;
  }),
);
