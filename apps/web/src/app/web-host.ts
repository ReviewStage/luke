import { PRODUCT_PLATFORM } from "@repo/features/analytics";
import { feedbackDelivery } from "@repo/features/feedback";
import type { LinkPlatform } from "@repo/features/link-open";
import { TERMINAL_PORT_CHANNEL } from "@repo/features/terminal-acts";
import { runModeFor } from "@repo/host";
import {
  type ActPortDependencies,
  type AgentProceduresDependencies,
  actPortFor,
  createActPortHandler,
  type PlatformActProcedures,
  refusedPlatformProcedures,
  type TerminalPortSeam,
  terminalProcedures,
  WindowPushes,
} from "@repo/host/act-port";
import { AgentNoticeDoors } from "@repo/host/agent-notices";
import { RUN_PROFILE, type RunProfile } from "@repo/host/app-state";
import type { AppBridge } from "@repo/host/bridge";
import {
  AppStateStore,
  createInProcessBridge,
  createOperatorClient,
  initialAppState,
  linkClientNotices,
  linkNetworkWatch,
  linkSessionReload,
  type OperatorClient,
  serviceReachLayer,
} from "@repo/host/client";
import { type ActPortClient, CONTACT_MAILTO, WINDOW_SURFACE_ACT_KIND } from "@repo/host/contract";
import {
  AppIdentity,
  type CookieSessionDoor,
  cookieAccountSourceLayer,
  type DuplicateGatewayMethod,
  Environment,
  HOST_PLATFORM_CONCERN,
  HostAssemblyTag,
  type HostTag,
  hostAssemblyLayer,
  hostCapabilities,
  hostKernelLayer,
  hostStandingLayer,
  IdSource,
  RunMode,
  reporterLayer,
  ServiceOrigin,
  SettingsChangedElsewhere,
  ShutdownSignal,
  StateRoot,
  TerminalSocket,
} from "@repo/host/effect";
import { effectServiceLayer } from "@repo/host/service-layer";
import { highlightSnippet } from "@repo/host/task-code";
import type { AppPlatform } from "@repo/panel/app-platform";
import { SETTING_SIDE_EFFECT } from "@repo/settings";
import { Cause, ConfigProvider, Context, Effect, Layer, Path, Stream } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import { version as appVersion } from "../../package.json";
import { type ConnectTabs, connectTabs, tabBrowser } from "./connect-tab";
import { FILES_KEY, localStorageFileSystem, tabStorage } from "./local-storage-file-system";
import { type PageLeave, tabLeave } from "./page-leave";
import { failedChunkAnswer, PRELOAD_ERROR, staleBuildTab } from "./stale-build";
import { addressHere } from "./web-address";
import { developmentFixtureProfile } from "./web-fixture";
import { onTabShownChanged, webNoticeDoors } from "./web-notices";
import { copyPng, downloadText, openTab, webPlatform } from "./web-platform";
import { openTerminalSocketFromPage } from "./web-terminal-socket";

const STATE_ROOT = "/app";

const RUN_PLATFORM = { WEB: "web" } as const;

const FEEDBACK_PATH = "/api/feedback";

type WebSender = Window;

export interface WebHost {
  readonly bridge: AppBridge;
  readonly actPort: MessagePort;
  readonly actPortClient: (client: ActPortClient) => ActPortClient;
  readonly platform: AppPlatform;
}

export class WebHostTag extends Context.Service<WebHostTag, WebHost>()("@repo/web/WebHost") {}

export interface WebHostOptions {
  readonly httpClient: Layer.Layer<HttpClient.HttpClient>;
  readonly fork: (effect: Effect.Effect<void>) => void;
  readonly linkPlatform?: LinkPlatform;
}

interface ComposedWeb extends WebHost {
  readonly operator: OperatorClient;
}

class ComposedWebTag extends Context.Service<ComposedWebTag, ComposedWeb>()(
  "@repo/web/ComposedWeb",
) {}

const SIGN_IN_LEFT_KEY = "app.host.signInLeft";

function keepSignInLeft(): void {
  try {
    window.sessionStorage.setItem(SIGN_IN_LEFT_KEY, "1");
  } catch {}
}

function takeSignInLeft(): boolean {
  try {
    const left = window.sessionStorage.getItem(SIGN_IN_LEFT_KEY) !== null;
    window.sessionStorage.removeItem(SIGN_IN_LEFT_KEY);
    return left;
  } catch {
    return false;
  }
}

const report = (message: string): void => {
  console.warn(message);
};

function cookieDoor(tab: PageLeave): CookieSessionDoor {
  const shown = Stream.filter(
    Stream.fromEventListener(document, "visibilitychange"),
    () => document.visibilityState === "visible",
  );
  const focused = Stream.fromEventListener(window, "focus");
  return {
    currentAddress: addressHere,
    navigate: (url, signingIn) =>
      Effect.sync(() =>
        tab.leave(() => {
          if (signingIn) keepSignInLeft();
          location.assign(url);
        }),
      ),
    returnedFromSignIn: Effect.sync(takeSignInLeft),
    revisits: Stream.as(Stream.merge(shown, focused), undefined),
  };
}

function filesChangedElsewhere(storage: Storage): Stream.Stream<void> {
  const changed = Stream.filter(
    Stream.fromEventListener<StorageEvent>(window, "storage"),
    (event) => event.storageArea === storage && (event.key === FILES_KEY || event.key === null),
  );
  return Stream.as(changed, undefined);
}

function seamLayers(storage: Storage, fixture: RunProfile | undefined) {
  return Layer.mergeAll(
    Layer.succeed(StateRoot, STATE_ROOT),
    Layer.succeed(RunMode, runModeFor({ capture: false, fixture: fixture !== undefined })),
    Layer.succeed(AppIdentity, { appVersion, packaged: true, platform: PRODUCT_PLATFORM.WEB }),
    Layer.succeed(Environment, ConfigProvider.fromEnv({ env: {} })),
    Layer.succeed(IdSource, { create: () => crypto.randomUUID() }),
    reporterLayer(report),
    Layer.succeed(ShutdownSignal, { notify: undefined }),
    Layer.succeed(ServiceOrigin, location.origin),
    Layer.succeed(TerminalSocket, openTerminalSocketFromPage),
    Layer.succeed(SettingsChangedElsewhere, filesChangedElsewhere(storage)),
  );
}

const noticeDoors = Effect.acquireRelease(Effect.sync(webNoticeDoors), (doors) =>
  Effect.sync(() => doors.close()),
);

const pageTerminalPorts: TerminalPortSeam<WebSender> = {
  open: (sender, ticket) => {
    const { port1, port2 } = new MessageChannel();
    sender.postMessage({ channel: TERMINAL_PORT_CHANNEL, ticket }, sender.location.origin, [port2]);
    port1.start();
    return {
      post: (message) => port1.postMessage(message),
      onMessage: (listener) => port1.addEventListener("message", (event) => listener(event.data)),
      close: () => port1.close(),
    };
  },
  whenGone: () => undefined,
};

interface PlatformHost {
  readonly operator: OperatorClient;
  readonly fork: WebHostOptions["fork"];
}

function platformProcedures(
  http: HttpClient.HttpClient,
  { operator, fork }: PlatformHost,
): PlatformActProcedures<WebSender> {
  const port = actPortFor<WebSender>();
  const feedback = feedbackDelivery({ url: new URL(FEEDBACK_PATH, location.origin).href });
  const KIND = WINDOW_SURFACE_ACT_KIND;
  return {
    ...refusedPlatformProcedures<WebSender>(),
    ...terminalProcedures<WebSender>({
      host: operator.host,
      ports: pageTerminalPorts,
      createId: () => crypto.randomUUID(),
      fork,
    }),
    [KIND.WINDOW_COPY_TEXT]: port[KIND.WINDOW_COPY_TEXT].handler(({ input }) =>
      navigator.clipboard.writeText(input.words),
    ),
    [KIND.WINDOW_COPY_IMAGE]: port[KIND.WINDOW_COPY_IMAGE].handler(({ input }) =>
      copyPng(Promise.resolve(input.png)),
    ),
    [KIND.WINDOW_SAVE_FILE]: port[KIND.WINDOW_SAVE_FILE].handler(({ input }) =>
      downloadText({ name: input.name, text: input.text }),
    ),
    [KIND.WINDOW_FOCUS_PANEL]: port[KIND.WINDOW_FOCUS_PANEL].handler(() => window.focus()),
    [KIND.CONTACT_EMAIL]: port[KIND.CONTACT_EMAIL].handler(() => location.assign(CONTACT_MAILTO)),
    [KIND.FEEDBACK_SEND]: port[KIND.FEEDBACK_SEND].effect(function* ({ input }) {
      return yield* Effect.provideService(
        feedback.deliver(input.submission),
        HttpClient.HttpClient,
        http,
      );
    }),
  };
}

function portDependencies(
  operator: OperatorClient,
  notices: AgentProceduresDependencies["notices"],
  reporter: string,
  tabs: ConnectTabs,
): ActPortDependencies {
  const host = operator.host;
  const nothing = () => undefined;
  return {
    account: {
      host,
      haltSessionReplay: operator.haltSessionReplay,
      resumeSessionReplay: operator.resumeSessionReplay,
    },
    accountAsks: { host },
    agentInbox: { host },
    agents: { host, notices },
    automations: { host },
    chapters: { host },
    installedSkills: { host },
    integrations: { host },
    macCommands: { host },
    pushes: new WindowPushes(),
    settings: {
      host,
      reporterOf: (actor) => (actor.sender === window ? reporter : undefined),
      lastSettings: () => operator.settings(),
      sideEffects: {
        [SETTING_SIDE_EFFECT.NONE]: nothing,
        [SETTING_SIDE_EFFECT.LOGIN_ITEM]: nothing,
        [SETTING_SIDE_EFFECT.USAGE_DATA]: nothing,
      },
    },
    tasks: {
      host,
      colorCode: highlightSnippet,
      openExternal: async (url) => tabs.open(url),
      serviceBaseUrl: location.origin,
    },
    workspaces: { host, openExternal: async (url) => tabs.open(url) },
  };
}

const servedActPort = (
  dependencies: ActPortDependencies,
  procedures: PlatformActProcedures<WebSender>,
  services: Context.Context<never>,
) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const channel = new MessageChannel();
      createActPortHandler(dependencies, procedures).upgrade(channel.port2, {
        context: () => ({
          actor: { sender: window, panel: true },
          trusted: true,
          "effect/context": services,
        }),
      });
      channel.port2.start();
      return channel;
    }),
    (channel) =>
      Effect.sync(() => {
        channel.port1.close();
        channel.port2.close();
      }),
  ).pipe(Effect.map((channel) => channel.port1));

const composedWeb = (
  fork: WebHostOptions["fork"],
  tab: PageLeave,
  linkPlatform: LinkPlatform | undefined,
  fixture: RunProfile | undefined,
) =>
  Layer.effect(
    ComposedWebTag,
    Effect.gen(function* () {
      const assembly = yield* HostAssemblyTag;
      const http = yield* HttpClient.HttpClient;
      const services: Context.Context<never> = yield* Effect.context();
      const state = new AppStateStore(
        initialAppState(
          {
            launch: {
              profile: fixture ?? RUN_PROFILE.IDLE,
              captureMode: false,
              fixtureMode: fixture !== undefined,
            },
            runMode: runModeFor({ capture: false, fixture: fixture !== undefined }),
            appVersion,
            packaged: true,
            platform: RUN_PLATFORM.WEB,
          },
          false,
          hostCapabilities(assembly.concerns, []),
        ),
        services,
      );
      const tabs = connectTabs(tabBrowser(openTab, tab.leave));
      yield* Effect.acquireRelease(Effect.sync(tabs.listen), (stop) => Effect.sync(stop));
      const operator = yield* createOperatorClient({
        report,
        gateway: assembly.gateway,
        nodes: assembly.nodes,
        node: { openExternal: async (url) => tabs.open(url) },
        state,
      });
      yield* linkNetworkWatch({
        state,
        isOnline: () => navigator.onLine,
        regained: operator.host.tasksRegained(),
        report,
      });
      yield* linkSessionReload({ state, reload: () => location.reload() });

      const doors = yield* noticeDoors;
      const notices = yield* linkClientNotices({
        state,
        host: operator.host,
        presenter: { openMacCommandAsk: () => window.focus() },
        onPanelFocusChanged: onTabShownChanged,
        report,
      }).pipe(Effect.provideService(AgentNoticeDoors, doors));

      const count: AppPlatform["recordSurfaceEvent"] = (name, properties) => {
        fork(
          Effect.catchCause(operator.host.recordEvent(name, properties), (cause) =>
            Effect.sync(() => report(`A surface event was not counted: ${Cause.pretty(cause)}`)),
          ),
        );
      };
      const made = yield* createInProcessBridge({
        state,
        windowFacts: () => ({ fullScreen: document.fullscreenElement !== null }),
        reports: { notifyReady: () => undefined, recordSurfaceEvent: count },
        report,
      });
      const actPort = yield* servedActPort(
        portDependencies(operator, notices, crypto.randomUUID(), tabs),
        platformProcedures(http, { operator, fork }),
        services,
      );
      return {
        bridge: made.bridge,
        actPort,
        actPortClient: tabs.portClient,
        platform: webPlatform(
          {
            recordSurfaceEvent: count,
            unsavedWork: tab.unsavedWork,
            unsavedDescriptionWords: tab.unsavedDescriptionWords,
          },
          linkPlatform,
        ),
        operator,
      };
    }),
  );

export function composeWeb(
  options: WebHostOptions,
): Layer.Layer<WebHostTag | HostTag, DuplicateGatewayMethod> {
  const { httpClient, fork, linkPlatform } = options;
  const tab = tabLeave();
  const storage = tabStorage();
  const fixture = developmentFixtureProfile(location.search);
  const assembly = Layer.provide(
    hostAssemblyLayer([HOST_PLATFORM_CONCERN.TERMINALS]),
    Layer.mergeAll(
      Layer.provideMerge(hostKernelLayer, seamLayers(storage, fixture)),
      localStorageFileSystem(storage),
      Path.layer,
      httpClient,
      Layer.provide(cookieAccountSourceLayer(cookieDoor(tab)), httpClient),
    ),
  ).pipe(Layer.provideMerge(serviceReachLayer));
  const launched = Layer.unwrap(
    Effect.map(ComposedWebTag, (web) =>
      Layer.mergeAll(
        Layer.succeed(WebHostTag, {
          bridge: web.bridge,
          actPort: web.actPort,
          actPortClient: web.actPortClient,
          platform: web.platform,
        }),
        effectServiceLayer(web.operator, report),
      ).pipe(Layer.provideMerge(hostStandingLayer)),
    ),
  );
  const staleBuild = Layer.effectDiscard(
    Effect.forkScoped(
      Effect.suspend(() =>
        Stream.runForEach(
          Stream.fromEventListener(window, PRELOAD_ERROR),
          failedChunkAnswer(staleBuildTab(tab)),
        ),
      ),
    ),
  );
  return Layer.merge(launched, staleBuild).pipe(
    Layer.provideMerge(composedWeb(fork, tab, linkPlatform, fixture)),
    Layer.provideMerge(assembly),
    Layer.provide(httpClient),
  );
}
