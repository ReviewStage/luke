import {
  HostedAutomationClient,
  HostedCodingAgentClient,
  HostedGitHubConnectionClient,
  HostedIntegrationsClient,
  HostedMacCommandClient,
  HostedRepositoryRunClient,
  HostedRunSnapshotClient,
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
import type * as Path from "effect/Path";
import type { ChildProcessSpawner } from "effect/process";
import { composeAccount } from "./compose-account.js";
import { composeAutomations } from "./compose-automations.js";
import { composeCodingAgents } from "./compose-coding-agents.js";
import { composeIntegrations } from "./compose-integrations.js";
import { composeLive } from "./compose-live.js";
import { composeMacCommands } from "./compose-mac-commands.js";
import { composePrRuns, prRunTools } from "./compose-pr-runs.js";
import { composeSettings } from "./compose-settings.js";
import { composeTasks } from "./compose-tasks.js";
import { composeTerminals } from "./compose-terminals.js";
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
import { HOST_NODE_CAPABILITY } from "./node-capabilities.js";
import { revokeInstallationToken } from "./pr-run-credential.js";
import { freeLocalPort } from "./pr-run-process.js";
import { createGatewayService } from "./service.js";
import { openTerminalSocketOverWs } from "./terminal/socket-over-ws.js";

/** The concerns, by the name each is built under. */
const HOST_CONCERN = {
  SETTINGS: "settings",
  ACCOUNT: "account",
  LIVE: "live",
  TASKS: "planning",
  CODING_AGENTS: "codingAgents",
  AUTOMATIONS: "automations",
  INTEGRATIONS: "integrations",
  MAC_COMMANDS: "macCommands",
  TERMINALS: "terminals",
  PR_RUNS: "prRuns",
} as const;

type HostConcern = (typeof HOST_CONCERN)[keyof typeof HOST_CONCERN];

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
  HOST_CONCERN.INTEGRATIONS,
  HOST_CONCERN.MAC_COMMANDS,
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
  | ChildProcessSpawner.ChildProcessSpawner
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
      ...account.token,
      ...account.sessionToken,
    });
    const codingAgentClient = new HostedCodingAgentClient({
      serviceBaseUrl: kernel.hostedServiceBaseUrl,
      ...account.token,
    });
    const tasks = yield* composeTasks({
      kernel,
      account,
      endTaskCall: (taskId) => live.service.endTaskCall(taskId),
      client: Object.assign(
        new HostedTaskClient({ serviceBaseUrl: kernel.hostedServiceBaseUrl, ...account.token }),
        {
          workspaces: workspaceClient,
          github: new HostedGitHubConnectionClient({
            serviceBaseUrl: kernel.hostedServiceBaseUrl,
            ...account.token,
            ...account.sessionToken,
          }),
        },
      ),
      conversations: codingAgentClient,
    });
    const codingAgents = yield* composeCodingAgents({
      kernel,
      account,
      client: codingAgentClient,
    });
    const automations = yield* composeAutomations({
      kernel,
      account,
      client: new HostedAutomationClient({
        serviceBaseUrl: kernel.hostedServiceBaseUrl,
        ...account.token,
      }),
    });
    const integrations = yield* composeIntegrations({
      kernel,
      account,
      client: new HostedIntegrationsClient({
        serviceBaseUrl: kernel.hostedServiceBaseUrl,
        ...account.token,
      }),
      // Note that a refusal's reason is not reported, because it may carry the address.
      openExternal: (url) =>
        Effect.map(
          kernel.nodes.invoke(HOST_NODE_CAPABILITY.OPEN_EXTERNAL, { url }),
          (result) => result.status === NODE_CAPABILITY_STATUS.OK,
        ),
    });
    const macCommands = yield* composeMacCommands({
      kernel,
      account,
      enabled: Effect.map(
        Effect.orDie(settings.store.snapshot()),
        (snapshot) => snapshot.stored.macCommands ?? APP_SETTING_SCHEMA.macCommands.default,
      ),
      client: new HostedMacCommandClient({
        serviceBaseUrl: kernel.hostedServiceBaseUrl,
        ...account.token,
      }),
    });
    const terminals = yield* composeTerminals({
      kernel,
      account,
      client: new HostedTerminalClient({
        serviceBaseUrl: kernel.hostedServiceBaseUrl,
        ...account.token,
      }),
      openSocket: openTerminalSocketOverWs,
    });
    const prRuns = yield* composePrRuns({
      kernel,
      account,
      client: new HostedRunSnapshotClient({
        serviceBaseUrl: kernel.hostedServiceBaseUrl,
        ...account.token,
      }),
      runs: new HostedRepositoryRunClient({
        serviceBaseUrl: kernel.hostedServiceBaseUrl,
        ...account.token,
      }),
      freePort: freeLocalPort,
      revoke: revokeInstallationToken,
      sourceUrl: (repository) => `https://github.com/${repository}.git`,
      ...(yield* prRunTools),
      // Note that the credential helper is this app's own runtime run as Node, so it needs nothing installed beside Git.
      helper: { path: process.execPath, environment: { ELECTRON_RUN_AS_NODE: "1" } },
    });
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
      yield* prRuns.reset;
      yield* account.applyVoiceCredential;
      yield* settings.emitSettings();
    });

    // Every edge a composer could not take as a constructor argument, in one
    // list: each is a cycle the concerns genuinely have. The write is the
    // composer's own set-once, so a reader that awaits its links suspends
    // until this has run rather than reading nothing.
    yield* settings.link({
      refreshAccount: account.session.renewOnce,
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
      [HOST_CONCERN.INTEGRATIONS]: integrations,
      [HOST_CONCERN.MAC_COMMANDS]: macCommands,
      [HOST_CONCERN.TERMINALS]: terminals,
      [HOST_CONCERN.PR_RUNS]: prRuns,
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
      avatar: {
        states: live.service.avatarStates,
        grants: live.service.avatarGrants,
        closed: (reason) => live.service.closed(reason),
      },
    };
    return assembly;
  }),
);
