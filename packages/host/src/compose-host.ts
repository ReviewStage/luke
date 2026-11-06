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

/**
 * The order the launch has to keep: the account is read before anything
 * gated on it. The quit is this order reversed.
 */
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

/** What every assembly asks for, whichever platform concerns it was built with. */
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

/** What each platform concern adds to the assembly's requirements when it is chosen. */
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
    const { tokenCipher } = yield* AccountSource;
    const fileSystemContext = yield* Effect.context<FileSystem.FileSystem | Path.Path>();

    const settings = yield* composeSettings();
    const account = yield* composeAccount({ settings });
    // Note that the socket a live read goes over is opened as a terminal's
    // is, so it stands where the assembly has the terminals concern's seam.
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
    /** A composer built over the client with each live read on one socket (`live-socket.ts`), which it captures for every call it makes. */
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
    /** The account signed in now, by its id, which every live read names. */
    const accountId = () => {
      const signedIn = account.session.snapshot();
      return signedIn.status === ACCOUNT_STATUS.SIGNED_IN ? signedIn.id : undefined;
    };
    /** The account signed in now as a member is named, by its id and its name, or its email where it names itself none. */
    const member = () => {
      const signedIn = account.session.snapshot();
      return signedIn.status === ACCOUNT_STATUS.SIGNED_IN && signedIn.id !== undefined
        ? { userId: signedIn.id, name: signedIn.name ?? signedIn.email }
        : undefined;
    };
    /** Content read under a key it never changes under, kept in this process for the account signed in until the agents' reset lets it go at a sign-out. */
    const kept = yield* keptContent(KEPT_CONTENT_CHARACTERS);
    /** A window coming forward, raised by the workspaces' refresh it already sends and heard by every read the host asks again on focus. */
    const focus = yield* windowFocus;
    /** The changes made offline the service refused as they were sent again, told to the windows each time the count moves. */
    const offlineRefused = offlineRefusedCount((count) =>
      kernel.emit(GATEWAY_EVENT.OFFLINE_REFUSED_CHANGED, carried({ count })),
    );
    /**
     * Every row the composers' reads hold, once, and the writes drawn over
     * them (`@repo/sync`). Where the run needs an account, a row write
     * that may wait for the service is sent under a key of the host's own
     * minting and waits while the service does not answer: kept on disk
     * beside the lists where they are kept (`openEntities`), and in a
     * browser tab for the tab's life alone. A fixture run keeps none
     * waiting.
     */
    const pool = yield* entityPool(
      kernel.runMode.requiresAccount
        ? {
            mintKey: kernel.createId,
            replayRefused: Effect.sync(() => offlineRefused.raise()),
          }
        : undefined,
    );
    /** The signed-in account's lists kept on disk (`entity-store.ts`), from the account gate opening until it closes; none where nothing seals them. */
    let entities: { readonly store: EntityStore; readonly scope: Scope.Closeable } | undefined;
    yield* Effect.addFinalizer(() =>
      entities === undefined ? Effect.void : Scope.close(entities.scope, Exit.void),
    );
    // Note that the integrations stand before the tasks, which ask GitHub's standing of them again once a GitHub connect or disconnect answers.
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
        // Note that a refusal's reason is not reported, because it may carry the address.
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
    /** An agent as the task list holds it now, on a plan or with none; none where it lists no such agent. */
    const agentListed = (agentId: string) => {
      const { taskAgents = [], tasklessAgents = [] } = tasks.snapshot();
      const onTask = taskAgents.find((agent) => agent.id === agentId);
      if (onTask !== undefined) return onTask;
      const taskless = tasklessAgents.find((agent) => agent.id === agentId);
      if (taskless === undefined) return undefined;
      // Note that an agent no automation started names none, which a summary leaves out rather than nulls.
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

    /**
     * The signed-in account's store opened where none stands: only where the
     * account source seals with a cipher the system can use, and the run
     * needs an account, so neither a browser tab nor a fixture run keeps one,
     * and only once the account is signed in, so the Keychain is never read
     * before the tokens' own read.
     */
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
      // Note that the writes kept waiting are laid back before any read draws, so the first answer draws under them.
      yield* pool.requeue(store.queue, [...tasks.queueable, ...agents.queueable]);
    });

    /** The store forgotten, its file deleted, as a sign-out does; a file no store stands over is deleted too. */
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

    /**
     * The account gate opening, which is what a sign-in runs and what a launch
     * behind an account already signed in runs: the preferences reconciled,
     * the account's access read, and its lists kept on disk opened.
     */
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

    /** The gate closing: what a sign-out means. */
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

    // Every edge a composer could not take as a constructor argument, in one
    // list: each is a cycle the concerns genuinely have. The write is the
    // composer's own set-once, so a reader that awaits its links suspends
    // until this has run rather than reading nothing.
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

    /**
     * The explicit quit's steps. The Gateway has no door to close, since the
     * one client is this process, so the step that closed it now only begins
     * the counted events' flush. No run of this Mac's own is under way to
     * cancel, settle, or count: every ask is the service's, so the drain
     * cancels nothing and counts nothing unresolved. A close a window still
     * holds for its Undo is let go as sent and waited for, since the window
     * that would have let it go is quitting with the host.
     */
    const drainSteps: GatewayShutdownSteps = yield* shutdownStepsFlushingEvents(
      {
        closeAdmissions: Effect.void,
        cancelActive: Effect.succeed([]),
        awaitSettled: agents.flushHeldCloses,
        persistUnresolved: Effect.succeed(0),
      },
      settings.flushProductEvents,
    );
    const drain = yield* hostDrain(drainSteps, report);

    const assembly: HostAssembly = {
      gateway: service.gateway,
      // Note that each declared act is answered by the one composer whose domain it is, so the table is spread rather than folded.
      acts: { ...agents.acts, ...tasks.acts },
      nodes: kernel.nodes,
      concerns: new Set(Object.values(HOST_CONCERN).filter(running)),
      startOrder: HOST_START_ORDER.filter(running).map((name) => concerns[name]),
      /**
       * The launch's own arming: where the account's capabilities already
       * stand open, the launch opens the gate exactly as a sign-in does.
       */
      armed: Effect.gen(function* () {
        if (account.capabilitiesActive()) yield* openCapabilities;
        yield* Effect.forkScoped(Effect.ignore(account.session.refreshOnce()));
      }),
      drain,
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
