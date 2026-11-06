import { ACCOUNT_STATUS } from "@repo/credentials/snapshot";
import {
  HostedAdminClient,
  HostedAgentClient,
  HostedAgentPortsClient,
  HostedAutomationClient,
  HostedDeviceAgentClient,
  HostedGitHubConnectionClient,
  HostedIntegrationsClient,
  HostedMacCommandClient,
  HostedMcpClientsClient,
  HostedTaskClient,
  HostedTerminalClient,
  HostedWorkspaceClient,
} from "@repo/features";
import { HostedInstalledSkillClient } from "@repo/features/installed-skill-client";
import {
  carried,
  GATEWAY_EVENT,
  GATEWAY_METHOD,
  type GatewayMethodTable,
  type GatewayShutdownSteps,
  NODE_CAPABILITY_STATUS,
} from "@repo/gateway";
import { APP_SETTING_SCHEMA, experimentOn, MAC_COMMAND_MODE, NO_EXPERIMENTS } from "@repo/settings";
import { entityPool } from "@repo/sync";
import { Effect, Exit, Layer, Option, Scope } from "effect";
import type * as FileSystem from "effect/FileSystem";
import * as HttpClient from "effect/http/HttpClient";
import type * as Path from "effect/Path";
import type { ChildProcessSpawner } from "effect/process";
import { composeAccount } from "./compose-account.js";
import { composeAgents } from "./compose-agents.js";
import { composeAutomations } from "./compose-automations.js";
import { composeInstalledSkills } from "./compose-installed-skills.js";
import { composeIntegrations } from "./compose-integrations.js";
import { composeMacCommands } from "./compose-mac-commands.js";
import { composeMirrors } from "./compose-mirrors.js";
import { composePortForwards, type PortForwardsComposer } from "./compose-port-forwards.js";
import { composeSettings } from "./compose-settings.js";
import { composeTasks } from "./compose-tasks.js";
import { composeTerminals, type TerminalsComposer } from "./compose-terminals.js";
import { composeThisMacHost } from "./compose-this-mac-host.js";
import type { Composer, DuplicateGatewayMethod } from "./composer.js";
import { mergedMethods } from "./effect/composer.js";
import { type HostAssembly, HostAssemblyTag, hostDrain } from "./effect/host.js";
import { HostKernelTag, HostService } from "./effect/kernel.js";
import {
  AccountSource,
  type AppIdentity,
  type Environment,
  LoopbackListener,
  MirrorPlatform,
  Reporter,
  ShutdownSignal,
  TerminalSocket,
  type ThisMacHost,
} from "./effect/seams.js";
import { type EntityStore, forgetEntityStore, openEntityStore } from "./entity-store.js";
import {
  HOST_CONCERN,
  HOST_PLATFORM_CONCERN,
  type HostConcern,
  type HostPlatformConcern,
  isPlatformConcern,
  unavailableConcern,
} from "./host-concerns.js";
import { KEPT_CONTENT_CHARACTERS, keptContent } from "./kept-content.js";
import { shutdownStepsFlushingEvents } from "./lifecycle.js";
import { liveSocketClient } from "./live-socket.js";
import { HOST_NODE_CAPABILITY } from "./node-capabilities.js";
import { offlineRefusedCount } from "./queued-writes.js";
import { createGatewayService } from "./service.js";
import { windowFocus } from "./window-focus.js";

const HOST_START_ORDER: readonly HostConcern[] = [
  HOST_CONCERN.SETTINGS,
  HOST_CONCERN.ACCOUNT,
  HOST_CONCERN.TASKS,
  HOST_CONCERN.AGENTS,
  HOST_CONCERN.AUTOMATIONS,
  HOST_CONCERN.INTEGRATIONS,
  HOST_CONCERN.INSTALLED_SKILLS,
  HOST_CONCERN.MAC_COMMANDS,
  HOST_CONCERN.THIS_MAC_HOST,
  HOST_CONCERN.MIRRORS,
];

type HostAssemblyRequirements =
  | HostKernelTag
  | HostService
  | Reporter
  | Environment
  | AppIdentity
  | ShutdownSignal
  | AccountSource
  | FileSystem.FileSystem
  | Path.Path
  | HttpClient.HttpClient;

interface PlatformConcernRequirements {
  [HOST_PLATFORM_CONCERN.MAC_COMMANDS]: ChildProcessSpawner.ChildProcessSpawner;
  [HOST_PLATFORM_CONCERN.THIS_MAC_HOST]: ChildProcessSpawner.ChildProcessSpawner | ThisMacHost;
  [HOST_PLATFORM_CONCERN.TERMINALS]: TerminalSocket;
  [HOST_PLATFORM_CONCERN.PORT_FORWARDS]: LoopbackListener | TerminalSocket;
  [HOST_PLATFORM_CONCERN.MIRRORS]:
    | ChildProcessSpawner.ChildProcessSpawner
    | TerminalSocket
    | MirrorPlatform;
}

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
    const { tokenCipher } = yield* AccountSource;
    const fileSystemContext = yield* Effect.context<FileSystem.FileSystem | Path.Path>();

    const settings = yield* composeSettings();
    const account = yield* composeAccount({ settings });
    const openSocket = platform.has(HOST_PLATFORM_CONCERN.TERMINALS)
      ? yield* TerminalSocket
      : undefined;
    const http =
      openSocket === undefined
        ? yield* HttpClient.HttpClient
        : yield* liveSocketClient({
            http: yield* HttpClient.HttpClient,
            openSocket,
            credential: account.credential,
            serviceBaseUrl: kernel.hostedServiceBaseUrl,
          });
    const served = <A, E, R>(composing: Effect.Effect<A, E, R>) =>
      Effect.provideService(composing, HttpClient.HttpClient, http);
    const workspaceClient = new HostedWorkspaceClient({
      serviceBaseUrl: kernel.hostedServiceBaseUrl,
      credential: account.credential,
      sessionCredential: account.sessionCredential,
    });
    const agentClient = new HostedAgentClient({
      serviceBaseUrl: kernel.hostedServiceBaseUrl,
      credential: account.credential,
    });
    const accountId = () => {
      const signedIn = account.session.snapshot();
      return signedIn.status === ACCOUNT_STATUS.SIGNED_IN ? signedIn.id : undefined;
    };
    const member = () => {
      const signedIn = account.session.snapshot();
      return signedIn.status === ACCOUNT_STATUS.SIGNED_IN && signedIn.id !== undefined
        ? { userId: signedIn.id, name: signedIn.name ?? signedIn.email }
        : undefined;
    };
    const kept = yield* keptContent(KEPT_CONTENT_CHARACTERS);
    const focus = yield* windowFocus;
    const offlineRefused = offlineRefusedCount((count) =>
      kernel.emit(GATEWAY_EVENT.OFFLINE_REFUSED_CHANGED, carried({ count })),
    );
    const pool = yield* entityPool(
      kernel.runMode.requiresAccount
        ? {
            mintKey: kernel.createId,
            replayRefused: Effect.sync(() => offlineRefused.raise()),
          }
        : undefined,
    );
    let entities: { readonly store: EntityStore; readonly scope: Scope.Closeable } | undefined;
    yield* Effect.addFinalizer(() =>
      entities === undefined ? Effect.void : Scope.close(entities.scope, Exit.void),
    );
    const integrations = yield* served(
      composeIntegrations({
        kernel,
        account,
        accountId,
        focus,
        pool,
        client: new HostedIntegrationsClient({
          serviceBaseUrl: kernel.hostedServiceBaseUrl,
          credential: account.credential,
        }),
        mcpClients: new HostedMcpClientsClient({
          serviceBaseUrl: kernel.hostedServiceBaseUrl,
          credential: account.credential,
          sessionCredential: account.sessionCredential,
        }),
        openExternal: (url) =>
          Effect.map(
            kernel.nodes.invoke(HOST_NODE_CAPABILITY.OPEN_EXTERNAL, { url }),
            (result) => result.status === NODE_CAPABILITY_STATUS.OK,
          ),
      }),
    );
    const tasks = yield* served(
      composeTasks({
        kernel,
        account,
        accountId,
        member,
        kept,
        focus,
        pool,
        entities: () => entities?.store,
        offlineRefused,
        githubMoved: integrations.githubMoved,
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
            admin: new HostedAdminClient({
              serviceBaseUrl: kernel.hostedServiceBaseUrl,
              sessionCredential: account.sessionCredential,
            }),
          },
        ),
      }),
    );
    const agentListed = (agentId: string) => {
      const { taskAgents = [], tasklessAgents = [] } = tasks.snapshot();
      const onTask = taskAgents.find((agent) => agent.id === agentId);
      if (onTask !== undefined) return onTask;
      const taskless = tasklessAgents.find((agent) => agent.id === agentId);
      if (taskless === undefined) return undefined;
      const { automationId, ...agent } = taskless;
      return automationId === null ? agent : { ...agent, automationId };
    };
    const agents = yield* served(
      composeAgents({
        kernel,
        account,
        accountId,
        kept,
        focus,
        reader: () => {
          const signedIn = account.session.snapshot();
          return signedIn.status === ACCOUNT_STATUS.SIGNED_IN && signedIn.id !== undefined
            ? { userId: signedIn.id, name: signedIn.name ?? signedIn.email }
            : undefined;
        },
        client: agentClient,
        listed: tasks.listed,
        pullRequestListings: tasks.pullRequestListings,
        pool,
        agentListed,
        repositoriesMoved: tasks.repositoriesMoved,
      }),
    );
    const automations = yield* served(
      composeAutomations({
        kernel,
        account,
        accountId,
        pool,
        entities: () => entities?.store,
        client: new HostedAutomationClient({
          serviceBaseUrl: kernel.hostedServiceBaseUrl,
          credential: account.credential,
        }),
      }),
    );
    const installedSkills = yield* served(
      composeInstalledSkills({
        kernel,
        account,
        accountId,
        pool,
        client: new HostedInstalledSkillClient({
          serviceBaseUrl: kernel.hostedServiceBaseUrl,
          credential: account.credential,
        }),
      }),
    );
    const macCommands = platform.has(HOST_PLATFORM_CONCERN.MAC_COMMANDS)
      ? yield* served(
          composeMacCommands({
            kernel,
            account,
            accountId,
            mode: Effect.map(
              Effect.orDie(settings.store.snapshot()),
              (snapshot) => snapshot.stored.macCommands ?? APP_SETTING_SCHEMA.macCommands.default,
            ),
            allowAlways: Effect.map(
              settings.settingsWrite(
                () =>
                  settings.store.set(APP_SETTING_SCHEMA.macCommands.field, MAC_COMMAND_MODE.ALWAYS),
                () => Effect.void,
                "Could not save that setting on this system.",
                undefined,
              ),
              (saved) => saved.reason === undefined,
            ),
            client: new HostedMacCommandClient({
              serviceBaseUrl: kernel.hostedServiceBaseUrl,
              credential: account.credential,
            }),
          }),
        )
      : unavailableConcern(HOST_PLATFORM_CONCERN.MAC_COMMANDS);
    const thisMacHost = platform.has(HOST_PLATFORM_CONCERN.THIS_MAC_HOST)
      ? yield* served(
          composeThisMacHost({
            kernel,
            account,
            accountId,
            experimentOn: (experiment) =>
              Effect.map(
                Effect.orElseSucceed(settings.store.snapshot(), () => ({
                  experiments: NO_EXPERIMENTS,
                })),
                (snapshot) => experimentOn(snapshot.experiments, experiment),
              ),
            hostListed: (deviceId) =>
              Effect.map(agentClient.hosts(), (answer) =>
                "failure" in answer
                  ? Option.none()
                  : Option.some(answer.hosts.some((host) => host.id === deviceId)),
              ),
            client: new HostedDeviceAgentClient({
              serviceBaseUrl: kernel.hostedServiceBaseUrl,
              credential: account.credential,
            }),
          }),
        )
      : unavailableConcern(HOST_PLATFORM_CONCERN.THIS_MAC_HOST);
    const terminals: TerminalsComposer =
      openSocket !== undefined
        ? yield* served(
            composeTerminals({
              kernel,
              account,
              client: new HostedTerminalClient({
                serviceBaseUrl: kernel.hostedServiceBaseUrl,
                credential: account.credential,
              }),
              openSocket,
            }),
          )
        : { ...unavailableConcern(HOST_PLATFORM_CONCERN.TERMINALS), reset: Effect.void };
    const mirrors = platform.has(HOST_PLATFORM_CONCERN.MIRRORS)
      ? yield* composeMirrors({
          kernel,
          account,
          openSocket: yield* TerminalSocket,
          platform: yield* MirrorPlatform,
          agentListed,
          listings: tasks.pullRequestListings,
        })
      : unavailableConcern(HOST_PLATFORM_CONCERN.MIRRORS);
    const portForwards: PortForwardsComposer = platform.has(HOST_PLATFORM_CONCERN.PORT_FORWARDS)
      ? yield* served(
          composePortForwards({
            kernel,
            account,
            client: new HostedAgentPortsClient({
              serviceBaseUrl: kernel.hostedServiceBaseUrl,
              credential: account.credential,
            }),
            openSocket: yield* TerminalSocket,
            listen: yield* LoopbackListener,
          }),
        )
      : { ...unavailableConcern(HOST_PLATFORM_CONCERN.PORT_FORWARDS), reset: Effect.void };

    const openEntities = Effect.gen(function* () {
      const signedInId = account.signedIn() ? accountId() : undefined;
      if (entities !== undefined || signedInId === undefined) return;
      if (tokenCipher === undefined || !tokenCipher.isAvailable()) return;
      if (!kernel.runMode.requiresAccount) return;
      const scope = yield* Scope.make();
      const store = yield* openEntityStore({
        directory: kernel.stateRoot,
        cipher: tokenCipher,
        accountId: signedInId,
        queued: pool.queued,
      }).pipe(Scope.provide(scope), Effect.provideContext(fileSystemContext));
      entities = { store, scope };
      yield* pool.requeue(store.queue, [...tasks.queueable, ...agents.queueable]);
    });

    const forgetEntities = Effect.gen(function* () {
      const standing = entities;
      entities = undefined;
      yield* pool.letGoQueued;
      offlineRefused.clear();
      if (standing !== undefined) {
        yield* standing.store.forget;
        yield* Scope.close(standing.scope, Exit.void);
      }
      yield* Effect.provideContext(forgetEntityStore(kernel.stateRoot), fileSystemContext);
    });

    const openCapabilities = Effect.gen(function* () {
      if (account.signedIn()) {
        yield* settings.reconcileAccountPreferences();
        yield* account.refreshAccess;
        yield* openEntities;
        yield* tasks.open;
        yield* agents.open;
        yield* automations.open;
        yield* integrations.open;
        yield* installedSkills.open;
      }
      yield* settings.emitSettings();
    });

    const closeCapabilities = Effect.gen(function* () {
      yield* account.forgetAccess;
      yield* forgetEntities;
      yield* tasks.reset;
      yield* agents.reset;
      yield* integrations.reset;
      yield* automations.reset;
      yield* installedSkills.reset;
      yield* terminals.reset;
      yield* portForwards.reset;
      yield* settings.emitSettings();
    });

    yield* settings.link({
      credential: account.credential,
      readAccountKey: () => account.token.readAccountKey?.() ?? Effect.succeed(undefined),
      confirmAccount: () => account.session.confirmAccount?.() ?? Effect.void,
    });
    yield* account.link({
      startCapabilities: openCapabilities,
      stopCapabilities: closeCapabilities,
    });
    const concerns = {
      [HOST_CONCERN.SETTINGS]: settings,
      [HOST_CONCERN.ACCOUNT]: account,
      [HOST_CONCERN.TASKS]: tasks,
      [HOST_CONCERN.AGENTS]: agents,
      [HOST_CONCERN.AUTOMATIONS]: automations,
      [HOST_CONCERN.INTEGRATIONS]: integrations,
      [HOST_CONCERN.INSTALLED_SKILLS]: installedSkills,
      [HOST_CONCERN.MAC_COMMANDS]: macCommands,
      [HOST_CONCERN.THIS_MAC_HOST]: thisMacHost,
      [HOST_CONCERN.TERMINALS]: terminals,
      [HOST_CONCERN.PORT_FORWARDS]: portForwards,
      [HOST_CONCERN.MIRRORS]: mirrors,
    } satisfies Readonly<Record<HostConcern, Composer>>;
    const running = (name: HostConcern) => !isPlatformConcern(name) || platform.has(name);

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
          const access = yield* account.accessState;
          return {
            settings: carried(snapshot),
            account: carried(account.snapshot()),
            sessionReplay: carried(replay),
            access: carried(access),
          };
        }),
    };

    const methods = yield* mergedMethods(Object.values(concerns));
    const service = createGatewayService({
      nodes: kernel.nodes,
      methods: { ...methods, ...bootstrapMethods },
    });
    yield* hostService.set(service);

    const drainSteps: GatewayShutdownSteps = yield* shutdownStepsFlushingEvents(
      {
        closeAdmissions: Effect.void,
        cancelActive: Effect.succeed([]),
        awaitSettled: Effect.void,
        persistUnresolved: Effect.succeed(0),
      },
      settings.flushProductEvents,
    );
    const drain = yield* hostDrain(drainSteps, report);

    const assembly: HostAssembly = {
      gateway: service.gateway,
      nodes: kernel.nodes,
      concerns: new Set(Object.values(HOST_CONCERN).filter(running)),
      startOrder: HOST_START_ORDER.filter(running).map((name) => concerns[name]),
      armed: Effect.gen(function* () {
        if (account.capabilitiesActive()) yield* openCapabilities;
        yield* Effect.forkScoped(Effect.ignore(account.session.refreshOnce()));
      }),
      drain,
    };
    return assembly;
  });
  const checked: Layer.Layer<
    HostAssemblyTag,
    DuplicateGatewayMethod,
    HostAssemblyRequirements | PlatformConcernRequirements[HostPlatformConcern]
  > = Layer.effect(HostAssemblyTag, build);
  return checked as Layer.Layer<
    HostAssemblyTag,
    DuplicateGatewayMethod,
    HostAssemblyRequirements | PlatformConcernRequirements[Chosen]
  >;
}
