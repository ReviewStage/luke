import { ACCOUNT_STATUS } from "@luke/credentials/snapshot";
import {
  HostedAutomationClient,
  HostedCodingAgentClient,
  HostedFactoryWorldClient,
  HostedGitHubConnectionClient,
  HostedIntegrationsClient,
  HostedIssueClient,
  HostedMacCommandClient,
  HostedTaskClient,
  HostedTerminalClient,
  HostedWorkspaceClient,
  type PlanDraftFrame,
  type TaskActivityFrame,
  type TaskCodeFrame,
  type TaskWorkFrame,
} from "@luke/features";
import {
  carried,
  GATEWAY_METHOD,
  type GatewayMethodTable,
  type GatewayShutdownSteps,
  NODE_CAPABILITY_STATUS,
} from "@luke/gateway";
import { APP_SETTING_SCHEMA } from "@luke/settings";
import { LIVE_SESSION_END_CAUSE } from "@luke/voice/live-session";
import { Effect, Layer } from "effect";
import type * as FileSystem from "effect/FileSystem";
import type * as HttpClient from "effect/http/HttpClient";
import type * as Path from "effect/Path";
import type { ChildProcessSpawner } from "effect/process";
import { composeAccount } from "./compose-account.js";
import { composeAutomations } from "./compose-automations.js";
import { composeCodingAgents } from "./compose-coding-agents.js";
import { composeFactory } from "./compose-factory.js";
import { composeIntegrations } from "./compose-integrations.js";
import { composeIssues } from "./compose-issues.js";
import { composeLive } from "./compose-live.js";
import { composeMacCommands } from "./compose-mac-commands.js";
import { composeMacTerminal } from "./compose-mac-terminal.js";
import { composeSettings } from "./compose-settings.js";
import { composeTasks } from "./compose-tasks.js";
import { composeTerminals, type TerminalsComposer } from "./compose-terminals.js";
import type { Composer, DuplicateGatewayMethod } from "./composer.js";
import { mergedMethods } from "./effect/composer.js";
import { type HostAssembly, HostAssemblyTag, hostDrain } from "./effect/host.js";
import { HostKernelTag, HostService } from "./effect/kernel.js";
import {
  type AccountSource,
  type AppIdentity,
  type Environment,
  Reporter,
  ShutdownSignal,
  TerminalSocket,
  VoiceSocket,
} from "./effect/seams.js";
import {
  HOST_CONCERN,
  HOST_PLATFORM_CONCERN,
  type HostConcern,
  type HostPlatformConcern,
  isPlatformConcern,
  unavailableConcern,
} from "./host-concerns.js";
import { shutdownStepsClosingLiveSession, shutdownStepsFlushingEvents } from "./lifecycle.js";
import { HOST_NODE_CAPABILITY } from "./node-capabilities.js";
import { createGatewayService } from "./service.js";

/**
 * The order the launch has to keep: the account is read before anything
 * gated on it. The quit is this order reversed.
 */
const HOST_START_ORDER: readonly HostConcern[] = [
  HOST_CONCERN.SETTINGS,
  HOST_CONCERN.ACCOUNT,
  HOST_CONCERN.LIVE,
  HOST_CONCERN.TASKS,
  HOST_CONCERN.CODING_AGENTS,
  HOST_CONCERN.AUTOMATIONS,
  HOST_CONCERN.ISSUES,
  HOST_CONCERN.FACTORY,
  HOST_CONCERN.INTEGRATIONS,
  HOST_CONCERN.MAC_COMMANDS,
];

/** What every assembly asks for, whichever platform concerns it was built with. */
type HostAssemblyRequirements =
  | HostKernelTag
  | HostService
  | Reporter
  | VoiceSocket
  | Environment
  | AppIdentity
  | ShutdownSignal
  | AccountSource
  | FileSystem.FileSystem
  | Path.Path
  | HttpClient.HttpClient;

/** What each platform concern adds to the assembly's requirements when it is chosen. */
interface PlatformConcernRequirements {
  [HOST_PLATFORM_CONCERN.MAC_COMMANDS]: ChildProcessSpawner.ChildProcessSpawner;
  [HOST_PLATFORM_CONCERN.MAC_TERMINAL]: never;
  [HOST_PLATFORM_CONCERN.TERMINALS]: TerminalSocket;
}

/**
 * Every concern constructed, linked, and merged, with nothing yet begun: the
 * composers in the launch's order, the arming that follows the last of them,
 * and the drain. A method two concerns claim fails this build, so which
 * concern answers a method is checked before anything starts.
 *
 * The platform concerns are the ones `chosen` names. One left out is never
 * started, adds nothing to the layer's requirements, and answers each of its
 * methods with a refusal (`host-concerns.ts`).
 */
export function hostAssemblyLayer<const Chosen extends HostPlatformConcern>(
  chosen: readonly Chosen[],
): Layer.Layer<
  HostAssemblyTag,
  DuplicateGatewayMethod,
  HostAssemblyRequirements | PlatformConcernRequirements[Chosen]
> {
  const platform = new Set<HostPlatformConcern>(chosen);
  const build = Effect.gen(function* () {
    const kernel = yield* HostKernelTag;
    const hostService = yield* HostService;
    const shutdownSignal = yield* ShutdownSignal;
    const { report } = yield* Reporter;
    const openVoiceSocket = yield* VoiceSocket;

    const settings = yield* composeSettings();
    const account = yield* composeAccount({ settings, openSocket: openVoiceSocket });
    // No brain runs on this Mac: the exchange is the service's, and Luke
    // speaks only on a task's call the developer opened.
    // The tasks composer is built after the live one and ends its calls, so
    // the live composer reads the open task, and hands it the task's drafts
    // and their activity, through these late bindings.
    let activeTaskId: () => string | undefined = () => undefined;
    let showPlanDraft: (draft: PlanDraftFrame) => void = () => undefined;
    let showTaskActivity: (activity: TaskActivityFrame) => void = () => undefined;
    let taskCallEnded: (taskId: string) => void = () => undefined;
    let showTaskCode: (code: TaskCodeFrame) => void = () => undefined;
    let showTaskWork: (work: TaskWorkFrame) => void = () => undefined;
    const live = yield* composeLive({
      settings,
      account,
      activeTaskId: () => activeTaskId(),
      showPlanDraft: (draft) => showPlanDraft(draft),
      showTaskActivity: (activity) => showTaskActivity(activity),
      taskCallEnded: (taskId) => taskCallEnded(taskId),
      showTaskCode: (code) => showTaskCode(code),
      showTaskWork: (work) => showTaskWork(work),
    });
    const workspaceClient = new HostedWorkspaceClient({
      serviceBaseUrl: kernel.hostedServiceBaseUrl,
      credential: account.credential,
      sessionCredential: account.sessionCredential,
    });
    const codingAgentClient = new HostedCodingAgentClient({
      serviceBaseUrl: kernel.hostedServiceBaseUrl,
      credential: account.credential,
    });
    const tasks = yield* composeTasks({
      kernel,
      account,
      endTaskCall: (taskId) => live.service.endTaskCall(taskId),
      client: Object.assign(
        new HostedTaskClient({
          serviceBaseUrl: kernel.hostedServiceBaseUrl,
          credential: account.credential,
        }),
        {
          workspaces: workspaceClient,
          github: new HostedGitHubConnectionClient({
            serviceBaseUrl: kernel.hostedServiceBaseUrl,
            credential: account.credential,
            sessionCredential: account.sessionCredential,
          }),
        },
      ),
      conversations: codingAgentClient,
    });
    const codingAgents = yield* composeCodingAgents({
      kernel,
      account,
      accountId: () => {
        const signedIn = account.session.snapshot();
        return signedIn.status === ACCOUNT_STATUS.SIGNED_IN ? signedIn.id : undefined;
      },
      client: codingAgentClient,
    });
    const automations = yield* composeAutomations({
      kernel,
      account,
      client: new HostedAutomationClient({
        serviceBaseUrl: kernel.hostedServiceBaseUrl,
        credential: account.credential,
      }),
    });
    const issues = yield* composeIssues({
      kernel,
      account,
      client: new HostedIssueClient({
        serviceBaseUrl: kernel.hostedServiceBaseUrl,
        credential: account.credential,
      }),
    });
    const factory = yield* composeFactory({
      kernel,
      account,
      client: new HostedFactoryWorldClient({
        serviceBaseUrl: kernel.hostedServiceBaseUrl,
        credential: account.credential,
      }),
    });
    const integrations = yield* composeIntegrations({
      kernel,
      account,
      client: new HostedIntegrationsClient({
        serviceBaseUrl: kernel.hostedServiceBaseUrl,
        credential: account.credential,
      }),
      // Note that a refusal's reason is not reported, because it may carry the address.
      openExternal: (url) =>
        Effect.map(
          kernel.nodes.invoke(HOST_NODE_CAPABILITY.OPEN_EXTERNAL, { url }),
          (result) => result.status === NODE_CAPABILITY_STATUS.OK,
        ),
    });
    const macCommands = platform.has(HOST_PLATFORM_CONCERN.MAC_COMMANDS)
      ? yield* composeMacCommands({
          kernel,
          account,
          enabled: Effect.map(
            Effect.orDie(settings.store.snapshot()),
            (snapshot) => snapshot.stored.macCommands ?? APP_SETTING_SCHEMA.macCommands.default,
          ),
          client: new HostedMacCommandClient({
            serviceBaseUrl: kernel.hostedServiceBaseUrl,
            credential: account.credential,
          }),
        })
      : unavailableConcern(HOST_PLATFORM_CONCERN.MAC_COMMANDS);
    const macTerminal = platform.has(HOST_PLATFORM_CONCERN.MAC_TERMINAL)
      ? composeMacTerminal({ store: settings.store })
      : unavailableConcern(HOST_PLATFORM_CONCERN.MAC_TERMINAL);
    const terminals: TerminalsComposer = platform.has(HOST_PLATFORM_CONCERN.TERMINALS)
      ? yield* composeTerminals({
          kernel,
          account,
          client: new HostedTerminalClient({
            serviceBaseUrl: kernel.hostedServiceBaseUrl,
            credential: account.credential,
          }),
          openSocket: yield* TerminalSocket,
        })
      : { ...unavailableConcern(HOST_PLATFORM_CONCERN.TERMINALS), reset: Effect.void };
    activeTaskId = tasks.activeTaskId;
    showPlanDraft = tasks.showDraft;
    showTaskActivity = tasks.showActivity;
    taskCallEnded = tasks.callEnded;
    showTaskCode = ({ type: _type, planId: taskId, ...shown }) => tasks.showCode(taskId, shown);
    showTaskWork = (work) => tasks.showWork(work.planId, work.turn);

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
      yield* tasks.reset;
      yield* terminals.reset;
      yield* codingAgents.reset;
      yield* issues.reset;
      yield* account.applyVoiceCredential;
      yield* settings.emitSettings();
    });

    // Every edge a composer could not take as a constructor argument, in one
    // list: each is a cycle the concerns genuinely have. The write is the
    // composer's own set-once, so a reader that awaits its links suspends
    // until this has run rather than reading nothing.
    yield* settings.link({
      credential: account.credential,
      readAccountKey: () => account.token.readAccountKey?.() ?? Effect.succeed(undefined),
      confirmAccount: () => account.session.confirmAccount?.() ?? Effect.void,
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
      [HOST_CONCERN.TASKS]: tasks,
      [HOST_CONCERN.CODING_AGENTS]: codingAgents,
      [HOST_CONCERN.AUTOMATIONS]: automations,
      [HOST_CONCERN.ISSUES]: issues,
      [HOST_CONCERN.FACTORY]: factory,
      [HOST_CONCERN.INTEGRATIONS]: integrations,
      [HOST_CONCERN.MAC_COMMANDS]: macCommands,
      [HOST_CONCERN.MAC_TERMINAL]: macTerminal,
      [HOST_CONCERN.TERMINALS]: terminals,
    } satisfies Readonly<Record<HostConcern, Composer>>;
    // Note that the platform concerns are the only ones a host may leave out.
    const running = (name: HostConcern) => !isPlatformConcern(name) || platform.has(name);

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
      concerns: new Set(Object.values(HOST_CONCERN).filter(running)),
      startOrder: HOST_START_ORDER.filter(running).map((name) => concerns[name]),
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
      avatar: {
        states: live.service.avatarStates,
        grants: live.service.avatarGrants,
        closed: (reason) => live.service.closed(reason),
      },
    };
    return assembly;
  });
  // Note that the build is checked against every platform concern's seam
  // first, so a requirement a composer gains is never dropped from `R`.
  const checked: Layer.Layer<
    HostAssemblyTag,
    DuplicateGatewayMethod,
    HostAssemblyRequirements | PlatformConcernRequirements[HostPlatformConcern]
  > = Layer.effect(HostAssemblyTag, build);
  // SAFETY: the build asks for a platform concern's own seam only on the
  // branch that composes that concern, so a concern left out of `chosen`
  // never reads what `PlatformConcernRequirements` would have added for it.
  return checked as Layer.Layer<
    HostAssemblyTag,
    DuplicateGatewayMethod,
    HostAssemblyRequirements | PlatformConcernRequirements[Chosen]
  >;
}
